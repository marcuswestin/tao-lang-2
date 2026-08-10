# Functional Language MVP — Deferrals

Consciously omitted scope. Each entry is a deliberate deferral, not an implicit TODO; existing LANG-NNN / DEF-NAV-NNN ids own the broader design space where noted.

- DEF-FMVP-001 — Visibility vocabulary migration (`file`/`package`/`workspace`/`public`). Settled direction (LANG-001) but repo-wide churn orthogonal to the functional MVP; `package`/`project`/`publish` remain in use.
- DEF-FMVP-002 — `with` configured values, app variants, and `run <AppVariant>`; partial application. (Type System spec + DEC-NAV-002.)
- DEF-FMVP-003 — Optional values (`optional`, `none`) and optional item fields. Parameter `default` covers the MVP's needs.
- DEF-FMVP-004 — `match` type narrowing, `if/else`, `guard <entity> when Loading/Available/…`. `when` plus query status members cover MVP control flow.
- DEF-FMVP-005 — Operators beyond the MVP set: `has`, text `*`, list `-`, comma-grouped number literals.
- DEF-FMVP-006 — Parameter/property syntax evolutions: juxtaposed headers (`Label text`), body property declarations, dot-labeled arguments (`.Label "…"`), `does`/`did` declared events, `frame`.
- DEF-FMVP-007 — Query field-selection blocks, has-many traversal sugar (`Workspace.Tasks`), transactions, `link`/`unlink`, conflict policies. (LANG-008/009.)
- DEF-FMVP-008 — All navigation beyond DEC-FMVP-012's subset: targets and `in` paths, SlotNav syntax, Selection/Split/Overlay/Toast/Window, restoration, canonical descriptor identity, routes/deep links, dialogues/`ask`. (Owned by `Roadmap/Add navigation and routing MVP/`.)
- DEF-FMVP-009 — Design tokens, semantic tokens, recipes, `design` blocks, theming. (Owned by `Roadmap/Add Tao design system MVP/`.)
- DEF-FMVP-010 — Remote/sync providers (InstantDB), auth, accounts, collaboration, deployment.
- DEF-FMVP-011 — Native IDE cross-references inside interpolated strings (rename/hover); interpolation segments are validated and compiled but not Langium-linked.
- DEF-FMVP-012 — `enum` declarations, closed unions (`ui | nav`), render elision, `state` `=`-omission shorthand. (LANG-004/012/019.)
- DEF-FMVP-013 — Function block bodies, `return`, recursion story, function values as arguments.
- DEF-FMVP-014 — Test datasource seeding steps and richer selectors (`id`, role/state, `scroll until`, count assertions); journeys create data through the UI, provider states come from `run … with { data … }`. (LANG-027.)
- DEF-FMVP-015 — Persisted navigation/state restoration across process restarts (data persists via the Local provider; presentation state does not).
