# Auth syntax review

Status: local and self-hosted slice implemented, 2026-09-26; managed-provider acceptance remains later work. The
[implementation plan](<Plan - Auth and account data.md>) owns sequencing and acceptance;
[Tao Revolution decisions](<Tao Revolution/Decisions.md>) owns the decided language. This review
does not settle the broader authority cluster's MVP scope. The executable review app is
`Apps/Test Apps/Auth Review/`; its acceptance evidence belongs to the implementation plan.

## Accepted direction

- Provider-neutral `@tao/auth`, selected through typed app configuration, independently of the
  datasource. Named exports expose the session, current application Account, actions, and UI.
  No new auth keyword, app-authored JWT handling, or email-based durable identity.
- Commas separate `data` entries; optional trailing comma. `Owner Account` and `Person Account`
  name to-one relations; plural entity targets name collections. Same-name inferred fields remain.
- `unique Workspace + Person` is one unique pair. `unique Workspace, unique Person` means two
  independent constraints. One index/constraint per keyword; `+` separates composite unique fields.
  Current indexes remain single-field; composite-index design is outside this amendment.
- Actor-first grants use `read`, `create`, `update`, `delete`. Keep mutable fields explicit:
  `Owner can update Body`. Direct account sets such as `Workspace.Memberships.Person can read`
  avoid named audiences. Owner and creation metadata remain immutable in the Notes example.
- Named path queries use `query Mine = Me.Notes with { order by CreatedAt desc }`.
- Read fallback precedence is site, app, standard library. An app need not author a default guard.
  Auth effect failures remain at the calling site or flow; fallback messages must be safe to show.
- Bar-form `when` is the target for multi-arm matches. Require terminal `otherwise` and one
  expression per value arm, or one atomic statement/nested match in render and effect contexts;
  use braces for multiple statements. A nested match closes at its
  own terminal arm; `otherwise` does not group arbitrary sibling statements.
- Fixtures may omit unused create bindings. `signed in as Alice` supplies the default actor;
  explicit `for Bob` overrides the test actor. `Owner: Alice` remains row data, not authentication.
- TestAuth plus Memory supports deterministic local UI tests; a localhost integration backend
  exercises actual session verification, persistence, authorization, and reconnect behavior.

## Post-MVP deferrals

**Text truthiness:** do not settle empty-string-as-boolean behavior now. Retain
`if Problem is not empty { Text(Problem) }`. A later design must address condition positions,
whitespace, unavailable values, and consistency without broad host-language coercion.

**Named audiences:** defer `audience Name for Entity = ...` and its references. Use account-valued
paths/account-set expressions directly in MVP access rules.

## Separate pre-MVP task: drafts and completeness

The auth app avoids draft-dependent forms. Main now implements required-field row completeness;
this slice adds the positive `IsComplete` and inverse `IsIncomplete` spellings. Draft/save syntax
remains outside this auth slice and must follow the current Decisions record, including its
retirement of earlier draft proposals.

- Derive row completeness and field problems from required-field metadata. Completeness is not
  authorization, full validity, or server acknowledgement. Settle whitespace, optionality,
  relations, and unavailable required values; reconcile current create-time validation with the
  implemented nonblocking completeness contract.
- Preserve content after immediate rejection and after rejection of an already queued submission.
  Resetting a new-entry form must not discard the durable submission's recoverable content.
- Coordinate shared row completeness with auth onboarding; auth can use supplied local-buffer
  forms and does not depend on the draft/save syntax.

## Boundaries and remaining grammar decisions

Comma separation resolves relation juxtaposition, but exposes inner lists: shipped `commands
Save, Share` and planned `together A, B` compete with entry separators. Recommend braced command
lists (accepted for this slice) and a delimited or `+`-joined fact pair for future facts. Nested trait
lists already have parentheses. Type expressions containing lists must likewise terminate
unambiguously; a named enum such as `Role` avoids an inline enum-list collision.

Composite uniqueness is new behavior, not just punctuation. The implementation keeps a
single primitive `(unique)` reference key distinct from independent unique constraints. Preserve scalar reference
identity until an explicit composite-key design exists; do not silently select a tuple or an
arbitrary unique field. The plan includes concurrent backend enforcement.

Bar-form nesting needs parser and formatter proofs across render, value, effect, subject-less,
and compact boolean contexts. The compact boolean compatibility choice remains explicit; do not
silently remove it because multi-arm matches change spelling.

## Session, account availability, and offline data

Session and Account belong to one reactive auth context and switch coherently. A verified session
may exist while application account data loads or fails. Retain the account availability boundary
before reading `Me.IsComplete`; current member access does not propagate receiver availability.

`Offline { Me.Notes }` requests a synchronized account-scoped working set. It neither grants
authorization nor makes unfetched data available. Initial completeness, retention, relation
dependencies, durable queues, account isolation, and logout behavior need provider contracts and
tests. Cached query results alone are insufficient evidence.

The new fixture, assigned-query, comma-field, composite-unique, and terminal bar forms now have
focused parser/validator/formatter coverage. Runtime review journeys and provider conformance
remain separate acceptance boundaries. The historical review sketch remains a design artifact.
