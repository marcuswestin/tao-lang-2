# Plan - Studio agent chat

Status: **proof-of-concept plan, not a production design**. This document defines the next disposable
slice of the semantic agent exploration: a freeform chat in Tao Studio in which a model works through
Studio-supplied tools until a request is satisfied. It absorbs the decision ledger (SAI-D001 through
SAI-D028) and the open questions (through SAI-Q045) of the first, on-device PoC
(`Docs/Archive/Explorations/Exploration - Semantic agent proof of concept.md`, retired 2026-09-05) —
see "Absorbed from the retired on-device PoC" below — and continues both ledgers as SAI-D029 onward
and SAI-Q046 onward in this document's own "Implementation record".

Like its predecessor, this plan does not amend `Docs/Roadmap/Tao Revolution/Decisions.md` and does
not define a supported Studio or compiler API. The implementation landed on `main` on 2026-09-04 as
a proof of concept behind the Agent rail panel; it remains disposable, and nothing else in the
repository may depend on its modules or routes. The Developer decides language semantics, roadmap priority, and product behavior; the implementing agent
decides everything else here from repository evidence and its own judgment.

## Why a second approach, and why it coexists with the first

The first proof of concept established that an on-device model can ask Tao compact semantic questions
and request typed changes that Tao lowers from the semantic graph. Its planner is deliberately closed:
classify a request into one of a few feature kinds, shape it, validate every operand against facts,
lower it deterministically. That gave hard guarantees on a narrow demo and taught the most valuable
lesson so far - the model names the intent, Tao derives the code.

That design was also a workaround. The on-device model has roughly a 4k-token window and no room for
an iterative loop, so the PoC never let the model work: read, act, observe, act again. Coding agents
get their power from exactly that loop. This slice explores the loop as a **second
mode** in Studio, with two constraints that make it safe without a sandbox:

1. **Tools only.** The model never gets a shell, never writes scripts, never names a filesystem path.
   Every action is a tool Studio implements, scoped to the open project's Tao sources, validated by
   the compiler, checkpointed, and undoable. Safety lives in the tool implementations, in the same way
   `lowerReword` refuses an invented placeholder today.
2. **Cloud models, opted into.** Bigger tasks use a hosted model through the AI SDK, provider-agnostic.
   The on-device path stays as it is, next to the new one, and the two are not unified for this slice.
   Reuse is expected where it speeds the work (the semantic snapshot and its queries, the apply and
   undo seams, the test verdict, the fixture generator); unification is not.

Decisions taken for this slice, to be recorded as SAI-D029 onward once the implementer confirms them:

- The loop is the AI SDK (`ai`, v6 or later): `ToolLoopAgent` or `generateText` with `stopWhen`, tools
  defined with `tool()` from JSON Schema or zod, structured stage outputs with `Output.object`, and
  `needsApproval` on every tool that writes. The loop runs in the Studio server process, never in the
  browser client, so credentials and source never pass through the client.
- Provider choice is configuration, not code. Anthropic and OpenAI are both wired, chosen per session
  in the panel, with `TAO_STUDIO_AGENT_PROVIDER` naming where a session starts; each model id is a
  setting with a sensible default. A community on-device provider for the AI SDK exists and may be
  evaluated for read-only turns, but nothing in this slice depends on it.
- Sending project source to a hosted model is an explicit, visible, per-session choice in Studio. No
  cloud call happens before the user has turned it on, and the panel says when it is on.
- The chat has a Tao-owned step budget and a per-turn cost ceiling. When either trips before the task
  is done, the agent says what it did, what remains, and stops; it does not silently continue.

## Absorbed from the retired on-device PoC

The first semantic-agent PoC ran four journeys against Apple Foundation Models on-device
(`SystemLanguageModel`, 4,096-token window) against WordFlower and HNReader, proving that Tao could
serve as a semantic interface between an agent and a project: a compact structured overview instead
of source, progressive inquiry, cross-cutting answers with compiler-fact-versus-inference labeling,
typed semantic change requests lowered to ordinary Tao source, and undo. Its full journey narratives,
context/performance tables, and PoC-shortcut list are historical detail kept only in the archived
document; the decisions, open questions, and design rationale that are still true continue below.

### Decision ledger (SAI-D001-028)

| ID            | Status             | Working decision                                                                                                                                                                                                                                                                                            | Consequence                                                                                                                          |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SAI-D001      | Direction to prove | Tao, not the model, is the semantic authority for the project.                                                                                                                                                                                                                                              | Semantic facts come from resolved Tao/compiler state; the model interprets and communicates them.                                    |
| SAI-D002      | Direction to prove | The model should progressively inquire from product overview to declaration detail to exact source.                                                                                                                                                                                                         | Do not begin by placing whole files or the whole project in the prompt.                                                              |
| SAI-D003      | Direction to prove | Tao should return projections of a semantic project graph rather than search-result-shaped text.                                                                                                                                                                                                            | At least one demo must answer a cross-cutting question through structured nodes, edges, and facts.                                   |
| SAI-D004      | Direction to prove | The reverse interface should express changes in product/declaration terms rather than raw text or public AST surgery.                                                                                                                                                                                       | At least one demo change begins as a typed semantic request such as changing a design value, adding a field, or adding a scenario.   |
| SAI-D005      | Direction to prove | Tao should lower semantic requests to current source, formatting, validation, compilation, preview, and undo.                                                                                                                                                                                               | The successful write demo must end in ordinary Tao source and a visible Studio result.                                               |
| SAI-D006      | Direction to prove | Compiler evidence should remain distinguishable from model inference.                                                                                                                                                                                                                                       | Answers identify which claims are Tao facts and which are AI suggestions.                                                            |
| SAI-D007      | Direction to prove | Compact semantic context may let a small local model perform useful project work faster and with fewer tokens than source search.                                                                                                                                                                           | Supported only in the narrow sense that an answer exists at all on a 4k window — the 4k window dominates any token-count comparison. |
| SAI-D008      | PoC boundary       | The model ran strictly on-device through Apple Foundation Models on macOS, with no cloud fallback (this slice adds a hosted-model mode; see above).                                                                                                                                                         | Unavailable local intelligence is reported honestly.                                                                                 |
| SAI-D009      | PoC boundary       | The first write path is proposal-first and person-reviewed.                                                                                                                                                                                                                                                 | The model does not silently change source; Studio shows a proposal before application.                                               |
| SAI-D010      | PoC boundary       | Existing Studio identity, proposal, compile, preview, checkpoint, and undo seams may be reused opportunistically.                                                                                                                                                                                           | No replacement source-action architecture was designed.                                                                              |
| SAI-D011      | PoC boundary       | MCP is an optional adapter, not a prerequisite for proving the core interaction.                                                                                                                                                                                                                            | A private Studio endpoint or in-process API is sufficient.                                                                           |
| SAI-D014      | Direction to prove | Source is a detail that the model requests only when semantic facts are insufficient.                                                                                                                                                                                                                       | Held: no raw-source fallback occurred in the on-device PoC's semantic path.                                                          |
| SAI-D015-D019 | PoC convenience    | Forcing app WordFlower `1 - Current`; `set-design-entry` action; snapshot rebuilt from the Langium AST per request with no caching; a throwaway Swift helper bridging Apple Foundation Models tool calls; Tao normalizes a model's `bundle` operand against the app design's real members before proposing. | Documented shortcuts; none promoted to product architecture.                                                                         |
| SAI-D020      | Direction to prove | A feature request in words is split in two: the model chooses only the feature's **shape**, and Tao decides every **placement** by copying the pattern of an analogous existing declaration.                                                                                                                | "Add a feature by describing it" lowered into three files without the model authoring any Tao.                                       |
| SAI-D021-D023 | PoC convenience    | The feature lowering supported exactly one shape (a yes/no field plus its action, checkbox, fixture row, and scenario); the multi-file write bypassed the source-action checkpoint bus with one undo record; Tao corrects a recoverable wrong operand and says so.                                          | Documented shortcuts.                                                                                                                |
| SAI-D024      | Direction to prove | The model sorts a request into a change kind before it shapes anything; a request outside the known kinds is answered as such rather than forced into the one shape available.                                                                                                                              | A planner with one shape cannot decline, and a wrong plan reads more confident than no plan.                                         |
| SAI-D025      | Direction to prove | An analogous declaration is a preference for placement, never a precondition; Tao places from the declaration's own structure when no analogue exists, and the plan says which rule applied.                                                                                                                | Unblocks the first flag in an app with no existing analogue.                                                                         |
| SAI-D026      | Direction to prove | Placements are staged as ranges against each file's original text and each file is rewritten once.                                                                                                                                                                                                          | A whole-file edit per placement is only correct when no two placements share a file.                                                 |
| SAI-D027      | Direction to prove | Model-authored text that ships must be checkable against the graph: a reword may only use placeholders the line already had or fields of an entity the view takes.                                                                                                                                          | Total guardrail against an invented value; wording quality remains the weak, unguarded part.                                         |
| SAI-D028      | Direction to prove | An applied change is judged by the app's own behavior tests, measured before and after, so the verdict names what the change broke.                                                                                                                                                                         | A verdict without a baseline, or for an app with no tests, is reported as unknown rather than success.                               |

### Open questions (SAI-Q001-045)

Product and experience: primary Studio surface for the agent (command menu, contextual suggestions,
chat, inspector context, or several); grantable scopes (selection, render occurrence, scenario cell,
view, file, app, project); how to distinguish Tao facts from AI inferences and uncertainties in the
UI; which changes always require review versus could eventually apply immediately; whether "Review
this screen" is a real product feature or only the PoC forcing journey.

Semantic model and queries: the eventual canonical semantic model (materialized graph, on-demand
compiler query layer, domain indexes, or a combination); which node/edge kinds are stable enough to
expose beyond compiler internals; which identity is durable across source changes, moves, renames,
aliases, generated output, and configured variants; how a query should express scope, relationship,
depth, projection, ordering, evidence, and token budget; which relationships the compiler can prove
today versus need new static analysis or runtime instrumentation; how runtime values, action history,
provider activity, navigation, and render bindings join the authored graph without becoming false
language authority; what Tao returns for a partial, expensive, ambiguous, stale, or unsupported
answer; whether answers should be graph fragments, task-specific result types, or both; how source
excerpts are selected and bounded when semantic context is insufficient.

Semantic changes: the eventual public abstraction for changes (declaration operations, a semantic
patch IR, source actions, compiler refactorings, or layered forms of all four); how a multi-declaration
change declares intent, dependencies, preconditions, and expected effects; how comments, authored
ordering, copy, formatting, and intentionally unusual source are preserved; which operations can be
lowered deterministically versus still need the model to author Tao expressions or blocks; what is
atomic when one semantic request produces several file edits, compilations, fixture changes, and
scenario changes; how conflicts and partial success behave when source changes after a proposal;
which semantic operations are expressive enough to implement a feature without growing into a second
programming language; whether a proposed change can carry an intended behavioral result that Tao can
verify independently of its exact edits.

Agent boundary and trust: whether Studio can derive an agent's authority from an `Assistant`-like
closed projection, or development tooling needs a distinct declaration/trust model; how `secret`,
credentials, captured provider data, foreign-code details, and user data are excluded or redacted from
semantic responses; how prompt injection in source copy, comments, fixtures, imported packages, or
runtime data should affect instructions and tool authority; what audit trail, provenance, confirmation,
undo, and recovery an agent run requires; whether one agent run can become one undo step before the
general action-transaction contract is settled.

Local model and evaluation: which tool shapes and structured response schemas Apple Foundation Models
follows most reliably; what context size, latency, tool-call count, and raw-source fallback rate make
the semantic path meaningfully better; which benchmark questions measure real semantic advantage
rather than a convenient demo; how prompts, tool schemas, and results should be versioned as Apple's
system model changes; which failures belong to model capability, deficient Tao semantics, a poor query
protocol, or the provisional implementation (the observed on-device PoC failures split cleanly by
cause — guided-generation drift after tool calls, a repeat-tool-call loop on errors, and name
confusions were model/protocol issues, not missing Tao semantics; list-truncation in `overview` was
the one Tao-side gap); which semantic projections are worth the on-device model's 4,096-token budget,
and whether Tao should budget per turn rather than per tool result; how Tao should resolve a
near-miss declaration name (literal request, refusal with candidates, or resolve against the
question's own text); whether a semantic change request should carry the model's rationale as a
first-class operand Tao can check against; whether a silent repair, a visible plan step, or a question
back to the model is right when Tao corrects a model operand; which "analogous declaration" relation
the production graph should expose, given the structural rule underneath it (last field, render
block, last render) is what actually generalizes; who judges the wording when the model writes text a
person will read, since the graph can prove a reword compiles and cannot prove it reads well; how a
plan should report a step it cannot take; whether an agent's change should apply at all when it breaks
a test, or hold unapplied until a person rules on it; whether an agent should also be asked to write
the journey for what it built, and whether a test it wrote itself is evidence.

Protocol and ecosystem: the core versioned local protocol, independent of Foundation Models, Studio
UI, and MCP; whether external agents receive the same semantic operations as Studio's local agent or a
narrower capability projection; what belongs in compiler output, an always-live workspace service, a
Studio session, the CLI, or an MCP adapter; how the protocol stays useful to deterministic tools and
humans rather than becoming an AI-only duplicate of existing compiler APIs.

### Recommendation carried forward

The on-device PoC's exit recommendation was to proceed to a hosted-model design phase (this slice)
starting from three constraints it made concrete: a small-model token budget per interaction, exact
declaration names as the model's weakest skill (so queries should tolerate or correct near-misses and
Tao should validate every operand against facts before lowering), and typed reads/writes in the
compiler so `poc-derived` edges become compiler facts. Free-form tool calling should stay, but with a
Tao-owned budget and repeat suppression rather than model discipline. Its sharpest finding was that
the most valuable division of labour is not "the model writes code Tao validates" but **the model
names the intent and Tao derives the code from an analogous declaration already in the project** —
which inverts where correctness comes from, and which SAI-D024/D025 above generalize.

## The three user stories

The Developer selected these three, with the caveats recorded under each. They are the acceptance target: each
one is done when a person can do what the story says in Studio, against HNReader and WordFlower,
without touching source by hand.

### Story 1 - Ask the app anything

> As someone opening HNReader for the first time, I type "what happens when I tap a story?" and get a
> plain answer - "it invokes `OpenStory`, which sets `selected` and renders `StoryView`; the title
> comes from `Story.title`, styled by the `heading` bundle" - where every name is a link that opens the
> exact source in Studio. I follow up with "which of that is covered by tests?" and "where does the
> green come from?"

The Developer's caveat: the chat must also answer **advisory and structural** questions, not only relational ones:

- "Give me an overview of what this app does and how it is structured, in terms of files and so on."
- "What are areas of improvement to tackle next?"
- "What do you suggest to implement as the next meaningful feature?"

The answers to the advisory questions are the model's judgment, but they must be **grounded**: every
suggestion cites the facts it rests on, and those facts come from tools, not from the model's memory of
what apps usually need. Views without a scenario, actions never invoked, fields never read, literals
that appear in no test, compile problems, design tokens declared but unused, one view carrying most of
the renders - these are the kinds of facts an "areas of improvement" answer is built from. An answer
that cannot cite a fact says so.

Why Studio: the relational answers come from `renders`, `invokes`, `reads`, `writes`, `styled-by`, and
`covers` edges, which see what text search cannot (a token reached through a bundle, a field read
through a query). The evidence links already exist in the PoC panel. The structural and advisory
answers come from the same graph plus the file list and per-file declaration outlines.

### Story 2 - Describe a state, see it; and check a unit's tests

> I type "show me the front page with no stories, and with one story that has 1,200 comments and a
> very long title." Two new cells appear in the preview grid, populated with realistic fixture data. I
> say "the empty one should say 'Nothing yet' - make that a test," and the agent writes a behavior test
> that pins it, runs it, and shows it red until I fix the view.

The Developer's caveats:

- The person describes the scenario they want to develop against or test; Studio works out which
  scenario entries, fixtures, subjects, and environment clauses are required to produce it.
- If achieving what was asked would **also require code changes** (a view parameter that does not
  exist, a state the app cannot yet be in, an environment the scenario surface cannot express), the
  agent must say so and get the person's agreement **before** it creates anything. This gate is
  enforced in code, not only in the prompt: code-changing tools are unavailable in this flow until the
  person has agreed in the conversation.
- The same mode reviews a **unit of testing** - a view, to start - and checks whether its tests cover
  its functionality. Where they do not, the agent adds test code for the unexplored edge cases. It must
  also know which edge cases are **unnecessary because Tao guarantees them** for apps and app
  developers, and must not write tests for those.

Why Studio: `fixture` and `scenarios` are language constructs typed against the app's entities, the
grid renders every scenario entry side by side, and the compile manifest publishes them. "What does it
look like when..." becomes a first-class, persisted thing rather than a temporary hack in a running app.
The fixture generator (`StudioFixtureGeneration`, on the `generation` package) already produces
entity rows from declarations and can be reused for the values. Tests are Tao source too, so the agent
writes them with the same tools it writes anything else.

On what Tao guarantees: the list of edge cases a Tao app developer does not need to test is a fact
sheet derived from `Docs/Spec/` - the authoritative implemented contract - not from `Decisions.md` and
not from the model. Examples the implementer should confirm against the spec and encode:

- Every check starts a fresh app with a Memory datasource replacement and fresh navigation state
  (`Tao Testing.md`), so test-order dependence and leaked state are not things to test for.
- The held clock only moves with `advance`, so timing flakiness is not a test subject.
- Values are typed; there is no null or undefined to defend against. `Value is empty` and `.Count`
  are the whole emptiness story for text, lists, and queries (`Tao Type System.md`).
- Entity handles have explicit `loading`, `missing`, `unauthorized`, and `error` cases through `guard`
  (`Tao Data.md`). If a view guards, each branch is a behavior worth a test; if it does not, the runtime's
  render-failure containment at item, screen, and app boundaries bounds the failure, and the spec, not a
  test, owns that.
- A deleted handle keeps `.Id`; application code cannot reach raw rows.

The fact sheet is served to the model through a tool, with the spec section each fact comes from, so
the agent's "this edge case is covered by Tao" claim carries a citation a person can check.

### Story 3 - Build a feature in chat, guarded by the app's tests

> I type "add a Hide button to each story that removes it from the list until reload." The agent
> inspects the graph, makes changes through Studio's tools, compiles, runs the app's tests, and shows
> me: the diff, the preview refreshed, and "tests still pass: 6 of 6." When I say "actually, hidden
> stories should come back if I pull to refresh," it iterates - and when a change breaks the feed test,
> it says which one and why before I ever see the diff.

Why Studio: the compile loop and the before/after test verdict make the agent's own feedback loop
trustworthy, and the approval-then-undo discipline means nothing lands without the person. This is the
Codex-style freeform loop with the shell removed and typed tools put in its place.

The one risk to design around honestly: **hosted models have never seen Tao.** Mitigations, all
required, none optional:

1. A `taoReference` tool that returns a bounded excerpt of `Docs/Spec/` for a topic, plus the nearest
   analogous declaration already in the project (the "analogous declaration" relation from SAI-Q041,
   now offered as a tool result rather than used only by the closed planner).
2. Compile diagnostics fed back as the correction signal, within the step budget.
3. The existing typed moves (`add-flag`, `reword-text`, and a `restyle-token` move the graph already
   supports) exposed as tools alongside a scoped `editSource`, so the agent has guaranteed-correct fast
   paths and drops to raw editing only when it must.

## What Studio provides and what gets built

Existing seams to reuse unchanged or nearly so:

| Seam                                                                                                                    | Where                                                            | Used by                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Semantic snapshot and queries (`overview`, `inspect`, `trace`, `fieldStory`, `resolveTarget`, literal texts on renders) | `packages/ides/studio/studio-src/agent-chat/SemanticSnapshot.ts` | all stories                                                   |
| Checkpointed multi-file apply and undo                                                                                  | `session.applyAgentFiles`, `session.undoAgentFiles`              | stories 2, 3                                                  |
| Typed feature planner and lowering, reword guardrail                                                                    | `agent-chat/FeaturePlan.ts`                                      | story 3 as tools                                              |
| Before/after test verdict with duplicate-record folding                                                                 | `agent-chat/FeatureVerdict.ts`, `StudioTestRunner`               | stories 2, 3                                                  |
| Fixture generation from entity declarations                                                                             | `StudioFixtureGeneration.ts`, `packages/ai/generation`           | story 2                                                       |
| Preview manifest (scenarios, fixtures, cells) and grid refresh                                                          | `StudioPreviewManifest.ts`, `/api/preview/*`                     | story 2                                                       |
| Source-action bus (versioned, undoable, conflict-checked edits)                                                         | `/api/source-action/*`                                           | stories 2, 3 (implementer's choice against `applyAgentFiles`) |

New for this slice, suggested as `packages/ides/studio/studio-src/agent-chat/`:

- **The loop.** One AI SDK agent per chat session, held server-side, with the conversation as its
  state. A turn is: append the person's message, run the loop until the model stops, the budget trips,
  or a write tool needs approval; return the new steps.
- **The tool registry.** One registry, three subsets (read, scenario-and-test authoring, feature
  building). Every tool has a JSON Schema input, a bounded text or JSON result, and a one-line summary
  for the transcript. Every write tool is `needsApproval` and records what it changed for undo.
- **Provider configuration and availability.** Which provider and model, whether a key is present,
  whether the person has turned cloud use on for this session. Reported to the client without the key.
- **The chat panel.** A second mode in the existing overlay: message list, tool-call cards (name,
  argument summary, result summary, elapsed), pending-approval cards with the diff, verdict panel,
  undo for the last applied change, budget and cost readout, and the on/off control for cloud use.
- **Spec reference and Tao guarantees.** A small index over `Docs/Spec/` by heading, and the curated
  guarantee fact sheet with citations.
- **Coverage analysis.** For a view: the behaviors the graph can enumerate (renders and their literal
  texts, actions invoked, conditional branches, entity guards) matched against what the app's test
  checks press and expect. Test steps reference literal texts and control labels; render nodes carry
  their literal texts; the intersection is a static coverage map good enough to say "no check ever
  presses Hide" or "no check reaches the missing-story branch."

## Suggested tool catalog

The implementer owns the final list. This is the set the stories appear to need, named for the person
reading a transcript rather than for the code.

Read tools (no approval):

- `overview()` - app, views, entities, actions, scenarios, tests, and compile status in one packet.
- `listFiles()`, `fileOutline(path)` - the project's files and the declarations each one holds.
- `inspect(name)`, `trace(name, relationship)`, `fieldStory(entity.field)` - the PoC queries.
- `readSource(declaration)` - the source text of one declaration, never a path.
- `testStatus()`, `runTests()` - the app's own tests; `runTests` is read-only in effect but slow,
  and should say so in its description.
- `coverage(view)` - the coverage map described above.
- `taoReference(topic)`, `taoGuarantees(area)` - spec excerpts and the guarantee fact sheet.
- `previewState()` - scenarios in the grid, the active cell, bundle diagnosis if any.

Write tools (approval required, undoable):

- `addFlag(entity, field, view)`, `rewordText(view, textHandle, newText)`, `restyleToken(token,
  value)` - the typed moves, lowered by Tao as today.
- `editSource(declaration, replacement)` - replace one declaration's source; formatted and
  compiled before it is offered for approval; rejected if the compile fails, with the diagnostics
  returned to the model instead.
- `addScenario(group, entry, fixture, environment, subject)`, `addFixture(name, rows)` - authored
  through the same manifest contract Studio's fixture capture uses; `addFixture` may ask the fixture
  generator for values.
- `addTest(suite, name, steps)` - a check in the app's `.test.tao` sidecar.
- `undoLast()` - restore the files of the last applied change.

Conversation tools:

- The model asks the person a question by ending its turn with the question. No tool is needed for
  that, and the loop must not answer on the person's behalf.
- In story 2, the flow starts with only the read tools and the scenario-and-test tools. A
  `requestCodeChanges(reason)` tool records the agent's case for code changes and ends the turn; the
  person's next message either grants it, which adds the feature-building tools for the rest of the
  conversation, or declines.

## Implementation plan

The phases are a suggested order, not a contract. The implementer should reorder, merge, or split them
when the evidence says to, and should record why in the findings ledger. The suggested order is
story 1, then story 3, then story 2: story 1 builds the loop and panel cheaply against read-only tools;
story 3 proves the write-tool pattern and surfaces the Tao-fluency risk early; story 2 adds the most
Studio-specific tools once that pattern is trusted. The Developer is equally happy with story 2 before story 3.

### Phase 0 - Spike the loop

Goal: one hosted-model turn, from the Studio panel, through the AI SDK, calling one existing read tool,
with the transcript visible.

- Add `ai` and `@ai-sdk/anthropic` to `packages/studio`. `zod` is already in the tree transitively;
  add it directly only if tool schemas are written in zod rather than JSON Schema.
- Read the provider key from the Studio server's environment. Never read `.env` files from the agent's
  own shell; the person launches Studio with the variable set. Never send the key to the client.
- Add `/api/agent-chat/availability`, `/api/agent-chat/turn`, `/api/agent-chat/enable`. A turn can
  return the complete step list when the loop stops; streaming the steps as they happen is better for
  the demonstration and the implementer may add it if the cost is small.
- Write the first test with the mock language model the AI SDK exports from `ai/test`, so the loop,
  the registry, and the approval pause are tested without a network.

Evidence: a transcript showing the model calling `overview` and answering from it, and a test that
proves a write tool pauses for approval.

### Phase 1 - Story 1, ask the app anything

- Wrap the PoC queries as tools. Add `listFiles`, `fileOutline`, `readSource`, `coverage`,
  `previewState`.
- Build the advisory answers from facts: give the model an `improvementFacts()` tool, or let it compose
  them from the others - the implementer decides which produces better-grounded answers, and records
  the comparison. Either way the answer must cite what it rests on.
- Keep the evidence links: any declaration name in an answer resolves through `resolveTarget` and opens
  the source.
- Persist transcripts under `.artifacts/agent-chat/` the way PoC runs are persisted.

Evidence: the four kinds of question in the story answered against HNReader and WordFlower, with
citations, and the answers judged by a person for accuracy. A benchmark list of questions and the
model's answers belongs in the findings ledger, as the first PoC did.

### Phase 2 - Story 3, build a feature in chat

- Add the write tools, approval, and undo. Decide between `applyAgentFiles` and the source-action
  bus; the bus gives conflict checking and versioning for free, the PoC path is already proven with
  undo. Either is acceptable; say which and why.
- Expose the typed moves as tools first, `editSource` second. Measure how often the model reaches for
  raw editing and how often the compile rejects it; that ratio is a headline finding.
- Feed compile diagnostics back into the loop. Run the app's tests before the first write and after
  the last one, and render the verdict with the existing component.
- Add `taoReference` with a heading index over `Docs/Spec/`, and the analogous-declaration result.

Evidence: the Hide-button story end to end on HNReader, including the follow-up iteration, with the
diff, the verdict, and undo. Record every raw `editSource` the model attempted, whether it compiled,
and what reference it had asked for first.

### Phase 3 - Story 2, scenarios, fixtures, and unit tests

- Add `addScenario`, `addFixture`, `addTest`, and the gated `requestCodeChanges`. Authored scenarios
  must appear in the grid without a Studio restart.
- Reuse `StudioFixtureGeneration` for fixture values; extend it only where the story needs values the
  generator cannot produce (a very long title, a large comment count) and prefer letting the model
  supply those directly in the tool call.
- Write the guarantee fact sheet from `Docs/Spec/`, each entry with its section. Add `taoGuarantees`.
- Implement `coverage(view)` and use it in the unit-test review: enumerate behaviors, subtract what
  tests already exercise, subtract what Tao guarantees, propose tests for the remainder, and write them
  only after approval.

Evidence: the two-cell story on HNReader; a coverage review of `StoryRow` or `WorkspaceRow` that adds
at least one test for a real gap and declines at least one edge case with a spec citation; and the gate
demonstrated by asking for a state the app cannot reach, with the agent stopping to ask.

### Phase 4 - Findings and handoff

- Append to the exploration document's ledgers: decisions confirmed or changed (SAI-D029 onward),
  questions answered or raised (SAI-Q046 onward), what worked, what needed raw source, cost and latency
  per story, and the raw-edit compile ratio.
- Say plainly which parts of this slice would survive a production design and which are scaffolding.

## Boundaries the implementer keeps

- The model never receives a shell, a script runner, a filesystem path, or a network tool. If a story
  seems to need one, the answer is a new Studio tool with a bounded contract, or a recorded gap.
- Every write is compiled and formatted before it is offered, approved by the person before it lands,
  and undoable after. A tool that cannot honor all three is a read tool or does not exist.
- Cloud use is off until turned on, visible while on, and the panel shows what was sent in size, not
  in secret. Transcripts persisted locally are the audit trail.
- No agent identity in file names, code, comments, documents, or commits. Language work crosses the
  boundaries `packages/AGENTS.md` owns; read it before touching `packages/`.
- `./agent verify` before every commit; small, self-contained commits on the feature branch.

## Environment notes for the implementing agent

- Studio launched from the agent's own sandboxed shell cannot reach a hosted model: egress is limited
  to an allowlist owned by `.rulesync/permissions.jsonc`, and the policy is not to be widened to route
  around a violation. For demonstrations, the person runs Studio from their own terminal with the key
  set, or the Developer decides to allow the provider host. Tests never need the network.
- `direnv exec .` fails in a sandboxed shell; use `export PATH="$PWD/.devenv/profile/bin:$PATH"`.
- The Browser pane's launch entries open Studio on `127.0.0.1`; Studio rejects a `localhost` origin.
- A blank preview with a clean compile was the bundler's stale file map; the startup ordering fix is on
  this branch and `/api/preview/diagnosis` explains a bundle failure over the frame.
- Focused tests: `bun test packages/ides/studio/studio-tests/<file>.test.ts`. The `./dev test <pattern>`
  argument is a test-name regex, not a file selector, and a pattern that matches nothing still reports
  success; prefer `bun test` with a file path while iterating.

## Open questions this slice should answer

To be numbered into the exploration document's ledger as they are settled:

- How should Tao guarantees be phrased for a model: a curated fact sheet, spec excerpts, or both? Which
  produced fewer unnecessary tests?
- Is per-tool approval the right grain for a chat, or does a person want to approve a whole plan once
  and let several writes land? The PoC applied a whole feature as one change; the loop applies one
  tool at a time.
- What is the cost and latency of each story with a hosted model, and which turns could the on-device
  model take instead - the read-only questions of story 1 being the obvious candidates?
- How far does the analogous-declaration relation carry a model that has never seen Tao? Count the
  raw edits that compiled on the first try with a reference against those without one.
- What does a grounded "next meaningful feature" suggestion look like, and can a person tell a
  grounded one from a plausible one without checking the citations?

## Implementation record

The slice is implemented in `packages/ides/studio/studio-src/agent-chat/`, which now also owns the
snapshot, lowering, apply and verdict seams the retired on-device proof of concept left behind. What follows is what was built, what changed from the plan
above, and — most importantly — what is still unproven.

### What the phases produced

**Phase 0, the loop.** `AgentChatSession` wraps the AI SDK's `generateText` with the four things Tao has to
own: a step budget that stops a model that will not stop and says so rather than presenting a partial answer
as a whole one; an approval pause; the rule that an unanswered approval is a denial rather than a hang; and a
provider failure that ends a turn instead of throwing into Studio. Eight tests drive it against a scripted
model, so the loop's behavior is tested without a network.

**Phase 1, ask.** `readTools` is the whole read surface, and `AgentChatFacts` is what an advisory answer may
rest on. `AgentChatProvider` holds the two separate gates: a key in the environment, and the person turning
cloud use on for the session. It also holds which vendor answers — Anthropic (`ANTHROPIC_API_KEY`,
`claude-sonnet-5`) or OpenAI (`OPENAI_API_KEY`, `gpt-5.6-terra`), each model overridable through
`TAO_STUDIO_AGENT_ANTHROPIC_MODEL` or `TAO_STUDIO_AGENT_OPENAI_MODEL` — and switching vendor turns cloud use
off again, since consent to send a project to one vendor is not consent to send it to the other.

**Phase 2, build.** Every change is proposed and applied in two steps, and only the applying pauses for
approval — so the approval card carries the diff rather than the arguments that produced it. `proposeFlag`
and `proposeReword` reuse the PoC's Tao-owned lowering; `proposeEdit` is the one place the model writes Tao,
guarded by the formatter, then the compile, then the person. `taoReference` serves `Docs/Spec/` sections
verbatim, flagged when the section marks what it describes as deferred.

**Phase 3, scenarios and tests.** `authoringTools` adds `proposeScenario`, `proposeTest` and
`requestCodeChanges`. The gate is enforced by tool availability: in this mode the tools that change app code
do not exist until a person allows them, so a model deciding to work around the restriction has nothing to
reach for. `taoGuarantees` is the account of what not to test. `coverageOfView` supplies the half the graph
does not have, by reading the `.test.tao` sidecars directly.

### What the reviews changed

Two reviews ran against 1f85f010 while this was being built. Both found real defects; the corrections are in
`32cc0d05` and `aa4e40ce`, and each has a regression test.

In the PoC's source editing: an analogous field's writer was used as an offset anchor even when it lived in
another file, splicing generated code into the middle of whatever text sat at that offset; two staged edits
sharing a start offset applied in array order, so a replacement swallowed an insertion; and a one-file app
had imports added for declarations it declares itself.

In the verdict: it reported "the app's tests still pass" while tests were failing, called a run that never
happened an app without tests, and read a run that produced no result — what `tao test` does when a test file
will not compile — as everything passing. The panel also applied the change without waiting for the baseline,
so a test the change broke could land in the baseline and be excused. A verdict that cannot contradict the
agent is not a check.

In the graph, three defects that all produced confidently wrong advice:

- A field read inside `loop Documents / Document` produced no `reads` edge, because a loop binding resolved to
  no entity. That is most of the field reads in a list-shaped UI.
- A derived app — `HNReaderStub = HNReader with { ... }` — resolved to no design, so HNReader had no styling
  edges at all and every bundle in it read as unused. Following the inherited design turns 0 `styled-by` edges
  into 34.
- Counting only direct `covers` edges called 25 of WordFlower's 26 views uncovered, because an app-level
  scenario exercises views without naming them. Coverage now follows `renders` from a scenario's subject.

The lesson worth keeping is one shape: **every fact here is a claim about absence, and absence has two
causes.** The thing is genuinely unused, or the graph cannot see that relation at all. Reporting the second as
the first is how a cited answer becomes worse than an uncited one, and `improvementFacts` now stays silent
about a relation with no edges anywhere rather than claiming everything is unused.

The plan's own guarantee fact sheet was wrong twice, and both errors would have taught the agent to skip a
test the app needs: Tao does have an absent value (`none` is in the value core and optional item fields are
implemented), and a query distinguishes loading from empty rather than answering to `is empty` alone. Entity
guard branches moved from "worth a test" to `not-testable-yet`: driving a provider into them from a check is
retired and the replacement has not landed.

### What is not proven

**No hosted model has run against this.** The agent implementing it had no provider key and no egress to one,
so every test drives a scripted model. The loop, the tool surface, the refusals, the approval pause, the
staging and the gate are all tested; whether a real model uses them well is not. In particular these are open:

- whether a model that has never seen Tao writes `proposeEdit` source that compiles, and how often
  `taoReference` plus an analogous declaration is enough to get it there — the raw-edit compile ratio this
  plan asked for is still uncollected;
- whether advisory answers actually cite their facts, or cite them and then say something the facts do not
  support;
- whether a model respects `requestCodeChanges` and stops, rather than finding another way;
- cost and latency per story.

Running these needs Studio started from a terminal with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, that
provider chosen and cloud turned on in the panel,
and someone reading what comes back. That is the next thing to do, and it is the only thing that can settle
whether this approach works.

### Found by writing the tests

Three defects surfaced only because something drove the whole path rather than a piece of it, which is worth
recording as a reason to write that kind of test early.

The model's own `runTests` tool was never connected to the session. It had refused every call since it was
written, and the baseline a verdict needs comes from exactly that call — so a verdict could never have been
better than "not measured". Story three now takes a run before the change, runs the tests again when one
lands, and reports the verdict in the tool result and in the turn, so a person sees it whatever the model says.

An `applyChange` naming a change that was never staged still became an approval card: someone asked to approve
an empty diff, which is how people learn to approve without reading. A tool call that cannot do anything is
denied before anyone is asked.

Text handles are positional — `T1` is the first literal in the project — so one applied change repoints all of
them. The tool description said they expire, which is not a mechanism. The conversation now remembers the
literal each handle was issued for and refuses a handle that no longer names it.

### What the second review changed, and what the record got wrong

Two reviews ran the finished slice against HNReader and WordFlower. They found one hole in the central claim
and a fact layer that was confidently wrong, and they caught this document overstating both.

**The gate was not a gate.** Scenario mode promised it could not change app code, and enforced that by which
tools existed. But `proposeScenario` built its fixture by splicing model-supplied strings into the app's own
source, so a row reading `Title: "x" }` closes the fixture block and opens an `action` — and the formatter
accepts the result, because a formatter is a syntax gate and not a scope gate. This was reproduced against the
real formatter, which emitted a top-level `action` into app source. There is now a scope gate that parses
before and after and refuses a change that touched any top-level declaration the tool did not promise to
author, plus a literal-only rule for fixture rows.

**The fact layer was wrong on both apps.** Ten facts for HNReader, four of them false; 63 of WordFlower's 92
bundles called unused; 25 views called uncovered that app-level scenarios do cover. The earlier record claimed
the absence lesson had been applied — it had been applied to exactly one relation. It now holds everywhere,
and the honest consequence is that **`improvementFacts` returns almost nothing on these two apps**: three
statements for HNReader, two for WordFlower, all of them saying which relations this graph cannot decide.

That is the real finding for Story 1, and it should be read as one: **the semantic graph as it stands cannot
ground the advisory answers that story promised.** Five things would have to exist first — an edge from an app
to the views its navigator reaches, `invokes` edges for commands and toolbars, `reads` that sees `order by`
and `index` and relation traversal, `queries` that follows a relation, and some way to tell a design's
component-default rules from its product bundles. Until then the relational half of Story 1 works and the
advisory half does not, and the tool says so rather than inventing something plausible.

**Claims in the earlier record that were wrong**, now corrected above: the transitive-coverage fix did not fix
the case it cited (an app node has no `renders` edge, so the walk stopped immediately); the absence guard
covered only `styled-by`; and `runTests` was never wired to the session at all, so the tool refused every call
while the build instructions ordered the model to use it.

### Smaller things worth knowing

- `overview` does not report everything its tool description once claimed; the description now says what the
  packet actually holds, and `coverageOfTests`'s says it reports a last run rather than listing tests.
- `inspect` and `trace` still truncate at a budget chosen for a 4k on-device window. In a hosted-model mode
  that is the wrong constant, and it can drop the one edge that answers a question; it is unexamined, not
  decided.
- One conversation is held per project, not per browser tab, so two tabs share it and changing the mode in one
  resets it for the other.
- `resolveTarget` now resolves an entity's singular name (`Document` as well as `Documents`), which the
  exploration's own findings said was the model's weakest skill.
- The snapshot is built once per turn rather than once per tool call, and invalidated when a change lands.
- `applyAgentFiles` takes the versions a change was computed against, and the undo record is a stack. A
  conversation applies several changes; a single slot offered undo while being able to restore only the last.
