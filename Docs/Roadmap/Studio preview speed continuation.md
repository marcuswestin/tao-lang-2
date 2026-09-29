# Studio preview speed continuation

Handoff written 2026-09-29 for the next implementation branch. Start from the committed tip of
`feat/studio-preview-workspace-reuse`, not from `main`. This document is the handoff for the Studio
preview latency work; [Tao tooling performance](<Tao tooling performance.md>) contains broader
language and tooling measurements. Do not treat older CLI benchmarks as edit-to-paint timings.

## Current state

1. `4eb41b8a` reuses a Studio preview `Workspace` across ordinary revisions and uses a syntax-only
   check for drafts. Its roadmap changes describe remaining incremental compilation work.
2. `9c86b215` adds browser Studio `--preview-publication on|off`, default `on`. In `off`, the first
   compile still creates `TaoStudioPublication.ts`; later compiles keep that file byte-identical.
   Studio sends current cell identities and source versions over the runtime bridge, skips exact
   publication acknowledgments and their iframe reload retry, and keeps Draw/Edit interaction mode
   after a Fast Refresh bridge remount. Native/device launches reject `off`. This is an experiment:
   `off` cannot prove that an iframe applied the exact latest revision and may leave an unnoticed
   stale preview. Source-action version and occurrence checks remain in place.
3. The branch includes `main` through `94ec269f`; the integration commit was `65efbbd1`. Before
   this handoff document, the tree was clean. `./agent check`, `./agent verify-changed`, `./agent
   verify`, and `./agent unsandboxed finalize` passed. The final `finalize` integrated `main` and
   verified that exact tree. A real Metro smoke run passed four cases, including publication-off
   Draw then Code edits without an iframe `load`. An earlier HNReader Feed smoke timeout passed on
   a complete isolated rerun. None of these runs measured the speed gain. This handoff document
   has not been verified; the Developer requested a commit and prompt before any further gate.
4. The branch is deliberately unlanded. Its reviewed merge message is
   `.artifacts/merge/feat/studio-preview-workspace-reuse.msg`; that ignored artifact does not travel
   to a fresh worktree, so the successor branch needs its own message and `finalize` result.

## Where to look

- `packages/ides/studio/studio-src/StudioPreviewSession.ts`: reused workspace and preview compile.
- `packages/apps/expo-host/expo-host-src/runtime.ts`: generated file publication, stable marker,
  browser bootstrap, runtime updates, whole-app updates, and generated preview root.
- `packages/ides/studio/studio-src/client/matrix/StudioPreviewMatrix.ts` and
  `StudioPreviewBridge.ts`: retained iframes, runtime messages, acknowledgement behavior.
- `packages/apps/runtime/TaoRuntime-src/TR-studio-preview.tsx`: preview mount and applied messages.
- `packages/ides/studio-tooling/studio-tooling-src/StudioDev.ts` and
  `packages/cli/dev-cli/dev-cli-src/dev.ts`: launch flag and Metro/Watchman setup.
- `packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts`: real Metro continuity tests.
- `packages/compiler/compiler-src/workspace/` and `packages/language/parser/`: parse, link,
  validation, and compile graph work to inspect before designing partial compilation.

## First actions in the successor branch

1. Create a **new named `feat/` branch and its own worktree from the committed handoff tip**, using
   the repository's supported worktree/branch workflow. Do not edit this branch or assume its
   ignored `.artifacts/` files follow you. Run `./agent help` first and inspect the new worktree's
   `git status --short --branch` and `./agent board` before a machine-wide lane.
2. Verify the inherited tree before changing code. Run these from the new worktree root, in order:

   ```sh
   ./agent verify-changed
   ./agent verify
   ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts studio-publication-handoff
   ```

   `verify` may reuse an exact-tree green record; report that as reuse, not a fresh run. The browser
   smoke owns its temporary project and Chrome instance. If the new worktree lacks generated parser
   output and a command says it cannot find `_gen_tao-parser/module`, run `./agent parser-gen`, then
   retry the original command. On any failure, read the `./agent` report and named log; distinguish
   a deterministic product failure from host contention. Do not increase a timeout as a diagnosis.
3. For a human feel test, run one mode at a time and stop Studio with Ctrl+C between trials:

   ```sh
   ./agent unsandboxed studio Apps/HNReader --preview-publication on
   ./agent unsandboxed studio Apps/HNReader --preview-publication off
   ```

   Compare repeated Tao code saves, Draw moves, Code-then-Draw transitions, iframe reload count,
   interaction state, errors, and whether the preview actually shows each final edit. The first
   compile always writes the marker in both modes; compare subsequent edits. This flag changes the
   `./agent unsandboxed studio` launch behavior only for browser Studio, as authorized by the
   feature request.

## Work to resume after baseline verification

1. **Measure the real edit-to-paint critical path in both modes.** Timestamp editor save,
   `StudioCompileCoordinator` queue/start/end, workspace parse/link/validate/codegen, generated
   file publication, Watchman notification, Metro transform/HMR send, iframe module application,
   React render, and paint. Record warm/cold runs, which `.tao` file changed, on/off flag, machine
   load, p50/p95, and exact iframe reload count. The older tooling report measured Langium parsing
   at roughly 14ms for a 37-file graph; it does **not** prove compilation or parsing dominates this
   loop. Do not pursue a new compiler language without a measured dominant CPU slice.
2. **Resolve the Code-to-Draw source-version mismatch.** During a preliminary publication-off smoke
   that performed a Code edit before a Draw move, the frame reported a 463-character source version
   while the active editor reported 485 characters, and Studio correctly rejected the Draw action
   as stale. The temporary tab-refresh workaround was removed. The committed smoke performs Draw
   before Code, so it proves both paths work but not that Code-then-Draw works. Reproduce with
   exact editor text, disk text, draft/save events, manifest source versions, and frame identity;
   compare default `on` with `off` before attributing this to the flag. Preserve stale-source and
   occurrence guards. Add a focused regression only after identifying the real cause.
3. **Implement the next measured, independently evaluable speed step.** Favor changed-file
   parse/compile and writing only genuinely changed generated modules when dependency and manifest
   semantics allow it. A changed `.tao` file can affect imported views, app roots, scenario/fixture
   manifests, and removed outputs; a naive timestamp skip can silently publish stale code. Explore
   Langium's in-memory incremental document updates and a dependency-aware invalidation graph in
   the existing `Workspace` before replacing the parser or compiler language. Consider a fast
   compile lane with deferred full validation only if diagnostics, rollback, and Draw source safety
   remain clear. Keep each step separately runnable for a feel test.
4. After new code, commit only reviewed task paths; run the focused test, `./agent
   verify-changed`, `./agent verify`, the real Metro smoke, and `./agent unsandboxed finalize`.
   Read and edit the successor branch's merge message when `finalize` asks. Review the full diff.
   The successor may propose landing only after the Developer has tried the visible behavior and
   explicitly authorizes landing. `./agent unsandboxed land` is the landing command.

## Completion bar

The successor can report completion when it has a committed, clean, independently runnable branch;
repeatable edit-to-paint numbers for both flag modes; a proven explanation and fix (or explicit
baseline classification) for Code-then-Draw; no accidental iframe reload on compatible edits;
source-action safety retained; focused, repository, and real Metro evidence for the exact tip; a
reviewed merge message and successful `finalize`; and a concise statement of the measured speed
gain and remaining dominant slice. Do not report test success or a stable marker as a measured
latency improvement. Landing remains a separate Developer decision.
