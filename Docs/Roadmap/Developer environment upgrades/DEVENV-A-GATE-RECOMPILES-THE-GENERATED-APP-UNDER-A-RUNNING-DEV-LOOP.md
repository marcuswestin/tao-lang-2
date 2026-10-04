# DEVENV-A-GATE-RECOMPILES-THE-GENERATED-APP-UNDER-A-RUNNING-DEV-LOOP — A check or test lane replaces the app a running `tao run` is serving

- **Status:** Candidate
- **Section:** External
- **Area:** Verification lanes, dev loop, simulator checks
- **Impact:** A live check on the simulator or in the browser goes blank the moment any gate runs in
  the same worktree: `./agent check` or a test lane recompiles its own fixture app into
  `packages/apps/expo-host/_gen_tao-app/`, the tree Metro is serving for the developer's `./tao run
  <app>`, and the running app renders nothing while Metro logs a module it can no longer resolve. An
  agent that iterates with `check` between edits cannot keep a simulator check alive, and the blank
  screen reads as a runtime regression in whatever was just changed.
- **Evidence:** `packages/testing/verification/verification-src/CompileApp.ts:150-166`: the
  compile-app prepare node trusts its stamp only when both the inputs and the outputs' hash match,
  so a generated tree `tao run` rewrote for another app never reads as up to date and is recompiled.
  On 2026-09-22 at 23:16, `./agent check` rewrote `_gen_tao-app/App.tsx` (mtime) under a `./tao dev
  .artifacts/tmp/inset-probe/InsetProbe.tao` started at 23:12; the dev client on the iPhone 17
  simulator showed a blank screen and `.artifacts/dev/expo.log` logged
  `Unable to resolve module ./modules/Design.tao from …/_gen_tao-app/App.tsx`. Measured: the mtime,
  the log, the screenshot. Inferred: that `check` reaches the node through typecheck's dependency
  on the generated tree.
- **Workaround:** Touch the app source (`touch <app>.tao`) so the dev loop recompiles it, relaunch the
  dev client, and run no gate until the live check is done.
- **Proposed change:** Give the gates an output root of their own — `CompileAppOptions.outputRoot`
  already exists — such as `.artifacts/verify/_gen_tao-app`, with the runtime Jest suites reading
  that root, so `packages/apps/expo-host/_gen_tao-app/` belongs to the developer's own `tao run` and
  Studio alone. Failing that, have the node refuse, with a one-line reason, while a dev loop's
  registration shows it owns the tree.
- **Dependencies:** `Docs/Roadmap/Tao tooling performance.md` owns the compile cache the stamp is
  part of.
- **Acceptance:** `./agent check` run while `./agent unsandboxed app-dev <app>` serves a different app leaves the served
  app untouched, and a test in `verification-tests` pins that the gate's output root is not the dev
  loop's.
- **Source:** 2026-09-22 simulator check of the ask window layer on `feat/inset-defects`.
