# Pre-MVP review — entity handles and query states

Requested 2026-10-04. Investigation task [A29](<Agent MVP Roadmap.md#a29--review-and-reorganize-entity-handle-and-query-states>)
feeds decision [R20](<Developer MVP Roadmap.md#r20--entity-handle-and-query-state-model>).
Design review only: do not implement the state model merely by taking this task. Audit current code,
return a coherent proposed contract with small Tao forcing examples, and settle it with the Developer.

## Purpose

Reorganize entity-handle/query state semantics so application authors can express common UI simply,
inspect precise typed metadata when needed, and distinguish ordinary absence/content from failures.
Current implementation is evidence, not a requirement to preserve its vocabulary or structure.

## Decisions already selected

- Remove the public built-in `missing` state/guard keyword. Current runtime still implements it;
  migration is future work, not an accomplished deletion. Do not mechanically replace every internal
  missing status with none: some represent failed required contracts or inaccessible targets.
- Keep content empty distinct from optional none. Zero and no are values, not emptiness/truthiness.
- Default render guard permits continuation with a present, available usable value, including valid
  empty text/lists. Explicit empty guards may require nonempty content. A matched subject guard
  handles the condition and stops only the remainder of its enclosing render block.
- Allow compact string branches: `guard Reports { empty -> "No reports yet." }`.
- Use pick for single-value selection and when for every matching statement/render case. Action use,
  pre-effect matching observation, sequential bodies and interruption on unhandled failure are selected.
  Otherwise is fallback for both constructs: when uses it only on zero ordinary matches; pick may
  omit it only when exhaustive. Detailed resource snapshot/narrowing contracts remain open.
- Prefer `status of Subject` for typed metadata and ergonomic derived predicates. Exact metadata
  fields, axes, and their types remain open. Every exposed expression/type should have a describable
  written type contract; investigate what generic/system types this actually requires.
- Mandatory modeled failure coverage uses inferred effects and typed defaults; local handlers can
  consume cases or propagate them. Complete foreign/availability/suspension proof belongs to A27.
- Failure cases/families have typed identity with origin metadata. Exact failure cases beat families,
  families beat generic error, and equally specific overlaps are rejected. This selection concerns
  failure dispatch, not a license to change all predicate when matching rules.
- App-owned guard presentation should preserve healthy content: unavailable reads use inline
  fallback, action/receipt failures owned notices. Later receipt failure is not invocation success.
  App-scoped read guard work is separate from generalized action routing; verify live implementation.

## Discussion input — not yet selected designs

1. Expected absence versus failed promises:
   - An optional lookup with no result may return none.
   - An operation promising an existing entity may fail with typed NotFound.
   - A genuinely absent required field/link should fail validation with a typed schema/integrity cause.
   - A provider-filtered target does not prove deletion or corrupt storage. Respect non-disclosing
     permissions: do not invent evidence that distinguishes unauthorized from nonexistent.
   - Preserve subject identity and factual reason as metadata where permitted, without needing a
     public missing keyword. Define how retained handles transition when deleted or scope-invalidated.
2. Independent facets rather than one exclusive status tree:
   - Optional presence, content emptiness, acquisition/activity, availability, freshness, completeness,
     and failure cause are different observations. Empty can overlap refreshing or stale.
   - Distinguish first acquisition, retained content, fetching versus loading/refreshing, queued/paused
     work, retry attempts, cancellation, and unknown freshness. Consider offline/authentication pause
     reasons without making disconnection itself proof of failed or changed data.
   - Keep pagination completeness/count evidence and mutation acceptance/receipts separate from these
     read predicates. Coordinate with existing pagination/receipt sketches rather than redesigning
     them silently. Distinguish received/updated/seen UI markers from transport freshness.
3. Guard versus presentation selection:
   - Guard states state a continuation requirement, not solely an error classification; loading and
     optional absence can block necessary access despite being non-error conditions.
   - Ordinary empty/refreshing/stale UI can use when/if. Stable observations should support simultaneous
     indicators, e.g refresh spinner plus empty message, without suppressing retained content.
   - All-match when is selected design; single-value expression selection is pick. Verify current
     implementation still selects one branch and account for migration. Apply selected action/body
     sequencing and selected otherwise fallback; settle resource observation and overlap without changing failure-guard precedence. Available includes
     an empty result, so an all-match available ListView branch can overlap empty UI.
4. Freshness policy:
   - Current query stale specifically means a failed refill after a previous result, not expiry.
   - Consider typed policy controlled by provider defaults and query overrides: freshness duration,
     explicit invalidation, failed revalidation, server revisions/validators and live subscriptions.
   - A successful refresh should establish freshness according to the declared policy; do not assume
     zero freshness duration. Distinguish eligibility for refetch, refresh failure, connectivity, and
     freshness confidence. Decide whether unknown deserves its own state.
5. Typed reads and observations:
   - Specify narrowing for optional/resource/member chains, aliases, synchronous render observations,
     and invalidation across suspension. Retained metadata is historical evidence, not authorization
     for a later live dereference. Coordinate with A27; do not promise an arbitrary-code proof.

## Current-source baseline to reverify

- `FunctionalCoreValidator.allowedCases`: text/list empty; query empty/loading/refreshing/stale/error;
  entity loading/missing/unauthorized/error; boolean yes/no aliases and declared enum cases. None
  and optional union subject guards are not currently supported. The default read net covers four
  exceptional cases; available/ready are internal statuses, not current guard branch names.
- `TR-data-schema.availability`: absent retained rows, invalid generations, and exhausted reference
  lookups report missing. A retained handle can outlive remote deletion without any stored relation
  violating a schema. Loading is not proof of absence.
- `TR-data-schema.query`: prior filledAtMs plus filling gives refreshing, and prior filledAtMs plus
  failed gives stale. There is no age threshold or automatic disconnect freshness rule.
- `InstantDB.ts`: authenticated stores enable allowAbsentRelations because a linked target may be
  unreadable. `instant-rows.resolveRelations` clears absent optional relations, filters required rows
  without links, and can retain unreadable required target identities for authenticated stores.
- `instant-schema.ts`: scalar attributes are generated server-optional and forward links do not
  declare required. Projection may normalize/default invalid fields or filter rows. This is not the
  proposed strict decoder/schema guarantee and must be evaluated explicitly.
- Native Instant supports required attributes and forward links; schema integrity does not prove a
  navigation ID still exists. Deletion clears links by default; view permissions restrict readable data.

Sources: [modeling data](https://www.instantdb.com/docs/modeling-data),
[deletion](https://www.instantdb.com/docs/instaml),
[permissions](https://www.instantdb.com/docs/permissions), and
[freshness prior art](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).
Reverify external behavior before relying on it. The foreign framework's defaults are not Tao decisions.

## Deliverables and completion criteria

1. Audit current parser, validator, formatter, compiler, runtime, datasource adapters and relevant specs;
   identify contradictions and classify implemented behavior versus proposed direction.
2. Produce written type definitions, a state/facet truth table with valid/invalid combinations, and
   predicate derivations. Include how none, empty, NotFound, required-data violations and unknown
   metadata differ; explicitly identify which distinctions are publicly observable.
3. Provide minimal examples for initial load, empty load, cached reload, failed refresh, offline/paused
   work, optional relation absence, required relation validation, retained deleted entity, permissions
   changes, recovery, paginated partial results and later mutation rejection. Show simultaneous UI.
4. Define default/local guard coverage and continuation, stable observation/narrowing boundaries,
   typed failure propagation, provider obligations, safe identity access and permission privacy.
5. Recommend the smallest coherent MVP subset plus migration/compatibility costs and acceptance
   scenarios. List unresolved Developer decisions and genuinely deferred work. Investigation complete
   means the review/contract is ready to decide, not that implementation or external acceptance passed.

Context: [S47–S52 discussion](<../Roadmap/Data and render contracts/Syntax sketches.md#s47--app-guard-integration-explicit-cleanup-and-minimal-app>),
[user/developer stories](<../Roadmap/Data and render contracts/User stories.md>),
[language decisions](<../Roadmap/Tao Revolution/Decisions.md>),
[A27](<Agent MVP Roadmap.md#a27--investigate-static-read-and-failure-handling-proofs>),
`Docs/Spec/Tao Data.md`, and `Docs/Spec/Tao Type System.md`.
