# Data and render contracts — syntax sketches

Status: exploration, 2026-09-30. These snippets mix implemented building blocks with proposed
syntax. They are not executable acceptance evidence. [User stories](<User stories.md>) owns the
requirements; [Tao Revolution decisions](<../Tao Revolution/Decisions.md>) remains the authority
for accepted language contracts. Existing meanings are being reconsidered explicitly, not silently
redefined by these sketches.

## Working method and proposed sequence

1. Review the end-user inventory, then developer stories. Add missing outcomes before enumerating
   keywords. Keep identifiers stable and distinguish common authoring from advanced inspection.
2. Decide the value/resource/operation/observation model and failure ownership. These constrain
   punctuation, matching, and default behavior; settle three to five upstream choices per round.
3. Write paired sketches for the same story: the small common form and the fully explicit form.
   Document required evidence, overlaps, ownership, and unsupported-provider behavior beside each.
4. Prototype the grammar and type model on a bounded corpus, including adversarial combinations.
   Prototype status does not authorize a broad migration or claim that sketches compile today.
5. Implement one end-to-end vertical slice with a real forcing feature and Tao behavior tests.
   Recommend reads, optional/empty distinctions, structured failure metadata, explicit fallback,
   and additive feedback first. Independently validate the agreed render/event spelling changes.
6. Add cursor traversal and its errors, then durable mutation receipts and observation scopes in
   separate slices. Each slice must fit the full model; advanced capability can be omitted from an
   MVP subset without respelling implemented features.
7. Reconcile accepted decisions, Next/Current, coverage, and implemented specs through the existing
   [program process](<../Tao Revolution/Process.md>). Release scope remains separately decided.

Do not implement the entire catalogue as a large enum. The catalogue describes independent
dimensions and application needs, not mandatory branches at every rendering site.

## Accepted direction versus open proposals

| Area                            | Status                                         | Working direction                                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Render arguments and styling    | Invariant                                      | Before the render body                                                                                                                                                                                                                     |
| Event handler separator         | Accepted direction                             | Require `->`; canonical explicit `do` is recommended below                                                                                                                                                                                 |
| Guard qualifier                 | Accepted                                       | `guard Document`, without `status`                                                                                                                                                                                                         |
| Slot defaults                   | Accepted                                       | Absent fill uses default; supplied fill replaces it; explicit empty suppresses it                                                                                                                                                          |
| Explicit empty guard case       | Accepted                                       | `missing -> empty` handles the case and skips later siblings in that enclosing block                                                                                                                                                       |
| Bare renders and strings        | Proposed design under exploration              | Explicit visual context; zero-argument bare views and quoted text renders                                                                                                                                                                  |
| Payload binding                 | Proposed coherent arrow design                 | Bind before `->`, rather than ambiguous right-hand payload names                                                                                                                                                                           |
| Rich metadata                   | Recommended direction                          | Typed dimensions and ergonomic predicates                                                                                                                                                                                                  |
| Coherent nested matching        | Accepted for implementation                    | Nested atomic matches share the observation captured by the outer discrimination; later live reads require revalidation                                                                                                                    |
| Boolean words                   | Existing decided intent and current preference | `yes / [Alias] no` types and uniform `yes`/`no` values; migration and inverse bindings remain open                                                                                                                                         |
| Status vocabulary and freshness | Open                                           | Reconsider all current meanings against the story inventory                                                                                                                                                                                |
| Parameterized/repeated slots    | Open                                           | Callable contract if a real reusable renderer forces it                                                                                                                                                                                    |
| Inline anonymous views          | Open                                           | Additional language feature, not required for named callable fills                                                                                                                                                                         |
| Callable argument matching      | Accepted direction                             | Never bind by argument position; expose public signature types through their owner                                                                                                                                                         |
| Argument punctuation            | Open discussion                                | Explore label-free callable arguments with distinct type identities; structural member syntax is separate                                                                                                                                  |
| Contextual dot construction     | Requested direction                            | `.Name` explicitly selects the immediate callee's signature type; normal visible type lookup wins for bare names                                                                                                                           |
| Named-type declarations         | Accepted spelling                              | Use `is` for now; one declaration kind is the working direction, with renaming separate                                                                                                                                                    |
| Implicit nominal conversion     | Accepted direction                             | Exact or toward ancestors; additional specificity and sibling branches require explicit treatment                                                                                                                                          |
| Explicit conversion and units   | Open                                           | Core representation versus semantic ancestry, owner-declared converters, directional policies, and duration library fixture (S32); tagged semantic families, capabilities, codecs and conversion bans (S33); local input adapters rejected |
| Input-local adapters            | Rejected                                       | Do not adopt S31.D's accepts/using conversion clauses on individual parameters                                                                                                                                                             |
| Runtime parsing                 | Reopened                                       | Prefer explicit library parsers; type-call and type-method spellings are under reconsideration                                                                                                                                             |
| Readable boolean inverse        | Requested direction                            | One stored field; inverse member reads derive `not` of its positive value                                                                                                                                                                  |
| Named scalar preference         | Requested direction                            | Prefer reusable named types; warning scope and nominal strictness need decisions                                                                                                                                                           |
| Pagination                      | Open amendment                                 | Revisit existing planned indexed-pager assumptions against provider capabilities                                                                                                                                                           |

## Decision inventory

Every item is open unless the table above says otherwise. Defaults below are recommendations,
not an implicit acceptance. A later decision round can strike or promote items.

1. Values and types
   a. Plain scalar/list/item versus optional value versus live resource — default: distinct types.
   b. `none`, `empty`, and `missing` — default: optional absence, content emptiness, established target absence.
   c. Empty text and optional-text narrowing — default: typed checks; no number/boolean truthiness.
   d. Boolean positive/negative poles — existing `yes / [Alias] no` and uniform `yes`/`no` literal intent;
   inverse read forms and migration mechanics remain open.
   e. Callable inputs — requested: no positional binding and public signature type paths; latest investigation compares core-as-ancestor with core-as-data, up/down/both/exact policies, scoped role declarations, capability admission, and type-owned converters (S32). Previously selected default is upward-only; none of the new counterfactuals revokes it implicitly.
2. Reads and metadata
   a. Availability, acquisition, freshness, completeness, provenance — default: separate typed facets.
   b. Metadata extraction spelling — compare `status of Resource` with postfix `Resource status`; prefix-of is the latest recommendation.
   c. Predicates and source-ordered matching — default: small derived predicates; independent indicators compose separately.
   d. Freshness policy owner and invalidation — default: datasource/resource defaults plus query overrides.
   e. Retained data during retry or failure — default: preserve evidence and content when access/policy permits.
3. Failure structure and ownership
   a. Shared failure discriminants and optional provider details — default: typed common categories plus provider-specific details.
   b. Local replacement versus additive observation — default: distinct contracts.
   c. Shared fallback scope, precedence, deduplication, accessibility, recursion — must decide.
   d. Checked effects and guard narrowing — default: modeled failures must be handled or propagated; read access is refined.
   e. Background lifetime and durable handler ownership — must decide before detached/queued guarantees.
4. Actions and outcomes
   a. Direct sequencing, resolved value binding, and outcome handling — default: three independent source forms.
   b. Detachment and `then` — default: `then` does not detach; explicit `async` owns detachment.
   c. Bound result plus handled failures — propose deferring until fallback-result typing is settled.
   d. Event input aliases and canonical formatting — default: accept bare calls as shorthand input; print explicit `do`.
5. Collections and pagination
   a. Cursor traversal versus indexed random access — default: expose capability rather than simulate equal cost.
   b. Opaque cursor type and query identity — default: query/scope-bound tokens.
   c. Total ordering, snapshot/live range consistency, reset — must decide.
   d. Forward/backward progress, unknown continuation, count evidence — default: typed independent metadata.
   e. Retention, virtualization, grouping, anchoring, selection — default: distinct contracts.
6. Mutations
   a. Invocation outcome versus local durability versus authority acceptance — default: separate receipts/facets.
   b. Retry versus resubmit and unknown outcomes — default: recorded operation identity plus provider capability.
   c. Concurrency, rollback, merge, cancellation, compensation, partial batch outcomes — must decide per capability.
   d. Lasting failure owner and recovery after relaunch — default: durable submissions have durable ownership.
7. Observation and rendering
   a. Membership arrival versus creation versus revision change — default: separate event origins.
   b. Seen acknowledgment, visibility, persistence, manual unread — default: explicit observation scopes.
   c. Presentation timers and reduced motion — default: separate from durable seen state.
   d. Parameterized slots, repeated occurrence identity, loop position context — default: typed contracts only when forced.
   e. Root slot rendering and style/tag ownership — must decide if root slots are added.
8. Implementation boundary
   a. MVP subset — default: omit advanced capabilities while keeping the selected meanings and spellings.
   b. Provider conformance and scenario coverage — default: source/type tests plus Tao transition tests and capability evidence.

## S01 — bare slots, strings, and explicit argument boundaries

Stories: D33–D34. Proposed syntax:

```scss
view Frame() {
   @header: empty

   render Col {
      @header
      "Hello"
      Spacer
   }
}

render Frame {
   @header: "Heading" [title]
}
```

Bare `@header` remains a zero-argument placement. Its following string is a separate text render.
Supplied arguments use `@header("Hello")`; empty parentheses may be accepted explicitly, but are
not required by text sugar. Mandatory fill `:` removes the old interpretation where a following
view render was greedily consumed as a separator-free fill.

Root forms `render @header`, `render @header()`, and `render @header("Hello")` are feasible extensions,
not implemented root grammar. If admitted, decide root identity, styling, tags, and the empty-root
case. Do not require a different slot-call spelling merely because its placement is the root.

## S02 — labels and scoped nominal types

Stories: D34. Current implementation facts:

```scss
view Heading(Title text, Level number) {
   render Text(Title)
}

render Heading(Title: "Hello", Level: 1)
render Heading(Heading.Title "Hello", Heading.Level 1)
```

The second invocation uses owner-qualified typed constructor values. Parameter annotations create
scoped nominal types such as `Heading.Title`; primitive/list parameter assignability still permits
compatible raw values. This does not turn every unqualified name at a call site into a label.

Explicit item-field fills also already use colons. A colonless item-field constructor can use its
field-owned nominal type under the enclosing item shape, which is a different binding route.

```scss
type PersonInput is { Name text }

let Explicit = PersonInput { Name: "Ada" }
let Typed = PersonInput { Name "Ada" }
```

Recommendation: retain `:` for explicit value-to-slot binding in arguments and item literals.
Colonless qualified construction is available when expressing a semantic typed value is useful.
A contextual short constructor inside calls is an alternative to investigate, not evidence that
colons can be removed without changing resolution, arbitrary-expression arguments, or ambiguity.

## S03 — boolean poles and typed absence

Stories: U05, U41; D01–D02, D32. Field and parameter type grammar already admits:

```scss
data Fish / FishRow {
   LivesUnderWater yes / LivesAboveWater no
}

view BusyIndicator(IsLoading yes / no) {
   render Text("Working")
}
```

The alias precedes `no`: `LivesUnderWater yes / no LivesAboveWater` does not follow the grammar.
Its terminating `no` keeps the alias distinct from a following field name. Uniform ordinary
`yes`/`no` values are decided intent but not fully implemented: ordinary literals currently use
`true`/`false`, and general boolean case validation still expects those spellings.

Data negative aliases currently serve as case names, not sibling properties:
`Item.LivesUnderWater is LivesAboveWater` is the relevant form; `Item.LivesAboveWater` does not
resolve as a field. Parameter type aliases do not create a local `HasContent` binding either.
Proposed consistency goal: both data fields and parameter-local boolean poles have a documented
positive and negative read form, without storing two disagreeing booleans. Readable inverse
properties/bindings would be a new feature, not something implied by a parsable type declaration.

Recommended distinctions:

```scss
if Document.Author is none { "No author assigned" }
if Author is missing { "This author no longer exists" }
if Authors is empty { "No authors match" }
if Title is empty { "Enter a title" }
```

These conditions require typing and narrowing; this sketch does not claim all are implemented.
`empty` applies to text and collections, not `0`, `no`, or an arbitrary item. For `text?`, first
establish that a text value exists before accessing text-only operations. An optional reference
being absent is separate from the referenced entity being unresolved or missing. Missing required
fields in a form belong to completeness/validation, not automatically to read availability.

## S04 — typed metadata with ergonomic predicates

Stories: U01–U15; D01–D12. Proposed metadata extraction:

```scss
let Read = Document status

render Col {
   guard Document
   DocumentEditor(Document)

   if Document is refreshing { "Updating…" }
   if Document is stale { "Checking for newer information" }

   when Read.Fetch.Phase {
      paused -> { Text(Read.Fetch.Reason.Message) }
      otherwise -> empty
   }
}
```

`Document status` is a candidate postfix expression returning reactive typed metadata. It keeps
framework metadata out of ordinary domain fields: an entity may already have a business field
called `Status`. Member names here are illustrative, not final reserved fields.

Proposed facets:

| Facet                | Example content                                                 | Type contract                                                  |
| -------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Availability         | unresolved, available, missing, inaccessible, unusable failure  | Closed discriminated cases appropriate to the resource         |
| Fetch                | idle, active, paused, retry delay, structured reason            | Reason exists only in cases that provide it                    |
| Freshness            | unknown, policy-fresh, stale, expired, invalidation reason      | Evidence and policy accompany the classification               |
| Completeness         | fields, requested window, more pending                          | Does not masquerade as a fully populated item                  |
| Provenance           | local, cache, server, optimistic, placeholder, previous request | Tied to the active request identity                            |
| CurrentAttempt       | idle, running, retry delay                                      | Identifies the currently scheduled or active attempt           |
| LastCompletedAttempt | success, failure, cancellation, with identity                   | A prior failure remains inspectable while another attempt runs |

The compiler must refine `Read.Fetch.Reason` inside the paused branch. A live guard establishes a
render-time usable read, not eternal availability after an asynchronous suspension. Read checks and
subsequent access need a coherent observation/snapshot rule. Revalidate subsequent live reads after
suspension; inspecting an explicitly retained immutable observation still describes its captured time.

Convenience predicates lower to these facets. `loading` describes initial acquisition without
usable data; `fetching` describes active retrieval including background work; `refreshing` needs
an existing usable result for the same request. A paused request is not actively fetching.

Freshness and a failed refresh are separate. Retaining the latest failure while retrying should be
possible, rather than forcing `stale` to disappear just because an attempt restarted.

## S05 — drilling into structured reasons

Stories: U02, U06, U12, U45, U57; D07, D12. Proposed nested matching:

```scss
let Read = Document status

render Col {
   when Read.Availability {
      unresolved -> {
         when Read.Fetch.Phase {
            active -> "Loading"
            paused -> {
               when Read.Fetch.Reason.Kind {
                  offline -> "Connect to load this document"
                  authentication -> "Sign in to continue"
                  otherwise -> Text(Read.Fetch.Reason.Message)
               }
            }
            otherwise -> "Waiting"
         }
      }
      inaccessible Problem -> {
         when Problem.Kind {
            loggedout -> "Sign in to continue"
            permissions -> "Request access"
            otherwise -> Text(Problem.UserMessage)
         }
      }
      error Problem -> Text(Problem.UserMessage)
      missing -> "This document is gone"
      available -> DocumentEditor(Document)
      otherwise -> "Document unavailable"
   }
}
```

This is a structural sketch. Exact discriminants, payload binding, branch refinement, and required
fallbacks need a type/grammar prototype. Unnamed availability states must not accidentally permit
field access: only the explicit `available` branch renders the editor, and the compiler must reject
unchecked access in a broader fallback.

Recommendation: use existing explicit nested `when` to select a named facet. Do not initially add
an implicit nested-pipe form where the child match subject is inferred from the parent's word.
`missing` means established absence, so loading/initializing should not be children of it.

Common failure metadata should include a safe message, common kind, originating operation or read,
and recovery evidence. Provider code/details may be optional or provider-specific typed values;
no universal HTTP status code should be promised for local storage or non-HTTP providers.

## S06 — local fallback plus additive application feedback

Stories: U54–U59; D06, D10–D12. Proposed local replacement:

```scss
guard Document {
   loading -> "Loading document…"
   missing -> "This document is gone"
   error Problem -> Text(Problem.UserMessage)
}
DocumentEditor(Document)
```

Separately, a candidate application policy provides additive feedback:

```scss
on read error Problem -> do ShowReadProblem(Problem)
```

The policy spelling is intentionally provisional. It is not a new event allowed in an ordinary
view block today. Decide its declaration owner, scope, event deduplication, and lifetime first.
It observes failure transitions or reports, not every render that happens to inspect an error.
It must not swallow local handling or replace the rest of the local render block.

Ordinary loading is not an error. A policy might separately observe read activity for a global
progress indicator. Permission recovery, warnings, and unexpected errors should not all become
identical toasts. Shared fallback UI must not depend on the same failing resource recursively.

## S07 — action sequencing, outcomes, and detachment

Stories: U40–U45, U50, U53; D24–D27. Proposed spelling over existing sequencing concepts:

```scss
action Submit() {
   let SavedDocument = do Save()
   do OpenDocument(SavedDocument)
}

action SubmitWithFeedback() {
   do Save() then {
      saved -> { do ShowSaved() }
      rejected Problem -> { do ShowValidationProblem(Problem) }
      error Problem -> { do ShowSaveProblem(Problem) }
   }
   do RefreshSummary()
}

action StartBackgroundWork() {
   async {
      do Save() then {
         saved -> { do NotifyCompletion() }
         error Problem -> { do RecordBackgroundProblem(Problem) }
      }
   }
   do ContinueImmediately()
}
```

The two `Save` examples assume suitable action contracts: the first returns a Document; the second
has local success plus declared and unexpected failure outcomes. Returned values and failure
payloads are different channels. Plain `do` waits if the action suspends and otherwise completes
directly. `then` handles the invocation outcome before later statements continue; it does not
detach work, guarantee remote acceptance, or block the UI thread while waiting.

Candidate shorthand `async Save() then { … }` should mean the same detached block, with its
handlers in the detached computation. Prefer the explicit block in the first prototype.

Defer `let Result = do Save() then { … }` until the result after handled failure is defined:
an optional result, a handler-produced fallback, or an early-exit failure path. Returning a typed
Result value is another possible design; it must not silently change ordinary `do` behavior.

Current outcome handling uses savepoint restoration, so a failure handler is not merely a Promise
callback. Detachment, transactional scheduling, view disappearance, cancellation, and durable work
ownership need their own explicit contracts. A later `ask … then` could combine awaiting a response
and matching it; ordinary value/render `when` remains selection rather than continuation.

## S08 — event input and canonical output

Stories: D24–D26, D34. Recommended canonical forms:

```scss
on press -> do Commit()
on change Entered -> do Commit(Entered)

on press -> {
   do Commit()
   do RefreshSummary()
}
```

Candidate accepted shorthand input:

```scss
on press -> Commit()
```

Normalize it to the explicit `do` form. This keeps invocation the same action statement inside
and outside blocks. Restrict normalization to handler action context; do not reinterpret ordinary
pure function calls or view renders globally. Preserve event-time invocation, payload arity, and
source diagnostics. One canonical output is preferable to two competing styles.

## S09 — repeated render contracts and grouping

Stories: U24–U26; D17–D19, D33. Proposed callable slot:

```scss
view RecordList(Records list of Record) {
   @row(Record, Position number): RecordRow

   render Col {
      loop Records / Record {
         @row(Record, Position: Loop.Position)
      }
   }
}

render RecordList(Records) {
   @row: CustomRecordRow
}
```

`Loop.Position` is deliberately unresolved placeholder spelling: current source loops bind only
the item, even though runtime callbacks receive an index. Decide explicit context binding,
position base, section/window/global meaning, and stable identity before exposing it.

A callable row slot is useful when a reusable collection owns virtualization, selection,
interaction, grouping, or navigation and the caller owns each row's appearance. Additional
callable group-header/footer slots may receive group identity, loaded count, and completeness.
Named definitions suffice initially; anonymous view syntax is an independent feature.

Grouping and row customization do not by themselves require callable slots. The existing planned
container-wrapped loop direction offers a simpler alternative, with proposed typed loop context:

```scss
render Grid {
   loop Records / Record, Context {
      CustomRecordRow(Record, Position: Context.Position)
   }
}
```

The second loop binding is an illustrative alternative to `Loop.Position`, not current grammar.
The caller supplies the loop body; the container can own its presentation strategy. Callable
slots become useful when a reusable view owns the iteration and must invoke caller-supplied
rendering with the view's item/context arguments. Neither sketch establishes implemented
virtualization, and neither is required simply to write nested group headers.

Two or three nested loops can instead express small eager hierarchies:

```scss
render ScrollView {
   loop Groups / Group {
      GroupHeading(Group)
      loop Group.Sections / Section {
         SectionHeading(Section)
         loop Section.Records / Record {
            RecordRow(Record)
         }
      }
   }
}
```

Nested loops add no scroll container; the explicit `ScrollView` supplies this example's inner
viewport, while full-screen host surfaces already scroll. Current loops eagerly create all their
rows; large collections need a bounded rendering contract. A virtualized grouped renderer
may flatten logical headers and rows into one window. It must preserve section membership, keys,
per-row state ownership, and selection; row-local state cannot be assumed to survive unmounting.

## S10 — cursor traversal independent of presentation

Stories: U16–U28; D13–D19. Candidate typed window, not implemented syntax:

```scss
query Recent = Records with { order by CreatedAt desc }
state Feed = window Recent(Size: 40)
let Page = Feed status

render Col {
   guard Feed
   loop Feed.Items / Record { RecordRow(Record) }

   when Page.After.Availability {
      available -> Button("Load more", Disabled: Page.After.Attempt is loading) {
         on press -> do Feed.LoadAfter()
      }
      exhausted -> "All loaded"
      unknown -> Button("Check for more", Disabled: Page.After.Attempt is loading) {
         on press -> do Feed.LoadAfter()
      }
      otherwise -> empty
   }

   when Page.After.Attempt {
      loading -> Spinner
      error Problem -> Button("Retry") { on press -> do Feed.RetryAfter() }
      otherwise -> empty
   }
}
```

`window`, `Feed.Items`, bound operations, and metadata fields are illustrative. The action-contract
prototype must establish where unhandled load/retry failures go; displaying a previous attempt's
error does not alone cover future operation failures. A final API should hide manual cursor
management in the common path but expose typed `before`/`after` boundaries for granular control.

Required semantics:

- Stable total ordering and tie-breakers. The example's single `CreatedAt` sort is insufficient
  when timestamps tie; the provider contract must append a stable key or expose multi-key order.
- Cursor identity includes query/filter/order/account scope and, when applicable, snapshot.
- Changing the query resets or explicitly migrates the traversal; an old cursor is not reused.
- Forward and backward progress/errors do not discard existing items.
- Repeated loads in the same direction must coalesce, serialize, or reject; recommend coalescing
  the same boundary request. Decide opposite-direction concurrency and refresh interactions.
- Reset/filter changes create a new traversal generation; obsolete completions cannot enter it.
  Disabling a button is UX, not a substitute for operation-level race protection.
- Continuation may be available, exhausted, or unknown. Exhaustion is relative to evidence and time.
- Loaded count, exact total, estimated total, and unknown total are different typed facts.
- A data window's retained pages and a renderer's mounted rows are independent limits.
- Snapshot traversal versus live range membership must be chosen; cursor opacity proves neither.
- Grouped pages can share one group, so a loaded group is not necessarily complete.
- Restoration includes query/window state and a visual anchor; one cursor does not restore both.

An indexed pager remains appropriate for in-memory sequences and providers with random access.
Do not promise cheap arbitrary page jumps by silently walking a forward-only cursor service.

## S11 — mutation receipts and observations

Stories: U29–U53; D20–D31. Candidate metadata handles:

```scss
let Submission = do Save(Document)
let Write = Submission status

when Write.Delivery {
   queued -> "Saved on this device"
   sending -> "Synchronizing…"
   accepted -> "Accepted by the server"
   rejected Problem -> Text(Problem.UserMessage)
   unknown -> "Checking whether the save completed"
   otherwise -> empty
}
```

This assumes an explicitly receipt-returning `Save` contract; ordinary actions must not all change
their return type to a receipt. A durable submission has its own identity and owner. A row's write
summary is an aggregate, not a replacement for individual receipts. Delivery and authority outcome
may need separate facets rather than the compact illustrative match above.

Candidate observation surface:

```scss
state Updates = observe Feed(Fields: { Title, Body }, Scope: View)

loop Feed.Items / Record {
   let Change = Updates.For(Record)
   RecordRow(Record)
   if Change.Unseen { NewDot }
   on select Displayed -> do Updates.Acknowledge(Record, Revision: Displayed.Revision)
}
```

`observe`, scope values, selected-field notation, and bound actions are proposals. Initial hydration,
membership arrival, actual creation, field change, local edit, acknowledgment, and rollback must
be distinguishable. `Displayed` is a proposed immutable selection-event payload captured from the
rendered row's revision, not a live metadata read at callback execution; current `on select` does
not provide that contract. Acknowledge that displayed revision even if N+1 arrived after N rendered
but before selection. Local persistence and per-user synchronized acknowledgment are separate capabilities.
Transient highlight timers do not implicitly acknowledge or alter durable read state.

## Current evidence and gaps

| Question               | Live repository evidence                                                                                    | Consequence                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Scoped parameter types | `Type.ts` attaches nominal identity to ParameterTypeDeclaration and resolves owner-qualified names          | Parameter names already have a type identity; strictness differs by underlying type     |
| Argument/item labels   | `expressions.langium` Argument and ItemProperty use optional `ID ':'`                                       | Explicit labels already use colons in both positions                                    |
| Boolean aliases        | `data.langium` and `types.langium` use `yes / [Alias] no`                                                   | Type syntax exists; ordinary literals and parameter inverse reads need consistency work |
| Slot placements        | `views.langium` separates slots from root render targets                                                    | Bare placement can remain; root slots and callable signatures are additions             |
| Nested loops           | `FunctionalCoreCompiler.ts` emits recursive `TR.ForEach`                                                    | Nesting itself adds no scroll container; current loops are eager                        |
| Action suspension      | `ActionsCompiler.ts` emits await for suspending calls and resolved bindings                                 | `do` sequencing is independent of `then` or detachment                                  |
| Outcome handling       | `TR-effect-outcomes.ts` handles synchronous and Promise-like results with savepoint restoration             | `then` is language outcome handling, not a requirement to expose Promises               |
| Current pagination     | `data.langium` query clauses and `TR-data.ts` query plans expose filters/order/limit, no cursor/page result | Current limit does not imply continuation or a paginated provider seam                  |
| Planned pagination     | Decisions §9 describes `Pages(Page: …)`, offsets, cursor walks, and totals                                  | Reconsider these planned guarantees explicitly; do not present them as shipped          |
| Read safety            | Type System spec defers guard narrowing and unguarded-read rejection                                        | Runtime fallback is not yet the proposed static guarantee                               |

## Pagination research

These sources inform the proposal; their API words are not automatically Tao's spellings.

| Source                                                                                                      | Vocabulary or finding                                                                | Design implication                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Relay connections](https://relay.dev/graphql/connections.htm)                                              | `first/after`, `last/before`, opaque cursors, pageInfo, consistent edge order        | Expose traversal direction and do not require totals                        |
| [PostgreSQL LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)                       | Stable ORDER BY required; skipped rows still incur work                              | Indexed navigation has different cost and consistency from cursor traversal |
| [Firestore cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors)                    | Inclusive/exclusive bounds and multi-field cursor values                             | Stable ties matter; cursoring on a timestamp alone is insufficient          |
| [TanStack infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries) | pages/pageParams, next/previous operations, retained-page limits, background refetch | Separate direction, acquisition, page retention, and rendering              |
| [Convex pagination](https://docs.convex.dev/database/pagination)                                            | LoadingFirstPage, CanLoadMore, LoadingMore, Exhausted; reactive page sizes           | Live range consistency differs from immutable fixed pages                   |
| [React Native SectionList](https://reactnative.dev/docs/sectionlist)                                        | Sections and virtualization; row state does not survive outside the window           | Typed row/group contracts and state ownership need independent design       |
| [React Native anchoring](https://reactnative.dev/docs/scrollview#maintainvisiblecontentposition)            | Preserving visible position during prepends; reordering caveats                      | Anchor restoration and cursor restoration are separate                      |

## First prototype acceptance corpus

1. Bare view, text, bare slot, explicit empty slot call, parameterized slot call, and colon fill
   adjacent on one line and across lines; string style clauses precede bodies.
2. Named argument, nominal constructor argument, item literal, nested call, optional value, and
   repeated parameter type with labels; no resolution by accidental source position.
3. Entity, query, text, list, number, yes/no, optional reference, and incomplete item checks;
   negative type tests for unsupported emptiness and unguarded access.
4. Nested reason matching, additive app observer, local fallback, shared fallback, and explicit
   empty handling; failure coverage follows ownership, not proximity of an error branch.
5. Synchronous and suspending direct calls, bound results, handled outcomes, detached roots,
   failed caller, view disappearance, and queued submission after relaunch.
6. Empty+refreshing, stale+retrying, partial+offline, page-error+existing-content, and
   failed-write+queued-write combinations; source order is visible and no hidden reordering occurs.
7. Forward/backward traversal, duplicate sort values, changed filters, expired cursor, unknown
   continuation/total, repeated loads, opposing loads, refresh/reset completion races, live
   insertion/deletion, grouped page boundaries, and anchor restoration.
8. Initial observation baseline, selected-field update, own optimistic write, concurrent new
   revision between render and acknowledgment, manual unread, and recycled/off-screen rows.

The first implementation slice selects a subset of this corpus. The rest remain explicit design
checks or deferred acceptance, not claims of completed behavior.

## S12 — contextual dot fills and named-type preference

Stories: D01, D32, D34. Proposed alternatives:

```scss
type Name is text
view Greeting(Name) { render Text(Name) }

render Greeting(Name: "Hi")
render Greeting(.Name "Hi")
render Greeting(Name "Hi")
```

The first is an explicit label; the second is a proposed contextual fill marker; the third is an
ordinary named constructor value. A leading dot is currently not an expression primary, so it
offers a distinct syntactic branch. It does not collide with `.5` numerals, which Tao does not
currently accept, or relative import paths such as `./file`.

Recommendation: resolve `.Name` against the immediate enclosing callable's slot, never by guessing
from ambient names. Select that slot explicitly and check its declared type. A literal may be
contextually constructed against that type; an existing differently named value must not silently
be rebranded. For `view Greeting(Name text)`, the owner-scoped type is Greeting.Name; for the
preferred `view Greeting(Name)`, it is the separately declared Name type.

This makes `.Name` sufficient punctuation for an explicit fill in this position. Decide whether
it is exactly a label alternative, or a constructor-valued expression with different storage
semantics. A pure type-only interpretation must still handle multiple same-type slots reliably.
Prototype expression boundaries, nested calls/items, duplicates, defaulted arguments, writable
parameters, and source diagnostics before canonicalizing it or removing compatibility colons.

Item construction already supplies an owner context and colonless entries:

```scss
type PersonInput is { Name, Age }
let Input = PersonInput { Name "Ada", Age 37 }
```

The item example does not need a new dot marker. A proposed dot-fill argument still needs an
unambiguous immediate owner; nesting resolves to the nearest owner.
General support for arbitrary value expressions after `.Name` needs the same delimiter policy as
other argument/item fills; literal examples do not prove all expressions parse.

Prefer named semantic types at declaration boundaries:

```scss
type IsLoading is yes / no
type Name is text
type Age is number
view Indicator(IsLoading) { ... }
```

Recommend a style diagnostic first for primitive parameter/field declarations, with fixes to extract
a named type. Primitive backing types inside `type … is …`, literals, inferred intermediate
expressions, generic library machinery, and foreign boundaries need deliberate exemptions.
Do not demand a new name for every comparison result or break text render sugar. Tightening nominal
assignability is a separate semantic migration from nudging declaration style.

## S13 — inverse fields and opposite boolean types

Stories: D02, D32. Requested inverse field behavior:

```scss
data People / Person {
   IsHappy yes / IsSad no
}

if Person.IsHappy { "Happy" }
if Person.IsSad { "Sad" }
```

There is one stored field. The inverse read derives logical negation; it is not independently
persisted. Current aliases are instead case-test names: `Person.IsHappy is IsSad`; they do not
resolve as sibling fields. Adding the inverse member is a new implementation slice. Inverse writes
can normalize into the positive stored field. Validate duplicate/conflicting fills after that
normalization, and decide collisions with real fields.

An opposite nominal-type pair is a larger candidate:

```scss
type IsHappy is yes / IsSad no

view Happiness(IsHappy) { ... }
view Sadness(IsSad) { render Happiness(not IsSad) }

let Happy = IsHappy yes
let NotHappy = IsHappy no
let Sad = IsSad yes
let NotSad = IsSad no

render Col {
   Happiness(Happy)
   Happiness(NotHappy)
   Sadness(Sad)
   Sadness(NotSad)
   // Happiness(Sad): type error under the proposed strict pair contract.
   // Sadness(Happy): type error under the proposed strict pair contract.
}
```

This candidate exports two nominal orientations of the same predicate, not two unrelated scalar
aliases. `not Sad` would have type IsHappy and value no; `not NotSad` would have type IsHappy and
value yes. Double negation restores original type and value. Type and value polarity are both
part of the operation.

Current behavior does not supply this: the negative name is not another type declaration, boolean
constructor literals are not admitted by current constructor grammar, and `not` erases nominal
identity to primitive boolean. The existing code consequently does not establish these strict
assignment examples.

Recommendation: pursue readable inverse fields; prototype explicit opposite type pairs separately.
Do not automatically export a new global type for every inline field alias. Decide plain named
boolean negation, generic functions, `and`/`or` result types, contextual literals, optional booleans,
pair-name collisions, and explicit conversions. Proposed default: `and`/`or` produce general
yes/no; special `not` preserves the declared pair's orientation relation. An unrelated IsHappy2
must not become assignable merely because its backing type is yes/no.

## S14 — absence, emptiness, and missing-target examples

Stories: U05, U11, U41; D01–D02, D08. The following is pseudocode with assumed fixture values and
types. It describes recommended checks, not the current parser's support for optional cases.

```scss
type Name is text
type Count is number
type Age is number
type Enabled is yes / no
type Names is list of Name
type Card is { Title Name, Subtitle Name?, Count, Enabled }

let PresentText = Name "Ada"
let BlankText = Name ""
let Zero = Count 0
let Off = Enabled no
let UnsetName = none                         // Exactly none; no Name type is inferred.
let EmptyNames = Names []
let SomeNames = Names [PresentText]
let LocalCard = Card {
   Title: BlankText, Subtitle: none, Count: Zero, Enabled: Off
}

PresentText is empty                         // no
BlankText is empty                           // yes
BlankText is none                            // proposed type error: statically nonoptional
BlankText is missing                         // type error: not an entity resource
Zero is none                                 // proposed type error: statically nonoptional
Zero is empty                                // type error: number has no emptiness
Off is empty                                 // type error: no is not emptiness
UnsetName is none                            // yes
UnsetName is empty                           // type error: exactly none has no text/list content
EmptyNames is empty                          // yes
SomeNames is empty                           // no
EmptyNames is none                           // proposed type error: statically nonoptional list
EmptyNames is missing                        // type error: list is not an entity target
let FirstName = At(EmptyNames, 1)             // Schematic safe lookup returning Name?.
FirstName is none                            // yes: no member at that position
LocalCard.Title is empty                     // yes
LocalCard.Subtitle is none                   // yes
LocalCard.Count is empty                     // type error
LocalCard is empty                           // type error: no generic empty item
LocalCard is missing                         // type error: plain item is already a value

if LocalCard.Subtitle is not none {
   LocalCard.Subtitle is empty               // valid text check after narrowing
}
```

Optional item/list values can likewise be none; present items do not gain a generic empty case,
while present lists can have zero members. An empty text is zero-length; whitespace policy belongs
to a distinct blank/completeness rule unless explicitly changed.

Data fields require the containing resource to be usable:

```scss
data People / Person {
   Name
   Nickname Name?
   Age
   Enabled
   Manager Person?
}

// Alice is a loaded fixture with Name "", Nickname none, Age 0, Enabled no, Manager none.
guard Alice
Alice.Name is empty                          // yes
Alice.Nickname is none                       // yes
Alice.Age is empty                           // type error
Alice.Manager is none                        // yes: no target reference assigned

// Bob.Manager contains a reference to a known absent Person.
guard Bob
Bob.Manager is none                          // no: the reference was supplied
// Narrow the optional reference before asking target availability.
if Bob.Manager is not none {
   Bob.Manager is missing                   // yes: target established absent
}
```

Single-target lookup and collection resources are different types:

```scss
let MissingPerson = LookupPerson(KnownAbsentId) // Entity resource; lookup is schematic.
let PendingPerson = LookupPerson(UnresolvedId) // No answer yet.
query NoMatches = People with { where Name == Name "NoSuchPerson" }
query Matches = People with { where Enabled == Enabled yes }

MissingPerson is missing                     // yes, assuming established absence
PendingPerson is missing                     // no: absence not established
MissingPerson is empty                       // type error: entity is not a collection

guard NoMatches                              // Fixture query successfully answered.
NoMatches is empty                           // yes
NoMatches is missing                         // type error: zero matches is not a missing target

guard Matches
Matches is empty                             // depends on resolved content
```

For unresolved queries, content emptiness must not establish that an authoritative answer exists.
Recommended first slice: require a usable-read boundary before content operations. Metadata
availability checks remain usable while waiting/loading/error. An unavailable receiver must never
turn its field into none, zero, no, or empty silently.

A datasource has initialization, connectivity, synchronization, and storage failure; it has no
universal empty condition. Its tables and resolved queries have their own scoped content counts.

## S15 — sequencing corrected and optional continuations

Stories: D24–D27. Sequential does not mean physically synchronous or UI-blocking.

| Form                                                | Recommendation or existing boundary                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `do A()`                                            | Existing sequential invocation; completes or suspends before following statements       |
| `let X = do A()`                                    | Existing binding of A's resolved return value, not its status                           |
| `do A() then { error Problem -> … otherwise -> … }` | Proposed outcome-match spelling; wait for the selected handler too                      |
| `A() then { … }`                                    | Possible input shorthand, canonicalize to explicit do if admitted                       |
| `do A() then { do B() }`                            | Separate success-continuation proposal; ordinary sequential statements already cover it |
| `do A() then Result -> { … }`                       | Separate returned-value continuation proposal; does not imply outcome metadata          |
| `let Work = async do A()`                           | New Task feature, not today's async; initially reject assignment                        |
| `async { do A() then { … } }`                       | Detached computation; its internal statements still sequence                            |
| `let X = A()`                                       | Pure function call if A is a function; actions still need do                            |

`otherwise` selects all remaining outcomes, including failure cases not explicitly matched. Therefore
bare success continuation must not lower to an otherwise branch. It would lower to the appropriate
success case (`saved` or `completed`) if adopted. Failure propagation and ownership remain active.

Current async queues work until its root finishes, then runs a separate serialized root. It does
not immediately start a parallel OS thread; root completion may be commit or rollback. Changing
that scheduling is a runtime decision, not a spelling change.

If Task handles are added later, define result type, checked failure ownership, join, cancellation,
observation, and lifetime before accepting `let Work = async …`. Work would be a handle, not the
eventual result. Distinguish in-memory tasks from durable submissions.

## S16 — metadata types, bare guards, and inline nested matching

Stories: D06–D12. `let Read = Document status` would infer a compiler/library-owned metadata family,
conceptually ReadStatus<Document, FailureContract, Capabilities>. This notation describes the model;
it does not assume generic syntax exists in Tao. A query, entity, operation, and datasource need
different status shapes. Do not reduce all of them to one nominal enum or arbitrary dictionary.

In particular, Fetch phase can be idle/active/paused; purpose can be initial/refresh/load-before/
load-after. `Document is refreshing` derives from active acquisition for refresh of a usable result
for the same request. It is not necessarily `Read.Fetch.Phase is refreshing`. Provider capabilities
and discriminants determine which details exist and can be safely accessed.

Bare render guard means use shared handling for unavailable cases and protect later siblings:

```scss
render Col {
   guard Document
   DocumentEditor(Document)
}
```

Today the read net provides Spinner for loading and appropriate Text for missing/unauthorized/error,
with project overrides. It is not implicit empty rendering. Explicit `missing -> empty` suppresses
that case's content and stops later siblings; other omitted unavailable cases use shared handling.
Action guards have a separate early-exit/fallthrough contract and must not be conflated with this.

An inline nested match is a useful atomic branch:

```scss
when Read.Fetch.Phase {
   paused -> when Read.Fetch.Reason.Kind {
      offline -> "Connect to continue"
      authentication -> "Sign in to continue"
      otherwise -> Text(Read.Fetch.Reason.Message)
   }
   otherwise -> empty
}
```

Recommend supporting that same nested-match shape in render, value, and action contexts where the
branch result type permits it. Outer discrimination must refine the reason payload before the inner
match. Both accesses must use the observation captured by the outer discrimination, not unrelated
live rereads. Access against a later live observation or guarded live resource use after suspension
requires revalidation. A retained immutable observation remains valid historical evidence. The
snapshot/lifetime mechanism remains an open implementation contract. Braces remain useful for
multiple sibling statements. Nested atomic render matching itself already exists in the grammar;
typed metadata access and coherent narrowing are the added contracts.

## S17 — eager, virtualized, grouped, and hierarchical rendering

Stories: U16, U24–U28; D17–D19. Recommended ownership:

1. `loop` stays ordinary eager iteration without creating a viewport.
2. A library list/grid/table/tree view owns viewport sizing, layout, windowing, recycling, and keys.
3. Typed render contracts or a container-wrapped loop body supply row appearance and optional context.
4. Pagination acquires/retains data independently of which rows are mounted.

A container-wrapped loop alternative requires iteration descriptors, a renderer function, or
explicit owner-aware lowering. Passing already constructed eager children to a container does not
establish virtualization. The source marker and lowering contract for this alternative remain open.

A free-standing `lazy loop` cannot determine visibility without an owner. It would either implicitly
create a viewport or register with a surrounding one. Prefer making that owner explicit first; a
future contextual lazy-loop shorthand could lower to the same contract.

Small eager composition:

```scss
render Col {
   loop Messages / Message { MessageRow(Message) }
}
```

Proposed virtualized library view with contextual renderer-fill binders:

```scss
render LazyList(Messages) {
   @item(Message, Context): MessageRow(Message)
   @empty: "No messages"
}
```

Here the tuple before `:` declares names bound by the expected slot signature, not arguments sent
to a slot. This is a new anonymous-renderer fill shorthand to compare with an explicit named view
or `@item: view(…) { render … }`. In an ordinary render placement, `@item(Message)` is instead an
invocation. Context supplies typed position, stable occurrence identity, and supported viewability/
selection/ancestry evidence. No metadata binding is required if the renderer does not use it.

The foreign implementation can use native list components, but app authors should use a typed Tao
library contract rather than write TypeScript for ordinary lists. Generic item signature validation,
reactive invalidation, state ownership, and source diagnostics need implementation evidence.

Depth-two grouping can use one sectioned viewport:

```scss
let Days = GroupMessagesByDay(Messages)        // Typed grouping adapter, schematic.
render GroupedList(Days) {
   @header(Day, Context): DayHeading(Day)
   @item(Message, Context): MessageRow(Message)
}
```

Depth-three hierarchy usually becomes one visible row stream, including headers:

```scss
let Rows = VisibleRows(Regions)               // Region -> City -> Message hierarchy adapter.
render LazyList(Rows) {
   @item(Entry, Context): HierarchyRow(Entry, Context)
}
```

VisibleRows yields typed RegionHeader, CityHeader, Message, optional footer, and unresolved-branch
entries with ancestry/depth. The adapter indexes descriptors; it must not eagerly construct every
view or fetch all descendants. Expansion, pagination, and filtering alter visible descriptors.
HierarchyRow receives an appropriate typed discriminated entry, rather than guessing a value type
from numeric depth. Multiple levels of sticky headers need an explicit advanced capability.

Virtualizing whole groups while eagerly constructing every child inside each visible group does
not bound child rendering. For one continuous same-axis document, recommend one viewport owner.
Independent panes or bounded horizontal carousels are different layouts and can have separate owners.
Nested same-axis virtualizers need deliberate viewport, measurement, gesture, and reveal contracts;
they are not categorically forbidden, but must not be silently introduced by grouping depth.

Context should distinguish local section position, loaded-window position, ancestry, and known global
position. Recommend public ordinal Position be 1-based if selected, while platform indexes stay an
implementation detail. Unknown global position/count is typed unknown. Identity is never position.
Preserved row state belongs outside an unmounted/recycled occurrence unless a retention contract
explicitly says otherwise.

## S18 — pagination without reserving domain properties

Stories: D13–D16, D36. All alternatives are proposed; current provider plans lack this seam.

Alternative A, recommended explicit owned window:

```scss
query Recent = Messages with { order by CreatedAt desc }
paginate Feed = Recent with { size 40 }
let Paging = Feed status

render LazyList(Feed) {
   @item(Message): MessageRow(Message)
   @footer: Button("Load more") { on press -> do LoadAfter(Feed) }
}
```

The handle owns traversal state and iterates its loaded records. No `.Page`, `.Cursor`, `.Items`,
or `.Status` is installed on a domain Message. Feed metadata has its own typed namespace; window
operations are ordinary typed library actions. The footer is deliberately abbreviated: a real
sketch must inspect continuation/progress, prevent duplicate loads, and establish failure ownership.
Read activation/lifetime/reset of the paginate declaration still need decisions.

Safety correction: if Recent is an ordinary current live query, its containing view can activate
an unbounded fill before Feed exists. This split spelling requires an inert query-plan type, or a
single paginated query declaration. Do not assume the first line is inert. S26 recommends the
single-declaration variant.

Alternative B, explicit request clauses:

```scss
query Slice = Recent with { first 40, after ResumeCursor }
let Page = Slice status
```

This describes one request boundary, not automatically an accumulated feed. Cursor is an opaque
query/scope-bound type. Stable ties need a total order, not CreatedAt alone. Backward traversal uses
last/before; inclusive bounds should be distinct if supported. Payload values and page evidence
remain typed separately, and changed filters invalidate the cursor's applicability.

Alternative C, render-local policy:

```scss
render LazyList(Messages) {
   pagination size 40, direction forward
   @item(Message): MessageRow(Message)
}
```

This is concise but makes the rendering owner also own acquisition state. Recommend retaining an
explicit data window as the foundational API; the local policy could be sugar only if sharing,
restoration, reset, error ownership, and metadata extraction stay predictable.

Alternative D, indexed presentation of known content:

```scss
state PageNumber = 1
render Pages(.Page PageNumber) {
   loop Steps / Step { StepView(Step) }
}
```

This combines the planned Pages container with the new dot-fill candidate; it is not implemented
proof. Indexed presentation of an in-memory sequence is different from cheap random access to a
remote cursor service. Do not give them a universal equal-cost contract.

Recommended common words: before/after for boundaries, size for requested amount, available/
exhausted/unknown for continuation evidence, loaded versus total for counts. App-facing labels such
as older/newer can map to those directions without changing cursor semantics.

## S19 — lowercase keywords and prefix ownership

Stories: D06, D13, D34; U54–U57. Prefix metadata is useful when its owner is explicit:

```scss
accessible label "Cat"
view Cat() { ... }

render Col {
   #cat
   accessible label "Current cat", role button
   Cat()
}
```

This sketch follows the proposed accessibility direction, not existing syntax. Declaration metadata
provides defaults; occurrence metadata applies to the next visual target. Decide merge/override and
clearing behavior. Prefixes should not leak to later siblings, an enclosing loop, or every child of
a container accidentally. An annotation before a loop needs an explicit owner rule or a diagnostic.
Role values should be a checked vocabulary rather than arbitrary strings. An a11y alias can be
accepted as input and formatted to one canonical accessible spelling.

Lowercase keywords can provide resource/metadata namespaces without consuming domain property
names: `Document status`, `paginate Feed = …`, and explicit control/feedback statements. But a
stateful window declaration is not merely an annotation; its lifecycle and effects must remain
visible. Do not turn arbitrary lowercase library option names into globally reserved keywords.

Recommendation: use prefix statements for target metadata; dedicated declarations for stateful
resources; postfix inspection for their typed status; ordinary action statements for operations.
These can share casing and clause-list conventions without sharing an ambiguous ownership rule.

## S20 — implemented-first corrections

Stories: D01, D24, D33–D34. Current source/acceptance-test evidence already supports:

```tao
type Name is text
type PersonInput is { Name }
let Person = PersonInput { Name "Ada" }
let Name = Name "Ada"
let Raw is Name = "Ada"

type PersonFields is { Label text }
type LabelInput is PersonFields.Label
let Label = PersonFields.Label "Ada"
```

Colonless configured-item entries resolve against owner fields. Unlabeled call arguments bind by
unique exact/nominal type; ordinary raw values can satisfy named scalar targets. Same-type/defaulted
slots still need explicit selection. `let Name "Ada"` is not current scalar sugar: alias grammar
requires `=`. Same-name bare _item_ initialization does exist (`let PersonFields = { Label "Ada" }`).

Current nested atomic render matches exist; coherent typed resource metadata narrowing is the
accepted addition. Current outcome handling is `when do A() { saved -> { … } error -> Problem { … } }`:
it waits for the selected handler. Inner `async { … }` detaches that work after the caller root ends.

Current optional absence checks use `Value == none`; `is none` is proposed. Statically nonoptional
values compared to none already fail equality compatibility validation. A none initializer infers
the none value type, not an arbitrary optional named type.

Full-screen host surfaces already scroll; nested views do not automatically gain independent
viewports. Public `ScrollView()` is vertical, not virtualized. Horizontal/overflow spellings remain
unsupported. Forms already use ordinary grouped state and controls: TextInput submit has no payload,
while change carries text. A loop exposes only its item binding; collection Count exists.

Queries are local reactive reads owned by a view. Their declarations lower to TR.Data.Query;
mounted query hooks activate fill descriptors. This is not an inert query plan, explicit user-triggered
activation, cursor pagination, or demand for individual pages. Limit caps local results and is offered
to fill adapters; provider conformance must establish server-side bounding.

## S21 — minimum punctuation and predictable owner binding

Stories: D01, D34. Prefer existing named constructor values and colonless owner entries where they
identify a unique target. Keep declaration heads (`Name text`, shorthand `Name`) distinct from values.

```scss
type Name is text
view Greeting(Name) { ... }
Greeting(Name "Ada")                          // Already an unlabeled typed value.
PersonInput { Name "Ada" }                     // Already an owner-context item entry.
Pair(First "Ada", Last "Lovelace")             // Proposed owner-context call fills.
```

Removing every label colon is possible in principle if calls adopt predictable owner-entry
resolution and lists have explicit separators. It is not merely deleting tokens: repeated
same-type/defaulted/mutable slots and type/parameter name collisions need a chosen selection rule.
An explicit owner entry must not silently become a differently resolved ambient constructor.
Commas are already required between call arguments and declaration parameters; globally optional
item separators are a separate decision. Whitespace alone is not a reliable expression boundary.

Compared candidates: owner entries `First "Ada"`; contextual `.First "Ada"`; qualified
`Pair.First "Ada"`; keyword `First value …`; assignment-like `First = …`. Prefer ordinary named
values, then owner entries if their collision rule proves predictable. Dot fills remain a fallback
for explicit selection. No recommendation to require `Name: Name "Ada"` for literals.

Keep dot qualification: Foo.Name and Foo.Details.Age already denote scoped slot types, while value
member access, package selection, units, shades, decimals, and import paths use dots in their own
contexts. `Foo>Name` competes visually/syntactically with comparison; `Foo::Name` adds a qualification
operator without solving argument ownership. These are alternatives, not accepted replacements.

## S22 — occurrence metadata, trees, and infinite presentation

Stories: U16, U24–U28; D17–D19. A tree view displays an expandable parent/child hierarchy. A grouped
list can be flat sections without expansion; a table has rows/columns. All can share viewport and
typed renderer contracts without being the same component.

For renderer fills, prefer the arrow as the boundary between received arguments and body:

```scss
render LazyList(Messages) {
   @item Message -> MessageRow(Message)
   @empty: "No messages"
}
```

This is proposed anonymous-renderer syntax. `@item Message: …` is also feasible; multiple binders
need a delimited list either way. A zero-argument rendered fill retains `@empty: …`. Do not confuse
a binder with an existing slot placement or ordinary rendered content followed by a sibling.

Iteration metadata belongs to an occurrence, not the entity itself: the same entity can occupy
different positions in two lists or repeated positions in one. Proposed explicit context binding:

```scss
loop Messages / Message, Context {
   "{Context.Position}: {Message.Body}"
}
```

Candidate contextual `position of Message` could lower to that binding within the owning loop.
Do not attach a global index trait to Message. Named renderer views receive Context explicitly.
Recommend 1-based public positions/page numbers; platform indexes stay internal. Position, loaded
count, total evidence, first/last-in-loaded-window, continuation, stable occurrence key, ancestry,
section position, expansion, selection, and visibility are separate typed data. Last-loaded does
not imply last-in-source. Unknown total is not zero or an optional number with no reason.

VisibleRows returns a collection/read window of typed discriminated descriptors, for example
RegionHeader(Region), CityHeader(City), MessageRow(Message), and BranchPending(Branch). It does not
return views. Context is an ordinary checked record appropriate to its owner, with names for every
written type; generic family notation remains to be selected.

Automatic virtualization can be a guarantee of collection views (List/GroupedList/Tree) without
forcing callers to choose a threshold. Arbitrary loops cannot silently become scroll owners; an
owner-aware loop contract remains possible. A continuous hierarchy should normally have one owner.

Infinite scrolling combines bounded acquisition, bounded mounted views, independent retained-data
limits, directional continuation/error state, and a scroll-triggered request. Consider unknown
totals/endpoints, bidirectional history, duplicate triggers, refresh/reset races, live insert/delete,
group boundaries crossing pages, stable anchors, restoration, accessible manual-load alternatives,
and reduced-motion/focus behavior. A library view can automate the trigger; pagination owns requests
and failure handling. Ordinary apps should not require TypeScript injection.

## S23 — joined continuations, forms, and effect timing

Stories: D24–D27, U40–U49. A selected then-handler is joined: the caller waits for it, including
suspensions. Detachment is explicit. Ordinary sequencing and joined continuation have the same
completion ordering; a handler does not become detached merely because a callee suspends.

```scss
do Save() then Result -> {
   async { do Notify(Result) }
}
do Finish()
```

This returned-value binder is proposed; the inner async block is existing. Under current detached
scheduling, Notify runs after the enclosing root finishes, not immediately alongside Finish.

Run-inline-until-first-suspension is possible to design but changes action/transaction/failure
ownership. Cache hits, network changes, or callee refactoring would change ordering. Recommend
against making it an implicit then behavior. Existing transitive suspension analysis can support
future no-suspend diagnostics; type effects should validate promises, not secretly select detachment.

A Task handle would support starting work, continuing, later joining/canceling/observing it. It is
not equivalent to a resolved binding. Current queue-after-root async cannot provide same-root
concurrent start-and-join without a scheduler change; accepting a handle alone could deadlock.
An async block already expresses operation-plus-completion-handler detachment without a handle.

Current forms group field values in ordinary item state, bind writable Value parameters, and submit
through actions reading that state. Submit has no aggregate payload. A form keyword/view could add
validation, dirty/touched state, field errors, accessibility, and submission coordination, but these
need a forcing feature before another declaration kind. A typed library form is the first candidate.

## S24 — absence vocabulary and checked member paths

Stories: D01–D02, D06–D12. Distinguish origin and meaning before adding synonyms:

| Value/source                    | Lack of value/content                        | Separate unavailable state                          |
| ------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| Mandatory local scalar          | No absence; text may be empty                | None                                                |
| Optional scalar/item/list field | none                                         | None for a plain value                              |
| Safe lookup in a finite list    | none if no member at the position            | None for a plain list                               |
| Assigned entity reference       | Target may be established missing            | Unresolved, denied, failed                          |
| Successfully resolved query     | Zero results is empty                        | Initial/unusable read states                        |
| Paginated window                | Zero loaded records; continuation may remain | Directional progress/error plus incomplete evidence |
| Member path                     | First blocked step, with path and reason     | Later steps are not yet observed                    |

For one optional entity reference, none and target-missing are mutually exclusive. Their AND is
impossible; XOR equals OR when those are the alternatives. Neither does not prove available:
the target can be unresolved/denied/failed. Recommend none, empty, missing and an availability
predicate first. An optional absent helper could mean none OR established missing, but must not
include loading or denied; leave it undecided rather than creating AND/XOR/NEITHER keywords.
Application rules like blank-title should compose typed predicates rather than change empty.

Current optional intermediate member access is rejected, and static narrowing is deferred. Runtime
null tolerance does not establish a typed optional chain; it can erase an unavailable receiver into
none. The future contract must not inherit that hole.

For plain optional-path lifting, the result would be T or none. For resource projection, the result
needs a read handle of T with first-blocker evidence; failure must not be converted into none.
Normal checked member access, optional lifting, and resource projection are distinct choices.
Recommend checking each live boundary first, with ergonomic projected-read syntax investigated
separately. Do not aggregate unobserved downstream states. A successfully reached resource can
expose its own independent facets; a dependency path exposes why reaching it stopped.

## S25 — every inferred type needs a written name

Stories: D01, D06, D33. Requested direction: no inferred-but-unspellable public type. Compiler-owned
types may be nonconstructible by app code, but should remain nameable in declarations/diagnostics.
Current none literals have an internal none type without a primitive type-reference keyword;
query/availability metadata do not yet have written resource-family constructors.

Built-in list of T and action(T) are already parameterized shapes. User-defined generic declaration
parameters are not implemented. Concrete generated status/context types could name one app's
values, but reusable List/Tree/Read/Window libraries need a principled family mechanism. Recommend
limited explicit type parameters for data shapes/signatures, not arbitrary compile-time computation.
Possible `ReadStatus of Document` notation is illustrative and remains a syntax decision.

Concrete declaration-owned names such as Feed.Cursor could reuse the scoped-type convention before
general family syntax is implemented. A future type-of-expression reference could name any inferred
type, but is not a substitute for a readable schema and sound family contract.

Generic nominal branding can prevent cursor-family mixups, but cannot statically encode every
runtime filter/auth/ordering value. Runtime scope validation is still required.

## S26 — a bounded query owns its pagination

Stories: D13–D19, D36. Prefer one paginated query declaration so no intermediate unbounded live
query activates. Proposed spelling:

```scss
query Feed = Messages with {
   order by CreatedAt desc
   paginate 40
}
let Paging = status of Feed

render InfiniteList(Feed) {
   @item Message -> MessageRow(Message)
}
```

paginate 40 would mean initial and continuation acquisition are bounded, not merely that a loaded
list is locally truncated. Demand ownership, activation, reset, and retention still need contracts.
InfiniteList can request at a threshold through the same typed operations used by a manual button.

```scss
on press -> { do LoadAfter(Feed) }
on refresh -> { do Refresh(Feed) }
```

These event/operation spellings are illustrative, not implemented list events/actions. Indexed
navigation uses a capable pager's index binding; an accumulated feed need not have one page number.
Distinguish refresh, initial activation, append/prepend acquisition, retry of a failed request, and
navigation among already acquired windows. Do not make every one of them next page.

ResumeCursor comes from a previous matching page response or restored traversal handle. It is an
opaque typed token tied to query/order/scope/consistency, not a text string or guessed position.
The provider must validate expired/incompatible tokens. first/after and last/before are external
connection vocabulary; current Tao supports neither clause pair. The existing Decisions Pages
contract is planned indexed presentation, not implemented remote cursor paging.

Compare postfix `Document status` with prefix `status of Document`. Recommend prefix-of for
extensible metadata and readable interpolation (`position of Item`, `page of Feed`, `count of Items`).
Define operand precedence and occurrence binding; traits can describe handles/capabilities, not
invent one position for a domain entity. Unknown page count/total remains typed evidence.

## S27 — signature-owned types, aliases, and resolution evidence

Stories: D01, D34. The current non-positional binder is specified in Tao Type System, Owner-bound
arguments, and implemented by argument-bindings.ts and type-binding-matches.ts. It resolves owner
labels first, excludes defaulted slots from unlabeled competition, matches exact type identity,
then matches mutually unambiguous assignable pairs. Neither spelling nor source order breaks ties.
Identity includes the defining document and qualified definition name.

Type.isAssignable requires compatible underlying kinds/families. Raw compatible scalars can satisfy
named targets. Constructed nominal types need intersecting declaration chains; siblings derived
from one named base can therefore overlap. Primitive/list inline parameters additionally accept
compatible nominal values. This is not arbitrary text/number conversion or fully disjoint branding.

Current juxtaposition constructors take literal strings, numbers, or lists (plus structural item
construction). Their wrappers erase after validation. Decisions section 2 previously selected
type-call conversion (`number("42")`, optional runtime results, invalid-literal diagnostics); that
direction was reopened on 2026-10-01. The current call grammar resolves functions/phrases rather
than types.

Current scoped-type lookup has a narrower boundary than the proposed public signature projection:

```tao
workspace view PersonName(GivenName text, FamilyName text) { }
// Inline parameters currently support PersonName.GivenName and PersonName.FamilyName.

type GivenName is text
type FamilyName is text
workspace view OtherPersonName(GivenName, FamilyName) { }
// Shorthand parameters currently do not expose OtherPersonName.GivenName type paths.
```

parameterTypeDeclarationNamed in Type.ts searches inlineType only. Importing a callable does not
implicitly import its private signature types as standalone constructor names. Current shorthand
signature consumers can use owner labels with raw compatible values, or import separately exposed
types. The precise cross-file examples are source-derived, not newly executed tests.

`type LocalName is PersonName.GivenName` creates a new nominal derivation. It is compatible with
its ancestor and can bind during assignable matching, but is not the same exact identity. Transparent
`=` aliases currently target configurable package members; they do not yet provide general scalar/
scoped-type renaming.

Proposed direction: a public signature exposes each parameter's declared type through its owner,
including shorthand parameters, while preserving that original type identity. Bare constructor
lookup uses normal visible types first, then the immediate callee's signature only when a name is
absent. A visible but incompatible type must fail rather than trigger fallback after validation.
`.GivenName` could explicitly select the signature-owned type as sugar for
PersonName.GivenName. The Developer endorsed public signature projections and normal-lookup-first
resolution on 2026-10-01; exact syntax and the matching mechanics remain design work. No scoped
fallback or dot construction is implemented.

Values can be bound without introducing type aliases:

```scss
let Given = PersonName.GivenName "Ada"
let Family = PersonName.FamilyName "Lovelace"
render PersonName(Given, Family)
```

A general identity-preserving alias facility would serve callers wanting renamed type references.
Do not silently change `is` derivation semantics to provide it.

Role-type examples for the proposed distinct-input rule: RangeStart/RangeEnd, Actual/Expected,
and XCoordinate/YCoordinate. Independent declarations over number are distinct nominal roots;
deriving both from one named scalar base currently permits overlap. A list works for truly symmetric
operations such as sum/minimum/all-equal, but does not enforce exactly two members without a length
check or a future fixed-length type. Distinct callable input types remain a proposal, not a current
declaration restriction.

Historical evidence remains available: the archived Add item list custom type MVP plan introduced
exact then unambiguous nominal matching (commit eabb88143); the Revolution program introduced the
type-call conversion decision (1372fd8e5). The archived Unified declaration slots plan's same-name
inference concerns bare item blocks, not scalar `let Name "Ada"` sugar. Archived spellings are
historical evidence, not current syntax.

## S28 — prospective nominal types and complete call matching

Stories: D01, D34. This is a proposed replacement for parts of the existing contract documented in
S27, not a claim about executable Tao. The Developer requires non-positional function/view calls,
public signature type paths, and normal-visible-type lookup before immediate-signature fallback.
The subsequent S29 discussion reopens this sketch's alias and ancestor-only conversion assumptions.
The rest of this sketch is a recommendation to review. `func`, bare `let` construction, contextual
dot construction, and default spelling below are pseudocode where they differ from current grammar.

### Identity, derivation, and contextual literals

`type Alias = Existing` preserves the exact type identity; `type Child is Parent` creates a fresh
nominal descendant. Implicit assignability only goes from a descendant toward its ancestors. It
does not travel down to a child or sideways through a shared ancestor. Representation compatibility
alone does not make already typed values eligible for nominal targets. Assignment erases no role
unless the destination explicitly widens the static type. Matching uses static type identity, never
the variable's spelling, runtime origin, or the order of parameters/arguments.

Bare literals can be constructed under an expected nominal type. Lists and item literals propagate
that expectation to their elements/fields. Already typed subexpressions follow nominal compatibility;
wrapping a list in a constructor does not silently rebrand all its elements. Explicit sibling
rebranding, runtime target validation, fallible parsers, and container variance need separate
contracts; these examples do not settle them.

```tao
type Name is text
type PreferredName is Name
type UnrelatedName is text
type NameAlias = Name
type TextAlias = text
type ComparedNames is list of Name
func AllEqual(ComparedNames) returns yes/no { ... }

AllEqual(ComparedNames ["Ada", "Ada"])                 // yes: contextual Name literals
AllEqual(ComparedNames [Name "Ada", NameAlias "Ada"])  // yes: same identity
AllEqual(ComparedNames [PreferredName "Ada"])          // yes: element upcast
AllEqual(ComparedNames [TextAlias "Ada"])              // error: typed text -> Name
AllEqual(ComparedNames [UnrelatedName "Ada"])          // error: sibling -> Name

let Raw = "Ada"                                      // text, absent another expectation
AllEqual(ComparedNames [Raw])                          // error: no implicit downcast
let Names = [Name "Ada"]                              // list of Name
// Implicit conversion of a preexisting list to the nominal ComparedNames container is not decided.
// Covariance of mutable lists is also not implied by element assignability in a fresh literal.
```

### Roles and public signature paths

An explicit inline role declaration creates a scoped nominal type. Thus `(Start number, End number)`
can declare distinct `Range.Start` and `Range.End`; `(Number, Number)` repeats an identity and fails
the proposed input uniqueness rule. Shorthand signature references preserve their original identity
and do not acquire another wrapper simply by belonging to a callable.

```tao
func Range(Start number, End number) { ... }
let RangeStart = Range.Start 1
let RangeEnd = Range.End 10
let Interval = Range(RangeEnd, RangeStart)             // yes: type-based order independence

type LocalStart = Range.Start                        // same exact identity
type SpecializedStart is Range.Start                 // fresh descendant
let LocalStart 1
Range(Range.End 10, LocalStart)                       // yes: exact matches
Range(Range.End 10, SpecializedStart 1)               // yes: safe ancestor assignment
Range(1, 10)                                         // error: indistinguishable bare numbers

// PersonName.tao: private types exposed only through the public callable's contract.
type GivenName is text
type FamilyName is text
workspace view PersonName(GivenName, FamilyName) { ... }

// Consumer.tao: no separate import of those private type names is required.
render PersonName(GivenName "Ada", FamilyName "Lovelace") // fallback when no visible types exist
render PersonName(.GivenName "Ada", .FamilyName "Lovelace")
type PersonGivenName = PersonName.GivenName           // identity-preserving alias
type SpecialGivenName is PersonName.GivenName         // descendant accepted by original input
render PersonName(PersonGivenName "Ada", PersonName.FamilyName "Lovelace")
render PersonName(SpecialGivenName "Ada", PersonName.FamilyName "Lovelace")

// Separate consumer scope with a colliding visible type.
type GivenName is number
render PersonName(GivenName "Ada", .FamilyName "Lovelace") // error; no fallback after failure
render PersonName(.GivenName "Ada", .FamilyName "Lovelace") // yes: explicitly signature-owned
render PersonName("Ada", "Lovelace")                      // error: ambiguous roles
```

Public projection grants access to the exposed signature contract, not the type implementation's
private nested declarations. Alias spelling is allowed to change a local name but not its identity.
An identically spelled type owned by another declaration is not interchangeable: deriving from
PersonName.GivenName only supplies RenderPerson.GivenName if the latter projects the same original
identity or an ancestor. Independently declared inline GivenName roles remain distinct.
Argument label removal does not remove item/data member names; those identify structural positions
which can hold repeated value types.

### Complete matching recommendation

1. Resolve expression/type names once. Build compatibility edges using the rules above.
2. Find complete one-to-one bindings assigning every supplied argument and covering every required
   parameter. Defaulted parameters participate but may remain unbound.
3. Prefer bindings containing the greatest number of exact-identity matches. Reject if more than
   one best complete binding remains. Do not use source order, ancestor distance, or variable names
   to break the tie. With no complete binding, diagnose missing/incompatible inputs.

Required coverage precedes exact preference, avoiding an optional exact input consuming the only
argument capable of filling a required ancestor input. This is deliberately a complete assignment
rule, rather than repeatedly selecting individually unambiguous pairs. The proposed uniqueness
restriction rejects repeated alias-equivalent formal types, not distinct ancestor/descendant types.
Optionality should not act as a substitute for two distinct role types. Details for union/generic
input identities and nullable construction remain to decide.

```tao
type A is text
type A1 is A
type A12 is A1
type A2 is A
type A21 is A2
type A22 is A2
type A3 is A
type A31 is A3
type AliasA1 = A1
type Other is text

let A "a"
let A1 "a1"
let A12 "a12"
let A2 "a2"
let A21 "a21"
let A22 "a22"
let A3 "a3"
let A31 "a31"
let Other "other"

func Root(A) { ... }
Root(A)                                              // yes: exact
Root(A12)                                            // yes: A12 -> A1 -> A
Root(Other)                                          // error: shared text representation is insufficient
Root("literal")                                      // yes: single contextual target

func Child(A1) { ... }
Child(A12)                                           // yes: toward ancestor
Child(A)                                             // error: downcast
Child(A2)                                            // error: sibling
Child(AliasA1 "x")                                   // yes: exact A1 identity

func F(A, A1, A2) { ... }
F(A, A1, A2)                                         // yes: all exact
F(A2, A, A1)                                         // yes: argument order irrelevant
F(A, A12, A2)                                        // yes: A12 -> A1
F(A1, A12, A2)                                       // yes: A1 exact; A12 -> A
F(A1, A2, A3)                                        // yes: A1/A2 exact; A3 -> A
F(A12, A21, A3)                                      // yes: A12 -> A1; A21 -> A2; A3 -> A
F(A12, A21, A31)                                     // yes: analogous complete unique assignment
F(A, A1, A3)                                         // error: cannot fill A2
F(A, A3, A31)                                        // error: cannot fill A1 or A2
F(A, A21, A22)                                       // error: cannot fill A1
F(A12, A21, A22)                                     // error: A21/A22 can swap A/A2
F(.A A21, A12, A22)                                  // yes: explicit safe widening removes tie
F(A, A1)                                             // error: required A2 omitted
F(A, A1, A2, A3)                                     // error: unmatched extra argument

func Invalid(A1, A1) { ... }                         // declaration error: repeated identity
func AlsoInvalid(A1, AliasA1) { ... }                // declaration error: aliases do not add roles
func DifferentRoles(First A1, Second A1) { ... }      // yes: explicitly declared scoped role types

func G(A, A1 default A1 "fallback") { ... }
G(A)                                                // yes: required A exact; use A1 default
G(A1)                                               // yes: required A gets A1; use A1 default
G(A, A1)                                            // yes: both exact
// G(A1) cannot mean "fill optional A1 but leave required A absent".
// To fill optional A1 independently, also supply required A; type construction is not an argument label.

let Renamed = A12
Child(Renamed)                                      // yes: names do not matter
let Widened is A = A12                              // proposed explicit static widening
Child(Widened)                                      // error: static type A, despite runtime origin
```

This matching policy has observable costs. With `H(A, A2)`, `H(A2, A22)` uniquely prefers the exact
A2 match; refining the first value to A21 makes `H(A21, A22)` ambiguous. With
`J(A, A1 default ...)`, `J(A1, A12)` uniquely binds A1 exactly and A12 to A. Adding an A12 default
creates a second equally ranked assignment (A1 to A, A12 exactly), invalidating that old call.
Repeated actual identities likewise cannot be distinguished: `K(A, A1)` called with two A1 values
is ambiguous. Safe explicit widening supplies the intended roles without a positional tie break.
These are design tradeoffs, not implementation defects. Distinct sibling role types for ordinary
APIs keep their calls independent; related-type signatures are useful but invite these overlaps.

These examples were checked with a small enumeration of the nominal-tree matching graph, not by
the current compiler. Constraint-aware construction, explicit runtime conversion/rebranding,
container variance, union compatibility, and optional/default specificity remain open. Avoid
mistaking this corpus for a completed type-system specification.

## S29 — one declaration kind, bidirectional relatives, and explicit `as`

Stories: D01, D34. The Developer clarified that `is` and `=` had been used interchangeably, wants
to investigate one named-type declaration kind, and intends implicit upward and downward matching
between relatives. The requested duplicate-role examples and surplus-argument diagnostics are
explicit requirements for this investigation. This supersedes S28 as the active proposal; no grammar
or runtime semantics have changed. The recommendations below still need acceptance.
The following S30 round retracts implicit downward conversion and selects `is` spelling; this section
is retained as the preceding exploration rather than the current direction.

### Distinct declaration identity versus a local rename

A single named-type declaration kind can create a distinct identity on every declaration. That is
different from a transparent alias, regardless of punctuation. Distinct Name and AnotherName can
be differentiated after construction even when their representations and accepted values coincide.
A genuine alias cannot be differentiated without introducing extra provenance/label semantics.
Identity-preserving renaming remains useful for importing or shortening signature types, especially
when a renamed type and its original must both satisfy the same exact contract. This need can use
`use ... as ...` rather than a second kind of type declaration. Exact local qualified-rename syntax
remains open; the following `use Range.Start as Start` is a proposed extension.

```tao
type Name is text
type AnotherName is Name
func Bad(Name, AnotherName) { ... }

Bad(Name "", AnotherName "")                    // requested: works
let Name ""
let AnotherName ""
Bad(Name, AnotherName)                          // requested: works
Bad(Name, Name)                                 // requested: duplicate-role error
Bad(AnotherName, AnotherName)                   // requested: duplicate-role error
Bad(Name, "")                                   // requested: remaining literal becomes AnotherName
Bad(AnotherName, "")                            // requested: remaining literal becomes Name
Bad("", "")                                     // recommended: ambiguity error, no source-order tie break

use Range.Start as Start                        // proposed local identity-preserving rename
type SpecializedStart is Range.Start            // distinct declared identity
```

With bidirectional conversion, exact-then-relative matching alone would accept the two duplicate
calls by converting one duplicate to the other input type. An additional rule is necessary:
recommended, reject repeated explicit argument type identities before relative conversion. Bare
literals remain contextual expressions, not explicitly supplied named roles. Bindings with different
variable names but the same static type remain duplicates. Exact scope of this restriction for core
types, unions, optional types, and aggregate values still needs definition.

### Nearest relatives require whole-call feasibility

Recommendation: find complete feasible one-to-one assignments; prefer exact matches, then compare
the numbers of matches at distance 1, distance 2, etc. Reject equal-best complete assignments. This
matches "nearest first" without arbitrary local choices. Coverage of required parameters and every
provided argument precedes distance ranking. Literal construction supplies remaining slots only
when that assignment is uniquely determined. This is a ranked graph policy, not a finished solver.

```text
P
├─ A
│  └─ X
│     └─ Q
└─ Y
   └─ B
```

For F(P, Q) called with A and B, greedy A -> P (distance 1) leaves B unable to supply Q across
branches. Yet A -> Q and B -> P (both distance 2) form a complete eligible binding. This example
was checked by ancestry-distance enumeration. Pure greedy nearest-first can reject a valid call.
Whether the ranking maximizes short-distance match counts or minimizes total distance is a policy
choice; the former most closely follows the Developer's wording. Defaults and ranking stability
remain tradeoffs already exposed in S28. Do not quietly add a source-order or spelling tie breaker.

Surplus diagnostics should show the uniquely determined partial bindings and unmatched arguments.
For F(A, A1, A2) with (A, A1, A2, A3), report A3 as extra. If several maximum partial bindings tie,
report the alternatives rather than inventing which expression is extra. Missing/incompatible
input diagnostics likewise preserve successfully determined matches.

### Role conversion versus validation and representation conversion

Bidirectional implicit conversion is straightforward for distinct role names with identical value
requirements. If a child imposes stronger constraints, required fields, capabilities, or identity
requirements, ancestry is insufficient to justify downward conversion. Implicit conversion must
have a static proof; checked validation must return a typed outcome and honor the failure contract.
Matching must not select roles based on which runtime value happens to satisfy a constraint.
Mutable containers and callback variance need separate rules; scalar-role matching does not grant
arbitrary nested conversion of mutable lists or function signatures.

`as` is recommended as an expression-level request for a target type, usable in bindings, arguments,
and returns. It does not parse text, rescale units, manufacture missing fields, or bypass target
constraints. Existing `as` uses include import renaming and `copy Document as DocumentInput`.
An annotated binding describes a destination contract, while expression conversion describes an
operation at that expression. One spelling for local explicit typing could be enough if contextual
typing remains possible; keeping both is an ergonomic choice rather than a fundamental capability.

```tao
let Widened is A = A12                           // proposed destination contract
let Widened = A12 as A                           // proposed expression target
F(A12 as A, A1, A2)                              // expression form works without a temporary binding

let Rebranded = A21 as A12                       // explicit sibling conversion candidate
let Rebranded = (A21 as A) as A12                // explicit two-step alternative
let Parsed = "42" as number                     // recommended error: use an explicit parser
```

The common-core-type rule versus a shared named ancestor for explicit sibling rebranding remains
open. Same core type is necessary for representation-preserving scalar rebranding, but it cannot
alone establish validation, identity, or physical-unit requirements. If direct sibling `as` is
allowed, ancestry-route syntax adds no role-conversion capability; even restricting each step to
ancestors/descendants permits a route via the common root. Forcing routes must therefore have a
concrete checking or documentation purpose. Prefer ordinary repeated `as` to a new `=>` path DSL
unless intermediate conversion policies make the route observable.

## S30 — upward-only matching and quantities that cannot be reinterpreted

Stories: D01, D34. The Developer selected `is` for named-type declarations, at least for now,
and agreed that implicit matching must not increase specificity. Downward and sibling conversion
require explicit treatment, with `as` a candidate. The Developer specifically rejects silently
reinterpreting a Celsius reading as Fahrenheit after widening through Temperature. This is the
active direction, superseding S29's bidirectional implicit proposal. No compiler changes are made.

### What the restriction loses

The requested Bad(Name, AnotherName) examples all remain expressible: distinct named roles match
exactly, duplicate typed identities are errors, and a bare literal can receive the sole remaining
expected role. The lost implicit cases are existing typed ancestors passed to descendant inputs,
including the earlier General/Specific example and the bidirectional P/A/X/Q/Y/B greedy example.
Root/Child/F examples in S28 remain compatible because their implicit conversions only go upward.
Constructing a bare literal under an expected descendant is not downcasting an already typed value.

```tao
type Name is text
type GivenName is Name
func Hello(GivenName) { ... }
Hello(Name "Ada")                                // now error: would increase specificity
Hello(GivenName "Ada")                           // exact, works
Hello("Ada")                                     // contextual literal construction, works
Hello(Name "Ada" as GivenName)                    // explicit target; conversion permission still to define
```

Convenient downward role assignments include general imported/form names becoming given names,
AccountId becoming RecipientId, and measured Length becoming Width after another Height input
has already identified its role. Losing those implicit conversions requires explicit role construction
at a boundary; it also prevents unconsciously relabeling an identifier or measurement.

The imported-name example means a generic name value received from external contact data, not a
Tao module import. An external source might supply a full display name without identifying its
given-name component. It cannot acquire that more specific meaning merely because Hello wants it:

```tao
type Name is text
type GivenName is Name
func ReadImportedName() returns Name { return Name "Ada Lovelace" }
func Display(Name) { Print(Name) }
func Hello(GivenName) { Print("Hello {GivenName}") }

let ImportedName = ReadImportedName()             // static type Name
Display(ImportedName)                            // exact, works
Hello(ImportedName)                              // error: cannot infer a given name from a generic name
let VerifiedGivenName = GivenName "Ada"           // explicitly constructed after obtaining the given name
Hello(VerifiedGivenName)                         // exact, works
```

### Existing named-type references and signature shorthand

The Developer requested that explicit A A must not generate a new B.A type when A is already
declared. This is congruent with public signature projection preserving existing named identities:

```tao
type A is text
func B(A A) { Print(A) }                         // parameter name A, existing type A
func F(A) { Print(A) }                           // same input contract; A is the parameter value in the body
// B.A and F.A expose the existing A identity, not freshly derived types.
```

Recommendation: `func C(Value A)` also preserves A identity, changing only the local binding name.
This avoids parameter renaming affecting nominal identity. Consequently, `func Bad(First A, Second A)`
would repeat an input identity under the proposed uniqueness rule; explicit First/Second named
type declarations would be required. This refines S28's earlier assumption that differently named
inline references automatically create new role types. Inline primitive declarations such as
`Start number` remain separate candidates for signature-owned role types; do not resolve that
distinction silently. Current Type.ofDefinition still attaches a fresh ParameterTypeDeclaration
nominal identity to explicit signatures, so the requested A A equivalence is a future behavior change.

### Nearest matching under the narrower relation

For a single-parent nominal tree, upward-only eligible edges cannot reproduce S29's stranded-call
example. Choosing a nearest remaining formal ancestor preserves existence of a complete binding:
if the chosen actual previously filled a higher ancestor, another actual filling the selected nearer
ancestor can instead fill that higher ancestor. Swap those edges and preserve coverage. This proof
excludes defaults, unions, multiple parents, structural conversions, and mutable container variance.
An independent review supplied the exchange argument; 761 shortest-edge cases in two small trees
were checked by explicit matching enumeration. This is mathematical exploration, not a compiler test.

Colliding equal-nearest edges can still indicate genuinely different meanings. Ties on disjoint
edges only affect processing order and need not be rejected. Reject competing equally preferred
bindings, not every tie observed while implementing a matcher. Total distance cannot select among
complete upward-only bindings in a tree: its sum is always sum(actual depths) minus sum(formal depths).

```tao
type Number is number
type Integer is Number
type PositiveInteger is Integer
type NegativeInteger is Integer
func Power(Number, Integer) { ... }              // broad base, integer exponent
Power(PositiveInteger 2, NegativeInteger -3)
// ambiguous: 2^(-3) or (-3)^2; both bindings have distances 1 and 2
// Prefer dedicated Base/Exponent roles for an ordinary public API.

type Length is number
type Width is Length
type Height is Length
type ScreenHeight is Height
func RectangleArea(Width, Height) { ... }
RectangleArea(Length 12, ScreenHeight 8)          // now error: Length cannot implicitly become Width
RectangleArea(Width 12, ScreenHeight 8)           // works: exact Width, upward Height

type PreferredGivenName is GivenName
type LegalGivenName is GivenName
view Greeting(Name, GivenName) { ... }
render Greeting(PreferredGivenName "Sam", LegalGivenName "Samuel")
// ambiguous: either value could be the broad display name or the given name
render Greeting(PreferredGivenName "Sam", LegalGivenName "Samuel" as Name)
// unambiguous after safe widening

type Identifier is text
type AccountId is Identifier
type SignedInAccountId is AccountId
type OrderId is Identifier
func RecordVisit(AccountId, Identifier) { ... }
RecordVisit(SignedInAccountId "account-42", OrderId "order-7")
// unique: account -> AccountId; order -> Identifier; no downward/sibling conversion
```

### Current evidence versus the selected direction

Tao Type System's Owner-bound arguments says exact/nominal unique matching, without specifying
ancestor-only direction or nearest distance. Current Type.isAssignable additionally checks nominal
chain intersection, allowing upward, downward, and siblings with a common named ancestor when
their base representations are compatible. Raw compatible scalars and some inline primitive/list
parameters are more permissive still. The current binder runs mutually unambiguous exact then
assignable pairs, not a distance-ranking phase. The selected direction tightens those rules.

### Quantities and `as`

`let Temperature = Celsius 10` ordinarily infers Celsius, regardless of the binding name. Explicit
widening to Temperature must preserve the physical quantity; it cannot grant permission to change
its numeric interpretation. `as` requires a defined legitimate target operation, not just matching
core representation. A plain declaration such as `type Celsius is Temperature` contains no scale,
offset, or unit identity metadata; a compiler cannot infer them from the name.

Recommendation: defer general user-defined automatic parent/child converters. Use explicit named
conversion functions for now, and explore Temperature as a quantity with explicit unit construction
and extraction, following the existing unit accessor direction:

```tao
let Reading = Celsius 10
let Converted = CelsiusToFahrenheit(Reading)     // explicit transformation, Fahrenheit 50
let Broad = Reading as Temperature              // widening preserves quantity
let Invalid = Broad as Fahrenheit               // cannot reinterpret 10 as 10 degrees Fahrenheit

// Future quantity/unit sketch, not implemented:
let Outside = 10.celsius                        // Temperature quantity
Outside.fahrenheit                             // 50: extract the representation in that unit
Outside as number                              // reject implicit unit erasure; require an explicit unit
```

If generic explicit role rebranding remains available, quantities must carry a distinguishable
contract or representation so that it cannot bypass unit semantics. Alternatives are stricter `as`
semantics limited to safe views/proven narrowing, or declared conversion capability. This boundary,
including the result/error type of checked narrowing, remains open; explicit syntax alone is not proof
that a conversion is legitimate. A numeric ancestry route would not supply missing unit metadata.

## S31 — inverse matching and ways to declare conversion policy

Stories: D01, D34. The Developer requests a downward-only counterfactual and several independent
conversion-policy designs, with working alternatives beside rejected examples from this point on.
This explores alternatives to S30; it does not revoke the previously selected upward-only direction.
The temperature representation discussion remains pending. All new syntax below is pseudocode.

### ScreenHeight correction and a downward-only counterfactual

ScreenHeight already satisfies Height under the selected upward-only policy. The previously rejected
RectangleArea argument was Length used as Width. Under the inverse policy, only typed ancestor ->
descendant matching would be automatic, while exact matches and contextual literal construction
remain. Explicit parent views in these examples are assumed permitted as representation-preserving
upcasts. Downward matching cannot bypass stronger constraints, required fields, or capabilities.

```tao
type Length is number
type Width is Length
type Height is Length
type ScreenHeight is Height
func RectangleArea(Width, Height) { ... }

// Selected upward-only policy:
RectangleArea(Width 12, ScreenHeight 8)                 // works: ScreenHeight -> Height
RectangleArea(Length 12, ScreenHeight 8)                // error: Length cannot acquire Width implicitly
RectangleArea(Width 12, ScreenHeight 8)                 // working equivalent with explicit Width construction

// Hypothetical downward-only policy:
RectangleArea(Length 12, Height 8)                      // works: Length -> Width; Height exact
RectangleArea(Width 12, ScreenHeight 8)                 // error: ScreenHeight -> Height not automatic
RectangleArea(Width 12, ScreenHeight 8 as Height)       // works: explicitly expose parent view
RectangleArea(Length 12, ScreenHeight 8 as Height)      // works: Length becomes sole remaining Width role

type Name is text
type GivenName is Name
view Hello(GivenName) { ... }
view DisplayName(Name) { ... }
render Hello(Name "Ada")                               // inverse policy permits automatic specificity
render DisplayName(GivenName "Ada")                    // inverse policy rejects generalization
render DisplayName(GivenName "Ada" as Name)            // working explicit parent view

type Identifier is text
type OrderId is Identifier
func FindOrder(OrderId) { ... }
func LogIdentifier(Identifier) { ... }
FindOrder(Identifier "account-42")                     // inverse nominal role rule permits mislabeling
FindOrder(OrderId "order-7")                           // intended explicitly identified order
LogIdentifier(OrderId "order-7")                      // inverse policy rejects upward matching
LogIdentifier(OrderId "order-7" as Identifier)         // working explicit parent view
```

The inverse is convenient when broad values already possess a business role that their static type
does not express. It cannot establish that role: a display name may not be a given name, and an
arbitrary identifier may not identify an order. Repeated identical typed arguments and equal-nearest
ties retain the earlier restrictions. Switching directions does not solve all assignment ambiguity.

### A — ordinary named functions, with existing upward-only inheritance

Keep `is` as an identity-preserving parent relationship for assignability. Plain typed-value matching
can move upward. New representations or stronger requirements use named functions. `as` for a
known parent view performs no computation. Sibling/downward as permission remains deliberately
separate; registering no converters means these extra conversions do not happen implicitly.

```tao
type AccountId is Identifier
type RecipientId is AccountId
func MakeRecipientId(AccountId) returns RecipientId { ... }
action Invite(RecipientId) { ... }
do Invite(AccountId "account-42")                      // error: would increase specificity
do Invite(MakeRecipientId(AccountId "account-42"))      // works: explicit role construction
```

Benefits: minimal new language, visible transformation/validation, ordinary functions can return
typed failure outcomes. Cost: repeated adapter names are longer and lack unified target syntax.
This is the recommended initial implementation boundary.

### B — mark implicit inheritance with `extends`

Alternative policy: `is` declares a nominal representation relationship without automatic assignment;
`extends` explicitly grants upward substitutability. Explicit parent views are permitted for the
plain identifier-role example, not arbitrary unit/constraint transformations.

```tao
type Width extends Length
ShowLength(Width 12)                                   // works: explicit inheritance permission

type OrderId is Identifier
LogIdentifier(OrderId "order-7")                      // error: is does not grant automatic assignment here
LogIdentifier(OrderId "order-7" as Identifier)         // works: deliberate parent view
```

Benefits: the relationship visibly distinguishes representation from substitutability. Costs: two
relationship concepts and more declaration syntax; extends conventionally suggests structural
inheritance. This option changes what is means and should not silently become an additional spelling
for the already selected relation. Not recommended without repeated real needs.

### C — explicit source/target converter declarations

```tao
// Standalone reading records illustrate a transform body, not the final quantity representation.
type Fahrenheit is { Value number }
type Celsius is { Value number }

convert Fahrenheit to Celsius(Fahrenheit) {
   return Celsius { Value (Fahrenheit.Value - 32) * 5 / 9 }
}

let Reading = Fahrenheit { Value 50 }
let Converted = Reading as Celsius                    // converter produces Celsius { Value 10 }
render CelsiusLabel(Reading)                           // error: converter is explicit-only
render CelsiusLabel(Reading as Celsius)                // works: select converter deliberately
```

Benefits: uniform as syntax and centrally typechecked transformation definitions. Costs: converter
ownership/visibility, collisions, target inference, purity, and result/failure rules become language
contracts. Recommendation if introduced: pure total conversions only for plain as; no automatic
binding eligibility, no implicit multi-hop converter search. Registry lookup uses the exact source
and target identities, and must not override an existing same-value ancestor view. A descendant
source can be explicitly viewed as the registered source first if needed; that step must remain
visible rather than becoming implicit converter-path search. Fallible validation stays a visible
named operation returning a typed outcome until checked conversion syntax is decided. A sibling
conversion declaration changes the value appropriately rather than merely relabeling its number.

### D — adapters local to an input contract

Rejected by the Developer in the subsequent S32 round. Retained here only as a historical alternative.

```tao
func SummarizeCustomer(Customer) returns CustomerSummary { ... }
view CustomerCard(CustomerSummary accepts Customer using SummarizeCustomer) { ... }
view SummaryOnly(CustomerSummary) { ... }

render CustomerCard(CustomerValue)                     // works: this boundary declares the adapter
render SummaryOnly(CustomerValue)                      // error: no global assignment relation
render SummaryOnly(SummarizeCustomer(CustomerValue))   // works: explicit adapter call
```

Benefits: ergonomic at a specific UI boundary, no global new compatibility edges. Costs: longer
signatures, more potential accepted-input ambiguity, and computed conversion may be hidden at calls.
Start with pure total adapters; require uniquely determined binding before executing any adapter.
This is an independent alternative to globally automatic conversions, not mandatory with C.

### E — allow safe defaults, opt out with opaque types

```tao
type Width is Length                                  // ordinary upward assignment remains
opaque type OrderId is Identifier                     // block automatic identity erasure
func ExposeOrderId(OrderId) returns Identifier { ... }  // declared explicit operation

LogIdentifier(OrderIdValue)                            // error: opaque boundary
LogIdentifier(ExposeOrderId(OrderIdValue))              // works: explicit conversion
```

Benefits: minimal ceremony for ordinary inheritance; sensitive boundaries stand out. Costs: authors
must remember the restriction; opaque can imply representation privacy and constructor restrictions
which need explicit semantics. Every indirect path, including a descendant of the opaque type,
must honor the boundary. Declaring a function name does not itself confer conversion authority;
representation access and construction rights determine what its body can implement. Under S30, downward
and siblings are already denied by default; this modifier adds a restriction on upward matching.
Opaque does not supply unit scale/offset or target validation by itself.

### Recommendation and remaining decision

Keep upward-only same-value substitution and explicit named transformations initially (A). If
uniform target-oriented syntax proves useful, C is the preferred extension, with converters invoked
by explicit as only. B adds a second relationship concept, D is a localized ergonomic option to
prototype, and E is justified when a family truly needs to block even safe-looking parent exposure.
For units or alternate encodings, nominal ancestry alone cannot authorize a changed representation.
Conversion permission is opt-in for all behavior beyond ordinary safe upward substitution; avoid
a broad compatibility default with a blacklist of semantic exceptions. The primary open choice
remains what explicit as authorizes and which operation/result it denotes. No alternative is accepted
by being included here, and no parser/validator/compiler/runtime edits are made.

## S32 — semantic ancestry, data representation, and a duration-library fixture

Stories: D01, D34. The Developer wants to compare two core models and automatic up/down/both
conversion policies, using consumer and implementation code from a realistic standard library.
Guardrails target accidental semantic changes, not preventing every deliberate extraction/parse
route. Type-owned convert/to declarations and type-name receiver bindings are preferred; S31.D's
input-local adapters are explicitly rejected. `is` spelling and non-positional calls remain selected.
The previously selected upward-only default is under examination, not silently replaced. Every
new syntax form below is exploratory and non-executable. Rejected calls have working alternatives
where applicable; arbitrary as permissions are not assumed merely from representation compatibility.

### Relevant implemented foundations and recovered design

Current duration family units, dimensional arithmetic, and general interpolation validation are implemented;
general type methods/protocols/custom unit declarations are not. @tao/time exposes Interval and
a Ticker item containing Value, Running, Start and Stop action fields, which is different from
declaring receiver actions on a data type. Core operator/interpolation behavior is currently in
FunctionalCoreValidator, Type.dimensionalResult and Units, not general authored protocol bodies.

```tao
use Interval from @tao/time
let Clock = Interval(1.s)
let Wait = 220.ms
Wait.s                                           // 0.22
```

Historical source recovered read-only: ~/code/tao-lang/Docs/Projects/Misc/Semantic Types.md, lines
8–22, declares Nanoseconds/Milliseconds/Seconds/Minutes/Hours deriving Duration, with ns/ms/sec/min
readings in `type Duration is number with { ... }`. It explicitly calls itself a sketch. The body
uses singular names unlike the plural declarations and references an undeclared Day, so it is not
an executable contract. ~/code/tao-lang/Docs/Tao Type System.md:1149 labels associated computed
readings "Type functions: DEFER". Current Decisions.md:173–201 specifies canonical bases/fixed ratios
and dimensional operations; Tao Type System.md:438–462 documents the registered duration family.
No historical/current/archive source was edited, and no old-repository implementation was copied.

### Semantic interpretation and data are different axes

A semantic type describes what values mean and the contracts on their operations; its data
representation describes storage. The full type contract also covers permitted states, shape,
capabilities, identity and effects, so "semantic representation of data" is a useful starting model
but does not replace these other facets. Representation compatibility does not imply substitutability.

```tao
type A is number
type B is number
type C is B
type D is B
```

Model 1: number is an ordinary semantic ancestor of A and B. Model 2: number classifies their data,
while A and B are separate semantic roots and C/D derive B. Model 2 still types raw literals; it
does not introduce untyped data. Every expression needs a representable static classification.
Recommendation: separate semantic ancestry from representation, regardless of whether core
number/text remain spelled as primitive types in the implementation. In particular, sharing numeric
storage must not automatically grant scalar operations or unrestricted nominal conversion.

Both-direction direct ancestry matching does not automatically imply sibling matching. However,
allowing composition through ancestors makes C -> B -> D possible in either model. Model 1 also
connects A -> number -> B. Even when implicit path search is forbidden, deliberately erasing to
an admitted ancestor then assigning downward can create an equivalent multi-statement route.
Model 2 narrows accidental cross-family reach but does not solve unsafe specificity within a family.

### Direction comparison with explicit working alternatives

```tao
type Identifier is text
type AccountId is Identifier
type RecipientId is AccountId with {
   convert AccountId to RecipientId(AccountId) {
      return RecipientId AccountId
   }
}
type OrderId is Identifier
func Log(Identifier) { ... }
action Invite(RecipientId) { ... }
let Account = AccountId "account-42"
let Order = OrderId "order-7"
```

| Call                    | Up only                 | Down only               | Both direct directions   | Exact only              | Explicit working form                                       |
| ----------------------- | ----------------------- | ----------------------- | ------------------------ | ----------------------- | ----------------------------------------------------------- |
| Log(Account)            | yes                     | no                      | yes                      | no                      | Log(Account as Identifier), same-value parent view          |
| do Invite(Account)      | no                      | yes                     | yes                      | no                      | do Invite(Account as RecipientId), declared converter       |
| do Invite(Order)        | no                      | no                      | no without sibling paths | no                      | use the intended account: do Invite(Account as RecipientId) |
| do Invite("account-42") | contextual construction | contextual construction | contextual construction  | contextual construction | do Invite(RecipientId "account-42")                         |

The recipient converter deliberately assigns a role to the same identifier data. It does not
prove account existence, permission to contact it, or consent to an invitation. Those are separate
contracts/operations. The constructor-expression syntax in its body is a candidate, not current
grammar. If RecipientId has additional value requirements, conversion must validate them and use
a typed failure outcome unless the source statically guarantees success.

Contextual literal construction is a separate rule from conversion of an already typed value.
Quantity literals require units or an explicit canonical-data constructor; expecting Duration must
not silently reinterpret a bare number as nanoseconds. Literal admission must also satisfy any
target constraints, and is not blanket permission to construct every semantic type from raw data.

Hello(ImportedName) does match Name -> GivenName when downward role conversion is admitted and
their data/requirements allow it. It is not rejected merely because the source was imported; the
issue is that a general name does not establish the intended more specific meaning. Explicit
construction/conversion identifies that intended semantic change.

### Restrictions, converter ownership, and automatic opt-ins

Candidate syntax inside the owning type, with modifiers shown independently rather than imposed
as mandatory boilerplate:

```tao
type OrderId is Identifier with {
   explicit to Identifier                        // optional opt-out of default upward admission
   explicit from Identifier                      // documents/restricts inbound automatic conversion
   convert Identifier to OrderId(Identifier) { ... }
}

type RecipientId is AccountId with {
   implicit convert AccountId to RecipientId(AccountId) {
      return RecipientId AccountId
   }
}
do Invite(Account)                               // admitted only by the explicit automatic opt-in
do Invite(Order)                                 // rejected: different branch, no declared operation
do Invite(Account as RecipientId)                // working deliberate conversion using the intended account
```

Recommendations: plain convert is explicit-only; implicit conversion is an owner-declared opt-in
for one exact source/target contract, not arbitrary graph traversal. An implicit operation must be
pure and total with respect to its source contract and produce a valid target; typechecking checks
the declared contract but does not prove arbitrary formulas, termination or physical interpretation.
Effects/fallible conversion remain explicit operations with typed results. A converter cannot
override an existing parent view silently. Source/target restrictions must veto unauthorized routes
within the implicit conversion path currently being considered. They do not track deliberately
erased origins across separate statements, extraction or reconstruction unless provenance is
explicitly retained. Ownership/conflict precedence and extension rights must be specified before implementation.
Prefer canonical converter bodies in their type declaration for discoverability. External `extend`
blocks should be deferred until package ownership and extension conflict rules are settled.

### Scoped role convenience and capabilities

```tao
func Add(A number, B number) { ... }
// Proposed sugar creates Add.A and Add.B; no separate Num1 declaration needed.
Add(1, 2)                                        // error: two literals cannot identify unordered roles
Add(.A 1, .B 2)                                  // working explicitly identified inputs

type Existing is number
func Keep(Value Existing) { ... }                // preserves Existing, no fresh nominal type
func Combine(type Left is Existing, type Right is Existing) { ... }
// Proposed explicit scoped declaration creates Combine.Left/Right over a named type.
Combine(Existing 1, Existing 2)                  // error: repeated existing role, no positional matching
Combine(.Left (Existing 1), .Right (Existing 2))  // working scoped role construction

func Add(A like number, B like number) { return A + B }
// Candidate scalar capability includes scalar addition with a scalar result.
Add(1, 2)                                        // still ambiguous; capability admission is not argument identity
Add(.A 1, .B 2)                                  // working role selection
```

Named references preserve identity. Core-data/capability-shaped inline declarations can provide
scoped role convenience. The exact keyword/syntax for explicitly fresh roles over named types
remains open; reusing `type ... is ...` avoids inventing another relationship word. Like/any are
independent capabilities/family acceptance concepts, not blanket permission to reinterpret data.
`func LogIdentifier(any OrderId)` is redundant if ordinary OrderId already admits descendants;
it becomes useful under exact-only default, as an explicit descendant-acceptance contract.

A protocol `Addable { Add(Addable) }` promises that any pair of implementations can be combined.
That is too broad for time/date, dimensions, and absolute temperatures. Future Self or associated
operand/result contracts must express Duration+Duration -> Duration and Time+Duration -> Time.
Temperature point subtraction yields a difference; point+point is not ordinary addition. The
proposed Fahrenheit addition formula mixes unit conversion and addition and repeats the offset,
so it must not be adopted as an example of correct universal Addable behavior.

### Duration library: consumer code and implementation pressure

Duration is the fixture recommendation: same physical quantity, several unit representations,
real semantic roles, formatting, arithmetic, and checked scheduling constraints. Seconds and
Milliseconds constructors return the same canonical Duration type, rather than separate subtype
representations requiring numeric reinterpretation when widened. Data storage is nanoseconds in
this fixture; range, precision, rounding and overflow must become explicit library contracts.

```tao
// Proposed extension of the library API; Interval already exists, other exports are sketch names.
use Duration, Seconds, Milliseconds, AddDuration, ToSeconds, FormatDuration from @tao/time

type RetryDelay is Duration
type AnimationDuration is Duration
let Retry = RetryDelay Seconds(2)
let Fade = AnimationDuration Milliseconds(150)

let Total = AddDuration(.Left Retry, .Right Fade) // 2.15 s, return type Duration
ToSeconds(Total)                                 // 2.15, explicit scalar unit extraction
FormatDuration(Total)                            // explicit text representation

AddDuration(Retry, Fade)                         // error: fresh operand roles require identification
AddDuration(.Left Retry, .Right Fade)             // working same-quantity role construction
AddDuration(.Left 1, .Right 2)                    // error: quantities require units
AddDuration(.Left Seconds(1), .Right Seconds(2))  // working unit-bearing inputs
Retry + 1                                       // error: scalar has no duration unit
Retry + Milliseconds(1)                          // working duration arithmetic
```

Library implementation outline, assuming the preferred separation of data and semantic ancestry:

```tao
public type Duration is number                  // numeric data: canonical nanoseconds, unit-family contract
// Actual custom unit/trait declaration syntax remains to specify, not implied by this line alone.

public func Seconds(Count like number) returns Duration {
   return Duration (Count * 1_000_000_000)
}
public func Milliseconds(Count like number) returns Duration {
   return Duration (Count * 1_000_000)
}
public func ToSeconds(Duration) returns number {
   return (data of Duration) / 1_000_000_000
}
public func AddDuration(type Left is Duration, type Right is Duration) returns Duration {
   return Left + Right
}
```

`Duration (expression)` denotes explicit construction from canonical data in implementation code;
`data of` is a candidate explicit representation extraction, not a shipped expression. The unit-family
contract must define arithmetic separately from numeric storage, otherwise Duration would be just
another scalar role and Retry+1 could be permitted incorrectly. Like number means scalar numeric
capability, not merely numeric storage; Duration must not automatically implement it. This fixture
therefore exposes necessary operator result rules and numeric extraction without pretending the
type-functions/unit DSL is already settled. Source type names bind their receiver values without
requiring an invented Value property, consistent with the Developer's preference.

The fixture assumes these family contracts independently of storage and nominal role matching:

| Operation                            | Result   |
| ------------------------------------ | -------- |
| Duration + Duration                  | Duration |
| Duration - Duration                  | Duration |
| Duration * Scalar, Scalar * Duration | Duration |
| Duration / Scalar                    | Duration |
| Duration / Duration                  | Scalar   |

The scalar capability used by the constructors supplies scalar arithmetic; the duration capability
used by AddDuration supplies quantity arithmetic. Neither is established by numeric storage alone.

### Brief type-associated functionality exploration

Type-owned named functions/actions can be desugared to ordinary receiver-parameter callables:

```tao
data Books / Book { LoanedOut yes/no } with {
   action Return(Book) {
      update Book { LoanedOut no }
   }
}
do BorrowedBook.Return()
do Book.Return(BorrowedBook)                       // same receiver action, not a second operation
```

This is future syntax, not implemented data methods. Recommendation: decide a receiver model and
reserve owned convert/functions now; keep NVP behavior expressible as ordinary named callables.
Defer arbitrary operators, generic protocols, mixins, extension precedence and dynamic dispatch
until the duration fixture needs them. Core operations should eventually have written signatures
for capability and result rules, even when implemented intrinsically in the compiler/runtime.
Formatting/interpolation should have a deliberate text capability rather than implicitly applying
every registered conversion; output text can lose semantic information intentionally.

### Guardrails, limits and scenario inventory

Typed formatted text can block an accidental FahrenheitText -> CelsiusText parse. Unrestricted
extraction into text and parsing under another interpretation can still discard provenance. Full
prevention requires tracking/encapsulation of representations, unit-bearing encodings, restricted
constructors, or proofs at trusted boundaries; those restrict APIs and cannot establish truth from
arbitrary external strings. The aim is explicit semantic erasure and construction, not claiming that
the checker knows every value's real-world meaning or every converter's mathematical correctness.

| Situation                                                  | Required support or guardrail                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Same semantic identity and referenced signatures           | Preserve identity across names and public projections                                       |
| Ordinary ancestor admission                                | Preserve value interpretation, reject undeclared representation changes                     |
| Descendant/sibling role construction                       | Explicit by default; owner-declared direct implicit opt-ins possible                        |
| Bare contextual literal versus already typed raw data      | Fresh construction separate from nominal conversion                                         |
| Repeated parameter/argument roles and competing matches    | No positional tie breaks; scoped role constructors and precise diagnostics                  |
| Core representation extraction/reconstruction              | Deliberate escape; no automatic cross-family conversion through raw data                    |
| Pure transformations versus checks/effects                 | Separate total converter contracts from typed failing/effectful operations                  |
| Canonical quantities, unit views, points and deltas        | Written operator/result contracts; no raw-numeric reinterpretation                          |
| Variable binding, return, stored field, update and default | Apply compatible rules consistently; infer actual type unless explicitly targeted           |
| Optional/union/absence                                     | Preserve all possible states; do not invent defaults while converting                       |
| Collections, item projections, callbacks and generics      | Variance/mutability and associated result constraints, not recursive scalar-cast permission |
| Receiver methods and data actions                          | Explicit binding/effects/identity; no copy of a live row implied by a method                |
| Trait-driven consumers                                     | Capability evidence distinct from role matching and storage classification                  |
| Imports, extensions and converter ownership                | Stable identities; visible ownership; duplicate conversion paths diagnosed                  |
| Formatting, interpolation, parsing and serialization       | Controlled semantic erasure, typed encodings where useful, explicit validation boundary     |
| Precision, range, finite values and rounding               | Declared numeric/unit contracts with boundary scenarios                                     |

Next proposed decision round: semantic ancestry versus core data representation; same-value upward
default versus exact-only with explicit descendant acceptance; owner-declared explicit/implicit
converter contracts. The first duration consumer/implementation fixture should pressure those
choices before designing the full method/protocol/operator grammar. This is design work only.

## S33 — tagged families, capabilities, construction and forbidden conversions

Stories: D01, D34. The Developer proposes identifier subtypes, temperature representations,
type-owned `as` bodies, `can` capabilities with contextual concrete return types, literal suffixes,
custom raw constructors, and `never` conversion bans. This is a design discussion, not acceptance
of every proposed spelling or a claim that runtime nominal reflection currently exists.

### Admission preserves concrete identity

```tao
type UUID is text
type Identifier is UUID
type UserID is Identifier
type AdminID is UserID
type MessageID is Identifier

func IsAllowed(UserID, Action) { ... }
func IsUrgent(MessageID) { ... }
IsAllowed(User, RequestedAction)                  // existing UserID role
IsAllowed(Admin, RequestedAction)                 // AdminID admits as UserID without rebuilding it
IsUrgent(Admin)                                  // error: sibling role
IsUrgent(Message)                                // working MessageID input
```

Under upward admission, `any UserID` is unnecessary merely to accept descendants. It could instead
preserve a concrete type variable for an input/output relationship, but that is an additional
generic contract, not a consequence of accepting a subtype. A `can` capability supplies operations
independent of ancestry. Runtime `when Value type` needs a preserved discriminator when static
precision is widened; today's plain scalar representation must not be assumed to carry that tag.
AdminID expresses classification, not independently authenticated current authorization.

### Ordered type patterns and closure

```tao
func IsAllowed(UserID, Action) {
   return when UserID type {
      AdminID -> IsAllowedForAdmin(AdminID, Action)
      UserID -> IsAllowedForUser(UserID, Action)
   }
}
```

Proposed subtree patterns follow declaration order and reject statically shadowed branches.
UserID first would catch AdminID; AdminID first leaves a UserID remainder. This is exhaustive even
for an open family because the parent fallback covers future descendants; it does not require a
new dedicated handler when a new subtype is introduced. Fully enumerating every concrete variant
without a parent fallback requires a closed family/explicit closed union, plus coverage of any
constructible root. An abstract root prevents bare root construction; abstract and closed are
independent properties. Exact-type patterns would have different overlap/closure requirements and
must not be silently mixed with subtree tests.

Legitimate narrowing includes heterogeneous notifications/media, navigation destinations, typed
action outcomes, optional values, parsed syntax nodes and checked specialized IDs. Narrowing
establishes the type of the same value; a representation conversion constructs a different view or
value. Tests may narrow a root back to its original leaf; unchecked `as` must not invent that fact.

### A semantic temperature family with local unit representations

```tao
closed abstract type Temperature is number        // candidate modifiers; numeric storage, not scalar admission
type Celsius is Temperature with {
   IsHot() { return Celsius >= 40 }
   as Fahrenheit {
      let Reading = data of Celsius
      return Fahrenheit (Reading * 9 / 5 + 32)
   }
}
type Fahrenheit is Temperature with {
   as Celsius {
      let Reading = data of Fahrenheit
      return Celsius ((Reading - 32) * 5 / 9)
   }
   as text { return "{data of Fahrenheit}°F" }
}
func IsHot(Temperature) {
   return when Temperature type {
      Celsius -> Celsius.IsHot()
      Fahrenheit -> IsHot(Fahrenheit as Celsius)
   }
}
IsHot(Temperature 10)                            // error: root has no standalone unit representation
IsHot(Celsius 10)                                // working concrete construction
```

Receiver names still denote typed values. `data of` is a proposed owner-private representation
operation; this avoids silently making all typed arithmetic into scalar arithmetic. Celsius>=40
can contextually interpret the literal as a Celsius threshold. Point/difference and operator-result
contracts remain necessary: the scalar conversion formula applies to extracted readings, not
arbitrary addition/scaling of temperature points. Comparing or adding mixed unit backings as raw
numbers is invalid. A general Temperature retains its concrete representation tag; no ambiguous
unitless numeric Temperature is manufactured by parent admission.

This refines the S32 literal question: a concrete Celsius target has a declared public numeric
interpretation, while a general quantity target such as Duration requires a unit-bearing input.
Literal admissibility is a construction contract, not a consequence of sharing numeric storage.

If region thresholds are intended to agree, Europe25 Celsius and USA77 Fahrenheit agree; USA77
in a Celsius branch means 77 Celsius. Duplicate global IsHot signatures and tuple function-pattern
bodies raise new overload/coverage rules; one ordinary function plus `when` avoids requiring them
for this exploration. A shared method capability can eventually provide dispatch without matching
each unit when that behavior belongs to the family.

### Conversion bans and the uninhabited type are separate contracts

Public scalar extraction can be absent by default or explicitly forbidden at the family boundary.
Forbidding Celsius -> Temperature must not be claimed to coexist with the same operation being
performed by default implicit argument conversion. Distinguish semantic parent admission (tag and
meaning preserved) from representation erasure. Prefer allowing Temperature consumers and
restricting scalar extraction, with owner-private extraction available to declared converters.

`never as number` is a possible declaration spelling for a negative conversion permission, but it
is not a converter body returning a value of type never. Actual never is uninhabited: genuine uses
include nonreturning intrinsic failures, impossible match remainders and impossible error variants.
A callable returning never may abort/diverge and can typecheck in value-required contexts; it does
not make invoking that callable a compile-time prohibition. `return never` cannot return a never
value. A broad family extraction ban should cover derived types and cannot be overridden by a
descendant without weakening the guarantee; ownership and escape rights remain decisions.
Conversely, a child cannot withdraw an extraction/capability guaranteed by its parent's interface
while still promising unrestricted substitution for that parent. Put opaque representation
boundaries before an ancestor promises public extraction, or change that admission contract.

A prohibition on a currently considered conversion path is not information-flow tracking across
arbitrary methods and separate statements. Celsius -> Fahrenheit -> number still exposes the data
if Fahrenheit publicly permits extraction. Public formatted strings can likewise lose provenance.
Strong secrecy/provenance needs encapsulation or a separate information-flow contract. An explicit
generic reconstruction remains possible if arbitrary public constructors admit raw data.

### Literal spelling and construction contracts

Current grammar supports type-first scalar constructors and dotted unit accessors. Its Postfix
expression rule only adds dot members; `30 Celsius` and general `30 as Celsius` are new syntax.
Terminals hide newlines as whitespace. Optional-comma owner entries such as Width30 Height40
would compete with unrestricted literal-plus-type parsing at the Height boundary. A suffix can be
designed, but needs structural boundaries, precedence, signed literals and qualified paths handled.
Recommend one canonical type-first construction form; explicit as is useful for conversion of an
expression. If literal suffix input is added, restrict its contexts and format to the canonical form.

```tao
let Warm = Celsius 30                            // preferred literal construction
let Warm = 30 as Celsius                         // candidate explicit constructor/conversion spelling
let Warm = 30 Celsius                            // possible sugar, not currently supported
```

All supported spellings should invoke the same target construction contract. Custom literal
normalization is useful for percent points -> stored fractions, epoch milliseconds -> canonical
instant ticks, display colors -> linear components, and normalized text. Compile-time literals
may be validated early; dynamic inputs require checked results when failure is possible. Avoid
unexplained scaling by semantic role alone: a named unit or input representation explains it.

```tao
type Percent is number with {
   from number { return number / 100 }
}
let Discount = Percent 25                        // data .25 if this documented constructor is chosen
```

This is deliberate literal interpretation, not a license to reinterpret a named unrelated numeric
value automatically. A custom constructor still needs private canonical-data construction inside
its implementation so conversion results do not recursively run the public input normalization.

### Capabilities and boundary codecs

```tao
can AsJSON { AsJSON() returns text }
func PostJSON(Value can AsJSON) { ... }

can ByteSerialize { Serialize() returns bytes }
can ByteDeserialize {
   static Deserialize(Bytes bytes) returns type | DecodeError
}
Celsius.Deserialize(Bytes)                       // chooses the target concrete type
ByteDeserialize.Deserialize(Bytes)               // error: target type unspecified
Celsius.Deserialize(Bytes)                       // working target selection, with checked outcome
```

`type` in this capability return position is a proposed concrete Self contract. The capability name
continues to denote capability admission, not an unspecified magically selected implementation.
Encoding uses an instance; decoding is a type-owned factory with no existing instance. A derived
type cannot inherit a decoder that builds only its parent while promising concrete Self. Selecting
Celsius supplies unit interpretation; decoding arbitrary Temperature needs a discriminator or
explicit external schema. Bare numeric JSON cannot establish the unit or restore the original
nominal descendant. Version/unknown-tag/invalid-value failures require typed outcomes.

Typed deserialization is a system-boundary contract, whether implemented by generated codecs,
stdlib functions or datasource adapters. Static adapter signatures are not runtime validation of
untrusted data. Adapter metadata should establish schema, concrete representation and constraints;
custom decoders validate what the raw format cannot establish. A generic protocol DSL need not be
implemented before this boundary is safe.

Verified current-source boundary: TR-data-definition.ts:113–134 checks primitive kinds, finite
numbers, optionality and enum membership. TR-data.ts:43–69 has no named-scalar identity/codec
field. instant-rows.ts:189–190 replaces invalid primitive inputs with field defaults. Thus structural
deserialization is already present, but unit/UUID/nominal guarantees require additional contracts.
TypeScript's official Narrowing handbook uses never for impossible remainders/exhaustiveness;
it does not mean a forbidden callable. Source: https://www.typescriptlang.org/docs/handbook/2/narrowing#the-never-type.

Next recommended single decision: distinguish subtype admission from representation-changing
conversion and raw extraction, using the identifier/temperature pair. Then resolve abstract/closed
family coverage before choosing can/Self/literal/negative-conversion spellings. No parser, validator,
compiler or runtime implementation is claimed by this sketch.

## S34 — capability vocabulary and explicitly qualified receivers

Stories: D01, D34. The Developer accepted the recommendations in this round on 2026-10-02,
with one spelling correction: associated type bodies use `type Fahrenheit is Temperature with {`.
Use can for capabilities, as for permitted value operations, qualified receiver declarations,
actual item/collection receiver binding, snapshot membership with sequential item actions,
receiver-shadowing rejection and source-or-target converter ownership. Omit like-number sugar
initially; unqualified singular method sugar is not part of the selected canonical form. Methods
live directly in data bodies, while type-associated bodies use with. This settles direction,
not implementation: operator contracts, static factory grammar and detailed failure/transaction
behavior still need their own specifications.

### Requirements versus value operations

`X like number` can mean a requirement on a value without converting it, but the requirement must
define operands, results, literals and effects. Numeric storage, scalar capability and an available
as-number operation are three different facts. Selected: use can for named capabilities and omit
like-number initially. The like spelling below is retained only to explain the comparison; it is
not selected syntax. If later introduced, it must alias a specified core capability contract.

```tao
func Inspect(X like number) { ... }               // candidate capability admission; retain value identity
func Inspect(X can Numeric) { ... }               // explicit named capability alternative
let Raw = Value as number                        // conversion/extraction operation, if permitted
```

An as-number parameter header would instead imply adaptation at the call boundary, not merely
capability admission. This would reintroduce input-local adapters; they remain rejected. Reserve
as for value operations and their declaration bodies rather than treating it as another constraint
word. The capability promise must be explicit: supporting like-type comparison does not entail
arbitrary mixed addition or raw extraction. Sharing numeric storage proves none of them.

### Direct body placement and owner selectors

```tao
data Books / Book {
   LoanedOut yes/no

   action Book.Return() {
      update Book { LoanedOut no }
   }

   action Books.Return() {
      loop Books / Book {
         do Book.Return()
      }
   }
}
do SelectedBook.Return()                         // bound item receiver
do SelectedBooks.Return()                        // bound collection receiver
```

Book in the item body binds exactly one live item; Books in the collection body binds the exact
collection the method was called on. The latter must not resolve back to every item in the global
datasource when invoked on a filtered query or selected subset. Mutation methods require live
item handles, not detached structural copies. Selected: snapshot membership at entry and
executing per-item actions sequentially; batch atomicity and failure behavior remain explicit
contracts, not promises of the method name. Changed query membership must not skip later entries.

Unqualified action Return() could coherently default to the singular receiver, but is not selected
canonical syntax. Use qualified Book.Return()/Books.Return() declarations. `update Book.Return`
is not an action invocation; use do with call
parentheses. Action loops and nested action declarations are not in the current action/data grammar.

A declaration owner is a receiver kind; invocation requires an actual value. Book.Return() at a
site with no bound Book must not choose an arbitrary record. Books.Return() can name the global
collection if Books is bound there. Static factories have no instance receiver and need separate
declaration semantics. Avoid adding an implicit type-namespace call with a hidden receiver argument
whose meaning changes when the same owner name is locally bound.

Receiver names should not be shadowed accidentally. An item method loop binding named Book would
hide its own receiver; selected behavior rejects that rebinding and allows CurrentBook instead.
Collection bodies may use Book as their loop binder because only Books is the implicit receiver.
Type names in type positions remain separate from receiver values in expression positions.

### Converter declaration headers and ownership

```tao
type Fahrenheit is Temperature with {
   Fahrenheit as Celsius {
      let Reading = data of Fahrenheit
      return Celsius ((Reading - 32) * 5 / 9)
   }
}
let Reading = Warm as Celsius                    // invoke the declared operation
```

The header is source type plus target type; its body binds the source value. Declaration-only
type-body context makes this distinguishable from a value conversion expression. The redundant
source name is useful for a consistent qualified receiver vocabulary. Its spelling does not turn
the receiver into an untyped number or settle the numeric/operator contract.

Requiring the source to equal the enclosing type would prevent a local type from accepting a
conversion from an imported type whose declaration cannot be edited. Endpoint ownership is a
possible alternative:

```tao
type LocalUserID is Identifier with {
   VendorUserID as LocalUserID { ... }            // destination-owned incoming conversion
}
```

Selected: an owned declaration may implement an operation when it owns the source or
target; do not permit arbitrary conversions between two unrelated imported types from that block.
Foreign private representations remain private: an incoming converter needs public source
capabilities/accessors. Duplicate source-target implementations and extension visibility need
diagnostics/ownership rules before implementation. The source-only ownership rule plus ordinary
named adapter functions remains a historical narrower alternative; endpoint ownership is selected.

Next slice: specify operator/capability contracts, static factory syntax and converter conflict
visibility, keeping batch failure/transaction guarantees explicit. The selected direction has no
inherent contradiction; complete contracts and implementation still remain. No language tests ran.

## S35 — compact fixture review and code preferences

The Developer's annotated minimal-app review on 2026-10-02 selects structural capability satisfaction,
ordinary capability parameter syntax (`Value Display`), and optional inferred function return types.
The requested rendering direction is `can ui { Render() -> rendered }`. Exact receiver-view placement,
dispatch, and lifecycle semantics remain open. The examples are still non-executable design fixtures.

[Code preferences](<../Tao Revolution/Code preferences.md>) records requested concise authoring forms,
including bare compatible arguments, constructor-shaped state initializers, zero-argument renders,
one-line accessibility prefixes, atomic event continuations, helper extraction, renderer forwarding,
and unit suffixes. These are not unconditional formatter rewrites.

The review reopens repeated input identities across all invocables: allowing repeated types is coherent
only with explicit binding selection or a unique remaining complete matching, never positional ties.
The proposed `.Name` binding-selector extension must preserve public signature type projections and
must not create new nominal identities merely to distinguish bindings. It is not selected yet.

Other unresolved forcing cases: private representation access without `data of`; inherited numeric
operations with same-type operand contracts; finite union coverage versus constructible parent types;
unit construction versus scalar casts and nominal narrowing; no node versus an empty text node;
lexical ownership of forwarded renderer slots; locale-aware display text versus raw strings; adapter
schema/semantic validation; synchronous submission failures versus later mutation outcomes. The review
does not create new ReadFailure/WriteFailure types or settle a new mandatory failure declaration syntax.

The preceding two-file fixture was printed in the conversation, not saved. The Developer now asks to
revise and reprint it before saving app files; no Apps/Syntax2 files are authorized in this review turn.

## S36 — bare binding selectors, comparable numbers, and deferred investigations

Requested 2026-10-02. These are proposals except the explicit adapter-ownership decision and
pre-MVP deferrals. No grammar, type checker, or runtime behavior changes here.

### Bare arguments selecting repeated-type bindings

`Add(Right 2, Left 5)` is feasible as an immediate-signature fallback when Right/Left do not name
ordinary visible types. The argument site must retain the selected binding, rather than reduce both
constructions to indistinguishable numbers. This is a binding selector, not a new nominal identity.
Normal visible-type lookup must continue to win; a visible incompatible type errors without fallback.
`.Right` remains an explicit escape hatch. Type-path projection such as Add.Right still denotes the
declared type, while explicit argument-site selection additionally names a binding. No argument-order
tie breaker or inference from an arbitrary local variable's spelling is proposed. Delimited calls can
use the existing Name-plus-operand construction grammar; concrete parsing still needs a prototype.

### Representation access without conversion bans

If public ancestor projections remain available and conversion bans are omitted from the fixture,
ordinary `as number` supplies the needed representation operation. `data of` and the proposed private
projection exemption are then unnecessary for that fixture. This does not settle irreversible data
erasure, whether core scalar admission is implicit, or future opaque representations.

### Comparison proposal and its boundary

An Ordered contract can require Compare(Other type), where type is the same comparison-domain Self.
Numbers and suitable numeric descendants reuse the numeric implementation, but comparison operators
do not search a common ancestor or automatically choose a unit converter. Same-unit concrete values
compare; Celsius/Fahrenheit require explicit conversion. Raw literals can construct a known concrete
threshold contextually, unlike already typed scalar values. A heterogeneous parent/union requires a
declared normalizing comparison or narrowing to compatible concrete operands.

Same-static-type checking alone is insufficient if independently typed quantities can implicitly
widen into two number parameters: the callee would compare identical static number types. The proposed
stronger boundary separates numeric representation/operations from implicit scalar admission and
requires explicit scalar extraction for quantities. That is a substantive type-policy choice, not
selected merely by requesting inherited comparisons. Likewise, admitting both units through a common
Temperature parameter must not grant a representation-blind comparator. The precise quantity/family
classification and comparable-Self contract remain to decide.

### Duration role construction

A declared `Duration as AnimationDuration` operation can authorize the explicit `as` form. It should
preserve the existing canonical duration without applying millisecond scaling again. Explicit
construction in that converter must be distinct from recursively invoking the converter. The preferred
`let AnimationDuration 150 Milliseconds` constructor-shaped shorthand still needs its contract: a
converter declaration does not silently change all constructor syntax or permit implicit narrowing.

### Selected deferrals and external data ownership

Default serialization/deserialization ownership belongs to datasource and I/O adapters. Current
datasource snapshots validate schema versions and stored shapes; InstantDB projection can default
malformed primitive values. Generic foreign-action results are trusted, not automatically decoded
against their declared Tao return type. Domain tags, units, and custom constraints still require
appropriate boundary validation; no complete type-safe decoder is claimed.

Locale-aware core text moves to pre-MVP A21/R16, and the complete static data/read/failure proof system
to A22/R17 in the MVP roadmaps. Both investigations are deferred from the remainder of this syntax
task; adding them does not authorize implementing their unsettled designs.

## S37 — operation domains and protected representations

Requested 2026-10-02. Bare immediate-callee binding fallback is now accepted direction (S36), with
visible types taking precedence and `.Right` retained as an escape hatch. `never` and conversion
ban declarations are removed from the active fixture and deferred to pre-MVP A23/R18. Historical
S33 examples retain the reasoning record; they do not prescribe the current fixture.

### Useful comparison side discussion

The referenced Ordered Capability Comparison conversation was read in full. It contains no new
Developer decision. Its useful points are: two independently Ordered parameters need not be
mutually comparable; a generic operation must capture their shared comparison domain; inherited
Self requirements need an anchoring rule; equality need not derive automatically from ordering.
These refine S36. Its explicit conformance clauses and `Value can Ordered` spelling are superseded
by structural conformance and ordinary `Value Ordered` parameters. Read status cannot be inferred.

### Proposed semantic categories

The Developer proposes weak numeric storage, ordinary number arithmetic, scalar quantities,
affine points and deltas, opaque identifiers, and protected secrets. This is a promising frame,
not a selected hierarchy. Keep backing representation, subtype admission, operation capabilities,
and representation exposure separate: storage sharing grants no semantic conversion by itself.

- Number is naturally a dimensionless scalar; scalar quantities carry an operation domain and
  units. Duration addition preserves Duration, scaling by number preserves Duration, and dividing
  Duration by Duration yields number. Duration multiplication needs a squared-dimension result
  or a diagnostic, not another Duration. Generic scalar admission must retain the domain relation.
- Affine points have a paired displacement type, not a displacement subtype of the point.
  Point minus point produces a delta; point plus/minus delta produces a point; point plus point
  is invalid. Celsius/Fahrenheit point conversion uses offset and scale, while delta conversion
  uses scale only. This is geometric affine space, not affine ownership/resource-use typing.
- Ordinary number cannot be an unrestricted arithmetic ancestor implicitly accepting quantities
  or points: a helper with two number parameters would recreate unsafe mixed-unit comparison.
  A weak numeric ancestor may only promise operations valid for all admitted descendants.
- Comparison domain and concrete nominal identity are related but not identical. Celsius versus
  Fahrenheit requires explicit conversion under the intended strict unit policy; duration role
  descendants may share a declared domain where valid. Parent result types must not pretend an
  operation preserves narrower validation constraints. Generic shared-domain syntax and inherited
  Self anchoring remain open.
- Opaque identifiers may expose domain-safe equality, hashing, keys, references, and adapter codecs
  while withholding parsing, ordering, arithmetic, and raw extraction. Opaque does not mean unusable.
- Secret string values must not implicitly substitute into ordinary string inputs: interpolation,
  slicing, concatenation, and logging could otherwise bypass explicit extraction. Redaction applies
  to display/debug paths; adapters transmit the intended credential, not the redacted placeholder.
  Explicit extraction ends encapsulation unless a separate information-flow system is introduced.
  Secret wrapping is not encryption. Access policy can use encapsulation and positive operations
  without restoring `never`; private implementation access still needs a contract.
- Raw string versus locale-aware text remains A21/R16. This frame does not select a replacement
  core text representation while that investigation is deferred.

### Evidence and next forcing examples

Primary precedents: [mp-units affine space](https://mpusz.github.io/mp-units/latest/users_guide/framework_basics/the_affine_space/)
for point/delta operations; [Boost.Units absolute and relative temperature](https://www.boost.org/latest/doc/html/boost_units/Examples.html#boost_units.Examples.Absolute_and_Relative_Temperature_Example)
for distinct point/delta conversion formulas; and [mp-units quantity arithmetic](https://mpusz.github.io/mp-units/latest/users_guide/framework_basics/quantity_arithmetics/)
for dimension-aware results. These support conceptual distinctions, not Tao syntax choices.

Next minimal fixture should exercise number, Duration, Instant, Celsius/Fahrenheit and their
deltas, opaque UserID/AdminID, and secret Password at an I/O boundary. First settle the relation
between storage and public ancestry; then write exact operand/result contracts and shared-domain
generic admission. Do not implement a hierarchy before those guarantees are explicit.

## S38 — operation-free numeric storage and unit identity

Developer clarification: numeric is storage with no operations. Number is backed by numeric and
defines ordinary arithmetic/comparison operators explicitly. Other numeric-backed types supply
their own contracts; storage does not confer number admission or number methods. Primitive
implementations are expected through TypeScript injection; declaration grammar is still open.
Temperature has ordering, delta has ordering and valid delta/point arithmetic, and unrelated
quantity/point operands must be rejected. Point-plus-delta on the point receiver versus delta-only
addition remains to clarify; do not silently choose one reading of "Temperature has no addition."

The earlier unit-free Duration illustration was insufficient. Proposed construction requires units:
Seconds 5 and Minutes 3, not an unexplained Duration 5. Internal arithmetic results already have
their declared quantity domain/unit contract and do not require the developer to repeat a unit.

Decision now: units can be constructors/readings of a common Duration value with canonical storage,
so Seconds 5 + Minutes 3 equals Seconds 185 without changing nominal types; or units can be distinct
types requiring explicit conversion before addition. The first is recommended for Duration ergonomics,
the second makes operand units explicit in matching and output typing. Neither gives permission to
add raw readings 5 + 3 as though they had equal units. Canonical normalization, input unit syntax,
display unit selection, and unit-type identity are separate contracts. No new unit policy is selected
by this record; older unit decisions provide context rather than constrain this exploration.

## S39 — supplemental quantity notes, considered as input only

The Developer supplied discussion notes headed "We are designing an extension/refinement of Tao's
type system" as context, explicitly not instructions or decisions. No implementation plan or
compiler work follows from the embedded prompt. Much repeats S32–S38: separate semantic identity,
numeric backing, operations, units, and exposure; pair affine points with deltas; prefer semantic
app types. Its claim that choices were decided does not make them Tao decisions.

Useful additions or sharper forcing questions:

- Unit representation versus nominal identity is the immediate fork: one canonical Temperature
  with Celsius/Fahrenheit constructors/readings, or distinct coordinate types with explicit
  conversions. Distinct types need not mean distinct physical quantities. The notes' automatic
  cross-unit equality conflicts with the earlier strict mixed-unit proposal; neither wins by being
  included in these notes. Unit-independent physical equality is desirable once a shared comparison
  domain is deliberately established; display hints must not affect it.
- Conversion through a canonical representation can avoid all-pairs converter definitions. Define
  point offset/scale and delta scale separately. Canonical units do not make floating-point arithmetic
  exact; precision, overflow, nonfinite values, conversion round trips, and exact versus approximate
  equality need a numerical contract even if public machine-storage controls are deferred.
- Preferred display unit is optional presentation metadata, not reliable historical provenance.
  Arithmetic, persistence, and adapters must decide whether to retain it. Core locale-text design
  remains A21/R16; displaying a unit is not itself a decision to make text locale-aware storage.
- Ratios such as percentage have scaled representations without a physical dimension. Probability
  also has bounds. Shared dimension or representation must not imply interchangeable semantic types
  or preserve a constrained result type under every operation.
- Explicit Distance/Duration->Speed operator relationships are an alternative to automatic
  dimensional type synthesis. Typed heterogeneous operand/result contracts may also express affine
  algebra without a dedicated affine compiler primitive. Prefer testing that boundary before adding
  new special core categories. Collection-specific index ideas relate to existing occurrence/page
  metadata discussion and are not added to the current implementation scope.
- Logical numeric backing is distinct from physical Float64/Int32 layout. Keep storage controls
  out of the present syntax proposal unless a concrete use case requires them; runtime numeric
  precision guarantees still need an eventual specification.

Corrections to the supplemental assumptions: adapter ownership of serialization is already selected;
canonical versus source-unit wire formats remain schema choices to explore at that boundary. Generic
ForeignAction results do not have complete automatic schema decoding today. Equality spelling is
still open. "Affine + Delta" in the notes does not settle the Developer's point-receiver addition
question. Number-in-stdlib versus built-in, implicit cross-unit conversion, delta synthesis, display
precedence, physical storage controls, and full dimensional analysis remain proposals, not decisions.

Continue with S38's one unit-identity decision using Seconds 5 + Minutes 3. A unitless Duration 5 is
insufficient input syntax absent a separately declared default unit. Recommended option: unit-bearing
constructors normalize to one Duration type; alternative: unit-specific types require explicit
conversion. Settling this for Duration does not automatically settle Temperature's mixed-unit policy.

## S40 — signed time differences, nonnegative lengths, and ratios

The Developer endorsed the minimal scalar-backed quantity/base-unit/ratio-unit direction, subject
to further refinement, and reopened signed Duration versus a separate time delta. The preceding
chat's signed Duration recommendation was not a decision. Proposed next distinction:

- TimeDelta is a signed temporal displacement; Instant-Instant -> TimeDelta, and Instant+TimeDelta
  -> Instant. Negative displacement moves earlier and negative remaining time means overdue.
- Duration may instead denote nonnegative elapsed length. Duration-Duration then yields TimeDelta,
  while Duration+Duration remains Duration. Negative construction fails validation rather than
  silently clamping. A delay/timeout/animation API accepts a nonnegative duration or a deliberately
  stronger positive role; a deadline API can explicitly run immediately when its instant is past.
- Alternative: keep Duration signed and constrain only waiting/animation/elapsed API inputs.
  This preserves simpler scalar closure but makes Duration broader than elapsed length.
- TimeDelta is the recommended signed name if two types are selected; TimeSpan is readable but
  does not itself express direction, and TimeOffset can be confused with a UTC/time-zone offset.

Ratio is proposed as a dimensionless scalar backed by numeric, not by Duration and not automatically
the same identity as number. Same-domain quantity division could yield Ratio. Unit cancellation
normalizes scale before division; percent is a 0.01 scaling of unity. General ratios can exceed one
and be negative; Probability/Progress need separate bounds rather than clamping Ratio globally.
Zero divisors need a modeled failure policy. A generic Ratio does not retain which quantities were
divided; nominal role ratios remain available when that distinction matters.

This exposes result-contract constraints: a signed Ratio times nonnegative Duration can be negative,
so the result is TimeDelta, needs a nonnegative multiplier type, or uses an explicitly checked
operation. Runtime sign alone cannot silently change the static result type. Similarly the prior
scalar sketch's Self-Self->Self subtraction is incompatible with a nonnegative Duration subtype.
Options include signed Duration with constrained consumer roles, or a weaker scalar contract with
declared difference/result relationships. Do not solve this by violating promised parent contracts.

Primary precedents: [Python timedelta](https://docs.python.org/3/library/datetime.html#timedelta-objects)
names a signed time difference; [mp-units dimensionless quantities](https://mpusz.github.io/mp-units/latest/users_guide/framework_basics/dimensionless_quantities/)
retains a dimensionless quantity after like-kind division. These are alternatives for Tao to assess,
not evidence that either Tao policy is already selected.

Remaining decision inventory: time-difference versus elapsed vocabulary/invariants; Ratio contracts
and bounded roles; inherited operator domains/result types; numeric validity and division/equality
failures; unit conversion/reading syntax and precision; affine point/delta pairing and dispatch.
Continue one item at a time, starting with signed Duration versus TimeDelta plus nonnegative Duration.

### Selected follow-up: signed Duration is the time displacement

The Developer selected signed Duration. A time point is not a scalar; subtracting two compatible
time points produces Duration, which can be applied to a time point. The separate TimeDelta plus
nonnegative Duration recommendation above is historical and superseded for the active direction.

```tao
Time - Time -> Duration
Time + Duration -> Time
Time - Duration -> Time
Duration + Duration -> Duration
Duration - Duration -> Duration

let Shift = Finish - Start
let Reconstructed = Start + Shift // Finish
```

Duration does not clamp at zero. Consumer-specific nonnegative requirements remain an API contract
to define, not a global change to Duration. `Time` here labels a compatible affine time-point domain;
its final public name, clock basis, and distinction from calendar/time-of-day types remain open.
Signed Duration subtraction preserves its domain, so the proposed split's nonnegative subtraction
problem disappears. Constrained role types still need sound result contracts. Ratio is the next
discussion: numeric-backed dimensionless scalar, same-domain quotient result, scaling relationships,
and division by zero. No Ratio policy is accepted merely by selecting signed Duration.

### Selected follow-up: Ratio and three-item decision rounds

The Developer accepted the proposed general Ratio model: signed, dimensionless, numeric-backed
scalar, no zero-to-one bound, unity base unit, percent and permille scaled representations.
Duration/Duration -> Ratio, Duration*Ratio -> Duration, and Duration/Ratio -> Duration are selected.
This acceptance does not settle division by zero, overflow, nonfinite values, or implicit scalar
admission. Bounded probability/progress are separate constraints. Use three decision items per
round for the remaining discussion rather than one item per turn.

Remaining inventory: inherited operator domains/results and concrete-Self binding; operator
declaration/dispatch and scaling by number versus Ratio; equality spelling and comparison behavior;
arithmetic validity/failure representation and precision; unit readings/explicit projections and
conversion guarantees; affine point/delta pairing and mixed operand order; time-point clock/calendar
scope and constrained consumer inputs. Core locale text, never, and full static proof systems remain
deferred to their pre-MVP investigations and are not reopened by this round.

First three-item round (recommendations only): keep explicitly declared operand/result domains when
inheriting operators rather than automatically strengthening child result types; use ==/!= for
value equality and retain is for pattern/type/status checks; keep ordinary number/quantity/Ratio
values finite and model invalid arithmetic as failure rather than silently producing nonfinite
values. Each remains a Developer decision, with exact generic template and failure spelling open.

### Selected first round and proposed second round

The Developer accepted all three recommendations. Explicit operator operand/result types remain
unchanged under inheritance; a reusable scalar template's domain binding still needs a contract.
Value equality uses ==/!=; is remains pattern/type/status matching. Ordinary numbers, quantities,
and ratios remain finite; invalid arithmetic is a modeled failure, with static diagnostics where
evident. Exact failure representation, handling, precision, and generic template spelling remain open.

Second round proposals, not decisions: use ordinary associated func declarations for operator
symbols rather than a separate operator declaration category; resolve authored ordered operand
contracts without automatically swapping operands, with reverse signatures explicitly supplied
when desired; generate explicit named unit-reading methods such as Wait.Seconds() -> number rather
than overloading as-unit with both representation and raw extraction meanings. Unit constructors
continue to return Duration; unit readings deliberately return a numeric magnitude in a named unit.
These proposals do not yet select raw as-number permission, formatting units, unit namespace syntax,
operator extension ownership, bare-number scaling, or failure handling.

### Selected second-round items and rejected raw reading

The Developer accepted associated func operator declarations and explicitly supplied ordered
signatures without auto-swapping operands. The third recommendation was rejected: selecting
seconds/minutes must retain semantic and unit information instead of returning an anonymous
number. Exact unit-view/result types remain open. For value-preserving conversion, Minutes 2
has a seconds reading of 120 Seconds; the Developer's "2 Seconds" comment needs that distinction
from deliberate reinterpretation, which changes the quantity and is not implicitly accepted.

Before designing extraction, use concrete boundary examples. React Native Animated.timing accepts
duration in milliseconds ([official docs](https://reactnative.dev/docs/animated)); Node setTimeout
accepts a primitive numeric delay in milliseconds ([official docs](https://nodejs.org/api/timers.html)).
Tao can retain Duration and let a typed adapter normalize and extract the primitive at that boundary.
Injected scalar/unit implementations also need backing magnitudes for primitive arithmetic. Those
uses justify an internal bridge, not automatically an application-level unit-erasing operation.
Serialization defaults to existing adapter ownership; schema-selected numeric wire fields still
carry units in their contract. No general public raw-reading method is selected by these examples.

## S41 — next boundary decision round

The Developer agrees to proceed from the concrete boundary cases. Continue three decisions at a
time. These are recommendations to discuss, not accepted interfaces or implementation work:

1. A unit-selected value remains Duration with an explicit selected-unit view, while its canonical
   quantity remains unchanged; equality ignores that view. Alternative: a distinct fixed-unit
   reading type retaining its Duration domain. This resolves the still-open result of Wait.Seconds(),
   not the already selected canonical unit construction model. Unit view scope/persistence still
   needs defining; no locale-aware core text decision follows.
2. TypeScript adapters receive typed values and explicitly use an exported unit-aware bridge to
   obtain primitive magnitudes. Alternative: a boundary declaration chooses a unit and the compiler
   passes a preconverted primitive. Bridge access is specific to exported type contracts and does
   not grant arbitrary private representation access. Storage/wrapper implementation is not selected.
3. Delay accepts signed Duration but rejects negative arguments as a modeled invalid-argument
   failure, with zero meaning no intentional wait. Alternative: negative arguments execute without
   waiting. No exact scheduling/microtask guarantee is implied. Other consumers declare their own
   input policies, and strictness is not a global nonnegative Duration invariant.

After these answers, rewrite one minimal Duration definition and a tiny TypeScript Delay adapter
in chat to exercise the actual contract. Failure representation, precision, operand extension
ownership, plain-number scaling, and clock/calendar distinctions remain later decisions. Do not
create app files or start implementing from this decision-round outline.

### Selected follow-up: canonical backing access and Wait

The Developer selected item 1A: unit selection returns Duration with a unit view; canonical backing
and equality remain independent of the view. For item 2, the Developer specifies a uniform TypeScript
underlying-value accessor on all values, provisionally getJSValue(), rather than a per-unit bridge.
Assuming Duration declares Seconds as its canonical base, Minutes 2, its Seconds view, and its
Minutes view all expose canonical JS magnitude 120. The seconds display is 120 Seconds and the
minutes display is 2 Minutes. A milliseconds-consuming backend multiplies by 1000 explicitly under
the documented type/adapter contract. The getter alone does not choose an external API's unit.

This is a trusted TypeScript boundary. The eventual accessor shapes for composite values, unavailable
data/resources, and secrets need explicit contracts; no new Tao-level data-of/extraction operator is
introduced and no security guarantee against deliberately extracted JavaScript data is claimed.

Item 3B is selected. Rename the proposed action to Wait: nonpositive Duration performs no intentional
wait. Zero/negative values remain valid Duration; consumers such as animation retain independent
contracts. No exact synchronous-return, microtask, or host scheduling guarantee follows.

Seconds -2 is the preferred proposed construction form. Current NUMBER is unsigned
(terminals.langium:14), while DeclaredConstructorValue and TypedConstructorValue admit literal forms
without unary expressions (expressions.langium:319-323). Unary minus exists separately at line 147.
Thus current named construction does not consume the signed value in this form; it may instead
parse a name-minus-number subtraction expression. A future unit-constructor form needs deliberate
resolution when a name could also denote a value. This was source inspection, not a parser test or
implementation. Parentheses in earlier sketches were illustrative, not a settled requirement.

## S42 — constructing typed results from TypeScript

Continue the Developer's three-item rounds at the reverse boundary. Proposals, not decisions:

1. Prefer explicit generated type factories, provisionally types.Duration.fromJSValue(value), and
   require TypeScript exports to return compatible typed Tao values. Alternative: foreign return
   contracts automatically wrap raw JavaScript output. Factory namespace avoids shadowing the bound
   Duration receiver value. Exact SDK export shape remains open.
2. Make fromJSValue the canonical inverse of getJSValue: accept canonical backing without repeating
   unit scaling or custom input normalization. Seconds is the example Duration base; 120 means 120
   canonical seconds. Unit-specific construction is a separate entry point. Alternative: require
   an explicit input unit for quantity factories. A semantic round trip need not preserve a selected
   display view unless that metadata is also supplied; factory default-view rules remain to specify.
3. Factories validate JS shape, finiteness, and declared domain invariants; invalid data produces a
   modeled boundary failure and never becomes an apparently valid typed value. Alternative: return
   an explicit success/failure result from construction for callers to inspect. Success has the
   requested type; no unit/semantic truth can be inferred from an untagged number beyond the caller's
   documented contract. Failure mechanism details and propagation remain a later decision, with the
   complete static proof system still deferred.

These choices must distinguish canonical construction from source-unit conversion and keep the
accepted returns Duration/Ratio operator contracts meaningful. No runtime/compiler changes follow
from this round. The next forcing sketch should implement Duration addition and a Wait adapter
using the chosen getter/factory contract; do not save app files while the Developer is reviewing in chat.

### Selected construction round

All three recommendations accepted: explicit generated typed factories, canonical fromJSValue
input, and validated construction with modeled failure. No automatic raw-return wrapping is
selected. The Developer now wants five questions per round. Clarification requested: unit helpers
such as types.Duration.Minutes are proposed compiler-generated outputs of unit declarations, not
handwritten for each unit; custom conversion formulas still need authored definitions. This is an
API design proposal and generation direction, not implemented tooling.

## S43 — five quantity questions

Recommendations only, pending Developer answers:

1. Allow ordinary number as well as Ratio for quantity scaling, using explicit ordered signatures.
   Alternative: Ratio-only scaling with explicit conversion of already typed number operands.
   This does not make Duration or Ratio interchangeable with number.
2. Standard operators preserve a selected unit when contributing same-domain quantity inputs agree;
   otherwise use the quantity's declared default/base view. Single-quantity scaling preserves that
   quantity's view. Alternative: always return the default/base view. This policy does not alter
   canonical backing/equality and custom operator presentation contracts remain explicit.
3. Value == compares canonical backing exactly; approximate comparison is an explicit operation
   with a quantity-typed tolerance. Alternative: default approximate equality. The latter risks
   nontransitivity and inconsistent key/grouping semantics. Numerical storage/precision choice and
   exact rational/decimal alternatives remain separate questions.
4. Begin with authored operand/result contracts for derived quantities, e.g. Distance/Duration
   -> Speed, rather than automatically synthesizing arbitrary dimension types. Alternative: a
   compiler dimension engine. This is a scope proposal, not removal of required arithmetic cases.
5. For an ambiguous Name-minus-value form, a visible value binding wins; an unshadowed unit
   constructor accepts signed input; a qualified unshadowed constructor path is the escape hatch.
   Alternative: prohibit value shadowing of visible unit constructors. This rule is specific to
   ambiguous subtraction/construction syntax, not a reversal of visible-type lookup in unequivocal
   positive constructor expressions. Requires a parser/name-resolution prototype across call,
   declaration, and item-entry contexts; no grammar implementation is claimed.

### Selected quantity round and postfix-unit exploration

Items 1A, 3A, and 4A accepted: number/Ratio scaling, exact canonical equality with explicit
approximation, and initially authored derived-quantity operators. For item 2 the Developer selects
the leftmost operand's unit, replacing the shared-unit/default fallback recommendation. Thus
Minutes 2 + Seconds 30 presents 2.5 Minutes, while the reverse presents 150 Seconds. The policy
cannot literally supply a Duration view from a unitless number or a Ratio/Speed result from the
Duration input's unit alone. Proposed follow-up: scaling takes the sole quantity operand's view;
different-domain results follow the declared operator result-unit contract. These follow-ups remain
proposals, not accepted extensions of the Developer's rule.

For item 5 the Developer asks whether units always after the magnitude (-2 Seconds) remove
ambiguity. Explore a suffix attached to a numeric literal (including its sign), or to an explicitly
parenthesized number expression; it binds more tightly than multiplication/addition. Proposed
-2 Celsius constructs a point from numeric -2, whereas -(2 Celsius) invokes negation on a point
and is invalid if that operator is absent. Construction must not be implemented as an unconditionally
valid quantity negation. Existing type-first nominal construction remains a separate feature.

The suffix removes Seconds -2's subtraction/construction conflict within a delimited expression,
but it is not proved compatible with every existing whitespace-separated entry. ItemProperty
permits omitted commas and terminals.langium hides all whitespace including newlines. In
Settings { Count 2 Timeout 3 Seconds }, a general numeric-expression-plus-ID suffix parser could
consume Timeout as the unit on 2 rather than the next entry's name. A unit-specific resolution
rule or explicit entry separators is needed. Settings { Count 2, Timeout 3 Seconds } illustrates
the separator escape. Grammar/name-resolution prototyping is still required; no implementation or
parser-test result is implied. Suffix construction, arbitrary bare-expression suffixes, unit-view
selection by suffix, and any new newline significance remain unselected.

### Selected postfix construction

The Developer accepts the literal/parenthesized numeric suffix scope and signed-input distinction,
and selects commas for the entry-boundary issue. Require commas between item/configuration value
entries; ordinary call/list arguments already have comma boundaries. No commas are inferred for
render children/declaration statements. Examples: -2 Seconds, (Count + 1) Seconds, and
Settings { Count 2, Timeout 3 Seconds }. -2 Celsius constructs from numeric -2; -(2 Celsius)
requires a separately available point-negation operator. Type-first nominal construction remains.
The sole quantity operand supplies the unit view for scaling: 2 * 3 Minutes presents 6 Minutes.
Different-result-domain unit policy remains open. No grammar/runtime changes or parser tests.

## S44 — next five numeric/quantity contract questions

Recommendations pending Developer answers:

1. Initially use finite binary64 JavaScript number backing for numeric; precision limitations remain
   explicit and checked finiteness does not prove lossless arithmetic. Alternative: exact decimal or
   rational storage by default. No dependencies or representation implementation are authorized by
   this proposal; separate exact types/backings need a subsequent design if required.
2. Ordinary arithmetic and function expressions may carry inferred modeled failures without a new
   try marker on every expression; failure propagates to the enclosing operation's handler.
   Alternative: mark each potentially failing arithmetic/function expression explicitly. This
   addresses invocation ergonomics, not the deferred complete static handling-proof system.
3. For different-result-domain operations, use the result type's declared default unit unless the
   authored operator explicitly selects another unit. Alternative: compose operand-unit views
   automatically (e.g. kilometers/hours), which needs synthesized unit definitions/ratios despite
   the already selected authored result types. Same-domain and scaling unit rules stay selected.
4. Preserve selected unit views through ordinary Tao assignment/argument passing, but persist/export
   canonical data by default; decoding restores the declared default view unless schema explicitly
   carries view metadata. Alternative: selected unit is automatically part of serialized quantity
   values. This is metadata behavior, not a locale-text decision.
5. Operator declarations belong to a package owning at least one operand or result type; reject
   duplicate/conflicting contracts. Alternative: receiver-type owner only. Independent packages
   cannot silently redefine number+number. Exact extension import/coherence mechanics still require
   specifying; endpoint conversion ownership does not automatically settle operator ownership.

### Selected S44 items

The Developer selects 1A, 4A, and 5A: finite binary64 numeric backing initially; local unit-view
preservation with canonical serialization by default; operator ownership by a package owning an
operand or result type, with conflicting contracts rejected. Items 2 and 3 require deeper discussion.
Progress baseline approximately 72% of this entire decision dialogue, not implementation.

## S45 — typed failure completion and derived-unit forcing cases

Proposals pending Developer answers. Current source already implements native fail/inferred action
cases and when do containment, including restoration of the callee's private overlays to the
invocation savepoint. Compiler ActionsCompiler.ts:262 and runtime TR-effect-outcomes.ts:25 document
that boundary; TR.Fail internally throws TaoActionFailure. This source inspection is not a new test
run. Current handler payload is a message, not the proposed structured Problem. Arithmetic/function
failure effects, then spelling, rich payloads, and fail Problem forwarding are extensions.

Recommended language contract: successful return type plus an inferred typed failure effect, rather
than a visible success|failure union at every arithmetic site. A failure stops the current expression
and invocation; callers complete with the same failure until a matching explicit handler or the
execution root. No valid value is bound for a failed initializer. Preserve failure identity/cause;
unmatched cases propagate, handled cases resume after the boundary, and handler failures travel to
an outer boundary instead of recursively matching themselves. Native failure contracts are inferred;
foreign contracts are declared. Arbitrary TS exceptions/defects remain distinct from declared modeled
failures and go to fault containment, not an ordinary recovery branch. No complete static handling
proof is selected; inference and diagnostics must distinguish known failures from unknown foreign
faults. Implementation may use compiler-private control signals; the language does not require a
specific stack-unwinding implementation.

Prefer completed for explicit operation-success handling in the proposed then example. It denotes
invocation completion, not remote acknowledgement. Existing otherwise is a catch-all even for
failures (TR-effect-outcomes.ts:42), and saved is also currently the generic success label; do not
present either as proof of durable provider acceptance. Model generic error as all declared/modeled
failures with named cases more specific; faults/cancellation need independent default paths.
All these branch refinements are recommendations, not newly selected semantics.

```tao
// Sketch: library supplies quantity units, ArithmeticFailure cases, and Trip.Speed.
func CalculateSpeed(Distance, Duration) {
   return Distance / Duration
}

action SaveTrip(Trip, Distance, Duration) {
   let Speed = CalculateSpeed(Distance, Duration)
   update Trip { Speed }
}

view TripEditor(Trip, Distance, Duration) {
   state Feedback = Notice ""
   render Col {
      Feedback
      Button("Save") {
         on press -> do SaveTrip(Trip, Distance, Duration) then {
            DivisionByZero Problem -> {
               set Feedback = Notice "Enter a nonzero travel duration."
            }
            error Problem -> { set Feedback = Notice Problem.Message }
            completed -> { set Feedback = Notice "Change submitted." }
         }
      }
   }
}
```

Zero duration fails in CalculateSpeed, leaves Speed unbound, skips update, and exits SaveTrip with
the same typed failure; the named handler runs once. A failure during update also exits SaveTrip;
generic modeled error handles it. A successful update completes this operation, while deferred
provider acceptance remains a separate receipt. On handled failure restore callee-owned private
changes, preserving caller changes predating the invocation; unhandled root failure discards that
root's private changes. External effects already performed cannot be rolled back by this model.
No automatic retry of mutations/irreversible effects is implied. At root, provide one scoped default
failure report and preserve surrounding app operation; no silent fallback value or infinite upward
propagation. Render computations need their own occurrence/screen containment, not an action-return
value convention; detached work has its own root/default handling. Exact failure metadata/default
UI and cancellation remain subsequent contracts.

Developer choices: omit a local handler to propagate; handle a particular named case and resume;
use error Problem for all modeled failures; omit an error catch-all for partial handling plus automatic
propagation; explicitly forward with proposed fail Problem; translate with fail DomainCase "Message";
avoid a foreseeable arithmetic failure with a domain validation guard. Use completed for following
success-only work. After any handled-failure branch returns normally, following statements run too;
the continuation must not be assumed to prove original success. Explicit fallback values are an
application policy, never an implicit conversion of failure to zero/empty/none.

Comparative references: Zig try is early error return, catch chooses fallback, and defer/errdefer
perform cleanup (https://ziglang.org/documentation/master/#try and #errdefer). Go normally exposes
error return values; defer is cleanup and panic/recover stack unwinding is separate
(https://go.dev/blog/defer-panic-and-recover). Rust Result/? makes typed propagation explicit
(https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html). JS try/catch/finally
catches dynamic exceptions and performs cleanup (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch).
Recommendation: reuse Tao's explicit operation boundaries and inferred contracts, avoiding a marker
on every arithmetic expression. Prefer lifetime-owned adapter cleanup initially; if Tao-level resource
acquisition becomes necessary, investigate defer independently. Any later cleanup failure must not
replace the primary failure, and local cleanup must not claim to undo remote effects.

Three cross-domain unit cases (canonical quantities are identical across display policies):

| Operation                 | Declared result default     | Automatic composed view                          | Explicit selected view |
| ------------------------- | --------------------------- | ------------------------------------------------ | ---------------------- |
| 2 Kilometers / 30 Minutes | about 1.111 MetersPerSecond | about 0.0667 KilometersPerMinute                 | 4 KilometersPerHour    |
| 2 Meters * 30 Centimeters | 0.6 SquareMeters            | 60 MeterCentimeters                              | 6000 SquareCentimeters |
| 3 Minutes / 30 Seconds    | 6 Unity (Ratio)             | 0.1 MinutesPerSecond (dimensionless scaled unit) | 600 Percent            |

Recommend the result type's declared default in all three cases, with an authored operator or caller
explicitly selecting a supported result view when wanted. Example Result.KilometersPerHour(),
Result.SquareCentimeters(), or Result.Percent() retains the semantic result type. Automatic composition
is physically valid but requires generated unit contracts and can produce unusual display units.
It must normalize canonical magnitudes rather than simply dividing displayed magnitudes and calling
them a base-unit result. Leftmost-unit preservation still governs same-domain operations; sole-quantity
view preservation governs scaling. None of these examples selects an arbitrary dimension engine.

### Selected result-unit policy

The Developer accepts S44 item 3 as elaborated in S45: result-type default view with an explicit
authored operator/caller selection option. No generated unit-composition engine is selected.

## S46 — failure coverage, default roots, and cleanup

Recommendations pending answers to the Developer's four response comments. Current implemented
effect-outcomes-validator.ts computes/transitively checks action outcomes and emits warnings at
unhandled root sites, not mandatory complete-coverage errors. ASTUtils effectFailureCases subtracts
handled native/foreign action cases; dynamic targets have no inferred declared cases, which must
not be treated as proof that they cannot fail. Ordinary arithmetic/functions are not covered by this
action-only mechanism. Handler payloads are currently messages. No new tests were run.

Recommend static coverage of declared modeled failure effects, including arithmetic/functions,
actions, callback/capability invocation contracts, async task roots, data acquisition, and later write
receipts. Inference unions direct/callee failures, subtracts cases handled at an invocation, and adds
failures produced by handlers; recursion requires a fixed-point computation. Higher-order and foreign
contracts must preserve failure effects; unknown behavior remains an open/UnknownFailure obligation,
never an empty set. Public/foreign contracts and validation enforce what can be checked; arbitrary
external code, runtime defects, nontermination, host termination, and semantic truth cannot be proven
safe merely by declaring error types.

Every remaining modeled failure must reach either a matching local handler, a propagated typed
caller contract, or a compiler-visible installed default root handler. Missing root coverage is a
compile error, rather than a warning, for the proposed covered contract subset. Built-in defaults
can satisfy this rule with no repeated author code; app overrides must preserve total coverage or
delegate their remainder. Local partial handlers remain legal. Explicit acknowledgement/suppression
is a handling policy rather than an unhandled case; an empty branch can satisfy structural coverage
but warrants a lint warning because coverage does not establish useful recovery. Prefer meaningful
default reporting to accidental empty handlers. The full availability/suspension/receipt proof is
still the deferred A22 investigation; this is a practical proposed effect-coverage subset, not its
implementation or a theorem of universal safety.

Action failure ends at an invocation's matching handler or the event/command/task root. It does not
automatically enter an arbitrary guard: render/data availability uses resource metadata and the read
handling net, rendering faults use their owned containment boundary, and later provider failure is
owned by the receipt/resource, not a returned action stack. Cleanup has its own reporting obligation.
Conceptual default policy:

```tao
// Prospective customization, not current app grammar:
app Example {
   on failure Problem -> do ShowFailure(Problem)
}
```

Each app installs the core equivalent unless overridden; UI roots get a scoped report, render/read
roots get an owned fallback/status response, background roots route into the owning app's net, and
non-UI consumers return a typed failure to their host. Default presentation must avoid report loops
and duplicate reporting and must accurately distinguish local rollback from irreversible external
effects. Every root requires a last-resort fault boundary even when modeled failures are exhaustively
handled. Cancellation is explicitly accounted for and may be quiet by default; discarded search
work/best-effort telemetry may also have an explicit quiet policy. Failed writes, permission denials,
invalid arithmetic, and decoding failures are never silently dropped merely because unhandled.

Cleanup illustration (defer not selected or implemented):

```tao
action UploadReport(Report) {
   let TemporaryPDF = do CreateTemporaryPDF(Report)
   defer { do DeleteTemporaryFile(TemporaryPDF) }
   do UploadFile(TemporaryPDF)
}
```

Register cleanup only after successful acquisition; run it on normal/failed/cancelled exit, after
joined upload has stopped using the file. It deletes an unwanted local artifact; recovery instead
decides how to present offline/server rejection or retry safely. Cleanup failure must be reported
without replacing a primary upload failure or falsely claiming an already successful upload was
undone. Exact failure grouping/reporting is a later decision. Scoped adapter-owned handles can offer
the same behavior without public defer; syntax exposure remains a proposal.

Contract example: CalculateSpeed's success type is Speed and failures inferred from division;
SaveTrip propagates these plus update's WriteFailure. A local DivisionByZero handler removes that
case while other modeled failures retain their identity and flow to an installed default. No
per-expression try marker or visible Speed|Error union is required by the proposed failure-effect
model. Optional native fails annotations may restrict inferred failure groups, while foreign heads
must publish their failure contract; this native annotation spelling remains unselected. An action
value's signature must carry the contract when passed as a callback, rather than erase it to action().

### Selected coverage direction

The Developer accepts mandatory modeled failure coverage with inferred typed effects, partial local
handlers/propagation, and installed typed default roots. This does not implement or promise a complete
proof about arbitrary foreign code, host termination, or every reactive availability alias. Whole
decision-dialogue progress estimate approximately 76%. Cleanup and unified presentation details remain
open. The Developer favors defer when cleanup intent cannot be inferred.

## S47 — app guard integration, explicit cleanup, and minimal app

Read-only continuity check: the separate chat "Take over staged-release QA" is implementing the
app-scoped read guard with safe Context.Message. Verified its Next amendment at
/Users/ro/.codex/worktrees/e1bb/tao-lang-2/Apps/WordFlower/2 - Next/WordFlower.tao-next:48: guard belongs
to app, a variant replaces named cases only, and ReadContext fields are optional when unavailable.
This task does not edit or message that chat. The current checkout still implements a project-level
read-only net; do not claim the in-progress work already catches action failures.

Recommendation: reuse app guard for default presentation of reads, action failures, later receipts,
and cleanup failures. This requires new routing/typed presentation context, not merely moving the
read block into app scope. Read branches render at the unavailable region; action/receipt failures
render in an owned dismissible notice host without replacing the healthy screen. Local then handlers
decide recovery/control flow. Retire the proposed additional on failure hook unless a distinct
side-effect/observation need later justifies it. Raw contexts remain specific to their sources while
shared error presentation has a safe Message and optional factual metadata; do not promise unimplemented
reason/retry fields or unify loading with a failed action. These integrations remain proposals.

Cleanup intent is not inferable from an ordinary file value. An explicitly scope-owned TemporaryFile
contract or callback-based WithTemporaryPDF API can guarantee cleanup as part of that API; a normal
CreateFile returning File makes no such promise. Scoped APIs require lifecycle/escape rules and may
be implemented in trusted adapters. Recommend general defer for explicit cleanup intent, with scoped
library helpers later. No automatic ownership/cleanup analysis is selected solely by this example.

Next five questions, all recommendations pending:

1. One app guard presentation policy across read/action/receipt/cleanup failures versus separate read
   guard and on failure hook; recommend shared presentation, retaining operation-local recovery.
2. Inline unavailable-read fallback and scoped dismissible action/receipt notices versus replacing
   the whole screen for all failures; recommend source-specific placement.
3. defer belongs to the innermost lexical block and executes LIFO on normal/failed/cancelled exit,
   waiting for joined work to stop using the resource; alternative action-wide Go-like scope.
4. Preserve a primary failure and append cleanup failures. If the main work completed but cleanup
   fails, complete the overall operation with a stage-tagged cleanup failure and preserve completed
   external-effect facts; alternative success plus separately reported cleanup warning. Recommend
   typed failed completion, no silent failure or retry of already successful remote work.
5. completed means invocation success, error covers modeled failures with named-case precedence,
   cancelled is separate, and otherwise remains literal catch-all; alternative otherwise as success
   only. Recommend explicit outcomes; do not treat completion as remote acceptance generally.

The following one-file application module is prospective, not executable with today's grammar.
@example/reports is a hypothetical typed domain package exporting the schema, datasource, units of
work, and complete I/O failure contracts. UploadFile(Report, File) is explicitly idempotent per report
and completes only after server acknowledgement and release of the file. The app itself does not
promise general distributed rollback. Built-in read states/fault containment remain installed; the
app replaces only loading/error presentation. Generalized action routing and defer follow the next
round's recommended options, not selected implementations.

```tao
use Col, Button, Spinner from @tao/ui
use Reports, Report, ReportStore, CreateTemporaryPDF,
    DeleteTemporaryFile, UploadFile from @example/reports

app ReportsApp {
   Datasource ReportStore
   view ReportsView
   guard {
      loading Context -> { Spinner }
      error Context -> { "{Context.Message}" }
   }
}

action UploadReport(Report) {
   let File = do CreateTemporaryPDF(Report)
   defer { do DeleteTemporaryFile(File) }
   do UploadFile(Report, File)
}

view ReportsView {
   query Available = Reports with { limit 20 }
   render Col {
      guard Available
      if Available is empty { "No reports yet." }
      loop Available / Report {
         "{Report.Title}"
         Button("Upload") {
            on press -> do UploadReport(Report)
         }
      }
   }
}
```

Initial read failures go through the guard/net; missing/unauthorized retain library defaults; empty
is ordinary UI. Temporary PDF creation, upload, and cleanup failures propagate to the owned app
notice presentation, and unexpected adapter faults go to installed containment. defer registers only
after successful creation, runs after joined use finishes, and does not undo remote upload. Late
datasource write rejection requires owned receipt handling regardless of action completion; this
example does not introduce a queued mutation. No generic catch branch is required per button because
the compiler knows the installed defaults cover the domain package's published failures. The app
does not demonstrate every error type in existence or a verified runtime guarantee; it illustrates
coverage of its own contracted operations with minimal application boilerplate.

## S48 — selected defer/import forms and failure-guard vocabulary

The Developer selects S47 2A/3A/4A and the success word `done` instead of `completed`. Record
source-specific presentation, lexical LIFO cleanup after joined use, preserved primary/cleanup
failures, and successful external-effect facts. S47 item 1 remains a vocabulary/design question.
`defer Invocation(...)` is exact shorthand for `defer { do Invocation(...) }`; both register work
without executing it. Capture timing, cleanup suspension, and cancellation shielding remain open.
`use all from Package` is selected; public scope and collision rules remain open.

Current-source check: TR.GuardRender checks explicit subject branches even for available content,
and an empty list is available. Bare guard therefore falls through on empty; an explicit empty branch
renders its fallback and stops the enclosing render remainder. Current grammar requires a branch
block: `guard Available { empty -> { Text("No reports yet.") } }`. The atomic string form below is
a proposed extension, not current syntax. A string plus optional styling has a bounded expression;
do not extend that claim to unrestricted unbraced render sequences.

Recommend failure matching by stable typed cause/case or family, with generic error for the remaining
modeled failures. Keep source/origin as factual context metadata, not a separate action-exception
type hierarchy: permission/network failures can originate from reads, actions, receipts, or cleanup.
Availability branches such as loading/empty are not all failures. Local then recovery/control flow
and app guard presentation remain distinct. Context.Origin below is proposed typed metadata, not
a field promised by today's read context. Unexpected runtime defects retain fault containment.

```tao
guard {
   StorageFull Context -> { "Free some space and try again." }
   error Context -> {
      when Context.Origin {
         action -> { "Could not finish: {Context.Message}" }
         otherwise -> { "{Context.Message}" }
      }
   }
}
```

Updated minimal prospective app (same hypothetical package contracts as S47):

```tao
use all from @tao/ui
use all from @example/reports

app ReportsApp {
   Datasource ReportStore
   view ReportsView
   guard {
      loading Context -> { Spinner }
      error Context -> { "{Context.Message}" }
   }
}

action UploadReport(Report) {
   let File = do CreateTemporaryPDF(Report)
   defer DeleteTemporaryFile(File)
   do UploadFile(Report, File)
}

view ReportsView {
   query Available = Reports with { limit 20 }
   render Col {
      guard Available { empty -> "No reports yet." }
      loop Available / Report {
         "{Report.Title}"
         Button("Upload") { on press -> do UploadReport(Report) }
      }
   }
}
```

Next questions: cause-first versus origin-first guard selectors; exact/family/fallback precedence;
wildcard collision handling; suspending cleanup and cancellation shielding; capture semantics common
to both defer forms. Recommendations are cause-first with origin metadata, most-specific matching
with equally specific overlaps rejected, public-only wildcards with ambiguous uses diagnosed,
joined suspending cleanup shielded from ordinary cancellation, and ordinary lexical closure capture
(immutable let for snapshots; mutable values read when cleanup executes). None of these detailed
recommendations is selected by recording this round. No compiler/runtime implementation or tests.

## S49 — selected failure/import/cleanup rules and reopened guard default

The Developer accepts the compact string branch and S48 1A/2A/3B/4A/5A. Select typed failure
cause/family matching with factual origin metadata; exact case before family before generic error,
equally specific overlaps rejected; public wildcard imports with immediate collision errors including
unused conflicts; suspending joined cleanup shielded from ordinary cancellation; ordinary lexical
closure capture in both defer forms. Immutable locals provide snapshots when mutable input must be
captured at registration. Process termination remains outside guaranteed cleanup.

The Developer questions the bare guard's current omission of empty, and proposes stopping the
enclosing block on any match with an unqualified catch-all. Matched render guards already stop the
remainder. A literal all-state catch-all would also stop healthy rendering, so recommend defining the
unqualified forms as catching any condition that prevents usable nonempty content, rather than every
possible state. This default change remains a proposal, not accepted behavior or implementation.

```tao
guard Available -> "No reports available." // Proposed: empty or absent/unavailable content.
loop Available / Report { "{Report.Title}" } // Continues only with usable nonempty content.

guard Available {
   empty -> "No reports yet." // Selected compact spelling; any match stops render remainder.
   missing -> "This report no longer exists."
   error Context -> "{Context.Message}"
}
```

Under the proposed default, bare guard applies installed presentation for unavailable/absent content
and emits no node for ordinary empty/none; an arrow fallback supplies one replacement for all those
blocking conditions. Specific local branches replace selected cases; remaining blocking conditions
still reach installed defaults, never silently authorize unavailable member access. Usable retained
content during refreshing/stale continues unless explicitly intercepted. Zero and no are real values,
not generic emptiness/truthiness. Item missing-target status, optional none, and known empty content
remain distinct explanations despite sharing a default guard response. Guard fallback is reactive,
not a permanent stop after one failed observation. Its exit applies to the current render remainder,
not the whole app or an arbitrary action scope. Default policy remains to settle before implementation.

## S50 — current guard vocabulary and orthogonal absence/content/acquisition axes

Read-only source inventory: FunctionalCoreValidator.allowedCases permits text/list empty;
query empty/loading/refreshing/stale/error; entity loading/missing/unauthorized/error;
boolean true/false (yes/no canonicalize to those); and a declared enum's own cases. The shared read
net permits only loading/missing/unauthorized/error. Runtime entity available and query ready are
internal statuses, not accepted guard branch names. None is a core absent value, not a supported
guard case; optional union subject guards are currently unsupported. Otherwise belongs to when,
not current guard cases. Done/cancelled and named action-failure guard routing are prospective.

There is no guard-case inheritance hierarchy. Grouping words into availability, content, failure,
boolean, and enum categories is explanatory. Query empty may overlap refreshing or stale; a flat
exclusive status tree would be misleading. Recommend typed metadata axes instead: optional presence,
content emptiness, acquisition/freshness, and typed failure cause. Typed failure families can have
their own selected specificity hierarchy without making all guard states descendants of error.

Keep the meanings distinct: none means no assigned optional value; empty means a present text/list
with zero characters/elements; missing means an entity handle identifies a target with no resolvable
row after the lookup/loading opportunity is exhausted. Loading is not missing. A cleared reference
is none, while a retained reference to a deleted target is missing. Current required-field validation
uses ordinary English "missing" to include none/empty; that wording is not the missing subject case.

Reconsider S49's still-unselected nonempty-by-default recommendation after this separation:
recommend guard's ordinary continuation precondition be an available/present usable value, allowing
valid empty text/lists. Use when/if for ordinary empty/refreshing/stale/boolean UI. An explicit empty
guard can still intentionally require nonempty content and stop the render remainder. Loading and
known absence belong to guards despite not being failures, because they block required value access.
An alternative is S49's broader usable-nonempty default, with explicit when required to preserve empty
content. Neither default policy is selected yet. No language/runtime implementation or tests.

## S51 — not-found versus integrity failure, simultaneous UI, and freshness

The Developer accepts S50's available/present continuation direction, allowing empty content, with
public missing versus none still to consider. They ask about InstantDB integrity, typed metadata axes,
all-match rendering, and stale timing. No new multi-match/freshness/absence vocabulary is selected.

Current source: TR-data-schema.availability reports missing for absent retained rows, inactive
generations, and unresolved reference placeholders after loading/fill has exhausted. A selected
handle can become missing after remote deletion without any stored relation violating its schema.
InstantDB.ts enables allowAbsentRelations for authenticated stores because linked rows may not be
readable by that account. instant-rows.resolveRelations clears absent optional relations, filters
required rows with no link, and may preserve an unreadable required target identity when authenticated.
Do not equate no visible row with proved deletion or expose permission-protected existence.

Current adapter schema mapping makes scalar attributes server-optional and does not generate
required forward links; Tao completeness and relationship validation are distinct from native
Instant required constraints. Official current Instant documentation supports required attributes
and required forward links (https://www.instantdb.com/docs/modeling-data), but requiredness does not
guarantee an arbitrary ID from navigation still exists. Deletion clears associations by default
(https://www.instantdb.com/docs/instaml). These are source/documentation observations, not new tests.

Recommended simplification to investigate: public none for expected absent optional value/lookup;
typed NotFound failure when an operation promises an existing value; typed schema/integrity failure
when a required field/link is actually absent. Preserve factual reason/subject identity in metadata,
not necessarily a top-level missing keyword. Auth-filtered targets remain unavailable/permission
cases when known, and otherwise non-disclosing absence; lack of returned data alone cannot prove
a corrupt required relationship. Public missing removal remains open, not a selected rename.

Keep convenient predicates over independent typed metadata. status of Subject returns the typed
observation; availability/content/fetch/freshness axes are drill-down fields (exact field layout open).
No guard availability Subject prefix is necessary merely to express these predicates. A multi-match
UI need is already expressible using independent if blocks alongside single-choice when:

```tao
render Col {
   guard Reports
   if Reports is refreshing { Spinner }
   when Reports {
      empty -> "None"
      otherwise -> ListView(Reports)
   }
}
```

A future when all predicate block could compact independent branches, but needs stable-observation,
source-order, fallback, and failure-coverage contracts. In an all-match block available must include
empty: guard availability and a complete empty result are compatible. An available -> ListView arm
therefore overlaps empty; require the list arm's nonempty condition when both should not render.
Do not silently change ordinary when to all-match or overload ordinary boolean if into case selection.

Current TR-data-schema query Stale is exactly failed fill plus prior filledAtMs; Refreshing is active
fill plus prior filledAtMs. No age threshold or automatic disconnect rule. Instant subscription
failures use provider error handling rather than proving the HTTP/query-fill stale semantics apply.
Recommend freshness be a typed provider/query policy: expired, explicitly invalidated, or failed
revalidation. Successful revalidation establishes fresh data; no implicit zero freshness duration.
Offline/connectivity, failed fetch, and freshness remain separate metadata. A future max-age policy
belongs in query/provider configuration, with spelling still open. TanStack's staleTime/invalidation
is comparative prior art, not a selected default (https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).
No language/runtime implementation or tests.

## S52 — remove public missing, defer state reorganization, and next round

The Developer selects removal of public missing and requests a pre-MVP review of entity-handle/query
states with the discussion context. A24/R19 and their Review brief own that investigation. Expected
absence uses none; a failed promised existence/required-data contract remains a typed failure.
Retain factual metadata and privacy boundaries. This supersedes historical missing sketches without
rewriting current implementation/specs or silently renaming every internal runtime status.

The Developer asks whether ordinary when should always execute every matching case. Recommendation
remains single-choice by default, with optional explicit when all for additive rendering, not selected.
An expression must otherwise reconcile multiple scalar result values, a predicate action can perform
both specific and generic side effects, and typed failure family handlers can overlap. A proposed
all-match renderer must define stable observations, declaration order, fallback, failure coverage and
its result type. Single-choice default leaves these requirements explicit rather than context-dependent.

```tao
let Fee = when {
   Total >= 100 -> 0
   Total >= 50 -> 5
   otherwise -> 10
}
// At 120, both predicates are true. Single-choice yields 0; all-match needs another result contract.
```

Next five recommended decisions, all still pending: (1) ordinary single-choice when with opt-in
all-match rendering versus universal all-match; (2) distinct wall-clock Time and MonotonicTime domains
with no cross-domain subtraction versus one tagged Time; (3) cancellation while Wait suspends unwinds
the cancelled action context and runs cleanup versus returning normally and continuing; (4) long
finite Wait spans multiple bounded host timers versus rejecting waits beyond one host timer;
(5) positive fractional waits round up to host-supported granularity versus rejecting them.
These are language-library/scheduler semantics, not authority to implement them. Unit-view/arithmetic
and nonpositive Wait choices remain selected; do not reopen them just to add these questions.

## S53 — pick/when split, selected Wait behavior, and clock semantics

The Developer selects single-value-producing pick and multi-match when, plus S52 3A/4A/5A:
cancellation unwinds the cancelled action context with cleanup; long finite waits span bounded host
timers; positive fractional waits round upward to supported granularity. Execution after termination
and exact callback arrival are not promised. These are future contracts, not implemented features.

Current source correction: there is no all-matching when execution. Render WhenRenderStatement and
value WhenExpression select one lazy branch. Outside rendering, action when do invokes one operation
and selects one handler in TR-effect-outcomes, rather than executing every matching outcome. General
action-statement when is not currently a grammar alternative. Selected migration is value when ->
pick, additive statement/render when, and when do -> do ... then (single invocation outcome).
Preserve selected most-specific app failure-guard dispatch.

Proposed useful non-rendering multi-match example:

```tao
action Notify(Report) {
   when {
      Report.NeedsEmail -> { do EmailReport(Report) }
      Report.NeedsPush -> { do PushReport(Report) }
   }
}
```

Whether actions admit this, when conditions are captured, fallback behavior and interruption on
failure remain decisions. Recommendation: action use is allowed, matching conditions are observed
before effects start, bodies join sequentially in declaration order, and an unhandled failure stops
remaining branches with ordinary typed propagation. A local handler can consume a failure. A stored
observation does not authorize a later live read across suspension; A22's proof limits remain.

Time for monotonic affine points and DateTime for wall-clock instants is coherent; Timer should name
a measuring/countdown object, not a clock reading. Neither naming alternative is selected yet.
Time-Time -> Duration retains the signed affine difference rule within one clock origin. DateTime
comparisons/differences can reflect wall-clock correction; timezone display changes do not alone
change an absolute instant. Monotonic readings are not portable persisted instants across reboot,
devices, or independently created clock origins. Origin/lifetime and sleep-counting policy remain open.

Verified external support: W3C performance.now uses a monotonic clock not subject to system/user
clock corrections (https://www.w3.org/TR/hr-time-3/). Android elapsedRealtimeNanos guarantees monotonic
measurement including deep sleep (https://developer.android.com/reference/android/os/SystemClock);
Apple mach_continuous_time is monotonic including system sleep
(https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time). Host backend must be
chosen/verified explicitly; do not infer the guarantee merely from a JS method name. Current Tao
RuntimeClock.now uses Date.now outside virtual tests, so it is not this proposed monotonic API.
Sleep inclusion and suspend/resume acceptance need target-specific proof, especially web behavior.
Do not substitute a wall clock clamped against prior readings and claim accurate elapsed measurement.

Next five proposals: Time/DateTime naming; allow when in actions; capture branch-match observation
before effects; stop remaining action branches on unhandled failure; whether elapsed measurement
includes device sleep. Recommendations pending. No implementation or language tests.

## S54 — timer-oriented clock API and snapshot all-match sequencing

The Developer replaces the proposed monotonic-point API with:

```tao
let Timer = Time.StartTimer()
do Wait(2 Seconds)
let Duration = Timer.Duration() // Typed Duration measured monotonically.
let CreatedAt = Time.Now()      // Wall clock.
```

These clock/timer calls are ordinary synchronous functions, not do actions. Time is the API owner;
returned wall-clock type remains open (recommend DateTime). Timer.Duration retains typed units and
canonical backing, not an untyped host number. Host clock corrections do not affect its elapsed
measurement. S53 2A/3A/4A/5A selected: when is permitted in actions; matching observation is captured
before bodies; bodies join sequentially; unhandled failure stops remaining bodies; elapsed clocks
include device sleep. A timer/deadline must recheck elapsed time after resumption, not deliberately
wait an old remaining duration once the deadline passed. Execution while suspended is not promised.

The Developer's lowering analogy is accepted for matching:

```text
observation = captureMatchingObservation(evaluate(Val))
matches = evaluateAllCases(observation)
if matches[0]: execute body 0
if matches[1]: execute body 1
...
```

Matching uses one frozen observation. A preceding body cannot change later matches. This does not
add a public Val.snapshot field, copy a whole linked entity graph, or freeze live authority. Pattern
metadata/payload values are captured for matching; body expressions explicitly reading live handles
remain live and validated. An effect that suspends does not preserve authority to dereference a
previously available entity. Coherent resource observation details remain in A24/A22.

Recommendations for the next five, all pending: when otherwise is optional and runs only when no
case matched; pick must prove total coverage, allowing omission of otherwise only when proven;
Time.Now returns a DateTime absolute instant, with timezone as presentation; Timer is scoped to its
runtime clock origin and cannot be persisted as a portable timestamp; Timer.Duration returns a
sample at the moment of the call rather than installing an implicit UI ticker. App-lifecycle and
reactive timer construction/refresh affordances remain to review before implementation. Do not
silently add Pause/Reset/Stop merely because the type is named Timer. No tests/implementation.

## S55 — fixed Timer.Stop, DateTime and fallback review

The Developer selects S54 2A (pick must prove total coverage) and 3A (Time.Now returns a DateTime
absolute instant; timezone is presentation). Otherwise can be omitted from pick only when static
exhaustiveness is proven. This is independent of multi-match when's optional fallback.

The Developer explicitly replaces the earlier Duration sampling proposal with:

```tao
let Timer = Time.StartTimer()
do Wait(2 Seconds)
let Duration = Timer.Stop() // Stops measurement; fixed typed Duration, not live.
let CreatedAt = Time.Now()  // DateTime.
```

Repeated Stop behavior and runtime-origin/lifetime/persistence remain open. The Stop choice does
not implicitly accept S54's nonpersistent-timer proposal. A separate requested design todo covers
[Time.Live](../Time.Live%20API.md), time that stays up to date; no MVP priority was selected.

### Does multi-match when need otherwise?

Recommendation under discussion: retain it as optional. No ordinary matches and no fallback means
no rendered nodes/actions. Otherwise runs once only when no ordinary case matched the original
observation; it is not recovery for a matching body that fails.

```tao
when {
   Document.HasPreview -> { Preview(Document) }
   Document.HasTranscript -> { Transcript(Document) }
   otherwise -> "No preview is available."
}

when {
   Recipient.EmailEnabled -> { do SendEmail(Recipient) }
   Recipient.PushEnabled -> { do SendPush(Recipient) }
   otherwise -> { do RequestContactMethod(Recipient) }
}
```

Both ordinary branches can run. Fallback avoids duplicating the conjunction of all their negations,
and stays the complement when another ordinary branch is added. It remains expressible without a
dedicated fallback; convenience is the reason to keep it, not additional expressive power.

Current-source audit: WordFlower Current @ui/Shell.tao uses empty/otherwise to omit/show FocusBar;
HNReader.tao uses empty/otherwise for no comments versus CommentRow loop, after a read guard.
Neither requires a fallback keyword: explicit complementary cases suffice while retaining read
protection. WordFlower Current @ui/Focus.tao uses value-producing when for paused/running remaining
time; that migrates to exhaustive pick, not additive when. These current implementations choose one
branch and do not establish the future all-match semantics. No implementation or tests.

## S56 — none fallback, fixed elapsed samples and rolling questions

The Developer selects `none -> ...` instead of otherwise for when's no-matching-cases fallback.
It is optional, runs once only on zero captured ordinary matches, and is not failure recovery.
The collision with absent-value matching and extension of the spelling to pick are explicit open
questions below; no repository-wide token replacement is implied.

The Developer restores Timer.Duration, replacing S55's Stop proposal:

```tao
let Timer = Time.StartTimer()
do Wait(2 Seconds)
let First = Timer.Duration() // Fixed elapsed sample.
do Wait(1 Seconds)
let Second = Timer.Duration() // Later sample; First has not changed.
```

Measurement continues; neither a sample nor its use in UI creates a ticker. Time.Live remains a
separate design todo. The Developer requests a rolling queue of five outstanding questions: replace
each settled item with another open item in the next reply, retaining stable question identities for
unanswered items. When fewer than five genuine decisions remain, report that rather than inventing
questions or reopening settled decisions.

### Outstanding queue — recommendations pending

1. Q1 — Distinguish no-match fallback from absent subject: recommend bare `none ->` as fallback,
   `is none ->` as a subject absence predicate. Alternative: prohibit the subject form for optional
   values and require condition-form when with `Value is none`.
2. Q2 — Pick fallback spelling: recommend `none ->` there too, with Q1's distinction; alternative
   retain otherwise for pick alone. Exhaustive pick without fallback is already selected.
3. Q3 — Timer lifetime/persistence: recommend runtime-only handle; store DateTime for persisted
   timestamps, Duration for captured elapsed amounts. Alternative: explicitly designed resumable
   timer records with separate restart semantics, not a serialized monotonic origin.
4. Q4 — View ownership: recommend explicit `state Timer = Time.StartTimer()` for one timer per
   mounted instance, with construction in actions/ordinary scopes allowed; alternative introduce
   a dedicated lifecycle timer binding. Reading a fixed sample does not schedule render updates.
5. Q5 — DateTime arithmetic: recommend DateTime + Duration means exact elapsed addition and
   DateTime - DateTime returns signed Duration; local-calendar additions use separate library
   operations. Alternative require named methods for absolute-instant arithmetic too. A 24-hour
   Duration need not land at the same local time tomorrow across daylight-saving changes.

No compiler/runtime implementation or language tests.

## S57 — restore otherwise, selected timer ownership and defer remaining time API

The Developer's “1,2 Back to other ways” is read as restoring otherwise for both when and pick;
this matches the preceding question about otherwise versus none. Otherwise is fallback, none is
ordinary optional absence. This supersedes S56's temporary fallback spelling and removes the need
for special absent-case syntax. All-match when otherwise remains optional and fires only on zero
ordinary snapshot matches; total pick may omit fallback only when exhaustive.

Q3 A and Q4 A selected: timers are runtime-only, nonpersistent handles; use DateTime for stored
timestamps/deadlines and fixed Duration for elapsed amounts. A view can initialize
`state Timer = Time.StartTimer()` once per mounted instance, retaining it on rerender. Remount
creates another; fixed sampling creates no live subscription. Timer.Duration remains the selected
fixed per-call sampling API and does not stop measurement.

Q5 is deferred, not answered: the remaining time API, including DateTime arithmetic and Time.Live,
is assigned to pre-MVP A25/R20 with the [modern-library review brief](<../../MVP Roadmap/Review - Dates and time APIs.md>).
Preserve selected contracts, review current official library designs, and return typed forcing
examples and MVP recommendations before implementation. No time arithmetic policy is silently selected.

### Outstanding queue — five replacements, recommendations pending

- Q6 — Multiple renderer binders: recommend `@item (Book, Occurrence) -> BookRow(Book, Occurrence)`,
  retaining `@item Book -> BookRow(Book)` for one binder. Alternative comma-separated unparenthesized
  binders; prototype boundaries rather than relying on semantic resolution to parse them.
- Q7 — Duration-role construction: recommend `let AnimationDuration 150 Milliseconds` invokes the
  explicitly declared Duration-to-AnimationDuration constructor/conversion, preserving canonical
  value, view and validation. It is explicit construction, not automatic narrowing. Without such
  authorization diagnose it. Alternative require the longer explicit as spelling for typed operands.
- Q8 — Optional native fails annotations: recommend a closed upper bound checked against inferred
  modeled failures, analogous to optional returns restricting an inferred result. Alternative make
  the annotation an open minimum and add any other inferred effects. Bodyless/foreign callable
  contracts still publish their failure contract; unknown sets never mean empty.
- Q9 — Structural capability method visibility: recommend only methods accessible at the conformance
  check satisfy the contract; hiding a method must not accidentally expose it through an inferred
  capability. Alternative allow nonpublic implementation methods through a public capability adapter.
  Explicit authored public adapters remain an escape hatch for the recommended policy.
- Q10 — Operator availability: recommend exported operand/result types bring their attached public
  operators into scope, with unique resolution and conflicting applicable definitions diagnosed.
  Alternative require separate explicit operator imports. Keep the selected owning-package rule;
  this question does not authorize foreign global operator injection or import-order selection.

The rolling queue retains Q6–Q10 until answered, replacing settled items with new genuine decisions.
Design documents only; no compiler/runtime implementation or tests.

## S58 — binder formatting, explicit roles, fails bounds and attached operators

Q6 selected: accept both parenthesized and bare comma-separated slot binder lists; canonicalize to
bare binders unless that introduces ambiguity. For simple names, the arrow terminates the binder
list. Grammar/formatter prototypes still need to verify this and retain parentheses for any
extended form that cannot safely elide them.

Q7 conditionally selected A: a separate AnimationDuration is not required for ordinary animation.
It is useful for a meaningful distinct role or enforced constraint (e.g. a checked nonnegative
animation length, while generic Duration remains signed). The preferred explicit role construction
uses its authorized constructor/conversion, preserves canonical duration and unit view, and retains
any checked-construction failure. A validating constructor is not automatically a total as converter.
Do not manufacture separate nominal types merely to demonstrate syntax.

Q8 A selected, plus bare `fails` is a closed empty propagated-failure bound. Native omission retains
inference; an annotation must cover every propagated modeled failure. Local handling can remove
effects, but a caller's default cannot make the callee's empty bound valid. Runtime faults/foreign
unknown contracts remain distinct and are not proven impossible by this syntax.

Q10 A selected: associated exported operators accompany imported operand/result types, with
owning-package checks, visibility and unique resolution; conflicts error rather than depend on
import order. No separate operator import syntax required.

### Q9 — visibility clarification, still pending

Current source has file/folder/package/workspace/public declarations, with top-level product
functions. It does not implement associated methods or a private keyword. Grammar evidence:
packages/language/parser/parser-grammar/{visibility,expressions,types}.langium and the Product
functions section of Docs/Spec/Tao Type System.md. Earlier “private method” means a proposed
nonpublic associated implementation, not a shipped facility. Example is prospective:

```tao
// Library file.
public can Summarizable { Summary() -> text }
public type Note is text with {
   file func Note.Summary() { return Note as text }
}
public func Summarize(Value Summarizable) { return Value.Summary() }

// Consumer file.
use all from @notes
let Note "Hello"
Summarize(Note) // Recommended A: error, required method is inaccessible here.
// Fix in library: public func Note.Summary() { return Note as text }
```

A remains recommended: only accessible implementations count at structural conformance checks;
publish the method or an explicit adapter. B permits a public capability to route to a hidden method
without exposing direct calls. No new private spelling is proposed. Other public/inherited matching
implementations must still be considered; this example assumes none supplies Summary.

### Rolling queue — Q9 plus four replacements, all recommendations pending

- Q11 — Exact renderer forwarding `@item: @item`: recommend the left names the receiving view's
  slot and the right resolves lexically to the outer renderer. No implicit recursive/self binding.
  Alternative require an outer alias whenever names coincide. Signature compatibility is required.
- Q12 — How a type implements ui: recommend an associated view method
  `view Title.Render() { render Text(Title as text) }` satisfying `Render() -> rendered`.
  Alternative an ordinary function must explicitly produce a rendered value. Preserve reactive
  rendering, lexical captures, occurrence identity and lifetime rather than eagerly caching nodes.
- Q13 — Public converters: recommend bringing associated exported explicit converters into scope
  with their source/target types, like operators; conversion still requires explicit syntax where
  implicit conversion is forbidden. Conflicting applicable implementations error. Alternative
  require a separate explicit import for every converter. No foreign private access is authorized.
- Q14 — Bodyless capability failure contracts: recommend omission of fails means no modeled
  propagated failures, allowing a compact pure contract; declare nonempty failures where intended.
  Alternative require an explicit fails clause even for the empty set. Native bodies remain inferred
  on omission; bodyless contracts have no body from which to infer. Unknown foreign effects cannot
  be claimed empty merely by omitting their contract.

Approximate decision completion 87%; design documentation only, no implementation/tests.

## S59 — shared method visibility and explicit/unknown failure contracts

The Developer replaces the five-question cadence with a rolling queue of seven outstanding
questions for the remainder. Preserve unanswered IDs, replace settled items in the next reply,
and report when fewer than seven genuine decisions remain rather than manufacturing questions.

Q9 selected replacement: associated methods have no visibility markers. If the owning type is
visible, its methods are visible. Existing top-level declaration visibility remains useful for
implementation helpers; the rejected file-qualified associated-method example is historical only.
Q11 A (lexical exact renderer forwarding), Q12 A (associated view Render implements ui), and Q13 A
(associated exported converters accompany imported types) are selected. Preserve existing owning
package, uniqueness, explicit-conversion and signature checks; no runtime implementation is claimed.

Q14 replacement supersedes bare fails as the empty bound:

```tao
can SafeDisplay { ToText() -> text fails never }
can CheckedDisplay { ToText() -> text fails FormattingFailure, UnsupportedLocale }
can Display { ToText() -> text } // Unknown/open failure contract.

type Note is text with {
   func Note.Summary() { return Note as text } // Effects inferred when provable.
}
```

Never here denotes an empty propagated failure set, not a bottom type. Declared sets remain closed
bounds; inferred sets carry the known contract when the compiler can prove one. No declaration and
no provable inference means unknown, not empty. Bodyless can signatures have no body to infer from.
Local handling may remove propagated effects; a downstream default does not make a callee's
fails-never annotation valid. General bottom types and conversion bans stay deferred A23/R18.
Unknown-failure coverage/substitution and bare fails input syntax are explicit next questions.

### Outstanding queue — seven replacements, recommendations pending

- Q15 — Handling unknown failure sets: recommend allow invocation only with an owned generic error
  handler locally or in installed defaults; enumerated known cases alone cannot prove coverage of
  the unknown remainder. Alternative prohibit invocation until the callable publishes a closed set.
  Cancellation and termination remain distinct; this is not arbitrary foreign-code proof (A22).
- Q16 — Capability compatibility: recommend an implementation's propagated failure set must be a
  subset of the required contract. Never satisfies any bound; known sets satisfy compatible unknown
  requirements; unknown cannot satisfy a closed contract without an adapter establishing that bound.
  Alternative ignore failure contracts during structural matching and rely on caller handlers.
- Q17 — Bare fails input: recommend reject incomplete `fails`, requiring never or listed failures.
  Alternative accept it as input shorthand for fails never and canonicalize explicitly. Do not infer
  an empty contract merely from absence of the clause.
- Q18 — Inherited Self comparison anchoring: recommend specialize Self to each derived nominal type,
  preventing accidental sibling comparisons; explicitly widen to a deliberately comparable shared
  domain where appropriate. Alternative retain the original declaring comparison domain across
  inheritance. Numeric representation alone cannot authorize temperature-unit comparison.
- Q19 — May authored as conversions fail: recommend permit modeled failures using the ordinary
  inferred/declared effect contract, leaving total converters empty; no special try syntax required.
  Alternative reserve as for provably total conversions and use named checked factories for others.
  Explicit syntax alone never proves target validity; no implicit sibling conversion is authorized.
- Q20 — Authored static factories: recommend explicit `static func T.From(Input)` to distinguish
  type-owned construction without a receiver value from bound instance methods. Alternative infer
  static status from absence of receiver use. Generated unit/JS factories remain compiler-generated.
- Q21 — Generic functions requiring one concrete type: recommend an inferred type parameter such as
  `func Earlier(type T Ordered, Left T, Right T)`; T is a compile-time parameter, not a runtime
  argument. Alternative dependent spelling `Right type of Left`; distinguish concrete captured type
  from merely giving both parameters the same existential capability. Both still require explicit
  argument binding when two value parameters share the same type. Final generic syntax is prospective.

Decision estimate held around 87% as inference/unknown and associated-operation seams are made
explicit. No compiler/runtime implementation or language tests.

## S60 — failure-clause order, constrained generics and conversion forcing cases

The Developer places the failure clause left of the result arrow, schematic
`ToText() [fails [X, Y, Z]] -> text`. Ordering is selected; literal versus optional bracket notation
remains Q22. Q16 A (failure-set substitution), Q17 A (reject incomplete bare fails), Q18 A (derived
comparison Self) are selected. As binds tighter than comparisons, so `Width as Length < Height as
Length` is unambiguous cast-then-compare for a meaningful Length comparator. Widening selects its
static comparison domain, not arbitrary representation reinterpretation. Parser prototypes must
preserve typed-unit suffixes and other operator boundaries; do not silently select the entire
arithmetic precedence table. Parenthesize arithmetic results when converting that whole result.

The selected generic declaration is:

```tao
func Earlier where type T is Ordered (Left T, Right T) {
   return pick {
      Left <= Right -> Left
      otherwise -> Right
   }
}
// Multiple constraints: where type T is Ordered, type T2 is Other (Left T, Right T, Foo T2).
```

Type variables are inferred compile-time variables, not nominal aliases or runtime values.
Calls still use explicit role binding when otherwise ambiguous. Exact generic constraint/type
representation lowering is prototype work, not a current parser claim.

The Developer asks for inference through all can fillings, shared root coverage, at least fifteen
realistic conversions and static factory use cases. [Conversion examples and evidence](<Conversion examples.md>)
provides 18 cases, a common failure-family proposal, research precedents, inference boundaries,
one app guard and factory sketches. Q15/Q19/Q20 remain pending rather than taking these questions
as acceptance. Generic app error presentation avoids per-do boilerplate; it aborts the failed action
and preserves healthy content instead of resuming past the failed statement. Existing app-scoped
read guards and effect warnings do not establish generalized routing/static coverage implementation.

Whole-app/per-instance inference can conservatively union reachable method targets, carry latent
effects through capabilities and instantiate summaries per call. It may narrow declared upper
bounds where the actual target/body is proven in the compiled build. Public contracts do not become
globally narrower just because one app uses one implementation. Packages/code reloads and mutable
captures require invalidation and sound lifetime target sets; unknown foreign/open targets remain
unknown. Exact runtime outcome enumeration is not a decidable general guarantee. Q23 concerns the
practical precision strategy; the complete proof investigation remains A22.

The four new questions replace the four selected items while retaining three unanswered ones.

### Rolling queue — seven outstanding questions

- Q15 — Recommended: one owned app generic error guard covers unknown propagated failures, with
  local handlers only for special recovery. Alternative require closed operation contracts before
  calls. See the one-app example; ownership for async roots/receipts must be implemented explicitly.
- Q19 — Recommended after the catalog: allow declared checked unary as conversions to propagate
  modeled validation/representation failures through ordinary effects. Alternative total-only as
  and named checked constructors. Contextual I/O/authorization/business transformations remain
  named operations, not implicit or ambient conversions. Not selected by printing examples.
- Q20 — Static factories: explicit static func T.Factory remains recommended for no-receiver
  type-owned construction, with top-level functions a fully expressive alternative. The concrete
  UUID.Parse, Matrix.Identity and Image.FromRGBA examples show convenience, not logical necessity.
- Q22 — Brackets in failure clauses: clarify whether the requested nested brackets are literal
  syntax. Recommend compact `ToText() fails [X, Y] -> text` and `ToText() fails never -> text`, with
  omission requiring no outer wrapper; alternative literal `[fails [X, Y]]`/`[fails never]` wrapper.
  Ordering is already selected; choosing delimiters does not change effect semantics.
- Q23 — Inference precision: recommend inferred per-implementation/call-site summaries, carrying
  latent effect information through capabilities, with sound whole-app refinement where provable
  and unknown otherwise. Alternative require explicit capability effect declarations for precision.
  Do not make perfect whole-program enumeration a prerequisite for ordinary compilation.
- Q24 — Explicit native result syntax: recommend optional `-> Type` for written function/action
  results, consistent with can signatures; omission still infers results. Alternative retain
  `returns Type` for native declarations while using arrows only in capability contracts.
- Q25 — Conversion failure vocabulary: recommend a reusable typed ConversionFailure family with
  format/encoding/range/precision/constraint reasons plus specific leaves and safe typed metadata.
  Alternative unrelated library-specific conversion failures without a shared taxonomy. Do not
  wrap provider/permission effects merely because they happen during a converter.

Decision estimate approximately 88%; documents/research only, no compiler/runtime changes or tests.

## S61 — Failure syntax, root coverage and refinement scope selected

2026-10-04, design only. Q15/Q19/Q20/Q22/Q24/Q25 A selected. Q23's precision direction is
accepted, with automatic proven compiler refinement explicitly deferred until post-MVP.

```tao
can Display {
   ToText() -> text                    // Unknown failure contract.
}
can SafeDisplay {
   ToText() fails never -> text
}
can CheckedDisplay {
   ToText() fails InvalidEncoding, InvalidFormat -> text
}
// Brackets in S60 meant optional notation; no literal brackets are selected.
```

Optional native result constraints use -> Type, superseding returns Type. Omission infers the result.
Ordinary body/callee inference remains selected. Advanced precision through concrete capability
instances, target sets and whole-program analysis moves to the post-MVP task
[Capability failure refinement](<../Capability failure refinement.md>); A22/R17 remain a separate
pre-MVP investigation of complete proofs. Unknown/open contracts never silently become empty.

One installed app-level generic error guard covers propagated known and unknown modeled failures.
Local handlers express special recovery. Failure aborts the failing action, runs cleanup, and skips
its later statements; presentation does not resume execution. Authored explicit as conversions may
fail through ordinary modeled effects. Shared ConversionFailure categories cover format, encoding,
range, precision and constraints, retaining specific leaves and safe metadata. static func declares
an associated function with no receiver. These are selected future contracts, not implemented checks.

The next seven questions are recommendations, not selections:

| Stable ID | Seam                           | A recommendation                                                                                                                    | B alternative                                                            |
| --------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Q26       | Converter failure clauses      | Source as Target fails X, Y { ... }; target is implicit result                                                                      | Require a named function for an explicitly annotated fallible conversion |
| Q27       | Conversion effects             | Deterministic validation/transformation; modeled failure allowed, no I/O or mutation                                                | Permit arbitrary action effects inside as                                |
| Q28       | Conversion routes              | One applicable declared converter, nearest source ancestor, unique result; explicit intermediate casts for multiple transformations | Search a conversion graph automatically                                  |
| Q29       | Inherited static factories     | Retain declared/inferred return type; no automatic descendant rebinding                                                             | Rebind factory results to descendant Self with validation obligations    |
| Q30       | Type/value qualifier shadowing | Ordinary lexical value lookup wins; import rename preserves access to the type                                                      | Introduce an explicit type qualifier syntax                              |
| Q31       | Multiple generic capabilities  | where type T is Ordered and Display                                                                                                 | Require a separately declared combined capability                        |
| Q32       | Intentional rounding/clamping  | Named library operations followed by checked as; no extra conversion-policy syntax                                                  | Add policy clauses to as expressions                                     |

Q28 allows an existing authorized ancestor-source converter to accept a descendant through ordinary
upward matching; it does not synthesize a new ancestor-to-descendant or sibling conversion. Competing
equally applicable conversions error. Purely widening to an ancestor does not invoke graph search.
Q29 static bodies cannot automatically construct a descendant whose additional constraints they do
not know. Q30 can use the existing import rename surface, e.g. use Matrix as MatrixType from @math;
the caller may then name a value Matrix without hiding MatrixType.Identity. No runtime instance is
required for the static call. These seams need prototypes after selection.

## S62 — Converter and function boundaries selected

2026-10-04, design only. Q26–Q32 A accepted. Q27 is strengthened by the Developer:
converters are functions; functions cannot invoke actions, perform I/O, or suspend in any way.
This is transitive through functions, capability calls and native implementations. Ordinary modeled
validation/computation failure does not itself count as suspension or action invocation.

```tao
type UUID is text with {
   RawID as UUID fails InvalidFormat { ... }
}
// No graph search: explicitly name intermediate transformations.
let UserID = (Input as ParsedID) as UserID

use Matrix as MatrixType from @math
let Matrix = MatrixType.Identity(Size 4)
// Inherited factories retain their result type rather than manufacturing descendant values.

func EarlierLabel where type T is Ordered and Display (Left T, Right T) {
   return pick {
      Left <= Right -> Left.ToText()
      otherwise -> Right.ToText()
   }
}
let Integral = Round(Reading, nearest) as Int32
// Rounding is intentional; target range/constraint checks still apply.
```

Converters have an implicit target result; optional fails clauses follow the target, and omission
allows inference. One applicable declared converter resolves by nearest source ancestor; equal
candidates error. Ordinary upward matching is retained, without synthesized multi-converter paths.
Static factory inheritance keeps the actual return contract. Import renames preserve type access
under ordinary lexical value shadowing. Combined generic capabilities use and. Named library
operations express intentional precision loss rather than adding policy clauses to as.

All seven questions in S61 are settled. Next slice: consolidate the minimal forcing app and audit
it against the accepted contracts before opening further questions. Historical pending wording is
superseded by the numbered selections; it is not evidence that a settled choice needs reopening.
No language implementation or whole-program refinement is authorized by this record.

## S63 — Compact forcing-app coverage review

2026-10-04. Reprint the two imagined files in chat; do not create Apps/Syntax2 or save app source
while the Developer reviews. This is a design fixture, not executable acceptance.

Consolidated coverage: private types exposed through public signatures, descendant admission,
contextual literals, repeated-type input bindings, structural Display/ui, constrained generics,
associated view methods, static factories and lexical import renames; an owned unitless numeric
operator using checked typed JS factories; explicit conversion; typed Duration/Ratio consumers and
unit views; data receivers, collection iteration, optional reads, inverse fields; render sugar,
styles/prefixes, parameterized/default/repeated/forwarded slots; multi-match when and single-result
pick; app error coverage, local recovery, joined action results, cleanup and detached notification.

Hypothetical typed I/O/collection packages stand for adapter/schema validation, bounded query
acquisition, loaded-subset projection, continuation, revision acknowledgment, and flattened grouped
rows. Their names are review aids, not selections of the deferred A24 API. Group rows are reactive
renderable values, not cached rendered nodes; row occurrences own position and identity. Writable
input controls must retain the named target type and validate input, rather than treating upward
value assignability as permission to write arbitrary parent values into a child-typed field.

The read-only coverage audit was checked against Code preferences and Decisions. Inline inverse
fields do not establish a separate named opposite-type pair's polarity-preserving not semantics;
that historical request needs explicit contract review if included in the implementation scope.
Generic comparator calls retain capability failure bounds; the fixture makes no advanced concrete
implementation refinement claim. Clock classification is context for the already-deferred A25
review. Exact scalar-template binding and unit declaration grammar still need a standard-library
forcing sketch rather than invented app syntax. Generic same-T inference must also be reviewed
against the rule that sibling comparisons require deliberate widening; a common ancestor must not
be silently inferred merely to erase the intended comparison distinction.

Conditional next stage requested by the Developer: when decisions are complete, inventory all work
required by selected non-deferred contracts. Plan multiple independent implementation threads where
stable interfaces and exclusive file ownership make parallelism worthwhile, each coordinating its
own sub-agents; otherwise use one coordinating thread. Do not start implementation or create those
threads merely from this future planning instruction. Shared frontend/type/IR boundaries need
explicit sequencing and integration ownership before a parallel fan-out is proposed.

## S64 — Syntax2 future-source implementation target

2026-10-04. The Developer now explicitly requests actual .tao.future files in Apps/Syntax2 and an
implementation task to move working pieces into .tao. This supersedes S63's preceding chat-only
stopping point; it does not claim implementation or authorize silently deciding deferred APIs.
[The app](../../../Apps/Syntax2/README.md) and [implementation task](Implement%20Syntax2.md) carry
the target, provisional adapter contracts, graduation rules, dependency order and candidate parallel
ownership. No implementation threads launched; the current pass creates future source and planning.

New requested preferences: omit redundant owner prefixes in an unambiguous associated with body;
bare core text renders no node when empty, while explicit Text("") preserves one; directly render
values satisfying ui. The fixture uses a bare named-state construction target and retains the lexical
value rule for ambiguous dotted calls. GroupedRows has keyed typed row recipes and a pure TS algorithm
with typed builder callbacks; generated bridge integration remains a required implementation artifact.
Rows retain live Book handles and reactive dependencies rather than frozen data or mounted nodes.
Exact scalar/unit declaration syntax, generic exact-T inference and named opposite Boolean types are
presented as review recommendations. The fixture does not manufacture their acceptance.

## S65 — Unit table spelling and generic ancestry review

2026-10-04. The Developer prefers `units { Seconds (default), Milliseconds 0.001, ... }`
over a canonical unit in the block head, and asks whether explicit `Seconds 1 (default)` adds
meaning. The table form is the preferred prototype target. A unit scale of 1 is redundant when
that unit defines the normalization reference; exact default-view versus canonical-reference
meaning must remain explicit, because changing display preference must not silently change an
established backing/adapter contract. Affine/nonlinear mappings require more than one scale.

The Developer selects unparenthesized directed conversion when unambiguous:
`Earlier(.Left Cool, .Right Imperial as Celsius)`. Parse the selector as owning a complete payload
expression to the argument delimiter; do not apply as to a selected-binding node and lose the binding.
Parser proof remains required. Grouping parentheses are preserved where they change precedence.

Revised generic recommendation, not accepted yet: ordinary ancestor admission is allowed when a
typed argument already supplies the common target T, and T is an ancestor of all other typed inputs.
Celsius/RoomReading can infer Celsius; sibling Celsius/Fahrenheit cannot manufacture Temperature,
and unrelated Price/Weight cannot manufacture number. This is order-independent and chooses the
most specific eligible supplied ancestor. Contextual literals can construct an established T but
do not constitute deliberate parent anchors. Check the chosen T's Ordered/Self contract and resolve
its comparator, rather than invoking a narrower derived comparator with an inadmissible parent input.
Explicit semantic converters still do not run implicitly; their direction, result identity, rounding
and modeled failures otherwise become hidden inference choices. Explicit widening remains available
only into genuinely comparable domains.

Boolean explanation: IsReturned construction preserves the inverse member's yes/no polarity.
ShowReturnStatus(yes/no) can contextually construct IsReturned from raw literals when uniquely matched;
this does not erase nominal identity or admit arbitrary already-typed Boolean descendants/siblings.

## S66 — Selected unit spelling, directed conversion and ancestor inference

2026-10-04. Selected: `Seconds 1 (default)` in the owner unit block, not an omitted reference scale;
no canonical marker now. Meaning-preserving omission of conversion parentheses is canonical.
Sibling semantic conversions stay explicit. S65's revised generic supplied-ancestor rule is accepted,
including order independence and the chosen static target's comparator. Inverse Boolean polarity
and contextual yes/no construction are confirmed. This supersedes the prior strict exact-T sketch.

Next round, five remaining recommendations (not selected):

1. Scalar domain admission: abstract operation family with concrete Self, no direct scalar values
   or arithmetic between erased scalar-family values; use a bounded T for such operations.
   Alternative: scalar is itself a concrete unitless arithmetic type.
2. Unit namespace: owner-qualified unit paths always available; explicitly imported/exported
   shorthand names allowed, ambiguity errors instead of guessing from a callee. Alternative:
   expected-type context chooses an otherwise ambiguous unit name.
3. Key extraction: named structural Keyed capability, pure total Key() -> RenderKey; ordinary data
   handles provide stable identity and custom rows implement it. Alternative: per-list selector only.
4. Lazy key requirements: reorderable lazy lists require unique stable keys; duplicate/unavailable
   keys cause modeled list failure rather than positional repair. Alternative: index fallback.
5. Inverse writes: both member names target one field; reject filling both names in one update even
   if the values appear consistent. Alternative: permit them with a consistency check.

These close current app integration seams rather than reopening detailed deferred A24 state,
localization, time API or complete-proof investigations. The round does not authorize implementation.

## S67 — Five integration choices selected

2026-10-04. All five A selected. Keyed is specifically an ordinary capability used by the exported
standard-library LazyList implementation. It is not a compiler intrinsic, magical RowKey field,
universal loop identity rule or automatic method injected onto every entity. Book.Key and
GroupedRow.Key now expose the contract explicitly; stdlib/Keyed.tao.future records target definitions.
Runtime uniqueness enforcement belongs to the library; structural signature checking belongs to the
ordinary compiler mechanisms. Other components can use different policies. Missing providers and
duplicate identities are rejected, with no index repair.

Scalar is an abstract operation family; unit owners and visible shorthand resolve without expected
type guessing; inverse aliases write the same field and cannot both be filled in one update.
Final integration audit follows. Do not invent another five decisions simply to maintain a cadence,
and do not reopen the general state/time/localization/proof investigations already deferred.
