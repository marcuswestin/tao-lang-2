# Plan - Repository simplification 2

Status: Waves 0 and 1 landed; Wave 2 integrated. Decisions settled
with Ro on 2026-09-19. The `simplify-repo` skill owns the repeatable method; this document owns this
run: its baseline, fences, waves, and ledger.

The first pass is archived at `Docs/Archive/Plans/Repository simplification/`. It and its three
follow-ups took dead exports, name-level duplicate helpers, typed errors, the Studio wire contract,
and the `repo-lint` convention table. Its Documentation and Command-surface parts never started.

## Baseline

`./agent simplify-audit` on 2026-09-19, non-test and non-generated:

| Measure                                             | Value                                  |
| --------------------------------------------------- | -------------------------------------- |
| Source lines under `packages/`                      | 141,135 in 20 packages                 |
| Largest packages                                    | studio 40.5k, runtime 30.8k, dev 18.3k |
| Files over 800 lines                                | 29                                     |
| `Switch` calls / native `switch` / chains           | 101 / 1 / 28 chains in 23 files        |
| `if` conditions with two or more logical operators  | 377                                    |
| `repo-lint` allowlist entries                       | 145, plus 23 chain files               |
| Instruction lines (`AGENTS.md` files and `agents/`) | 1,761                                  |
| `Docs/` Markdown                                    | 33,001 lines                           |

## Decisions

1. Scope
   - a. No test code is touched: `*.test.*`, test helpers, `*-tests/`, Test Apps, the test compiler,
     and all of `packages/dev/dev-src/repository-tests/` except `repo-lint.ts`, which is the
     enforcement point this pass extends.
   - b. Defects a slice exposes are fixed in that slice and named in its commit.
   - c. Under `Apps/`, documentation only.
   - d. Emitted TSX may change shape.
2. Projects: all five below, plus allowlist shrink, a dead-exports rerun, and package consolidation.
3. Patterns
   - a. Dispatch on `.kind`, `.type`, `.$type`, or a literal union uses `Switch.*`. If/else-if chains
     over one discriminant are linted at zero tolerance with an allowlist. This settles the policy
     `packages/AGENTS.md` deferred; the measurer that was `kind-chain-demo.ts` is now the gate.
   - b. A condition gets a name when it mixes `&&` with `||`, negates a group, or appears twice:
     `Tasks.isOwnedOrRecent(task)` when a namespace owns the concept, `isOwnedOrRecentTask(task)`
     otherwise. Shape guards become shared guards such as `Json.isRecord`. Review-only, not linted.
   - c. No file-size cap. The audit lists files over 800 lines; each splits only along a real seam.
   - d. One home per constant. One `Platform.Crypto` wrapper retires the `node:crypto` allowlist.
4. Instructions and documentation
   - a. Budgets, enforced by `repo-lint`: root `AGENTS.md` ≤ 60 lines, each `SKILL.md` ≤ 80 lines
     with on-demand reference files, total instruction lines about halved.
   - b. Anecdote and calibration prose is cut. A rule keeps at most a one-clause reason.
   - c. Domain skills (`langium-scoping`, `runtime-codegen`, `error-handling`,
     `studio-hybrid-client`) move into nested `AGENTS.md` files beside the code they govern.
   - d. Skills go from 21 to about 11: `commit-all-chunks` and `merge-progress` become reference
     files of `git-workflow`; `parallel-implementation` and `review-fanout` become reference files
     of `delegation`; `verification-lanes` halves by leaning on what `./agent` prints.
   - e. New hooks warn; none block yet.
   - f. Archives are kept and consolidated into one `Docs/Archive/` with a brief README on how to
     add to it. Overlapping live explorations merge into one document per topic, from a merge list
     Ro signs off first.
5. Packages: 20 → 13, import aliases renamed to match (`@language/parser`, `@compiler/generation`).
6. Execution: one branch, exclusive path ownership per agent, `./agent verify` per slice, success
   measured as non-test source lines and instruction lines before and after.

## Fences: concurrent branches

| Branch                             | Do not edit                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/real-host-testing-prototype` | `packages/e2e-testing`, `packages/host-control*`, `packages/runtime/TaoRuntime-src/core`, the test compiler, `MachineLanes.ts`, `Docs/Roadmap/Real-host testing*`, `Tao host control architecture.md` |
| `feat/landing-pool-lock`           | `repository-tests/` (but see 1.a), `doctor/Board.ts`, `Docs/Roadmap/Parallel agents on one machine.md`                                                                                                |
| both                               | the developer-environment ledger and its entries                                                                                                                                                      |

Shared-edit files (`AGENTS.md`, `Justfile`, `dev.ts`, `agent-dev.ts`, `tsconfig.base.json`,
`config/knip.json`, `bun.lock`) are edited by the orchestrator only, after merging `main`.

## Projects

1. **Instruction diet and rules into code.** Apply 4.a–4.e. Delete prose `repo-lint` already gates.
   Into code: agent-identity in a commit message (commit-msg hook); detached HEAD and branch name
   (pre-commit hook); generated harness files stale against `./agent setup` (`repo-lint`); subagent
   brief boilerplate (injected by a subagent-start hook); `grep -r`, `cd` prefixes, and judging a
   piped exit status (PreToolUse hook).
2. **Documentation prune.** Build `Docs/Archive/` (`Plans/`, `Explorations/`, `Reports/`, README of
   at most 15 lines). Archive finished roadmaps, starting with `September squash-merge
   remediation.md`. Produce the live-exploration merge list for Ro, then merge.
3. **Pattern conformance.** Decisions 3.a–3.d everywhere in scope. Executed by every code agent
   inside its own paths, not by a separate agent.
4. **Studio and runtime structure.** One message-dispatch shape for the 13-, 11-, and 7-branch
   `message.type` chains (`TR-studio-device-client.ts`, `StudioApiClient.ts`,
   `StudioDeviceGateway.ts`). Split `TR-studio-preview.tsx`, `StudioProjectSession.ts`,
   `TR-studio-device-host.tsx`, `StudioServer.ts` along real seams. Shrink `StudioProtocol.ts`.
5. **`packages/dev` diet.** `dev-src/studio/` (`StudioNative`, `StudioCdp`, `StudioElectrobun`
   share app-name and bundle constants and launch logic), setup, agent-config, doctor without
   `Board.ts`. The command-surface part of the first plan stays re-scoped: `./tao`, `Justfile`, and
   `./dev` remain distinct.

## Packages after consolidation

| Package                                                   | Holds                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `shared`                                                  | unchanged, plus `Platform.Crypto` and shared guards                          |
| `language`                                                | `parser`, `ast-utils`, `validator`, `formatter`, `source-actions` as folders |
| `compiler`                                                | `compiler`, `generation`, `workspace`                                        |
| `editor`                                                  | `code-editor`, `ide-extension`                                               |
| `runtime`                                                 | unchanged; imports nothing, which is why `stdlib` stays out                  |
| `stdlib`, `runtime-toolchain`, `studio`, `tao-cli`, `dev` | unchanged as packages                                                        |
| `update-server`, `icloud-native`, `studio-companion-app`  | unchanged; each is its own deployable (`tao-update-server` has a `bin`)      |

"Langium only inside parser" becomes a folder rule inside `language`.

## Waves

| Wave | Mode     | Agent and tier | Owns                                                                                                                                                                 |
| ---- | -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | serial   | orchestrator   | `./agent simplify-audit`; chain gate on with today's chains allowlisted; baseline recorded here                                                                      |
| 1    | parallel | A, standard    | `AGENTS.md` files, `agents/`, `.rulesync/`                                                                                                                           |
| 1    | parallel | B, standard    | `Docs/` outside the fences, documentation under `Apps/`                                                                                                              |
| 1    | parallel | C, standard    | `shared`, `parser`, `ast-utils`, `validator`, `formatter`, `source-actions`, `compiler`, `generation`, `workspace`, `tao-cli`, `stdlib`                              |
| 1    | parallel | D, deep        | `studio`, `code-editor`, `ide-extension`                                                                                                                             |
| 1    | parallel | E, deep        | `runtime` outside `core/`, `runtime-toolchain` source outside `testing/`                                                                                             |
| 1    | parallel | F, standard    | `packages/dev/dev-src/studio`, setup, agent-config, doctor without `Board.ts`                                                                                        |
| 2    | serial   | orchestrator   | cross-seam work: the Studio–runtime dispatch contract, `Platform.Crypto`, allowlist shrink, dead-exports, hooks, budget and freshness lints, chain allowlist to zero |
| 3    | serial   | orchestrator   | merge `main`; package consolidation and alias rename in one mechanical commit; `./agent finalize`                                                                    |

- Agents D, E, and F return requests for `shared` helpers instead of editing `shared`; C applies them
  at the Wave 1 checkpoint.
- A deep-tier `reviewer` reads each wave's seams before the next wave starts.
- Wave 3 runs last on this branch whether or not the concurrent branches have landed; a branch
  landing afterwards rebases its imports onto the new aliases.

## Ledger

Record per wave: non-test source lines, instruction lines, allowlist entries, defects fixed.

| Wave | Source lines | Instruction lines | Allowlist entries | Chain files | Defects fixed |
| ---- | ------------ | ----------------- | ----------------- | ----------- | ------------- |
| 0    | 141,135      | 1,761             | 145               | 23          | none          |
| 1    | 141,422      | 1,411             | 145               | 3           | 3             |
| 2    | 141,652      | 1,428             | 135               | 3           | none          |

### Wave 1 notes

- Pattern conformance landed; line reduction did not. Exhaustive handler tables spell out branches a
  chain fell through, which cost about what the removed repetition saved.
- The two latent defects: an unknown persisted `kind` fell back to `item`, and an unlisted primitive
  validated as a number. Both now fail to compile.
- The wave's review found one defect class, fixed in the wave: a handler table indexed by a wire
  value resolved `constructor`, `toString`, and `__proto__` to inherited `Object` members. `Switch`,
  `RuntimeSwitch`, `StudioMessages.dispatch`, the window-message parser table, and the device
  protocol's parser table, where the hole predated the wave, now read own keys only.
- Instructions fell 20%, not half. The remainder waits on Wave 2's hooks and a second pass over the
  skills that were already under budget.
- `packages/dev` outside `repository-tests/` had little to give.
- Carried to Wave 2: a `type`-property form and a shared no-op handler for `Switch`, so
  `StudioMessages.dispatch` can retire; `journalLimit` mirrored across the runtime–Studio seam.
- Mapped but not started, each its own slice: the sketch block of `StudioProjectSession.ts`, a route
  table for `StudioServer.ts`, seam splits of `TR-studio-preview.tsx` and
  `TR-studio-device-host.tsx`, and a deep-tier read of `Type.ts`, `compiler.ts`, and `FS.ts`.

### Wave 2 notes

- Gates added to `repo-lint`: instruction budgets, and generated harness files that regenerating
  from `.rulesync/` would change.
- Warn-only hooks: shell habits before a Bash call, the standing rules at a subagent's start, and
  `commit-msg` and `pre-commit` Git hooks that `./agent setup` installs. The Git hooks live in the
  `.git` every worktree shares, so each asks the committing worktree for its own script and stays
  silent where there is none. The prose they replace is cut from `AGENTS.md`, `git-workflow`, and
  `delegation`.
- `Switch.on(item, property, handlers)` and `Switch.nothing` landed; `StudioMessages` is gone.
- Hashing, signing, and random ids go through flat `Platform` functions, not a `Platform.Crypto`
  namespace, because `Platform` has no nested namespaces. Ten `node:` allowlist entries retired.
- Instruction lines rose by 17: the hooks removed about as much prose as the `after-merging-main`
  reference Ro asked for added. The halving target still needs its own pass.
- Not done: `journalLimit` stays mirrored across the runtime–Studio seam, because the test that pins
  runtime mirrors is fenced.

### Follow-ups after Wave 2

- `land-unlock --force` requires `--holder <pid>` and compares it inside the registry lock, after an
  agent force-released a lock other than the one it had checked. Waiter messages no longer suggest
  forcing, and the force commands go to permission review in Claude Code; Codex's generator emits
  only `allow`, so it cannot express that.
- The three hooks' logic moved from zsh to TypeScript under `packages/dev/dev-src/agent-hooks/`,
  476 lines to 393, with shims of about a dozen lines that find `bun` and always exit 0. The
  shell-habits hook costs 31–43 ms a call; routed through `./dev` it would cost about 250 ms.
- A hook earns its place when the rule is cheap to detect and often broken. Logic goes in
  TypeScript; shell stays only where the environment may not exist yet.
