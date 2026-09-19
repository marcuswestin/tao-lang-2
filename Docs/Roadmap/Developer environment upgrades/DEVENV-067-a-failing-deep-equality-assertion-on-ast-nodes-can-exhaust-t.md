# DEVENV-067 — A failing deep-equality assertion on AST nodes can exhaust the machine's memory

- **Status:** In progress
- **Area:** Test execution
- **Impact:** One failing `toEqual` whose operands are Langium AST nodes allocates without bound until
  macOS runs out of application memory. Nothing bounds it: no repository test node carries a timeout, an
  interrupt on the wrapper command leaves the allocating child alive, and the sandbox where this happens
  denies the process inspection needed to find that child.
- **Evidence:** On 2026-09-16 macOS reported `Your system has run out of application memory` on a 128 GB
  machine; system-wide memory pressure ran 18:00:03–18:44:25 local and macOS force-quit 675 idle
  background services. macOS skipped writing its own jetsam reports (`File limit set to 0`), so no OS
  report names the culprit. The culprit was `bun test packages/parser/parser-tests/design.test.ts`,
  started through `./agent test-file` by a Codex agent lane in `~/.codex/worktrees/e91a/tao-lang-2`.
  Three runs hung the same way (17:55:57, 18:07:48, 18:25:54); two produced no log at all, their
  directories under `.artifacts/logs/dev-test/`
  (`2026-09-16T21-55-57-025Z-93582-b8a2aab4` and `2026-09-16T22-07-48-549Z-11273-444f813e`) holding only
  an empty `test-results` directory. The trigger was a failing deep-equality assertion (`toEqual`) whose
  operands were Langium AST nodes; the lane later replaced those assertions with `toHaveLength`/`toBe`,
  which fixed the tests but not the processes already running. Reproduced locally on bun 1.3.13: a
  failing `expect([nodeA]).toEqual([nodeB])` on two parsed design declarations went from 185 MB to 4.1 GB
  in two seconds (killed at a 3 GB cap), and a stray instance of the same probe reached 12.4 GB in
  fifteen seconds before it was killed. Upstream this is bun issue #34178 (`Runaway native recursion …
  allocates unboundedly until the machine dies`, 210 GB in that report); its fix, bun PR #34179, adds a
  shared-reference budget of 1 MiB per side in assertion diffs and 64 MiB in snapshots, and was still
  open and unreleased as of 2026-09-12, so there is no bun version to upgrade to. Per that PR the
  formatter prints `[Circular]` only for true cycles, so a value reachable by several paths is printed
  once per path and expands exponentially; Langium nodes are exactly that shape (`$container`,
  `$document`, `$cstNode`). bun #21277 records that a synchronous runaway is not interrupted by
  `--timeout`, so a bun-level per-test timeout cannot bound this and the bound has to be enforced by the
  parent process; bun PR #34884 records the same formatter overflowing on deeply nested values. The same
  formatter backs `console.log`, so this can also occur outside tests when something prints an AST node.
  Three repository-side reasons it ran 45 minutes instead of two:
  `packages/dev/dev-src/repository-tests/WorkGraph.ts` supports a per-node timeout (`timeoutMs`) but only
  the ship bundle proof and `studio-canary` set it in `GateCatalog.ts`, so ordinary test nodes had no
  bound; `CLI.start` in `packages/shared/shared-src/CLI.ts` signalled only the direct child, so an
  interrupt to the `./agent test-file` wrapper left the `bun test` child running; and the leftovers could
  not be found because the Codex sandbox denies process inspection
  (`zsh:1: operation not permitted: ps`). Nothing in the logs shows what finally ended it at 18:44.
- **Workaround:** Do not assert deep equality on parsed Langium nodes; assert named fields with
  `toHaveLength`/`toBe`. Stop a surviving `bun test` child directly from a shell that can inspect
  processes, because interrupting the wrapper command does not.
- **Proposed change:** Implemented on `feat/one-verification-graph`, pending that branch landing.
  `CLI.start`'s teardown stops a child's whole tracked descendant tree deepest-first, filtered by OS
  process-start identity so a reused PID cannot be signalled, escalating SIGTERM to SIGKILL after a
  grace period; it is selected by a per-call `processPolicy` of `test`, `tool` or `server`, where
  `server` signals the direct child only and `resolveProcessBounds` refuses a bound on any policy but
  `test` rather than dropping it. No policy changes spawn detachment: an earlier version detached by
  default, which would have stopped the terminal's Ctrl-C reaching `./agent` lanes, and that was
  rejected as worse than the incident. Test nodes carry a parent-enforced wall-clock bound and an
  idle-output bound, derived in `packages/dev/dev-src/repository-tests/TestNodes.ts` from each node's
  recorded duration against a floor (and, for the wall bound, a ceiling) rather than a fixed five
  minutes; the idle bound is the one that catches this class, because the runaway allocates without
  printing and bun #21277 means `bun test --timeout` cannot interrupt it. `@shared/test`'s `Expect`
  refuses `toEqual`, `toStrictEqual`, `toMatchObject`, `toContainEqual` and the snapshot matchers on a
  Langium-shaped value, through `.not`, `.resolves` and `.rejects` too, with one named escape hatch
  (`Expect.Unguarded`); the existing repo-lint rule requiring test files to import `@shared/test`
  rather than `bun:test` backstops it, and the six assertions in
  `packages/parser/parser-tests/design.test.ts` that triggered the incident were rewritten to
  `toHaveLength` plus `toBe` on identity. Explicitly not adopted: a per-process RSS cap — macOS does
  not enforce `ulimit -v`/`-d`, per-pid RSS needs `ps`, and `ps` is denied in exactly the sandbox where
  this happened (DEVENV-068).
- **Dependencies:** bun PR #34179 is unreleased, so no upgrade removes the underlying allocation.
  DEVENV-016, DEVENV-030 and DEVENV-068 own host process visibility and cleanup constraints.
- **Acceptance:** A test node that allocates without bound is stopped by its parent within a recorded
  bound and its whole process group ends, including after an interrupt; a deep-equality assertion on a
  Langium-shaped value fails immediately with a named remedy; server, Metro, simulator, and Studio
  processes are unaffected by the test-shaped stop policy.
- **Source:** 2026-09-16 runaway-process investigation.
