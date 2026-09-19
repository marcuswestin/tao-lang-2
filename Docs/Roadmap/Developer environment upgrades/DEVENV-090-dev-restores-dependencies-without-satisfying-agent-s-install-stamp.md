# DEVENV-090 — `./dev` restores dependencies without satisfying `./agent`'s install stamp

- **Status:** Candidate
- **Area:** Dependency installation
- **Impact:** In a fresh worktree, running `./dev` before `./agent` installs a healthy dependency tree
  but leaves `./agent` believing no install occurred. The next `./agent` invocation immediately runs a
  second install; inside the sandbox, Bun then tries to replace packages such as `keytar` that ship
  protected paths and fails before the requested command starts.
- **Evidence:** `./dev merge-with-main --dry-run` installed 2,522 packages successfully. The following
  `./agent test-file packages/dev/dev-tests/merge-with-main.test.ts` failed in bootstrap with
  `EEXIST: File or folder exists: failed to link package: keytar@7.9.0 (clonefileat)`. Running
  `bun run packages/dev/dev-src/doctor/DependencyHealth.ts` against that tree exited zero, and the
  same focused test passed through `./dev test-file`.
- **Workaround:** After `./dev` restores a healthy tree, use `./dev <command>` until an unsandboxed
  shell can run `./agent setup` or recreate the install stamp.
- **Proposed change:** Give `./dev` and `./agent` one dependency-install completion stamp, or have
  `./agent` accept the dependency-health probe as proof before reinstalling solely because its stamp
  is absent.
- **Dependencies:** DEVENV-084 owns sandbox-safe repair of an unhealthy dependency tree. This entry
  covers a healthy tree restored by the other repository wrapper.
- **Acceptance:** In a fresh worktree with no `node_modules`, `./dev merge-with-main --dry-run`
  restores dependencies and the immediately following sandboxed `./agent test-file <path>` starts
  the requested test without running a second Bun install.
- **Source:** 2026-09-19 merge-preflight and concurrent-dev-test remediation.
