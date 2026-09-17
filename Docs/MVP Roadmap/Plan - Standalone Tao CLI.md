# Plan - Standalone Tao CLI

The plan for `A2 — A standalone cross-platform tao executable` in `Agent MVP Roadmap.md`. It writes
no code; it records what the toolchain actually reads at runtime, what was measured rather than
assumed, the recommended shape, what is still uncertain, the slice sequence, and the questions that
are Ro's.

Everything under **Findings** was verified on this machine on 2026-09-17 (macOS 27.0, arm64, Bun
1.3.13 pinned) in a scratch directory under `.artifacts/`. Commands and numbers are reproduced
verbatim so a later reader can tell measurement from opinion.

## The problem, stated precisely

- `tao` is a zsh wrapper whose one working line is `exec bun packages/tao-cli/cli-src/tao-cli.ts "$@"`, so it
  needs this checkout, its devenv profile, and zsh.
- All twenty packages under `packages/` carry `"private": true`.
- `tao dev` compiles into `packages/runtime-toolchain/_gen_tao-app` and runs Metro in that package,
  against that package's `node_modules`.
- The dev loop it drives is the _repository's_ dev loop: it calls `just`,
  `bun run packages/dev/dev-src/dev.ts`, and `Repo.resolvePath('tao')`, and anchors Expo's home,
  log path, and the runtime-toolchain root on the **Git worktree root** (`Repo.getRoot()` shells out
  to `git rev-parse --show-toplevel`).

Nobody outside this repository can install Tao, and nothing in the dev loop would work if they did.

## Findings

### F1 — The whole CLI already compiles into one binary, and most of it already works

`bun build --compile packages/tao-cli/cli-src/tao-cli.ts` bundles **1249 modules** with no errors
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

Every measurement below was taken with Bun 1.4.2. **Bumping the pinned Bun to ≥ 1.4.2 is a
precondition for slice 1**, and it is a repository-wide change that has to be verified against the
existing suites, not a local choice for this work.

Re-signing a 1.4.2 binary for notarization works:

```
$ codesign --force --sign - --options runtime tao-bin      # hardened runtime
$ tao-bin check .                                          # still runs, exit 0
```

### F4 — What the CLI reads at runtime, and whether it can be embedded

The rule that decides every row: **anything a child process resolves must be a real file on disk;
everything only the binary itself reads can be embedded.** `/$bunfs` does not exist for `expo`,
Metro, Jest, `tsc`, or the user's editor.

**Embed — only the binary reads these.**

- The CLI's own TypeScript, 1249 modules across `packages/*/…-src`. This is the binary (F1).
- The generated Langium parser, `packages/parser/parser-src/_gen_tao-parser`. Generation must run
  before `--compile`: a fresh worktree has none, and every Tao command then fails with a bare
  `Something went wrong.`
- The dprint TypeScript `plugin.wasm`, which `@dprint/typescript` hands over through `getPath()` and
  `FS.readFile`. Bun embeds it automatically — verified by formatting an inject fence from the
  binary (F1).
- The generated TextMate grammar,
  `packages/ide-extension/…/_gen_syntaxes/tao-lang.tmLanguage.json`, read by Shiki for `tao review`.
  It is embeddable as a text asset once `StudioHighlight` stops resolving it from the Git root.

**Nothing to ship.** The starter plans (`cli-src/create/starter-plans.ts`) and `PROJECT_TSCONFIG`
are TypeScript values, not templates on disk.

**Unpack — a child process has to resolve these.**

- stdlib `@tao/**/*.tao`, 228 KB in 41 files. The Tao package resolver walks the root with
  `FS.isDirectory` and `Repo.directoriesUnder`; there is no directory in `/$bunfs` to walk.
- stdlib `@tao/**/*.ts` sidecars, in the same tree. **Metro** resolves them inside the user's
  project.
- `@tao/runtime` (`packages/runtime/TaoRuntime-src`, 1.3 MB). **Metro** resolves it, and so does the
  project's `tsconfig.json` through the `node_modules/@tao/runtime` link.
- The Expo host files — `package.json`, `app.config.js`, `app-config.cjs`, `metro.config.cjs`,
  `app.json`, `index.ts`, `plugins/`, `assets/`; 3.3 MB without `node_modules`. The **Expo CLI**,
  **Metro**, and **Jest** all read them.

**Never embed.** The Expo host `node_modules`, 355 MB of resolved closure, read by the Expo CLI,
Metro, and Jest. See F6.

Text embedding was verified directly (`import x from '…/Prelude.tao' with { type: 'text' }` returned
2894 bytes from inside a compiled binary), but it buys little: the Tao-owned resources total about
**5 MB**, so one unconditional unpack per version is simpler than two mechanisms and is what the
package resolver and every child process need anyway.

`packages/tao-cli/modules/@tao/` already exists for this, holds only `.gitkeep`, and
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
(`TAO_TEST_NODE_PATH` → `.devenv/profile/bin/node` → `node` on `PATH`) and runs
`node_modules/jest/bin/jest.js` with `jest.tao-test.config.cjs`. Pointing that at the compiled
binary:

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

The host is `packages/runtime-toolchain`'s dependency closure. Installed clean into a scratch
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
  rather than failing. Replacing it is a small pure-TypeScript job — the BMP decoder
  (`paletteFromBmp`) is already ours and platform-free; only the decode-to-BMP step is `sips`.
- The Apple Foundation Models lane. `creation-lanes.ts` offers it only when
  `platform === 'darwin' && arch === 'arm64'` **and** `Repo.tryGetRoot()` finds
  `packages/generation/generation-native/AppleFoundationModelsServer.swift`, so it silently
  disappears outside a checkout — the CLI never tries to compile Swift it does not have.
  `Docs/Roadmap/Tao create.md` already names the follow-up: _"`tao create` outside a repository
  checkout: the Apple lane compiles its Swift helper from source, so a shipped CLI needs a
  prebuilt, signed helper."_ That helper is a signed, notarized Mach-O shipped in the macOS
  resource payload; it needs R2's certificate and so is late in the sequence, not a blocker.
- Everything `xcrun`: `simctl` (Simulator boot and deep links), `devicectl` (physical devices),
  `stapler` (release validation), and `tao ship` end to end.

Not macOS-only, but broken on Windows or outside a checkout:

- `CLI.commandPath` runs `which`, falling back to `sh -c 'command -v "$1"'`. `commandOnPath` in
  `creation-lanes.ts` splits `PATH` on `:` and checks for an extensionless file. Both give wrong
  answers on Windows — wrong separator, no `PATHEXT`, no `.exe`/`.cmd`.
- `Ports` shells out to `lsof` for port diagnostics and kill advice: macOS and Linux only.
- `TaoAppModules.ensureProject` creates `node_modules/@tao/runtime` with `FS.replaceSymlink`. On
  Windows a symlink needs Developer Mode or elevation; a directory junction or a copy is portable.
  `DEVENV-057` separately records that a directory symlink there breaks `GreenTree.hashTree`.
- `EXPO_START_ENV` sets `BROWSER: 'Google Chrome'` with `OPEN_MATCH_HOST_ONLY`, which is macOS
  `open -a` semantics.
- `Repo.getRoot()` shells out to `git rev-parse --show-toplevel` and throws
  `HostEnvironmentError` outside a worktree. On the `tao dev` path it decides the Expo home
  (`.artifacts/cache/expo`), the Expo log path, the runtime-toolchain root, the dev-data root, and
  the Expo Go APK cache.
- The dev loop calls `just --justfile <repo>/Justfile`, `bun run <repo>/packages/dev/dev-src/dev.ts`,
  and `Repo.resolvePath('tao')`; `DevFileWatcher` watches thirteen repository package paths. This is
  the repository's own loop, reused by `tao dev`. Separating the shipped loop from the repository
  loop is the largest single piece of work in this item, and it is not an OS problem.
- `tao review` launches Chrome over CDP, so it needs a browser on the host.
- Android needs a JDK, the SDK, and an emulator image — `A8`'s requirement graph.

Honest platform claim for `R4`: **`create`, `check`, `fmt`, `fix`, `compile`, `test`, and the web
`dev` lane everywhere; iOS on macOS only; Android everywhere once `A8` lands.**

### F8 — Binaries build for every target from one macOS machine

With Bun 1.4.2, cross-compiling `packages/tao-cli/cli-src/tao-cli.ts`:

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
~/.tao/                            ($TAO_HOME overrides)
  bin/tao                          the shim a user puts on PATH
  versions/<tao-version>/
    tao                            the compiled binary for this version
    resources/                     unpacked once, ~5 MB
      stdlib/@tao/**               .tao sources and .ts sidecars
      modules/@tao/runtime/        TaoRuntime-src + package.json
      host/                        runtime-toolchain files, no node_modules
      grammar/tao-lang.tmLanguage.json
      apple/tao-foundation-models-server   (macOS payload only, later)
    host/node_modules/             resolved once per version, shared by every project
    node/                          managed Node for `tao test`, if Ro takes that option
  cache/                           bun install cache, Expo home, downloads
  projects/<project-id>/           per-project generated app and Metro caches
```

### One resource root

Introduce a single `TaoResources` seam and route every dir-relative anchor through it, resolving in
order:

1. `TAO_RESOURCES` / `TAO_HOME` environment override (keeps the existing `TAO_STDLIB_ROOT`,
   `TAO_TEST_RUNTIME_ROOT`, `TAO_TEST_NODE_PATH` contract working);
2. `<dirname(process.execPath)>/../resources` — the installed layout;
3. the in-repo sibling layout — so `./tao` and every test keep working unchanged.

Call sites to convert: `TaoAppModules.CLI_PACKAGE_ROOT`, `Stdlib.rootPath`,
`RuntimeToolchainPaths.packageRoot`, and `StudioHighlight`'s `Repo.resolvePath` of the TextMate
grammar. `process.execPath` is correct inside a compiled binary (F1), which is what makes this work.

Unpack on first use of a version, into `versions/<v>/resources`, behind a completion stamp so a
half-written unpack is never read. Verify after unpacking rather than trusting it — F2 shows a
missing stdlib is invisible to `check`.

### The Expo host, per version and shared

Embed the host `package.json` and `bun.lock`. On the first command that needs a host, run
`BUN_BE_BUN=1` `bun install --frozen-lockfile` into `~/.tao/versions/<v>/host` using
`~/.tao/cache` as the package cache. Every project on the machine shares that one install; only the
generated app and the Metro cache are per project.

This replaces `packages/runtime-toolchain/_gen_tao-app` as the single global output directory. A
per-project generated root is required anyway — two `tao dev` sessions in different projects
currently write to the same place.

### Metro and Expo driven by the binary

`BUN_BE_BUN=1 <self> x --bun expo …`, with `process.execPath` as the executable, replacing the
`bunx` launcher in `ExpoServer`. Expo's home, log path, and dev-data root move from
`Repo.resolvePath(...)` to `~/.tao` and the project root. `DevFileWatcher`'s repository watch list
becomes the project's own source tree when the loop is running outside a checkout.

`tao test` keeps its explicit runner resolution and gains a managed Node (or the harness changes —
question 1 below). Everything else runs in-process or through the binary.

### Distribution

- **Install script.** `curl -fsSL https://<host>/install.sh | sh` detects platform and
  architecture, downloads `tao-<version>-<target>`, verifies a published SHA-256, installs the shim
  into `~/.tao/bin`, and prints the `PATH` line. A PowerShell twin for Windows.
- **Homebrew tap.** `taolang/homebrew-tao` with a formula that installs the prebuilt binary per
  platform. Ro creates the tap repository.
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
`~/.tao/versions/<version>/tao`, fetching that version first if it is missing. `TAO_VERSION`
overrides it; `tao +0.4.1 <command>` is the explicit form. A project with no pin uses the installed
default, and `tao create` writes the pin it used.

This is rustup's model with the toolchain declaration inside the lock Tao already owns, rather than
a second file beside it. The shim has to stay fast enough that the exec is invisible; the 66 ms
measured in F1 is the whole binary, and a shim path that reads one file and execs will be well under
that.

## Slice sequence

Each slice ends somewhere honest — a thing that works, not a refactor that compiles.

**1. A binary that builds and runs.** Bump the pinned Bun to ≥ 1.4.2 and verify the existing suites
against it (F3 — this is the precondition, and it is repository-wide). Add a build entry point that
runs `_parser-gen` and then `bun build --compile` for the host platform. Done when `tao --help`,
`tao fmt`, `tao check`, and `tao create --ai none --yes --skip-tests` run from the binary outside any
checkout — which F1 shows is almost true already.

**2. One resource root.** The `TaoResources` seam, the three anchors plus the grammar path, the
embedded resource payload, and the unpack-with-verification. Fills
`packages/tao-cli/modules/@tao/` through the existing `TaoAppModules.packageRuntime`, closing
`DEVENV-058`. Done when `tao create` completes and `tao compile` produces a generated app from the
binary, outside a checkout.

**3. A Tao home and a versioned host.** The `~/.tao` layout, the embedded host lockfile,
`bun install` through the binary into `versions/<v>/host`, and a per-project generated app root
replacing `packages/runtime-toolchain/_gen_tao-app`. Done when two projects compile against one
shared host install.

**4. A shipped dev loop.** Cut `@expo-dev-loop` free of `Repo.getRoot()`, `just`,
`bun run dev.ts`, and `Repo.resolvePath('tao')`; drive Expo with `x --bun` through
`process.execPath`; move Expo home, logs, and caches under `~/.tao` and the project. Done when
`tao dev` runs a created project on web and on the iOS Simulator from a binary on a machine with no
checkout. This is the biggest slice; it may need splitting once the seam is drawn.

**5. `tao test` off the checkout.** Resolve the runner per Tao version (managed Node, or the harness
change — question 1), remove the `.devenv/profile/bin` fallbacks in `test-command.ts` and
`test-compiler/Worker.ts`, and make `tao create`'s post-create test run work outside the repository.
Done when `tao create` without `--skip-tests` finishes green on a clean machine.

**6. Cross-platform correctness.** Windows-aware `commandPath`/`commandOnPath`, junction-or-copy
instead of symlink, `lsof`-free port diagnostics, platform-correct browser opening, and a Linux and
Windows CI lane running `create`, `check`, `fmt`, `compile`, `test`, and the web `dev` lane.

**7. Release engineering.** Cross-compile all five targets, publish checksums, macOS signing and
notarization, Windows Authenticode, the install script, the Homebrew tap, and the npm wrapper with
per-platform optional dependencies.

**8. The version pin and the shim.** `toolchain` in `.tao-project/lock.jsonc`, the shim's
resolve-and-exec, `tao install <version>`, `tao update`, and `tao create` writing the pin.

**9. The macOS payload and the remaining gaps.** The prebuilt, signed Apple Foundation Models helper
(needs R2's certificate), the `tao review` browser requirement, and an honest statement of whatever
is still absent.

Slices 1–4 are the release-blocking path: they are what `A2`'s _done_ line asks for. Slices 5–9 can
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
   and no certificate here. Settle on a Windows runner once R2 produces a certificate. If it does
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

## Questions that are Ro's

1. **Does `tao test` ship with a managed Node, or does the harness change?** A managed Node per Tao
   version is the fastest path and costs roughly 50 MB per version plus a download step; fixing the
   Jest graph or moving off Jest removes the dependency entirely but is open-ended work.
   _(Recommendation: managed Node for the first release, harness change as the durable answer.)_
2. **Expo host by `bun install` from a pinned lockfile, by per-platform archive, or both?** The
   lockfile needs registry access on first run; the archive needs a host Ro pays for and five
   artifacts per version. _(Recommendation: lockfile first, archive as the offline fallback.)_
3. **Which targets are release targets for the first public release?** Five are buildable today.
   This is `R4`'s platform claim in concrete form.
4. **Is the version pin exact, and may `tao` download a missing version without asking?** rustup
   downloads silently; a language toolchain fetching 90 MB unannounced may not be what you want.
5. **Which distribution channels for the first release?** Install script alone, or script plus
   Homebrew plus npm. Each is a surface to keep working.
6. **Which packages become public npm packages, and under what license?** The npm wrapper publishes
   the toolchain. This is `R1` and `R2` arriving at a concrete list.
7. **Who hosts the release artifacts, the checksums, and the version index?** `R11` already asks a
   version of this for the update service; the same answer probably serves both.
8. **Does the first release include `tao review`?** It needs a local Chrome, which is a real host
   requirement to put in front of a stranger.

## Notes for whoever implements this

- `Docs/MVP Roadmap/` currently exists only on `feat/mvp-public-release-0d2656`. This plan was
  written on its own branch and will land beside `Agent MVP Roadmap.md` and `Ro MVP Roadmap.md`.
- A fresh worktree has no `packages/parser/parser-src/_gen_tao-parser`, and every Tao command fails
  with a bare `Something went wrong.` until `just _parser-gen` runs. The build entry point in slice 1
  must generate before it compiles, and the diagnostic is worth fixing under `A1`.
- Bun 1.3.13's inability to produce a runnable compiled binary on macOS 27 (F3) is a
  developer-environment issue as much as a product one. It is not recorded in
  `Docs/Roadmap/Developer environment upgrades.md` because this task was scoped to change no file
  but this one; it should become a `DEVENV` entry when the Bun bump is done.
- The prototypes behind every measurement here were run in `.artifacts/tmp/standalone-proto/` and
  the session scratchpad, and were removed afterwards.
