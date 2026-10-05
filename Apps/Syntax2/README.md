# Syntax2 Library

Future-source forcing app for the accepted render, nominal typing, capability, quantity and action
contracts. Requested 2026-10-04. The goal is to implement everything required to run this app, in
vertical slices, progressively moving source from `.tao.future` to `.tao`. This is an implementation
target. A minimal executable shell now uses the first render foundation and public wildcard imports; unsupported future source
remains undiscovered.

## Source and authority

- [Main.tao](Main.tao): active shell with a quoted Library header, bare zero-argument render calls,
  and a Group button switching ordinary boolean state between two quoted labels.
- [Library.test.tao](Library.test.tao): active journey asserting the header and both directions of
  the grouping display transition. It exercises no book collection or acquisition behavior.
- [Main.tao.future](Main.tao.future): project/app boundary, controls, slots, units and bounded list UI.
- [library/Library.tao.future](library/Library.tao.future): nominal signatures, structural capabilities,
  generics, native operator, entities, associated actions/rendering and cleanup.
- [library/GroupedRows.tao.future](library/GroupedRows.tao.future) and
  [library/GroupedRows.ts.future](library/GroupedRows.ts.future): typed keyed rows and a pure algorithm.
- [library/BookIO.tao.future](library/BookIO.tao.future): app-owned adapter contracts. The referenced
  BookIO.ts is a required implementation artifact, not an existing backend or a successful stub.
- [Library.test.tao.future](Library.test.tao.future): initial user-visible journey to activate with
  the entry slice; it is not current acceptance evidence.
- [stdlib/Keyed.tao.future](stdlib/Keyed.tao.future): target ordinary declarations for @tao/ui,
  to implement in the standard library rather than graduate into a second app-local definition.

[Decisions](../../Docs/Roadmap/Tao%20Revolution/Decisions.md) owns accepted semantics.
[Code preferences](../../Docs/Roadmap/Tao%20Revolution/Code%20preferences.md) owns preferred forms.
[Implementation task](../../Docs/Roadmap/Data%20and%20render%20contracts/Implement%20Syntax2.md)
owns sequencing, coverage, ownership and acceptance. Numbered comments identify forcing cases;
they do not authorize an implementer to silently settle remaining language judgments.

The high-level plan is ready after the 2026-10-04 final audit: coordinator foundation, parallel
language workstreams, data/lazy-list integration, then complete graduation and acceptance.
No blocking author question remains for that plan. Exact ABI/path assignment and prototypes belong
to its prerequisite wave. The first render foundation is implemented; broader graduation is pending.

## Graduation

The active shell is intentionally dependency-complete and small. It compiles and passes source
checks; the runtime journey verdict is recorded by the integration owner. The original future Main,
library modules, adapter sketch, standard-library target and future journey remain intact.
The shell demonstrates quotation and a reachable grouping-state transition, with ordinary existing
types and actions. It does not implement the future collection, nominal/capability, quantity,
parameterized-slot, failure/cleanup or adapter contracts. Bare text-value placement and empty-value
suppression are deferred; a quoted empty string still retains the explicit Text node.

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

- BookStore starts with an available empty collection. Use a deterministic memory adapter and
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
  choose their own identity contracts; loops are unaffected. Integration still needs implementation.
- GroupedRows rebuilds a projection when grouping dependencies change. Content retains Book handles;
  mounted row rendering subscribes to their fields. It never stores JSX, mounted nodes or a frozen
  Book snapshot. Keys preserve occurrence state across reorder; removal unmounts. A moved book keeps
  its key even when its author group changes. Duplicate appearances require distinct occurrence keys.
  Grouping touches only acquired rows, so a group can remain incomplete until more data arrives.
- GroupedRows.ts.future returns builder-produced rows. Its generated binding must pass live handles,
  register cached field reads as dependencies, build checked Tao values, and wrap the result list.
  The callback shape is an algorithm sketch, not a selected generated TypeScript ABI.
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
   Keep explicit 1; no canonical marker yet. Validate the exact declaration grammar and scalar-family
   admission with a small stdlib fixture before editing shared parser/type infrastructure.
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

Empty text and owner-elided methods follow the new requested target. Named-state shorthand is a
preferred grammar target: constructor positions select a type, bare expression positions select
the value; ambiguous dotted calls retain the lexical value rule and can use a type import alias.
No claim is made that every identical type/value spelling is universally unambiguous.
