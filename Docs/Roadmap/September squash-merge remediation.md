# September squash-merge remediation

Two independent audits reviewed every squash merge landed on `main` during September (44 commits,
42 of them squash merges, through `18505faf`). The first audit read each merge in isolation; the
second re-checked every finding against then-current `main` (`23fa3a99`) so nothing already fixed
by a later merge would be re-implemented. That second pass confirmed 188 findings (27 high / 76
medium / 85 low by its own narrative count) and refuted 21 more as already fixed.

`feat/september-verification-foundation` implemented the confirmed findings.

## Status at merge (2026-09-17)

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
  (DEVENV-015, DEVENV-061) are specific to a managed task namespace this machine also runs; they do
  not reproduce from a plain terminal.
- `just full-verify`'s full chain (native canary, every browser gate in sequence) has **not** been
  run to completion this session: the chain aborts at the first failing gate
  (`keyboard-navigation-smoke`, see below) rather than reporting every gate's status, so
  `studio-smoke-native` and `studio-canary` remain unexercised since the last complete `full-verify`
  recorded in the ignored progress ledger.

## Known open items carried into the follow-up branch

1. **Keyboard narrowing survives Enter-engage + Escape-disengage** (blocks
   `keyboard-navigation-smoke`). After an input is engaged with Enter and left with Escape, the
   narrowing text from before engagement is still applied, so typing `f` narrows as `inpf`.
   `Docs/Roadmap/Tao Revolution/Decisions.md`'s Escape ladder puts "clears narrowing" first.
   **Needs a decision:** should engaging an input clear narrowing, or should the fixture journey's
   expectation change? See the merge message and the request that raised this for the concrete
   repro.
2. **Simulated-user journey remains quarantined.** It still fails at the same left-pane-divider
   drag step it fails at on `main`; ten consecutive green runs have not been attempted this
   session.
3. **Not run this session:** `studio-smoke-native`, `studio-canary`, `ship-bundle-proof` (this one
   _did_ pass under `full-verify-sandbox`), and a complete `just full-verify` chain.
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
row and no evident fix**. This list is unverified against live code — each item needs a quick
repro check before being trusted or dismissed — and is recorded here only so it is not lost when
this worktree is removed.

**Shipping**

- `ship-executor.ts` — `usesNonExemptEncryption` is always declared `false`, regardless of
  native/package dependencies.
- `ship-command.ts` — concurrent `tao ship` runs derive repeated writes from a startup snapshot and
  can overwrite each other's lock checkpoints.
- `ship-model.ts` — build numbers are minute-resolution and collide within one minute.
- `ship-fingerprints.ts` — schema-compatibility hashing uses raw CST slices, so formatting-only
  entity edits appear incompatible.
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
- `commands-validator.ts` — shortcut validation accepts reducer-owned or malformed keys.
- `ActionsCompiler.ts` — debugger step identities collide across declarations and branches.
- `data-stores.ts` — datasource store-name composition collides on underscores.

**CloudKit** (beyond the six findings already fixed for this area)

- `TaoCloudKitModule.swift` — inbox persistence failures are swallowed with `try?` before a durable
  batch is reported.
- `cloudkit-native.ts` — state filenames join container/zone identifiers with `.`, which can
  collide.
- `CloudKit.ts` — a malformed conflict response is treated as accepted, silently dropping a
  rejected local change.

**Editor, tooling, and packaging**

- `CodeEditorLens.ts` — fold-peek controls are mouse-only (no keyboard/button semantics).
- `StudioCanvasViewport.ts` — canvas listeners installed on the host/document are never disposed.
- `test-run-root.ts` — recursive run-root cleanup matches names by a non-anchored, one-character
  suffix regex before deleting.
- `DeadExports.ts` — dead-export analysis treats block comments and strings as live bindings.
- `Packages.ts` — external/multi-root documents inherit the first workspace's package namespace,
  and symlinks can bypass package/project boundaries.
- `StudioSketchCatalog.ts` — catalog revision read/check/rename races across processes (a
  different bug than the tracked ViewN-counter collision in the same file).
- `TestSelection.ts` — a root `package.json`/`bun.lock`/`devenv.*` change is not treated as
  repository-wide.
- `repo-lint.ts` — the raw-Error rule's `packages/runtime` gap is tracked and fixed, but the
  broader claim (Apps, CJS/JS, whole-file allowlist leakage) may still apply.
- `tao-references.ts` — design-color resolution can select a file-private sibling declaration,
  ignoring visibility (a different bug than the tracked dotted-path/design-block miss in the same
  file).
- `android.ts` / `IosSimulatorPresentation.ts` — stale-Expo-Go detection and the Device Hub GUI
  fallback are both incomplete.

**Docs and fixtures**

- `StudioProtocol.ts` — parameterized Studio routes can cross segment boundaries.
- `Docs/Spec/Tao Studio.md` — still contradicts the implemented binding/wrap actions.
- `StudioPreviewBridge.ts` — preview-capture errors lose their taxonomy category across the
  protocol.
- `StudioEditorSurface.tsx` — a rejected syntax-analysis promise is cached permanently until the
  text changes.
- `packages/shared/shared-src/core/Text.ts` — JSONC stripping can turn malformed input into valid
  JSON.
- `Docs/Roadmap/Freehand UI sketching/Plan - Canvas-first design mode.md` — still labels landed
  work "proposal / no code changed" in places.
- `Apps/HNReader/.tao-project/studio/sketches.jsonc` — commits checkout-specific absolute render
  identities.
- `Apps/HNReader/HNReader.tao` — reopening a story from the Reading feed does not update its
  "most recent" timestamp (plausibly fixed incidentally by the tracked recency-persistence commit
  for the same file; not confirmed).

## Handoff

The follow-up branch continues from post-merge `main` and should:

1. Settle the keyboard-narrowing decision above, then land the fix and lift the
   `keyboard-navigation-smoke` failure.
2. Chase the simulated-user quarantine to ten consecutive green runs, or replace the failing step.
3. Run `studio-smoke-native`, `studio-canary`, and a complete `just full-verify` chain to
   completion.
4. Triage the "cross-checked, partly unaddressed" list above: confirm each against current code,
   drop what is already fixed or was legitimately refuted, and carry the rest as new findings
   through the same implement-with-tests process this branch used.
