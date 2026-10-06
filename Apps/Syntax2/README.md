# Syntax2 Library

Executable forcing app for the accepted render, nominal typing, capability, quantity and action
contracts. Requested 2026-10-04. The selected nondeferred language families are implemented as of
2026-10-05. Syntax2 and the reference app pass source validation, and combined package typechecking
passes. Focused tests cover language, compiler, runtime and adapter contracts.

This is the language-review checkpoint, not completed app/platform acceptance. The active app now
uses the standard-library LazyList and grouped row projection; its final combined journeys pass,
while remaining native/platform acceptance has separate proof boundaries. The Developer resumed implementation on 2026-10-05,
including native binding adaptation and landing. Landing this functioning language baseline does not close the
remaining acceptance work. `.tao.future` files remain undiscovered and are retained for reconciliation.

## Source and authority

- [Main.tao](Main.tao): active shell with a quoted Library header, bare zero-argument render calls,
  signature-scoped private types, reversed role-bound arguments for number and text pairs, and a Group button switching
  named yes/no state between two quoted labels. Bare Person and Feedback placement use the
  standard Text view; compact handlers show and clear feedback. The show handler joins an inferred
  source action result through `then { done Message -> ... }`. A named list supplies two readers.
  Feed acquires 40 books, extends to 80 and 83, and refreshes while retaining acquired content.
  Shelf and GroupedShelf now use standard-library LazyList. Acquisition counts are separate from
  visible rows, so journeys assert acquired counts without assuming all rows are mounted.
  Signed quantity arithmetic exercises Duration and Ratio; Title.Default supplies a structural
  UI value whose associated Render calls its pure uppercase ToText method. Book titles use that
  same selected renderer, producing uppercase labels. Bare Book placement invokes its associated
  BookRow renderer, retaining the live entity for Return, revision acknowledgment and Export.
  EarlierLabel uses one generic Ordered/Display domain and a total first-match pick;
  Score demonstrates checked native addition and an explicit Title conversion.
  A typed NewBook draft preserves its writable Title lens. Add consumes InvalidInput locally,
  clears feedback, and resets the draft only after successful creation. The app declares an error
  rendering boundary; an actual stale continuation failure reaches it after cleanup and rollback.
  Public fallback messages avoid claiming external operations were rolled back.
  `Title as TitleType` preserves the nominal declaration while a local `Title` value shadows its
  original spelling; the actual journey covers its static factory, construction and conversion.
- [library/Library.tao](library/Library.tao): graduated Name/GivenName/FamilyName, PersonName and
  Subtract declarations. The app renders Ada Lovelace and 3 using the actual signature projections
  and argument matcher. ComparedNames constructs a list with contextual Name elements.
  Display, Title's associated methods/view, GroupMode, EarlierLabel and Score are graduated as well.
  Library.ts supplies pure text ordering and numeric addition at the checked native boundary.
  Book and Books have singular/collection Return actions, with one stored LoanedOut Boolean and
  its writable inverse Returned. Book.Key and Book.Render supply ordinary library capabilities.
- [library/BookViews.tao](library/BookViews.tao): live Book rows render an optional author through
  a helper-local none guard, title, note and availability, with revision-specific Seen controls.
  Export completion receives a checked Duration and schedules a detached Wait/NotifyExport action.
- [Library.test.tao](Library.test.tao): active journey asserting the header and both directions of
  the grouping display transition, signature-role results, and bounded book acquisition,
  continuation and refresh, local typed rejection, input editing and successful creation. A fresh
  second journey creates a book and then exercises stale-cursor recovery through the app guard.
- [Shelves.tao](Shelves.tao): parameterized header/item renderers, default content, explicit empty
  replacement, repeated header placement and exact item-renderer forwarding into LazyList.
- [Main.tao.future](Main.tao.future): retained design fixture to reconcile against the active app;
  it is not executable acceptance evidence.
- [library/GroupedRows.tao](library/GroupedRows.tao): graduated typed keyed rows, structural ui,
  checked ordinary Tao builders and the pure native projection boundary.
  [library/GroupedRows.ts](library/GroupedRows.ts) implements the native projection through
  authenticated builder methods and original live Book handles. A focused runtime check proves
  distinct equal-name authors, absent authors, header renaming and stable book keys after regrouping.
  A compiled-source check also proves the ordinary builders and strict generated TypeScript.
  The final combined app journeys pass for grouping transitions, live revision acknowledgment and
  singular/collection returns; header renaming and stable regrouped keys have focused runtime proof. The retained GroupedRows.ts.future algorithm sketch
  is not a separate implementation contract.
- [library/BookIO.tao](library/BookIO.tao): active owned file/revision/query adapter contracts.
  BookIO.ts and BookStoreProvider.ts implement actual bounded acquisition, PDF creation, upload,
  cleanup and cached revision acknowledgment. Its former future contracts are fully graduated.
- [library/BookActions.tao](library/BookActions.tao): Add validates its typed input, while Export
  samples a monotonic timer before creating/uploading an owned PDF and joins deferred deletion
  before completing. A compiled-source acceptance test proves real PDF bytes, checked elapsed
  Duration, and cleanup on success and upload failure; it does not claim installed-device proof.
- [Library.test.tao.future](Library.test.tao.future): initial user-visible journey to activate with
  the entry slice; it is not current acceptance evidence.
- The former library/adapter/Keyed future targets are retired after their executable definitions
  graduated. RenderKey, Keyed, ui and Occurrence belong to the ordinary @tao/ui standard library.

[Decisions](../../Docs/Roadmap/Tao%20Revolution/Decisions.md) owns accepted semantics.
[Code preferences](../../Docs/Roadmap/Tao%20Revolution/Code%20preferences.md) owns preferred forms.
[Implementation task](../../Docs/Roadmap/Data%20and%20render%20contracts/Implement%20Syntax2.md)
owns sequencing, coverage, ownership and acceptance. Numbered comments identify forcing cases;
they do not authorize an implementer to silently settle remaining language judgments.

The implementation plan's language waves are complete. The remaining slice is combined app/native
acceptance, future-source and documentation reconciliation, final verification and landing.
The Developer resumed the remaining implementation and acceptance work, including native binding
adaptation, verification and landing.

## Graduation

The active modules compile and pass source checks. The app demonstrates quotation, grouping and
feedback state, bare values, contextual named lists, role matching, structural capabilities,
generic/Self checking, explicit conversions and operators, signed quantities, parameterized slots,
bounded acquisition, inverse writes, failure ownership and joined cleanup. All four active runtime journeys passed on 2026-10-05 after final lazy/grouped activation,
covering 40/80/83 acquired counts, grouping transitions, revision acknowledgment and live writes.
Mounted feature proof verifies that empty bare text values emit no node;
a quoted empty string and explicit Text("") still retain their Text nodes.

### Retained example coverage

The future files remain undiscovered audit fixtures. Their numbered cases map to the active
modules and proof owners below; remaining gaps are not implied complete by this mapping.

| Future case                                                     | Active implementation                           | Proof owner                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Main 1: app boundary                                            | Main app guard and BookStore                    | Library propagated-failure journey                                                                                   |
| Main 2: slots and forwarding                                    | Shelves, Shelf and GroupedShelf                 | Mounted Shelf and compiler shelf-source tests                                                                        |
| Main 3: signature roles, named state, generic display and Score | Main and library/Library                        | Library rendering journey; nominal/generic compiler and validator tests                                              |
| Main 3.1: signed quantities and units                           | Main and core quantity contracts                | Library quantity assertions; numeric-units compiler/runtime tests                                                    |
| Main 4: bounded acquisition                                     | Feed, BookIO and BookStore provider             | Library 40/80/83 journey; BookStore and BookIO tests                                                                 |
| Main 5: typed input and recovery                                | Add and local/app guards                        | Library invalid-input, reset and propagated-failure journeys                                                         |
| Main 6: empty results and grouped content                       | Main, GroupedRows and BookViews                 | Empty CLI/mounted-app journeys; grouped live-handle and mounted Shelf tests                                          |
| Main 7: rejected invocations                                    | Explicit roles and concrete quantities          | Negative nominal-admission, generic and numeric-unit tests; exact example reconciliation remains required            |
| Library future journey                                          | Active app with isolated empty provider seed    | syntax2-empty-journey and syntax2-empty-query-journey                                                                |
| GroupedRows future algorithm                                    | Authored GroupedRows builder and implementation | Grouped rows and builder tests; first-appearance ordering and duplicate-input policy remain to be checked explicitly |

Fresh acceptance on 2026-10-06 also replays the compiled Export, native comparison, grouped
builder and BookIO checks. These exercise the authored boundaries with controlled host inputs;
they do not prove installed native clocks, suspend/resume or operating-system file services.

### Remaining acceptance

1. The actual Library journeys with Shelf and GroupedShelf active pass for 40/80/83 acquired
   counts, grouping changes, seen revisions and writes. Rechecked on 2026-10-06: all four active
   journeys pass, as do the empty-result CLI and mounted-app journeys. The latter verifies both
   grouping modes, creation of the first live row and zero app-error-guard invocations. Retain the
   focused virtualization and author/key proofs; reconcile future fixtures against these checks.
2. Prove the applicable native timing/export/cancellation/cleanup boundaries. iOS build evidence
   exists; installed-device, suspend/resume and Android acceptance are not claimed.
3. Reconcile retained future Main/test/algorithm fixtures, documentation and coverage records.
   Keep the future extension undiscovered; retire a fixture only after its coverage is accounted for.
4. Run the final integrated verification and authorized landing. Record the actual verdict and
   limitations rather than treating source validation as complete app acceptance.

These items continue in the authorized implementation task. General
query-state redesign, localized text, broad static proofs, general never/conversion bans and the
remaining time/date APIs retain their separate deferred roadmap entries.

1. Extract small feature modules from the future files when necessary. Move working declarations,
   not a duplicate future/current mirror. Keep the remaining target readable.
2. Graduate a module only when its imports and transitive requirements are executable, its
   validator/formatter/compiler/runtime behavior is implemented, and its meaningful tests pass.
   Do not make future extensions discoverable, rename incomplete files, weaken the source contract,
   or count renaming as implementation. Activate a minimal entry point when it can run independently.
3. Move its journeys to `.test.tao`; add transition/negative checks that prove the introduced
   behavior. Reconcile the selected roadmap and implemented Spec evidence in the same slice.
4. Completion means the entry app, all required modules/adapters and journeys are executable,
   including failure paths. Future files may remain only for explicitly deferred demonstrations.

## App-owned provisional contracts

These are deliberately narrow integration requirements, not the final A29 query-state API.

- BookStore supplies 83 deterministic server rows, acquired in bounded pages. Use the memory adapter and
  controllable acquisition/write/export failures for journeys; do not hide unimplemented I/O behind
  successful no-ops. A native export adapter needs separate platform acceptance if included.
- Feed acquires at most 40 results per request, with stable unique ID ordering. LoadedItems projects
  acquired live handles and preserves the Books collection receiver; it performs no I/O. Projection
  is evaluated after availability guarding. Writes and later actions revalidate their inputs.
- LoadAfter requests a continuation and appends unique acquired items. Refresh preserves usable
  content while reacquiring. Empty and refreshing can overlap. Cursor/query identity, unavailable
  continuation, failures and cancellation must be explicit in the adapter contract before activation;
  do not implement a universal pagination system or fetch all rows and slice on the client.
- Occurrence.Ordinal is one-based within this displayed sequence, not a server-global ordinal.
  GroupedRows keys headers by author identity and books by stable book identity. RowKey is an ordinary
  field. Selected standard-library LazyList uses an ordinary structural Keyed capability with
  Key() fails never -> RenderKey. GroupedRow and Book supply methods explicitly; RowKey derives from
  RenderKey and returns upward through the declared contract. The compiler checks ordinary signatures,
  not these names. Library runtime enforces uniqueness without index repair. Other list components
  choose their own identity contracts; loops are unaffected. The implementation is active; combined
  the combined grouping, revision and live-write app journeys pass.
- GroupedRows rebuilds a projection when grouping dependencies change. Content retains Book handles;
  mounted row rendering subscribes to their fields. It never stores JSX, mounted nodes or a frozen
  Book snapshot. Keys preserve occurrence state across reorder; removal unmounts. A moved book keeps
  its key even when its author group changes. Duplicate appearances require distinct occurrence keys.
  Grouping touches only acquired rows, so a group can remain incomplete until more data arrives.
- GroupedRows.ts returns builder-produced rows through generated capability contracts. Its binding
  passes live handles, records dependency reads and builds checked Tao values. The retained future
  callback shape is an algorithm sketch, not the generated TypeScript ABI.
- ObservedRevision returns a cached, user-scoped revision token for the displayed book. MarkSeen
  acknowledges precisely that revision; later revisions remain unseen. Rendering/visibility does
  not itself acknowledge anything. Permission failure is not a successful acknowledgment.
- CreateTemporaryPDF yields an owned file token. UploadFile completes after its adapter's stated
  acceptance point and releases file use. Defer deletes afterward on all exits. Cleanup failure
  prevents done; completed upload is not rolled back or automatically retried. Detached notification
  has its own root failure ownership and cannot change the completed upload's facts.
- TextField retains Draft.Title's nominal type and validates edits. Value upcasting does not license
  writes of arbitrary text into that field. Add maps validation rejection to InvalidInput, while
  other failures propagate to the app boundary.

## Contract review

1. Core scalar/unit declarations: numeric supplies finite storage, scalar supplies same-domain
   arithmetic with concrete Self, Duration adds signed time-domain units with canonical seconds.
   Selected: scalar is an abstract operation family, not a concrete unitless value. Generic bounded T
   preserves a concrete domain; erased independent scalar values cannot be mixed in arithmetic.
   Selected unit form: `units { seconds 1 (default), milliseconds 0.001, minutes 60, hours 3600 }`.
   Keep explicit 1; no canonical marker. Standard-library declarations and focused source/runtime
   tests exercise the grammar, concrete domain admission and quantity arithmetic.
2. Generic Self: selected after review—allow ordinary upward admission to a type
   already supplied by one typed argument when that type is an ancestor of every other typed input.
   Celsius plus RoomReading may infer Celsius; Celsius plus Fahrenheit cannot invent Temperature
   merely to make the call legal. Contextual literals do not count as deliberate parent anchors.
   Explicit widening or a declared conversion remains available; sibling conversions stay explicit.
   Comparison uses the chosen static T's contract, never a narrower receiver contract.
3. Opposite named Boolean types: initially implement the one stored field plus derived inverse
   member used here. Do not create a second nominal type from an inverse field name. A separate
   opposite-type pair would need an explicit declaration and rules for writes/not/conversion.
   Selected inverse writes target the same stored field; filling both aliases in one update is
   rejected even if values agree. Book.Return now exercises the inverse write.

Selected unit lookup: lowercase names are a grammar rule, including qualified final segments and
unit-reading methods. Owner-qualified suffixes such as `2 Duration.seconds` are available; explicitly
visible shorthand names may be used. Ambiguous unit names error rather than using the callee to guess.

Native quantity implementations import the generated `types` namespace. `types.Duration.minutes(2)`
constructs a checked quantity; `types.Duration.Factory` exposes that owner's checked canonical
factory for arithmetic and native return values. The capitalized, nonenumerable bridge member
cannot collide with lowercase Tao units and leaves unit enumeration unchanged. Abstract families
publish neither constructors nor factories. Native calls in associated functions use their declared
result contract; native converter results use the converter's target type.

Empty text and owner-elided methods implement the selected contract. Named-state shorthand is
implemented: constructor positions select a type, bare expression positions select
the value; ambiguous dotted calls retain the lexical value rule and can use a type import alias.
No claim is made that every identical type/value spelling is universally unambiguous.
