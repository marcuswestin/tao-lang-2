# Functional Language MVP — Decisions

Numbered decisions made under this branch's experimental delegation. Each records what was chosen and why; deviations from sketches are deliberate. Sibling documents: `Project.md` (scope and status), `Deferrals.md` (consciously omitted work).

## DEC-FMVP-001 — Branch and isolation

Work happens on `feat/functional-language-mvp`, created from `main` (`444b02ed`). The sibling branch `feat/autonomous-language-mvp` was already checked out in another agent's worktree when this project started; it is left untouched and is consulted read-only at most. This project's record lives in `Roadmap/Functional language MVP/` so the two branches never collide on paths.

## DEC-FMVP-002 — Equality operators are `==` and `!=`

`Spec/Tao Type System.md` defines arithmetic and boolean operators but leaves equality spelling open; the Writer sketch used a single `=` inside `where` clauses. `==`/`!=` are chosen everywhere (general expressions and query `where`) so `=` remains exclusively assignment/binding. Comparisons are `< <= > >=`.

## DEC-FMVP-003 — `when` is the MVP's only conditional

Three forms with one shape: expression (`when C -> V … otherwise -> V`, `otherwise` required), render statement (branch bodies render content, `otherwise` optional), action statement (branch bodies are action blocks). `if/else`, `match`, and `guard` are deferred; `when` covers conditional rendering, derived values, and conditional action logic with a single surface.

## DEC-FMVP-004 — String interpolation via sub-parsed segments

`"… {Expr} …"` keeps the existing STRING terminal; `{…}` segments are parsed as expressions by the language's own parser and resolved against the enclosing scope in ast-utils/validator, compiled to template literals. Trade-off: segments are not native Langium cross-references (IDE rename/hover inside strings deferred), in exchange for full expression power without lexer surgery.

## DEC-FMVP-005 — Iteration is `for <Name> in <ListExpr> { … }`

A render statement iterating lists and query results, keyed by entity `Id` when elements are entities and by index otherwise. Builtin members: `.Count`/`.Empty` on lists and queries, `.Length`/`.Empty` on text. A stdlib `List` view is unnecessary for the MVP — the app shell scrolls.

## DEC-FMVP-006 — Event clauses

`on press|change|submit -> [Name is Type] { … }` attaches to render invocations. `on press` is valid on any rendered view (the compiler wraps the element in a pressable region); `change` and `submit` are valid only on views that declare those events (stdlib `TextInput`). Positional action arguments (`Button "X", DoIt`) remain valid. `does`/`did` event declarations and `frame` are deferred.

## DEC-FMVP-007 — Named arguments are property constructors; parameters take `default`

Following the Type System spec, `Label "Task title"` names a slot by constructing the parameter's owner-qualified nominal type; no new argument syntax is added (the `.Label` dot-form from the ui sketch is not implemented). Parameters gain `default <literal>` (e.g. `Placeholder is text default ""`); omitted defaulted parameters bind the default. `optional`/`none` are deferred.

## DEC-FMVP-008 — Data schema design

```tao
data StillData {
   Workspaces/Workspace { Name text }
   Tasks/Task {
      Title text indexed
      Done boolean default false
      CreatedAt time default now()
      Workspace
   }
}
```

Chosen over LANG-007's open alternatives, seeded by the `.tao-future` sketches: `Collections/Entity` pairs; juxtaposed `Field type` (a new declaration family, so no `is` legacy); bare entity name = belongs-to reference stored as the target's id; implicit `Id text` on every entity; `time` is a nominal millisecond-epoch number with builtin `now()`; `default <literal|now()>`; `indexed` is parsed and retained as a provider hint. Entity fields register as owner-qualified nominal types, so `StillData.Task.Title ""` and field-typed state work through existing typed construction.

## DEC-FMVP-009 — Query design

`query [Name =] <Data>.<Collection> [where <expr>] [order <member> [asc|desc]]` as a view-body statement; the binding name defaults to the collection name. Inside `where`/`order`, the **entity name binds the current row** (`where Task.Done == false order Task.CreatedAt desc`), avoiding field/outer-scope ambiguity with zero new syntax. Query values are reactive and expose `.Loading`, `.Failed`, `.Empty`, `.Count`, and iterate with `for`. Field-selection blocks from the sketch are dropped (local providers fetch whole entities).

## DEC-FMVP-010 — Mutations

Action statements `create <Data>.<Entity> { Field Expr, … }`, `update <entityRef> { Field Expr, … }`, `delete <entityRef>`, and `toggle` extended to entity boolean fields (alongside boolean state, where it means `set X = not X` per spec). Field entries are property constructors of the entity's field types — the same owner-qualified model as arguments and items. Omitted defaulted fields take their defaults.

## DEC-FMVP-011 — Provider boundary and choices

One narrow provider interface (load snapshot / apply mutation / subscribe / status). Two implementations: `Memory` (deterministic, used by tests and available to apps) and `Local` (durable). `Local` uses `@react-native-async-storage/async-storage` — standard RN persistence, works in Expo Go and on web, has an official jest mock, needs no credentials; expo-sqlite was rejected for jest/web friction and native-module weight. `InstantDB`/remote sync deferred. Entity ids come from a small TR random-id helper (no dependency).

## DEC-FMVP-012 — Navigation subset

Implemented: a new `ui` declaration kind (presentable screens; `view` stays embeddable content), app blocks accepting `Name "…"`, `Navigator StackNav { Initial <Ui> }`, and `Datasource { … }`; `present <Ui> <args…>` (push) and `dismiss` (pop) action statements; deterministic stack state owned by `TR.Nav`; automatic back affordance and Android hardware back popping the stack; the `back` test step. The legacy `app X { view Root }` form remains accepted (single-screen host) with a deprecation path. Everything else in the navigation spec — targets, SlotNav syntax, selection/split/overlays/toasts/windows, restoration, canonical descriptor identity, `with`-configured apps, routes — is out of scope here and stays with the navigation roadmap project.

## DEC-FMVP-013 — Test interaction surface

Per `Spec/Tao Testing.md`: selectors `text | label | placeholder` for `press` and `expect`; `write "…"` types into the focused editable control (focus via `press label/placeholder …`); `back` triggers normal back behavior; `expect input label "…" value "…"` asserts input values. Additions this project makes to the spec: a `submit` step (fires the focused input's submit), and `run <App> with { data loading | data failing }` as the deterministic provider-state override (a minimal instance of the spec's `run … with { … }` shape). Tests default to the Memory provider.

## DEC-FMVP-014 — Visual styling surface

Direct layout-clause entries only: `bg <color>`, `fg <color>`, `size N`, `weight N`, `line N`, `radius N`, `border <color>`, with hex color literals (`#f6f7f3`). Lowered through the existing layout engine and merged like other entries. `fg`/`size`/`weight`/`line` apply to text elements; `bg`/`radius`/`border` to containers and text. Named design tokens, recipes, and `design` blocks stay with the design-system roadmap project.

## DEC-FMVP-015 — Functions

Expression-bodied only: `function Name <params> = <Expression>` with inferred result type; calls are parenthesized expressions (`TaskLabel(Task)`, `now()`), keeping juxtaposition reserved for typed construction and render invocation. Block bodies and `return` are deferred until a real need appears.

## DEC-FMVP-016 — List literals stay whitespace-separated

`[1 2 3]` per the Type System spec. To keep `[1 -2]` unambiguous once operators exist, list elements are primary/unary expressions; a computed element needs parens (`[(1 - 2) 3]`).
