# September 28 repository health review

## Boundary and method

Reviewed the 12 first-parent landings after `0e3f6a9bc5d63042e2eb4a60d6c1be78986d12fe`
through `39aac77ca3d4f95b4cb774bdfe586bcbc2fa2864`. Auth/data, UI/native, and workflow
reviewers checked overlapping seams; a second reviewer challenged each retained finding before
repair. This report separates source review, focused regression evidence, full repository gates,
and host acceptance. The pass branch is `feat/repository-pass-2026-09-28`; landing is separate.

## Findings and disposition

| ID | Finding                                                                                                                                                            | Disposition                                                                                                                                                                                                            |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | The data specification still described InstantDB as unauthenticated and snapshot-row based.                                                                        | Corrected the implemented Clerk/InstantAuth pairing, per-row storage and snapshot projection, without changing runtime behavior.                                                                                       |
| N1 | SwiftUI numeric interpolation used Swift `String(Double)`, which differs from Tao's JavaScript text for `1e-6` and `1e20`.                                         | Fixed the finite-number formatting range and added a WatchHello journey plus compiler and executable Swift controls. Shortest-digit parity across all binary doubles remains unproved.                                 |
| N2 | The watchOS proof parsed `--developer-dir` but did not pass it to `xcodebuild`.                                                                                    | Scoped `DEVELOPER_DIR` to the build child; tested explicit, default and invalid paths. No native watch/device run was made.                                                                                            |
| Q1 | Screenshot capture could report clean source provenance with an untracked Tao source file.                                                                         | Include untracked source in the dirty-state check; tests distinguish ignored artifacts and submodule changes.                                                                                                          |
| Q2 | Same-second screenshot runs could choose the same archive directory; concurrent captures could also overwrite the shared timeline with stale content.              | Preserve milliseconds and add a UUID while retaining chronological directory order. Serialize timeline regeneration and publish it atomically; collision, ordering, and concurrency tests added.                       |
| V1 | A failed or skipped GUI graph node released the machine-wide lease before its isolated retry, while standalone native Studio smoke/canary did not hold that lease. | Keep the lease through GUI retry and make standalone native entry points use the same resource. Controlled concurrency and cleanup tests pass; abrupt process-kill behavior remains untested.                          |
| H1 | Execution-tool sandbox denials repeatedly killed the Linux host runner after starting a guest, bypassing its shell cleanup trap.                                   | Exact recovery collected interrupted guest evidence and removed run-specific resources. The runner gained an ARM64 cached-only mode; a later full cold/cached run finished normally with exact cleanup.                |
| H2 | The shared CLI left piped stdin errors unobserved. An early-exiting hook child caused an unhandled `EPIPE` in both cached Linux test and verification stages.      | Observe stream errors before writing input and catch an immediate throw from `stdin.end`. The closed-pipe control exposed both paths; corrected `eaea244f` passed native ARM64 cold and cached tests and verification. |

## Landing dispositions

| Commit     | Scope and disposition                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `42bc8d15` | Earlier data, Studio and verification repairs inspected; D1's stale contract was found in the current data seam.    |
| `fd4c1012` | Auth/data pairing and Auth Review path inspected; D1 records the spec correction.                                   |
| `2f1dc815` | visionOS window and setup inspected; no additional retained finding. Native Vision Pro acceptance was not repeated. |
| `150e5873` | Draw workbench over real views inspected; no additional retained finding.                                           |
| `9d0edf0b` | In-app browser preference inspected; no additional retained finding.                                                |
| `f7ecb086` | Clerk sign-in through InstantDB inspected; D1 records the outdated description.                                     |
| `cc374189` | Deferred InstantDB decisions inspected; current runtime behavior remains distinct from future decisions.            |
| `27a7b371` | Scoped Duo host/native review inspected; no additional retained finding.                                            |
| `0dad0362` | Screenshot archive inspected; Q1 and Q2. No screenshots were captured or published in this pass.                    |
| `9e0e0b98` | Draw canvas live views inspected; no additional retained finding.                                                   |
| `cf8b3d12` | Archive pin and storage guidance inspected; Q1 and Q2 apply to the capture seam.                                    |
| `39aac77c` | WatchOS proof inspected; N1 and N2. No native build or device acceptance was repeated.                              |

## Health inventory

Allocated bytes and file counts were measured read-only with `stat` without following symlinks.
The scan was not atomic; oldest age is file modification time, not creation time. The detailed
measurement and ownership notes are in the task-local inventory.

| Root class                            |    GiB |     Files | Oldest mtime age | Change since September 27                                |
| ------------------------------------- | -----: | --------: | ---------------: | -------------------------------------------------------- |
| Codex Tao worktrees                   |  15.68 | 1,094,974 |       1,683.67 d | +5.56 GiB; +324,428 files                                |
| In-repository Claude worktrees        |   6.36 |   470,352 |       1,683.67 d | -7.72 GiB; -747,909 files                                |
| Alternate Tao worktrees               |   7.29 |   556,052 |         122.45 d | +0.78 GiB; +73,188 files                                 |
| Tao home Jest v2 cache                |  1.129 |    95,042 |     about 2.16 d | essentially unchanged                                    |
| Additional `.tao/cache` Jest v2 cache |  0.461 |    24,172 |           1.53 d | no separate baseline                                     |
| Tao home retained test runs           |  1.020 |   186,164 |           2.47 d | same size and count                                      |
| Additional `.tao/cache` test runs     |  0.018 |     2,329 |           2.15 d | no separate baseline                                     |
| Selected Tao OS temporary roots       | 0.0035 |       259 |        about 0 d | prior selection 0.161 GiB/12,028 files; scope can differ |
| Other active local project: `machine` |  0.119 |     1,918 |         123.48 d | no baseline; remains with its owner                      |

An active `/private/tmp/tao-studio-client-split` verification checkout separately held 2.69 GiB
and 205,104 files during measurement. `./agent worktree-status` found no worktree eligible for
automatic reclaim. Current Jest caches use reader leases and bounds; retained test roots have
normal aggregate pruning. No shared, active, or owner-unknown data was deleted. The 259 surviving
Tao OS temporary files matter to boot cleanup by file count even though they use little space.

## Isolation acceptance and retained resources

The vanilla and prepared-Xcode installed CLI checks used separate fresh Tart clones of committed
`39aac77c`. Each completed 17 scenarios and its required filesystem audit with no disallowed or
unobservable paths. Vanilla took 284 seconds, prepared Xcode 202 seconds. Both disposable clones
and the Tart lease were removed. The pinned reusable bases remain cached. These results cover the
installed CLI, not native app builds or device acceptance.

The ARM64 Ubuntu run archived the same commit. Its cold guest started and installed Nix 2.35.2,
but the host execution sandbox then denied Docker Desktop telemetry to `sessions.bugsnag.com` and
killed the runner. Later read-only inspection found the exact labelled guest exited 0. The approved
ownership-checked recovery collected complete guest logs before removing only that run's cold
container and base image; a subsequent inspection confirmed both absent. Recovered steps show
bootstrap, setup, parser, check, test, and verify all exited 0, with full verification passing
after an isolated contention retry. The original host runner did not collect its normal terminal
receipt, and the cached guest did not start. A fresh run archived committed `e639461c`; its cold
guest completed in 1,080 seconds, with all requested stages passing. A Reading List journey timed
out after 30 seconds under machine contention during verification, then passed on an isolated
retry. The host runner was interrupted again, this time by the execution tool blocking Docker
Desktop's `ai-backend-service.docker.com` request while the cached guest was active. Exact recovery
collected the guest logs and removed its run-specific container and base image. The cached guest
passed bootstrap, setup, parser and check, but both test and verify failed when an early-exiting
hook child triggered an unhandled `EPIPE` in the shared CLI stdin stream. The 226 agent CLI test
assertions themselves passed. The same failure in both stages makes cached acceptance red. The
shared CLI now observes stdin errors before supplying input, and a focused closed-pipe regression
failed before the fix and passed afterward. Committed `160c05bd` passed all cold ARM64 stages:
bootstrap 63 seconds, setup 4, parser 7, check 96, test 336, and verify 638. The execution tool
again stopped its host runner during cold verification, but the guest finished successfully.
Approved recovery collected its complete logs and removed the remaining run-specific base image;
exact inspection found no container or base. The runner could not start cached mode. Its supported
arguments were extended to run native ARM64 cached mode alone after a completed cold guest.
An incidental no-flag invocation selected default amd64 emulation and failed during Nix bootstrap;
it cleaned its own resources and does not count toward native acceptance.
A new native ARM64 run on `47a6b80e` exercised the cached-only argument's committed source.
Its cold `test-all` failed only the new closed-pipe regression: Linux Bun 1.4.2 threw `EPIPE`
synchronously from `stdin.end(input)` even with a stream error listener. Cold `verify` passed,
but the earlier test failure makes cold acceptance red. The same run provisioned reusable ARM64
tools, then its cached `test-all` failed only the same shared regression. Both cold and cached
`verify` passed. The host runner finished in 2,260 seconds with exit 1, normally removed all
run-specific containers and the base image, and exact inspection confirmed absence. The shared
CLI now also catches the immediate throw and records it as the command error; focused shared and
hook tests pass locally. Committed `eaea244f` then passed a full native ARM64 cold-and-cached run
`20260928T071634Z-92200` with normal host exit 0 in 1,971 seconds. Both guests passed bootstrap,
setup, parser, check, full test, and full verification. Cold took 909 seconds and cached took 1,061;
neither reported a retry or timeout. The previously failing shared stdin and agent CLI suites
passed in both modes. The runner reused its ARM64 tools image and normally removed the exact cold
and cached containers and run-specific base; read-only inspection confirmed their absence. Shared
caches remain for reuse.
The earlier transfer log names `glibc-2.42-61` and
`glibc-2.42-84`, not a unique realized runtime closure. No native amd64, QEMU, hosted cloud,
device, signing or publication acceptance is claimed.
Run IDs, image identities, paths, limitations and cleanup conditions are in the task-local
isolation resource accounting note.

## Routing and advisory review

`./agent model-audit` found no routing mismatch. September 21–28 request contexts had main-agent
p50 217,262 and p90 609,082 tokens, and subagent p50 143,662 and p90 324,122 tokens; 7,322
requests exceeded the 272,000-token auto-compaction window. The due reminder's shell-prefix and
Bash-output-source shares could not be extracted from this audit, and completed-task cost and
review-quality evidence was unavailable. No tier was silently changed. Official
[Codex subagent precedence](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[OpenAI API pricing](https://developers.openai.com/api/docs/pricing?tab=suite), and
[Anthropic model pricing](https://platform.claude.com/docs/en/about-claude/pricing) were checked;
API rates alone do not establish this account's cost per completed task.

The [dependency advisory register](<Dependency advisory follow-up.md>) records today's unchanged
locked `uuid`, `stream-json` and Nixpkgs paths, the distinction between patch evidence and a
realized Linux closure, owners, and next review dates. No dependency or lockfile was changed.

## Verification and handoff

Focused controls accompany each accepted code repair. Integration review found the shared
screenshot timeline race and stale CLI help; both were repaired and the concurrency regression
failed when the lock was deliberately removed. `./agent check`, `verify-changed`, and `verify`
passed after those changes; the full gate reused exact-tree green evidence from `verify-changed`.
The repair commit is `cab43391`. Finalization integrated later main commit `2e2c2cf9` (the Tao
file lotus icon, outside this pass's review boundary) as merge `6e706364`, then verified the whole
merged tree. Its merge message was reviewed and recorded, and the worktree was clean. Landing
was later authorized. The Linux H2 stream listener was committed as `160c05bd`, and the native
ARM64 cached-only argument as `47a6b80e`, each after the changed-tree gate. The subsequent Linux
run exposed a synchronous `EPIPE` path; its catch was committed as `eaea244f` after focused and
changed-tree verification. The full cold/cached acceptance above exercised that exact commit.
Landing is separately authorized.
