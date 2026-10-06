# October 6 repository health review

## Boundary and method

Reviewed the 91 first-parent landings after `39aac77ca3d4f95b4cb774bdfe586bcbc2fa2864` through
`5d9330f85` (about 2,900 changed files). The Developer approved the pass in advance and was away,
so the propose-and-wait step was waived and every disposition below is the orchestrator's.
Read-only reviewers covered six overlapping seams: CI and the landing route, Syntax2 typing and
module migration, Studio and preview, developer tooling and resources, the Tao CLI, and agent
instructions against live commands. A second agent challenged each retained finding before
repair; implementers then worked on exclusive paths, and each regression test was shown to fail
without its fix. The pass branch is `feat/repository-pass-2026-10-06`.

## Findings and disposition

| ID | Finding | Disposition |
| -- | ------- | ----------- |
| C1 | A partitioned `Verify` run recorded a suite green after only its own shards passed; a sibling partition restoring that store skipped shards nobody ran. | Fixed: a partition never records a suite with a shard elsewhere. Regression in `gate-runner.test.ts`. |
| C2 | `open-pr --auto-merge` arms GitHub before the local complement finishes, and `Verify (host)` is not a required check, so a red complement can follow a merge. | Documented in `hosted-verification.md` and the `open-pr` header; `land-fix` is the existing route. Requiring `Verify (host)` in the `main` ruleset is a Developer decision. |
| C3 | The complement dropped any host gate `CI macOS` admitted, though that workflow has no `pull_request` trigger. Latent: nothing is admitted today. | Fixed: an admission counts only when the workflow runs on pull requests. |
| C4 | The `node_modules` cache keys in three workflows and the local install stamp ignored `patches/*.patch`. | Fixed in all four places; stamp regression in `agent-config-recovery-bootstrap.test.ts`. |
| S1 | `tao secrets grant` re-wrapped the store key to every name in the committed `recipients` list, which is unauthenticated text, so a hand-added recipient rode along on the next grant. | Fixed: grant wraps only to machines already wrapped plus the named one. Regression in `project-secrets.test.ts`. The repository-level dev secrets auto-grant listed recipients by design and were left alone. |
| H1 | The output-discipline hook refused `cat` and `sed -n` in Codex, which has no file-read tool: 3,311 `sed` and 75 `cat` overrides in a week. `git diff --check` was refused too. | Fixed: the hook reads the harness from its payload; `DEVENV-OUTPUT-HOOK-REQUIRES-UNAVAILABLE-READ-TOOL` archived. |
| R1 | Worktree reclaim classified a freshly created agent worktree, branched from `main` and clean, as reclaimable. | Fixed: a HEAD move in the worktree's own admin directory within 24 hours classifies it live. `reclaim --execute` was not run. |
| R2 | A naturally exiting test or Studio launch left an uncertain process record that nothing retires: 263 of 308 records, and the needs-inspection banner on every Tao command. | Fixed for new launches; the existing records need a prune rule (Developer decision, recorded in `DEVENV-STRANDED-DEVELOPMENT-RESOURCE-DISCOVERY`). |
| R3 | `dev-loop status` failed for every session when one receipt was unreadable. | Fixed; sessions still have no retention (84 in the primary checkout). |
| L1 | A root-level `@x.tao` given as a source path was indexed as a module, and source paths skipped the generated-directory exclusions. | Fixed with a shared exclusion predicate. |
| L2 | A dead `AssociatedFunctionDeclaration` formatter handler was always overridden. | Removed. |
| D1 | The first tutorial and the presentation spec named the removed `tao dev`; the instruction guide claimed `repo-lint` checks nested `AGENTS.md`; the dev-automation skill missed a recipe group and two file classes; `./agent help` omitted the resources registration flags. | Corrected. `packages/AGENTS.md` is 6,786 characters against its 6,000 budget; trimming it is left for its owner. |
| A1 | Standalone acceptance failed at its seventh of 22 scenarios: `tao create` now requires `--provider`, and the acceptance, installer hint, README and package spec omitted it. Behind it, recovering maintained native bindings required the 9 MB TypeScript engine, which Bun cached under the acceptance home's `Library/Caches/bun`, because the installed CLI names its transpiler cache only after startup. | Fixed: `--provider local` added throughout; the engine is evaluated with `Platform.evaluateCommonJsFile`, which bypasses Bun's module cache. Regression in `platform-commonjs-evaluation.test.ts`. The native TypeScript check's second `require` of the engine was converted too. |
| A2 | The installed CLI failed `tao check` on any project with native TypeScript: the compiler bundled into the binary keeps the build machine's `__filename`, so it looked for `lib.dom.d.ts` in a checkout that does not exist on the user's machine. Xcode acceptance scenario 22. | Fixed: when a resource root is declared, compiler hosts take default libraries from the installed engine's `typescript/lib`. Regression in `ProjectTypeScriptLibrary.test.ts`. |
| P1 | On Linux the barrier test for an escaped descendant timed out: a killed orphan stays an unreaped zombie in a container, and the test's wait asked `kill(0)`, which succeeds on zombies. The library already treats Linux zombies as exited. | Fixed in the test: Linux relies on the zombie-aware process table. |
| P2 | On Linux the `language/project-tooling:receipts` node passed its only test in 28 s and was killed at 116 s without exiting: something the watched refresh opens survives disposal there. | Deferred: not reproduced on macOS; needs a Linux run with open-handle diagnostics. |
| X1 | Folder-type visibility was suspected stale after a sibling file's deletion. | Refuted: the parser's update listener resets every document, and two existing tests cover deletion. |
| X2 | The first temporary-state inventory reported 343 GiB under the primary `.artifacts`. | Refuted: allocated size is 10.2 GiB. The tool summed apparent sizes of sparse images. |

Smaller items verified but not repaired, for the next pass or their owners:
`refreshProjectContext` spawns `git ls-files` and stats every project file on each save (cost
unmeasured); the formatter does not re-indent some members from stripped input (idempotence holds
over all 222 tracked `.tao` files); `Worker.ts` switches non-exhaustively over step kinds; the
Mac2 WDA port hold can leak when cleanup throws; `ci-macos` bootstraps with an empty gate list;
the contributor-agreement job is not in `Verify`'s `needs`; `merge-pr` ignores `Verify (host)`;
`land-fix` merges pre-squash commits; a saved Firebase project can be overridden in `choose`.

## Landing dispositions

| Landings | Scope and disposition |
| -------- | --------------------- |
| `e9e5b9b7`, `bd9c0970`, `4973b234`, `ffaf5522`, `068f9e51`, `095c989f`, `63e70f0f`, `bd9799da`, `29b60249`, `9ac809d6` | Hosted Verify, auto-merge and the landing route: C2 and C3. |
| `792b4ff7`, `7080f301`, `625a76a1`, `c115e0ea`, `edad3580`, `a709699e`, `374fef5c`, `a85c2b86`, `0552775e`, `dfb27e80`, `cc2dd34d`, `905af7b1`, `8e1c10be` | Partitioning, admission, caches and seeds: C1 and C4. |
| `85442713`, `a024a29a`, `825637cd`, `3bcd7164`, `580f88cc`, `10e62812` | Project and module migration, Syntax2 typing and runtime foundations: L1, L2. `580f88cc`'s runtime foundations were only skimmed. |
| `f27f8bb0`, `3adc0e76`, `2cab7930`, `b79e2dfc`, `cc75384b`, `6bac109b`, `68fb19e4`, `f960e9ab`, `6075853c` | Studio preview, publication and native proofs: the per-save rescan and the WDA port hold above. |
| `23d283a3`, `20bbeff0`, `15c151f9`, `e33f2d5a`, `4d6f9aa6`, `2d128058` | Resource ownership, dev loops and attention alerts: R2 and R3. |
| `94ec269f`, `883ea9ee`, `f9858bcf`, `b1dbd7a2`, `0c02334f` | CLI secrets, Firebase flow and install: S1. |
| `6e8139fe`, `5f383efc`, `b1cc156c`, `b8b78559`, `b04e9ec7`, `289a1cb0`, `346d2aaf`, `6410f9d1` | Agent instructions, messaging and routing: D1, H1. |
| Remaining 30 | Inspected through their seam's reviewer; no additional retained finding. |

## Health inventory

Allocated sizes from `du -sk`; the scan was not atomic. The September 28 figures used `stat`
allocation by root class.

| Location | September 28 | October 6 | Entries |
| -------- | -----------: | --------: | ------: |
| Primary checkout `.artifacts` | — | 10.2 GiB | — |
| Agent worktrees under `~/.codex/worktrees` (34 Tao checkouts) | 15.7 GiB | 175.9 GiB | 9.09M |
| Agent worktrees under the primary `.claude/worktrees` | 6.4 GiB | 8.6 GiB | 793k |
| `tao-lang-2.worktrees` (24 directories) | 7.3 GiB | 94.7 GiB | 5.39M |
| `/private/tmp/tao-admission` | — | absent | 0 |

The primary `.artifacts` is mostly `host-acceptance` (4.8 GiB) and test output (3.6 GiB). The
disk is 40% used. Worktree checkouts grew elevenfold in eight days, almost all of it agent
worktrees that each carry their own `node_modules` and generated toolchain. `./agent reclaim`
classifies 55 worktrees live, 16 reclaimable and 3 unclassified; reclaiming them is the
Developer's call and was not run. Reclaim enumerates registered worktrees, so the 35 under
`~/.codex/worktrees`, now the largest holder, are among those it classifies.

## Isolation acceptance

PLACEHOLDER-ISOLATION

## Routing, context and advisories

`./agent model-audit` found no routing mismatch. Main-session request context was p50 164k and
p90 221k tokens, subagents p50 88k; no request exceeded 272k, and 51 compactions occurred.
The September 27 context reminder came due and was measured over the past week against its
September 20 baseline:

| Measure | Baseline | October 6 |
| ------- | -------: | --------: |
| Main median context | 294k | 163k |
| Main p90 context | 615k | 220k |
| Subagent median context | 135k | 90k |
| Main session start | 64k | 76k |
| Subagent session start | 52k | 25k |
| `cat`/`sed`/`git show`/`git diff` share of Bash output | 42% | 6.1% |
| Bash calls opening with `cd` or an assignment | 16% | 10.8% (subagents 20.9%) |

Codex sessions ran at 125k main and 106k subagent median. Of 3,575 hook overrides, 3,311 were the
`sed` rule, which H1 narrowed; the reminder is deleted. The main session's start grew 12k, mostly
instruction and skill text. No tier was changed.

PLACEHOLDER-ADVISORY

## Verification

PLACEHOLDER-VERIFICATION
