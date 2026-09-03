# Plan - Studio agent chat

Status: **proof-of-concept plan, not a production design**. This document defines the next disposable
slice of the semantic agent exploration: a freeform chat in Tao Studio in which a model works through
Studio-supplied tools until a request is satisfied. It stands alongside
`Exploration - Semantic agent proof of concept.md`, which holds the decision ledger (SAI-D001 through
SAI-D028), the open questions (through SAI-Q045), and the findings from the first four journeys. New
decisions and questions raised by this slice continue those ledgers in that document.

Like its predecessor, this plan does not amend `Docs/Roadmap/Tao Revolution/Decisions.md`, does not
define a supported Studio or compiler API, and does not authorize merging the implementation into
`main`. Ro decides language semantics, roadmap priority, and product behavior; the implementing agent
decides everything else here from repository evidence and its own judgment.

## Why a second approach, and why it coexists with the first

The first proof of concept established that an on-device model can ask Tao compact semantic questions
and request typed changes that Tao lowers from the semantic graph. Its planner is deliberately closed:
classify a request into one of a few feature kinds, shape it, validate every operand against facts,
lower it deterministically. That gave hard guarantees on a narrow demo and taught the most valuable
lesson so far - the model names the intent, Tao derives the code.

That design was also a workaround. The on-device model has roughly a 4k-token window and no room for
an iterative loop, so the PoC never let the model work: read, act, observe, act again. Tools like Codex
and Claude Code get their power from exactly that loop. This slice explores the loop as a **second
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
- Provider choice is configuration, not code. Anthropic is the first provider; the model id is a
  setting with a sensible default. A community on-device provider for the AI SDK exists and may be
  evaluated for read-only turns, but nothing in this slice depends on it.
- Sending project source to a hosted model is an explicit, visible, per-session choice in Studio. No
  cloud call happens before the user has turned it on, and the panel says when it is on.
- The chat has a Tao-owned step budget and a per-turn cost ceiling. When either trips before the task
  is done, the agent says what it did, what remains, and stops; it does not silently continue.

## The three user stories

Ro selected these three, with the caveats recorded under each. They are the acceptance target: each
one is done when a person can do what the story says in Studio, against HNReader and WordFlower,
without touching source by hand.

### Story 1 - Ask the app anything

> As someone opening HNReader for the first time, I type "what happens when I tap a story?" and get a
> plain answer - "it invokes `OpenStory`, which sets `selected` and renders `StoryView`; the title
> comes from `Story.title`, styled by the `heading` bundle" - where every name is a link that opens the
> exact source in Studio. I follow up with "which of that is covered by tests?" and "where does the
> green come from?"

Ro's caveat: the chat must also answer **advisory and structural** questions, not only relational ones:

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

Ro's caveats:

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

| Seam                                                                                                                    | Where                                                       | Used by                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Semantic snapshot and queries (`overview`, `inspect`, `trace`, `fieldStory`, `resolveTarget`, literal texts on renders) | `packages/studio/studio-src/agent-poc/SemanticSnapshot.ts`  | all stories                                                      |
| PoC server commands, checkpointed apply, undo                                                                           | `agent-poc/AgentPocServer.ts`, `session.applyAgentPocFiles` | stories 2, 3                                                     |
| Typed feature planner and lowering, reword guardrail                                                                    | `agent-poc/FeaturePlan.ts`                                  | story 3 as tools                                                 |
| Before/after test verdict with duplicate-record folding                                                                 | `agent-poc/FeatureVerdict.ts`, `StudioTestRunner`           | stories 2, 3                                                     |
| Fixture generation from entity declarations                                                                             | `StudioFixtureGeneration.ts`, `packages/generation`         | story 2                                                          |
| Preview manifest (scenarios, fixtures, cells) and grid refresh                                                          | `StudioPreviewManifest.ts`, `/api/preview/*`                | story 2                                                          |
| Source-action bus (versioned, undoable, conflict-checked edits)                                                         | `/api/source-action/*`                                      | stories 2, 3 (implementer's choice against `applyAgentPocFiles`) |
| Panel mount, evidence links, diff and verdict rendering                                                                 | `agent-poc/StudioAgentPocPanel.ts`, `StudioApp.ts`          | all stories                                                      |
| Run logs under `.artifacts/agent-poc/runs`                                                                              | `agent-poc/AgentPocRun.ts`                                  | transcript persistence pattern                                   |

New for this slice, suggested as `packages/studio/studio-src/agent-chat/` next to `agent-poc/`:

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
Studio-specific tools once that pattern is trusted. Ro is equally happy with story 2 before story 3.

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

- Add the write tools, approval, and undo. Decide between `applyAgentPocFiles` and the source-action
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
  set, or Ro decides to allow the provider host. Tests never need the network.
- `direnv exec .` fails in a sandboxed shell; use `export PATH="$PWD/.devenv/profile/bin:$PATH"`.
- The Browser pane's launch entries open Studio on `127.0.0.1`; Studio rejects a `localhost` origin.
- A blank preview with a clean compile was the bundler's stale file map; the startup ordering fix is on
  this branch and `/api/preview/diagnosis` explains a bundle failure over the frame.
- Focused tests: `bun test packages/studio/studio-tests/<file>.test.ts`. The `./dev test <pattern>`
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
