# Test responsibility audit

This pass on `feat/test-responsibility` reviews authored tests, verification routines, and
production assertions against the responsibility policy in
[test-quality](../../agents/skills/test-quality/SKILL.md). Landing is a separate decision.

## Coverage and dispositions

### Serial reduction follow-up

The follow-up starts at `3d8e49906` with 707 authored test files: 589 TypeScript tests,
47 Tao journeys, 47 runtime Jest files, and 24 host specs. Its exact ordered queue and
per-file dispositions live in `.artifacts/audit/test-responsibility/serial-pass/`.
Each file is read afresh, one at a time; independent package reviews run while the primary
review pauses. Completion of the first audit below does not imply completion of this follow-up.

The shared package is the first completed group: 12 files read, eight runnable cases removed,
and repetitive assertions/input variants trimmed. The large shared suite now passes 95 cases,
the helper suite 20, and the dispatch suite three. Removed cases covered native filesystem
delegation, duplicate identity/settlement examples, a native module-mocking smoke, a repeated
rollback failure input, and a trivial no-op return. Tao-owned rollback, races, supervision,
guarding, adapter decisions, and cleanup remain covered. Two elapsed-time upper-bound
assertions were removed; timeout abandonment still has a never-settling Deferred proof.
The existing child-completion stress regression remains, marked `REMOVAL CANDIDATE` pending
a smaller fixture that reliably reproduces the known upstream defect. Independent review
found no actionable gaps. The shared reduction is committed at `edfeb4fa2`.

The next group has all 32 parser files read afresh. Proposed changes remove eight redundant
cases: simple binding, comma/newline, command-list, dotted design-reference, positive dialect,
render injection, retired parameter rejection, and source-string smoke
examples. Richer owning-layer proofs survive. Two fixture consolidations retain immutable-keyword and unresolved-reference wording/range
proofs in surviving cases; neither counts as a removed case. Repeated
helper-enforced diagnostics checks and table rows are trimmed. Diagnostic and scenario fixture
thinning exposed claims that were broader than their actual errors; the surviving fixtures now
isolate their stated malformed syntax. Focused changed files and the complete parser package pass (193 runnable cases).
Independent review checked all 14 changed files and the module-local helper cleanup,
finding no actionable gaps. `verify-changed` passed after removing the helper's unused export.

All three AST utility files are read and independently reviewed. One redundant basic invocation
case is removed; out-of-order argument mapping retains the stronger proof. Package discovery
keeps actual cache invalidation, symlink retargeting, and project/package boundaries while
trimming redundant physical-path map assertions and unrelated fixture rows.

All 46 validator files are read and independently reviewed. The package's measured runnable
count falls from 934 to 864: 69 discarded cases and one unchanged-proof consolidation. Reductions
thin repeated diagnostic/syntax examples, positive variants already covered at their owning
boundary, and repeated view/function optional-parameter matrices. Located diagnostics, cross-file
identity, external configuration validation, entity/provider boundaries, and failure contracts
remain. Independent review identified two distinct positive branches to retain: local boolean
state toggling and one-term zero padding. Both original proofs were restored and their files
passed before the complete validator package passed all 864 cases.

All 24 formatter files are read and independently reviewed. Five cases are removed: basic
constructor, shallow brace-collapse, already canonical parameter, duplicate visibility, and
injection-indentation examples. Review restored the positional child-view invocation proof
because its formatting handler differs from app-root and function calls. The complete formatter
package passes 100 cases. Exact canonical output, idempotency, comment/fence handling, and
invalid-source/embedded-TypeScript failure behavior remain covered.

All five source-action files are read and independently reviewed. Runner evidence falls from
212 to 177 cases. One typed-design no-change smoke is covered by each migration's second full
fix pass; the repeated import-usage matrix is tested once through its owning analysis rather
than twice through both entrypoints. Dedicated reconstruction, comment, ordering, and quickfix
integration proofs remain. Nine simpler Studio patch fixtures are covered by stronger tagged,
scoped, destination, journey, and extraction examples. Review restored assertions for alias-slot
duplicates and clearing promoted inline values. Whole-project links, fixture identity, stale
anchors, escaping, and malformed requests remain; the full palette catalog stays executable
with a reduction-candidate marker. Complete source-action verification passes 177 cases.

All 36 compiler files are freshly read and independently reviewed. Runner evidence falls from
233 to 228 cases. Removed examples are basic debug-off, sibling file compilation, phone viewport
defaults, default-target relocation smoke, and a broad nested-package workspace pipeline. Exact
generated contracts, shared-file isolation, LSP registrations and source ownership remain.
Review restored representative promoted-design release acceptance, a refined app's design override,
and the sole mixed-type equality rejection. Repeated release input variants are still thinned.
An async assertion previously sliced away any preceding `await`; its corrected matcher detects
an intentionally added `await` in a raw mutation run. The emitter was restored and focused
verification passed. The complete compiler package passes all 228 cases.

All 58 runtime files are freshly read. Accepted reductions remove 25 cases: fake-provider
conformance, redundant facade surface smoke, shallow layout/fill/query/debug examples, repeated
navigation/restoration round-trips, default-language examples, five AppState reducer outcomes
already proven through the installed listener, a duplicate inspect edge, a vacuous clock proof,
and a pure design-resolution example. Distinct adapter decisions, state transitions, trust,
reconnection, cleanup, accessibility, and mounted integration contracts remain. Eight runtime
candidates remain executable. Independent review restored the positive Workspace command-applicability assertion; all other
removals retain credible surviving proofs or discard low-value variants. Complete runtime
verification passes 688 cases across 58 files, compared with the earlier complete proof of 713.

The held-press test now invokes a controlled callback rather than sleeping; disabling click
suppression made its assertion fail. The preview target-acquisition test establishes its first
missing lookup through microtask sequencing rather than sleeping; disabling retrying made that
case fail. Both production files were restored with no diff, and the restored files pass six and
47 cases respectively. A probabilistic six-digit pairing-code inequality was also removed because
valid codes can collide; transcript and direction-key assertions remain.

All eight standard-library test files are freshly read and independently reviewed. Four files
trim assertions or repeated inputs, with no runnable cases removed. Clerk proof expiry uses a
fixed claim fixture and exact milliseconds instead of real-clock comparison. Unknown error-code
variants are reduced to a prototype-sensitive input with private metadata; all known mappings
remain. Repeated iCloud roundtrip/name assertions are covered by conformance and key/container
proofs. Review restored account-specific capture identity for runtime snapshots and the small
InstantDB sidecar wiring smoke, which remains executable as a removal candidate. Account isolation,
cancellation, revocation, durable-write drains, and sync conflicts remain. The complete package
passes 87 cases, matching the earlier complete count.

All ten provider files are freshly read. Accepted changes remove one repeated same-input schema
mapping case and trim SDK-fixture/backend assertions. An expensive two-process CloudKit example
is consolidated into the existing controlled native fixture, preserving early-event buffering,
durable replay, acknowledgments, listener ordering, and structural state names. This consolidation
does not count as a discarded case. Disabling buffering failed the rewritten assertion; production
bytes were restored and the file passed. The source-text Swift inbox guard stays executable with
a candidate marker pending native failure-order coverage. Conditional live integration cases remain;
default runs skip them and provide no live acceptance. Independent provider review found no actionable gaps. Package verification passes 54 cases; seven opt-in live cases are skipped.

All nine account-server files are freshly read. Accepted reductions remove repeated fixture
self-checks, open-handle mode refusal, shallow remount shape, and duplicate configuration inputs.
The native no-Origin exception retains its own party/Origin controls and representative invalid
sessions alongside the ordinary full claim matrix. Actual HTTP/SQLite transactions, process races,
offline custody, automatic logout cleanup, encrypted outboxes, canonical receipts, and recovery
remain. No cases are removed from this package. Review restored an empty audience-list member as a distinct configuration boundary. Full package verification passes 50 cases; ten conditional live cases are skipped.

The update-server test file is freshly read and independently reviewed. Four repeated fixture or
HTTP-standard assertions and an orphan recording wrapper are removed. All six Tao upload,
asset/cache, rollback, authorization, history, and content-hash contracts remain and pass.

The six generation-package files are freshly read. Changes remove repeated presence/status
assertions, a second equivalent non-finite-number input, and duplicate direct-relation schema
compilation. All 31 runnable cases remain; model adapters, schema/acceptance gates, streaming,
terminal-event handling, cancellation, and portable package boundaries retain their own proofs.
Independent generation review restored the separate child working-directory isolation proof; the complete package passes all 31 cases.

Both skill-package files and the CLI-kit test are freshly read and independently reviewed.
All twelve skill cases and five CLI-kit cases pass; reductions trim repeated fixture/header,
exit-status, and short-wrap assertions.

All 78 product CLI files are freshly read and independently reviewed. Changes remove
21 actual cases, repeated assertions and input variants, and copied helpers. Richer command,
adapter, cache, formatting, creation, shipping, selection, failure and publication proofs remain.
The TUI mount assertion uses the stop-flush contract instead of a fixed sleep; an omitted final
rerender failed it. Two shipping checkpoint tests previously ran outside Git and therefore never
proved their terminal-build and dirty-artifact guards. Their repaired Git fixtures fail when those
guards are disabled. Transaction claim displacement and stale checkpoint ordering now use explicit
handshakes; omission of reacquisition and leakage of stale installs fail the rewritten assertions.
All tested guards were restored. The now-unused delay-only transaction test control is removed.

Two CLI polling-watcher examples now use controlled callbacks and exact selected roots; deliberate
root truncation and omission of an empty selected directory fail them. One real file-change,
debounce and compiler integration remains, passes, reuses canonical fixtures, and cleans up its
watcher/runtime even on failure. Repeated metadata mutation comparisons in the standalone audit
are thinned to changed-file, changed-directory and added-directory representatives, retaining
all allowed shapes and rejection boundaries. The 32-start resource publication stress proof remains
executable with a candidate marker pending a controlled losing-publisher replacement.
Independent review restored the watcher error import and a nested JavaScript export readback;
both repaired files pass. The reduced metadata matrix retains the distinct policy branches.
The complete product CLI package passes 429 cases with one live integration skip
(`2026-10-02T21-47-55-963Z-19785-0d6ff753`), down from 451 runnable cases including that skip.
The subsequent changed gate found two exports whose only external consumers were removed tests;
the diagnostic-location and update-request-header functions remain unchanged and module-private.

All 42 developer CLI files have now received fresh serial reads. Five more runnable cases were
removed: duplicated environment setup and healthy-path smoke checks, plus two weak secret-format
variants. Secret credential-count/encoding, immutable diagnosis, guarded recovery and stale
worktree refusal proofs remain. Dependency log wording and equivalent inputs were thinned;
the generic child-priority probe was removed while the real work-graph child proof remains.
The configured reminder reader now uses a small owned fixture rather than mutable repository prose.
The setup recipe retains its prerequisite order proof; generic recipe dependency execution is
[documented by the runner](https://just.systems/man/en/dependencies.html). The ordering mutation
failed and the canonical recipe was restored. Independent developer CLI review found no actionable gaps across 27 changed paths. Two unused
test-only native-check parser exports were removed; their guarded production implementations
remain unchanged and covered through the real checker. The complete package passes 403 cases (408 before), plus four unchanged performance-reporting
cases in their separately registered suite (`2026-10-02T22-32-45-287Z-72641-50bedeed`).

All 22 agent CLI files have received fresh serial reads. Seven runnable cases were removed:
duplicate command rejection, report-helper smoke checks, an unconditional-bootstrap profile
variant, a generic override variant, and a direct plumbing-only Git test. Git documents
[commit hooks](https://git-scm.com/docs/githooks) and the
[commit-tree object constructor](https://git-scm.com/docs/git-commit-tree); the deleted test
called that constructor directly without exercising Tao landing code. Real Tao hook installation,
worktree state changes, safe removal, runner cleanup, and summary provenance proofs remain.
Exact cloud lifecycle configuration now replaces repeated execution of the same shell command.
Independent review accepted all 12 changed paths. The complete agent CLI package passes 219
cases, down from 226 (`2026-10-02T22-59-43-045Z-39030-9bef9b59`).

Native bindings retains installed-declaration adapters, strict generated-code checking, unsupported
shape diagnostics, publication ownership and failure preservation. One generic two-publisher smoke
case was removed in favor of the stronger partial-publication regression proof and shared publisher
coverage. A repeated Haptics stability assertion was removed; Clipboard retains the representative
stability proof. Independent review accepted the reduction; the complete package passes 14 cases
(`2026-10-02T23-05-29-009Z-81174-685a62e4`), down from 15.

All 22 Expo-host TypeScript files have now received fresh serial reads. Twelve runnable cases
were removed: repeated port selection, cache-helper finally/reader smoke checks, ZIP fixture
self-testing, an equivalent message-only rollback error, name composition, shard ceilings and
output cleanup, default cache root/index preservation, watch-root smoke, and forced-close results.
Live reader/ownership, uncertain external state, publication rollback, cross-process cache budgets,
archive acceptance, protocol errors, and worker escalation remain. Debouncer policy now uses
controlled pending callbacks; removing cancellation failed three assertions and the source was
restored. A known supported-runtime server-stop regression remains documented with its version
and removal condition. Four new executable candidates retain stress/mirrored-generated-code
coverage. Independent review accepted all 17 changed paths after restoring configured-delay
and genuine before/after byte-stability proofs. Both corrected files and full typecheck pass; a
byte-instability mutation fails the new snapshot assertion, with production source restored.
The full package gate passes 252 TypeScript cases (264 before), plus263 unchanged runtime Jest
cases (`2026-10-03T06-02-02-419Z-65101-ab770294`).

All 47 runtime Jest files have now received fresh serial reads. Thirteen registered cases were
removed: basic nested-stack and provider-construction examples, scalar-injection smoke, three
language-value examples, private-gap layout repetition, installed dependency export checks,
two runtime rendering variants, a fixture-only pre-fix demonstration, simple preview-error
smoke and ordinary press/update repetition. One additional identical embedded Tao journey check
was removed; it is not counted as an outer Jest case. Independent package review accepted all 37 changed files, including the whole scalar-injection
file deletion and obsolete lint allowance cleanup; every meaningfully changed file has passed
its focused run. The reviewer questioned loss of the installed native-package export smoke. It
called the dependency directly without exercising Tao; the accepted tradeoff drops cheap upstream
export detection while retaining typed adapter fixtures and separate mounted native host receipts.
Mounted history, retained state, asks, accessibility dismissal, callback lifetimes, real native
persistence, compiled library adapters and Studio acknowledgment/replay contracts remain.

Three new executable candidates identify copied generated-host comparisons/lifetimes, retained
until generated-root execution can prove their wiring. A vacuous capture assertion previously
buried credentials/oversized data beyond the depth cutoff; the existing case now verifies their
actual shallow transformed output. The split-pane gesture proof now controls its clock rather
than depending on event speed. Omitting termination cleanup failed the intended write assertion;
the production file was restored exactly and the focused proof passed.

The editor-extension test file is freshly read and independently reviewed. Three cases were
removed: a repeated rollback failure message, direct structural/inferred LSP smoke and weaker
bridged-export suppression. The compiler workspace suite retains richer LSP/standalone parity
and bridge suppression alongside ordinary missing-name rejection. Extension packaging, grammar,
formatting, source actions, workspace planning and scoped diagnostics remain. The complete
one-file package passes 12 cases, down from 15.

All 83 Studio test files are freshly read, with 28 actual cases
removed and three unchanged-proof consolidations. Independent review checked all 58 changed
paths and found no actionable distinct coverage gap. Simpler verdict, position, watcher and device-move cases repeat surviving
stronger proofs. Brittle instruction phrase checks, bundle/CSS feature-string inventories,
CodeMirror default remapping demonstrations and redundant assertions were trimmed. Bundle
configuration escaping, module singleton regressions, portal targets and the real editor,
protocol, approval and failure-handling contracts remain. Seven client timeout proofs now
deliver controlled callbacks; a device Lens rejection uses a protocol reply rather than a
10 ms sleep. All seven deliberate cancellation, retry, lifecycle and freshness mutations
failed in their intended tests; production files were restored exactly. The client passes
110 cases (111 before), gateway 27 (28 before), and typecheck passes. Studio's package review
is complete; the complete package passes all 833 cases and current typecheck passes; the subsequent changed gate passes 42 checks with one skip. The device panel now uses a QR fixture
to test URL handoff, display and copy rather than upstream SVG geometry; its countdown uses a
fixed clock. A duplicate shared dispatch case, basic loop transaction and no-decision availability
forwarding case were removed. Feed generator/inventory value goldens and vacuous seed inequality
were trimmed; real compiler, draft rollback and external-write ownership coverage remains.
Overlapping matrix registration, direct root, capture-save, render-inspection and selection-carry
cases were removed; a route-alias case and its unused test export were deleted. Shared-fixture
import variants were thinned. Source-string application inventories and duplicate helper
assertions were trimmed with their static wiring tradeoffs recorded. The real watcher smoke
now awaits an external change; exact echo policy stays with coordinator tests. Watcher hash
ordering and cross-process catalog contention now use explicit signals and cleanup. Bypassing
each ordering/lock mechanism fails its intended proof, and production sources were restored
exactly. Project session passes 49 cases (51 before). Sketch session passes 38 (41 before),
projection six (eleven before), and mounted sketch-view 37 (38 before). The sixteen projection
goldens remain; permutation and non-Text variants are thinned without counting them as cases.
Three real second-process contention proofs share an explicit blocked-poll fixture; bypassing
the catalog lock fails all three. A reclaim-race proof uses explicit signals and fails when
the combined ownership guard is bypassed. These runs assert ordering and cleanup, not elapsed
time. All mutated guards were restored exactly. The three shifted raw-error allowance sites
were updated; no verification thresholds were changed. The broad unused-export check
identified two bindings whose only external consumers were removed tests; `firstLine` and
`StudioPaneMinimums` remain unchanged inside their owning modules and are now private.
Independent review accepted both changes.

All 707 authored test files have received fresh serial reads and independent package reviews.
The pass discards 317 runnable cases; seven unchanged-proof consolidations receive no removal
credit. Four whole files are deleted, leaving 703 authored files. Compared with the follow-up
baseline, their source contains 1394 fewer uppercase `Expect` call sites and 5445 fewer lines
(189819 to 184374). These literal counts exclude lowercase Jest and Tao `expect` calls and do
not represent runtime assertion counts. Seventy-three executable removal-candidate comments
retain uncertain overlaps and their coverage tradeoffs. No deletion quota or exact parity
claim is imposed.

Final registration reconciliation accounts for 575 ordinary Bun package files, one special
performance-report fixture file, 46 runtime Jest files, and 42 ordinary Tao journey files:
664 files selected by ordinary complete verification, compared with 668 at the baseline. The
remaining 39 authored sources are 13 explicitly dispatched Studio smokes, 24 opt-in Playwright
host specs, the native Clipboard journey, and the Clockwork host fixture. They are accounted
separately rather than treated as orphaned. No additional authored test suffix or Tao test
source is found outside the queue. The canonical emitted starter template and active absorbed
Next mirrors are reconciled without duplicate removal credit. Hidden configuration, workflow
checks and non-test verification routines remain accounted by the original source audit below;
current runner catalogs and workflow membership were rechecked serially. Production checks
and runtime guards remain unchanged. Existing source-location allowlists follow edited lines;
the deleted scalar-injection file is removed from its registration.

Representative runnable-case comparisons are:

| Owning boundary              | Before | After |                              Discarded cases |
| ---------------------------- | -----: | ----: | -------------------------------------------: |
| Validator                    |    934 |   864 |          69, plus one consolidation excluded |
| Source actions               |    212 |   177 |                                           35 |
| Compiler                     |    233 |   228 |                                            5 |
| Runtime                      |    713 |   688 |                                           25 |
| Runtime Jest                 |    263 |   250 |                                           13 |
| Studio                       |    864 |   833 |       28, plus three consolidations excluded |
| Studio tooling               |    345 |   333 |                                           12 |
| Active authored app journeys |    164 |   143 | 21, including one retained host-only journey |
| Host-free controls           |    161 |   154 |                                            7 |

Package runner evidence establishes the surviving case counts; the host-free baseline is
registration accounting, and the current controls runner confirms 154 passes. The final changed runner reports 6023 Bun cases (18 conditional skips), 250 runtime Jest cases
and 142 ordinary Tao journeys: 6415 registered cases in that ordinary scope. Current runner
counts are separate from the 154 controlled host cases and the unexercised real-host sources;
no repository-wide baseline is inferred from filename or assertion counts. The final sharded sandbox
run reports 143 Tao executions because the nested Runtime Default journey runs in both its
parent and child shards: 142 distinct ordinary journeys remain. This existing scheduling
overlap is recorded in [the environment ledger](<Developer environment upgrades/DEVENV-NESTED-TAO-JOURNEYS-RUN-IN-OVERLAPPING-SHARDS.md>); the useful authored test and completed scheduler
changes are retained. It receives no deletion credit.

The final E2E and host-spec reviews retain real session isolation, stale lease/observation/
revision fences, scoped input, publication, immutable acceptance, native reveal and ownership
cleanup. Seven host-control cases are discarded: four repeated adapter geometry variants,
a simpler delayed-target path, a standalone hidden-target subset, and an empty unowned-root
subset. The geometry owner is the native driver; stronger fresh-observation and artifact
ownership proofs remain. Five host candidate comments preserve uncertain browser duplication
and the replacement fixture timer pending reachable real-host validation. The host-free controls
pass 154 cases; this proves controlled adapters and policy, not real browser or device acceptance.

The verification pass retains Tao-owned admission, cleanup, failure classification and cache
invalidation contracts while removing repeated success variations and helper assertions. The
compile-contention proof observes the real lock inspector before releasing the first compiler;
it replaces a 100ms negative wait. Deliberately bypassing the lock or dropping the in-lock cache
check fails the intended case; the exact production source is restored and all 25 cases pass.
The landing-lock reporting proof drops an actual elapsed-time bound and observes the holder
callback before controlled release. A symlink-fingerprint assertion now compares the state
immediately before the link change, and a finalize toolchain fixture uses the accepted lane name.
Neither correction changes production behavior or the completed scheduler.

The parser-generation contention proof uses the same real-lock handshake. Bypassing its lock
or omitting its in-lock cache check fails the intended case; the production source is restored
and all 28 cases pass. Thirty actual cases are discarded across this package. The WorkGraph
real CPU subset is covered by the surviving RunArtifacts real runner/accounting proof; single
dependency coverage remains in the controlled multi-writer case. Real elapsed-wait and timestamp
comparisons are removed; fixed-state reporting arithmetic and cancellation timeouts remain.

All 46 active application journey files are freshly read. Independent review accepted all 34
changed paths and their named surviving proofs. Twenty-one actual journeys are removed: the authored
case tally falls from 164 to 143 including one separate host-only Clipboard journey. The final ordinary runner confirms
142 passed cases across 42 selected files, including the canonical Notebook reduction.
Clipboard remains the separate host-only case. Three static smoke files are deleted because existing
mounted tests compile those exact layout, native bridge and UI stdlib apps and assert their
properties or native calls. Auth, data, navigation, search and fixture input variants are thinned;
WordFlower keeps app-specific edit/export/sync failure, focus lifetime, validation, commands,
search, cascade and shell-content contracts. Seven new uncertain overlaps remain executable
candidates. The four active absorbed WordFlower Next test mirrors receive the identical reviewed
reductions required by the existing Current/Next parity contract; they add no removal credit and
change no future semantics. Frozen future apps and archives remain excluded.

Studio tooling removes twelve actual cases while retaining native/device configuration,
identity-owned shutdown, publication/provenance, cleanup and real-host integration contracts.
Startup acknowledgements and injected clocks replace elapsed speed assertions. Deliberate
running-state and process-group cancellation mutations fail the intended assertions; exact
production sources were restored. The surviving simulator caller preparation-failure case
passes in its complete 55-case file. Broader failure matrices are thinned. Existing raw-error
allowance offsets follow edited lines without increasing allowances.

The final centralized changed gate passes (`2026-10-03T20-00-16-956Z-43912-94c11a20`).
Its account-server integration times out under three concurrent lanes, then passes the runner's
isolated retry and is classified as contention. Complete verification passes
(`2026-10-03T20-06-49-986Z-99663-6c3e60e4`), reusing matching-tree proof for most work.
Full sandbox verification passes (`2026-10-03T20-08-46-237Z-13110-9cb4fcfb`), including
bundle proof and environment diagnosis; nine host-only gates are explicitly omitted.
The final evidence records and any report-refresh confirmation are centralized in
`.artifacts/audit/test-responsibility/serial-pass/completion-evidence.json`.
These are correctness outcomes, with no timing comparison. The earlier passing changed gate
(`2026-10-03T16-17-13-456Z-57127-9489a201`) predates applications.
The subsequent application gate (`2026-10-03T18-02-54-042Z-86492-bc07b659`) stopped on the
Watch exporter test's stale authored-operation inventory: 24 checks passed, one failed and
143 checks were not run. Running work drained; this aborted result establishes no complete
verification. The exporter expectation is updated to the reviewed journey while retaining
exact order, limit/reset and source attribution; its full eight-case file passes. That file was
freshly read ahead of the queue because of the concrete failure. All four driver files are
freshly read and independently reviewed; four assertions duplicated stronger pointer/target
or ordered lease-event proofs and were removed. All fourteen cases remain. The changed
controller and acceptance files pass their three and two cases. All three host-control files
are read and independently reviewed; all eight safety/namespace cases remain.

The next gate (`2026-10-03T18-13-31-955Z-2501-253d11e3`) passes the Watch exporter and
driver/host-control checks, then stops on Pantry starter byte parity: the shared creation-test
template still emits the removed generic Local-provider relaunch journey. It has 35 passed
checks, one failure and 71 checks unrun. Independent review accepted removing that test at
its canonical lowering source and synchronizing Notebook, one additional actual case removal.
Per-entity create/open/rename/back journeys and all generated app code remain. This changes the
tests emitted by `tao create`; it trades the exact generated StorageKey relaunch pairing for
runtime/local-data persistence proof and starter configuration byte parity. Both starter parity
files pass one case each, and Notebook passes its remaining Tao journey. Both aborted gates remain failure evidence. Final changed, complete and sandbox run records
are centralized in `.artifacts/audit/test-responsibility/serial-pass/completion-evidence.json`;
only their explicit outcomes establish final verification. Broad runs retain fail-fast admission,
drain running work and release leases before scoped diagnosis.

Complete Studio passes 833 cases (`2026-10-03T09-20-03-210Z-18814-e2ce8fc4`). Complete Expo
passes 252 TypeScript and 250 runtime Jest cases (`2026-10-03T07-04-54-661Z-13552-8e38866a`),
compared with the prior 263 Jest cases. The complete deterministic tooling package passes 333
cases (`2026-10-03T16-16-43-036Z-54447-9a39b90a`) and typecheck passes
(`2026-10-03T16-16-23-807Z-52880`).

Parser and subsequent package changes are committed at `d5f602442`. After the Developer changed
the task's approval setting and authorized a retry, the guarded script passed `verify-changed`
(`2026-10-03T21-18-30-926Z-35801-ac5f8fb7`), rechecked all 472 reviewed paths, and committed
only those paths. Git inspection confirmed a clean worktree and index. The resolved metadata
denial is archived in the environment ledger; repository permission reach is unchanged.
The earlier named host smoke refused before dispatch while still sandboxed: no browser/native
process started, so changed smoke files have no new host acceptance. Host verification and
finalization remain outstanding; the earlier `finalize --check` dirty-tree refusal
(`2026-10-03T20-10-47-125Z-26841`) is historical evidence. No landing has been attempted.
No new speed comparison has been collected. Gate durations under parallel load are correctness
metadata only; no faster-successful-run claim is made. A separate recurring repository pass is
recommended for cross-cutting environment, routing and host-operation gaps recorded here.

The permission-recovery documentation gate exposed a malformed-handshake fixture racing its
shared 60 ms expiry under contention (`2026-10-03T21-20-31-033Z-50300-27118856`); the unchanged
file passed all 27 cases in scoped diagnosis. The malformed-input checks now use the normal
deadline, while a separate sequential fixture retains the short expiry for a silent connection.
All assertions and cases remain, cleanup is unchanged, independent review found no gaps, and
the amended file passes all 27 cases (`2026-10-03T21-26-15-490Z-94546-500736ab`). This is a
fixture correction, not another removal or a timing comparison. Final follow-up gate evidence
is recorded with the other centralized run records.

The developer CLI changed gate stopped on an unchanged Studio legacy-lock process case; its
complete isolated file then passed 16 cases. The aborted run left 49 checks unrun and establishes
no complete verification. The environment ledger records the intermittent proof and its uncertain
release/process-exit interleaving. The rewritten fixture signals its blocked poll and keeps the
independent owner alive until opening is acknowledged, removing its elapsed-time negative
assertion. Bypassing the production legacy barrier fails the intended proof; the source is
restored exactly and the complete file passes 16 cases. Independent Studio review accepted the fixture; the subsequent changed gate passes 42 checks with one skip. Production guards remain unchanged.

Runnable-case reductions count actual cases, including parameter rows. Consolidation and
parameterization alone do not count as reductions. Aggressive candidates remain executable
with an inline `// REMOVAL CANDIDATE: <reason>` comment. Production behavior, runtime guards,
dependencies, permissions, and the completed scheduling policy remain unchanged.

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
release. The initial verification package run passed 796 tests in 40 files, including real ledger
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

After the idle-reset and ledger-clock repairs, uncached changed verification passed in 66.8s.
Complete verification then passed every check, including all app and runtime suites, but rejected
green evidence because a temporary Watchman cookie disappeared between tree snapshots. Its test
results and corrected full-test wall-clock boundary are retained under
`.artifacts/logs/verify/2026-10-01T19-59-26-856Z-49771-70f0917e/`; it is not green tree evidence.
The repository now excludes the tool's reserved `.watchman-cookie-*` artifacts according to
[Watchman's synchronization contract](https://facebook.github.io/watchman/docs/cookies), preserving
the source-drift guard. The concrete exclusion finding is resolved in the environment archive.

With that exclusion, changed verification passed in 49.2s, uncached complete verification passed
in 110.8s, and uncached full sandbox verification passed in 117.8s with nine explicit host skips.
The final verification package passed 797 tests in 40 files. Complete and sandbox reports are under
`.artifacts/logs/verify/2026-10-01T20-06-36-095Z-39039-def4660f/` and
`.artifacts/logs/verify-full-sandbox/2026-10-01T20-08-54-109Z-78967-0eae00bc/`.
Their core process sums were 1.517s and 1.455s respectively. The production ledger recorded the
complete run's calendar start, `2026-10-01T20:06:36.095Z`. No performance comparison is inferred from
these load-dependent lane durations. No core dependency was unselected or admitted twice.

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
