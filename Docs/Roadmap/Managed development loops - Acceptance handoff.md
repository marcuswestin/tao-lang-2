# Managed development loops — Remaining acceptance handoff

Prepared 2026-10-02; refreshed after the authorized test-and-commit pass. This is continuation context
for the next task's planning, not authorization
to implement, commit, land, change machine configuration, or bypass native consent.

## Outcome and immediate recommendation

Start the next planning task now with the repository's current named host permissions loaded.
Enabling `./agent unsandboxed dev-loop` unlocks most lifecycle acceptance, but does not by itself
complete this project. Two technical gaps remain: captured ownership of Xcode's detached WDA
runner, and a safe way to exercise a managed mobile target without colliding with its device lease.
Native consent, focus observation, and human manual checks also remain distinct requirements.

The next deliverable is an ordered execution plan covering every open acceptance item below,
including any necessary small source changes and the exact remaining human involvement. Do not
launch acceptance sessions or implement that plan before the Developer approves execution.

## Checkout and stopping point

- Continue in the existing primary checkout at `$HOME/code/tao-lang-2`, branch `dev/ro`.
  This shared-checkout assignment is intentional; do not create another worktree because it is dirty.
- The implementation is committed on `dev/ro`, not landed. Its base is
  `3021ec7edd8579bbc1c6f40d6f12368be68c4231`; that base or a fresh checkout of `main` does **not**
  contain the implementation. Source commits are `8d88afc72` (model audit), `c40aadd9b`
  (visibility/reports), `1c604ea10` (Android ownership), `0dfa6e469` (managed controls), and
  `6000eed2e` (native isolation). This handoff and guidance are committed in the following
  documentation chunk. Reinspect live state before relying on this snapshot. Ignored evidence
  files remain checkout-local; the facts needed to plan are included here.
- Preserve all concurrent edits. In particular, do not modify, format, stage, or reset the
  Developer's `Apps/HNReader/.tao-project/studio/sketches.jsonc` or
  `Apps/HNReader/@/studio/View3.tao`. The dirty set includes earlier quiet-workflow/model changes;
  a dirty path does not establish ownership by this task.
- Leave source and index unchanged during planning, except for the requested plan document.
  No dependencies, lockfile changes, full verification, finalize, landing, or publication are
  authorized. Full verification belongs to separately authorized landing in this personal checkout.

Read `AGENTS.md`, `./agent help`, and the applicable skills. `delegation` owns model selection;
`dev-automation` owns CLI/host dispatch; `quiet-ui-workflows` owns visible UI permission;
`verification-lanes` owns evidence boundaries; `environment-recovery` owns host failures;
`devenv-upgrades` owns the backlog. Read `packages/AGENTS.md` before future package edits.
When execution is approved and decisions are settled, create a fresh weighted progress ledger
through `progress-report` and report roughly every 20%.

## Settled design: do not reopen without new evidence

- Public interface: `./agent unsandboxed dev-loop start|status|logs|stop|restart|reload`.
  Preserve foreground `app-dev`. Support server-only, web, iOS, and Android; desktop and physical
  devices are outside the first managed interface.
- There is no default runtime or idle timer. Agents decide when retaining a useful session helps
  and when to stop it. Shutdown after an explicit stop remains bounded and identity checked.
- Start resolves app selection before reserving devices or starting services. Unique selection is
  automatic; ambiguity refuses with candidates and `--app` instructions, never an interactive prompt.
- Start returns a durable session ID in `starting`; `ready` requires compilation, Metro readiness,
  and dispatch to all requested targets. Dispatch success is not rendered UI or interaction proof.
- `status` can list this checkout's sessions. Logs and mutations require explicit session IDs.
  Restart keeps the ID/configuration and advances generation; reload asks Metro to reload apps.
- Retain target-specific `--show-browser`, `--show-simulator`, `--show-emulator`, and native
  acceptance `--show-studio`. No generic visibility flag. Restart preserves recorded visibility;
  controls must not introduce another surface.
- JSON reports are one stdout object, initial warnings use stderr, and final warnings survive
  clipping and nested reports. `logs --follow --json` refuses; ordinary logs default to 200 lines.
- A detached per-loop controller keeps reservations alive. Local control binds only to
  `127.0.0.1`, uses private capability credentials and generation/kernel identity checks, serializes
  mutations, and lets stop interrupt startup or another operation.
- Receipts/logs remain under `.artifacts/dev-loops/<session-id>/`. Reports include selected app,
  URLs/devices when available, warnings, failures, log location, and cleanup outcome.
  Private `active-control` credentials must never enter reports, logs, retained history, or chat.
- Cleanup joins one completion promise. Release ownership only after shutdown is proved; retain
  or quarantine uncertainty. Never adopt historical processes by name, AVD, port, path, age, or PID
  alone. Borrowed devices remain running.
- Native tests use a stable checkout-realpath identity distinct from development Studio, serialized
  by a lease, with separate Hutch state, builds, user state/data, and launch records. Default
  canary/manual projects use disposable keyboard-navigation projections; explicit projects remain
  exact and refuse occupied ownership, with no takeover prompt.
- The unified persistent cross-surface UI controller is deferred until post-MVP. Completing
  acceptance does not authorize implementing it or adding skill-activation evaluations.

## What additional permission does and does not solve

| Remaining work                                                         | Requirement beyond the new `dev-loop` host exception                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed start/readiness/control/cleanup and Chrome lifecycle           | Mostly real host execution and observation; correct any defects actually reproduced. Existing Chrome/CDP drivers are available.                                                                                                                          |
| Android/iOS lifecycle, isolation, borrowing, retention/recovery        | Real device resources and capabilities; safely controlled failure/abrupt-exit cases may need a scoped repository test seam if no existing named command provides one.                                                                                    |
| Mobile screenshots/input on a live managed target                      | Existing mobile driver acquires the same exclusive device lease as the loop. Plan a narrowly owned reuse/delegation mechanism or another valid proof arrangement; do not weaken the lease or claim a separate finite journey proves managed interaction. |
| Native Mac2 interaction                                                | Source/lifecycle work to establish trustworthy ownership of the detached WDA runner before contact, then real driver acceptance. More shell permission does not supply that ownership proof.                                                             |
| Native Automation/Accessibility consent                                | The OS consent flow may require the Developer. No denial was established by the latest failure; do not assume that granting consent fixes ownership.                                                                                                     |
| Focus, inactive viewers, development Studio coexistence, manual checks | Real observation and a suitable host/Developer review window. Some observations may require human participation even with all named commands available.                                                                                                  |

The mobile drivers already accept `preheldTargetLease`; the finite proof command passes a
non-releasing wrapper at `packages/testing/e2e-testing/AppiumNativeHostProofCommand.ts:81` and `:99`.
The iOS driver consumes that seam at
`packages/testing/e2e-testing/native/appium/AppiumXcuiTestController.ts:212`; Android has the
corresponding seam in `native/appium-android/AppiumAndroidController.ts`. There is no confirmed
managed-loop bridge. Investigate reuse of this existing seam before proposing a new lease protocol,
and define who holds, checks, delegates, and releases ownership when the driver or loop fails.

### Host dispatch diagnosis

Canonical permissions already contain `dev-loop` in `.rulesync/permissions.jsonc:106`. The fixed
target and strict argument policy are in `HostCommandTargets.ts:24` and
`agent-host-dispatch.ts:26` under `packages/cli/agent-cli/agent-cli-src/`.
Adapters were regenerated successfully with `./agent setup`; protected configuration repair used
the existing `./agent unsandboxed fix-agent-config`. Do not hand-edit generated adapters or grant
arbitrary shell commands, PIDs, private worker entrypoints, or control endpoints.

In the previous task, the new operation failed before dispatch at the wrapper's host probe
(`agent:67`):

```text
FAIL  ./agent unsandboxed is still running inside a sandbox; the host command was not started.
```

Standalone existing named operations (`processes`, `android`, `simulators`, `studio-smoke`) worked.
Redirecting a host command through the shell produced the same denial. Run host operations as
standalone invocations and capture their tool results; do not use redirection or another host alias
to evade the boundary. A new task must actually load the current host exception; successful
configuration generation alone is not proof that its execution permissions changed.

During planning, the non-launching preflight can be:

```sh
cd "$HOME/code/tao-lang-2"
./agent help
./agent unsandboxed dev-loop status --json
./agent unsandboxed capabilities
```

If the status operation still fails, record the exact missing capability and ask for that task's
permission configuration to be corrected. Do not disable the wrapper probe or fall back to raw
host tools. Any newly proposed host operation or reachable behavior needs explicit approval.

### Mac2 ownership failure

The first host run used the driver's shared WDA project/default port/shared Xcode build cache and
timed out on WDA session attachment after 240000ms. The driver also sends `DELETE /` to an existing
port listener without proving ownership. Those unsafe paths were replaced rather than retried.

`StudioMac2TestRun.ts` now copies pinned WDA source into the invocation, uses local DerivedData
and a leased backend port under `macos-physical-input`, captures process identities, and attaches
through the driver's documented `appium:webDriverAgentMacUrl`. External attachment avoids the
driver's shared build/version-write path. A continuously owned frontend checks the machine lease
and backend listener before every status/session/action/delete request, rejects redirects, disables
forwarding before cleanup, and remains inert until Appium shutdown is proved. An outer client
fetch guard alone is insufficient: Appium's child internally polls status before posting a session.

The corrected host run built WDA successfully, then refused its detached runner:

```text
HostEnvironmentError: Refused to contact a WDA listener not owned by this invocation.
```

Invocation `6d2dce4a-17e4-440e-88c3-be3b4a59af0e`, 16 seconds. Its WDA log shows
`WebDriverAgentRunner-Runner` PID85284 on backend55243; the captured tree did not establish that
listener's ownership. Frontend55244 was separate. These are historical identifiers, not permission
to contact or signal a process now. The isolation receipt finished `closed`; Studio/Appium shutdown
completed and complete subsequent inventory found no WDA/Appium/invocation processes.

Plan the smallest reliable provenance/launch handshake compatible with Xcode's detached launch.
Treat possible approaches as proposals until verified. A matching invocation path or a currently
healthy `/status` response does not replace ownership. Preserve private forwarding, generation
fences, input serialization, independent rollback, and native consent. Do not solve this by
turning off the guard, using the driver's unowned-listener cleanup, or adopting a runner retrospectively.

## Acceptance matrix: every row remains open unless proved explicitly

| Area                            | Required remaining proof                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands                        | Real prompt-free deterministic selection; invalid arguments before launch; foreground compatibility; JSON stdout/stderr and warning retention. Source regressions already cover these but do not prove real launch behavior.                                                                                                                             |
| Lifecycle                       | Survival after start exits; compilation/Metro/all-target readiness and failures; stop during startup; restart versus reload; concurrent controls; stale generations/PID reuse; failed cleanup/retention; interrupted controller recovery; unrelated-process preservation.                                                                                |
| Chrome                          | Attach to the managed Chrome instance for clicks/screenshots; reload/restart; complete loop/profile cleanup; quiet and explicitly visible focus behavior; preserve unrelated Chrome and Metro across stop.                                                                                                                                               |
| Android                         | Real graceful shutdown and escalation; abrupt-parent durable protocol; parallel reservations/port reuse; borrowed-device preservation; screenshots/input; retained-generation recovery and uncertain ownership quarantine. A death between spawn and identity publication intentionally leaves quarantine; do not claim automatic recovery for that gap. |
| iOS                             | Reuse and parallel isolation; viewer-free execution; owned-device teardown; borrowed-device preservation; managed screenshots/input; inactive viewer focus behavior.                                                                                                                                                                                     |
| Native Studio                   | Detached WDA ownership then Mac2 interaction; every native launch path retains isolated identity/state/builds/project ownership; hidden probes and visible semantic checks alongside development Studio; no takeover, owned cleanup, actual focus and consent-prompt behavior, and human manual acceptance.                                              |
| Historical/process and dispatch | Recheck historical selector absence without adoption; ensure current named host dispatch works; preserve shared/unknown caches. Redirected-command denial was diagnosed, not resolved by changing host policy.                                                                                                                                           |

A separate finite mobile `test-host` journey can prove its driver and product behavior after the loop
releases the device. It does not prove input/screenshots on the running managed loop. Likewise,
starting a simulator does not prove viewer invisibility when another viewer is already open.
Use observed results, source tests, unavailable capabilities, consent, and human-only items as
separate evidence categories. Do not bypass fences or silently skip required tests.

## Suggested order for the new execution plan

1. Reconcile live checkout, dirty/index state, capabilities, recorded sessions, and ownership. Verify
   the loaded `dev-loop` host permission using the non-launching preflight. No cleanup by stale PID.
2. Plan a server-only and headless Chrome lifecycle lane first, including explicit cleanup and
   unrelated-process preservation. Keep target/failure cases isolated and repeatable.
3. Plan the minimal mobile driver/lease integration needed for managed interaction; distinguish
   existing lifecycle commands from missing fault/interaction seams. Preserve exclusive ownership.
4. Plan Android and iOS acceptance, serializing focus/input and resource-intensive checks where
   needed while testing reservation isolation with explicitly owned parallel sessions.
5. Plan detached WDA provenance repair and focused regressions/review, then native checks. Reserve
   a Developer review window for coexistence, focus, consent and manual observations as necessary.
6. Reconcile all backlog acceptance fields and generated indexes, retained resources, running
   sessions and exact stop commands. Keep the unified controller deferred. Ask separately about
   committing/landing; this handoff grants neither. A dedicated recurring repository pass is
   recommended after acceptance/landing because CLI, host resource and native seams changed.

The plan should state dependencies, exact supported commands, source ownership boundaries,
success/failure criteria, cleanup/fallback behavior, required host/visible-UI permissions, human
participation, and stopping points. Ask only about genuinely unsettled choices; routine engineering
choices can be derived from live repository evidence.

## Command templates for the future approved execution

These are examples to include in the plan, **not instructions to launch them during planning**.
The checked-in Memory-backed fixture avoids credentials and hosted-data setup. Its app declaration
is in `Apps/Test Apps/Data MVP/Data MVP.tao`; recheck it before use. Avoid the Developer's HNReader edits.

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --json
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --web --json
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --ios --json
./agent unsandboxed dev-loop start "Apps/Test Apps/Data MVP" --app DataMVPApp --android --json
```

Run one selected start command, then substitute its actual receipt UUID below:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed dev-loop status --session <session-id> --json
./agent unsandboxed dev-loop logs --session <session-id> --lines 200
./agent unsandboxed dev-loop reload --session <session-id> --json
./agent unsandboxed dev-loop restart --session <session-id> --json
./agent unsandboxed dev-loop stop --session <session-id> --json
```

For borrowed-device cases use only explicitly reserved, currently verified targets via
`--simulator <udid>` or `--emulator <serial>`. Add only the matching `--show-*` for authorized visible
checks. The previous task had permission for task-owned visible native checks and brief Mac2
focus-taking; this records historical authorization and does not bypass the new thread's scoped
permission or native OS consent requirements.

Native reproductions for the future approved execution:

```sh
cd "$HOME/code/tao-lang-2"
./agent unsandboxed studio-smoke --native packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts
./agent unsandboxed studio-smoke --native --show-studio packages/ides/studio-tooling/studio-smoke/studio-host-control.test.ts
./agent unsandboxed studio-smoke --native --show-studio packages/ides/studio-tooling/studio-smoke/studio-mac2-acceptance.test.ts --json
```

Plan controlled cancellation/fault checks through supported repository seams. Public host dispatch
does not authorize arbitrary process signals or private worker invocation. Do not depend on sending
terminal Ctrl-C: that was unavailable in the previous harness session.

## Implementation map and focused checks

| Seam                                          | Files under repository root                                                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public grammar/host authorization             | `.rulesync/permissions.jsonc`; `packages/cli/agent-cli/agent-cli-src/agent-config/DevLoopArgs.ts`, `HostCommandTargets.ts`; `cli/agent-host-dispatch.ts`, `cli/agent-help.ts`; generated adapters from `./agent setup` |
| Session commands/controller/receipts/recovery | `packages/cli/dev-cli/dev-cli-src/dev-loop/{DevLoopCommand,DevLoopController,DevLoopWorker,DevLoopStore,DevLoopRecovery}.ts`; `dev-cli-src/dev.ts`                                                                     |
| Reservations, cancellation, target dispatch   | `packages/cli/dev-cli/dev-cli-src/simulators/{AgentAppDev,AgentAndroidEmulator,AndroidRecovery}.ts`; `packages/apps/expo-host/expo-host-src/dev-loop/`; `packages/cli/tao-cli/cli-src/dev-command.ts`                  |
| Typed local lifecycle transport               | `packages/shared/shared-src/DevLoopControl.ts`                                                                                                                                                                         |
| Native identity/project/isolation             | `packages/ides/studio-tooling/studio-tooling-src/{StudioNativeIdentity,StudioNativeTestRun,StudioMac2TestRun,StudioDev,StudioNative,StudioSmoke,StudioCanary,StudioManualChecks}.ts`; native `studio-smoke/` files     |
| Machine ownership/mobile drivers              | `packages/testing/host-control/host-control-src/MachineResources.ts`; `packages/testing/appium-driver/appium-driver-src/`; `packages/testing/e2e-testing/native/`                                                      |
| Visibility and durable warnings               | `packages/testing/verification/verification-src/UiVisibility.ts`, gate/retry/parent workflows; `packages/cli/agent-cli/agent-cli-src/runner/`                                                                          |
| Guidance                                      | `agents/skills/quiet-ui-workflows/`; `agents/skills/verification-lanes/SKILL.md`; model policy is owned by `agents/skills/delegation/`                                                                                 |

Focused command templates, only after execution is authorized and relevant changes warrant them:

```sh
cd "$HOME/code/tao-lang-2"
./agent test-file packages/cli/agent-cli/agent-cli-tests/dev-loop-args.test.ts
./agent test-file packages/cli/agent-cli/agent-cli-tests/agent-host-commands.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-command.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-controller.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-recovery.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/dev-loop-reservations.test.ts
./agent test-file packages/shared/shared-tests/dev-loop-control.test.ts
./agent test-file packages/apps/expo-host/expo-host-tests/expo-dev-loop.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/agent-android-emulator.test.ts
./agent test-file packages/cli/dev-cli/dev-cli-tests/android-recovery.test.ts
./agent test-file packages/testing/host-control/host-control-tests/MachineResources.test.ts
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-native-test-isolation.test.ts
./agent test-file packages/ides/studio-tooling/studio-tooling-tests/studio-mac2-test-isolation.test.ts
./agent typecheck
```

Use `./agent fmt <exact-files…>` rather than the full-tree formatter in this shared checkout.
Independent managed/native ownership reviews found no remaining source findings at this handoff.
Focused lifecycle, selection, transport, generation, rollback and mutation checks passed; the final
Mac2 helper suite passed18/18 and integrated typecheck passed at18:59 UTC on2026-10-02. The subsequent
authorized commit pass reran33 focused file gates and integrated typecheck; all passed before
committing. Those results are a baseline, not proof of new edits or completed host acceptance.
No full verification ran.

## Durable backlog and local evidence

Backlog entries remain open:

- [Quiet UI host acceptance](<Developer environment upgrades/DEVENV-QUIET-UI-HOST-ACCEPTANCE.md>)
- [Chrome foreground and cleanup](<Developer environment upgrades/DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND.md>)
- [Android lease release and exit](<Developer environment upgrades/DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT.md>)
- [Persistent controller, post-MVP](<Developer environment upgrades/DEVENV-PERSISTENT-UI-CONTROLLER-POST-MVP.md>)

The [developer-environment index](<Developer environment upgrades.md>) is generated; refresh it with
`./agent ledger-index` after entry edits, never by hand. The entries' acceptance fields remain the
completion contract. This handoff summarizes their execution dependencies and does not close them.

Ignored local evidence may be absent in a different checkout; the facts needed to plan are included
above. In this shared checkout, useful artifacts are:

- `.artifacts/host-acceptance/dev-loop-2026-10-02/acceptance.md` and `external-directories.md`.
- `.artifacts/progress/dev-ro.md` and `.artifacts/checkpoint/dev-ro.md`. The checkpoint's top
  2026-10-02 section supersedes older authorization/blocker notes lower in that file.
- Hidden native pass: `.artifacts/logs/agent/studio-smoke/2026-10-02T17-35-30-391Z-59985.log`.
- Visible semantic pass: `.artifacts/logs/agent/studio-smoke/2026-10-02T17-50-33-605Z-50108.log`.
- First Mac2 timeout: `.artifacts/logs/agent/studio-smoke/2026-10-02T17-50-44-606Z-51304.log`.
- Corrected Mac2 safe refusal: `.artifacts/logs/agent/studio-smoke/2026-10-02T18-59-27-483Z-83641.log`.
- Its `appium-mac2/isolation.json` and `wda.log` under
  `.artifacts/tests/studio-smoke/local/shard-1/worker-0/invocations/6d2dce4a-17e4-440e-88c3-be3b4a59af0e/`.
- Final typecheck: `.artifacts/logs/agent/typecheck/2026-10-02T18-59-13-574Z-82288.log`.
- Final Mac2 regression: `.artifacts/logs/agent/test-file/2026-10-02T18-59-02-339Z-81169.log`.

## Resources and cleanup boundaries

No managed loop was started by the previous task. Its final full host inventory showed no remaining
Appium/WDA/test-invocation processes. The historical selector PID37085 and older development Studio
processes were absent. Recheck current identities rather than treating those old PIDs as owned.

Historical resources preserved, not task cleanup targets:

- Developer Chrome PID31441, start2026-09-29 12:20:11; unrelated Metro PID5618,
  start2026-10-01 14:33:46, port60744; Metro PID76829, start2026-10-01 14:29:15, port8081.
- Booted iPhone17 `45EED26D-0777-4B4F-8CE2-144FD84B8938`. Android device inventory was empty.
- Earlier browser profile `Apps/HNReader/.tao/dev/chrome/5ff1a105-8cf2-486d-8e6e-4e796a323613`:
  inactivity/deletion was not established; do not sweep it into new owned cleanup.
- `$HOME/Library/Developer/Xcode/DerivedData/WebDriverAgentMac-brxqwsxpwwfjdchaevetzixaojyu`:
  the first Mac2 run used this shared cache without exclusive ownership proof. Preserve it.
- `$HOME/Library/Application Support/appium-mac2-driver-nodejs/strongbox/` contains shared driver
  version metadata. Preserve it. `$HOME/.appium/webdriveragent_mac/upgrade.time` was a legacy
  migration read; this task did not establish creation or ownership of that directory.

The corrected Mac2 retry used invocation-local artifacts; no additional external directory was
identified. Source-test external fixtures were removed. Keep a new task-local external-directory
ledger for any later output. Never clean unknown resources merely to make acceptance pass.

## Copyable planning prompt

```text
Create an execution plan for every remaining managed development-loop and isolated native
acceptance task in Tao. Read Docs/Roadmap/Managed development loops - Acceptance handoff.md first,
then reconcile its evidence and open acceptance matrix against live source and backlog entries.

Continue in the existing shared primary checkout at $HOME/code/tao-lang-2 on dev/ro. The feature is
committed there but not landed; do not create a worktree or resume from a clean main checkout. Preserve all
concurrent app edits and the index. Use the current canonical named host permissions, including
./agent unsandboxed dev-loop. Verify the loaded permission with status --json; do not bypass a
sandbox refusal with another alias, raw host command, or broader permissions.

Plan only. Non-launching read-only diagnosis is allowed. Do not start loops, open windows, run
acceptance tests, change source/machine settings, add dependencies, commit, or land. Save the plan
in Docs/Roadmap/Managed development loops - Execution plan.md and present its executive summary.

Cover real lifecycle and Chrome/mobile/native acceptance, detached WDA provenance, the mobile
driver/device-lease conflict, native consent/focus/manual/coexistence checks, and retained-resource
recovery. Distinguish host permission, source changes, missing capabilities, scoped visible-UI
authorization, and human participation. Keep no default loop timer, target-specific show flags,
identity/generation fencing, borrowed-resource preservation, and the unified controller deferred
post-MVP. Use the existing drivers and no new dependencies by default.

For each workstream give dependencies, exact supported commands, source ownership, evidence and
cleanup criteria, required permissions/human involvement, and a stopping point. Identify any new
host operation or unsettled design that needs approval. Source tests are not host acceptance.
Ask only about decisions that cannot safely be derived; stop after the reviewable plan.
```
