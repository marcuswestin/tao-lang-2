# Data and render contracts — user stories

Status: exploration, 2026-09-30. This is a review inventory, not an implemented contract or an
addition to MVP scope. The companion [syntax sketches](<Syntax sketches.md>) proposes ways to
express these stories. Accepted language amendments eventually belong in
[Tao Revolution decisions](<../Tao Revolution/Decisions.md>).

## How to use this inventory

Start with end-user outcomes, then developer capabilities, then syntax. Each story has a stable
identifier so a sketch, decision, and eventual behavior test can point to the same requirement.
Review the inventory for omissions before deciding spellings. Combine stories in real screens;
one demonstration per state is insufficient to prove combinations or transitions.

Frequency is a design aid, not a measured percentage or release commitment. Common stories should
have concise expression; advanced stories may require explicit metadata or provider capabilities.
An unsupported capability must produce a diagnostic or explicit unavailable evidence, never a
manufactured assurance such as “fully synchronized.”

## End-user stories

### Obtaining and displaying data

| ID  | As an app user, I want…                                   | Observable acceptance                                                                 | Frequency |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| U01 | An understandable first-load experience                   | Pending content is distinguished from a successful empty result                       | Common    |
| U02 | To understand why loading cannot start                    | Waiting for sign-in, a dependency, or connectivity is explained                       | Common    |
| U03 | Useful content immediately when already stored            | Cached or local content appears without unnecessary replacement                       | Common    |
| U04 | An honest offline experience with no cached answer        | The app asks me to connect instead of claiming there are no results                   | Common    |
| U05 | To distinguish no value, no matches, and a missing object | An unset author, an empty author list, and a deleted author receive appropriate UI    | Common    |
| U06 | Recovery from an initial read failure                     | A useful explanation and eligible recovery action are shown                           | Common    |
| U07 | Refresh without losing my place                           | Existing content, scroll anchor, and relevant local state survive                     | Common    |
| U08 | Useful retained content when refresh fails                | Content remains when policy permits it; the failure is still observable               | Common    |
| U09 | To understand how current information is                  | Age, invalidation, failed refresh, and unusable expiry are not conflated              | Advanced  |
| U10 | Correct search results while typing                       | Prior results are identified; older responses cannot replace newer results            | Common    |
| U11 | Useful portions of an incomplete answer                   | Missing fields or failed portions are explained without inventing values              | Advanced  |
| U12 | To distinguish access restrictions from loading           | Sign-in or permission recovery is offered when the provider supports that distinction | Common    |
| U13 | Safe behavior if my access changes                        | Protected content and edits follow an explicit revocation policy                      | Advanced  |
| U14 | Recovery from storage or schema problems                  | Pending work is preserved where possible; destructive recovery is explicit            | Advanced  |
| U15 | Stable UI during quick transitions                        | Fast loads do not cause unnecessary spinner flicker or remounts                       | Common    |

### Collections, pagination, and composition

| ID  | As an app user, I want…                     | Observable acceptance                                                                      | Frequency |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------ | --------- |
| U16 | A large feed that remains responsive        | Only the needed rendering window is materialized                                           | Common    |
| U17 | More results without losing existing ones   | Next-page progress/failure preserves rows; repeated loads do not duplicate them            | Common    |
| U18 | A clear end of the collection               | Exhaustion is distinguished from unknown continuation and unresolved loading               | Common    |
| U19 | Earlier and later content in a conversation | Loading in either direction preserves the visible anchor                                   | Advanced  |
| U20 | Reliable navigation back to where I was     | Query identity, ordering, cursor or window, and anchor can be restored                     | Common    |
| U21 | Stable paging while records change          | Duplicate, omitted, moved, or removed records follow a declared consistency policy         | Advanced  |
| U22 | Honest counts                               | Loaded count, exact total, estimated total, and unknown total are distinguished            | Common    |
| U23 | Numbered navigation when it is appropriate  | Random access is offered only when supported at an acceptable cost                         | Advanced  |
| U24 | Grouped content with headers and footers    | Group changes and unloaded group portions are handled explicitly                           | Common    |
| U25 | A manageable hierarchy                      | Nested groups can render without accidental nested scrolling                               | Advanced  |
| U26 | Consistent row customization                | Reusable lists can render caller-supplied rows, sections, selection, and position context  | Common    |
| U27 | An explicit response to an expired cursor   | The app can refresh or restart traversal without silently losing my place                  | Advanced  |
| U28 | Reliable selection across loaded windows    | Selection survives recycling and distinguishes selected loaded rows from all matching rows | Advanced  |

### Changes, attention, and live updates

| ID  | As an app user, I want…                                      | Observable acceptance                                                                    | Frequency |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------- |
| U29 | To notice content newly entering the current feed            | Initial hydration is distinguished from subsequent arrivals                              | Common    |
| U30 | To notice relevant updates                                   | Selected visible changes can highlight without reacting to unrelated metadata            | Common    |
| U31 | An unread indicator until I acknowledge content              | The acknowledged revision is recorded; later changes remain unseen                       | Common    |
| U32 | Read state to survive navigation or restart                  | The application chooses and preserves the appropriate observation scope                  | Common    |
| U33 | Read state across my devices when desired                    | Per-user acknowledgment synchronizes with an explicit policy                             | Advanced  |
| U34 | To mark something unread for later attention                 | Manual attention state is independent of factual read position                           | Advanced  |
| U35 | A count of updates since my last visit                       | A baseline and sequence or revision policy determine what counts                         | Common    |
| U36 | Highlights that fade without disrupting interaction          | Presentation timing is separate from acknowledgment and supports reduced motion          | Common    |
| U37 | Live content without missed updates after reconnecting       | Connection and catch-up completion are distinct                                          | Advanced  |
| U38 | My own optimistic changes to be treated appropriately        | Local edits, remote changes, acknowledgments, and rollbacks have distinguishable origins | Common    |
| U39 | Content not to be marked read merely because it was rendered | Off-screen and recycled rows follow an explicit visibility or acknowledgment policy      | Common    |

### Editing, mutations, and recovery

| ID  | As an app user, I want…                                | Observable acceptance                                                                         | Frequency |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------- |
| U40 | My input preserved when submission fails               | Rejected input remains recoverable rather than being silently cleared                         | Common    |
| U41 | Clear draft validation                                 | Incomplete, invalid, validating, and untouched input are distinguished                        | Common    |
| U42 | An accurate save indicator                             | Saving locally, durably queued, remotely accepted, and rejected are distinct                  | Common    |
| U43 | Edits to survive offline use and relaunch              | Accepted local work and its unresolved submissions persist under the provider contract        | Common    |
| U44 | To retry the operation that actually failed            | Retry uses its recorded identity and input; editing and resubmitting is separate              | Common    |
| U45 | A clear response to an uncertain outcome               | The app reconciles whether an operation happened instead of treating uncertainty as rejection | Advanced  |
| U46 | Edits not to disappear when other edits fail           | Rollback or rebase preserves unrelated and later work                                         | Common    |
| U47 | Sensible behavior when concurrent changes conflict     | Automatic merge or a user resolution flow follows declared policy                             | Advanced  |
| U48 | Stable optimistic items                                | Temporary and confirmed identity preserve row state and selection                             | Common    |
| U49 | Safe deletion and undo                                 | Cancellation, rollback, and compensating operations have distinct outcomes                    | Advanced  |
| U50 | Long-running work to remain understandable             | Progress, pausing, cancellation, and background continuation are visible                      | Advanced  |
| U51 | A truthful batch result                                | Atomic success or per-item partial success is shown according to provider guarantees          | Advanced  |
| U52 | Autosave without stale completion messages             | Several submissions and superseded work cannot overwrite newer indicators                     | Common    |
| U53 | Failures to remain discoverable after leaving a screen | Durable work has a lasting owner and recovery surface                                         | Common    |

### Application-wide feedback and accessibility

| ID  | As an app user, I want…                                                      | Observable acceptance                                                               | Frequency |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------- |
| U54 | Local context plus global awareness of significant failures                  | A local error view and an app-level indicator can coexist                           | Common    |
| U55 | No flood of duplicate failure messages                                       | Shared requests, retries, and repeated renders have a deduplication policy          | Common    |
| U56 | Accessible status and progress feedback                                      | Announcements, focus, and motion policy communicate changes without overwhelming me | Common    |
| U57 | Safe and actionable messages                                                 | User-facing wording is separated from diagnostic details and provider codes         | Common    |
| U58 | Successful recovery to clear the right problem                               | Resolving one operation does not hide another unresolved failure                    | Common    |
| U59 | A shared failure surface that cannot recursively fail on the same dependency | Fallbacks remain usable when the failed resource is unavailable                     | Advanced  |

## Developer stories

| ID  | As a Tao developer, I need to…                                                                                               | End-user stories served                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| D01 | Distinguish plain values, optional values, entity handles, query resources, and datasources in types                         | U01–U05, U11                            |
| D02 | Ask typed availability questions without treating empty text or zero as false                                                | U01, U05, U41                           |
| D03 | Inspect initialization, acquisition phase, and structured waiting reasons independently                                      | U01–U04, U15                            |
| D04 | Retain and identify cached, optimistic, placeholder, and previous-query content                                              | U03, U07–U10, U38                       |
| D05 | Declare freshness, invalidation, expiry, and retained-content policy                                                         | U08–U09, U37                            |
| D06 | Handle read failures locally, through a shared fallback, and through additive global feedback                                | U06, U08, U12–U14, U54–U59              |
| D07 | Access structured, typed failure details without depending on one provider's messages                                        | U06, U12, U45, U57                      |
| D08 | Preserve safe access distinctions for absent, inaccessible, incomplete, and unresolved data                                  | U05, U11–U13                            |
| D09 | Obtain compiler coverage of modeled failures and unchecked unavailable field access                                          | U06, U11–U14, U40, U45, U53             |
| D10 | Propagate failure contracts through calls and transfer background work to a lasting owner                                    | U37, U43–U45, U50, U53                  |
| D11 | Compose primary selection and independent advisory indicators without hidden precedence                                      | U07–U09, U42, U54                       |
| D12 | Match structured reasons at increasing granularity with exhaustive fallbacks                                                 | U02, U06, U12, U45, U57                 |
| D13 | Configure a query window separately from how its rows scroll or render                                                       | U16–U23, U27                            |
| D14 | Traverse opaque cursors forward and backward without manufacturing random access                                             | U17–U23, U27                            |
| D15 | Express stable ordering, tie-breakers, traversal consistency, reset, and restoration                                         | U20–U23, U27                            |
| D16 | Inspect window progress, per-page errors, completeness, continuation, and count evidence                                     | U17–U23                                 |
| D17 | Customize repeated rendering using a typed row or group contract                                                             | U24–U26                                 |
| D18 | Obtain position context with explicit scope: loaded window, section, sibling set, or known global index                      | U24–U28                                 |
| D19 | Use nested iteration independently of explicit scrolling and virtualization                                                  | U16, U24–U25                            |
| D20 | Observe identity, revisions, selected fields, membership changes, and change origin                                          | U29–U30, U35, U38                       |
| D21 | Choose observation baseline, persistence scope, acknowledgment trigger, and manual unread override                           | U31–U35, U39                            |
| D22 | Express presentation timers independently of durable attention state                                                         | U30, U36, U56                           |
| D23 | Separate form state from authoritative entities and submission receipts                                                      | U40–U42, U46–U48                        |
| D24 | Bind resolved action values and sequence synchronous or suspending actions directly                                          | U40–U42, U50                            |
| D25 | Handle action outcomes without implying detached execution                                                                   | U40–U42, U45                            |
| D26 | Deliberately detach work and specify its lifetime, cancellation, and failure owner                                           | U50, U53                                |
| D27 | Observe local application, durability, delivery, and authority acceptance separately                                         | U42–U45, U52                            |
| D28 | Inspect and resolve several submissions affecting one entity                                                                 | U44, U46, U52, U58                      |
| D29 | Declare safe retry and reconciliation capabilities instead of inferring them from transport errors                           | U44–U45, U49                            |
| D30 | Choose rollback, retained-draft, merge, and compensation behavior                                                            | U40, U46–U49                            |
| D31 | Respect provider atomicity and expose per-item batch results when necessary                                                  | U51                                     |
| D32 | Express boolean positive and negative poles consistently in fields and parameters                                            | U41 and ordinary application conditions |
| D33 | Supply content slots and callable render slots with arguments and defaults                                                   | U24–U26 and reusable screen composition |
| D34 | Write unambiguous arguments, item literals, bare renders, text renders, slot calls, and event handlers                       | All author-facing sketches              |
| D35 | Test combined states, overlapping operations, reset races, timing, cancellation, persistence, and recovery deterministically | All transition stories                  |
| D36 | Discover unsupported metadata, consistency, and durability through explicit provider contracts                               | U04, U09, U11, U21–U23, U37, U42–U45    |

## Cross-cutting combinations that must be exercised

1. Empty successful result + active refresh + a previously failed attempt.
2. Cached partial result + offline pause + unknown total or continuation.
3. Populated list + next-page failure + independent incoming updates.
4. New search request + displayed previous results + superseded earlier response.
5. Dirty form + remote update + older local submission rejected.
6. One row with a failed submission and another queued submission, including relaunch.
7. Optimistic row + authority acknowledgment + later authoritative transformation.
8. A visible revision acknowledged while a newer revision arrives.
9. A reconnecting feed + changed permissions + cursor invalidation.
10. Local failure UI + additive app feedback + deduplicated accessible announcement.
11. A background operation completing after its originating view disappears.
12. Grouped or nested content with bounded virtualization, stable selection, and anchor restoration.

## Proposed demonstration scenarios

1. **Small master/detail list:** initial load, empty query, absent optional reference, missing entity,
   denied access, local fallback, shared fallback, and additive app feedback.
2. **Searchable paginated feed:** previous query content, next-page error, refresh, unknown counts,
   live membership changes, restoration, and unread/change highlights.
3. **Editable detail:** local buffer, validation, local durability, offline queue, rejection,
   retry versus resubmit, concurrent change, and uncertain outcome.
4. **Grouped timeline:** typed row/group rendering, position context, nested eager composition, and
   an independently bounded rendering window.

These are proposed forcing scenarios. Their use does not add new apps or expand the current MVP
release scope; map the selected first slice onto a real feature before implementation.

## Review and acceptance

- First review: missing end-user outcomes, incorrect assumptions, and frequency classifications.
- Second review: whether each developer story has a clear owner and provider capability boundary.
- Syntax review: compare the common path and a granular version of the same story.
- Implementation review: selected stories have executable Tao behavior tests and provider evidence;
  sketches alone do not establish support.
- Advanced stories may be deferred in implementation, but their representation must fit the direction
  without contradicting the first slice's meanings or spellings.
