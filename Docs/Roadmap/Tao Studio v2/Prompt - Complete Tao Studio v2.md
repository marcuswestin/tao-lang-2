# Tao Studio v2 — complete the remaining product implementation

Implement the remaining Tao Studio v2 product work in the Tao repository.

This is an implementation project, not a planning-only exercise. Inspect the live repository and
implementation ledgers first, settle the explicitly unresolved language decisions with Ro, then
implement the remaining work as tested vertical slices.

This prompt is the project's requirement authority. Commit it to
`Docs/Roadmap/Tao Studio v2/Prompt - Complete Tao Studio v2.md` in your first commit so the final
handoff can reconcile against it. Where this prompt and older repository documents disagree, this
prompt reflects the newer intent; where it and `Docs/Roadmap/Tao Revolution/Decisions.md` disagree,
Decisions remains the authoritative decided language until Ro amends it.

Do not redo landed Studio foundations. Preserve the existing architecture:

- Tao source is the only durable product authority.
- Visual changes are typed, versioned source actions.
- Studio’s production browser root is a compiled Tao app.
- The workbench shell, editor controller, protocol, and native wrapper may remain TypeScript where
  the strangler plan explicitly permits it.
- The code editor remains a foreign view.
- Saving remains explicit through Command-S; do not restore write-on-every-keystroke behavior.
- Browser Studio remains permanently supported.
- The scenario canvas remains scrollable without zoom or freeform panning.
- Scheme must be implemented through the real design/runtime semantics, never browser-only
  recoloring that falsely implies native support.

## Settled project rulings

Ro has already ruled on the following; do not reopen them, and record them for adoption in Slice 13:

1. **Studio is a forcing app.** `TaoStudioClient.tao` is a real product and may force language
   capabilities, amending the rule that only the four WordFlower versions force capabilities.
   WordFlower still absorbs every new syntax in the same tranche so Next/Current stay canonical.
2. **Tranche end state.** This project cuts a new tranche into `2 - Next`. Every implemented
   language change is fully absorbed into `1 - Current`; decision-blocked capabilities may remain
   authored in Next with the tranche honestly marked open at handoff. Partial completion must still
   leave a coherent, green, absorbed-what-landed state.
3. **View-instance persisted state is device-local**, extending the existing app-level persist
   machinery (the `tao.persisted-state.v1` declaration-identity key scheme is the natural anchor;
   propose the key-derivation extension, do not invent a parallel store).
4. **Scheme ships browser-first.** A genuinely reactive browser implementation through the real
   runtime/design system, with an honest, explicit native capability boundary, is an acceptable end
   state. Only `Scheme` is in scope; `Contrast`, `Motion`, `TextScale`, and the other environment
   values in the Decisions table stay deferred.
5. **Priority order is mandated**: Slice 1 → 2 → 3/4/5 → 11 (validating what has landed) → 6 →
   7/8/9 → 10 → 13. Slice 12 is conditional throughout. If budget or decision latency cuts the
   project short, later slices are dropped, never interleaved half-done.

## Repository workflow

1. Read:
   - `AGENTS.md`
   - `packages/AGENTS.md`
   - `Apps/WordFlower/README.md`
   - `Docs/Roadmap/Tao Studio v2/Plan - Tao Studio v2.md` (the landed-foundations ledger and its
     “Next integration gates”)
   - `Docs/Roadmap/Tao Studio v1/Plan - Tao Studio v1.md` (protocol identity lineage and open items)
   - `Docs/Spec/Tao Studio.md` (especially “Editing, identity, and trust” and “Current boundary”)
   - `Docs/Spec/Tao Testing.md`
   - `Docs/Roadmap/Tao Revolution/Decisions.md`, `Process.md`, and `Coverage.md`
   - the three proposed Studio v2 decision amendments in `Docs/Roadmap/Tao Studio v2/`
2. Inspect current Git status, branch history, open worktrees, and landed Studio tests.
3. Run `./agent verify` before any edit to confirm the green baseline (most recently 19 suites,
   1,591 tests). Do not trust `.artifacts/logs/dev-test/` for suite counts; its stored runs predate
   the current package layout.
4. Use the applicable repository skills, especially:
   - `git-workflow`
   - `runtime-codegen`
   - `dev-automation`
   - `parallel-implementation` if independent workstreams genuinely warrant it
5. Work on a named `feat/<name>` branch.
6. Preserve unrelated and concurrent changes.
7. Never edit `Docs/Roadmap/Archive/`.
8. Do not edit authoritative Tao Revolution decisions without Ro’s approval.
9. Language changes must proceed through the normal vertical slice:
   - decision/specification;
   - grammar;
   - scoping;
   - validator;
   - formatter;
   - compiler;
   - runtime;
   - Tao behavior tests;
   - forcing-app migration.
10. **Tranche mechanics.** WordFlower Current and Next are currently both `absorbed` and
    byte-identical; Next holds no pending Studio work. Cut a new tranche: author the tranche header
    and the decided syntax in `2 - Next` first (after Ro settles it), then absorb into `1 - Current`
    slice by slice per `Apps/WordFlower/README.md`. Current never leads Next. Studio-forced
    capabilities follow ruling 1 above.
11. Run focused tests during every slice and `./agent verify` before commits.
12. Commit completed green slices separately.
13. **Update the ledger as you land, not at the end.** When a slice lands, update its row and
    evidence boundary in `Plan - Tao Studio v2.md` and the affected `Docs/Spec/` sections in the
    same commit. Slice 13 is then only decision adoption and final reconciliation.
14. Do not merge into `main`; leave a clean, merge-ready branch.

---

# Initial reconciliation and the consolidated decision memo

Before editing, produce a compact implementation matrix comparing the live repository against the
remaining gates in:

- this prompt;
- `Plan - Tao Studio v2.md`, especially its “Next integration gates”;
- the “Current boundary” of `Docs/Spec/Tao Studio.md`;
- the current WordFlower Current/Next contract;
- the proposed Decisions amendments.

For every remaining item, classify it as:

- implementation-ready;
- requires a Ro language/product decision;
- validation-only;
- explicitly deferred and out of scope.

Keep the matrix in task context or ignored `.artifacts/` scratch state; do not add a tracked issue
document.

**Deliver every Ro decision request as one consolidated memo in your first working session**, not
trickled per slice. The memo must cover at least: view-instance key derivation and the remaining
Slice 2 semantics; fixture-through-action result/handle semantics; the Scheme scenario-pin versus
`Appearance`-preference precedence and capture/replay questions; and adoption of the proposed
amendment wording. Then run the implementation-ready slices while Ro deliberates.

## Decisions that must not be invented

The following areas require Ro’s decision before implementation (beyond the rulings above):

1. fixture-through-action result and handle semantics;
2. view-instance persisted-state key derivation, schema/versioning, and the remaining Slice 2
   semantics (scope is already ruled device-local);
3. the genuinely open reactive-Scheme questions listed in Slice 10;
4. adoption or amendment of the proposed grouped-scenario, foreign-view, action/transaction,
   containment, capture, and `runs latest` wording;
5. any design-system behavior not already settled in Tao Revolution Decisions.

For each unresolved decision:

- start with concrete Tao code;
- provide one recommended spelling and at most two alternatives;
- explain runtime and migration consequences briefly;
- ask only the minimum question needed;
- continue unrelated implementation slices while waiting.

---

# Slice 1 — Strengthen source-action identity

The compiler already records render owner and node kind per occurrence, but Studio source-action
preconditions do not enforce them. The current envelope identity binds project, app, preview
instance, source path, and source version; the source range travels in the kind-specific action
payload, not the identity. This is the open item already recorded in the v1 plan (“wire emitted
render owner/kind identity through the protocol or remove claims that they participate”).

Extend the versioned source-action identity so applicable visual actions bind:

- project;
- selected app;
- preview instance;
- source path;
- source version;
- source range (staying where it lives today, in the per-action payload — do not refactor it into
  the shared identity unless a real need emerges);
- render owner;
- node kind;
- active scenario/cell identity where relevant.

Requirements:

- Reject owner or node-kind mismatches as explicit conflicts before modifying source.
- Never fall back to range-only mutation after an identity mismatch.
- Preserve compatibility only where a source action genuinely has no render owner or node kind.
- Carry the preconditions through client protocol validation, server validation, source-action
  dispatch, proposal generation, apply, and undo.
- Ensure proposal and final application validate the same identity.
- Use structured conflict details suitable for Studio UI.
- Keep source ranges revision-bound; do not claim they are durable semantic IDs.

Add tests for:

- correct owner/kind;
- stale source version;
- same range but different owner;
- same owner but different node kind;
- stale preview instance;
- proposal succeeds but source changes before apply;
- undo after an intervening incompatible edit;
- malicious or malformed client envelopes.

# Slice 2 — View-instance persisted state

Implement the minimum settled view-instance persistence capability needed for Studio folder
expansion. Scope is ruled device-local (ruling 3). Do not generalize beyond the approved semantics.

The design must define:

- how a view instance obtains a stable key, extending the existing declaration-identity persist
  key scheme;
- how repeated/list instances distinguish themselves;
- how declaration identity and explicit occurrence identity participate;
- behavior when no stable key exists;
- schema/version handling;
- behavior after source rename or structural movement;
- capture/replay participation;
- diagnostics for unstable or missing identity.

Use this capability to persist at least:

- expanded/collapsed folders in the recursive Studio file tree;
- any Disclosure state currently lost across ProductHost remounts.

Requirements:

- Tao source remains authoritative for declarations.
- Persistence must not depend on React hook order or ephemeral DOM identity.
- Repeated rows must not share state accidentally.
- Removed instances must not corrupt surviving instances.
- Invalid or stale stored data must fall back safely.
- Studio’s existing app-level persisted pane and tab state must continue working.

Add:

- parser/validator/compiler/runtime tests for the approved syntax;
- runtime hydration/capture tests;
- recursive file-tree behavior tests;
- a Studio remount test;
- a browser smoke test proving expanded folders survive reload.

# Slice 3 — Complete the Tao inspector migration

Migrate detailed inspector content into Tao views while preserving the TypeScript workbench
controller and server-canonical source-action boundary.

The current typed inspector context is only a strangler foothold. Complete the product-facing
Layout, Style, Data, and Actions sections.

## Layout

Expose parsed current values for the selected render:

- gap;
- padding;
- width mode/value;
- height mode/value;
- alignment;
- claim/fill/hug/compress/rigid terms where supported;
- wrapping/container operations;
- undo checkpoint state.

Requirements:

- Use editable controls rather than fixed preset buttons.
- Do not emit `NaN`, `null`, or malformed numeric source actions.
- Empty or invalid fields must remain local invalid drafts.
- Controls must reflect new source after recompilation.
- Visual changes must pass through typed source actions.
- Preserve checkpoint/gesture grouping and undo semantics.

## Style

Expose:

- inline style landing;
- local style bundle;
- imported/shared bundle provenance;
- element default;
- token;
- provenance chains;
- blast-radius counts;
- edit-versus-fork for shared levels;
- promotion opportunities for raw values.

Requirements:

- Do not let Tao UI write files directly.
- Use server-canonical proposal and apply flows.
- Preserve conflict handling and exact source versions.
- Disable or explain edits that cross unsupported provenance boundaries.
- Keep shared edits explicit; never silently mutate a broad style target.

## Data

Expose selected element/view bindings and active-cell datasource context without duplicating the
Data drawer’s entity tables.

## Actions

Expose invokable or inspectable actions associated with the selected element where supported. Do
not invent arbitrary runtime invocation semantics.

Add ProductHost and live browser tests proving the Tao inspector:

- receives current selection;
- updates when another preview cell becomes active;
- edits source successfully;
- displays conflicts;
- refreshes after recompilation;
- preserves undo.

# Slice 4 — Migrate scenario controls into Tao views

Move detailed scenario and environment controls into Tao views while retaining the existing
TypeScript canvas/iframe ownership and trusted protocol boundary.

Controls should cover the currently implemented contract:

- scenario group and entry identity;
- view arguments;
- viewport preset;
- custom width and height;
- network online/offline;
- captured state layers;
- active-cell selection;
- save current values back to the authored scenario;
- fixture capture;
- failure replay.

Requirements:

- Each scenario group remains independently horizontally scrollable.
- Scrolling one group must not horizontally scroll other groups or the entire canvas.
- Per-cell controls belong in the contextual panel, not duplicated over every cell.
- Invalid arguments remain local and visibly invalid.
- Saving scenario values uses one reviewable source action.
- Active selection must remain tied to the correct group/entry/cell identity.
- Recompilation must preserve independent retained cell state.
- Stale cell revisions must be rejected.

Do not duplicate preview iframe ownership in Tao. The existing matrix controller remains
responsible for iframe lifecycle, offscreen suspension, and manifest reconciliation.

# Slice 5 — Complete the Tao product-panel migration

Convert the remaining expressible panel content to Tao views without prematurely rewriting the
TypeScript shell.

Target panel contents:

- Components;
- Screens;
- Design tokens;
- Data;
- Search results;
- Problems;
- Tests;
- Logs;
- Compile.

The shell may continue to own:

- panel destinations;
- resizing/collapse mechanics;
- keyboard routing;
- browser/native integration;
- trusted controller lifecycle.

Requirements by panel:

## Components

- stdlib components;
- containers;
- manifest-derived project views;
- drag to canvas;
- drag to editor;
- required-parameter placeholders;
- correct insertion source action;
- no regex-derived view inventory.

## Screens

- manifest-derived screens;
- click-to-open or navigate;
- explicit unsupported destinations rather than silent fallback.

## Design tokens

- parser/compiler-owned token inventory;
- provenance;
- current values;
- promotion/edit actions where supported.

## Data

- live entity tables from the trusted active-cell capture;
- retain prior tables during refresh;
- explicit loading and error states;
- link to fixture capture.

## Search

- debounce;
- cache by source version;
- no all-file request storm per keystroke;
- click-to-source;
- invalidate only changed documents.

## Problems

- project-wide diagnostics;
- click-to-source;
- preserve file/range/source-version identity.

## Tests

- run;
- compile-triggered watch;
- bounded output;
- structured pass/fail summary;
- click-to-failure source;
- clear running/loading state.

## Logs

- bounded per-cell console history;
- clear;
- active-cell identity;
- no cross-cell mixing.

## Compile

- current compile revision;
- applied preview revision;
- running/success/failure status;
- actionable diagnostics.

Add tests for ProductHost data flow and live panel interactions.

# Slice 6 — Complete the design-system Studio surface

Implement the remaining settled design-system UI beyond raw color promotion.

Inspect the authoritative decided design system before choosing supported properties.

Where already decided, support:

- tokens;
- style bundles;
- element defaults;
- inline exploration;
- provenance;
- blast radius;
- edit-versus-fork;
- supported typography;
- spacing;
- radii;
- borders;
- backgrounds/foregrounds;
- other decided style terms.

Requirements:

- Development accepts raw inline explorations with warnings.
- Release compilation rejects unpromoted raw values according to the decided policy.
- One-click promotion offers only valid landing targets.
- Promotion emits valid Tao syntax.
- Shared edits display the affected occurrence count before confirmation.
- Imported/shared provenance cannot be overwritten through an invalid local path.
- Forking produces a local bundle and updates the selected use site atomically.
- Source changes remain reviewable and undoable.
- Existing color behavior must remain compatible.

Add behavior tests for each newly supported property family and live Studio tests for:

- inline edit;
- token promotion;
- element-default promotion;
- shared bundle edit;
- shared bundle fork;
- stale conflict;
- release failure before promotion;
- release success after promotion.

# Slice 7 — Fixture-through-action execution

After Ro settles the result/handle semantics, implement fixture setup through actions.

The `through Action(...)` grammar, manifest plan, and validation already exist; the runtime and
fixture generation currently **fail closed** on any `through` clause rather than bypassing the
action. Preserve that fail-closed behavior until real execution lands.

The implementation must answer:

- what value or handle the action returns;
- how later fixture rows reference created values;
- whether an action may create multiple entities;
- how failures are represented;
- transaction and rollback behavior;
- deterministic ordering;
- whether external effects are permitted;
- capture/replay behavior;
- test-harness behavior.

Requirements:

- Do not silently bypass the declared action.
- Execute setup in the ordinary Tao action/runtime architecture.
- Preserve transaction semantics.
- Fail closed on unsupported or ambiguous results.
- Produce actionable source diagnostics.
- Ensure fixture dependency ordering remains deterministic.
- Keep credentials excluded.
- Avoid adding a parallel fixture-only action runtime.

Add:

- grammar and formatter tests if syntax changes;
- validator tests;
- compiler tests;
- runtime transaction tests;
- test-harness execution tests;
- Studio scenario tests;
- action failure and rollback tests.

# Slice 8 — Load captured fixtures through the Tao test harness

Complete the accepted-capture lifecycle:

1. capture active-cell provider state;
2. generate a dependency-ordered fixture proposal;
3. show exact canonical diff;
4. confirm;
5. write through the source-action bus;
6. compile;
7. discover the authored fixture/state;
8. load it through the Tao test harness;
9. render or test against it;
10. preserve exact handles and relations.

Requirements:

- Publish any required named state/fixture manifest metadata.
- Reject missing, cyclic, ambiguous, or non-scalar relationships with located diagnostics.
- Never treat successful source writing as proof the test harness can load the fixture.
- Exercise the final authored Tao source through a real compiled test.
- Keep capture snapshots provider-neutral.

# Slice 9 — Promote failure captures to authored scenarios

Add an explicit Studio workflow that converts a runtime failure capture into durable authored
fixture-plus-scenario source.

Flow:

1. activate the failing cell;
2. display bounded failure and source identity;
3. inspect the captured domains;
4. ask for safe authored names;
5. generate a canonical proposal;
6. show exact source edits and diff;
7. confirm;
8. apply through the source-action bus;
9. compile;
10. load the new scenario;
11. replay at the failing frame.

Requirements:

- Include only registered capturable domains.
- Structurally exclude credentials and unsupported runtime/process state.
- Preserve account identity only where the existing contract allows.
- Fail closed when a domain cannot be represented as authored Tao.
- Do not claim arbitrary React/native state capture.
- Preserve the original capture for retry if source generation fails.
- Make the operation undoable.
- Use deterministic names or explicit conflict resolution.
- Reject stale source/cell/capture identities.

Add end-to-end coverage from runtime failure through authored replay.

# Slice 10 — Reactive Scheme and appearance

Implement actual light/dark scenario appearance only through the real Tao design/runtime system.

`Scheme` is already decided in `Docs/Roadmap/Tao Revolution/Decisions.md`: a read-only reactive
environment value of `Light / Dark`, resolved from the system and the `Appearance` preference
(`preference Appearance is one of System, Light, Dark`), consumed by design conditionals such as
`when Scheme is Dark`, with `appearance dark` as the decided scenario pin. Implement those decided
semantics; do not re-litigate the representation. The genuinely open questions for the decision
memo are only:

- scenario-pin versus `Appearance`-preference precedence inside a preview cell;
- capture/replay semantics of environment values;
- the exact native-parity boundary statement (ruling 4 permits browser-first).

Requirements:

- `appearance light` and `appearance dark` must affect the mounted preview through the ordinary
  runtime.
- Switching one scenario must not recolor another cell.
- Scheme must participate in cell environment identity and replay.
- No browser-only CSS simulation.
- Only `Scheme` is in scope; do not generalize to the other environment values.
- Native parity may lag behind an honest, explicit capability boundary approved by Ro.
- Preserve the existing inert UI until the real runtime path is complete.

Add tests for:

- two simultaneous cells with different schemes;
- runtime changes;
- design token resolution;
- capture and replay;
- recompilation;
- native adapter behavior where available.

# Slice 11 — Complete browser interaction validation

Run and automate the remaining product validation against the actual Studio browser. Validate what
has actually landed at the time this slice runs; items produced by later or decision-blocked slices
join this pass only once they exist.

Cover at minimum:

- wide desktop viewport;
- narrow desktop viewport;
- inspector resizing;
- preview/code resizing;
- horizontally independent scenario groups;
- multi-group startup;
- switching app variants with visible loading state;
- Files recursion and persisted expansion;
- component drag to canvas;
- component drag to editor;
- selection scroll-to-code;
- Layout/Style/Data/Actions controls;
- edit-versus-fork;
- token promotion;
- Problems jump;
- Tests run/watch/jump;
- Data refresh without table wiping;
- Logs clear and cell isolation;
- Compile status;
- Command-K;
- Command-S;
- retained cells across recompilation;
- offscreen suspend/resume;
- failure capture, replay, and authored promotion.

Use deterministic projects and artifact roots. Capture screenshots and console failures.

Do not merely assert that DOM labels exist; exercise the real interaction and resulting Tao source
or runtime state.

# Slice 12 — Native product validation handoff (conditional)

This slice depends on the separate developer-environment/native-canary project; do not duplicate
that project. The known blocker is real: AppKit application registration aborts under the current
agent host coalition, so do not burn time retrying native launches from an agent shell.

If the canary tooling is not available during this project, record the honest three-status boundary
(“implemented,” “contract-tested,” “observed in a native app”) and move on; this slice is excluded
from acceptance.

Once its tooling is available, use it to validate the Studio product behavior:

- Welcome window;
- one project session per window;
- recent projects;
- directory picker;
- project switching/opening;
- native menus;
- Command-W;
- Command-Q/final-window quit behavior;
- local Studio server;
- Metro iframe;
- LSP and event WebSockets;
- multiple project sessions;
- source editing and Command-S;
- scenario rendering;
- clean shutdown.

Keep “implemented,” “contract-tested,” and “observed in a native app” as separate statuses.

Do not claim signing, notarization, DMG, or update validation unless those external gates actually
run.

# Slice 13 — Adopt approved decisions and close documentation

After Ro approves the decision wording:

- update `Docs/Roadmap/Tao Revolution/Decisions.md`, including the Studio-as-forcing-app amendment
  from ruling 1;
- reconcile the proposed amendments;
- reconcile any remaining implemented `Docs/Spec/` contract drift (per-slice updates should have
  kept most of it current);
- close the Studio v2 ledger;
- update WordFlower Next/Current tranche markers per ruling 2;
- update coverage maps;
- remove superseded proposal wording only when authority has moved;
- preserve the historical v1 ledger.

Document exact remaining boundaries honestly.

Do not rewrite historical ledgers to imply validation that did not occur.

---

# Explicitly out of scope

Do not implement these deferred items unless Ro separately expands scope:

- canvas zoom or freeform panning;
- component thumbnails;
- component-variant extraction;
- general Outline/tree stdlib constructs;
- conflict semantics beyond the decided transaction delta model;
- compensation or sagas;
- generic retriable markers;
- structured provider failure fields beyond the settled slice;
- production error upload/reporting/auth/scrubbing;
- centralized `failures {}` configuration;
- localization of generated phrases;
- credential-scope architecture;
- arbitrary React hook/native/process serialization;
- cross-device persistence;
- native-device-as-canvas transport;
- environment values other than `Scheme` (`Contrast`, `Motion`, `TextScale`, and the rest);
- broadly generalized view-instance persistence beyond the approved Studio need.

# Acceptance criteria

Each criterion resolves in exactly one of two ways: **done**, or — for decision-gated items only —
**explicitly blocked**, with the decision request recorded in the memo and an honest ledger entry.
Never simulated, never silently dropped. The remaining Studio implementation is complete only when
every criterion has one of those two resolutions:

- applicable source actions enforce owner and node-kind identity;
- recursive Files expansion persists through real Studio remounts and browser reload;
- detailed inspector controls are Tao views and edit through canonical source actions;
- scenario controls are Tao views and preserve independent group/cell behavior;
- the remaining expressible panels are Tao-owned without duplicating shell/controller authority;
- the decided design-system surface is editable with correct landing/provenance/fork behavior;
- fixture-through-action scenarios execute under settled semantics;
- accepted captured fixtures load through real Tao tests;
- failure captures can become authored, undoable fixture-plus-scenario source;
- appearance is genuinely reactive through Tao runtime/design (browser-first per ruling 4) or
  explicitly blocked — never simulated;
- wide-screen and multi-group browser interactions pass for everything that landed;
- all changed language features have Tao behavior tests;
- every implemented language change is absorbed into WordFlower Current; Next holds only
  honestly-marked decision-blocked content, per ruling 2;
- implemented specifications and approved decisions agree, and the ledger was updated per slice;
- focused tests pass;
- `./agent verify` passes;
- the final worktree is clean;
- all completed slices are committed coherently.

# Suggested commit structure

Use judgment, but prefer commits resembling:

1. `Bind Studio source actions to render identity`
2. `Persist keyed Studio view instances`
3. `Move Studio inspector controls into Tao`
4. `Move Studio scenario controls into Tao`
5. `Move Studio product panels into Tao`
6. `Complete Studio design landing controls`
7. `Execute fixture setup actions`
8. `Load captured fixtures through Tao tests`
9. `Author failure replay scenarios`
10. `Activate scenario appearance through Tao design`
11. `Complete Studio browser interaction coverage`
12. `Adopt Studio language decisions`
13. `Close the Studio v2 implementation ledger`

Do not combine unrelated language semantics and product migrations into one oversized commit.

# Final handoff

Report:

- branch and commits;
- which requirements of this prompt are now complete, blocked, or deferred;
- which decisions Ro approved;
- which items remain externally blocked;
- live browser behavior exercised;
- native behavior actually observed;
- focused and repository-wide validation;
- WordFlower tranche status against ruling 2;
- any intentionally deferred work;
- a `Developer environment` section separating:
  - issues fixed;
  - remaining repository improvements;
  - external/policy limitations;
  - exact user actions still required.
