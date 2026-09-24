# Plan - Standalone Tao CLI

Implementation update (2026-09-22): the first `tao dev` slice now generates its Expo host in the
selected project's `.tao/dev/runtime`, keeps Expo and dev-data state in that project, and uses a
shared CLI/Studio owner with retained `.tao/sessions/` records. Bare `tao dev` opens no target.
The next branch implements local static web exports, local Electrobun `.app` builds, desktop dev
opening, retained `.tao/builds/` records, and interactive build cleanup; it does not yet package
or publish the standalone CLI, or implement native builds and shipping.
The findings below are the historical pre-implementation baseline; packaging and publishing a
relocatable CLI remain in this standalone program. The decided command behavior is in
[`../Roadmap/Tao CLI workflows/Decisions - Development build ship and clean.md`](../Roadmap/Tao%20CLI%20workflows/Decisions%20-%20Development%20build%20ship%20and%20clean.md).

The plan for `A2 — A standalone tao executable` in `Agent MVP Roadmap.md`. It writes no code; it
records what the toolchain actually reads at runtime, what was measured rather than assumed, the
recommended shape, what is still uncertain, the slice sequence, and the Developer's release decisions. The
five-target engineering survey below is broader than the decided first release: **macOS arm64, via
an install script only**. Later targets and channels remain possible, not committed release scope.

Everything under **Findings** was verified on this machine on 2026-09-17 — macOS 27.0 (26A428),
arm64 — in a scratch directory under `.artifacts/`. The repository's devenv Bun was 1.3.13; F3
explains why every other measurement was taken with an official Bun 1.4.2 instead. Commands and
numbers are reproduced verbatim so a later reader can tell measurement from opinion.

## The problem, stated precisely

- `tao` is a zsh wrapper that execs `bun` on `packages/cli/tao-cli/cli-src/tao-cli.ts`. It locates
  itself with the zsh-only `${0:A:h}` expansion, so it needs this checkout, its devenv profile, and
  zsh.
- All twenty packages under `packages/` carry `"private": true`.
- `tao dev` compiles into `packages/apps/expo-host/_gen_tao-app` and runs Metro in that package,
  against that package's `node_modules`.
- The dev loop it drives is the _repository's_ dev loop: it calls `just`,
  `bun run packages/cli/dev-cli/dev-cli-src/dev.ts`, and `Repo.resolvePath('tao')`, and anchors Expo's home,
  log path, and the runtime-toolchain root on the **Git worktree root** (`Repo.getRoot()` shells out
  to `git rev-parse --show-toplevel`).

Nobody outside this repository can install Tao, and nothing in the dev loop would work if they did.

## Findings

### F1 — The whole CLI already compiles into one binary, and most of it already works

`bun build --compile packages/cli/tao-cli/cli-src/tao-cli.ts` bundles **1249 modules** with no errors
and produces a 67.8 MB binary. Langium, Commander, `@bomb.sh/tab`, the compiler, the validator, and
the formatter all survive bundling; the `await import('./create/create-command')` lazy loads are
static specifiers and bundle fine.

Verified from a directory with no checkout above it:

| Command                                           | Result                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `tao --help`                                      | works                                                                                     |
| `tao fmt` on a file with a ` ```ts ` inject fence | **formats the embedded TypeScript** — the dprint WASM plugin loads from inside the binary |
| `tao check .` on a copied starter                 | works, same two warnings as `./tao`                                                       |
| `tao create "…" --ai none --yes --skip-tests`     | writes the complete project, then fails on the last step                                  |
| `tao compile App.tao`                             | fails                                                                                     |

Both failures are the same one line:

```
The Tao CLI has no @tao/runtime module: neither /runtime nor /$bunfs/modules/@tao/runtime holds TaoRuntime-src/TR.ts.
```

That is `TaoAppModules` resolving against `CLI_PACKAGE_ROOT = FS.resolvePath('..', import.meta.dir)`.
Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, so the anchor becomes `/$bunfs`. The
same applies to `Stdlib.rootPath` (`FS.resolvePath('..', import.meta.dirname)` → `/$bunfs`) and
`RuntimeToolchainPaths.packageRoot` (`FS.resolvePath('..', __dirname)`).

Probed directly from a compiled binary:

```
import.meta.dir      = /$bunfs/root
import.meta.dirname  = /$bunfs/root
import.meta.url      = file:///$bunfs/root/probe
import.meta.main     = true
process.execPath     = <the binary's own path>
Stdlib.rootPath      = /$bunfs
exists(Stdlib/@tao)  = false
```

So the resource-root fix is small, specific, and is most of slice 2.

Startup cost is not a concern: `tao --help` is 42 ms through the zsh wrapper and 66 ms from the
binary.

### F2 — A missing stdlib fails silently in `tao check` and loudly in `tao compile`

`TAO_STDLIB_ROOT=<empty dir> ./tao check .` on a starter produced **byte-identical output** to a run
with the real stdlib: the same two style warnings, `0 noncanonical, 7 unchanged, 2 warnings`, exit 0.
No `use … from @tao/ui` is reported as unresolvable.

This matters twice. It is evidence for `A1` (diagnostics a newcomer can act on), and it means a
half-installed or mis-resolved resource root will look healthy under `check` and only surface at
`compile`. Whatever resolves resources must verify them, not discover them.

### F3 — Bun 1.3.13 cannot produce a runnable compiled binary on macOS 27

This blocks the whole item and was found first.

```
$ bun build --compile --outfile=hello hello.ts     # bun 1.3.13, the pinned devenv Bun
$ ./hello
exit=137                                            # SIGKILL
$ codesign -v -vvv hello
hello: invalid signature (code or signature have been modified)
$ codesign --force --sign - hello
hello: main executable failed strict validation
```

The signature covers 15275 × 4096 = 62,566,400 bytes of a 63,060,304-byte file; Bun appends its
payload after the signature and macOS 27 kills the process. The binary cannot even be re-signed.

Across versions, same `hello.ts`, same host:

| Bun             | `codesign -v` | run                                                                              |
| --------------- | ------------- | -------------------------------------------------------------------------------- |
| 1.3.13 (pinned) | invalid       | killed (137)                                                                     |
| 1.3.14          | invalid       | ran once — a macOS signature cache making an invalid binary look fine, not a fix |
| 1.4.0           | invalid       | killed (137)                                                                     |
| **1.4.2**       | **valid**     | **runs**                                                                         |

Every measurement below was taken with Bun 1.4.2. **Bumping the pinned Bun to ≥ 1.4.2 was a
precondition for slice 1**, and the changed profile must be verified against the existing suites.

Re-signing a 1.4.2 binary for notarization works:

```
$ codesign --force --sign - --options runtime tao-bin      # hardened runtime
$ tao-bin check .                                          # still runs, exit 0
```

The 2026-09-22 upgrade also exposed a macOS 27 watcher regression: with the same CLI watch tests,
Bun 1.3.13 delivered native file-edit events and 1.4.2 did not, including with host access.
Chokidar polling delivered the edits. Tao's shared debounced watcher therefore uses polling on
macOS with Bun 1.4.2, preserving `tao test --watch` and the development loop without changing
the backend for other runtime versions.

### F4 — What the CLI reads at runtime, and whether it can be embedded

The rule that decides every row: **anything a child process resolves must be a real file on disk;
everything only the binary itself reads can be embedded.** `/$bunfs` does not exist for `expo`,
Metro, Jest, `tsc`, or the user's editor.

**Embed — only the binary reads these.**

- The CLI's own TypeScript, 1249 modules across `packages/*/…-src`. This is the binary (F1).
- The generated Langium parser, `packages/language/parser/parser-src/_gen_tao-parser`. Generation must run
  before `--compile`: a fresh worktree has none, and every Tao command then fails with a bare
  `Something went wrong.`
- The dprint TypeScript `plugin.wasm`, which `@dprint/typescript` hands over through `getPath()` and
  `FS.readFile`. Bun embeds it automatically — verified by formatting an inject fence from the
  binary (F1).
- The generated TextMate grammar,
  `packages/ides/ide-extension/…/_gen_syntaxes/tao-lang.tmLanguage.json`, read by Shiki for `tao review`.
  It is embeddable as a text asset once `StudioHighlight` stops resolving it from the Git root.

**Nothing to ship.** The starter plans (`cli-src/create/starter-plans.ts`) and `PROJECT_TSCONFIG`
are TypeScript values, not templates on disk.

**Unpack — a child process has to resolve these.**

- stdlib `.tao` sources: 24 files, about 34 KB, under `packages/apps/stdlib/@tao`. The Tao package
  resolver walks that root with `FS.isDirectory` and `Repo.directoriesUnder`; there is no directory
  in `/$bunfs` to walk.
- stdlib sidecars in the same tree: 16 `.ts` files (a `**/*.ts` glob covers them all now that no
  stdlib sidecar is a `.tsx`). **Metro** resolves them inside the user's project. The whole `@tao`
  tree is smaller now that `@tao/code-editor` moved into Studio's own source; re-measure before
  relying on this figure.
- `@tao/runtime` (`packages/apps/runtime/TaoRuntime-src`, 1.3 MB). **Metro** resolves it, and so does the
  project's `tsconfig.json` through the `node_modules/@tao/runtime` link.
- The Expo host files, about 2.1 MB without `node_modules`. `expo start` needs `package.json`,
  `app.config.js`, `app-config.cjs`, `metro.config.cjs`, `app.json`, `index.ts`, `plugins/`, and
  `assets/` (1.9 MB, nearly all of it the two app icons). `tao test` additionally needs
  `jest.tao-test.config.cjs` and the `jest.shared.config.cjs` it requires, `jest.config.cjs`,
  `tsconfig.json`, `expo-host-src/testing/`, and every `expo-host-tests/` file the
  config names through `testMatch`, `moduleNameMapper`, or `setupFilesAfterEnv` — today the
  fallback entrypoint, the journey harness, and two module mocks (a further 212 KB). Read the
  config rather than this list when building the payload; it changes. Omitting this group is the
  quiet way to make slice 5 unreachable.

**Never embed.** The Expo host `node_modules`, 355 MB of resolved closure, read by the Expo CLI,
Metro, and Jest. See F6.

Text embedding was verified directly — `import x from '…/Prelude.tao' with { type: 'text' }` returned
the file's contents from inside a compiled binary — but it buys little: the Tao-owned resources above
total about **3.6 MB**, so one unconditional unpack per version is simpler than two mechanisms and is
what the package resolver and every child process need anyway.

`packages/cli/tao-cli/modules/@tao/` already exists for this, holds only `.gitkeep`, and
`TaoAppModules.packageRuntime()` is already written to fill it. `DEVENV-058` records that no recipe
calls it. That is the seam to build on rather than replace.

### F5 — Metro and the Expo CLI run under the compiled binary; Jest does not

Verified with `PATH` reduced to `/usr/bin:/bin`, so **no Node and no Bun existed on the path** —
only the compiled binary.

```
$ BUN_BE_BUN=1 <tao-binary> --version
1.4.2
```

`expo start`:

```
$ cd <host> && PATH=/usr/bin:/bin BUN_BE_BUN=1 <tao-binary> x --bun expo start --port 8099 --host lan
Starting Metro Bundler
Waiting on http://localhost:8099

$ curl http://127.0.0.1:8099/status
packager-status:running

$ curl -o /dev/null "…/index.bundle?platform=ios&dev=true&minify=false"
ios     http=200 bytes=4141885 time=0.44
android http=200 bytes=4150582 time=7.59
web     http=200 bytes=1509372 time=0.73
```

`lsof` on the listening process shows its `txt` image is the compiled Tao binary, not a Node.

`expo export`, which also drives `hermesc`:

```
$ PATH=/usr/bin:/bin BUN_BE_BUN=1 <tao-binary> x --bun expo export --platform ios --output-dir dist-ios
iOS Bundled 4343ms index.js (579 modules)
› ios bundles (1): _expo/static/js/ios/index-….hbc (1.4MB)
Exported: …/dist-ios          exit=0
```

`bun install`, which is how the host gets resolved at all:

```
$ PATH=/usr/bin:/bin BUN_BE_BUN=1 <tao-binary> install --no-save
498 packages installed [3.14s]
```

So the compiled `tao` binary is a complete JavaScript toolchain: it can install the Expo host, serve
it through Metro, and export a Hermes bundle, on a machine with nothing else on it. **This is the
finding the whole design rests on.**

One caveat about the flag. The repository runs `bunx expo start` today. With no Node on `PATH`, bun
uses itself; with a Node on `PATH` it may honour the `#!/usr/bin/env node` shebang of
`node_modules/.bin/expo` instead. Pass `--bun` explicitly so the behaviour does not depend on the
user's machine.

**Jest does not run under bun.** `tao test` currently resolves Node explicitly
(`TAO_TEST_NODE_PATH` → `.devenv/profile/bin/node` → `node` on `PATH`) and runs Jest with
`jest.tao-test.config.cjs`. Its Jest lookup is `<runtimeRoot>/node_modules/jest/bin/jest.js` falling
back to `../../node_modules/jest/bin/jest.js` — the hoisted workspace root, which under
`~/.tao/versions/<v>/host` escapes the version directory and has to go. Pointing the runner at the
compiled binary:

```
$ BUN_BE_BUN=1 TAO_TEST_NODE_PATH=<tao-binary> ./tao test Apps/Starters/Notebook
● Tao test command › Notebook.test.tao
  Must use import to load ES Module: …/@noble/ciphers/chacha.js
    at requireModule (…/jest-runtime/build/index.js:850:24)
    at require (…/TaoRuntime-src/TR-studio-device-trust.ts:9:1)
    …
Test Suites: 1 failed, 1 total
```

The same run under Node passes (`1 passed`). The same failure appears with plain `bun` as the
runner, so this is bun's node compatibility in `jest-runtime`, not the compiled binary: Node 24
supports `require(esm)`, bun's Jest path does not. `@noble/ciphers`, `@noble/curves`, and
`@noble/hashes` reach the Jest graph through `TR.ts` → `TR-studio-device-host` →
`TR-studio-device-client` → `TR-studio-device-trust`.

A separate Node is therefore needed **only** for `tao test`, and only until that graph or that
harness changes. Nothing else in the toolchain needs one.

### F6 — The Expo host: measured, and why it is not an archive

The host is `packages/apps/expo-host`'s dependency closure. Installed clean into a scratch
directory, with the workspace dependencies removed:

| Measure                                                                     | Value                   |
| --------------------------------------------------------------------------- | ----------------------- |
| Packages                                                                    | 507                     |
| Installed size                                                              | **355 MB**              |
| Files                                                                       | **26,962**              |
| `tar.gz -6`, as installed                                                   | 113 MB                  |
| `tar.gz -6`, other-platform binaries and native `android`/`ios` dirs pruned | 91 MB                   |
| `tar.zst -19`, other-platform binaries pruned                               | **74 MB**               |
| Cold `bun install` from the registry (no cache)                             | **8.1 s**, 499 packages |
| Warm `bun install`                                                          | 1.9–3.1 s               |

Three installs of that one `package.json` reported 507, 499, and 498 packages. Treat the closure as
**roughly 500 packages**; the sizes above were measured on the 507-package install, and I did not
chase where the other two differ.

**Re-measured 2026-09-22 and materially larger.** A clean install of the same `package.json` now
resolves **744 packages, 398 MB, 39,917 files**. The table above is kept as the original measurement;
the current figures are these. Two of those packages are release-build tooling the dev loop never
touches — `hermes-compiler` (48 MB) and `fb-dotslash` (9.1 MB) — because `expo start` serves plain
JavaScript and the on-device Hermes parses it, so a dev-only host would be roughly 341 MB. That is
this plan's uncertainty 7 answered with a number. Copying the installed tree takes 5.05 s and
deleting it 1.43 s.

Largest entries: `hermes-compiler` 48 MB, `@expo` 35 MB, `expo-modules-core` 34 MB, `react-native`
31 MB, `@react-native` 29 MB, `react-devtools-core` 17 MB, `@babel` 15 MB, `fb-dotslash` 9.1 MB,
`lightningcss-darwin-arm64` 8.2 MB.

Two of those decide the shape:

- `lightningcss-darwin-arm64` is an optional dependency **selected at install time by platform**.
  There is no one closure that serves macOS, Linux, and Windows.
- `hermes-compiler` ships `osx-bin` (8.5 MB), `linux64-bin` (4.2 MB), and `win64-bin` (35 MB) —
  40 MB of it is always the wrong platform. `fb-dotslash` ships five platform slices the same way.

So a single cross-platform host archive is wrong, and a per-platform archive is five artifacts of
74–113 MB each that have to be built, hosted, and versioned.

**Recommendation: resolve the host with `bun install` from a Tao-pinned lockfile, run by the Tao
binary itself** (verified in F5: 498 packages, no Node, no Bun, no npm on the machine). Embed the
lockfile so resolution is exact and reproducible; install once into
`~/.tao/versions/<version>/host` and share it across every project on the machine. Eight seconds
cold, and platform selection is handled by the package manager instead of by us.

Keep a per-platform mirrored archive as the offline fallback and as insurance against a registry
outage — but as the second path, not the first.

### F7 — What is macOS-only, and what is simply not portable yet

Genuinely macOS-only, and correctly guarded already:

- `sips` in `creation-brief.ts`. `paletteFromImage` returns `undefined` when
  `process.platform !== 'darwin'`, so an image in the description contributes no palette elsewhere
  rather than failing. On macOS it is stricter: a non-zero `sips` exit or a missing bitmap throws
  `HostEnvironmentError`. Replacing it is a small pure-TypeScript job — the BMP decoder
  (`paletteFromBmp`) is already ours and platform-free; only the decode-to-BMP step is `sips`.
- The Apple Foundation Models lane. `creation-lanes.ts` offers it only when
  `platform === 'darwin' && arch === 'arm64'` **and** `Repo.tryGetRoot()` finds
  `packages/ai/generation/generation-native/AppleFoundationModelsServer.swift`, so it silently
  disappears outside a checkout — the CLI never tries to compile Swift it does not have.
  `Docs/Roadmap/Tao create.md` already names the follow-up: _"`tao create` outside a repository
  checkout: the Apple lane compiles its Swift helper from source, so a shipped CLI needs a
  prebuilt, signed helper."_ That helper is a signed, notarized Mach-O shipped in the macOS
  resource payload; it needs the Developer ID certificate, and so is late in the sequence, not a
  blocker.
- Everything `xcrun`: `simctl` (Simulator boot and deep links), `devicectl` (physical devices),
  `stapler` (release validation), and `tao ship` end to end.

Not macOS-only, but broken on Windows or outside a checkout:

- `CLI.commandPath` runs `which`, falling back to `sh -c 'command -v "$1"'`. `commandOnPath` in
  `creation-lanes.ts` splits `PATH` on `:` and checks for an extensionless file. Both give wrong
  answers on Windows — wrong separator, no `PATHEXT`, no `.exe`/`.cmd`.
- `Ports` shells out to `lsof` for port diagnostics and kill advice: macOS and Linux only.
- `TaoAppModules.ensureProject` creates `node_modules/@tao/runtime` with `FS.replaceSymlink`. On
  Windows a symlink needs Developer Mode or elevation; a directory junction or a copy is portable.
- `EXPO_START_ENV` sets `BROWSER: 'Google Chrome'` with `OPEN_MATCH_HOST_ONLY`, which is macOS
  `open -a` semantics.
- `Repo.getRoot()` shells out to `git rev-parse --show-toplevel` and throws
  `HostEnvironmentError` outside a worktree. On the `tao dev` path it decides the Expo home
  (`.artifacts/cache/expo`), the Expo log path, the runtime-toolchain root, the dev-data root, and
  the Expo Go APK cache.
- The dev loop calls `just --justfile <repo>/Justfile`, `bun run <repo>/packages/cli/dev-cli/dev-cli-src/dev.ts`,
  and `Repo.resolvePath('tao')`; `DevFileWatcher` watches thirteen repository-root paths beside the
  project root it already watches. This is the repository's own loop, reused by `tao dev`.
  Separating the shipped loop from the repository loop is the largest single piece of work in this
  item, and it is not an OS problem.
- `tao review` launches Chrome over CDP, so it needs a browser on the host. It is not optional
  today: `tao-cli.ts` reaches it through `await import('tao-studio-tooling/studio-review')`, which
  pulls Studio, the CDP client, and the rest of the `packages/ides/studio-tooling` graph into the
  binary already measured at 67.8 MB. Leaving it out of a release is a bundling change, not a flag.
- Android needs a JDK, the SDK, and an emulator image — `A8`'s requirement graph.

Honest platform claim for `R4`: **`create`, `check`, `fmt`, `fix`, `compile`, `test`, and the web
`dev` lane everywhere; iOS on macOS only; Android everywhere once `A8` lands.**

### F8 — Binaries build for every target from one macOS machine

With Bun 1.4.2, cross-compiling `packages/cli/tao-cli/cli-src/tao-cli.ts`:

| Target             | Size    | gzip    | Build |
| ------------------ | ------- | ------- | ----- |
| `bun-darwin-arm64` | 67.8 MB | 26.7 MB | 70 ms |
| `bun-darwin-x64`   | 74.9 MB | —       | 1.3 s |
| `bun-linux-arm64`  | 86.8 MB | —       | 1.7 s |
| `bun-linux-x64`    | 86.8 MB | 37.6 MB | 2.0 s |
| `bun-windows-x64`  | 91.6 MB | 40.8 MB | 2.0 s |

All five build from one macOS host (Bun downloads the target runtime once). CI needs a macOS runner
for signing and notarization and a Windows runner for Authenticode, but not for compilation.

## Recommended design

### One binary, one Tao home

```
~/.local/share/tao/                ($TAO_HOME overrides; honours XDG_DATA_HOME)
  bin/tao                          the shim, symlinked onto PATH by the installer
  versions/<tao-version>/
    tao                            the compiled binary for this version
    resources -> .resources-<hash>/  unpacked on first run, ~4 MB; .tao-resources stamp written last
      stdlib/@tao/**, Project.tao  .tao sources, .ts sidecars, and the stdlib's project identity
      modules/@tao/runtime/        TaoRuntime-src + package.json
      host/                        runtime-toolchain files, no node_modules
      apple/tao-foundation-models-server   (macOS payload only, later)
    host/node_modules/             resolved once per version, shared by every project
    node/                          the managed Node this version downloads for `tao test`
  hosts/<version>-<kit>/<platform>/  prebuilt Companion hosts `tao dev` downloads (`A9`)
  cache/                           bun install cache, Expo home, downloads
```

### One resource root

Introduce a single `TaoResources` seam and route every dir-relative anchor through it, resolving in
order:

1. `TAO_RESOURCES` / `TAO_HOME` environment override (keeps the existing `TAO_STDLIB_ROOT`,
   `TAO_TEST_RUNTIME_ROOT`, `TAO_TEST_NODE_PATH`, and `TAO_TEST_JEST_PATH` contract working);
2. `<dirname(process.execPath)>/../resources` — the installed layout;
3. the in-repo sibling layout — so `./tao` and every test keep working unchanged.

Call sites to convert: the module-level `CLI_PACKAGE_ROOT` in `app-modules.ts`, `Stdlib.rootPath`,
`RuntimeToolchainPaths.packageRoot`, and `StudioHighlight`'s `Repo.resolvePath` of the TextMate
grammar. `process.execPath` is correct inside a compiled binary (F1), which is what makes this work.

Build the seam beside `packages/shared/shared-src/TaoStdlib.ts` rather than next to any one reader.
That module already owns `TAO_STDLIB_ROOT` for exactly this reason — two memoizing schemes that
cannot reach each other both have to answer for a redirected stdlib — and it establishes the two
rules a resource root inherits: the declared value must be absolute, and it is part of the identity
that `tao test` and the repository build key their compiled output on. A resource root that moves
without changing that identity silently reuses a compile against a different stdlib.
`TAO_TEST_NODE_MODULES_ROOT` in `jest.shared.config.cjs` is the same idea already applied to the
host's dependency root, and is what lets a versioned host work without a config rewrite.

Unpack on first use of a version, into `versions/<v>/resources`, behind a completion stamp so a
half-written unpack is never read. Verify after unpacking rather than trusting it — F2 shows a
missing stdlib is invisible to `check`.

### The Expo host, per version and shared

Embed the host `package.json` and `bun.lock`. On the first command that needs a host, run
`BUN_BE_BUN=1` `bun install --frozen-lockfile` into `~/.tao/versions/<v>/host` using
`~/.tao/cache` as the package cache. Every project on the machine shares that one install; only the
generated app and the Metro cache are per project.

This replaces `packages/apps/expo-host/_gen_tao-app` as the single global output directory. A
per-project generated root is required anyway — two `tao dev` sessions in different projects
currently write to the same place.

### Metro and Expo driven by the binary

`BUN_BE_BUN=1 <self> x --bun expo …`, with `process.execPath` as the executable, replacing the
`bunx` launcher in `ExpoServer`. Expo's home, log path, and dev-data root move from
`Repo.resolvePath(...)` to `~/.tao` and the project root. `DevFileWatcher`'s repository watch list
becomes the project's own source tree when the loop is running outside a checkout.

`tao test` keeps its explicit runner resolution and gains a managed Node for the first release. A
harness change can remove that dependency later. Everything else runs in-process or through the
binary.

### Distribution

These are the channels evaluated by the survey. Only the install script for macOS arm64 is in the
first public release; Homebrew, npm, and other platforms are later possibilities.

- **Install script.** `curl -fsSL https://<host>/install.sh | sh` detects platform and
  architecture, downloads `tao-<version>-<target>`, verifies a published SHA-256, installs the shim
  into `~/.tao/bin`, and prints the `PATH` line. A PowerShell twin would be needed for Windows later.
- **Homebrew tap.** `taolang/homebrew-tao` with a formula that installs the prebuilt binary per
  platform. The Developer creates the tap repository.
- **npm wrapper.** `tao` with `optionalDependencies` on `@tao-lang/cli-darwin-arm64`,
  `-darwin-x64`, `-linux-x64`, `-linux-arm64`, `-win32-x64`, each containing only its binary, plus a
  `bin/tao.js` that execs the resolved one. This is the esbuild/swc pattern and is the cheapest
  route to `npx tao`. Note that all twenty packages are `private: true` today; what gets published
  is a deliberately curated set, not a flag flip, and it is gated on the license (`R1`).
- **macOS.** Developer ID Application certificate, `codesign --options runtime`,
  `notarytool submit --wait`, staple. Verified that a Bun 1.4.2 binary survives hardened-runtime
  re-signing and still runs `tao check` (F3).
- **Windows.** Authenticode with an EV or Azure Trusted Signing certificate; without one SmartScreen
  blocks the download. Signing a Bun-compiled `.exe` with an appended payload is **untested** — see
  Uncertainties.

### The per-project version pin

`.tao-project/lock.jsonc` is already the one Tao-written envelope, with `schemaVersion: 1` and
independent `installs` and `ship` concerns that each side preserves without interpreting. Add a
third:

```jsonc
{
  "schemaVersion": 1,
  "toolchain": { "version": "0.4.2" }
}
```

`~/.tao/bin/tao` is a shim, not the toolchain. On each invocation it walks up from the working
directory for `.tao-project/lock.jsonc`, reads `toolchain.version`, and execs
`~/.tao/versions/<version>/tao`. The pin is exact, and the shim asks before downloading a missing
version. `TAO_VERSION` overrides the pin; `tao +0.4.1 <command>` is the explicit form. A project
with no pin uses the installed default, and `tao create` writes the pin it used.

This is rustup's model with the toolchain declaration inside the lock Tao already owns, rather than
a second file beside it. The shim has to stay fast enough that the exec is invisible; the 66 ms
measured in F1 is the whole binary, and a shim path that reads one file and execs will be well under
that.

## Slice sequence

Each slice ends somewhere honest — a thing that works, not a refactor that compiles.

**1. A binary that builds and runs.** Bump the devenv Bun to ≥ 1.4.2 with a dedicated
`bun.package` pin so the other toolchain packages stay fixed, and verify the existing suites
against it (F3). Add a build entry point that runs `_parser-gen` and then `bun build --compile`
for the host platform. Done when `tao --help`, `tao fmt`, and `tao check` run from the binary
outside any checkout on a self-contained Tao project. A project created by `tao create` needs the
runtime module installed on disk, so its acceptance belongs to slice 2.

**2. One resource root.** The `TaoResources` seam, the three anchors plus the grammar path, the
embedded resource payload, and the unpack-with-verification. Fills
`packages/cli/tao-cli/modules/@tao/` through the existing `TaoAppModules.packageRuntime`, closing
`DEVENV-058` — and it must copy rather than link, because `DEVENV-057` records that a directory
symlink at exactly that path makes `GreenTree.hashTree` exit 128 before any gate runs. Done when
`tao create --ai none --yes --skip-tests` completes and `tao compile` produces a generated app
from the binary, outside a checkout.

_Landed 2026-09-22._ `just standalone-cli-acceptance` builds the binary, copies it outside any
checkout, and runs `create`, `check`, and `compile` with `PATH=/usr/bin:/bin`. Where it departs
from the text above:

- The payload is one gzipped tar, `tao-resources.tgz`, embedded as a compile entrypoint and found
  through `Bun.embeddedFiles`. A separate entry, `tao-standalone.ts`, unpacks it beside the binary
  before importing the CLI, because the anchors resolve as their modules load. The stamp holds the
  payload's hash, so a binary rebuilt in place replaces the older tree. `resources` is a symlink
  onto `.resources-<hash>`, because a directory cannot be renamed over a non-empty one: replacing a
  real directory leaves a moment with no `resources` at all, and a concurrent first run that probed
  then fell back to `/$bunfs`. The gate caught this under load. Warm startup is 70–90 ms; a first
  run including the unpack is 0.8 s.
- The runtime goes to `resources/modules/@tao/runtime`, and the resource root stands in for the CLI
  package root. The checkout's `packages/cli/tao-cli/modules/@tao/` stays empty.
- The payload copies each package's files that Git does not ignore, not the curated list in F4:
  the whole stdlib `@tao/` tree plus `Project.tao`, which gives stdlib declarations their project
  identity (`compile` fails without it), and every visible Expo host file. That is 261 files and
  2.4 MB compressed.
- The grammar path is not converted. Its only reader is `tao review`, which slice 9 removes from
  the binary; if `tao review` comes back, the grammar joins the payload then.
- `tao compile` writes to `resources/host/_gen_tao-app` until slice 3 gives each project its own
  generated app root.
- Found on the way: a compiled bundle gives every module the entry's runtime `import.meta`, so
  `tao-cli.ts` passing `import.meta` to a helper saw `main === true` and ran the CLI a second
  time. Reading `import.meta.main` directly is rewritten per module.

**3. A Tao home and a versioned host.** The `~/.tao` layout, the embedded host lockfile,
`bun install` through the binary into `versions/<v>/host`, and a per-project generated app root
replacing `packages/apps/expo-host/_gen_tao-app`. Done when two projects compile against one
shared host install.

_Built 2026-09-24, not yet landed._ `just standalone-cli-acceptance` now installs a release
through `curl | sh` into a throwaway home and runs `tao build --web` in two created projects, from
the binary, with only system tools on `PATH`: the first build installs the host, the second reuses
it. The whole run takes about 25 s.

- `TaoHome` in `@shared` resolves the one home: `TAO_HOME`, else `$XDG_DATA_HOME/tao`, else
  `~/.local/share/tao`, reading `$HOME` as the install script does. The Companion's downloaded
  hosts move from `~/.tao/hosts` to its `hosts/`.
- The per-project generated root already exists on `main`: `tao build --compile-only` writes under
  the project's `.tao/builds/`, and `tao dev` under `.tao/dev/runtime`. Only the retiring
  `tao compile` still writes into the host, into the installed version's `resources/host/`.
- The release build rewrites the staged host so it installs outside the repository (below), adds
  `@shared/core` to the payload, and resolves the host's `bun.lock` once per release.
- `HostDependencies.ensure` installs the host's packages beside the resource root, in
  `versions/<v>/host/node_modules`, on the first command that needs them, with the package cache in
  the Tao home. It asks a terminal first (decision 6). **Needs the Developer's confirmation:** a run
  with no terminal is refused with a message unless `TAO_HOST_INSTALL=yes` approves the download
  ahead of time, a name and behaviour chosen here, not decided.
- `metro.config.cjs` takes `TAO_HOST_DEPENDENCY_ROOT`, `TAO_RUNTIME_SOURCE_ROOT`, and
  `TAO_SHARED_CORE_SOURCE_ROOT` in place of its three repository climbs, which stay the defaults, so
  the repository's own loop is unchanged; `RuntimeToolchainPaths.expoEnvironment` supplies them.
  `tao build --web` and `--desktop` use them, and run Expo under the binary. `tao dev` (slice 4) and
  `tao test`'s Jest configuration (slice 5) do not yet.

The prototype that settled the shape, on 2026-09-24, in a scratch directory outside the repository
with only the compiled binary on `PATH`: `expo export --platform web` bundled a created project's
app (576 modules, 1.3 MB) in 4 s. What it took, each now implemented:

- **No workspace packages in the installed manifest.** Of the host's five `workspace:*`
  dependencies, `tao-instantdb` and `tao-compiler` are never reached from the host, `tao-runtime`
  and `tao-shared` are reached by path rather than by name (`metro.config.cjs:8-12`,
  `jest.shared.config.cjs:47-53`), and `tao-icloud` is an Expo config plugin that only iCloud
  release builds name (`app-config.cjs:37`). The prototype dropped all five and pinned the 32
  remaining dependencies to the versions the repository has installed; `BUN_BE_BUN=1 tao install`
  then resolved 741 packages, 388 MB, in 12 s from a warm cache, and wrote the `bun.lock` a release
  would embed. Transitive versions are resolved at release time rather than copied from the
  repository's lock, so they can drift from what the repository tests.
- **Expo through `--bun` on its script, not `x --bun`.** In the compiled binary, `BUN_BE_BUN=1 tao x
  --bun expo` and `tao --bun x expo` both still run the script's `#!/usr/bin/env node` and fail with
  `env: node: No such file or directory`; `BUN_BE_BUN=1 tao --bun <host>/node_modules/.bin/expo`
  runs it under the binary. F5's record of `x --bun` working is therefore not reproducible with
  this layout.
- **A self-contained `tsconfig.json`.** The host's extends `../../tsconfig.base.json`; outside the
  repository Expo's TypeScript resolver fails on it with Metro's `Invariant Violation: Failed to
  collapse`, even with the file copied into place. Inlining the base's compiler options, without
  its repository `paths`, fixed it.
- **The runtime and `@shared/core` sources where the Metro config looks.** The config climbs
  `../runtime/TaoRuntime-src`, `../../shared/shared-src/core`, and `../../../node_modules` from the
  host. The stdlib's data-provider sidecars import `@shared/core`, which the payload did not carry.
  The prototype recreated the repository's shape; the implementation names each location instead.

Jest (`tao test`), the dev server, and native targets were not exercised. `tao-icloud`, which an
iCloud release build names as a config plugin, is not in the installed host, so `tao ship` of an
iCloud-backed app from the binary will not find it; that belongs with shipping from the binary.

**4. A shipped dev loop.** Cut `@expo-host/dev-loop` free of `Repo.getRoot()`, `just`,
`bun run dev.ts`, and `Repo.resolvePath('tao')`; drive Expo with `x --bun` through
`process.execPath`; re-anchor the four repository-relative values `expo-config.ts` and
`expo-server.ts` hand Expo — `__UNSAFE_EXPO_HOME_DIRECTORY`, `EXPO_LOG_PATH`,
`RUNTIME_TOOLCHAIN_PATH`, and the dev-data root — on `~/.tao` and the project. Done when
`tao dev` runs a created project on web and on the iOS Simulator from a binary on a machine with no
checkout. This is the biggest slice; it may need splitting once the seam is drawn.

**5. `tao test` off the checkout.** Resolve the managed Node runner per Tao version, remove the
`.devenv/profile/bin` fallbacks in `test-command.ts` and `test-compiler/Worker.ts`, and make
`tao create`'s post-create test run work outside the repository. Done when `tao create` without
`--skip-tests` finishes green on a clean machine.

**6. Cross-platform correctness (later).** Windows-aware `commandPath`/`commandOnPath`, junction-or-copy
instead of symlink, `lsof`-free port diagnostics, platform-correct browser opening, and a Linux and
Windows CI lane running `create`, `check`, `fmt`, `compile`, `test`, and the web `dev` lane.

**7. Release engineering.** For the first release, build macOS arm64, publish its checksum and
version index with the binary on GitHub Releases in the public repository, sign and notarize it,
and publish the install script. Later releases may add the other four targets, Windows signing,
Homebrew, and an npm wrapper with per-platform optional dependencies.

_Landed 2026-09-23, unpublished._ `just standalone-cli-release 0.4.0` writes one release's files to
`.artifacts/release/v0.4.0/` and prints the `gh release create` command; publishing waits on the
public repository. What it settled:

- The binary ships gzipped as `tao-darwin-arm64.gz` (28 MB, from 67 MB), beside its `.sha256`, the
  install script, `release.json` (version, commit, and each target's asset and hash), and draft
  notes. The installer finds them under the release's `vVERSION` tag.
- `tao --version` prints the version the release build stamps in with `--define`, or `development`
  from source. The install script selects a stable CLI release from the published release listing,
  confirms the downloaded binary reports that version, and unpacks its resources inside the
  version's own directory before it is renamed into place.
- The install script puts the binary in `versions/<version>/`, points `bin/tao` at it until slice
  8's shim replaces that link, and links `tao` into the first writable directory under `$HOME` on
  `PATH` that does not hold another `tao`, printing the `PATH` line only when there is none.
  `TAO_VERSION` pins a release, `TAO_HOME` relocates everything, and `TAO_RELEASES` points at another
  copy of the releases.
- `curl` sets no `com.apple.quarantine`, only `com.apple.provenance`, which Gatekeeper does not act
  on, so an unsigned binary fetched by the install script runs without a Gatekeeper prompt. Signing
  still matters for a binary someone downloads with a browser.
- `standalone-install.test.ts` covers the install script in the ordinary suite with a stand-in
  binary. `just standalone-cli-acceptance` installs a real release through `curl | sh` into a
  throwaway `$HOME` and runs `create`, `check`, and `compile` from `PATH`. It stays a recipe rather
  than a suite test while the lanes on this machine run Bun 1.3.13 (see
  `DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN`), because a binary that Bun builds is killed
  on launch.
- The release notes list what the binary cannot do yet from `KNOWN_GAPS` in `standalone-build.ts`,
  which later slices shorten as they land.

**8. The version pin and the shim.** `toolchain` in `.tao-project/lock.jsonc`, the shim's
resolve-and-exec, `tao install <version>`, `tao update`, and `tao create` writing the pin.

**9. The macOS payload and the remaining gaps.** The prebuilt, signed Apple Foundation Models helper
(needs the Developer ID certificate), removal of `tao review` and its Studio graph from the first
binary, and an honest statement of whatever is still absent. `tao review` may return later.

Slices 1–5, first-release parts of 7–9, and the macOS payload are the standalone release path.
Slice 6 and the other-platform and other-channel parts of 7 wait for later releases. Work can
overlap with `A3` and `A8`.

## Uncertain, and how to settle it

1. **Can Jest run under bun once the ESM-only dependencies leave its graph?** Try a
   `moduleNameMapper` or transform for `@noble/*` in `jest.tao-test.config.cjs`, or break
   `TR-studio-device-*` out of `TR.ts`'s eager graph, and re-run
   `tao test Apps/Starters/Notebook` with the binary as the runner. A day's work and it removes the
   managed Node entirely.
2. **Is a `bun install`-resolved host reproducible enough for `tao ship`?** `ship-fingerprints`
   hashes the runtime. Settle by installing the same lockfile twice on different machines and
   comparing the fingerprint.
3. **Does Windows Authenticode signing survive Bun's appended payload?** Untested — no Windows host
   and no certificate here. Settle on a Windows runner once a certificate exists. If it does
   not, the fallback is an MSI or a `.zip` with an unsigned binary and a documented SmartScreen
   warning, which is a materially worse first impression.
4. **Does `expo start` need `typescript` resolvable from the project root?** `DEVENV-064` records
   that it does for the Studio preview. The probe host here had no `typescript` and bundled fine.
   Settle by adding it to the host lockfile and running `tao dev` on a project outside the
   repository.
5. **Do hardened-runtime entitlements need `com.apple.security.cs.allow-jit`?** `tao check` ran
   clean under `--options runtime` with no entitlements (F3). Re-verify with `tao dev` and a
   genuinely notarized build, since Metro exercises far more of the JIT.
6. **Linux and Windows behaviour is entirely unmeasured.** Everything above was verified on macOS
   arm64. Slice 6's CI lane is the first real evidence.
7. **How much of the 355 MB host is actually needed?** `react-devtools-core` (17 MB) and the
   other-platform `hermesc` slices (40 MB) are candidates, but pruning a `bun install` result fights
   the package manager. Worth measuring only if first-run time becomes a complaint.

## First-public-release decisions

The Developer settled the plan's eight questions on 2026-09-22. `Developer MVP Roadmap.md` owns the product decisions;
this list makes their effect on the implementation sequence explicit.

1. Ship `tao test` with a managed Node; consider a Node-free harness after the first release.
2. Install the Expo host from a pinned lockfile on first use. Registry access is required.
3. Release the macOS arm64 target only. Linux, Windows, and Intel Mac support come later.
4. Pin an exact per-project Tao version and ask before downloading a missing version.
5. Distribute through an install script only. Homebrew and npm wrappers come later.
6. Do not publish an npm CLI wrapper in the first release. The final app-safe licence structure for
   the repository and any future public packages must be settled before public publication (`R1`).
7. Host release binaries, checksums, and the version index on GitHub Releases in the public repo.
   App OTA updates are separate and deferred from the first release (`R11`).
8. Leave `tao review` out of the first binary. Its dynamic import pulls in the Studio graph today,
   so this choice requires a packaging change rather than only hiding the command (`R12`).

## Implementation decisions, 2026-09-22

Settled in the dialogue that opened the implementation. These refine the first-release decisions
above; where the two disagree, these are later and win.

1. **Slice order** is 2 → 7 → 3 → 4 → 5 → 8 → 9, each its own landing. Release engineering runs
   second so an installable artifact exists early. Slice 6 leaves the first release under `R4`.
2. **One root, out of sight**: `~/.local/share/tao/{bin,versions,cache}`, honouring
   `XDG_DATA_HOME`, with `TAO_HOME` relocating all of it. A project's generated state stays
   project-local under `.tao/`, as `Decisions - Development build ship and clean.md` already
   implemented, so the `projects/<project-id>/` entry this plan proposed is withdrawn.
3. **Toolchain commands**: `tao check-for-updates` is the only public verb. A missing pinned
   version is fetched by the shim, which asks first. There is no public `tao install` — that name
   is already the package installer.
4. **The first release is `0.4.0`**, semver, tagged `v0.4.0`, published unsigned and labelled as
   needing later slices for `dev` and `test`. Signing and notarization follow on the Developer's machine once
   the Developer ID certificate exists.
5. **The install script** is served from the public repository's Releases. It detects whichever
   user-writable bin directory is already on `PATH`, symlinks the shim there, and prints the `PATH`
   line only when there is none. It lists published GitHub releases, ignores drafts, prereleases,
   and non-CLI tags, chooses the highest stable `vVERSION` tag by semantic version, and downloads
   the binary and checksum by that tag. CLI releases use `--latest=false` so Studio's fixed update
   URL can keep using the repository's `latest` release.
6. **The first host install** asks permission before downloading, then shows a progress line naming
   the one-time cost.
7. **A pinned version that is not installed** asks when interactive, and when not, fails naming the
   exact command to run.
8. **The on-device AI lane** ships absent; `tao create` names the lanes it has and says the
   on-device one arrives in a later release.
9. **Dependencies take the simplest shape that works**: `bun install` from the embedded lockfile
   into the version's own `host/`, and a Node tarball from nodejs.org verified against its published
   `SHASUMS256.txt` into the version's own `node/`. Everything a version owns lives under that
   version, so removing a version removes all of it with no sharing and no refcounting. One complete
   host, not a dev/release split.
10. **Clean-machine acceptance** runs in three tiers: a throwaway `$HOME` with a scrubbed `PATH`
    inside the ordinary test suite, a local `tart` virtual machine as the gate before publication,
    and the `macos-26` GitHub runner as a regression gate once the public repository exists.

## Deferred approaches worth revisiting

Investigated during that dialogue and rejected for the first release. Recorded so they are not
re-derived from scratch.

- **Ship the host as a read-only disk image** instead of resolving it with `bun install`. `R4`
  reduces the target set to one platform, which removes `F6`'s objection that per-platform archives
  mean five artifacts to build, host and version. It would make every user's host bit-identical,
  which also dissolves uncertainty 2, remove the registry from first run, and replace 39,917 files
  with one. **Blocker, measured**: Watchman's cookie protocol writes a marker inside each watched
  root, so the `since`-relative query Metro issues on every rebuild fails on a read-only tree with
  `synchronization failed: root dir was removed or is inaccessible`, and the watch is then silently
  dropped. It bites only because `metro.config.cjs` watches `node_modules` itself, and it does that
  because of Bun's symlink farm and phantom-dependency store — an image we lay out ourselves could
  ship a flat real tree and remove the reason. Metro's transform cache, Jest's cache and the
  file-map cache already default outside `node_modules`, and no package in the set has a
  `postinstall` writing into it, so Watchman was the only writer found. **Measured 2026-09-23**
  (`.artifacts/tmp/host-image-measurement.sh`, run unsandboxed on a loaded machine): the 397 MB,
  39,917-file tree becomes a **309 MB** UDZO/APFS image in 36 s, a build-time cost only; it mounts
  read-only in **3 s**; one `require.resolve('metro')` from a fresh process takes 35–41 ms from the
  plain tree and 41–62 ms from the mount, mostly process startup. What the image clearly wins is
  lifecycle: copying the tree took 40 s and deleting it 6 s, against effectively zero for the one
  file. Still unmeasured, and the number that would decide it: Metro's full crawl and hashing of
  the host from a mount. macOS now warns that `hdiutil attach -nobrowse -readonly` is deprecated in
  favour of `diskutil image attach`.
- **Embed Metro and the Expo CLI and run them in-process.** Technically real — Metro exposes
  `runMetro`, `runServer` and `loadConfig`, and both of its worker pools have in-band modes, so
  `maxWorkers: 1` avoids the `jest-worker` fork that would otherwise relaunch the Tao binary as its
  own transform worker. It does not pay: Metro's own code is about 5 MB, and the bulk of the host is
  the app dependency graph Metro must read, hash and watch off a real disk.
  `resolver.resolveRequest` returns paths the file map then stats and hashes, so a path into
  `/$bunfs` fails at the hash step rather than the resolve step. Embeddable tooling is about 29 MB,
  since `hermes-compiler`, `fb-dotslash` and `lightningcss` are native binaries. Estimated cost was
  four to eight engineering weeks plus per-React-Native-release maintenance, a version lock between
  the Tao binary and the app's React Native, and cold bundles serialised to one core. **The
  measurement that would overturn it**: trace how much of the app-side closure Metro actually opens
  during one `expo export`. If that set is small, a curated real tree plus embedded tooling becomes
  a different proposition.
- **A dev-only host** of roughly 341 MB, with Hermes and `fb-dotslash` fetched on the first
  `tao build` or `tao ship`.
- **One runtime instead of two.** The first release ships Bun inside the binary and downloads a
  managed Node, but the second runtime exists for exactly one reason: `F5` measured that Metro and
  the Expo CLI run under the compiled binary with no Node on the machine, and Jest does not. So the
  reduction to run is to _remove Node_, not to remove Bun — Bun is already inside the binary, while
  Node is the add-on. Two routes: make Jest run under Bun, which uncertainty 1 puts at about a day's
  work once the ESM-only dependencies leave its graph, or move `tao test` off Jest onto Bun's own
  test runner, which is larger but ends with nothing to download for tests at all. Going the other
  way — a Node-only CLI — would mean giving up `bun build --compile` for Node's less mature
  single-executable support, a slower start than the 66 ms `F1` measured, and the `x --bun expo`
  path that drives Metro today.
- **A third-party Node version manager** — `fnm`, `volta`, `mise`. Each is another thing the user
  must install, which is the promise `A2` exists to keep, and each manages a namespace the user's
  own shell manipulates, so a stray `nvm use` or an inherited `.nvmrc` would change what Tao
  resolves. `nvm` is disqualified outright: it is a shell function, not a binary.

## Notes for whoever implements this

- A fresh worktree has no `packages/language/parser/parser-src/_gen_tao-parser`, and every Tao command fails
  with a bare `Something went wrong.` until `just _parser-gen` runs. The build entry point in slice 1
  must generate before it compiles, and the diagnostic is worth fixing under `A1`.
- Slice 1 pins Bun 1.4.2 through a dedicated `bun-nixpkgs` input and
  `languages.javascript.bun.package`, leaving the other nixpkgs packages on their existing pin.
  A worktree sees the new Bun when its devenv profile is refreshed. The signing failure it fixes is
  `DEVENV-096`.
- The prototypes behind every measurement here were run in `.artifacts/tmp/standalone-proto/` and
  the session scratchpad, and were removed afterwards.
