# Exploration - Semantic agent proof of concept

Retired on 2026-09-05: the on-device tab, its Swift helper, and the `/api/agent-poc/` commands were removed once
the hosted agent chat (`Docs/Roadmap/Tao Studio AI/Plan - Studio agent chat.md`) had absorbed the semantic
snapshot, feature lowering, and verdict seams, which now live in `packages/studio/studio-src/agent-chat/`. The
exploration below is history; its decision ledger, open questions, and design rationale are carried forward in
that document's "Absorbed from the retired on-device PoC" section.

Status: **exploration and disposable proof of concept, not a production design**. This document records
the working direction, provisional decisions, open questions, PoC definition, and suggested implementation
sequence for proving that Tao can serve as a semantic interface between an on-device agent and a Tao
project.

This exploration does not amend `Docs/Roadmap/Tao Revolution/Decisions.md`, does not define a supported
Studio or compiler API, and does not authorize merging the PoC implementation into `main`. Any conflict
with adopted Tao decisions is resolved in favor of those decisions.

## Dominant instruction: prove the possibility, not the implementation

The first implementation is deliberately a **throwaway proof of concept**. Its job is to demonstrate that
the intended interaction is possible:

1. an on-device local model can ask Tao compact semantic questions instead of reading much of the source;
2. Tao can return efficient, accurate, structured answers derived from language and compiler semantics;
3. the model can request expressive semantic changes instead of primarily writing text patches; and
4. Tao can interpret at least one such request, propose a source change, validate it, show the result, and
   undo it.

The PoC does **not** need to be architecturally correct, general, complete, maintainable, compatible, secure
enough for production, or representative of the eventual public API. It may be narrow, hard-coded,
duplicative, inelegant, app-specific, and tightly coupled to current internals. It may use provisional
identities, schemas, endpoints, graph shapes, prompts, and UI. It may support only the exact declarations,
relationships, queries, and changes needed by the demonstration.

The implementer has broad leeway to choose the fastest convincing route. They may materialize a temporary
JSON graph, query compiler objects directly, add a dedicated local endpoint, use a scripted orchestration
loop around Foundation Models, hard-code one forcing app, regenerate a whole small file, or bypass an
abstraction that a production implementation would require. Focused tests and manual demonstrations are
enough. Repository-wide compatibility, polish, hardening, and abstraction work are explicitly outside the
PoC.

The implementation is evidence, not a foundation. After the PoC, the code may be discarded. This document,
updated with findings, is the key input to a later design effort that will decide the real architecture and
implementation independently.

## Decision ledger

These entries distinguish the intended capability from PoC conveniences. “Direction to prove” means the
PoC should test the proposition, not that Tao has adopted it as product or language law. “PoC boundary”
controls this experiment only. “PoC convenience” is freely replaceable even during the experiment.

| ID       | Status             | Working decision                                                                                                                                                                                                            | Consequence for the PoC                                                                                                                                                                                                       |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SAI-D001 | Direction to prove | Tao, not the model, is the semantic authority for the project.                                                                                                                                                              | Semantic facts should come from resolved Tao/compiler state; the model interprets and communicates them.                                                                                                                      |
| SAI-D002 | Direction to prove | The model should progressively inquire from product overview to declaration detail to exact source.                                                                                                                         | Do not begin by placing whole files or the whole project in the prompt.                                                                                                                                                       |
| SAI-D003 | Direction to prove | Tao should return projections of a semantic project graph rather than search-result-shaped text.                                                                                                                            | At least one demo must answer a cross-cutting question through structured nodes, edges, and facts.                                                                                                                            |
| SAI-D004 | Direction to prove | The reverse interface should express changes in product/declaration terms rather than raw text or public AST surgery.                                                                                                       | At least one demo change begins as a typed semantic request such as changing a design value, adding a field, or adding a scenario.                                                                                            |
| SAI-D005 | Direction to prove | Tao should lower semantic requests to current source, formatting, validation, compilation, preview, and undo.                                                                                                               | The successful write demo must end in ordinary Tao source and a visible Studio result.                                                                                                                                        |
| SAI-D006 | Direction to prove | Compiler evidence should remain distinguishable from model inference.                                                                                                                                                       | Answers identify which claims are Tao facts and which are AI suggestions.                                                                                                                                                     |
| SAI-D007 | Direction to prove | Compact semantic context may let a small local model perform useful project work faster and with fewer tokens than source search.                                                                                           | The PoC compares semantic context with a source-context baseline on a few real tasks.                                                                                                                                         |
| SAI-D008 | PoC boundary       | The model runs strictly on-device through Apple Foundation Models on macOS, with no cloud fallback.                                                                                                                         | Unavailable local intelligence is reported honestly; the PoC need not support another host or model.                                                                                                                          |
| SAI-D009 | PoC boundary       | The first write path is proposal-first and person-reviewed.                                                                                                                                                                 | The model does not silently change source; Studio shows a proposal before application.                                                                                                                                        |
| SAI-D010 | PoC boundary       | Existing Studio identity, proposal, compile, preview, checkpoint, and undo seams may be reused opportunistically.                                                                                                           | The PoC need not design a replacement source-action architecture.                                                                                                                                                             |
| SAI-D011 | PoC boundary       | MCP is an optional adapter, not a prerequisite for proving the core interaction.                                                                                                                                            | A private Studio endpoint or in-process API is sufficient; add MCP only if it cheaply strengthens the proof.                                                                                                                  |
| SAI-D012 | PoC convenience    | The implementer chooses the forcing app, supported graph subset, tool schemas, transport, UI, and demonstration change.                                                                                                     | Hard-code the smallest useful slice and document what was hard-coded.                                                                                                                                                         |
| SAI-D013 | PoC convenience    | The PoC may expose three to five broad agent tools instead of a complete fine-grained API.                                                                                                                                  | Prefer a small usable loop over designing the final tool catalog.                                                                                                                                                             |
| SAI-D014 | Direction to prove | Source is a detail that the model requests only when semantic facts are insufficient.                                                                                                                                       | Record every raw-source fallback and why it was needed.                                                                                                                                                                       |
| SAI-D015 | PoC convenience    | The forcing app is WordFlower `1 - Current`, the journey is "review the selected render and apply one design change", and the write is a new `set-design-entry` source action.                                              | The existing `set-style-entry` bundle edit requires the render and the design to share a file; WordFlower keeps its design in `Design.tao`, so a design-scoped action that needs no render occurrence was added instead.      |
| SAI-D016 | PoC convenience    | The semantic snapshot is rebuilt from the linked Langium AST on every request, in `packages/studio/studio-src/agent-poc/SemanticSnapshot.ts`, with no caching, identity scheme, or manifest reuse.                          | Every node and edge carries `origin: compiler` (resolved cross-reference or declaration structure) or `origin: poc-derived` (a documented name-matching heuristic) plus a `src:<path>:<start>-<end>` evidence handle.         |
| SAI-D017 | PoC convenience    | The on-device model runs through a separate throwaway Swift helper (`AgentHelper.swift`) that takes JSON-schema tools over NDJSON stdio, rather than the shipped `tao-foundation-models-server`, which has no tool calling. | Tool calls are bridged back to the Studio server process; the helper caps tool calls, suppresses exact repeats, runs a guided turn first, and converts with a schema-only turn if the model drifts into prose.                |
| SAI-D018 | PoC convenience    | The Studio surface is a fixed overlay panel mounted from `StudioApp.ts`, driven by the existing `/api/source-action/propose`, `/api/source-action`, and `/api/source-action/undo` seams.                                    | No Tao/React portal work and no new checkpoint machinery; proposal, apply, compile, preview refresh, and undo are the existing ones.                                                                                          |
| SAI-D019 | PoC convenience    | Tao normalizes the model's `bundle` operand against the app design's real members before proposing, and the panel shows that Tao, not the model, resolved it.                                                               | The model once wrote the design name where a bundle name belonged; without normalization the typed request would have failed to lower.                                                                                        |
| SAI-D020 | Direction to prove | A feature request in words is split in two: the model chooses only the feature's **shape**, and Tao decides every **placement** by copying the pattern of an analogous existing declaration.                                | "Add a feature by describing it" lowers into three files without the model authoring any Tao. Each plan step is attributed to the model, to Tao, or to a PoC shortcut.                                                        |
| SAI-D021 | PoC convenience    | The feature lowering supports exactly one shape: a `yes / no` field on an entity, its `Set<Field>` action, a `Checkbox` bound to it, a fixture row, and a scenario. Other field kinds return an honest unsupported step.    | The analogous field (`Document.Final`) supplies the placement for all five edits. Anything else is refused rather than guessed.                                                                                               |
| SAI-D022 | PoC convenience    | The multi-file write bypasses the source-action checkpoint bus: one Studio call writes every file, compiles once, restores all of them on a failed compile, and keeps one undo record.                                      | A feature is one step to apply and one step to undo. The production design still owns transaction semantics (SAI-Q019).                                                                                                       |
| SAI-D023 | Direction to prove | Tao may correct a model operand that is wrong but recoverable from the graph, and must say that it did.                                                                                                                     | Two corrections proved necessary: the model named the screen (`DocumentScreen`) rather than the view owning the pattern, and a file-private view cannot be a scenario subject, so Tao chose the visible view that renders it. |

Record new decisions here as the PoC proceeds. Do not silently promote an implementation choice into a
product decision. If the experiment changes direction, retain the superseded entry and mark it superseded
with the date and replacement ID.

## Outstanding decisions and questions

These questions should remain open unless answering one is necessary to run the PoC. When the implementer
must choose, record the choice as a **PoC convenience** in the decision ledger and continue. The later design
effort, not this experiment, owns durable answers.

### Product and experience

- **SAI-Q001:** Is the primary Studio surface a command menu, contextual suggestions, chat, an inspector
  context, or several task-specific surfaces?
- **SAI-Q002:** What scopes can a person grant an agent: selection, render occurrence, scenario cell, view,
  file, app, or project?
- **SAI-Q003:** How should Studio present Tao facts, AI inferences, uncertainties, and unsupported questions
  so they cannot be confused?
- **SAI-Q004:** Which changes always require review, and could any proven-safe semantic changes eventually
  apply immediately?
- **SAI-Q005:** Is “Review this screen” the first real product feature, or merely the PoC forcing journey?

### Semantic model and queries

- **SAI-Q006:** What is the eventual canonical semantic model: a materialized graph, an on-demand compiler
  query layer, several domain indexes, or a combination?
- **SAI-Q007:** Which node and edge kinds are stable enough to expose beyond compiler internals?
- **SAI-Q008:** Which identity is durable across source changes, moves, renames, aliases, generated output,
  and configured variants?
- **SAI-Q009:** How should a query express scope, relationship, depth, projection, ordering, evidence, and
  token budget?
- **SAI-Q010:** Which relationships can the compiler prove today, which require new static analysis, and
  which require runtime instrumentation?
- **SAI-Q011:** How should runtime values, action history, provider activity, navigation, and render bindings
  join the authored semantic graph without becoming false language authority?
- **SAI-Q012:** What does Tao return when an answer is partial, expensive, ambiguous, stale, or unsupported?
- **SAI-Q013:** Should answers be graph fragments, task-specific result types, or both?
- **SAI-Q014:** How are source excerpts selected and bounded when semantic context is insufficient?

### Semantic changes

- **SAI-Q015:** What is the eventual public abstraction for changes: declaration operations, a semantic
  patch IR, source actions, compiler refactorings, or layered forms of all four?
- **SAI-Q016:** How should a multi-declaration change declare intent, dependencies, preconditions, and
  expected effects?
- **SAI-Q017:** How are comments, authored ordering, copy, formatting, and intentionally unusual source
  preserved?
- **SAI-Q018:** Which operations can be lowered deterministically, and which still require the model to
  author Tao expressions or blocks?
- **SAI-Q019:** What is atomic when one semantic request produces several file edits, compilations, fixture
  changes, and scenario changes?
- **SAI-Q020:** How should conflicts and partial success behave when source changes after a proposal?
- **SAI-Q021:** Which semantic operations are expressive enough to implement a feature without growing into
  a second programming language?
- **SAI-Q022:** Does a proposed change carry an intended behavioral result that Tao can verify independently
  of its exact edits?

### Agent boundary and trust

- **SAI-Q023:** Can Studio derive an agent's read and tool authority from an `Assistant`-like closed
  projection, or does development tooling need a distinct declaration and trust model?
- **SAI-Q024:** How are `secret`, credentials, captured provider data, foreign-code details, and user data
  excluded or redacted from semantic responses?
- **SAI-Q025:** How should prompt injection in source copy, comments, fixtures, imported packages, or runtime
  data affect instructions and tool authority?
- **SAI-Q026:** What audit trail, provenance, confirmation, undo, and recovery are required for an agent run?
- **SAI-Q027:** Can one agent run become one undo step before the general action-transaction contract is
  settled?

### Local model and evaluation

- **SAI-Q028:** Which tool shapes and structured response schemas does Apple Foundation Models follow most
  reliably on the supported macOS/model versions?
- **SAI-Q029:** What context size, latency, tool-call count, and raw-source fallback rate make the semantic
  path meaningfully better?
- **SAI-Q030:** Which benchmark questions measure real semantic advantage rather than a conveniently chosen
  demo?
- **SAI-Q031:** How should prompts, tool schemas, and results be versioned and re-evaluated as Apple's system
  model changes?
- **SAI-Q032:** Which failures belong to model capability, deficient Tao semantics, a poor query protocol,
  or the provisional implementation? _Partial evidence (2026-09-02):_ the observed failures split cleanly; see
  "What failed" below.
- **SAI-Q037:** The on-device model's whole context is 4,096 tokens. Which semantic projections are worth
  those tokens, and should Tao budget per turn rather than per tool result?
- **SAI-Q038:** When the model names a wrong but similar declaration (`schemeBody` for `body`), should Tao
  answer the literal request, refuse with candidates, or resolve against the question's own text?
- **SAI-Q039:** Should a semantic change request carry the model's rationale as a first-class operand so Tao
  can check the operand against it, as the PoC's normalization step did?
- **SAI-Q040:** When Tao corrects a model operand (screen to owning view, private view to visible subject),
  is that a silent repair, a visible plan step as in the PoC, or a question back to the model?
- **SAI-Q041:** Which "analogous declaration" relation should the production graph expose, given that the
  whole feature lowering hangs off one: a field with a writer and a presentation is a reusable template.

### Protocol and ecosystem

- **SAI-Q033:** What is the core versioned local protocol, independent of Foundation Models, Studio UI, and
  MCP?
- **SAI-Q034:** Should external agents receive the same semantic operations as Studio's local agent or a
  narrower capability projection?
- **SAI-Q035:** What belongs in compiler output, an always-live workspace service, a Studio session, the CLI,
  or an MCP adapter?
- **SAI-Q036:** How can the protocol stay useful to deterministic tools and humans rather than becoming an
  AI-only duplicate of existing compiler APIs?

## PoC definition

### Hypothesis

A small on-device agent can perform useful Tao Studio reasoning and at least one meaningful edit while
receiving substantially less raw source because Tao supplies compact, compiler-derived semantic context and
interprets a typed semantic change request.

### Required proof

The PoC is complete when one recorded Studio demonstration proves all of the following, even through narrow,
hard-coded machinery:

1. **Semantic overview:** the local model receives a compact structured overview of one Tao app without
   receiving the app's complete source.
2. **Progressive inquiry:** the model makes at least two semantic inquiries at different resolutions, such
   as app → declaration → relationship or selected render → design/scenario neighborhood.
3. **Cross-cutting answer:** Tao answers at least one question that would ordinarily require inspecting
   several declarations or files, and the response distinguishes compiler facts from model interpretation.
4. **Evidence:** the answer carries resolvable semantic/source evidence that Studio can reveal to the person.
5. **Structured change request:** the model requests at least one change using a typed semantic operation,
   not a model-authored text diff as the primary request.
6. **Tao interpretation:** Tao resolves that operation against current project state and produces a proposed
   ordinary-source change.
7. **Visible result:** the proposed change can be reviewed, applied, compiled, and observed in a Studio
   preview or scenario.
8. **Recovery:** the demonstration can undo the applied change through Studio or otherwise restore the exact
   starting source.
9. **Local execution:** all model inference runs on-device through Apple Foundation Models on macOS without
   a network model or cloud fallback.
10. **Comparison:** the exploration records a rough comparison between the semantic path and a raw-source or
    search-driven baseline, including context size and observed strengths or failures.

### Suggested forcing journey

The preferred journey is **Review this screen and apply one improvement**:

1. Select a rendered element or scenario cell in Studio.
2. Ask the local agent to review it.
3. Give the agent a compact semantic packet covering the selected occurrence, render owner, design landing
   and blast radius, scenario/environment, relevant data declarations, and current diagnostics.
4. Let the agent request one or two deeper semantic projections.
5. Return up to three observations, each labeled as a Tao fact, model inference, or suggestion and linked to
   its evidence.
6. Choose one suggestion that maps to a typed semantic change—for example, update or fork a design value,
   insert an existing view, or add a missing scenario.
7. Have Tao produce the source proposal, apply it, compile it, display the changed cell, and undo it.

The implementer may substitute another journey if it proves the same bidirectional capability more cheaply.
Strong alternatives include tracing who reads and writes a field before adding a declaration slot, finding
missing state coverage and adding a scenario, or using a local MCP client to add a small feature through Tao
queries and changes.

### Suggested benchmark questions

Use at least three, modifying names to match the chosen forcing app:

- What can change `Recipe.Favorite`, and where is its value presented?
- Which meaningful states of `RecipeScreen` do not have scenarios?
- What declarations and rendered occurrences would a change to this design token affect?
- Is this action exposed to assistants, and what data may that assistant read?
- What is the smallest coherent change set for adding archive behavior?
- Why does this selected element look or behave this way in the active scenario?

The PoC may knowingly return incomplete answers. Record the missing semantics rather than broadening the
experiment until every question works.

### Suggested provisional tools

The exact names and schemas are disposable. A compact starting shape is:

- `overview(scope, budget)` — return major product declarations and capabilities;
- `inspect(target, lens, depth)` — return selected facts about one semantic target;
- `trace(target, relationship, direction, budget)` — follow a bounded semantic path;
- `propose(changes, constraints)` — plan typed semantic changes and return impact plus a source proposal;
- `verify(proposal, gates)` — compile and, where cheap, preview or run focused checks.

The implementer may collapse these into one endpoint, split them, skip tool calling and orchestrate explicit
model turns, or expose fixed buttons that issue the calls. The proof concerns the information flow, not the
tool API.

### Suggested semantic subset

Support only what the forcing journey needs. Candidate nodes are app, data declaration, field, action, query,
view, render occurrence, design value, fixture, scenario, assistant projection, and source location.
Candidate relationships are reads, writes, invokes, renders, styled-by, covered-by, exposed-to, imports,
and located-at.

It is acceptable to derive some relationships from existing compiler manifests, some from resolved AST
references, and some from a temporary hand-built adapter. Every returned relationship should say where it
came from so the later design can distinguish available semantics from PoC fabrication.

### Success evidence

Capture the following under ignored `.artifacts/` scratch state or directly in the findings section below:

- the chosen app, task, and starting revision;
- the structured context supplied to each model turn;
- approximate input/output size or token count;
- semantic queries and raw-source fallbacks;
- the model's structured response;
- the semantic change request and Tao-produced proposal;
- before/after Studio screenshots or a short screen recording if convenient;
- compilation, focused-check, preview, and undo outcomes;
- wrong, missing, ambiguous, or invented claims;
- implementation shortcuts that must not survive into production design.

### Explicit non-goals

The PoC does not need:

- a complete or canonical project graph;
- a stable public protocol, MCP server, or CLI;
- general support across Tao projects, declaration kinds, or platforms;
- arbitrary feature implementation;
- a polished chat or assistant UI;
- a production trust, permission, authentication, or audit design;
- perfect prompt-injection defenses beyond keeping the experiment local and proposal-first;
- stable semantic identities across every refactor;
- comments and formatting preservation beyond what the chosen demonstration needs;
- multi-file atomicity, collaboration, conflict recovery, or transaction semantics;
- broad accessibility, localization, performance, packaging, release, or migration work;
- repository-wide tests or `./agent verify` as proof that the prototype architecture is sound;
- a mergeable abstraction or code quality suitable for `main`;
- proof that AI output is generally correct.

## PoC implementation plan

This sequence is a suggested shortest path, not a prescribed architecture. The implementer may reorder,
combine, replace, or skip steps when another path produces the required proof faster.

### 0. Choose the demonstration and baseline

- Pick one existing app and one selected-screen or field-centered journey.
- Record the starting revision and a small set of benchmark questions.
- Give the local model ordinary source/search context for one baseline run, or estimate the files and context
  that a conventional agent would need.
- Decide which single semantic write best demonstrates the reverse path.

Stop expanding the app scope once the required proof can be demonstrated.

### 1. Produce a temporary semantic snapshot

- Assemble the smallest useful project representation from current parser/workspace state, compiler
  manifests, render occurrence metadata, design inspection, scenario metadata, and source identities.
- Emit plain JSON if that is fastest.
- Hard-code missing joins or one declaration adapter when necessary, but label each derived versus hard-coded
  fact.
- Include compact stable-enough handles that can be passed into a later query during the same session.

Do not pause to design the canonical graph or durable identity system.

### 2. Add progressive semantic queries

- Implement enough overview, inspect, and trace behavior for the benchmark questions.
- Accept explicit projection and budget parameters, even if their implementation is crude truncation.
- Return source handles and evidence without automatically returning full source.
- Refuse or mark unsupported relationships rather than inventing completeness.

A switch statement over the chosen node kinds is acceptable.

### 3. Connect the on-device model

- Reuse or bypass the existing Apple Foundation Models helper/provider as convenient.
- Use only the on-device `SystemLanguageModel`; report unavailable status and stop without fallback.
- Expose only the tools needed for the active task, or orchestrate separate fixed turns if tool calling slows
  the proof.
- Prefer guided structured responses for findings, evidence handles, and requested semantic changes.
- Log bounded, local diagnostic traces sufficient to understand the model's decisions.

Do not build a provider abstraction or generalized agent runtime for this experiment.

### 4. Add the smallest Studio surface

- A button, command-palette entry, temporary drawer, debug panel, or plain development page is sufficient.
- Scope it to the selected render/cell if that path is readily available; otherwise let the user choose a
  fixed declaration.
- Display Tao facts separately from AI interpretation and suggestions.
- Let evidence open the relevant Studio target or source where cheap.

Visual quality is irrelevant unless it prevents the demonstration from being understood.

### 5. Prove one structured semantic change

- Define one narrow change request with typed operands.
- Resolve its semantic target against current source or the temporary snapshot.
- Lower it through an existing Studio source action when convenient; a dedicated PoC transformer is also
  acceptable.
- Return the exact source proposal and compile outcome.
- Apply only after explicit confirmation, show the changed preview/scenario, and prove undo or exact restore.

Good low-cost candidates are `set-style-entry`, inserting an existing component/view, adding a scenario,
or adding one simple data field plus its most obvious presentation. Pick whichever avoids unrelated work.

### 6. Run the proof and compare

- Run the selected journey using the local model.
- Ask the benchmark questions and record correct, partial, unsupported, and wrong results.
- Compare structured context volume, raw source read, tool calls, latency, and intervention against the
  baseline.
- Repeat only enough to tell whether success was robust enough to justify real design work; statistical model
  evaluation is not required.

### 7. Convert implementation experience into design input

- Update the decision and question ledgers.
- Fill in the findings template below with direct evidence.
- Identify which Tao semantics produced the largest context or reliability gain.
- Identify missing compiler/runtime facts that forced search, hard-coding, or model inference.
- List every shortcut and whether the production design should replace, retain, or investigate it.
- Recommend whether to proceed, change the hypothesis, or stop.

Do not turn the PoC branch into the production implementation. The next work item is a separate thorough
design based on the evidence collected here.

## Implementation freedom and minimum boundaries

The implementer owns routine choices and should optimize for learning speed. They do not need approval to
choose a temporary schema, transport, graph representation, endpoint, prompt, UI, test strategy, or forcing
app. They should ask Ro only when the demonstration requires a genuine Tao semantic or product decision
that cannot be avoided or safely treated as a PoC convenience.

The following minimum boundaries remain because violating them would weaken rather than strengthen the proof:

- use no cloud model or silent network fallback;
- do not present hard-coded or model-inferred relationships as compiler-proven facts;
- do not silently apply source changes;
- preserve a reliable way to restore the starting source;
- do not amend authoritative Tao decisions to accommodate the prototype;
- do not merge the PoC implementation into `main`;
- record enough of every shortcut that later design does not mistake it for validated architecture.

## Findings ledger

Observed evidence is stated first in each subsection; interpretation is marked as such.

### Demonstration record

- **Date:** 2026-09-02
- **Branch/revision:** `poc/semantic-agent-implementation`, based on `poc/semantic-agent-poc` (b8b44e0c); the
  implementation commits follow it.
- **Forcing app and journey:** WordFlower `Apps/WordFlower/1 - Current`, app `WordFlower`. Journey: select
  the `WorkspaceRow` "Novel" render in the Studio preview, click **Review** in the PoC overlay, read the
  packet, tool calls, findings, and typed change, ask Tao for a proposal, apply, observe the recompiled
  preview, undo.
- **Model/OS/Xcode:** Apple Foundation Models `SystemLanguageModel.default` (availability `available`),
  macOS 26.5.2 (25F84), Xcode 26.6 (17F113), Swift 6.3.3. No network model exists in the code path; the
  helper imports only `FoundationModels` and `Foundation`.
- **Semantic subset:** nodes: app, view, stdlib element, entity, field, action, state, query, render, design,
  bundle (bundle / `styles` entry / `text` entry), token (flat, `colors`, `sizes`), scenario, fixture.
  Edges: `renders`, `styled-by`, `writes`, `reads`, `invokes`, `covers`, `uses-design`, `declares`,
  `queries`. Queries: `overview`, `inspect(target)`, `trace(target, relationship)`, plus a fixed
  `field(target)` story used for the benchmark.
- **Structured change demonstrated:** `{"kind":"set-design-entry","designName":"WordFlowerDesign","memberName":"card","entry":["pad",18]}`
  lowered by Tao to a formatted `Design.tao` edit:
  `card [gap 10, pad 16, radius 14, bg surface, border line]` → `card [gap 10, radius 14, bg surface, border line, pad 18]`.
- **Outcome:** all ten required proofs were exercised in one Studio session. Review took 6.1–7.3 s wall
  clock with 2 tool calls; apply compiled preview revision 2; undo restored the exact starting source
  (`git diff` on `Design.tao` empty) and compiled revision 3.

How to run it:

```
just studio "Apps/WordFlower/1 - Current" --app WordFlower --port 4820
```

Open the advertised session URL, click a render in the preview, then **Review** in the bottom-right
"Local agent (PoC)" panel. Every run is logged under `.artifacts/agent-poc/runs/`. The same queries are
available without Studio: `bun packages/studio/studio-src/agent-poc/snapshot-cli.ts <projectRoot> <entry.tao> <App> [overview|inspect <t>|trace <t> <rel>|field <t>|dump]`.
Benchmark questions run through `POST <session>/api/agent-poc/ask` with `{question, mode: "semantic" | "source"}`.

### What worked

- **Semantic overview without source.** The packet for the selected view was 2,062 characters; the model
  never received a source file in the review journey. The overview of the whole app is 2,347 characters
  (26 views, 3 entities, 47 bundle names, diagnostics count).
- **Progressive inquiry.** In the successful runs the model called `inspect(view:WorkspaceRow)` and then
  `trace(view:WorkspaceRow, reads)` or `trace(..., renders)`; in the first run it also inspected the
  `sectionTitle` bundle to see its blast radius. The three benchmark answers used 1–3 tool calls each.
- **Cross-cutting answer.** "What can change `Document.Final`, and where is its value presented?" was
  answered correctly from edges alone: written by `action:DocumentEditor.SetFinished`, read by
  `view:DocumentEditor`, with `src:` evidence for both. The raw-source baseline found the checkbox line
  but not the writer and answered "Document.Final is Final".
- **Evidence.** Facts are lines like `view:WorkspaceRow -> element:Col [compiler] src:@ui/Workspaces.tao:10882-11281`.
  The panel turns any `src:` or `render:` handle into a link that opens the file in the editor.
- **Fact versus inference.** Every edge carries `compiler` or `poc-derived`; the panel labels each model
  finding as "restating Tao fact", "inference", or "suggestion". The two are visibly different sources.
- **Typed change → ordinary source → preview → undo.** The model's request was a four-field object, not a
  diff. Tao resolved the design and member, produced a formatted proposal shown as a unified diff, applied
  it through the existing source-action bus with a checkpoint, compiled, refreshed the preview, and undid it.
- **Local execution.** The helper reported `availability: available` and ran `LanguageModelSession` in
  process. Model latency for one review was 6.0–7.2 s; the first attempt with a broken stdin was 2.4 s per
  probe turn.

### Second journey: add a feature by describing it

Observed, 2026-09-03, same branch and app:

- Typing "let people archive documents" into the panel produced a complete plan in **2.0 s wall clock,
  1.7 s of it model time**, from a **1,366-character prompt** over an **868-character** packet of facts.
  The model made **zero tool calls**: it received the entity list, the views per entity, the existing
  yes/no patterns, and the scenario groups, and was asked only for the shape.
- The shape it returned: entity `Documents`, field `Archived`, kind `yes/no`, label `Archive`, present in
  `DocumentScreen`, scenario `archive`. Eight short strings, no Tao.
- Tao then decided every placement and reported each one:
  - present in `DocumentEditor` instead of `DocumentScreen`, because `DocumentScreen` renders it and it
    already presents a `Document` yes/no field;
  - add `Archived yes / no` after `Final` in the data file;
  - add `SetArchived(Value boolean)` after `SetFinished`, writing the new field;
  - render `Checkbox #markArchived` bound to `Document.Archived` after `#markFinal`, invoking `SetArchived`;
  - add fixture row `ArchiveDocument = create Document { Title: "Archive sample", Workspace: Novel, Archived: true }`,
    importing `Documents` from the data folder;
  - add `scenarios DocumentScreen "Archive" / "archive"` rendering `(Document: ArchiveDocument)`, importing
    `DocumentScreen`, because `DocumentEditor` is file-private and cannot be a scenario subject.
- Applying wrote three files, compiled once (preview revision 2), and a new **archive** preview cell appeared
  showing the document screen with a `Final` checkbox off and the new **Archive** checkbox on, driven by the
  fixture value. Undo restored all three files in one step (revision 3) and the working tree was clean.
- Two wrong placements were caught by Tao, not by the model: the screen-versus-view confusion and the
  file-private scenario subject. Both are reported as plan steps rather than silently repaired.

Interpretation: the split works. The model is good at naming a feature and bad at knowing where code goes;
the graph knows exactly where code goes. Keeping the model's output to eight strings removed every failure
mode that dominated the first journey.

### Third journey: the same panel against a second app

Observed, 2026-09-03, HNReader (a single-file app with no yes/no field, no fixture, and no scenarios):

Asking that panel to "switch to order of points and comments" produced a field named `Order` and the
sentence "StoryRow has no existing yes/no Story field to copy the pattern from". Nothing was wrong with the
model. The planner knew exactly one shape, "add a yes/no field", and every request was forced into it.

Three defects sat behind that one screen, and each is worth recording separately.

**One shape is not a vocabulary.** A planner with a single shape cannot decline. It answers every request
with the only sentence it can form, and a person reads a confident plan for something they did not ask for.
The fix was to make the model sort the request first, then fill a shape typed for that kind. Sorting is a
much easier task than shaping: a 4k on-device model classified "switch the order of points and comments",
"add a search screen", and "make the story cards use a bigger corner radius" correctly on the first try,
with a one-sentence reason. A request outside the supported kinds is now answered with what was asked and
what the tool builds, which is a better answer than a wrong plan.

**Copying an analogous declaration does not bootstrap.** Every placement in the second journey was found by
copying an existing yes/no field's own pattern. That is a good rule and a complete blocker for the first
flag in any app: HNReader has no boolean field, so nothing could ever be placed. Tao already knows the
structure without an analogue - the last field of the entity, the view's render block, the last thing the
view renders - and placing from structure works. The analogue is now a preference, not a precondition, and
the plan says which of the two was used. It also has to carry what a copied pattern brought along for free:
the first `Checkbox` in an app needs adding to the view's stdlib import, which copying never had to think
about.

**A per-placement edit is not a change.** The planner produced one whole-file edit per placement. In an app
whose entity, view, and entry live in separate files that is correct by accident. HNReader declares all
three in one file, so the second edit was computed from the original text and silently discarded the first:
the field vanished and the applied code failed to compile against its own new field. Placements are now
staged as ranges against each file's original text and the file is rewritten once.

A fourth, smaller thing: the model wrote `bookmarked` where Tao wants `Bookmarked`, and the planner refused
the whole shape over it. Tao knows the convention. It now repairs the name and reports the repair, the same
way it resolves a bundle operand in the review journey.

Afterwards, on HNReader: "show the comment count before the points" was sorted as a reword, the right line
of the right view was chosen out of ten candidate strings, and the rewritten line kept all three
placeholders. Applying wrote one file, compiled, and the story rows re-rendered with the new order; undo
restored the file exactly. "Let people bookmark a story" now plans four placements and compiles, with the
scenario step honestly reported as unsupported because the app declares no fixture to switch on.

### Fourth journey: the change is judged by the app's own tests

Observed, 2026-09-03, HNReader:

Everything before this point checks a change against itself. The plan says a placement is right because the
graph says so; the compile says the source is well-formed; the preview shows a screen that looks fine. None
of them can say the change is **wrong**, and the reword journey produced exactly that case: a valid,
well-placed, compiling change that silently broke what the app is supposed to show.

The panel now runs the app's behavior tests before applying, runs them again after, and reports the
difference. On the reword it says:

> This change breaks 1 test the app passed before it.
> `hn reader > fills the front page from the feed`
> `expect text "42 points by tester · 2 comments" expected rendered text but found none.`

On the bookmark flag, which no journey asserts against, it says the app's tests still pass.

Three things made the verdict worth trusting rather than merely present:

- **The baseline.** Without a run from before the change, a red test cannot be attributed to it. The
  baseline is taken while the plan is on screen, so it usually costs nothing by the time Apply is pressed,
  and the verdict names only tests that this change turned red. With no baseline it reports the failures and
  explicitly declines to blame them on the change.
- **Counting tests, not records.** The Tao runner reports a failing journey twice: the assertion, then the
  source frame it sat in. Reported naively the panel claimed two broken tests and quoted a comment from the
  runner's own source as the second reason. A verdict that miscounts is worse than no verdict.
- **Declining to answer.** An app with no tests gets "nothing checked the change", not a green tick.

Interpretation: this is the first thing in the exploration that can contradict the agent. The graph makes
the agent's changes well-formed; only the app's own behavioral contract makes them correct. A production
design that lets an agent write code without running that contract is shipping the reword bug.

The cost is small: HNReader's suite runs in about 3 seconds, twice per applied change, and the first run
overlaps with reading the plan.

### A guardrail worth keeping: the reword cannot invent a value

A reword is the first change kind here where the model writes text that ships. The guardrail is cheap and
total: every `{ ... }` placeholder in the replacement must already appear in that line, or name a field of
an entity the view takes. A reword can therefore reorder the screen, drop a value, or reach one more field
of the same entity, and can never name something that would not compile. It also rejects a replacement
equal to the original, the same no-op rejection the design-edit journey needed.

The on-device model's wording quality is the weak part, not its safety. One run produced "by points {
Story.Score } and comments { Story.CommentCount } by { Story.Author }" - valid, placed correctly, and
clumsy English. The mechanism held; the prose did not. A production design should expect to show the
rewritten line and let a person accept it, rather than trusting the wording.

Splitting the reword into two model turns - choose the line, then rewrite that one line - was necessary.
Asked to do both at once the model echoed the whole candidate list into the replacement field. With one
line in the prompt it rewrote that line. This is the same lesson as SAI-Q028 at a smaller scale: keep each
guided turn's context to exactly what the answer needs.

### A compiler defect the feature journey surfaced

The Studio preview manifest published a boolean fixture field as the **string** `"true"`, because the
grammar's boolean literal value is the source word while the manifest's own type declares `boolean`. The
first applied feature compiled and then failed in the preview with
`Field 'Document.Archived' expects boolean, got string`. No app fixture in the repository had ever set a
boolean field, so nothing exercised it. Fixed at both the fixture-field and field-default sites, with a
compiler test. This is the clearest evidence for the exploration's premise: a generated feature exercised a
path handwritten code never had.

### What failed or required raw source

Observed:

- **Guided generation drifts after tool calls.** A single `respond(schema:)` turn that also called tools
  ended in prose twice (`decodingFailure: Failed to convert text into GeneratedContent`). A schema-only
  conversion turn in the same session recovered one case; a guided-first-then-convert order is what ships.
- **The model loops on tool calls when results are errors.** With stdin accidentally closed, the model
  called `inspect(view:WorkspaceRow)` 55–68 times until the 4,096-token window overflowed. The helper now
  caps calls (3 for review, 4 for questions) and suppresses exact repeats.
- **Operand confusion.** The model once wrote `memberName: "WordFlowerDesign"` (the design) where a bundle
  was required, while its rationale said `sectionTitle`. Tao's normalization step resolved it. It also
  inspected `schemeBody` when asked about `body`, twice, and concluded body affects no views (wrong).
- **Mislabelled findings.** In the third run the model labelled the opinion "padding on the card is too
  large" as a fact. Labels are model output, not Tao output; only the `origin` on edges is trustworthy.
- **Scenario coverage answer was 25/26.** Asked which views have no scenarios, the model listed every view
  including `WorkspaceRow`, which the overview marked `scenarios 1`.
- **Raw-source fallbacks:** none in the semantic path. The model was never given a source tool in that
  mode and never asked for one. The `source` baseline mode is a separate run.

Interpretation: the guided-generation drift, the repeat loop, and the name confusions are model-capability
or protocol issues (SAI-Q028, SAI-Q032, SAI-Q038), not missing Tao semantics. The one Tao-side gap that hurt
was list truncation in `overview`, fixed by emitting one-line lists.

### Context and performance observations

| Question / task                                          | Mode     | Tool calls | Prompt chars | Tool result chars | Model ms | Result                                    |
| -------------------------------------------------------- | -------- | ---------- | ------------ | ----------------- | -------- | ----------------------------------------- |
| Review `WorkspaceRow` (run 2)                            | semantic | 2          | 2,739        | 2,264             | 7,200    | correct facts, valid `card pad 18`        |
| Review `WorkspaceRow` (run 3)                            | semantic | 2          | 2,739        | 1,839             | 6,000    | one mislabelled fact, valid `card pad 10` |
| What can change `Document.Final`, where presented?       | semantic | 3          | 282          | 3,061             | 4,381    | correct, evidenced                        |
| same                                                     | source   | 3          | 174          | 174               | 2,010    | wrong (no writer found)                   |
| Which views does bundle `body` affect, how many renders? | semantic | 3          | 293          | 3,861             | 3,357    | wrong (inspected `schemeBody`)            |
| same                                                     | source   | 2          | 185          | 206               | 2,871    | wrong (hallucinated from comments)        |
| Which views have no scenarios?                           | semantic | 1          | 258          | 2,347             | 5,172    | 25 of 26 correct                          |
| same                                                     | source   | 2          | 150          | 295               | 1,529    | wrong                                     |

Observed: the whole context available to the model is 4,096 tokens, so the semantic path spends roughly
600–1,100 tokens of tool results per question and the review packet is about 700 tokens. The source
baseline is faster and smaller only because the model gave up after two or three shallow searches; it never
read a whole file (a full `Documents.tao` is 5,730 characters, over a third of the window on its own).

Interpretation: on a 4k window the semantic path is the only one that can answer cross-declaration
questions at all; the comparison is less "fewer tokens" than "an answer exists". Correctness is bounded by
the model's ability to copy exact names.

### Missing Tao semantics or tooling

- **Typed reads.** Field reads and `update` writes are `poc-derived`: the PoC guesses the entity from a
  parameter's declared type name or a query's collection name. The validator's type information is not
  exposed to consumers; a production graph needs the resolved entity per member access.
- **Style landing by name.** `styled-by` edges are name matches against the app-selected design, the same
  rule the Studio inspector applies. Design members are not scoped values, so the parser cannot resolve
  them; the language decision on whether they should be is SAI-Q007 territory.
- **No reverse reference index.** Every "who uses X" answer is a full walk of all files per request.
- **No render-occurrence identity across edits.** Render ids are `path:start:end`; the undo demonstration
  worked only because the design edit does not touch the selected render's file.
- **No scenario environment in the graph.** Scenario clauses are copied as source text lines; the manifest's
  resolved environment was not joined.
- **No diagnostics beyond linker/validator.** Compile diagnostics from the Studio coordinator are not in the
  packet.
- **Entry ordering.** `setLayoutClauseEntrySource` moves an edited entry to the end of the clause
  (`pad 18` after `border line`); a production lowering should edit in place.

### PoC shortcuts that must not become architecture accidentally

- `agentPocParse()` on `StudioProjectSession` re-parses the whole app per request.
- `AgentHelper.swift` duplicates the shipped helper's dynamic-schema code and adds a stdio protocol with
  no authentication; it is compiled to `.artifacts/build/agent-poc/` by mtime.
- Tool call budget, dedupe, and the guided-then-convert order are hard-coded in Swift.
- `normalizeChange` in `AgentPocServer.ts` reads the model's rationale text to repair its operand.
- `set-design-entry` exists only to avoid the same-file constraint of `set-style-entry`; the two overlap.
- The panel keeps its own last-checkpoint state and bypasses `StudioApp`'s undo stack.
- `.claude/launch.json` gained a `studio-wordflower` entry on port 4820 for the demonstration.
- The `ask` endpoint reads every project file into memory to serve the source baseline.

### Decisions added, changed, or superseded

- Added SAI-D015 through SAI-D019 (all PoC convenience). No direction-to-prove entry changed.
- SAI-D007 (compact context beats source search) is supported only in the narrow sense above; the 4k window
  dominates.
- SAI-D014 (source only when facts are insufficient) held: no raw-source fallback occurred.
- Added **SAI-D024**: the model sorts a request into a change kind before it shapes anything, and a request
  outside the known kinds is answered as such. A planner with one shape cannot decline, and a plan for the
  wrong change reads more confident than no plan at all.
- Added **SAI-D025**: an analogous declaration is a preference for placement, never a precondition. Tao
  places from the declaration's own structure when no analogue exists, and the plan says which rule applied.
- Added **SAI-D026**: placements are staged as ranges against each file's original text and each file is
  rewritten once. A whole-file edit per placement is only correct when no two placements share a file.
- Added **SAI-D027**: model-authored text that ships must be checkable against the graph. A reword may only
  use placeholders the line already had or fields of an entity the view takes.
- Added **SAI-D028**: an applied change is judged by the app's behavior tests, measured before and after, so
  the verdict names what this change broke. A verdict without a baseline, or for an app with no tests, is
  reported as unknown rather than as success.

### Questions answered or newly discovered

- SAI-Q028: guided generation is reliable in a schema-only turn; unreliable when the same turn calls tools.
  Dynamic `DynamicGenerationSchema` from JSON Schema worked for both tools and output.
- SAI-Q029: budgets that fit are roughly 700 tokens for a packet, 300–700 per tool result, 2–3 calls.
- SAI-Q032: see "What failed"; the split is recorded per failure.
- New: SAI-Q037, SAI-Q038, SAI-Q039, SAI-Q040, SAI-Q041.
- SAI-Q018 (deterministic lowering versus model-authored Tao): for one field-shaped feature, **none** of the
  Tao was model-authored. The model produced eight short strings; Tao produced every edit.
- SAI-Q021 (expressive without becoming a second language): the typed feature shape stayed at eight fields.
  It expresses one feature family, not arbitrary features, which is the honest boundary. A second kind
  (reword) needed four fields and no new vocabulary, which suggests the shape-per-kind split scales further
  than one enlarged universal shape would.
- SAI-Q041 (the general form of the "analogous declaration" relation) gained a second data point: the
  relation is a shortcut, and the structural rule underneath it - last field, render block, last render -
  is what actually generalizes. Design the structural rule first and treat the analogue as a refinement.
- New: **SAI-Q042** - who judges the wording when the model writes text a person will read? The graph can
  prove a reword compiles and cannot prove it reads well. The PoC shows the line before applying; a
  production design needs a real answer.
- New: **SAI-Q043** - how should a plan report a step it cannot take? HNReader has no fixture, so the
  scenario step is honestly unsupported while the other placements still apply. A partial plan that says
  what it left out was more useful here than an all-or-nothing refusal, but that is one observation.
- New: **SAI-Q044** - should an agent's change be applied at all when it breaks a test? The PoC applies,
  reports, and offers undo, which suits a person watching. An agent working unattended needs a decided
  policy: revert automatically, or hold the change unapplied until a person rules on it.
- New: **SAI-Q045** - the tests only judge what they already cover. The bookmark flag passed because no
  journey asserts anything about it, which is a weaker statement than it appears. Whether an agent should
  also be asked to write the journey for what it built, and whether a test it wrote itself is evidence,
  is unresolved.

### Also fixed: the no-op design edit

The first journey could produce an edit that changed nothing. The model asked for `pad 16` on a bundle
already at `pad 16`, and the lowering moved the entry to the end of the clause, so the diff looked like a
change while the preview did not move. Design entries are now edited **in place**, an equal value is refused
as a no-op both in the source action and in the operand check, and the model is told the value must differ
from the one it was shown.

### Also fixed: a preview that was empty for a reason no one could see

Running the panel against HNReader surfaced a Studio problem unrelated to the agent. A project can compile
and still show an empty preview, because the bundler resolves the generated TypeScript rather than the Tao
source; its failures reached a person as a white frame and a problems panel reporting nothing wrong. Studio
now asks the preview's bundler whether it can build the app and puts the answer over the preview in the
band a failed compile already uses.

The failure that exposed it is worth noting for the developer environment: the preview's Metro instance
crawls the runtime directory before the first compile writes the generated app into it, and the adds during
that burst were not picked up. The bundle then fails to resolve a file that plainly exists on disk, for the
life of the session. Touching the generated tree repairs it. The ordering, not the notice, is the real fix.

### Recommendation for the production design phase

Proceed to the design phase. The information flow and the change flow are both possible, and the change
flow reused Studio's existing proposal, checkpoint, compile, and undo seams unchanged. Design work should
start from three constraints this experiment made concrete: a 4k-token model budget per interaction, exact
declaration names as the model's weakest skill (so queries should tolerate or correct near-misses and Tao
should validate every operand against facts before lowering), and typed reads/writes in the compiler so the
`poc-derived` edges become compiler facts. Free-form tool calling should stay, but with a Tao-owned budget
and repeat suppression rather than model discipline.

The second journey sharpens this. The most valuable division of labour found here is not "the model writes
code Tao validates" but **the model names the intent and Tao derives the code from an analogous declaration
already in the project**. That inverts where correctness comes from: the model's output was eight strings,
every one checkable against the graph, and two of them were wrong and caught. A production design should
look for the general form of the "analogous declaration" relation (SAI-Q041) and for how far a typed shape
can stretch before it becomes a second language (SAI-Q021).

## Exit condition and handoff

The exploration ends after the required proof has run and the findings ledger is complete. A successful PoC
means only that the intended semantic information flow and semantic change flow appear possible and valuable.
It does not validate the prototype's graph, protocol, API, prompts, UI, security, source transformations, or
architecture.

The follow-up design should begin from the desired product contract and the evidence in this document, then
re-evaluate every PoC implementation choice. Its output should settle the real semantic model, protocol,
identity, query, change, trust, evaluation, Studio UX, MCP, and migration contracts before production
implementation begins.
