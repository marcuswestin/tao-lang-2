# Test responsibility audit

This pass on `feat/test-responsibility` reviews authored tests, verification routines, and
production assertions against the responsibility policy in
[test-quality](../../agents/skills/test-quality/SKILL.md). Landing is a separate decision.

## Coverage and dispositions

The starting filename inventory is 588 TypeScript `*.test.ts` files, 47 Tao `*.test.tao`
files, and 24 `*.host.spec.ts` files. Runner registrations also select runtime Jest tests,
smoke files, fixtures, and generated templates. Filename counts alone do not establish audit
coverage. Detailed path accounting, batches, findings, and independent reviews are kept locally
under `.artifacts/audit/test-responsibility/`.

All ten workstreams completed. The consolidated baseline ledger accounts for 2,201 unique paths:
2,070 reviewed and 131 excluded with reasons, with no pending rows. Reconciliation of the 2,057
tracked executable/configuration candidates against that ledger left no unassigned paths. The
larger ledger also includes context documents and fixtures. Reviews combined runner discovery,
complete test/registration reads, and source scans followed by reads of assertion, validation,
error, mutable-state, and adapter sites; this is responsibility accounting, not a claim that every
source line received an independent review. New policy/scheduler files and their tests received
integration review separately.

| Workstream                  | Coverage                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Language and compiler       | Parser, validator, formatter, source actions, compiler and AST utilities            |
| Runtime and hosting         | Runtime/standard library, Expo host, plugins and native bindings                    |
| Data/services and shared/AI | Providers, services, shared utilities and implementation code                       |
| CLI and test infrastructure | Product/developer commands, drivers, host control and harnesses                     |
| Editors and applications    | Studio, companion, extension, active apps and behavior journeys                     |
| Primary seams               | Scheduling, selection, root/hidden configuration, workflows and canonical templates |

The 44 frozen future-app source/configuration/journey paths were reviewed read-only and remain
outside active discovery. Installed dependencies, generated output, secrets, and frozen archives
were excluded; static documentation/assets and configuration without checks are also accounted
as exclusions. Generated harness copies defer to their reviewed canonical sources.

- Replaced the URI path assertion in `parser-tests/package-api.test.ts` with a callable export
  check. [URI path construction](https://code.visualstudio.com/api/references/vscode-api#Uri) belongs to the dependency; the surviving package API test proves
  Tao's wrapper exports the callable API alongside its other public symbols.
- Retain real Git, Jest, browser, and native-tool integrations when they prove Tao invocation,
  configuration, encoding, state changes, cleanup, or error handling. Retain boundary checks for
  mutable/external data, fixture validity, Tao invariants, and necessary type narrowing.
- Removed the direct no-throw transpilation assertion in `studio-electrobun.test.ts`.
  [The bundler uses the transpiler](https://bun.sh/docs/bundler); the neighboring real build of the
  same materialized entrypoint and source-shape assertions retain Tao's packaging contract.
- Both changes received independent review. No production check met the removal standard.
  Retained examples include Git branch/worktree command selection and cleanup, Jest configuration
  and Tao runtime execution, source diagnostic invariants, unknown network/provider output,
  filesystem races, native lifecycle checks, and assertion error taxonomy. No expensive adapter
  execution was replaced merely because it involved an external tool.
- No test asserting header-first skill-reading behavior was found. The surviving profile and
  instruction tests exercise Tao's metadata parser, trigger descriptions, and routing-table
  propagation into its tools and Studio defaults; they do not claim to prove an agent's reading order.
- Retain the iOS fmt workaround pending confirmation of the resolved pod and supported Xcode
  build. The affected React Native 0.81/fmt 11.0.2/Xcode 26 combination has an
  [upstream fmt 12.1 fix in React Native 0.85](https://reactnative.dev/blog/2026/04/07/react-native-0.85).
  Tao currently pins React Native 0.86.3, but the resolved pod and supported Xcode build must be
  confirmed before removing the plugin and its insertion/idempotence/unknown-Podfile tests.
- Future R14 notification, timezone, Connection/Sync, and window/drop semantics are unresolved
  design material, preserved without turning proposals into implemented assertions.
- Fixed one fixture precondition discovered during verification: `app-modules.test.ts` now compiles
  its maintained native-bridge app before checking source-adjacent binding types, with runtime
  output isolated in a test-owned directory. Removing all three generated binding metadata files
  before running it still passed all six tests; the original real TypeScript check remains.

Ambiguous checks stay in place. Two assertion changes are the outcome of the audit, not a target
for removal volume.

Finalization exposed one additional fixture assumption: `process-supervision.test.ts` expected a
real shell sleeping 150ms between outputs to keep within a 500ms idle deadline. System scheduling
[does not guarantee that cadence](https://pubs.opengroup.org/onlinepubs/009696799/functions/sleep.html).
The focused file passed, but the host broad run correctly reported a bound failure and stopped.
Its useful Tao proof is output-triggered deadline reset; that proof now uses controlled idle-timer
progression while retaining the real child/pipes and adjacent real timeout/tree checks. Removing
the output-triggered restart deliberately failed the replacement; production code was restored.
The restored file passes all 15 tests, and nested cleanup restores both timer overrides on failure.

The failed run also exposed an evidence-clock bug: gate verification passed monotonic elapsed
time to the ledger's calendar full-run boundary, producing a 1970 timestamp. The runner now captures
wall time separately and retains monotonic durations. A real graph/report/ledger regression proves
the full-run wall-clock boundary and that an aborted run leaves it unchanged; both corresponding
mutations failed, and the restored gate file passes 41 tests. These two concrete environment
findings are resolved in the developer-environment archive; native acceptance remains separate.

## Verification behavior

Broad checks, verification, changed tests, and unfiltered full tests fail fast. Explicit file,
directory, and nonempty name scopes collect failures; a repository-root target remains broad.
Retries and targeted mutation runs preserve their diagnostic behavior. Individual checkers retain
their diagnostics. Command help owns the public details, and
[verification-lanes](../../agents/skills/verification-lanes/SKILL.md) owns lane selection.

Failure policy is carried through test preparation and gate execution. A definite failure stops
new admissions; running work drains and releases resources. Timeout confirmation and known-flake
classification remain in the existing runner. Unstarted work produces no test observations or
complete-run evidence. A partially run suite reports its missing work rather than a full pass.

The catalog selects parser lexer and syntax-parse, validator phrases, and formatter phrases as
small core nodes. They are partitioned out of ordinary shards and run once. Expensive app/Expo
suites wait only on core nodes selected in that request, through an ordering barrier that includes
cleanup and failure classification. Confirmed failures stop admissions; tolerated raw failures and
timeouts retain their existing outcome policy. Targeted and changed scopes are not widened, and
unrelated checks have no global barrier.

## Measurements and evidence

Three uncontended warm samples after shared setup measured each file process, including startup:

| File                | Warm milliseconds | Median |
| ------------------- | ----------------- | ------ |
| Parser lexer        | 172, 163, 167     | 167    |
| Parser syntax-parse | 152, 155, 165     | 155    |
| Validator phrases   | 273, 262, 265     | 265    |
| Formatter phrases   | 180, 176, 173     | 176    |

The separate-process median sum is 763ms. This fits the approximately three-second file and
ten-second combined selection budgets; these are not timing assertions. A contended validator
sample was excluded and replaced. Raw summaries are indexed in local `core-samples.json`.
This does not promise a faster successful full run.

Focused tests prove explicit failure policy, root-target handling, no selection widening, one
execution per core file across shard counts, delayed app admission, and honest partial reporting.
Disabling the final app ordering barrier deliberately failed three assertions, including premature
app admission and shared preparation; disabling broad failure policy also failed its admission
test. Both implementations were restored. The definite-core-failure fixture prevented its app
node from being admitted. Existing graph and gate tests cover timeout confirmation and resource
release. The final verification package run passed 796 tests in 40 files, including real ledger
history for tolerated core flakes and incomplete-run reporting. Raw mutation and focused evidence
is in the task-local command logs. Broad, sandbox, and reachable host results are recorded in the
lane reports; an interrupted or skipped host lane establishes no host acceptance.

The committed implementation passed uncached `verify-changed` (100.7s), complete `verify` (162.2s),
and `verify-full-sandbox` (261.5s). The changed lane confirmed two contention timeouts by isolated
passing retries; the complete and sandbox lanes reported no failed nodes. Sandbox verification
included bundle proof and explicitly skipped nine host-only gates. Logs are respectively under
`.artifacts/logs/verify-changed/2026-10-01T19-17-21-132Z-51580-bbde8fc1/`,
`.artifacts/logs/verify/2026-10-01T19-19-22-970Z-70842-66d25a55/`, and
`.artifacts/logs/verify-full-sandbox/2026-10-01T19-22-18-740Z-99197-6c223870/`.
The complete run's core nodes used 448ms parser, 747ms validator, and 353ms formatter (1.548s
combined process time under load); sandbox core nodes used 4.184s combined. These successful runs
avoided no admissions, whereas the controlled failure fixture prevented its app admission.

Full native host acceptance remains outstanding: the listed host operations cover browser smoke
files, but omit standalone `verify-full`, native smoke, and native canary. This observed command gap
is recorded in the developer-environment ledger; permission reach is unchanged.

All seven reachable host browser files passed (12 tests): launch and ownership cleanup, real-app
compile/edit/undo and live Metro refresh, simulated-user edits, keyboard navigation, dialog teardown,
agent-chat ordering/stale undo, and network simulation. Their command reports are in
`.artifacts/logs/agent/studio-smoke/2026-10-01T19-27-44-449Z-68921.log`, neighboring keyboard/dialog
and `19-28-14`/`19-28-15` reports, plus
`.artifacts/logs/agent/studio-proof-real-app/2026-10-01T19-28-57-943Z-76022.log`.
These are separate browser acceptance results, not a complete native `verify-full` claim.

The first finalization run reported a definite process-fixture assertion failure, drained its
running work, and reported 100 checks not run, including runtime/app work. Its incomplete evidence
is preserved under `.artifacts/logs/verify/2026-10-01T19-33-22-800Z-8510-3a0295de/`; the prior green
implementation runs do not make that finalization green. This is observed admission avoidance,
not a performance comparison between runs with different host scheduling load.

One display-only edge remains: during asynchronous classification of an already failed ordering
prerequisite, the TUI may briefly say its dependent is waiting for local capacity. The scheduler
still waits for classification and cleanup; execution and evidence are unaffected.

Recommend a separate [recurring repository pass](<Recurring repository pass.md>) for unrelated
cross-cutting concerns; this pass changes neither dependency pins nor permission reach nor model routing.
