# September squash-merge remediation

Two independent audits reviewed every squash merge landed on `main` during September (44 commits,
42 of them squash merges, through `18505faf`). The first audit read each merge in isolation; the
second re-checked every finding against then-current `main` (`23fa3a99`) so nothing already fixed
by a later merge would be re-implemented. That second pass confirmed 188 findings (27 high / 76
medium / 85 low by its own narrative count) and refuted 21 more as already fixed.

`feat/september-verification-foundation` implemented the confirmed findings.

## Status after the follow-up branch's first landing (2026-09-17)

`feat/september-remediation-followup` landed the first two items of the handoff below. What that
branch proved, and what it left open, is recorded under **Follow-up branch** further down. Work
continues on `feat/september-remediation-continued`.

## Status at the first merge (2026-09-17)

- All 188 confirmed findings, deduplicated to 183 checklist rows, are implemented across packets
  1–23. Each row's implementation commit and covering tests are traced in this branch's own
  (untracked, `.gitignore`d) `.artifacts/september-finding-checklist.md`; that trace does not
  survive the worktree, so treat this document as the durable summary once it is gone.
- `./agent verify --complete` (10/10) and `./agent full-verify-sandbox` (13/13 sandbox-compatible
  gates) are green, plus the intentional `studio-smoke-simulated-user` quarantine skip.
- Independent review of the remediation's own uncommitted diff (host-temp scratch roots,
  transactional generated-file publication, a file-based Studio device-trust lock, per-invocation
  native-canary reports) found five medium issues; all five are fixed and covered by new tests.
- Browser acceptance: studio-launch, studio-real-app (real HNReader app), studio-dialog-browser,
  and studio-agent-browser all pass headless from an ordinary unsandboxed shell. The
  once-documented Chrome `SIGABRT`-before-DevTools abort and the generated-directory cleanup denial
  (DEVENV-015, DEVENV-064) are specific to a managed task namespace this machine also runs; they do
  not reproduce from a plain terminal.
- `just full-verify`'s full chain (native canary, every browser gate in sequence) has **not** been
  run to completion this session: the chain aborts at the first failing gate
  (`keyboard-navigation-smoke`, see below) rather than reporting every gate's status, so
  `studio-smoke-native` and `studio-canary` remain unexercised since the last complete `full-verify`
  recorded in the ignored progress ledger.

## Follow-up branch: what landed, and what is still open

### Landed

1. **Keyboard narrowing is settled and its gate is green.** Engaging a target clears the narrowing
   that selected it, so narrowing never outlives its engagement; `Decisions.md`'s Escape ladder was
   reworded to match the decided behaviour. `just keyboard-navigation-smoke` passes end to end.
2. **Three defects the keyboard gate was hiding**, each found only because that gate got further
   than it ever had, each fixed with covering tests:
   - The interaction overlay sets `pointerEvents: 'box-none'` on its host, which the web runtime
     renders as a plain `pointer-events: none` that descendants inherit. The pending-slot surface —
     its store-search control and every chooser row — could not be clicked at all. The surface now
     re-enables pointer input on itself.
   - Interaction-supplied command fills evaluated to a bare `{ jsValue }`. Generated code evaluates
     a fill where it reads it and hands the result to a runtime call that evaluates it again, so
     every store-picked entity and every scalar slot failed inside the action with a contained
     `TaoActionFailure`. `Evaluable` now states that evaluation is idempotent, which makes that
     class of bug a type error, and the fabricated values that were not idempotent are fixed.
   - `accessibilityState` is not read by the web runtime, which takes the matching `aria-*` props
     instead, so selected, disabled, checked, busy and expanded state was dropped on every Tao
     surface on web. One helper now spells both.
3. **Two Studio defects found while chasing the simulated-user quarantine:**
   - In Design mode the canvas width was re-derived on every measurement, including the one the
     divider's own drag triggered, so the divider the layout comment calls "still free to change
     that" could not be moved at all. A width the person sets now stands until Design mode is left.
   - `mkTestDir` returned the uncanonical temp path. On macOS that is a symlink, so any test that
     built a path from it and compared it with one the code under test had resolved could never
     match. That is what broke the journey's render-inspection step.
4. **Browser-harness guards**, which is how most of the above were found rather than as unrelated
   timeouts much later: offset clicks and drags scroll `nearest` so a wide target keeps its leading
   edge in view, and refuse a point that lands on something else, naming what covers it.
   `StudioCdp` also gained `End`, `Home` and `Delete`, an offset for drags, and `world: 'page'` for
   the few frame probes that must read or write a global the page itself defines — an isolated
   world has its own `window`, so the page never saw what the harness wrote there.

### Landed since (second branch, `feat/september-remediation-continued`)

1. **The simulated-user journey is a gate again.** Ten consecutive runs are green,
   `FULL_VERIFY_SKIPPED` is empty, and an empty skip list is now spelled by omission rather than by
   passing `--skipped ""`. Four more journey defects and one product defect were fixed to get there:
   a drag aimed at an element's own centre when that centre is off-screen; the floating agent panel
   covering the inspector and half of every divider; a free sketch rectangle drawn in the middle of
   the flow it was later asked to join, which Studio Snap rightly refuses; a sketch control pressed
   while a compile replaces the board, where pressing again is not the remedy because each press
   consumes one unit of work; and canvas focus entered before the owning cell reported its
   rectangle, which left the cells at device size for good because nothing retried the reframe.
2. **`just full-verify` is green end to end: 21 gates passed, 0 failed, 0 skipped.** That is the
   first complete chain in this remediation. `studio-dialog-browser`, `studio-agent-browser`,
   `studio-smoke-native` and `studio-canary` had never run on this work and all pass.

### Second-audit backlog: what was checked and closed

The list below was written against an older `main`. Fourteen of its findings have been checked
against current code and are closed; they have been removed from the list itself so what remains is
live work only. Closed, with what was checked:

- `ship-model.ts` build numbers, `ship-fingerprints.ts` schema hashing, `data-stores.ts` store
  names, `commands-validator.ts` shortcut validation, `Text.ts` JSONC stripping,
  `StudioCanvasViewport.ts` listener disposal, `TestSelection.ts` root dependencies,
  `StudioProtocol.ts` route parameters, and `test-run-root.ts` cleanup all describe code that does
  not exist: each is already correct, most of them explicitly so with a comment saying why.
- `StudioSketchCatalog.ts` revision: the rewind on rollback is deliberate and tested. A transaction
  that did nothing must not conflict every client holding the revision it started from, so the
  revision is an optimistic-concurrency token rather than a monotonic version. `restore` says so,
  and the reader that misused it was fixed.
- `ship-executor.ts` export compliance: **decided, no change.** Tao emits `ios: {}` and declares no
  answer, so App Store Connect asks the author at submission. That is right: an export-compliance
  declaration is a legal statement about someone else's app, and Tao must not make it on their
  behalf. The type admitting only `false` is a latent limitation, not a defect; widen it when an
  authoring surface exists to set it, not before. The finding's claim that `false` is always
  declared does not match the code.
- `DeadExports.ts` comments and strings: **fixed, in the stricter direction.** Comment bodies and
  single- and double-quoted string bodies are masked before the reference scan, so a member named
  only in prose no longer keeps itself out of the report. Template literals are left intact because
  `${Alias.member}` is a real reference. The scan now reports 35 unused exports; removing any of
  them stays a reviewed change, as the gate says.

### Second-audit backlog: earlier triage detail

- **`StudioSketchCatalog.ts` catalog revision — refuted, and documented.** A rollback restores the
  snapshot's own revision, so the number can go backwards and later describe different contents.
  That is deliberate and tested: a transaction that ultimately did nothing must not conflict every
  client holding the revision it started from. The defect is on the reading side, and the journey
  step that compared revisions now compares the state it actually asserts. `restore`'s docstring
  says plainly that the revision is an optimistic-concurrency token, not a monotonic version.
- **`test-run-root.ts` recursive cleanup regex — already fixed.** Both names are anchored
  (`/^run-(\d+)-[0-9a-z]+$/`, `/^[a-z][a-z0-9-]*$/`), and `isRunRoot` compares the parent against
  the resolved generated root rather than matching directory names, which its comment explains.
- **`DeadExports.ts` comments and strings — acknowledged, deliberately not changed.** A reference
  inside a comment or string does keep an export looking alive, but that is the safe direction: it
  hides dead code rather than proposing the removal of live code. Stripping comments and strings
  before the scan would trade a false negative for a false positive in a tool whose output is a
  deletion. Revisit only with evidence of a specific export it is actually hiding.

### Still open

1. ~~**The simulated-user journey is still quarantined**~~, resolved above. It previously failed much later. Every step up to
   the component drag passes. `just studio-smoke packages/dev/studio-smoke/studio-simulated-user.test.ts`
   fails waiting for `New text` after
   `browser.drag('[data-tao-studio-component="Text"]', '.cm-content', { steps: 12 })`. Not yet
   diagnosed; `drag` uses the HTML5 drag-interception path, which is a different mechanism from the
   pointer drags repaired above. Ten consecutive green runs have not been attempted.
2. **A lens behaviour worth confirming as intended.** With the outline lens on, `End` then
   `ArrowLeft` on a folded declaration moves the caret to the region's start, which peeks it open by
   design — so a following `Delete` edits source that was hidden a keystroke earlier. The
   protection filter itself is correct (a deletion overlapping a folded span is cancelled); the
   question is whether a navigation-driven peek should leave the very next forward delete armed.
   The journey no longer asserts the old behaviour either way.
3. Everything below under **Known open items**, items 3 onward, is unchanged.

## Known open items

Items 1 to 3 are closed; they are kept so a reader of this document's history can see what the two
follow-up branches were for.

1. ~~**Keyboard narrowing survives Enter-engage + Escape-disengage.**~~ Fixed on
   `merged/september-remediation-followup`.
2. ~~**Simulated-user journey remains quarantined.**~~ Lifted on
   `merged/september-remediation-continued` after ten consecutive green runs; it is a member of
   `FULL_VERIFY_GATES` again and `FULL_VERIFY_SKIPPED` is empty.
3. ~~**Not run: `studio-smoke-native`, `studio-canary`, `ship-bundle-proof`, and a complete
   `just full-verify` chain.**~~ All four have run and passed. `just full-verify` is green end to
   end: 21 gates passed, 0 failed, 0 skipped.
4. **External/host-only acceptance remains separate and unproved,** as it has since Wave 1:
   physical device, Apple Device Hub GUI, real CloudKit, installed-binary OTA, signed/notarized
   Studio, and App Store Connect/TestFlight.
5. **Low-priority cleanup an independent review flagged but did not require before merge:**
   duplicated cleanup-aggregation helpers across four test files; `ParserGenerate.ts`
   re-implementing file-transaction helpers that now live in `packages/shared/shared-src/FS.ts`;
   crash-orphaned `.tmp`/`.restore` files landing inside the packaged IDE-extension VSIX tree; the
   native-canary orphan sweep not reaching an earlier invocation's build.

## A second, independent findings list — cross-checked, partly unaddressed

A separate, earlier P0–P3 audit of the same 44 merges (different reporter, same commit hashes)
overlaps heavily with the 188-finding list above, but is not identical to it. Cross-checking its
items against the 183-row checklist and current `main` found a subset with **no matching tracked
row and no evident fix**. Fourteen of those have since been checked and closed, and are recorded
under **what was checked and closed** above rather than here; twelve of the fourteen turned out to
describe code that does not exist, so read what remains as unverified rather than as known bugs.
Check each one against live code before implementing anything.

**Shipping**

- `ship-command.ts` — concurrent `tao ship` runs derive repeated writes from a startup snapshot and
  can overwrite each other's lock checkpoints.
- `app-store-connect-client.ts` — App Store review submission always creates a new submission
  rather than discovering and resuming a draft.

**Studio agent and controls**

- `AgentChatServer.ts` — test baselines are not bound to the change they judge; they can go stale
  across mutation/reset/undo.
- `AgentChatSession.ts` — no per-turn token/cost ceiling exists despite the promised one.
- `StudioAgentChatPanel.ts` — changing agent mode mid-turn corrupts conversation ownership.
- `StudioApiClient.ts` — Studio cannot select the LAN/cable route the server already supports.
- `StudioControlViews.tsx` — segmented environment controls lack roving-focus/ARIA-radio keyboard
  behavior.
- `SecretsCommand.ts` — worth re-checking: a nearby line's whitespace handling is tracked as fixed,
  but the broader claim (multiline secrets need reversible exact-byte encoding) may not be.

**Runtime, companion, and validators**

- `TR-studio-device-host.tsx` — a device effect failure can still produce a green "applied"
  acknowledgment, and a trusted companion cannot rediscover Studio after it restarts on new ports.
- `TR-studio-subject.tsx` — a failed focused-view render can leak a synthetic app into a global
  registry.
- `TR-interaction-attention.ts` — palette Arrow/Enter navigation goes through outline navigation
  instead of palette selection.
- `ActionsCompiler.ts` — debugger step identities collide across declarations and branches.

**CloudKit** (beyond the six findings already fixed for this area)

- `TaoCloudKitModule.swift` — inbox persistence failures are swallowed with `try?` before a durable
  batch is reported.
- `cloudkit-native.ts` — state filenames join container/zone identifiers with `.`, which can
  collide.
- `CloudKit.ts` — a malformed conflict response is treated as accepted, silently dropping a
  rejected local change.

**Editor, tooling, and packaging**

- `CodeEditorLens.ts` — fold-peek controls are mouse-only (no keyboard/button semantics).
- `Packages.ts` — external/multi-root documents inherit the first workspace's package namespace,
  and symlinks can bypass package/project boundaries.
- `repo-lint.ts` — the raw-Error rule's `packages/runtime` gap is tracked and fixed, but the
  broader claim (Apps, CJS/JS, whole-file allowlist leakage) may still apply.
- `tao-references.ts` — design-color resolution can select a file-private sibling declaration,
  ignoring visibility (a different bug than the tracked dotted-path/design-block miss in the same
  file).
- `android.ts` / `IosSimulatorPresentation.ts` — stale-Expo-Go detection and the Device Hub GUI
  fallback are both incomplete.

**Docs and fixtures**

- `Docs/Spec/Tao Studio.md` — still contradicts the implemented binding/wrap actions.
- `StudioPreviewBridge.ts` — preview-capture errors lose their taxonomy category across the
  protocol.
- `StudioEditorSurface.tsx` — a rejected syntax-analysis promise is cached permanently until the
  text changes.
- `Docs/Roadmap/Freehand UI sketching/Plan - Canvas-first design mode.md` — still labels landed
  work "proposal / no code changed" in places.
- `Apps/HNReader/.tao-project/studio/sketches.jsonc` — commits checkout-specific absolute render
  identities.
- `Apps/HNReader/HNReader.tao` — reopening a story from the Reading feed does not update its
  "most recent" timestamp (plausibly fixed incidentally by the tracked recency-persistence commit
  for the same file; not confirmed).

## Handoff

`feat/september-remediation-continued` carries the rest from the `main` that holds the follow-up
branch's landing, and should:

1. Chase the simulated-user quarantine to ten consecutive green runs, starting from the component
   drag described above, then remove its `FULL_VERIFY_SKIPPED` entry.
2. Run `studio-smoke-native`, `studio-canary`, and a complete `just full-verify` chain to
   completion. The first two do not depend on item 1 and can run now.
3. Triage the "cross-checked, partly unaddressed" list above: confirm each against current code,
   drop what is already fixed or was legitimately refuted, and carry the rest as new findings
   through the same implement-with-tests process the first branch used.
4. Take the low-priority cleanups in item 5 of **Known open items**.
5. Settle the lens question in **Still open** item 2 with Ro if it is a decision rather than a bug.
