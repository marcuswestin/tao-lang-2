# DEVENV-037 — Native Studio host coordination and bounded Hutch phases

- **Status:** Resolved
- **Area:** Native Studio verification
- **Impact:** Native smoke and canary runs could overlap Hutch work in another worktree, hang inside
  preparation until the outer test timeout, and leave the next run with weak phase or ownership
  evidence after interruption.
- **Evidence:** A normal-terminal full verification spent 120 seconds in the native gate after
  printing `hutch install` but before `electrobun prepare complete`; a preceding run was interrupted,
  and graph-local `gui` ownership did not coordinate other worktrees. A cold acceptance worktree
  additionally proved Hutch 0.24.3's resolver could reject the two exact direct package versions
  while npm served both; the same install succeeded from a generated integrity-checked Hutch lock.
  Both Hutch 0.24.3 and 0.25.0 then blocked in `electrobun sync` while the shared home registered
  stopped projects with unheld reader markers. Hutch 0.24.3 completed sync in under two seconds
  against the same immutable store with an empty isolated project registry.
- **Workaround:** None required after the repository containment; inspect the exact timed phase in
  the gate log when a native host cannot proceed.
- **Proposed change:** Bound and instrument each Hutch phase, stop complete owned process groups on
  every exit path, and hold an identity-checked machine-wide `studio-native-host` lease through
  preparation, probe, and shutdown. Materialize the pinned native dependency lock so cold worktrees
  do not depend on Hutch re-resolving already-selected versions. Give every worktree an isolated
  mutable Hutch project registry backed by copy-on-write clones of the installed immutable store,
  and clear only the current generated project's transient locks after proving its process tree
  stopped.
- **Also observed:** from a managed shell the canary wrote an invocation-scoped
  `.artifacts/tests/studio-canary/invocations/<id>/canary.json`
  with `"status": "blocked"` within seconds, recorded its own pid in `survivingPids`, and was still
  alive 40 minutes later on a surviving `hutch-engine electrobun prepare` child, holding the whole
  `just verify-full` run open. The owned-process-group stop above should close this; re-verify it when
  the acceptance run happens.
- **Dependencies:** Implemented on `feat/native-studio-verification-reliability`; with the Expo
  preview available, command-host smoke now passes preparation and reaches the native launcher.
  Final AppKit acceptance still requires an ordinary Terminal because the Codex command host can
  deny its Watchman socket or abort the embedded Bun runtime at AppKit registration.
- **Acceptance:** Focused tests prove phase reporting, subprocess bounds and cleanup, interrupted
  reruns, two-process lease races, stale identity recovery, and protection of live old owners; final
  host lanes pass without manual state deletion or unrelated-process termination.
- **Source:** 2026-09-04 native full-verification failure and reliability handoff.
- **Archived:** 2026-09-19
