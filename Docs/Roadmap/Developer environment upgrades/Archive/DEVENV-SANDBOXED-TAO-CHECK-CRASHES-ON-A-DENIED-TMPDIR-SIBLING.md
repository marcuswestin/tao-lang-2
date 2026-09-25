# DEVENV-SANDBOXED-TAO-CHECK-CRASHES-ON-A-DENIED-TMPDIR-SIBLING — Sandboxed `tao check` crashes on a denied `$TMPDIR` sibling

- **Status:** Resolved
- **Section:** External
- **Area:** Tao CLI file discovery; agent sandbox
- **Impact:** In a sandboxed agent shell, `tao check` on any fixture under `$TMPDIR` that is outside
  a Git repository crashes with a bare `Something went wrong.` The CLI's file discovery inspects
  the entries around the fixture, and the agent harness now keeps a read-denied directory,
  `/private/tmp/claude-501/bash-edit-diff`, beside every fixture the tests create. Every CLI test
  that checks, fixes, or tests a fixture under `$TMPDIR` fails, and so does the `cli/tao-cli` part of
  `./agent verify-changed`, which is otherwise the per-commit gate. The failures are the same on
  every rerun and name nothing about the branch being verified. `./agent land` runs its verification
  unsandboxed, where the directory is readable, so landings are unaffected.
- **Evidence:** 2026-09-25, `feat/design-typed-style-values`. `./agent verify-changed` failed about 40
  tests across `cli/tao-cli`, `compiler`, `language/ast-utils`, `ides/studio`, and
  `ides/ide-extension`, most logging
  `EPERM: operation not permitted, lstat '/private/tmp/claude-501/bash-edit-diff'` or
  `ENOENT … lstat '/private/tmp/claude-501/tao-cli-test…'` (another test's fixture deleted
  mid-scan). `./agent test-retry` failed the same files. A one-file fixture reproduces it:
  `mkdir -p "$TMPDIR/probe" && printf 'view Main() {\n}\n' > "$TMPDIR/probe/App.tao"` then
  `env TAO_DEBUG_ERRORS=1 ./tao check "$TMPDIR/probe"` prints
  `cause=EPERM: operation not permitted, lstat '/private/tmp/claude-501/bash-edit-diff'`. The
  directory was created during that session (11:52 local), so earlier sandboxed runs passed.
  `ancestorDeclarationIdentity` (`packages/cli/tao-cli/cli-src/check-cache.ts:321`) only inspects
  `.tao` names, so the unconditional inspection is elsewhere in check's discovery.
- **Evidence:** 2026-09-25, after main commit `48c17795` stopped the project-root climb at the OS
  temp directory, a sandboxed `env TAO_DEBUG_ERRORS=1 ./tao check "$TMPDIR/probe"` with a sibling
  directory set to mode `000` produced ordinary missing-project and missing-render diagnostics, with
  no `EPERM`. The focused `check-cache.test.ts` test creates an unreadable sibling, verifies it is
  unreadable, and checks a no-project fixture without an infrastructure error.
- **Workaround:** Run the lane with a temporary root away from the denied directory:
  `env TMPDIR="$HOME/Library/Caches/tao-agent-tmp" ./agent verify-changed` took 2026-09-25's run
  from about 40 failures to 2. Those two remain because the CLI prints a path under the home
  directory as `~/…`, and `test-command-cli.test.ts` ("names the log file…") and
  `check-command-cli.test.ts` ("shows an outside diagnostic path absolutely…") expect an absolute
  path; the landing's unsandboxed verification uses the ordinary temporary root and is unaffected.
- **Proposed change:** Stop project-root discovery at the OS temp directory, so a fixture below it
  cannot make the whole temp directory its workspace and inspect unrelated siblings. Main commit
  `48c17795` made that change. The separate `EISDIR` crash for a standalone file at a Git root came
  from hashing a directory symlink and is fixed separately in the design-values follow-up.
- **Dependencies:** None.
- **Acceptance:** A fixture under `$TMPDIR` checks in a sandboxed shell while an unreadable sibling
  directory exists, and a regression test creates such a sibling.
- **Source:** 2026-09-25 design values tranche, running `./agent verify-changed`.
- **Archived:** 2026-09-25
