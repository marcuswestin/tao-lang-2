# Hypen evaluation

Status: **exploration, first pass (2026-09-25)**. This page evaluates [Hypen](https://github.com/hypen-lang/hypen)
([docs](https://docs.hypen.space/)) in two ways: as a possible compilation target in place of React Native, and as
something Tao can learn from. It records the questions to answer, a side-by-side comparison of the two languages, how
the Hypen runtime works, and a plan for investigating it hands-on. Nothing here is a decision. Tao's decided language
is `Tao Revolution/Decisions.md`.

All evidence is from `hypen-lang/hypen` at commit `4e62ad1` (2026-09-04, workspace version 0.6.4, MIT). Hypen paths are
relative to that repository. Tao paths are relative to this one: `WF` means `Apps/WordFlower/1 - Current`, and `TA`
means `Apps/Test Apps`.

## Summary

1. **Hypen is a poor replacement for React Native as Tao's target today.**
   1. On iOS and Android, Hypen only streams its UI from a server over a WebSocket. The Swift renderer's public entry
      point takes a URL (`hypen-renderer-swift/.../HypenView.swift:25`), and so does the Android one
      (`hypen-renderer-android/.../remote/RemoteEngine.kt`). No on-device engine exists for mobile. Every tap is a
      network round trip, and the app does not work offline. That contradicts WordFlower's offline-first premise, where
      the device owns the writing (`WF/WordFlower.tao:592`).
   2. Hypen is interpreted at runtime. Its WASM, UniFFI and WIT bindings accept source text only. The typed IR can
      only be fed in through native Rust (`hypen-engine-rs/src/engine.rs:203`), and the patch encoding "may change
      between versions" (`reconcile/patch.rs:71-75`). No stable IR exists that a foreign compiler could emit.
   3. Hypen has no React or React Native renderer, no gesture vocabulary, and no bridge to native modules from the
      client. It is also untyped by design (`SPEC.md:41-42`).
   4. It is maturing in public but has one human maintainer. Its 35 public commits are batched syncs from a private
      repository, split between that maintainer and an agent. The root changelog stops at 0.4.42. Hypen's own
      benchmark has it slower than React 19 in 8 of 9 scenarios, with a 690 KB gzip WASM engine
      (`benchmarks/react-vs-hypen/results/results.json`).
2. **Hypen is worth learning from.** Five runtime ideas are listed under [Ideas worth borrowing](#ideas-worth-borrowing).
   Its shared engine-compatibility fixture suite and its centrally derived accessibility semantics are the strongest.
3. **The two languages split the work in opposite ways.** Hypen keeps the DSL to a view tree plus bindings, and puts
   state, actions, data, persistence and authentication in a host SDK running on a server. Tao puts state, actions,
   data, navigation, outcomes and (decided) authority into the language. Compiling Tao to Hypen would therefore mean
   emitting Hypen view text *and* a generated host module (TS, Kotlin or Go), and moving the `TR` data and navigation
   runtime onto a server.
4. **A narrower role may still fit.** Hypen could be an extra *server-driven* target for specific app shapes, or its
   patch protocol could serve as a reference wire format if Tao ever streams UI. Both belong to the investigation
   below, not to the MVP.

## Questions to investigate

### Target fit

1. Can Hypen host a Tao app with on-device logic on iOS and Android? Is an on-device engine planned, or does
   `hypen-kotlin`'s UniFFI binding already make one possible?
2. What does a Tao→Hypen lowering look like for one WordFlower slice? Which constructs have no mapping? Candidates:
   typed navigation parameters, `query`, `guard`, `fails` outcomes, `ask`/`respond`, `copy … as`, writable
   parameters, and offline queues.
3. What is the latency of a tap, and of typing, on a simulator connected to a local Hypen server? What about on a
   throttled network?
4. How does text input behave under server round trips (IME, autocorrect, selection, undo)? Compose keeps a local
   copy and resyncs on blur (`hypen-renderer-android/.../InputComponent.kt:55-99`).
5. What would we give up from React Native and Expo? Native modules, Reanimated, gestures, `react-native-screens`,
   Expo APIs, EAS build, web through react-native-web, and Studio's react-native-web rendering.
6. What is the licensing, governance and bus-factor risk? How good is the upstream's responsiveness to issues and
   pull requests?

### Learning

7. Could the path-keyed dependency graph with sparse updates replace or inform how `TR` scopes re-renders?
8. Would a patch protocol with `Detach`/`Attach` and templates help Tao's navigation caching, and a future remote
   Studio preview?
9. Could Tao derive accessibility semantics in the compiler the way Hypen derives them in the engine
   (`hypen-engine-rs/src/ir/semantics.rs`), with a `hypen check`-style linter?
10. Should Tao have a language-neutral fixture suite (source in, expected tree or patches out) for runtime parity
    across targets, modelled on `engine-compatibility-tests/`?
11. Does Hypen's portable animation vocabulary (`.enter`, `.exit`, `.transition`, `.layout`, `.states`) fill a gap
    in Tao's design system?
12. How does Hypen's agent skill (`skills/hypen-ui/SKILL.md`) compare with Tao Skills, and do its "gotchas"
    sections point at language defects Tao avoids?

### Further dimensions to compare

The side-by-side below covers everything the Developer listed, plus the following dimensions:
- conditionals and lists
- text input and forms
- async, loading and error outcomes
- modules
- types
- testing
- tooling
- escape hatches
- authentication
- accessibility, animation and i18n

Still open for the hands-on pass:
- lifecycle (mount, activate, background)
- offline and reconnection
- host chrome (title, toolbar, commands, keyboard shortcuts)
- native controls
- gestures
- deep links
- previews and fixtures
- the hot-reload dev loop
- bundle size and startup
- packaging and distribution
- multi-app variants (`app X = Y with {}`)

## Side by side

The Hypen snippets come from its docs, skills and examples; the file is cited for each. Each Tao snippet is tagged
*implemented* (it parses and runs today) or *decided* (it is in `Decisions.md` but not built yet).

### View definition and composition

Tao, *implemented*: a view with a named slot and caller content (`WF/@ui/Shell.tao:77-89`).

```tao
view Card(Title text) [padMedium, panel] {
   @actions = empty
   render Col() [gapSmall] {
      Row() [spreadCenter] {
         Text(Title) [title, claim 1, compress]
         @actions
      }
      Col() [gapTight] {
         @@content
}  }  }
```

Hypen, from `skills/hypen-ui/SKILL.md:78-80` and `hypen-docs/content/docs/guide/slots.mdx:61`:

```text
component MyCard(title, subtitle) {
  Column {
    Text("@{title}")
    Children().slot("header")
  }
}
```

- A Hypen `component` is stateless and its parameters are untyped.
- A stateful view is a `module`, and its state lives in a host SDK.
- Example components read `@{item…}` from the caller's `ForEach` scope implicitly, which is dynamic scoping
  (`examples/social/components/StoryItem/component.hypen:3`).
- Tao parameters are typed, and a view accepts children only if its body places `@@content`.

### App entry point and rendering

Tao, *implemented* (`WF/WordFlower.tao:588-592`):

```tao
app WordFlower {
   Name "WordFlower"
   Design WordFlowerDesign
   view WordFlowerShell(WordFlowerNavigator)
   Datasource DeviceStore
}
```

Hypen: a server-side host module, and a client that applies patches (`README.md:73-108`, condensed).

```ts
myApp.module('Counter')
  .defineState<{ count: number }>({ count: 0 })
  .onAction('increment', ({ state }) => { state.count += 1 })
  .ui(`Column { Text("Count: @{state.count}") Button("@actions.increment") { Text("+") } }`)
  .build()
new RemoteServer().app(myApp).listen(3000)

// client
const remote = new RemoteEngine('ws://localhost:3000')
remote.onPatches((patches) => renderer.applyPatches(patches))
```

- In Hypen the UI is a string held by the host. The engine parses it at runtime.
- Tao's `app` is a typed value, and variants derive from it with `with {}`.

### Navigation

Tao, *implemented* (`WF/@nav/Navigation.tao:9-11`, `TA/Navigation/Navigation MVP.tao:22,38`, `WF/@ui/Documents.tao:25`):

```tao
nav HomeStack = StackNav {
   Initial WorkspaceList
}
present Detail(Name: "Typed workspace")
let Result = ask ConfirmOpen()
do -> { present ExportPanel(Document) as sheet }
```

Hypen (`hypen-docs/content/docs/guide/routing.mdx:89`, `examples/social/components/StoryItem/component.hypen:14`,
`examples/movie-discovery/typescript/server/components/MovieDetail.ts:50-52`):

```text
Router {
    Route(path: "/users/:id") { UserProfile() }
}
.onClick(@router.push, to: "/story/@{item.id}")
```

```ts
const match = context?.router?.matchPath('/movie/:id', path)
```

- Hypen routing is URL-shaped and its parameters are strings, parsed by host code in `onActivated`.
- Off-screen routes are detached into an LRU cache of 10.
- Hypen has no deep links, sheets, tabs or split views.
- Tao has typed destinations, four navigator kinds, presentation chosen at the call site, and `ask`/`respond`.

### Cross-device and responsive layout

Tao: `Panes()` and `SelectionNav` adapt today (*implemented*). Named screens (`WF/Design.tao:62-66`) parse, but using
them with `when Screen is narrow` is *decided* only.

```tao
screens {
   narrow below 500.px,
   medium below 1000.px,
   wide
}
```

Hypen: breakpoint maps on any applicator, or Tailwind prefixes (`SKILL.md:565,575`,
`hypen-engine-rs/src/ir/expand.rs:137`).

```text
.fontSize({default: 14, md: 18, lg: 24})
.tw("text-sm md:text-base lg:text-lg")
```

The docs' `When(value: @platform)` platform switch has no engine support. `.padding@md(16)` appears in the docs, but
the parser's applicator names are plain identifiers, so it looks unparseable (`parser/src/parser.rs:344`).

### Layout primitives

Tao, *implemented* (`WF/@ui/Workspaces.tao:52-54`). Layout clauses sit in `[ ]` at each use site.

```tao
render ScrollView() [screen] {
   Col() [workspaceWidth, centeredLayout, gapSection] {
      Col() [hero] {
```

Hypen (`SKILL.md:395-400`, `examples/social-contracts.test.ts:32-33`):

```text
Stack { Image(...).tw("w-14 h-14 rounded-full")  Icon(@resources.plus) }
  .horizontalAlignment("end").verticalAlignment("end")
Grid(@state.posts, key: "id").gridColumns({default: 1, md: 2, xl: 3})
```

Hypen deliberately has no absolute positioning. Its `Grid` is data-driven, while Tao's `Grid` is *decided*
(`Decisions.md:1440-1446`).

### Styles and themes

Tao, *implemented* (`WF/Design.tao:47-53, 67-78`):

```tao
design WordFlowerDesign {
   colors {
      schemeCanvas when Scheme is Dark canvasDark / not canvas
   }
   styles {
      FormButton [background accentStrong, background accent when pressed, ink onAccent, radius 12, weight 700]
```

Hypen (`SKILL.md:580,1323-1324,1359`):

```text
Text("@{item.text}").color("@{item.active ? '#3B82F6' : '#6B7280'}")
.backgroundColor({default: "#3B82F6", hover: "#2563EB", active: "#1D4ED8"})
.tw("p-6 bg-white rounded-xl shadow-lg")
```

- Hypen has no themes or tokens; colours are literals.
- Unknown applicators fall through to CSS.
- Tao has a typed design with named tokens, styles conditioned on state and colour scheme, and element defaults.

### Actions and events

Tao, *implemented* (`TA/Language Core/State Action MVP.tao:15-26, 65-66`):

```tao
state Count = 0
action AddStep(Step number) {
   set Count += Step
}
Button("Inline add one") {
   on press -> { set Count += 1 }
}
```

Hypen: the DSL names the action, and the handler is host code, normally on the server (`SKILL.md:1149,1188`).

```text
.onClick(@actions.removeTask, id: "@{item.id}")
```

```ts
.onAction<{ id: string }>('removeTask', async ({ action, state }) => { /* … */ })
```

The engine only checks that a handler exists; it does not validate payloads (`hypen-engine-rs/src/dispatch/action.rs:86-92`).

### State, derived values and reactivity

Tao, *implemented* (`WF/@ui/Focus.tao:49-57`, `WF/@ui/Workspaces.tao:121-124`):

```tao
state Tick = Interval(1.s)
let Left = when FocusSession.Paused {
   true -> FocusSession.EndsAt - FocusSession.PausedAt
   otherwise -> FocusSession.EndsAt - Tick.Value
}
query Drafts from Workspace.Documents {
   where is Draft
   search Find
}
```

Hypen: state is host-only, and mutations are tracked by a Proxy (`SKILL.md:741,745`).

```ts
.defineState<AppState>({ count: 0, items: [], input: '', isLoading: false })
state.count++
```

Computed values are listed as "Future" in Hypen (`SPEC.md:405`). Today it only has inline `@{}` expressions,
evaluated by the JS-like `exprimo` interpreter.

### Local storage, remote storage and sync

Tao, *implemented* (`WF/@data/Data.tao:17-24`, `WF/WordFlower.tao:697-705`, `WF/@ui/Documents.tao:162-171`):

```tao
data Documents / Document {
   Title text (required "Name this document", search, title)
   Body text (default "", search)
   Paragraphs (owned)
}
datasource DeviceStore = Local {
   StorageKey "WordFlowerData"
}
```

Hypen: server-side persistence and live-database plugins (`guide/persistence.mdx:70`, `guide/data-sources.mdx:31-35`).

```ts
.persist(durableObjectStore(withKey((state) => state.user?.id)))
.useDataSource(new SpacetimeDBPlugin(), { uri: 'ws://localhost:3000', moduleName: 'chat', tables: ['user', 'message'] })
```

```text
ForEach(items: @spacetime.message, key: "id") { … }
```

- Hypen has no client-side storage and no offline queue.
- It drops a patch whose revision is out of order without asking for a resync
  (`hypen-web/packages/core/src/remote/client.ts:590-594`).
- Tao exposes typed entities, several datasource providers, `local only`, and per-row sync state such as
  `WritesQueued` and `retry`.

### Conditionals and lists

Tao, *implemented* (`WF/@ui/Workspaces.tao:98-100, 185-188`):

```tao
when DocumentTitle {
   empty -> { Text("Document title is required") [validation] }
   otherwise -> { TextMultiline("Ready to write { DocumentTitle }") [caption] }
}
loop Workspaces / Workspace {
   WorkspaceRow(Workspace)
   on select -> { present WorkspaceDetail(Workspace) }
}
```

Hypen (`SKILL.md:217-218,246-250,262-275`):

```text
If(condition: @state.isLoggedIn) { Text("Welcome back!")  Else { Text("Please log in") } }
When(value: @state.status) { Case(match: "loading") { Spinner() }  Else { … } }
ForEach(items: @state.todos, key: "id") { Text("@{item.text}") }
```

Hypen documents two limits: a nested `ForEach` cannot reach the outer `@item`, and `as:` aliases are ignored
(`SKILL.md:239-241`).

### Text input and forms

Tao, *implemented* (`WF/@ui/Workspaces.tao:72-84`):

```tao
TextInput(Value: Input.Name, Label: "Workspace name", Placeholder: "Home") {
   on change -> NewWorkspaceName {
      set Input.Name = NewWorkspaceName
   }
   on submit AddWorkspace
}
Problems(Input.Problems) [validation]
FormButton("Add workspace", Disabled: Input.Incomplete) { … }
```

Hypen (`SKILL.md:553-555`):

```text
Input(placeholder: "Search")
  .bind(@state.query)
  .onInput(@actions.search)
```

Hypen has no validation in the DSL. In Tao, `required "…"` produces `Incomplete` and `Problems`.

### Async, loading and errors

Tao, *implemented* (`WF/@ui/Documents.tao:48, 113-118`, `Apps/HNReader/HNReader.tao:213-226`):

```tao
action ExportDocument(Document) fails Offline "Exporting needs a connection." fails TooLarge "…" from ./Export.ts
when do ExportDocument(Document) {
   saved -> { present ExportNotice("Ready to share") as toast }
   Offline -> { present ExportNotice("Exporting needs a connection.") as toast }
   rejected -> Problem { … }
}
guard TopStories {
   loading -> { Spinner() }
   error -> Message { … }
}
```

Hypen: loading is a flag that host code sets by hand, and errors go to a hook (`SKILL.md:1314-1316`,
`guide/error-handling.mdx:23-26`).

```text
When(value: @state.status) {
  Case(match: "loading") { Center { Spinner() } }
  Case(match: "error") { Text("Error: @{state.errorMessage}").color("#EF4444") }
}
```

```ts
.onError(({ error, actionName, lifecycle, state }) => { return { handled: true } })
```

### Modules and imports

Tao, *implemented* (`WF/WordFlower.tao:1-6`):

```tao
use Documents, Workspaces from @data
use InstantDB from @tao/data/providers/instantdb
```

Hypen (`SKILL.md:137-138`, `hypen-engine-rs/tests/test_imports.rs:381-382`):

```text
import { Button, Card } from "./components/ui"
import HomePage from "./pages/HomePage"
```

In practice Hypen finds components by folder convention (`Name/component.hypen` next to `component.ts`). It has no
package system and no visibility levels.

### Types

- Tao has nominal types, closed cases (`one of`), unit values, `yes / no` booleans with aliases, typed parameters, and
  generated TS bridge contracts.
- Hypen's core is schema-agnostic by design: "Typing is a host-side concern" (`SPEC.md:41-42`). Types come from
  `defineState<T>` and `onAction<P>` in TS, Rust generics, and sealed classes in Kotlin. Go payloads are `any`.

### Testing

Tao, *implemented*: black-box behaviour tests written in Tao (`WF/Documents.test.tao:12-17, 55-63`).

```tao
test "edits a document on its own live destination" {
   run WordFlower
   enter "Home" into #workspaceName
   press #addWorkspace
   advance 3.s
   expect missing text "Saved"
```

Hypen: unit tests of host handlers, with a mock engine. The example apps' own tests assert on the *source text*
(`examples/social-contracts.test.ts:48`).

```ts
expect(messages).toContain('.onClick(@router.push, to: "/dm/@{item.id}")')
```

Hypen's `engine-compatibility-tests/` holds 69 JSON fixtures, each mapping source to expected patches, and runs them
under the TS, Go and Rust SDKs. That suite is the part worth studying.

### Tooling

| Tao | Hypen |
| --- | --- |
| Langium LSP and VS Code extension, formatter, source actions | `hypen-lsp`: diagnostics, completion, hover |
| `tao create, dev, build, ship, fmt, fix, check, test, …` | `hypen init, dev, build, studio, test, check, run ios, run android` |
| Studio renders fixtures and scenarios per device, scheme and network | Studio with a state inspector, timeline and device mirrors |
| Tao Skills | `skills/hypen-ui/SKILL.md` ships in the repository |
| — | `hypen check` is an accessibility linter |

### Escape hatches

Tao, *implemented* (`WF/@ui/Shell.tao:61, 135-142`):

````tao
let BuildStamp is text = BuildStamp() from ./Shell.ts
view Scroller() {
   render inject Content @@content, Layout @@layout, Tag @@tag ```ts
      return TR.Views.View({ children: <RN.ScrollView …>{Content}</RN.ScrollView>, layout: Layout, tag: Tag })
   ```
}
````

Hypen registers a custom component in *every* platform renderer (`hypen-web/packages/web/src/dom/components/index.ts:92`,
`hypen-renderer-swift/.../ComponentRegistry.swift:33`):

```ts
registry.register('VideoPlayer', { create: (props) => { /* … */ }, update: (element, props) => { /* … */ } })
```

Hypen calls platform APIs from host code on the server. Nothing lets a client call a device API.

### Authentication and authorization

Tao, *decided, not implemented*. There is no `@tao/auth` package yet, `access` has no grammar
(`Docs/Roadmap/Authority.md:59-66`), and whether authority is in the MVP is still open.

Identity is a library, and the root branches on the account with an ordinary `when` (`Decisions.md` §11):

```tao
use Account from @tao/auth
let Me = Account
view when Me { none -> WelcomeNav, otherwise -> SkilletShell(SkilletNavigator) }
```

Authority is deny-by-default and enforced by the store (`Decisions.md` §3):

```tao
audience Cooks for Household = Household.Memberships[Role in Owner, Cook].Person

access Recipe {
   read to Family of Household
   create, change to Cooks of Household
   change Shared, ShareCode through StartSharing or StopSharing
   delete to Owners of Household
}

transaction JoinWithInvite(Code secret) for Me returns Household {
   refuse when Invite.Email is not none and Invite.Email is not Me.Email
      "This invitation was sent to someone else."
```

Hypen has **no first-class authentication**. There is no guard, no user built-in, no route guard and no secure input
in the DSL. The pattern is conditional rendering on host state (`hypen-docs/content/docs/guide/control-flow.mdx:345`):

```text
If(condition: @state.isLoggedIn) {
    ProfileMenu()
    Else { LoginButton() }
}
```

Hypen's docs put authentication in the host HTTP layer, before the WebSocket upgrade
(`hypen-docs/content/docs/servers/typescript.mdx:546-581`). This example is docs-only; the built-in `RemoteServer`
upgrades every request without a check (`hypen-web/packages/server/src/remote/server.ts:494-498`):

```ts
const token = req.headers.get('Authorization')
if (!validateToken(token)) return new Response('Unauthorized', { status: 401 })
if (server.upgrade(req, { data: { userId: getUserId(token) } })) return
```

Login is ordinary action code (`typescript.mdx:617-621`, docs-only):

```ts
.onAction('login', async ({ state, context }) => {
  const success = await authenticate(state.email, state.password)
  if (success) context.router?.push('/dashboard')
})
```

Trust-boundary findings, all verified in code:
1. The TS server handles a client `updateState` message with `Object.assign(this.state, patch)`, so a client can set
   `isLoggedIn: true` (`hypen-web/packages/core/src/remote/remote-session.ts:337-339`,
   `hypen-web/packages/core/src/app.ts:1229-1230`).
2. Any registered action can be invoked, whether or not it is on screen.
3. A session resumes on whatever `sessionId` the client sends.
4. Action handlers cannot see who is connected, because `ActionHandlerContext` carries no session.
5. There is no Origin check, and the Go server allows all origins.
6. `SPEC.md:387` claims connections are "authenticated and signed (nonce + HMAC)", but no HMAC or nonce code exists.
7. There is a secure text field only on Swift (`inputType == "password"`).

The contrast is the widest in the whole comparison:
- In Tao the store enforces authority and screens only ask.
- In Hypen, authentication and authorization are entirely the host application's job, and the stock server trusts the
  renderer.

### Accessibility, animation and i18n

- **Accessibility.** Hypen is strong here:
  - The engine derives `Semantics` and sends them in `Create` patches (`hypen-engine-rs/src/ir/semantics.rs`).
  - `.label/.hidden/.liveRegion/.role` override them.
  - `Heading(level:)` is required, and `hypen check` enforces the rules.
  - Tao's plans are in `Docs/Roadmap/Accessible Tao apps/`.
- **Animation.** Hypen has portable `.enter(slide, fade, from: bottom)`, `.transition`, `.layout` (FLIP) and
  `.states(...)`, lowered to `__anim.*` props.
  - The DOM renderer implements them fully. Native renderers snap to the end state (`CHANGELOG.md`, Unreleased).
- **i18n.** Hypen has none. Tao has `phrase` with plural forms (`TA/Type System Tests/Type System Tests.tao`).

## How the Hypen runtime works

1. **Pipeline:**
   1. Source text is parsed by chumsky into an AST.
   2. The AST is lowered to `IRNode = Element | ForEach | Conditional | Router` (`hypen-engine-rs/src/ir/node.rs:57-113`).
   3. Components expand like templates or macros.
   4. Reconciliation builds a keyed instance tree and a `DependencyGraph`.
   5. A state update marks paths dirty, and only the dirty nodes re-resolve their props or re-reconcile.
   6. The engine emits a flat list of JSON patches.
2. **Patch protocol** (`hypen-engine-rs/src/reconcile/patch.rs:123-358`):
   1. The operations are `Create`, `SetProp`, `RemoveProp`, `SetSemantics`, `Insert`, `Move`, `Remove { transition }`,
      `Detach`, `Attach`, `RegisterTemplate`, `Instantiate` and `BatchAnimation`.
   2. Node ids are opaque strings.
   3. A list key is the explicit `key:`, otherwise the item's `id`, otherwise its position. Reorders use a
      longest-increasing-subsequence pass to emit minimal `Move`s.
   4. Patches travel as JSON with WebSocket permessage-deflate, one message per render, each with a revision number.
3. **State and logic live in the host SDK, never in the engine** ("The engine never mutates state on its own",
   `hypen-engine-rs/ENGINE_CONTRACT.md:29-31`).
   1. A tap sends `dispatchAction`.
   2. The host handler mutates a Proxy.
   3. The Proxy calls `updateStateSparse(paths, values)`.
   4. The engine responds with patches.
   5. Two-way binding is the built-in `__hypen_bind` action.
4. **Reactivity has no signals.**
   1. Dependencies are dotted paths, namespaced `mod:<scope>:path` or `ds:<provider>:path`.
   2. A change invalidates exact, ancestor and descendant paths (`hypen-engine-rs/src/reactive/graph.rs:181-214`).
   3. Arrays are leaves, so hosts must send sparse paths.
5. **Deployment:**
   - Web can run the WASM engine locally.
   - Desktop embeds the engine through `hypen-sdk-rs`, with a winit, wgpu, Vello, Taffy and AccessKit renderer.
   - iOS and Android are remote-only.
6. **Renderers:**
   1. Each renderer keeps a map from id to element with an observable per element: SwiftUI `ObservableObject`, Compose
      snapshot state, and the DOM.
   2. There are 31 primitives (`hypen-engine-rs/src/ir/component.rs:11-43`).
   3. Custom components need a handler in each platform registry.

### Ideas worth borrowing

1. **A shared engine-compatibility fixture suite**: source in, expected patches out, run by every SDK. This maps
   directly onto proving Tao's parity across targets and providers.
2. **Accessibility semantics derived centrally**, once for all platforms, plus a linter that fails the build.
3. **`Detach`/`Attach`** keeps an off-screen route's native state alive in a bounded cache. This is relevant to Tao's
   restored navigation stacks.
4. **Path-keyed invalidation with sparse updates** from a Proxy. This could inform how `TR` limits re-rendering after
   a `set`.
5. **Template registration** for list rows, with a lowering pass so older renderers keep working. It is a pattern for
   evolving a protocol without breaking old clients.

### Risks observed

1. Mobile is server-only. Offline use and latency depend on the network, and gaps in the patch sequence are dropped
   silently.
2. Parsing happens at runtime, the WASM engine is 2.2 MB, and Hypen's own benchmark has it slower than React.
3. State and props are stringly typed: `"@action"` strings, `"onInput.0"` keys, and action names that collide across
   modules and silently overwrite each other (`hypen-engine-rs/ENGINE_CONTRACT.md:195-198`).
4. The docs have drifted from the code: the router docs, the stale changelog, Swift's `AttachEvent`, and the HMAC
   claim.
5. The bus factor is one person, working from a private upstream.

## Investigation plan

### Setup

1. **Keep the clone out of Tao's tracked tree.** Do not commit the 2,152-file Hypen tree on a branch, and do not add
   it as a submodule.
   - Either would put foreign Rust, Swift and Kotlin into repository search, formatting and lint.
   - Instead, clone it into the ignored `.artifacts/research/hypen/` at a pinned commit, starting from `4e62ad1`.
   - Record the pin and all findings on this page, which is what the branch carries.
2. **Make the clone repeatable through `./agent`**, for example an `./agent research-clone hypen` operation, so every
   agent gets the same pinned tree. This needs the Developer's approval, because it changes developer automation.
3. **Agree the toolchain before any hands-on work.** Building the engine needs Rust, and the examples need Bun. Running
   the iOS renderer needs Xcode on the host. Installing a Rust toolchain into the dev environment is a dependency
   change, so the Developer approves it first.

### Passes

Each pass is a read-only agent brief against the pinned clone. Each returns findings with `file:line` evidence, which
are added to this page.

1. **Runtime deep dive, standard tier.** Map the patch protocol, the reconciler and the dependency graph onto `TR`
   (`packages/apps/runtime/TaoRuntime-src/`). Answer questions 7 and 8.
2. **Conformance and accessibility, standard tier.** Study `engine-compatibility-tests/` and
   `hypen-engine-rs/src/ir/semantics.rs`. Draft what a Tao fixture suite and an accessibility linter would look like.
   Answer questions 9 and 10.
3. **Mapping sketch, deep tier.** Hand-translate one WordFlower slice (the workspace list, add workspace, and push to
   detail) into Hypen DSL plus a TS host module. Tabulate every Tao construct as maps directly, maps with generated
   host code, or has no mapping. Answer question 2.
4. **Hands-on run, host lane, Developer present.** Run a Hypen example with the iOS simulator against a local server.
   Measure tap-to-paint and typing latency, locally and throttled. Answer questions 3 and 4.
5. **Ecosystem and governance, fast tier plus web.** Look at the upstream issue and pull-request history, release
   cadence and roadmap, and check whether an on-device mobile engine is planned. Answer questions 1 and 6.

### Exit

A short decision memo for the Developer with three possible outcomes:
- **Reject as a target and keep the lessons.** File the borrowed ideas as roadmap items.
- **Prototype an additional server-driven target.** Scope a spike.
- **Revisit at a named trigger.** For example, when Hypen ships an on-device mobile engine and a stable IR ingest.

Passes 1 to 3 need no approval beyond starting them, and can run in parallel. Passes 4 and 5 wait on the setup
decisions.
