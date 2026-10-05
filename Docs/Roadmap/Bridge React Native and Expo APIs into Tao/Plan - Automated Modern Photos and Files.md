# Automated Modern Photos and Files bridges

## Execution checkpoint

The complete hosted run at `9db8b07a5` passed all twelve partitions and aggregate
Verify. Pull request #9 then merged as `b4c88165` on 2026-10-05. The subsequent
main run #34 exposed a repeatable native receipt test deadline: the wrapper
signature-change scenario timed out in both the initial run and isolated retry.
Its warm-up redundantly repeats a full native check after watcher initialization;
a separate follow-up removes that extra warm-up while retaining actual receipt
reuse, signature mutation and both implementation/contract diagnostics. Both
receipt tests pass locally (31.2 seconds total), and repository lint passes.
Main run #34 completed with eleven passing partitions and this sole failing
partition; hosted validation of the correction is pending. Native device-operation
journeys remain unproved.

Hosted follow-up #36 passed eleven partitions, including the corrected native
receipt scope. The ordinary receipt file completed all fifteen cases in both
attempts: the initial run took 606.6 seconds with one source/config deadline,
and isolated retry took 482.5 seconds with one publication deadline. Its combined
execution time was 1,089.2 seconds; queue waits are separate. The correction
separates independent source/config and publication mutations and moves receipt
coverage into five smaller singleton file cohorts, preserving cold parity,
repair, race and lifecycle assertions. The ten restructured reuse/publication and
input cases pass locally (113.1 and 102.0 seconds per cohort); the 43 registry
checks and repository lint pass. Independent review verifies the ten unchanged
standalone bodies and retained mutation assertions. Complete hosted validation
of all nineteen cases remains pending.
Two CLI scopes passed on isolated retry; those timeout observations are retained.

Implementation started on `feat/native-photos-files` from main `e33f2d5ab`.
The shared object reader, emitter, reference groups, boxed values, bytes and
call-scoped callbacks are implemented. The writer supports separate Tao and
TypeScript roots with atomic publication and read-only freshness checks.
Both pinned declaration inventories have zero extraction diagnostics: Photos
has 67 operations and Files has 218, including reached transitive protocols and
the shared global cancellation controller. Both generated stdlib modules are
published locally through the atomic maintained generator. Strict generation,
publication, resource relocation and CLI freshness tests pass. Project checking
of the actual native bodies and Tao signature contracts passes focused tests in
an isolated native type environment; ordinary sidecars consume declaration views.
Successful source checks alone do not establish executable coverage.

Verified descriptor-derived type origins preserve nominal native handles in Tao
contracts, including callbacks and nested values. Focused checking rejects a fresh
but incompatible implementation even when the consumer is entirely Tao, and
checks imported authored runtime bodies excluded from configuration root lists.
Native contract views remain reader-local; checking a consumer does not publish
compiler contracts into its installed stdlib. Exact-file polling plus scoped
membership inventories observe generation-engine and input/output recovery,
including external changes, nested additions, output replacement and deletion.
Focused watcher and complete service lifecycle suites pass; disposal joins an
active inventory scan and suppresses subsequent work. Missing dependency roots
remain inventoried through staged creation and installation. Actual emitted
declaration views reject File/Directory and pending-result family mismatches;
pure Tao and handwritten consumer checking both have focused passing regressions.
Independent review of these shared seams is complete. Full integration gates
and final packaged acceptance remain outstanding.

Final integration testing exposed two runtime regressions. Native family brands
now use erased declaration-merging interfaces: their emitted declaration views
retain the family, while the actual Metro transformer accepts their runtime
source. Policy-free presses preserve immediate invocation and returned completion;
owned actions retain their dequeue guard after unmount. Controlled presses still
apply modifiers synchronously before queuing their bodies. Focused runtime tests
and independent review cover these corrections; the complete host journeys and
repository gates must be rerun against the final generated tree.

Read-only maintained inspections use captured manifest bytes, complete input and
output hashes, and before/after publisher-lock and manifest checks. Interrupted
snapshots fall back to the existing exclusive lock. Readers can overlap without
weakening publication or compiler freshness guards. A speed improvement is not
yet established by a repository-level measurement.

The clean-checkout gate found absolute installation paths in constructor
provenance and a race copying disappearing publisher sidecars. Signatures now
normalize import-type module references to package-relative declaration paths;
two relocated fixtures produce identical catalogs and generated files. Shared
directory synchronization excludes reserved mutation coordination entries from
both inventories, retaining exact byte hashes, symlink rejection and data-drift
checks. Focused regressions and independent review pass. The relocated checkout's
frozen setup leaves tracked files unchanged. Broad validation still has no green
verdict: compiler and Studio contention confirmations passed, and both timed-out
Jest files subsequently passed separately. A synthetic editor-resource fixture
mixed fake React declarations with the maintained native roots; staging now
accepts the collector's explicit native root so these fixtures remain isolated.
The real SDK case retains native roots, and genuinely conflicting installs remain
rejected. Current main's incremental compiler and project-tooling changes require
integration, review of refresh replay against native freshness, and final gates.

Integration with main `3adc0e76d` preserves incremental document validation and
compiler caches while checking native publication freshness before cached results
are admitted. Focused compiler tests cover retained documents, custom native roots,
warm cache hits, stale-output rejection and recovery; removing native admission
makes the new regression fail. Restored code and whole-package type checking pass.
Project-tooling receipt replay records native identity and reader-local contract
views, and retained workspace keys include generation identity. These integration
changes pass focused native receipt, native TypeScript, watcher and service
regressions, and independent tooling review. The complete repository gate and
final packaged acceptance still remain. No source or packaging result here proves
the actual Photos and Files device journeys.

Independent tooling review found and corrected a membership gap for generator
TypeScript added inside an existing empty subdirectory. The inventory now walks
only the verified generator root for TypeScript membership, preserving exclusions
for unrelated JavaScript, installed dependencies, generated trees and publisher
auxiliaries. Ordinary receipt invalidation cases are grouped by source/configuration,
dependency topology and publication output; their assertions and timeout limits
are preserved.

The receipt mutation check substitutes a saved native inspection for current
pre-replay and final-return admission. Both regressions fail under that mutation:
a deleted wrapper replays the previous successful revision, and an incompatible
fresh wrapper loses its required signature diagnostic. Production code is restored
byte-for-byte after the check. This proof covers native admission, while ordinary
source and configuration replay auditing remains enabled throughout. The restored
native receipt tests and all three ordinary receipt invalidation groups pass.

One host run also reported an intermittent denied process-group signal-zero probe;
the unchanged focused suite and subsequent shared full-run suite passed. Inspection
failures remain fatal. The related libproc error-versus-empty audit is recorded in
the existing developer-environment process-visibility entry; this bridge work
introduces no process-inspection fallback or permission change.

Setup, VSIX packaging, standalone packaging and all 21 installed CLI acceptance
scenarios pass, including recovery from a deleted binding using only installed
resources. Installed editor activation, hover, definitions, contract diagnostics,
origin navigation and recovery pass. An iOS simulator workspace builds with both
native packages; the task fixture reaches managed simulator startup readiness.
These checks do not prove Photos or Files behavior on a device. Native journeys,
final integration review and full repository verification remain outstanding.

Structural union results, including stream chunks versus completion, expose
generated boolean member checks and checked required member projections. The
complete installed catalogs pass strict TypeScript checking, and a Tao consumer
can branch on the check, project the member and read its byte payload. Physical
origin links are relative and include exact declaration line and column positions.

The Developer resolved the event stop condition: implement shared declarative
native controls before ordinary queued Tao bodies, preserving
`on press (preventDefault) -> …`. Cancellation computed inside the Tao body is
deferred. Implementation has resumed; the pending-operation and event-policy
runtime slices and the complete listener registry have focused passing tests;
host integration validation remains in progress. The pending-operation and receiver-cleanup support
is implemented and tested. Full setup passes after repairing exact lock-owned npm
links left behind by the install-cache relocation.

The approved scope is generated modern `expo-media-library` and `expo-file-system`
bindings. Package-specific Tao declarations and executable wrappers must come from
generation. Handwritten support may implement shared extraction, conversion,
native-reference identity and lifecycle behavior reached by these packages.
React-only hooks are deferred; native permission operations remain included.

No library-specific imperative adapter, silent omission, legacy substitution or
new language semantics may be introduced to bypass an unsupported target. Stop
and present the exact signature, missing capability and recommended alternatives.

### Resolved stop: native cancellation protocol mismatch

The final installed Expo57 native bootstrap initializes React Native, then applies
Expo's `installAbortSignalPatch`. The latter adds only static `any` and `timeout`;
it retains the `abort-controller@3.0.0` signal prototype. The reached TypeScript
contracts require `readonly reason: any` and `throwIfAborted(): void`. The actual
ordinary signal has neither member, and `AbortController.abort(reason?: any)`
discards its argument. Expo's two factories attach a reason after abort dispatch,
so even their synchronous listeners do not observe it during dispatch.

The shared wrapper correctly rejects a signal missing required callable members;
removing that check would only conceal an unavailable generated operation.
An independent audit traced the final bootstrap and executed the realpath-resolved
shim with Expo's installed patch under Node. This is executable source evidence,
not a completed device acceptance journey.

The recommended next decision is to permit shared standard cancellation-resource
support, scoped to the protocol reached by these libraries, with reason captured
before event dispatch and generated bindings remaining ordinary pass-throughs.
An alternative is an explicitly selected native contract profile matching the
actual smaller API, which reduces the full declaration-derived coverage promise.
The Developer subsequently authorized autonomous decisions needed to finish.
Shared standard cancellation-resource support is selected; coverage is not
reduced. Implementation resumes with native-reference interoperability and
synchronous reason propagation as required acceptance criteria. No new Tao syntax
or library-specific imperative operation wrapper is introduced.

## Declaration inputs

| Package              | Proposed version | Input evidence                                              | Dependency approval                        |
| -------------------- | ---------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `expo-media-library` | `57.0.5`         | Published npm manifest and declaration tarball              | Approved and installed                     |
| `expo-file-system`   | `57.0.7`         | Existing `bun.lock` entry and installed declaration package | Direct declarations approved and installed |

Both published manifests identify upstream commit
`9e5319c0f821a27b7924841903abae50e2b41790`. Inventory research uses
[Photos' exact package](https://registry.npmjs.org/expo-media-library/-/expo-media-library-57.0.5.tgz)
and [Files' exact package](https://registry.npmjs.org/expo-file-system/-/expo-file-system-57.0.7.tgz),
not a moving SDK branch. Versions must be resolved and checked through the normal
setup workflow. The Developer approved these exact additions on October 5, 2026.
The generator, Expo host and Companion manifests now declare both exact versions,
and the normal setup lockfile refresh installed them. The later project-install
phase initially stopped on existing Native Bridge aliases pointing at the retired
install layout. Exact lock-owned aliases were repaired through a tested managed
migration; the complete setup workflow now passes.

Behavioral references are the [SDK57 Photos documentation](https://docs.expo.dev/versions/v57.0.0/sdk/media-library/)
and [SDK57 Files documentation](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/).
When rendered documentation disagrees with a declaration, record the discrepancy
and use the pinned declaration for the callable signature.

## Shared conversion: arbitrary native values

The exact Photos declaration `build/types/Asset.d.ts` contains:

```typescript
getExif(): Promise<{ [key: string]: any; }>;
```

The exact Files declaration `build/File.d.ts` contains:

```typescript
json(): Promise<any>;
```

A photo's EXIF can contain keys unknown at generation time, with values of
different shapes. A JSON file can contain an object, an array, a primitive or
null. The example `{ "camera": "Example", "exposure": 0.008, "tags": ["trip"] }`
therefore cannot become a fixed Tao record inferred from these signatures.

The original reader represented known primitives, lists, unions, enum cases,
records and void callbacks, and rejected indexed records and `any`/`unknown`.
The shared reader now preserves explicit dynamic types and string-indexed maps.
Tao item fields remain statically declared; boxed values supply checked access
to shapes unknown at generation time.

Use a shared bridge-owned dynamic value protocol,
implemented using existing Tao nominal types and foreign actions. It exposes
kind inspection, object keys and key lookup, list length/index lookup, and checked
primitive reads. Its ownership, absence handling and persistence rules must be
explicit. It serves both EXIF and JSON, with no package-name switches or
handwritten per-operation wrappers. Present null and undefined are boxed values;
missing own keys and absent list entries return the existing optional absence.
Primitive reads validate their requested kind, with finite-number checks.

Opaque transport-only references would reduce useful coverage, and deferring these
operations would change the accepted complete surface. Neither alternative is
selected. A language-wide dynamic value model remains outside this implementation.

Expected impact is one shared conversion/protocol slice plus generator and
behavior tests. Exact effort remains uncertain until the value shape and the
global protocol closure below are reviewed; no completion-time estimate is
supported by measured evidence yet.

## Preliminary surface inventory

Every row below is a required target group, not a claim that it is generated.
The final machine-readable coverage report must enumerate symbols and inherited
members individually, including exact source locations, signatures and explicit
deferred/deprecated status. Unsupported targets must fail with their symbol and
reason, preserving the last valid publication.

| Photos target     | Required coverage                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Asset`           | Constructor, id, fresh metadata/URI getters, albums, location, EXIF, favorites, creation and instance/static deletion |
| `Album`           | Constructor, id, title/assets, add/remove assets, creation, lookup/listing and instance/static deletion               |
| `Query`           | Constructor, field/value predicates, ordering, album filter, limit/offset and asset/metadata execution                |
| Permissions       | `requestPermissionsAsync`, `getPermissionsAsync`, `presentPermissionsPicker` and their complete option/result types   |
| Events            | `addListener`, `removeAllListeners`, change-event shapes and removable subscriptions                                  |
| Supporting values | Fields/value map, media cases, sorting, shape/location/metadata, permission cases and all required transitives        |
| Deferred          | React-only `usePermissions`; classify deprecated exports independently rather than treating them as modern coverage   |

| Files target      | Required coverage                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `File`            | Variadic constructor; inherited URI/existence/metadata; create/delete/copy/move/rename/info; text/base64/bytes and synchronous variants; write/open; pickers; watchers; Blob/JSON/FormData/buffer/stream methods; upload/download factories |
| `Directory`       | Variadic constructor; inherited operations/accessors; listing and record listing; child creation; native picker and watcher                                                                                                                 |
| `Paths`           | Static directories/containers/disk-space/info and inherited path join/relative/normalize/parse/name operations                                                                                                                              |
| `FileHandle`      | Returned native reference, close/readBytes/writeBytes, nullable offset/size; it is a type-only module export, not a publicly exported constructor value                                                                                     |
| `UploadTask`      | Constructor, fresh state, start, progress subscription, cancel and explicit release                                                                                                                                                         |
| `DownloadTask`    | Constructor, fresh state, start, progress subscription, pause/resume, cancellation/release, savable state and static restoration factory                                                                                                    |
| Supporting values | Creation/relocation/write/info options, picker overloads and canceled results, watcher events/options, transfer progress/results/options/state, encoding/mode/upload cases and required transitives                                         |

Photos' finite dependent query signatures are:

```typescript
eq<T extends AssetField>(field: T, value: AssetFieldValueMap[T]): Query;
within<T extends AssetField>(field: T, value: AssetFieldValueMap[T][]): Query;
```

The agreed design permits finite specialization. Generate correlated operations
for each supported field case; do not widen values into an unrelated union.
Concrete naming and checking fixtures remain to be frozen. This is an extraction
and generation seam, not evidence that new generic language syntax is required.

## Remaining closure checks

Files reaches `Blob`, buffers, `ReadableStream`, `WritableStream`, readers/writers,
`FormData`, `AbortSignal`, progress callbacks and iterator protocols. Their exact
declarations come from an isolated Expo-target TypeScript program, not solely
from either target package. The reader now selects ESNext, DOM and DOM.Iterable,
Bundler resolution and the react-native condition, with no automatic ambient
types. It rejects imported Bun/Node global augmentation inputs. Caller tsconfig
settings cannot contaminate the catalog; all reached inputs are hashed.

This follows the declaration environment of the pinned
[Expo package configuration](https://github.com/expo/expo/blob/9e5319c0f821a27b7924841903abae50e2b41790/packages/expo-file-system/tsconfig.json)
and its `expo-module-scripts@56.0.3` base. Declaration exposure is not proof that
every DOM operation is implemented by the native host.

Read signatures recursively, specialize finite byte stream types, and preserve
method receivers, overloads, required absence cases and callback result contracts.
Tao's current callback action type has parameters but no result type. If the
required closure contains result-bearing callbacks that cannot be exposed through
the agreed existing foreign-action design, invoke the same evaluation stop.
Do not recursively expose unrelated global APIs merely because they share a type.

## Required-stop evaluation: synchronous native event effects

Files transfer options reach `AbortSignal`, which inherits `EventTarget`. The
locked TypeScript `5.9.3` declarations contain:

```typescript
addEventListener(type: string,
  callback: EventListenerOrEventListenerObject | null,
  options?: AddEventListenerOptions | boolean): void;
dispatchEvent(event: Event): boolean;
onabort: ((this: AbortSignal, ev: Event) => any) | null;
```

The function listener and `handleEvent` object forms ignore returned values;
their `any` annotation alone is not a reason to require result-bearing Tao
callbacks. However, the
[DOM dispatch contract](https://dom.spec.whatwg.org/#concept-event-dispatch)
requires listener effects such as `preventDefault()` and
`stopImmediatePropagation()` before dispatch finishes.

The decisive failing example registers a listener that calls generated
`EventPreventDefault`, occupies Tao's ordinary action queue with an unresolved
foreign promise, then dispatches a cancelable event natively. Dispatch should
return false, but returns true before the queued listener runs. With an empty
queue the first mutation can execute inline, so that case alone would be a
misleading success. A second example calls `EventPreventDefault` followed by
`EventStopImmediatePropagation`: the generated await between the calls lets the
next native listener run before propagation is stopped. Post-commit buffering
and joined callbacks cannot preserve the complete synchronous contract. These
are source-derived bridge diagnostics, not executed native journeys or published
runnable Tao APIs.

The reached `AddEventListenerOptions.signal?: AbortSignal` has an additional
native implementation gap: the pinned `event-target-shim@5.0.1` used by
`abort-controller@3.0.0` handles capture/once/passive but does not implement that
option. Passing it through would silently omit requested cleanup. See the
[exact shim](https://registry.npmjs.org/event-target-shim/-/event-target-shim-5.0.1.tgz)
and [React Native bootstrap](https://github.com/facebook/react-native/blob/95cffbff2e071e278987c7d7cd51fbc970dd5622/packages/react-native/Libraries/Core/setUpXHR.js).

The chosen contract uses declarative native control policies rather than
synchronous ordinary Tao actions. Native listener notifications stay queued;
controls selected at registration execute before dispatch continues. The
observation/control distinction must remain explicit in generated documentation.

The Developer approved declarative native controls with the exact form
`on press (preventDefault) -> Save`. The frontend and shared runtime now implement
that control synchronously before scheduling the ordinary action body.
Native callback arguments use the same policy
mechanism, not only view handlers; supported controls must be declared against
their actual event protocol. A policy can preserve unconditional cancellation
and propagation control, but cannot compute a cancellation decision by running
an ordinary asynchronous Tao body. That limitation is accepted and body-controlled
cancellation is deferred. Reuse the same policy carrier for generated native
callback arguments; do not change the action's policy at unrelated call sites.
No synchronous action execution or copied Syntax Design code is authorized.

The selected policy requires a vertical parser/validator/formatter/compiler/
runtime slice plus generation integration. Syntax Design's active native
value/capability work remains an integration consideration; its current progress
does not prove this dispatch issue is already solved.

## Transfer progress seam

`UploadTask.uploadAsync(): Promise<UploadResult>` and
`DownloadTask.downloadAsync(): Promise<File | null>` currently hold Tao's action
root until completion when directly awaited. Progress actions and a UI Cancel
action therefore wait behind the transfer. Existing detached `async` still
occupies a root once launched.

Independent source review found a solution within the approved shared support:
retain direct awaited operations and generate explicit begin, settlement
observation, status and typed-result operations around a non-thenable nominal
pending handle. Observe native rejection immediately; keep terminal observation
separate from progress cancellation; capture registering transaction readiness
once; propagate callback scope through nested options. Constructor-supplied
progress callbacks need receiver ownership, while immediately started transfers
need operation ownership. Wrapper release disables observers without invoking
native cancellation or deleting content. This shared slice is implemented with
focused pending-operation, callback ownership and explicit cancellation tests.

The final Files inventory records 218 operations with zero extraction diagnostics.
Fixed tuple conversion for stream `tee()`, nested callback ownership, and
source-pinned classification of legacy warning exports are implemented and tested.

## Integration sequence

1. Finish and freeze the symbol inventory, provenance, naming and coverage report.
2. Review shared wrapper identity, checked conversions, dispatch, byte handling,
   persistence rejection and explicit resource semantics before complete emission.
3. Generate both modern surfaces through the common emitter and prove query
   correlation, receivers, fresh accessors, nested handles and byte round trips.
4. Integrate hidden `.tao-ts` output ownership, reproducible setup/build generation,
   stale-output failures, stdlib publication, standalone resources and native hosts.
5. Independently review coverage and seams; run focused and repository validation;
   report real platform acceptance separately and propose landing.

Generated Tao and TypeScript have disjoint ownership roots. The maintained module
contains `Bindings.tao` and its catalog; `.tao-ts/native-bindings/<capability>`
contains `Bindings.ts` and a matching catalog. Shared multi-root publication
validates both roots under one lock and rolls both back on failure. A read-only
freshness check regenerates expected content in memory and rejects missing,
modified or obsolete output before accepting compiler/cache/build results.

Native packaging must use the pinned plugins. The
[Photos plugin](https://github.com/expo/expo/blob/9e5319c0f821a27b7924841903abae50e2b41790/packages/expo-media-library/plugin/src/withMediaLibrary.ts)
declares photo read/add permission descriptions, Android granular media access
and optional media-location access. Keep limited-access prompts enabled and
preserve application permission descriptions. The
[Files plugin](https://github.com/expo/expo/blob/9e5319c0f821a27b7924841903abae50e2b41790/packages/expo-file-system/plugin/src/withFileSystem.ts)
declares storage/network permissions; opening documents in place and exposing
the Documents directory through Files are explicit optional settings. Adding the
bridge does not justify overriding existing application sharing settings.

Reuse the landed result-bearing foreign-action behavior. Constructors and methods
can become top-level foreign actions, with an explicit receiver argument for
instance operations. Existing subscription WeakMaps demonstrate validated handle
lookup; class instances require identity-preserving shared support rather than
ordinary record copying. Runtime validation may reject forged handles; do not
promise a new compile-time opaque type category under existing item semantics.

The active Syntax2 work includes checked native value accessors/factories and
associated-method publication. Its native boundary checkpoint is not landed in
the recorded base. Reconcile that checkpoint before implementing another native
value representation; top-level operations do not require waiting for every
associated-method feature. No code has been copied from its active checkout.

## Evidence and preserved state

The shared runtime supplies `TR.NativeReferenceType`, `TR.NativeReferenceGroup`,
`TR.NativeValues`, `TR.NativeBytes` and `TR.NativeCallCallbacks`. Descriptor-owned
WeakMaps retain payloads and canonical object/function references. Group-owned
ancestry preserves canonical identity across derived/base/protocol views.
Checked dispatch preserves receivers, getters read current values, and releasing
a wrapper leaves native content alone.
Dynamic readers preserve boxed null/undefined and distinguish missing own keys;
byte conversion validates the exact values copied into owned storage.

Focused reference, dynamic-value, byte and call-callback tests pass, including
rollback, unmount, queued dispatch and changing-getter/iterator regressions.
The installed declaration coverage tests independently enumerate public exports
and class members. Both complete generated catalogs pass Tao validation and
strict generated-sidecar checking, including required-before-optional public
signatures with preserved native argument indices. Shared event controls,
listener ownership, pending transfers and receiver cleanup have execution tests.
Repository type-checking passed after adding JSX support to the native-bindings
test project that now imports runtime components. Bare nominal item types use
existing state rejection; no new opaque language category is claimed.

An initial broader changed-file gate failed in eight unchanged desktop-host tests when
`Bun.serve` could not bind `port: 0` (`EADDRINUSE`, `errno: 0`). An isolated rerun
reproduced the sandbox failure. Later named host verification passed those tests;
the earlier failed run is retained and is not claimed as passing integration evidence.

A source check initially failed because Native Bridge's existing declared
`expo-clipboard` and `expo-haptics` installations were missing from its project
environment. Full setup now installs the approved dependencies and repairs only
exact lock-owned links from the old managed-install layout. The original source
check also found an import-order issue in `TR.ts`, which was corrected, and
refreshed generated project configuration. The later source check found an
exhaustive-dispatch lint issue in the reader; it was corrected and the focused
extraction suite passed. Complete host verification subsequently passed on the
reviewed native implementation tree.

`./agent doctor` passed and `./agent setup` completed its frozen install. Optional
shell preparation could not reach the sandbox-excluded Nix daemon; the existing
pinned development profile is usable. Synthetic source generation and coverage
tests and complete modern-library source validation have run. Maintained stdlib
publication and installed standalone packaging have passing evidence. The final
native implementation at `57c5f9eaf` passed complete host verification (59 groups,
zero failures or skips), all 21 installed CLI acceptance scenarios, VSIX packaging,
and installed editor activation, diagnostics, recovery and pinned-native source
navigation. Native operation journeys and platform acceptance remain unproved.

A subsequent readiness run in the original checkout encountered a Files mutation
lock timeout and compiler/runtime deadlines. Unchanged focused compiler and runtime
tests passed. A four-job host retry passed those scopes but timed out two real-app
Studio browser journeys; the exact four-journey Studio check then passed unchanged
in isolation. These retries are retained separately from the earlier complete green
run and do not establish that contention caused the browser failures.

The Developer requested hosted verification for the remaining portable checks.
The CI workflow runs portable verification across twelve Linux partitions; it does
not prove macOS Studio or device operation journeys. `open-pr` opens
or reuses a pull request and follows CI without enabling automatic landing. It
refuses a reused pull request whose auto-merge is already enabled before pushing.
It follows the exact pushed commit and refuses a changed head before querying
checks. The tooling addition passed 33 focused tests, type-checking and independent
review. At `6fdda50d`, hosted verification passed ten of twelve partitions. The
complete cache test file exceeded its 300-second process budget twice despite
passing completed cases. The receipt partition passed twelve cases and failed the
combined ownership/lock/package-topology case on retry; its exact retry diagnostic
was lost because a colon in the retry log filename prevented artifact upload.
The unchanged thirteen-case receipt file subsequently passed locally. These
results do not establish a timeout or contention cause for the receipt failure.

Cache tests are now divided into four files with all thirty expanded cases and
their assertions preserved. The three independent receipt mutations have separate
cases; all fifteen receipt cases pass locally. Retry and resumed logs reuse the
normal artifact filename sanitizer. The pull-request follower reuses the existing
GitHub CLI authentication without logging credential output, avoiding the anonymous
API limit encountered during the first run. Focused tests, whole-package type
checking and independent review pass; another hosted run remains pending.
Both Companion host jobs passed at `6fdda50d`, including Android and iOS simulator
builds and native-kit parity. This is build evidence, not native-operation proof.

Hosted recheck at `918a0130` passed eleven of twelve partitions, including the
previous cache and receipt failures. Partition eight stopped at repository lint:
the split cache files duplicated a suite title. Three titles now identify their
own scopes; assertions and test bodies are unchanged, and repository lint passes.
The remaining hosted jobs were followed to completion before reviewing the full
failure list. The next hosted verdict remains pending.

Branch setup exposed pre-existing old `.tao/typescript`, `.tao/install` and
`.tao/sessions` output as untracked under main's current local-state layout.
They are not part of this implementation. The source check refreshed some of
their generated configuration; no unrelated authored source was changed and no
old local output was staged. Setup migrated its own managed install-cache tree.
No native device files, assets or albums have been created, changed or deleted.
