# Tao Studio Development

How to run, inspect, and recover Tao Studio during development. `Tao Studio.md` owns what Studio
_is_; this page owns the operational contract around it — launch modes, ports, artifact roots,
manifests, diagnostics, smoke lanes, and release steps.

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
- `--no-browser` opens nothing at all: no browser tab, and no extra native project window.
- `--json` prints a machine-readable readiness payload once the advertised page answers.

Studio advertises the **session URL**, never the server root. The root is not a usable page: a
session prefix carries the opaque session ID that its HTTP and WebSocket routes hang off.

## Readiness

`--json` prints exactly one line on stdout after the session page has answered its readiness probe:

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
advertises actually answers, so a caller that sees it can open that address immediately.

## Ports

| Port      | Owner                         | Notes                                               |
| --------- | ----------------------------- | --------------------------------------------------- |
| 8081      | Expo Metro                    | The Tao CLI dev loop's preferred port               |
| 9020      | Local InstantDB               | `just start-local-instantdb`                        |
| 3000      | Local InstantDB dashboard     | Same stack                                          |
| ephemeral | Studio server, Studio preview | Chosen per launch; read them from `--json`          |
| 42000+    | `studio-smoke` lanes          | Deterministic per shard and worker, from base 42000 |

`./agent doctor` reports which of the conventional ports are occupied and by which process.

## Artifact roots

| Path                                                          | Holds                                                |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| `.artifacts/user/studio/launches/`                            | One launch manifest per Studio launch                |
| `.artifacts/user/studio/launches/<mode>/logs/lifecycle.jsonl` | The launch's structured lifecycle log                |
| `.artifacts/user/studio/recent-projects.json`                 | Welcome's recent-project history                     |
| `.artifacts/dev/`                                             | Expo logs and the generated preview runtime          |
| `.artifacts/tests/studio-smoke/<runId>/`                      | One smoke run's isolated lane                        |
| `.artifacts/tests/studio-canary/`                             | The native canary's report                           |
| `.artifacts/logs/verify/<timestamp>/`                         | One `check` or `verify` run's per-gate logs          |
| `.artifacts/tmp/`                                             | Bootstrap scratch; reclaim with `just clean-scratch` |

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

**Run these outside an agent's Bash sandbox.** That sandbox denies both inspecting and signalling
processes outside itself, so ownership can never be confirmed from inside it: `studio-ps` reports a
running launch as `STALE`, and `studio-stop` correctly refuses to signal what it cannot validate,
leaving the launch running. This is the fail-safe behaving as designed, not a bug — but it means an
agent must run them from an unsandboxed shell, or stop Studio with Ctrl+C in its own terminal.

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

## Lifecycle telemetry

Each launch writes JSON lines to `<artifactRoot>/logs/lifecycle.jsonl` carrying, where known, the
launch ID, session ID, component (`studio-server`, `preview`, `metro`, `watcher`, `native-shell`,
`browser-smoke`), PID, port, compile and preview revisions, the event, elapsed time, and the
shutdown reason. The terminal shows only the events a person waits on — server ready, a failed
compile or reload, shutdown, a signal escalation, an orphan — and never source contents or secrets.

## Smoke lanes

The smoke lane is deliberately outside ordinary test discovery: it is slow and it binds real ports.

```bash
just studio-smoke packages/dev/studio-smoke/studio-real-app.test.ts
```

```bash
just studio-proof-real-app
```

Each run gets deterministic ports from base 42000 by shard and worker, and its own artifact root.
The browser lane drives headless Chrome over the DevTools protocol, honours `TAO_STUDIO_CHROME_PATH`,
captures a screenshot and the browser console under the run's artifact root, and fails the run on any
page error. It stops what it started through the launch manifest, not by killing the command it
spawned.

The deterministic parts of the same behaviour — save-to-preview synchronization and scenario-group
startup — live in `packages/studio/studio-tests` and run in the ordinary lane, so `./agent verify`
stays fast.

## Verification

`./agent check` and `./agent verify` run their gates in parallel and end with one summary: every
gate with its status and elapsed time, the warnings gates printed, the log directory, and the first
actionable failure with its output. Gates a lane deliberately does not run are reported as skipped
with the reason, never as passed. A failure is classified as environment setup, optional tooling, a
sandbox restriction, or a repository defect. `verify` also writes
`.artifacts/logs/verify/summary.json`.

The Justfile decides which gates belong to which lane; `./dev gates` runs them and reports.

## Native canary

```bash
just studio-canary
```

Launches native Studio against a deterministic project, evaluates its runtime probe against the
required capability set (multi-window, native menu, global shortcut, WebSocket, Metro iframe), and
fails when any process the launch owned is still running afterwards. A host without Hutch, or
without a window server session, is reported as **blocked** — neither a pass nor a repository
failure.

Three checks no in-process probe can drive are reported as manual every run:

- Choose **File > Open Project…** and confirm the native directory picker opens.
- Press **Command-W** and confirm exactly one window closes.
- Close the final window and confirm Tao Studio quits.

## Release

Building a signed, notarized release needs credentials this repository never holds.

```bash
just studio-package https://releases.example.com/tao-studio stable
```

Then validate what was built, without publishing anything:

```bash
just studio-release-check .artifacts/build/studio-native/service-stage/payload --app "<built>.app" --dmg "<built>.dmg" --release-base-url https://releases.example.com/tao-studio
```

The validation reports a standalone payload (no `bunx`, no repository paths, no devenv profile), the
packaged Node runtime and native library inventory, an HTTPS update manifest, differential updates,
and — through Apple's own tools — deep signing, notarization, and disk image validity. A gate whose
tool is missing is reported **UNVERIFIED**, never as passed.

### Operator steps for the external gates

These cannot be done from this repository and must be done by an operator on a machine with Xcode
command line tools and the signing identity in its keychain:

1. Install the Developer ID Application certificate into the login keychain.
2. Export the notarization credentials in the packaging shell. Only these names are read, and this
   repository never reads their values:
   - `APPLE_ID` — the Apple ID that owns the notarization submission.
   - `APPLE_TEAM_ID` — the Developer Team ID the certificate belongs to.
   - `APPLE_APP_SPECIFIC_PASSWORD` — an app-specific password for that Apple ID.
3. Set `TAO_STUDIO_RELEASE_BASE_URL` to the HTTPS host installed copies fetch updates from, so
   `./dev studio-doctor` can confirm it is configured.
4. Run `just studio-package <release-base-url> <channel>`, then `just studio-release-check` above.
5. Upload the artifacts and the update manifest to the release host yourself. No command here
   publishes anything.

## Troubleshooting

**A blank Studio.** Almost always two React copies in one bundle. `./dev studio-doctor` reports the
React singleton directly, and `./agent verify` fails on it before Studio can start. The versions the
installed Expo SDK pins are the contract; `packages/dev` is allowed its own React only because Ink's
peer range starts above Expo's pin, and its copy never reaches a bundle.

**A stale session URL.** Session IDs are per launch. `./dev studio-ps` distinguishes live launches
from stale manifests; `./dev studio-stop --all` clears the stale ones. Studio never auto-opens a
prior generation's session.

**A port is occupied.** `./agent doctor` names the process holding each conventional port and the
`kill -TERM` command for it. `./dev studio-doctor` additionally reports ports held by processes no
launch manifest claims — identify those with `ps` before stopping anything.

**`studio-ps` says `STALE` for a launch that is plainly running.** You are inside an agent's Bash
sandbox, which cannot inspect processes outside it. Run the command from an ordinary shell.

**Metro dies with `EMFILE: too many open files`.** Watchman is not answering, so Metro is watching
through the OS and this repository exceeds the descriptor limit. `./agent doctor` reports it. Watchman
ships in the pinned devenv profile.

**Missing Hutch.** Only native Studio needs it; browser Studio is unaffected. `./dev studio-doctor`
reports it as optional with the installer command.

**Missing Chrome or Chromium.** Only the browser smoke lane needs it. Set `TAO_STUDIO_CHROME_PATH`
to an executable.

**Native Studio will not register.** AppKit application registration aborts under an agent host
coalition. Run it from an ordinary Terminal in the logged-in desktop session, or use `./dev studio`.
`./dev studio-doctor` reports the host as unable to register a native application.

**A linked worktree will not bootstrap.** `./agent` reports the denied operation and its recovery.
Two failures look alike and need opposite responses: a denied _temporary directory_ is resumable —
`just clean-scratch && direnv exec . ./agent setup` — while a denied _destination path_ repeats
forever, because some npm packages ship files under paths an agent sandbox protects (`.gitmodules`,
`.idea/`). Recover from a shell without that sandbox: `bun install`, or `just claude-unsandboxed`.

**A failed install left gigabytes behind.** `just clean-scratch` reclaims it and reports how much. It
only ever empties a repository `.artifacts` scratch root.
