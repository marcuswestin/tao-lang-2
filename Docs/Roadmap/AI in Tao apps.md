# AI in Tao apps — design exploration

Status: **exploration with recorded direction**. The Framing and the sketches began as a
thousand-mile overview; the Direction section records what dialogue with the Developer has since settled as
working direction for the first implementation slice. Nothing here is language law until it
reaches `Tao Revolution/Decisions.md`, which wins wherever the two collide.

## Framing

AI enters an app from three directions, and they want different language surfaces:

1. **The app as a tool** — an outside assistant (Siri, a phone-level agent, an MCP client) reads
   the app's nouns and runs its verbs. **This half is decided**: `Assistant { … }` is a closed
   projection of nouns, verbs, and searches; on iOS it compiles to App Intents, elsewhere to a
   tool schema. One block, every assistant. Its implementation is deferred until Tao has a tracked
   native iOS build path; T1–T5 ship only the in-app interaction consumers.
2. **AI as a capability inside the app** — the app calls a model to generate, classify, extract,
   converse, and act. This is the open half, and the bulk of this document.
3. **AI building the app** — Studio agents writing Tao. Out of scope here, except for one
   observation: everything below that makes AI calls reviewable (closed projections, typed
   outputs, scripted models in tests) also makes AI-written code reviewable. The same properties
   serve both.

The through-line: this is Tao's answer to what Apple and Google are doing with `@Generable` in
Swift and structured output in Kotlin — and it is a _stronger_ answer, because in Tao the schema
already exists:

> **The `data` declaration is already the generation schema.** An entity's typed slots, its case
> types, its `required` sentences, and its `validate` rules are exactly what a structured-output
> API needs — and they are already written, in plain English, at the point the data is declared.
> Swift and Kotlin bolt a schema annotation onto a struct; Tao's entity _is_ one.

Everything below leans on that, plus three other decided principles: **deny by default** (a model
sees nothing unless listed), **honest multi-state values** (a generation is
`generating / ready / failed` the way a permission is `granted / denied`), and **swappable
implementations** (tests bind a scripted model the way previews bind `Datasource Memory`).

The deeper claim, proven by the sketches throughout: at runtime the language surface is a thin
layer over an SDK-equivalent implementation — that layer exists either way — but the _compiler_
seeing generation is what makes the guarantees possible. A library call is opaque; a language
form is where types direct schemas, guides are copy, projections are checkable, lifecycle
composes, and tests script. The surface is not decoration on the SDK; it is the collection point
for every guarantee the rest of Tao already makes.

## Direction settled so far (2026-08-30, with the Developer)

- **Platform-provided AI only, for now.** The first slice targets each platform's own on-device
  model (Apple Foundation Models first). No custom `model` provider bindings, no bundled local
  runtimes, no cloud lane yet — those return later as bindings _over_ this slice.
- **Language surface over SDK surface.** Apps author `generate` (a keyword), not library calls.
  A stdlib `@tao/ai` still exists for what is legitimately a value: availability, and later
  configuration. The SDK-equivalent machinery underneath is shared with Studio tooling.
- **One verb.** Text, case-type classification, and entity drafting are all `generate`; the
  target type does the work. No `Write` / `Draft` / `Choose` fragmentation.
- **Slot-typed targets.** The target type comes from the slot when there is one
  (`Pitch text = generate from Recipe "…"`); it is written after `generate` only in positions
  with no slot (`generate Recipe from Photo "…"`).
- **`from` carries inputs; `with` is reserved.** `from` already means source/origin everywhere
  in Tao; generation inputs are source material. `with` already means plus-configuration
  (keywordized bindings, commands) and is reserved for future generation options.
- **Guides are copy positions.** The trailing sentence is source copy in a compiler-owned
  position, like `required "…"` — extractable, locale-aware (the compiler can inject the user's
  language for output), never an opaque string parameter.
- **Generation is a live multi-state value** (`generating / ready / failed`) whose streaming
  display falls out of ordinary reactivity, with view-lifetime cancellation and a derived re-run
  key. Never a promise, never a boolean.
- **Concurrency reuses the general `runs` vocabulary.** `generate … runs latest` consumes the
  decided-but-unimplemented `runs single / runs latest` policy from `Decisions.md` §8. That
  decision is general to actions, not AI-scoped; the AI work consumes it, never forks it. A
  separate spike implements it (noted in `Roadmap.md`, the Developer's stack).
- **Prompt inputs are explicit at the call site.** The developer chooses what the model reads:
  field paths, and inline projections for rows and lists. Rich generations use a clause block
  (see the surface below). There is no app-level `Sees` registry for direct generation — that
  idea over-extended (double bookkeeping, action at a distance) and returns only where it is
  structurally required: agents, where the _model_ chooses what to read. Two rules survive
  app-wide: `secret` values never serialize into a prompt, ever; and the compiler knows every
  generation's input closure, so the app's complete prompt surface is a _derived report_
  (`tao check`), not an authored block.
- **Scripted models are in scope from day one.** `model answers …` / `model fails` in scenarios,
  schema-checked at test-compile time. Apple ships no _determinism_ story for Foundation Models
  (no mock, no record/replay; community practice is hand-rolled protocol seams), so this is
  differentiation, not parity. Apple's WWDC26 **Evaluations framework** covers the other tier —
  graded, statistical evals — and validates the two-tier model Tao should follow (see Testing
  and evals).
- **Agent-run-as-one-undo-step is targeted** (see Agents below): default, zero developer work,
  derived by grouping a command invocation's writes. Dependency: the derived-undo tranche.
- **Keywords for universal verbs; reified schemas at the boundary for the long tail.** Tao stays
  reflection-free. A sidecar declared `returns Recipe` receives a generated codec
  (`returns.decode(json)`) so any TS library gets typed decoding without type-as-argument
  surface in Tao. New keywords must earn their place by carrying guarantees a boundary function
  cannot (copy, projections, lifecycle).
- **Deferred but liked**: provenance on generated rows, AI-maintained fields (see Deferred
  ideas).
- **Pragmatic OS posture, no hard rule.** The implementation spike was verified on macOS 26.5,
  Xcode 26.6, Expo SDK 54 / RN 0.81, with Foundation Models `available`. The repository moved to
  Expo SDK 57 / RN 0.86 on 2026-09-15 for macOS and Xcode 27 compatibility; re-run the native
  proof before treating that host combination as verified. Tao apps may assume the latest iOS.

## The `generate` surface

The recommended developer experience, whole:

```tao
use Intelligence from @tao/ai                        // availability + config live here

// Slot-typed, the common case: type from the slot, sources after from, guide as copy.
Pitch text = generate from Recipe "Write a two-sentence teaser."

// Expression-typed, when there is no slot.
let Draft = generate Recipe from Photo "Read the recipe in this photo."

// Classification: a case type is just a narrower target.
Course = generate from Recipe.Title                  // one of Starter, Main, Dessert

// Rich generations use the block form: one clause per line, sources with inline
// projections, the guide inside. Inline and block are the same construct.
Plan = generate MealPlan {
   from Recipes where Favorite { Title, Course, Servings }
   from Pantry { Name, Quantity }
   guide "Plan a week of dinners using what's on hand."
}

// Display: a generation is a multi-state value; streaming is just reactivity.
when Draft {
   generating -> RecipeCard(Draft)
   ready      -> RecipeEditor(Draft)
   failed     -> Text("Couldn't read that photo. Try a clearer shot?")
}

// Live re-generation is opted into with the existing concurrency word.
Ideas text = generate from Query "Suggest related topics." runs latest

// Writing it durably: the same verb in a write position.
transaction SummarizeNote(Note) for Me {
   update Note { Summary: generate from Note.Body "One sentence: what this note is about." }
}

// Availability rendered honestly, like a permission.
when Intelligence {
   available -> Button(Import)
   otherwise -> Text("On-device intelligence isn't available here.")
}
```

What the surface claims:

- **The model cannot produce an ill-typed value.** The target type compiles to the platform's
  guided-generation schema (`@Generable` on Apple platforms, JSON schema elsewhere), the same
  way `Assistant` compiles to App Intents. There is no parse-and-hope step.
- **`validate` guards generation like any other write path**; a draft that fails is rejected
  (or retried — implementation policy), never stored. **`required` sentences do double duty**:
  completeness copy for a person, guidance for a model; a generated draft can come back
  `Incomplete` and flow into the ordinary draft-editing story.
- **Syntax rhymes with queries in shape, not verb.** A query asks the store; a generation asks
  the model; both are target-first clause forms yielding live values rendered with `when`. The
  verb stays distinct because it is the price tag: a generation costs and is nondeterministic,
  and dropping the word would hide both.

### Initiation: three explicit modes

The load-bearing difference from `query` is re-run semantics. A query is cheap, pure, and
idempotent, so reactive re-execution is free and correct. A generation is a slow, costly,
nondeterministic effect — so when it runs is declared, never an accident of reactivity:

1. **Intent-started** (the default): a person triggers an action; the value holds the result.
2. **View-scoped, once per distinct input**: the view exists to show the generation
   (`ImportScreen` above). Starts on appearance, keyed by its derived input closure, never
   silently re-streams because a dependency changed.
3. **Declared live re-generation**: `runs latest`, the ask-as-you-type case, with cancellation
   semantics from the general concurrency decision.

Lifecycle is the language's job: a view-scoped generation cancels when the view goes away; the
re-run key is derived from the input closure, not hand-chosen. (The React Native equivalent is
~20 lines of `AbortController`, stale-response guards, and hand-picked `useEffect` keys per
call site — all of it absent here because the compiler sees the construct.)

## Prompt inputs and the prompt boundary

The developer chooses what the model reads, at the call site — which is what AI developers
already do today when hand-assembling prompts; Tao removes the untypedness, not the discipline.
Simple generations stay inline; anything richer moves to the clause block, one concern per line:

```tao
// Inline: field paths are already explicit, typed, and reviewable.
Pitch text = generate from Recipe.Title, Recipe.Ingredients "Write a two-sentence teaser."

// Block: sources with row filters (where) and field projections ({ … }), guide inside.
Plan = generate MealPlan {
   from Recipes where Favorite { Title, Course, Servings }
   from Pantry { Name, Quantity }
   guide "Plan a week of dinners using what's on hand."
}
```

- **The projection braces are the same shape everywhere** — `Assistant { Recipe { Title, … } }`,
  data literals, and now prompt sources — one syntax for "these fields of that entity."
  (`show Title, Course` was considered as a keyword alternative; braces won on reuse.)
- **The block is the growth path**: `guide` is the same copy position as the trailing string,
  and future clauses (options via `with { … }`, `runs latest`) slot in without reshaping the
  call. Inline and block are one construct, formatter-convertible.
- **`secret` values never serialize into a prompt** — excluded by the language, not by
  omission, and not fixable by listing.
- **The prompt surface is a derived report, not an authored registry.** The compiler knows every
  generation's input closure, so `tao check` can print exactly what the app tells its model —
  always accurate, no bookkeeping. Centralized `Sees` declarations return only for agents,
  where the model (not the developer) chooses what to read (see Agents).

## Agents

The agentic case — the model reads, decides, and acts toward a goal — composes from parts the
language already has: **commands are the tools** (a titled command is a tool definition), **access
rules are the sandbox** (the agent acts as `Me`, never more), and the allow-list is the
`Assistant` block turned inward:

```tao
agent Planner {
   Goal "Plan meals for the coming week."
   May Find Recipes by Title, Course
   May CreateMeal, MoveMeal, AddToGroceries
   Sees Recipe { Title, Course, Servings }
   Asks before AddToGroceries                     // writes it must confirm with the person
}
```

**Targeted now: one agent run is one undo step, by default.** The decided undo model derives
every store write's inverse; the runtime dispatches the agent's command invocations, so grouping
their writes into one undo unit requires no developer work — "undo that" after "plan my week"
un-plans the week. This is the single most trust-building feature of the section. Dependency:
derived undo is decided but unimplemented, so its tranche becomes a prerequisite on the AI path.

`Sees` lives here now, not on the app: an agent declares its read surface because the _model_
chooses what to read mid-loop — direct generation needs no registry since the developer chooses
at the call site. Each agent's `Sees` is its own allow-list, the `Assistant` projection pointed
inward. The rest of the agent block (May / Asks before, conversation surfaces, generative UI
with a closed component palette) remains exploratory — see Deferred ideas.

## Testing and evals

Two tiers, and the platform now agrees they are different things. Apple's WWDC26 **Evaluations
framework** grades intelligent features statistically — eval datasets in Swift Testing, defined
metrics, model judges for qualitative criteria, score reports in Xcode, and a `makeSamples` API
for synthetic dataset growth. What Apple still does not ship is _determinism_: no mock, no
record/replay, no seeded mode for `LanguageModelSession`; community practice remains a
hand-rolled protocol seam per app. So the two tiers are:

**Tier 1 — deterministic scenarios** (the suite): scripted models woven into the scenario
language, with scripted answers schema-checked against the entity at test-compile time:

```tao
scenario ImportFromPhoto {
   model answers Recipe { Title: "Shakshuka", Course: Main, Servings: 2 }
   do ImportRecipe(ShakshukaPhoto)
   expect Recipes has { Title is "Shakshuka" }
}

scenario PhotoTooBlurry {
   model fails
   do ImportRecipe(BlurryPhoto)
   expect ImportScreen shows "Couldn't read that photo. Try a clearer shot?"
}

scenario AgentStaysInItsLane {
   as Planner do DeleteRecipe(Shakshuka)
   expect refused
}
```

**Tier 2 — evals** (the QA line): live-model runs graded over datasets, never in the
deterministic suite. Tao's opportunity is that eval structure can be _derived_ where Apple's
must be hand-defined: schema conformance is guaranteed by construction, so the metrics that
matter are the declared ones — `validate` acceptance rate, `required` completeness rate, refusal
rate — plus judge rubrics written as ordinary copy. And the fixture generator _is_ the
`makeSamples` analog: synthetic eval inputs are generated rows. A sketch to provoke:

```tao
eval ImportQuality for ImportRecipe {
   over PhotoSamples                                        // a dataset of fixture inputs
   expect Draft is Complete at least 80%                    // derived from required sentences
   judge "The title names the dish, not the website." at least 90%
}
```

Open: where eval declarations live (Scenarios.tao's QA line?), whether judge runs use the
platform model or a stronger one, and how results pin to a model version so an OS update that
shifts quality is caught as a regression rather than discovered by users.

## Platform and implementation plan

The ecosystem has converged on the Vercel AI SDK provider interface as the unifying seam, and
both halves of the story exist as maintained providers of it:

- **In-app (iOS)**: `@react-native-ai/apple` (Callstack) — Foundation Models via the AI SDK
  shape; structured output uses native guided generation on iOS 26+; streaming and tool calling.
  Requires RN ≥ 0.80 + New Architecture; the repository's Expo SDK 57 / RN 0.86 qualify. Preview
  status, so it sits behind our own seam and is swappable.
- **Studio server (macOS)**: the stable Swift helper won the implementation spike.
  `@meridius-labs/apple-on-device-ai` 1.6.2 loaded under Bun and reported Foundation Models
  available, but its guided `generateObject` path failed against a real WordFlower schema with
  `Failed to deserialize a Generable type from model output`. The replacement compiles with the
  installed Xcode 26.6, binds an authenticated ephemeral loopback port, receives its bearer secret
  over standard input rather than process arguments, and streams compact dynamic-schema snapshots
  as NDJSON. The Studio developer process owns its lifetime, reports a post-start helper exit as
  unavailable, and applies explicit availability and generation deadlines without silently retrying
  a generation. The helper bounds and validates its small HTTP surface before authentication. The
  Studio preview still speaks only HTTP to the Studio server, keeping model access webview-agnostic.
  No beta OS or Xcode is required. Adopt Apple's `fm serve` behind the same seam when it reaches the
  stable toolchain and is the better implementation.
- **Shared machinery**: one entity→schema compiler and one AI-SDK-provider client, used by the
  compiled app, the Studio server, and the scripted test binding alike. Built in the shared
  packages, never Studio-private, so the stdlib and the keyword lower onto it without
  reimplementation.
- **Year two on the platform (WWDC26)**: Foundation Models gained image input (validating
  `generate Recipe from Photo` as a platform-native capability), server-side routing to
  third-party models (Claude, Gemini) through the same Swift API, Dynamic Profiles for
  multi-agent workflows, free Private Cloud Compute access for smaller apps, and the framework
  is being open-sourced. These likely require the newest OS/Xcode — the case where upgrading is
  warranted when we reach for them (per the no-hard-rule posture). The server-side routing in
  particular may make a future cloud lane a platform feature rather than a Tao-built one.

Per-platform adapters behind one contract, where honest `unavailable` is itself the day-one
cross-platform support — platforms graduate one at a time:

| Where Tao runs           | Adapter                                             | When        |
| ------------------------ | --------------------------------------------------- | ----------- |
| iOS / macOS app targets  | `@react-native-ai/apple` → Foundation Models        | now         |
| Studio preview, any host | HTTP to the Studio server → host's platform AI      | now (macOS) |
| Android                  | ML Kit GenAI / AICore (Gemini Nano)                 | deferred    |
| Windows Studio host      | Windows AI Foundry / Phi Silica, same server bridge | deferred    |
| Production web           | browser Prompt API where present, else unavailable  | deferred    |

## Driving use cases and sequence

1. **Studio fixture generation** (the driver) — **landed 2026-08-30**: "generate a realistic named state for this
   scene" — the model fills entity rows from their own declarations, schema-constrained,
   with the shared validate-before-accept gate, saved through the existing capture path into the
   named-state library.
   Exercises the entire pipeline with no app UI and no language work; Studio calls the shared
   TS machinery directly. The shared package now owns the entity/case schema compiler, Apple and
   deterministic scripted providers, streamed partial/final contract, schema checker, and
   terminal validate-before-accept gate. The compiler publishes generation declarations in the
   Studio manifest; secrets are unconditionally excluded and relations remain opt-in. Studio
   exposes availability and fixture generation on its existing HTTP server, and its data-state
   control saves accepted proposals through the same `insert-captured-fixture` source action as
   hand capture, with explicit generating and failed states and no retry. A fixture source patch is
   accepted only when Tao compilation succeeds; a failed compile restores the exact previous source.
   Studio preserves executable `now` time values instead of generating timestamps it cannot author,
   and rejects fixture topology it cannot preserve. The Apple live check is explicitly opt-in;
   deterministic tests use only the scripted binding. Current Tao does not yet author entity
   `validate` declarations, so Studio has no authored rules to supply today; adding those declarations
   remains language work for the later tranche. The shared gate is wired and tested for rules and
   durable acceptance failures without deciding the retry-policy open question below.
2. **The `generate` tranche**: grammar, validator, formatter, compiler lowering, the runtime
   multi-state value, and the scripted-model test surface — in scope together, since the keyword
   without `model answers` is untestable. Mode 3 (`runs latest`) waits for the separate
   concurrency spike (`Roadmap.md`, the Developer's stack); the slice is complete without it.
3. **WordFlower "Suggest a title"**: the first product use, one generation behind a button,
   written in Tao, tested with the scripted model, demoed in Studio.
4. Later, in tranche order as decided: `Sees` enforcement, agent grouping over the undo tranche,
   and the Deferred ideas below as they earn slices.

## Deferred ideas (liked, not scheduled)

- **Provenance on generated rows.** The store stamps how a row came to be, the way `(ordered)`
  positions are store-kept — "AI-suggested" badges, review queues, and "clear all suggestions"
  become queries: `loop Recipes where Origin is Generated { … }`.
- **AI-maintained fields.** A field the store keeps current via generation, declared like a
  storage fact: `Summary text (generated from Body "One sentence: what this note is about.")` —
  auto-tagging and auto-summaries as one line, recomputation owned by the provider.
- **Semantic caching and offline.** The compiler knows a generation's full input closure
  (projection + guide + model version), so identical asks can be cached rows — even declared in
  `Offline { … }`.
- **Conversation as a surface.** Generative UI with a closed palette: the model chooses among
  the app's declared components (`Recipe -> RecipeCard(Recipe)`), never invents markup; the
  transcript is ordinary data. Likely stdlib (`@tao/conversation`) per the identity precedent.
- **Meaning-aware search.** `(search by meaning)` as the embedding sibling of `search`;
  `Find Recipes like "cozy winter dinner"` on the query side, exposable through `Assistant`
  unchanged.
- **AI in automations.** A model step where a computed value goes (a weekly `notify` body),
  subject to `Sees` and to "an automation cannot write."
- **Custom model providers.** The exploration that predated the platform-first decision —
  `model Sous = Model { Prefer OnDevice, Fallback Claude }`, cloud lanes, budgets — returns as
  keywordized bindings over this slice when more than one implementation exists to bind.

## Open questions, gathered

1. What a bare row source (`from Recipe`, no projection) serializes — leaning scalar fields
   only, relations never implicit — or whether whole-row sources simply require a projection.
2. Guides and translation: output follows the user's locale (compiler-injected) — do guide
   sentences themselves join the translation pipeline?
3. What is a partial generated value — an incomplete draft row being filled by a non-human
   editor, or a distinct type? (The draft-row reading remains appealing.)
4. `agent` blocks: one mechanism with `Assistant` scoped two ways, or two declarations? Is
   `Never DeleteRecipe` contract or comment when the allow-list is closed?
5. Retry-on-validate-failure: implementation policy or declarable?
6. The QA line for live models: does it record transcripts for replay?
7. Which additional universal verbs earn keywords next (`parse X from …`?) versus staying
   boundary codecs?
