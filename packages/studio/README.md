# Tao Studio

How to run, inspect, and recover Tao Studio during development. `Docs/Spec/Tao Studio.md` owns what
Studio _is_ as an implemented product contract; this package README owns the operational guide
around it — launch modes, ports, artifact roots, manifests, diagnostics, smoke lanes, and release
steps. Launch, doctor, smoke, and packaging commands live in `packages/dev` and the Justfile; they
are documented here because they are how this package is exercised.

## Launch modes

| Command                         | Shell      | Opens                         | Preview                 |
| ------------------------------- | ---------- | ----------------------------- | ----------------------- |
| `./dev studio [project]`        | Browser    | The session page, once        | Expo Metro in an iframe |
| `./dev studio-native [project]` | Electrobun | Welcome plus a project window | Expo Metro in an iframe |
| `just studio [project]`         | Browser    | Same as `./dev studio`        | —                       |
| `just studio-native [project]`  | Electrobun | Same as `./dev studio-native` | —                       |

Both modes start the same multi-project session server. Every opened project owns its own Expo
server, generated preview runtime, preview session, file watcher, and initial compile.

Shared options:

- `--app <name>` selects one app declaration in the project.
- `--entry <path>` selects the entry Tao file.
- `--port <port>` pins the Studio server port; the default is an available one.
- `--no-browser` suppresses the browser tab in browser mode and the project window in native mode. The native Welcome window still opens.
- `--host <hostname>` binds the Studio server; the default is `127.0.0.1`.
- `--json` prints a machine-readable readiness payload once the advertised page answers.

`studio-native` additionally takes `--artifact-root <path>` for the generated Electrobun project
and `--hutch <path>` for an explicit Hutch executable.

Studio advertises the **session URL**, never the server root. The root is not a usable page: a
session prefix carries the opaque session ID that its HTTP and WebSocket routes hang off.

## Readiness

`--json` prints one JSON line after the session page has answered its readiness probe. Human log
lines and child-process output share stdout, so read the line that parses as JSON and carries
`"version": 1` rather than assuming it is the only one:

```json
{
  "appName": "HNReader",
  "artifactRoot": "…/.artifacts/user/studio/launches/browser",
  "launchId": "browser-01a05904-c51b-7000-8832-86ca89fcbd1f",
  "lifecycleLogPath": "…/logs/lifecycle.jsonl",
  "manifestPath": "…/browser-01a05904….json",
  "mode": "browser",
  "previewUrl": "http://127.0.0.1:63089",
  "projectRoot": "…/Apps/HNReader",
  "sessionId": "5d84dfe4…",
  "sessionUrl": "http://127.0.0.1:63094/sessions/5d84dfe4…",
  "studioUrl": "http://127.0.0.1:63094",
  "version": 1
}
```

Scripts and smoke lanes read this instead of scraping logs. It is emitted only after the URL it
advertises actually answers, so a caller that sees it can open that address immediately. The launch
manifest reaches `ready` at the same moment and for the same reason; a launch whose page never
answers is recorded `failed` and stops, rather than idling in a state that reads as usable.

## Ports

| Port      | Owner                         | Notes                                               |
| --------- | ----------------------------- | --------------------------------------------------- |
| 8081      | Expo Metro                    | The Tao CLI dev loop's preferred port               |
| 9020      | Local InstantDB               | `just start-local-instantdb`                        |
| 3000      | Local InstantDB dashboard     | Same stack                                          |
| ephemeral | Studio server, Studio preview | Chosen per launch; read them from `--json`          |
| 42000+    | `studio-smoke` lanes          | Deterministic per shard and worker, from base 42000 |

A smoke shard is 128 ports and a worker is two of them, so a lane's ports are
`42000 + shard * 128 + worker * 2`. The shard defaults to a block derived from the worktree path, so
two checkouts on one machine do not claim the same ports; when two paths land on the same block
anyway, the run walks to the next free one. `--shard <index>` pins one explicitly.

`./agent doctor` reports which of the conventional ports are occupied and by which process, and
names the other Tao lanes running on this machine. A conventional port held by a Tao process is as
likely to belong to another worktree as to this one — check before killing it.

## Artifact roots

| Path                                                          | Holds                                                |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| `.artifacts/user/studio/launches/`                            | One launch manifest per Studio launch                |
| `.artifacts/user/studio/launches/<mode>/logs/lifecycle.jsonl` | Structured lifecycle records, one file per mode      |
| `.artifacts/user/studio-native/`                              | The generated Electrobun project and its build       |
| `.artifacts/user/studio/recent-projects.json`                 | Welcome's recent-project history                     |
| `.artifacts/dev/`                                             | Expo logs and the generated preview runtime          |
| `.artifacts/tests/studio-smoke/<runId>/`                      | One smoke run's isolated lane                        |
| `.artifacts/reviews/<reviewId>/`                              | Immutable web scenario visual-review bundles         |
| `.artifacts/tests/studio-canary/`                             | The native canary's report                           |
| `.artifacts/logs/<lane>/<timestamp>/`                         | One lane run's per-node logs plus `summary.json`     |
| `.artifacts/logs/<lane>/latest`                               | Symlink to that lane's newest run                    |
| `.artifacts/timings/`                                         | Measured node durations the scheduler orders by      |
| `.artifacts/tmp/`                                             | Bootstrap scratch; reclaim with `just clean-scratch` |

## Visual review

Capture every authored scenario cell with the real Studio web renderer:

```bash
./tao review Apps/HNReader --app HNReader
```

Compare a later capture with an earlier bundle, or choose a new explicit output directory:

```bash
./tao review Apps/HNReader --app HNReader \
  --against .artifacts/reviews/<review-id>/review.json
./tao review Apps/HNReader --app HNReader --output /tmp/hn-review
```

The command writes `review.json`, `annotations.json`, `index.html`, `screenshots/`, sanitized browser
event metadata, and Studio launch logs. Open `index.html` directly to inspect side by side, blink, or
opacity overlay; record per-cell decisions and comments, then use **Export annotations** to share the
portable annotation manifest and **Import annotations** to continue a collaborator's pass. Decisions
are bound to the baseline and current image digests, so a changed rerun keeps earlier context but reopens
the cell for review.

A changed image is evidence for review, not a failing threshold. Renderer mismatches are labeled
incomparable, and failed or unstable cells remain visible in the report.

Review waits for authored semantic replay, including explicit `advance` steps. It deliberately does not
infer ambient network or action quiescence, so scenarios that review delayed outcomes must advance time
before the expected state.

Review bundles are local derived artifacts and are not uploaded. Screenshots can contain fixture or live
preview data, so inspect a bundle before sharing it. The first command captures Studio's web renderer only;
it does not claim native iPhone, Android, or macOS pixel parity. Like the Studio browser smoke, run it from
an ordinary unsandboxed shell when Chrome cannot create its sockets or Crashpad directories in a sandbox.

## Launch manifests

Every running Studio publishes a versioned manifest naming exactly what it owns: the launch ID,
mode, project and app, the process IDs and the command each was running, the Studio and preview
ports and URLs, the session ID, the artifact root, the lifecycle state, and — after a stop — what
was signalled and which ports were released. It is written through a temporary file and a rename,
so a reader never sees a partial one.

A manifest is a hint, never an instruction. Before acting on one, the live machine is asked whether
each claim still holds: a recorded process counts as owned only when its ID is still running the
same command that was recorded, and a port counts as owned only when its current listener is one of
those processes. Nothing is ever stopped by matching a process name.

```bash
./dev studio-ps
```

```bash
./dev studio-stop --launch browser-01a05904-c51b-7000-8832-86ca89fcbd1f
```

`studio-stop` with no arguments stops the only recorded launch; with several recorded it asks for
`--launch <id>` or `--all` rather than guessing. It is idempotent, it succeeds when there is nothing
left to stop, and it never invokes `kill` with no operands. Both commands take `--json`.

**Run these outside an agent's Bash sandbox.** What a sandbox permits varies: `ps` is commonly
denied outright, and signalling a process started by a different sandbox instance is denied even
when signalling within one is allowed. Ownership therefore often cannot be established from inside
one. When that happens the launch is reported `UNDETERMINED` rather than stale, and `studio-stop`
refuses — it neither signals nor deletes the manifest, because a record of something that may
still be running is the last thing to throw away. Run them from an ordinary shell, or stop Studio
with Ctrl+C in its own terminal.

## Diagnostics

```bash
./agent doctor
```

Repository health, read-only: worktree identity and branch, the pinned devenv profile, direnv trust,
Node and Bun, Bun's temporary directory, dependency installation and runtime compatibility, Watchman,
generated parser artifacts, artifact roots and their size, and the conventional ports. Every line is
PASS, WARN, or FAIL with a direct remediation. Only FAIL exits nonzero, so optional tooling never
blocks work. `--json` emits a versioned structured report.

```bash
./dev studio-doctor
```

Everything above plus Studio's own: the React singleton in the Studio bundle, Studio client sources,
Hutch and the pinned native versions, whether this host can register a native application, the
Chrome or Chromium the smoke lane would use, recorded launches and stale manifests, ports held by
processes no manifest claims, Watchman and Metro watch coverage, and the presence — never the
contents — of release and notarization prerequisites.

Watch coverage is about Metro's `watchFolders`, which decide whether an aliased workspace edit can
reach the bundle. Studio's own compiles come from a separate watch of the project root, so a
Metro folder watched twice costs a redundant crawl and nothing more; the doctor reports it without
warning about it.

It reports whether a window server session is attached, but **not** whether AppKit registration
will succeed: a process inside an agent host's coalition reports a session and still aborts on
launch. Only the canary can answer that.

## Lifecycle telemetry

Each launch writes JSON lines to `<artifactRoot>/logs/lifecycle.jsonl` carrying, where known, the
launch ID, session ID, component (`studio-server`, `preview`, `metro`, `watcher`, `native-shell`,
`browser-smoke`), PID, port, compile and preview revisions, the event, elapsed time, and the
shutdown reason. The terminal shows only the events a person waits on — server ready, a failed
compile or reload, shutdown, a signal escalation, an orphan — and never source contents or secrets.

## Freehand Draw, Snap, and Feed project state

Unsnapped Draw geometry is committed in `.tao-project/studio/sketches.jsonc`. It is not a launch
artifact, browser-local preference, or Tao render tree. Catalog format version 1 stores a monotonic
`nextViewNumber`, a conflict `revision`, and ordered sketches. Each sketch records stable `id`,
display `name`, project, generated `view`, width, height, total
`rectOrder`, free `rects`, and flowed `snapped` associations; each rectangle records stable
`id`, nonnegative `x` and `y`, positive width and height, an open Tao element `kind`, and optional
string `content` and optional structured `fieldBinding`. A binding names its entity parameter, dotted
field path, and text or image presentation, including an optional image-label path.

Studio accepts JSONC but rewrites the file as canonical indented JSON through a temporary sibling and
rename. The server is the only writer. Clients submit a unique request ID and expected revision;
stale edits receive a conflict and identical retries are idempotent. Successful mutations are echoed
through the session event stream. Selection stays in the client and is not catalog state.

The first outer draw creates `@/studio/ViewN.tao` and its catalog row as one recoverable operation.
`ViewN` is allocated from `nextViewNumber`; deleted numbers are not reused. The generated file has the
Studio ownership header, mode `0444`, one public view rendering a same-sized `Placeholder`, and a
fixtureless phone scenario in the `sketch` group. Free rectangles remain in the catalog and are drawn
through a TypeScript overlay; Draw does not add rectangle, positioned-container, or offset syntax to
Tao source. The matrix associates each generated `sketch` scenario row with its catalog sketch by
`view`, renders a row-scoped workspace beside the live cells, and applies completed gestures through
the versioned catalog endpoint. Move to package is the supported way to make the generated file
ordinary authored source.

If source creation or compilation fails, Studio removes the new generated file and restores the prior
catalog snapshot. Studio rejects a malformed or unsupported catalog, and rejects a mutation against a
stale revision, rather than guessing. Recover the file from version control or repair it while
preserving stable IDs, rectangle order, revision, and a `nextViewNumber` greater than every retained
`view` number. Do not lower the allocator to reuse a deleted name; an existing
`@/studio/ViewN.tao` is never overwritten.

Snap uses the server's deterministic projection engine. The committed 16-case component-layout
regression corpus currently projects 12 directly (75 percent) and sends four ambiguous cases for
canonical tree/diff confirmation. It is not the 15–20-real-screen FS-D11 acceptance corpus, and it
does not measure inspector-fix counts; that acceptance evidence remains open. Two clean separating
axes are ambiguous and require confirmation. Padding is inferred only from the sketch root, so nested
container insets and cross-axis alignment remain inspector work until their inference rules are
decided.

Partial Snap inserts only the newly projected subtree, and Unsnap removes only selected Studio-owned
leaves, preserving existing manual edits and typed flow actions. Generated leaves carry private stable
Studio markers only while the source remains under `@/studio`; Move to package strips them. The
compiler publishes their current render identities and the preview reports measured geometry for
Unsnap fallback. Direction, separator, and weighted Spacer controls are typed source actions. Snap,
flow edits, Unsnap, and Undo commit generated source plus catalog associations together and roll both
back on compile or catalog failure. Reopen reconciles only against a manifest whose source version is
current, then drops missing, duplicated, or retyped associations. Retained geometry is preferred for
Unsnap; a current measured render is the fallback.

The project session intentionally rejects whole-sketch deletion until generated-source removal shares
the same transactional rollback.

Feed foundations preserve entity parameter identity in the preview manifest and accept imported
`public fixture` declarations, including cross-file scenario row handles. The deterministic generator
and inventory normalize fixture, generated, live, and library rows without writing source. The
`StudioSharedFixtureSource` seam creates or extends the generated `@/studio/Sketches.tao` source,
deduplicates identical rows, and rejects collisions. Typed source actions add an entity parameter and
fixture-backed arguments to a generated sketch group, bind a tagged snapped leaf to a validated field,
and insert parameterized project views using exact-type values visible at the target gap. Catalog
`bind-rect` persists the corresponding structured binding for free and snapped rectangles.

This does not yet constitute the complete Slice 3 gesture: the client row/chip browser, atomic Keep
transaction, entity/field drop wiring, and scenario relocation during Move to package remain open.

Run the focused Draw, Snap, and Feed-foundation contracts with the repository's installed profile:

```bash
bun test packages/studio/studio-tests/studio-feed-examples.test.ts packages/studio/studio-tests/studio-feed-inventory.test.ts packages/studio/studio-tests/studio-shared-fixture-source.test.ts packages/studio/studio-tests/studio-sketch-catalog.test.ts packages/studio/studio-tests/studio-sketch-source.test.ts packages/studio/studio-tests/studio-sketch-geometry.test.ts packages/studio/studio-tests/studio-sketch-projection.test.ts packages/studio/studio-tests/studio-sketch-snap.test.ts packages/studio/studio-tests/studio-sketch-session.test.ts packages/studio/studio-tests/studio-sketch-view.test.ts
```

The existing real browser-shell smoke entry point is:

```bash
just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts
```

It must run on a host where Chrome can expose DevTools. Its Draw path creates a 360 by 76 sketch and
persists a free rectangle. Its Snap path covers playlist flow, reload, repeated partial Snap by gap
drop, retained-position Unsnap, overlap Cancel/Apply, and source/catalog Undo.

## Smoke lanes

The smoke lane is deliberately outside ordinary test discovery: it is slow and it binds real ports.

Lanes that drive Chrome (`studio-simulated-user.test.ts`, and anything else using `StudioCdp`) need
an **unsandboxed** shell. Under the agent sandbox Chrome cannot create its socket directory or write
`Crashpad/settings.dat`, and it exits before exposing DevTools. The failure names Chrome rather than
the sandbox, so it reads as a browser problem:

```
Chrome exited before exposing DevTools (exit 21, signal none)
stderr: ... Failed to create socket directory.
stderr: ... open .../Chrome/Crashpad/settings.dat: Operation not permitted
```

```bash
just studio-smoke packages/dev/studio-smoke/studio-real-app.test.ts
```

```bash
just studio-proof-real-app
```

Each run gets deterministic ports from base 42000 by shard and worker, and its own artifact root.
The shard defaults to this worktree's own block (see [Ports](#ports)), so a smoke lane in one
checkout does not collide with one in another.
The browser lane drives headless Chrome over the DevTools protocol, honours `TAO_STUDIO_CHROME_PATH`,
captures a screenshot and the browser console under the run's artifact root, and fails the run on a
console error or an uncaught exception. It does not yet see failed resource loads or CSP violations,
which need `Log.enable`.

`studio-launch.test.ts` drives the whole launch contract through the CLI: it starts `./dev studio`,
checks the advertised session answers, confirms `studio-ps` reports the launch live with its port
owned, stops it through the manifest, and confirms nothing is left. It skips with a stated reason on
a host that will not report on its own processes, because ownership cannot be established there.

```bash
just studio-smoke packages/dev/studio-smoke/studio-launch.test.ts
```

The other smoke files build a session in-process and do not exercise the CLI.

The deterministic parts of the same behaviour — save-to-preview synchronization, scenario-group
startup, fixtureless empty-store setup, and ordered interaction replay — live in
`packages/studio/studio-tests`, runtime tests, and the runtime-toolchain Studio E2E suite. They run in
the ordinary lane, so `./agent verify` stays fast. Focused cells mount an isolated app-owned
navigation occurrence: contextual presentation and Back work without sharing state between cells.

## Verification

`./agent check` and `./agent verify` run their gates as one dependency-aware graph and end with one
summary: every gate with its status and elapsed time, the warnings gates printed, the log
directory, and the first actionable failure with its output. Gates a lane deliberately does not run
are reported as skipped with the reason, never as passed. A failure is classified as environment
setup, optional tooling, a sandbox restriction, or a repository defect. On a terminal the run
renders a live dashboard; in a pipe — an agent harness, a log capture — it prints one line per
finished node instead of streaming gate output, and `--output tui|lines|quiet` or `TAO_OUTPUT_MODE`
overrides the choice. Every lane writes `.artifacts/logs/<lane>/<timestamp>/<node>.log` plus
`summary.json` and refreshes the lane's `latest` symlink; `verify` also writes the stable copy at
`.artifacts/logs/verify/summary.json`.

`just full-verify` bootstraps dependencies and then runs the same graph grown to everything: the
verify membership plus the doctor (whose node log is the versioned `--json` report),
`dead-exports`, the launch and real-app browser smoke lanes in parallel on worker indices 0 and 1
(`StudioSmoke.resources()` gives each its own ports and artifact root), and the native shell
(worker 3) and canary serialized on a `gui` resource so they never overlap each other while the
browser lanes run beside them. The simulated-user browser lane is quarantined from the graph with
its reason in the rollup while its palette-to-preview drop is repaired; `just _full-verify-simulated`
runs it directly on worker 2. A failing lane no longer hides the lanes after it — every lane
appears in the one rollup with its own log. `just studio-smoke`, `just studio-smoke-native`,
`just studio-proof-real-app`, and `just studio-canary` remain the standalone entry points, and the
smoke lanes need an unsandboxed shell (Chrome cannot create its socket and Crashpad directories
under the agent sandbox). Checks that need a person live in `just studio-manual-checks` and are
never part of any lane.

The Justfile decides which gates belong to which lane; `./dev gates` runs them and reports, and
`GateCatalog.ts` in `packages/dev` holds each gate's scheduling shape (dependencies, width,
resources, timeouts).

## Native canary

```bash
just studio-canary
```

Launches native Studio against a deterministic project, evaluates its runtime probe against the
required capability set (browser runtime, auxiliary-window coexistence, native menu, global
shortcut, WebSocket, Metro iframe), and fails when any process the launch owned is still running
afterwards. The auxiliary-window check creates a hidden probe window; opening a second real Studio
project remains a human check. A host without Hutch, or without a window server session, is reported
as **blocked** — neither a pass nor a repository failure.

Checks that require a person are deliberately excluded from `test`, `verify`, `full-verify`, and the
canary. Run their separate interactive workflow with:

```bash
just studio-manual-checks
```

It opens visible native Studio and records these results in a separate report:

- Choose **File > Open Project…**, select a Tao project, and confirm a second project window opens.
- Press **Command-W** and confirm exactly one window closes.
- Close the final window and confirm Tao Studio quits.

## Release

Building a signed, notarized release needs credentials this repository never holds.

```bash
just studio-package https://releases.example.com/tao-studio stable
```

Then validate what was built, without publishing anything:

```bash
just studio-release-check .artifacts/build/studio-native/service-stage/payload .artifacts/build/studio-native/project/artifacts --app "<built>.app" --dmg "<built>.dmg" --release-base-url https://releases.example.com/tao-studio
```

The artifact names are read from the directory the build wrote, never from the command line, so a
name nobody produced cannot pass a check.

The validation reports a standalone payload (no `bunx`, no repository paths, no devenv profile), the
packaged Node runtime and native library inventory, an HTTPS update manifest, differential updates,
and — through Apple's own tools — deep signing, notarization, and disk image validity. A gate whose
tool is missing is reported **UNVERIFIED**, never as passed, and an unverified gate **fails the
command**: a build nobody could confirm was signed is not publishable. `--allow-unverified` exits
zero for inspecting a build on a machine that was never going to be able to check it.

### Operator steps for the external gates

Signing and notarization need an Apple Developer account and a machine whose login keychain holds
the certificate. Nothing in this repository ever reads the values behind these variables — only
whether each name is set — and none of them belongs in a file that is committed.

1. **Install the certificate.** In the Apple Developer account, create a **Developer ID Application**
   certificate and install it into the login keychain. Confirm it is usable for signing:

   ```bash
   security find-identity -v -p codesigning
   ```

   The identity string it prints — `Developer ID Application: Company Name (TEAMID)` — is the value
   for the next step.

2. **Export the signing identity.** Always required:

   - `ELECTROBUN_DEVELOPER_ID` — the full identity string from step 1.

3. **Export one notarization credential set.** Either, not both:

   _App Store Connect API key — preferred, and the only sensible choice for any shared machine:_

   - `ELECTROBUN_APPLEAPIKEYPATH` — path to the downloaded `.p8` key file.
   - `ELECTROBUN_APPLEAPIKEY` — the key identifier.
   - `ELECTROBUN_APPLEAPIISSUER` — the issuer ID.

   _Apple ID:_

   - `ELECTROBUN_APPLEID` — the Apple ID email address.
   - `ELECTROBUN_APPLEIDPASS` — an **app-specific** password from `account.apple.com`, never the
     account password.
   - `ELECTROBUN_TEAMID` — the ten-character team identifier.

   `ELECTROBUN_SKIP_NOTARIZATION=1` signs without submitting for notarization, which is useful for a
   local build that will not be distributed.

4. **Set the release host.** `TAO_STUDIO_RELEASE_BASE_URL` — the HTTPS host installed copies fetch
   updates from. `./dev studio-doctor` confirms it is configured.

5. **Confirm before building.** `./dev studio-doctor` reports which method is configured, or exactly
   which variables of a partially configured set are missing. It never prints a value.

6. **Build, then validate.** `just studio-package <release-base-url> <channel>`, then
   `just studio-release-check` as above.

7. **Publish yourself.** Upload the artifacts and the update manifest to the release host. No command
   here publishes anything.

These variable names are Electrobun's, not Apple's own tooling's; see
<https://framework.blackboard.sh/electrobun/guides/code-signing/>.

## Troubleshooting

**A blank Studio.** Almost always two React copies in one bundle. `./dev studio-doctor` reports the
React singleton directly, and `./agent verify` fails on it before Studio can start. The versions the
installed Expo SDK pins are the contract; `packages/dev` is allowed its own React only because Ink's
peer range starts above Expo's pin, and its copy never reaches a bundle.

**A stale session URL.** Session IDs are per launch. `./dev studio-ps` distinguishes live launches
from stale manifests; `./dev studio-stop --all` clears the stale ones — from an ordinary shell, so
that a launch whose ownership cannot be confirmed is refused rather than forgotten. Studio never
auto-opens a prior generation's session.

**A port is occupied.** `./agent doctor` names the process holding each conventional port and the
`kill -TERM` command for it. `./dev studio-doctor` additionally reports ports held by processes no
launch manifest claims — identify those with `ps` before stopping anything.

**`studio-ps` says `UNDETERMINED` for a launch that is plainly running.** You are inside an agent's
Bash sandbox, which will not say whether a process outside it exists. Run the command from an
ordinary shell. `studio-stop` refuses in this state rather than guessing, so nothing is lost.

**Metro dies with `EMFILE: too many open files`.** Watchman is not answering, so Metro is watching
through the OS and this repository exceeds the descriptor limit. `./agent doctor` reports it. Watchman
ships in the pinned devenv profile.

**Missing Hutch.** Only native Studio needs it; browser Studio is unaffected. `./dev studio-doctor`
reports it as optional with the installer command.

**Missing Chrome or Chromium.** Only the browser smoke lane needs it. Set `TAO_STUDIO_CHROME_PATH`
to an executable.

**Native Studio will not register.** AppKit application registration aborts under an agent host
coalition, and the runtime dies by signal before it can report. `just studio-canary` names this;
`./dev studio-doctor` cannot, because a coalition still reports a window server session. Run it
from an ordinary Terminal in the logged-in desktop session, or use `./dev studio`.

**A linked worktree will not bootstrap.** `./agent` reports the denied operation and its recovery.
Two failures look alike and need opposite responses: a denied _temporary directory_ is resumable —
`just clean-scratch && direnv exec . ./agent setup` — while a denied _destination path_ repeats
forever, because some npm packages ship files under paths an agent sandbox protects (`.gitmodules`,
`.idea/`). Recover from a shell without that sandbox: `bun install`, or `just claude-unsandboxed`.

**A failed install left gigabytes behind.** `just clean-scratch` reclaims it and reports how much. It
only ever empties a repository `.artifacts` scratch root.
