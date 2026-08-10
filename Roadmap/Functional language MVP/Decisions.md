# Functional Language MVP — Decisions

Numbered decisions made under this branch's experimental delegation. Each records what was chosen and why; deviations from sketches are deliberate. Sibling documents: `Project.md` (scope and status), `Deferrals.md` (consciously omitted work).

## DEC-FMVP-001 — Branch and isolation

Work happens on `feat/functional-language-mvp`, created from `main` (`444b02ed`). The sibling branch `feat/autonomous-language-mvp` was already checked out in another agent's worktree when this project started; it is left untouched and is consulted read-only at most. This project's record lives in `Roadmap/Functional language MVP/` so the two branches never collide on paths.

## DEC-FMVP-002 — Equality operators are `==` and `!=`

`Spec/Tao Type System.md` defines arithmetic and boolean operators but leaves equality spelling open; the Writer sketch used a single `=` inside `where` clauses. `==`/`!=` are chosen everywhere (general expressions and query `where`) so `=` remains exclusively assignment/binding. Comparisons are `< <= > >=`.

## DEC-FMVP-003 — `when` is the MVP's only conditional, and always total

Three forms with one shape: expression (branch values), render statement (branch bodies render content), and action statement (branch bodies are action blocks). `otherwise` is **required** in all three. Totality is both a semantic choice — every `when` has a defined result — and what makes the branch list unambiguous to parse: without a terminating keyword, the statement forms would swallow the following statement as another branch condition. "Render nothing" is written `otherwise -> { }`. `if/else`, `match`, and `guard` are deferred; `when` covers conditional rendering, derived values, and conditional action logic with a single surface.

## DEC-FMVP-018 — `alias` stays as a deprecated keyword, AST name unchanged

`let` is the binding keyword; `alias` still parses and emits a deprecation warning carrying the `tao-deprecated-alias` code, and all repository sources moved to `let`. The AST node keeps the name `AliasDeclaration` with a `keyword` property rather than being renamed to `LetDeclaration`: the rename touches every package for no behavior change, so it is deferred (DEF-FMVP-016). A `tao fix` source action that rewrites `alias` to `let` is also deferred.

## DEC-FMVP-004 — String interpolation holds names, not expressions

`"… {Name} …"` and `"… {Task.Title} …"` keep the existing STRING terminal; segments are scanned in `@ast-utils`, resolved against the enclosing scope by name, validated (unknown name, or a value that is not text/number/boolean), and compiled to a JavaScript template literal through `TR.Interpolate`. Segments hold a name or member path only — an expression like `{Count * 2}` is not supported; bind it with `let` first. Making segments real expressions needs either lexer modes or a sub-parser: Chevrotain lexes context-free, so the natural `"…{` / `}…{` / `}…"` terminals would also match a `}` from an unrelated block followed by any later `"` on the line. The name-path form buys the app's real cases at a fraction of the risk. Full expressions and IDE cross-references inside strings are deferred (DEF-FMVP-011).

## DEC-FMVP-005 — Iteration is `for <Name> in <Collection> { … }`

A render statement iterating lists and (from the query slice) query results, keyed by entity `Id` when elements carry one and by index otherwise. The collection is restricted to a value reference, member path, list literal, or parenthesized expression: a general expression there would let the loop body's `{` be read as a typed constructor's item literal. Builtin members `.Count`/`.Empty` on lists and `.Length`/`.Empty` on text are resolved before item fields, in the type resolver and in `TR.Member`. List literals infer an element type when every element agrees, which is what gives the loop variable its type. A stdlib `List` view is unnecessary for the MVP — the app shell scrolls.

## DEC-FMVP-006 — Event clauses

`on press|change|submit -> [Name is Type] { … }` attaches to a render invocation after its layout clause, and the formatter puts each clause on its own indented line. Handlers travel in the `__tao` props bag as invokable action values, so a view forwards its caller's handlers and the nearest binding wins. `on press` works on any view — the runtime renders a container with a press handler as a pressable and lets text handle presses natively. `change` and `submit` are delivered by input primitives; binding them to a view that never fires them is allowed and simply never runs (per-view declared events, the `does`/`did` pair, would tighten this and are deferred). Event payloads are wrapped as Tao values by the runtime before the generated handler binds them. Positional action arguments (`Button("X", DoIt)`) remain valid.

## DEC-FMVP-007 — Named arguments use the `Label:` form; parameters take `default`

Named arguments use the existing invocation label syntax — `TextInput(Draft, Label: "Task title")` — which resolves through the callee's owner-qualified parameter type. No new argument syntax is added (the `.Label` dot-form from the ui sketch is not implemented, and DEC-FMVP-017's parentheses removed the need for the juxtaposed property-constructor form).

Parameters gain `default <literal>` (`Placeholder is text default ""`). A defaulted parameter can still be bound explicitly by name (an exact type match), but it does **not** compete for unnamed arguments: without that rule, a view with two `text` parameters would make every bare text argument ambiguous, which is exactly the shape every form control has. Omitted defaulted parameters compile to their default value at the call site. `optional`/`none` are deferred.

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

## DEC-FMVP-017 — Invocations are parenthesized (Ro directive)

Ro directed mid-project: rendering, action `do`, and function invocations all require `<Name>(<Args>)`, with renders shaped `render View(<Args>) [<Layouts>] { … }`. Resolutions made under that directive:

- Render invocations always carry parens, empty included: `Text("Still")`, `Col() [fill, gap 8] { … }`, child `CaptureForm()`. Layout clause and child block follow outside the parens.
- `do` targets always carry parens: `do Capture()`, `do AddBy(5)`.
- Function calls (slice 8) always carry parens: `now()`, `TaskLabel(Task)`.
- A bare name in expression position stays a value reference; parens are what invoke.
- `ArgumentValue` widens to any expression — the parens remove the earlier grammar restrictions (lists and typed constructors are now valid arguments).
- Named argument/field binding uses the existing `Type: value` label syntax (`TextInput(Draft, Label: "Task title")`, `create …Task { Title: Draft }`), replacing the property-constructor juxtaposition planned in DEC-FMVP-007.
- Typed constructors keep the single-literal juxtaposed form (`WorkspaceName "Inbox"`) — not in the directive's list and unambiguous; revisit if Ro extends the rule.
- `render inject` is unchanged (already fence-delimited).
- Parentheses are optional in the grammar and required by the validator, so a paren-less invocation reports `Render of X requires parentheses. Write \`X()\`.` instead of a raw parse error. An argument list without parentheses remains a parse error.
- Executable sources (`Apps/**`, stdlib, package tests) migrated in this slice. `Spec/**` examples are migrated in the closing coherence slice, together with the other spec-status updates.

## DEC-FMVP-016 — List literals stay whitespace-separated

`[1 2 3]` per the Type System spec. To keep `[1 -2]` unambiguous once operators exist, list elements are primary/unary expressions; a computed element needs parens (`[(1 - 2) 3]`).
