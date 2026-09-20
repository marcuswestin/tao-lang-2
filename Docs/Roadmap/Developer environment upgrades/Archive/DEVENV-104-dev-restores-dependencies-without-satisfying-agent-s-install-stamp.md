# DEVENV-104 — `./dev` restores dependencies without satisfying `./agent`'s install stamp

- **Status:** Resolved
- **Area:** Dependency installation
- **Impact:** In a fresh worktree, running `./dev` before `./agent` installs a healthy dependency tree
  but leaves `./agent` believing no install occurred. The next `./agent` invocation immediately runs a
  second install; inside the sandbox, Bun then tries to replace packages such as `keytar` that ship
  protected paths and fails before the requested command starts.
- **Evidence:** `./dev merge-with-main --dry-run` installed 2,522 packages successfully. The following
  `./agent test-file packages/dev/dev-tests/merge-with-main.test.ts` failed in bootstrap with
  `EEXIST: File or folder exists: failed to link package: keytar@7.9.0 (clonefileat)`. Running
  `bun run packages/dev/dev-src/doctor/DependencyHealth.ts` against that tree exited zero, and the
  same focused test passed through `./dev test-file`. The same `./agent help` bootstrap failure was
  reproduced after merging `main` on 2026-09-20. From a fresh post-fix worktree, `./dev --help`
  installed 2,524 packages and published `.artifacts/build/agent-dev/dev-deps.stamp`; the immediately
  following sandboxed `./agent help` started in 0.5 seconds without another Bun install.
- **Resolution:** `./agent`, `./dev`, and verification now route through one private installer with
  one lock, completion stamp, health proof, and recovery path. It adopts a healthy unstamped tree
  without reinstalling, and publishes the stamp only after Bun succeeds. Focused tests prove one
  install across the two entrypoints and prove a failed install leaves no stamp.
- **Workaround:** None needed.
- **Proposed change:** Done as proposed with one shared dependency installer and completion stamp.
- **Dependencies:** DEVENV-084 owns sandbox-safe repair of an unhealthy dependency tree. This entry
  covers a healthy tree restored by the other repository wrapper.
- **Acceptance:** Met on 2026-09-20 in a fresh worktree: `./dev` installed dependencies and the
  immediately following sandboxed `./agent` command started without a second install.
- **Source:** 2026-09-19 merge-preflight and concurrent-dev-test remediation.
- **Archived:** 2026-09-20
