# September 2026 repository review

## Boundary and method

- Window: September 7–22, 2026 (America/New_York calendar days); frozen `main` is `ff4f017ceb100c39c7d55bec8c228ef967097be4`.
- Unit: each first-parent landing diff. The frozen history contains 142 commits: 7 covered by the independent September audit through `18505faf`, 74 covered by the September 21 catch-up through `5e352643`, and 61 subsequent initial candidates.
- Prior audit evidence: [September squash-merge remediation](<../Archive/Reports/September squash-merge remediation.md>) and [Recurring repository pass](<Recurring repository pass.md>). The Developer chose to trust the catch-up handoff for its 74-commit boundary.
- Current-state findings require an independent recheck against the frozen tip. A later-fixed historical defect is recorded separately, not reported as surviving.

## Commit disposition ledger

| Commit     | Date       | Landing                                                                     | Disposition                           | Review cluster          |
| ---------- | ---------- | --------------------------------------------------------------------------- | ------------------------------------- | ----------------------- |
| `9f4bd6db` | 2026-09-15 | Make the Studio preview a zoomable canvas that takes half of Design mode    | Reviewed: independent September audit | —                       |
| `295a729a` | 2026-09-15 | Add a Tao debugger: statement gates, an action journal, and a Studio drawer | Reviewed: independent September audit | —                       |
| `6134a4b3` | 2026-09-15 | Bind several datasources to one app                                         | Reviewed: independent September audit | —                       |
| `b64caa79` | 2026-09-15 | Add Studio's Draw canvas, @tao/linking, and one design namespace            | Reviewed: independent September audit | —                       |
| `23fa3a99` | 2026-09-15 | Add a Safari-style toggle bar to SelectionNav and move HNReader onto it     | Reviewed: independent September audit | —                       |
| `6722026d` | 2026-09-16 | Support Xcode 27 Device Hub and Expo 57                                     | Reviewed: independent September audit | —                       |
| `18505faf` | 2026-09-16 | Make Tao packages project-local                                             | Reviewed: independent September audit | —                       |
| `ba9a327a` | 2026-09-16 | Refresh Studio previews in place without blanking or losing state           | Reviewed: September 21 catch-up       | —                       |
| `c63ccbdd` | 2026-09-17 | Prove each verification gate once per tree                                  | Reviewed: September 21 catch-up       | —                       |
| `3e1ae411` | 2026-09-17 | Implement the 183 tracked September squash-merge findings                   | Reviewed: September 21 catch-up       | —                       |
| `0ec9a82d` | 2026-09-17 | Clear narrowing on engage and fix what that gate was hiding                 | Reviewed: September 21 catch-up       | —                       |
| `614669c8` | 2026-09-17 | Schedule verification as one graph of small, bounded nodes                  | Reviewed: September 21 catch-up       | —                       |
| `5053d628` | 2026-09-17 | Split the public MVP release into agent and Ro roadmaps                     | Reviewed: September 21 catch-up       | —                       |
| `5811df6e` | 2026-09-17 | Leave the open verification measurements without a branch to go stale       | Reviewed: September 21 catch-up       | —                       |
| `34132956` | 2026-09-18 | Return the simulated-user journey to the verification gates                 | Reviewed: September 21 catch-up       | —                       |
| `c7a973b6` | 2026-09-18 | Report a bridged TypeScript sidecar that does not exist                     | Reviewed: September 21 catch-up       | —                       |
| `90df2153` | 2026-09-18 | Delegate to subagents by default, at a deliberately chosen tier             | Reviewed: September 21 catch-up       | —                       |
| `639b0fdc` | 2026-09-18 | Docs                                                                        | Reviewed: September 21 catch-up       | —                       |
| `cd6e2131` | 2026-09-18 | Honour every lane's one-slot admission floor on a full machine              | Reviewed: September 21 catch-up       | —                       |
| `e87fa930` | 2026-09-19 | Spend verification time only on work whose inputs changed                   | Reviewed: September 21 catch-up       | —                       |
| `9d0c046a` | 2026-09-19 | Give finalizing a command, and the machine a board                          | Reviewed: September 21 catch-up       | —                       |
| `2d5d3442` | 2026-09-19 | Correct DEVENV-073's impact and acceptance to what was observed             | Reviewed: September 21 catch-up       | —                       |
| `89380aaf` | 2026-09-19 | Carry a capture failure's category and close the second audit               | Reviewed: September 21 catch-up       | —                       |
| `21905bc4` | 2026-09-19 | Gate a quiet machine on load average, not on the lane count                 | Reviewed: September 21 catch-up       | —                       |
| `f1b35755` | 2026-09-19 | Squashed commit of the following:                                           | Reviewed: September 21 catch-up       | —                       |
| `74a406fa` | 2026-09-19 | Report progress while a long verification lane runs                         | Reviewed: September 21 catch-up       | —                       |
| `697b20b7` | 2026-09-19 | Land without staging in a checkout other agents share                       | Reviewed: September 21 catch-up       | —                       |
| `3a9b043a` | 2026-09-19 | Plan the standalone cross-platform Tao executable                           | Reviewed: September 21 catch-up       | —                       |
| `dea53082` | 2026-09-19 | Serialize landing behind one machine-wide lease                             | Reviewed: September 21 catch-up       | —                       |
| `666b9d1b` | 2026-09-19 | Give the human developer their own recipes in the main checkout             | Reviewed: September 21 catch-up       | —                       |
| `b2d01c80` | 2026-09-19 | Let a person name their dev branch once per machine                         | Reviewed: September 21 catch-up       | —                       |
| `4b714142` | 2026-09-19 | DRAFT: Merge branch 'main' into feat/september-cleanups                     | Reviewed: September 21 catch-up       | —                       |
| `328df401` | 2026-09-19 | Collect MVP feedback through intake forms and a pasteable fingerprint       | Reviewed: September 21 catch-up       | —                       |
| `65cccf6f` | 2026-09-19 | Make verify-repo green: the --no-cache leak and the Unsnap journey          | Reviewed: September 21 catch-up       | —                       |
| `2783960f` | 2026-09-19 | Record that nothing reclaims dead worktrees and merged branches             | Reviewed: September 21 catch-up       | —                       |
| `0c39e772` | 2026-09-19 | Take turns landing through one machine-wide lock                            | Reviewed: September 21 catch-up       | —                       |
| `923b3d75` | 2026-09-19 | Write the verification lane names once, where a wrong one fails loudly      | Reviewed: September 21 catch-up       | —                       |
| `801865ac` | 2026-09-19 | Plan the second simplification pass and land its audit and chain gate       | Reviewed: September 21 catch-up       | —                       |
| `6998aa14` | 2026-09-19 | Correct the MVP roadmaps against two days of landings                       | Reviewed: September 21 catch-up       | —                       |
| `4b2ebf76` | 2026-09-19 | Rewrite WordFlower's Revolution tier in the decided dialect                 | Reviewed: September 21 catch-up       | —                       |
| `84bb9610` | 2026-09-19 | Consolidate Tao Future to the decided dialect; finish Coverage.md           | Reviewed: September 21 catch-up       | —                       |
| `bdf46aec` | 2026-09-19 | Report actionable Tao diagnostics from the tao check CLI                    | Reviewed: September 21 catch-up       | —                       |
| `cb6f4e48` | 2026-09-19 | Inventory what publishing this repository would expose                      | Reviewed: September 21 catch-up       | —                       |
| `9649d95e` | 2026-09-20 | Diagnose sandboxed merges and isolate concurrent dev tests                  | Reviewed: September 21 catch-up       | —                       |
| `7b7dc0bc` | 2026-09-20 | Harden developer environment setup and host proofs                          | Reviewed: September 21 catch-up       | —                       |
| `8f4a5250` | 2026-09-20 | Improve verification scheduling visibility                                  | Reviewed: September 21 catch-up       | —                       |
| `dd40ba6e` | 2026-09-20 | End the manual Studio checks where the person ends them                     | Reviewed: September 21 catch-up       | —                       |
| `8c88d071` | 2026-09-20 | Simplification Wave 1: handler tables, instruction budgets, one archive     | Reviewed: September 21 catch-up       | —                       |
| `b54fe7ef` | 2026-09-20 | Write printed agent briefs for a worktree of their own                      | Reviewed: September 21 catch-up       | —                       |
| `380240d6` | 2026-09-20 | Simplification Wave 2: warn-only hooks, new gates, Switch.on                | Reviewed: September 21 catch-up       | —                       |
| `ca8d5b79` | 2026-09-20 | Make the landing lock safe to force and move hook logic to TypeScript       | Reviewed: September 21 catch-up       | —                       |
| `19ed1eb4` | 2026-09-20 | Group verification shards and report landing-lock waits                     | Reviewed: September 21 catch-up       | —                       |
| `a346aec6` | 2026-09-20 | Remove 547 lines of repetition from the seven largest source files          | Reviewed: September 21 catch-up       | —                       |
| `d900c107` | 2026-09-20 | Record finalize's sandboxed integration merge as DEVENV-111                 | Reviewed: September 21 catch-up       | —                       |
| `4f3757ce` | 2026-09-20 | Make generated verification and publication durable                         | Reviewed: September 21 catch-up       | —                       |
| `e241941a` | 2026-09-20 | Merge overlapping live explorations and trim duplicated instructions        | Reviewed: September 21 catch-up       | —                       |
| `7af5d0d7` | 2026-09-20 | Keep serial landing and stabilize outside paths                             | Reviewed: September 21 catch-up       | —                       |
| `0ac05257` | 2026-09-20 | Report a file tao fmt cannot parse the way tao check does                   | Reviewed: September 21 catch-up       | —                       |
| `bbb2721f` | 2026-09-20 | Re-measure what A1 and DEVENV-099 still owe                                 | Reviewed: September 21 catch-up       | —                       |
| `b3e718a6` | 2026-09-20 | Write lexer and parser syntax errors in Tao's voice                         | Reviewed: September 21 catch-up       | —                       |
| `42aee287` | 2026-09-20 | Harden developer workflows and semantic tooling                             | Reviewed: September 21 catch-up       | —                       |
| `354ff40b` | 2026-09-20 | Keep a merge message an author wrote unless asked to redraft it             | Reviewed: September 21 catch-up       | —                       |
| `1c331090` | 2026-09-20 | Give the machine a reclaim command and resolve DEVENV-099                   | Reviewed: September 21 catch-up       | —                       |
| `7b662f08` | 2026-09-20 | Require approval before any agent-to-agent message                          | Reviewed: September 21 catch-up       | —                       |
| `9d98ddfc` | 2026-09-20 | Add real-host development and testing controls                              | Reviewed: September 21 catch-up       | —                       |
| `60b45579` | 2026-09-20 | Make agent setup and landing reliable                                       | Reviewed: September 21 catch-up       | —                       |
| `5758cd04` | 2026-09-20 | Finish finalize redraft and record developer-environment evidence           | Reviewed: September 21 catch-up       | —                       |
| `08f9b1c9` | 2026-09-20 | Record the license direction and the decision to publish everything         | Reviewed: September 21 catch-up       | —                       |
| `67626a51` | 2026-09-20 | Shrink what an agent carries, by measurement and by enforcement             | Reviewed: September 21 catch-up       | —                       |
| `4dc504e5` | 2026-09-20 | Name developer-environment entries after their titles, not numbers          | Reviewed: September 21 catch-up       | —                       |
| `74aca7d4` | 2026-09-20 | Add recurring repository pass workflow                                      | Reviewed: September 21 catch-up       | —                       |
| `2239d989` | 2026-09-21 | Answer three questions an agent otherwise has to guess at                   | Reviewed: September 21 catch-up       | —                       |
| `6b893321` | 2026-09-21 | Stop compensating for measurements that were never accurate                 | Reviewed: September 21 catch-up       | —                       |
| `eabe05bc` | 2026-09-21 | Let a landing run as one reviewed unit, and check its message early         | Reviewed: September 21 catch-up       | —                       |
| `0702700c` | 2026-09-21 | Refuse what a warning arrives too late to prevent                           | Reviewed: September 21 catch-up       | —                       |
| `01e52f68` | 2026-09-21 | Budget instruction files by what an agent carries                           | Reviewed: September 21 catch-up       | —                       |
| `f448c5f2` | 2026-09-21 | Write down the instruction-file rules, and cut what hooks enforce           | Reviewed: September 21 catch-up       | —                       |
| `7f4509d0` | 2026-09-21 | Build every runtime element through TR.createElement                        | Reviewed: September 21 catch-up       | —                       |
| `11262a10` | 2026-09-21 | Record no duration where none can be attributed                             | Reviewed: September 21 catch-up       | —                       |
| `717c2385` | 2026-09-21 | Give a sandbox-denied fix somewhere to go                                   | Reviewed: September 21 catch-up       | —                       |
| `5e352643` | 2026-09-21 | Wait for the lane's refused admission, not for twenty turns                 | Reviewed: September 21 catch-up       | —                       |
| `c2166705` | 2026-09-21 | Measure lane admission instead of asserting it                              | Reviewed: findings P2                 | Landing, governance     |
| `2bc90866` | 2026-09-21 | Group packages by role; fold workspace and code-editor into owners          | Reviewed: finding P2                  | Package boundaries      |
| `0500269b` | 2026-09-21 | Point agents at narrow gates and record what makes the wide ones slow       | Reviewed: no surviving finding        | Landing, governance     |
| `d660cc43` | 2026-09-21 | Review repository changes through 5e352643                                  | Reviewed: no surviving finding        | Landing, governance     |
| `08957c44` | 2026-09-21 | Extract cli-kit and verification from the dev package                       | Reviewed: no surviving finding        | Package boundaries      |
| `91fffc4b` | 2026-09-21 | Stop the verdict caches hashing tooling, and say when sharding is lost      | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `6b6df32b` | 2026-09-21 | Move the Expo dev loop into expo-host and Studio's tooling beside Studio    | Reviewed: no surviving finding        | Package boundaries      |
| `93cc258f` | 2026-09-21 | Stop the narrow lane compiling every app for one language edit              | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `bfa09d9d` | 2026-09-21 | Stop import resolution asking the file system per reference                 | Reviewed: finding P2                  | Language, data, runtime |
| `dd7eaac7` | 2026-09-21 | Re-measure the two lane entries the import-resolution fix overtook          | Reviewed: finding P3                  | Landing, governance     |
| `4ed0ecca` | 2026-09-21 | Split what remained of the dev package into dev-cli and agent-cli           | Reviewed: no surviving finding        | Package boundaries      |
| `f9a05977` | 2026-09-21 | Remember what each use statement resolves to                                | Reviewed: no surviving finding        | Language, data, runtime |
| `ded7d78c` | 2026-09-21 | Scope the last three references Langium's default scope still answered      | Reviewed: no surviving finding        | Language, data, runtime |
| `22ea66d4` | 2026-09-21 | Insets on every surface, tao test --watch, and Studio simulation proof      | Reviewed: later completed             | Language, data, runtime |
| `7301ad22` | 2026-09-21 | Give every ./agent command a bounded report, a log, and named failures      | Reviewed: finding P2                  | CLI, workspace, tests   |
| `f48e80ec` | 2026-09-21 | Build a workspace once per command, and hold Jest's config still            | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `9c048a99` | 2026-09-21 | Record Tao CLI workflow decisions                                           | Reviewed: no surviving finding        | Standalone, publication |
| `31d2f9e7` | 2026-09-21 | Archive repository simplification 2 and plan Studio as a Tao app            | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `99baa8ae` | 2026-09-21 | Gate Studio's network simulation, and record two inset decisions            | Reviewed: no surviving finding        | Studio, Companion       |
| `f145eaf1` | 2026-09-21 | Record that a landing snapshots main before waiting for the lock            | Reviewed: later fixed; stale ledger   | Landing, governance     |
| `9cfef39f` | 2026-09-21 | Update dependency advisories and detect stale installed links               | Reviewed: advisory remains open       | Standalone, publication |
| `17b43ce6` | 2026-09-21 | Ship Tao skills with newly created projects                                 | Reviewed: no surviving finding        | Standalone, publication |
| `375e0db2` | 2026-09-21 | Keep worktree session setup quiet on success                                | Reviewed: no surviving finding        | Landing, governance     |
| `cd0a2b34` | 2026-09-21 | Read landed archive refs through the landing broker                         | Reviewed: no surviving finding        | Landing, governance     |
| `1d46e1e3` | 2026-09-21 | Give the language-service bench budgets it fails on                         | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `8f2b05dd` | 2026-09-21 | Record Tao CLI implementation sequence                                      | Reviewed: no surviving finding        | Standalone, publication |
| `7e3007db` | 2026-09-21 | Record the ask scrim and sheet-overlay findings from the simulator          | Reviewed: later completed             | Studio, Companion       |
| `9af4dc70` | 2026-09-21 | Make Studio's client a Tao app, and give InstantDB a provider package       | Reviewed: no surviving finding        | Studio, Companion       |
| `975e0372` | 2026-09-21 | Record DEVENV-015 host proof and bounded operator lane                      | Reviewed: no surviving finding        | Studio, Companion       |
| `ab2ad0be` | 2026-09-21 | Add Studio controls for Companion captures and device logs                  | Reviewed: no surviving finding        | Studio, Companion       |
| `4e6eff33` | 2026-09-21 | Start standalone project-local Tao dev sessions                             | Reviewed: finding P2                  | Standalone, publication |
| `1a04f80a` | 2026-09-21 | Draw asks in the window layer; inset split panes and inline navs once       | Reviewed: later completed             | Language, data, runtime |
| `862b53d6` | 2026-09-22 | Give every test wait a busy host's budget, and lint the short ones          | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `a7a0fc0d` | 2026-09-22 | Store compiled test apps by their contents                                  | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `9ea077af` | 2026-09-22 | Close out the second simplification pass                                    | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `33cd2103` | 2026-09-22 | Ask Git once when opening a workspace                                       | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `eaf6af68` | 2026-09-22 | Add Studio Lens causal render diagnostics                                   | Reviewed: finding P2                  | Studio, Companion       |
| `57ddb378` | 2026-09-22 | Add reactive parameters and durable document editing                        | Reviewed: no surviving finding        | Language, data, runtime |
| `7f32eae2` | 2026-09-22 | Add standalone Tao web and desktop build artifacts                          | Reviewed: findings P1, P3             | Standalone, publication |
| `0f678876` | 2026-09-22 | Allow approved landing commands to run with host access                     | Reviewed: findings P1                 | Landing, governance     |
| `fa097334` | 2026-09-22 | Record first-public-release decisions                                       | Reviewed: no surviving finding        | Standalone, publication |
| `c41a1d93` | 2026-09-22 | Speed up verification sharding and Tao app tests                            | Reviewed: no surviving finding        | CLI, workspace, tests   |
| `472e3045` | 2026-09-22 | Add header style clauses, private roots, and `none` clearing to views       | Reviewed: no surviving finding        | Language, data, runtime |
| `8840e420` | 2026-09-22 | Implement Studio preview revision and restart policy                        | Reviewed: finding P1                  | Studio, Companion       |
| `6d16ca7b` | 2026-09-22 | Bootstrap standalone Tao CLI binary with Bun 1.4.2                          | Reviewed: existing DEVENV issue       | Standalone, publication |
| `b1348b1d` | 2026-09-22 | Recommend compaction only after substantial context use                     | Reviewed: no surviving finding        | Landing, governance     |
| `8987ce21` | 2026-09-22 | Host sheet-presented entries in the sheet; frame every split pane           | Reviewed: no surviving finding        | Language, data, runtime |
| `530f4844` | 2026-09-22 | Exercise landing after test-cache and permission recovery                   | Reviewed: findings P1, P2             | Landing, governance     |
| `a14ac0fa` | 2026-09-22 | Queue ready landings before locked verification                             | Reviewed: finding P3                  | Landing, governance     |
| `a3657cd0` | 2026-09-22 | Defer Studio companion Slice 4 until after public MVP                       | Reviewed: no surviving finding        | Studio, Companion       |
| `976c137c` | 2026-09-22 | Print decision rounds as text, never through a question prompt              | Reviewed: no surviving finding        | Landing, governance     |
| `85f81aee` | 2026-09-22 | Add the root README and apply the publication-hygiene fixes                 | Reviewed: no surviving finding        | Standalone, publication |
| `f133680d` | 2026-09-22 | Add the pre-publication rotation to-do to R2                                | Reviewed: no surviving finding        | Standalone, publication |
| `2de16941` | 2026-09-22 | Retire Expo Go from the phone lane; ready the Companion and PR checks       | Reviewed: no surviving finding        | Studio, Companion       |
| `8c0f2210` | 2026-09-22 | Deprecate bg/fg and the flat design catalog                                 | Reviewed: staged migration            | Language, data, runtime |
| `1c487a7c` | 2026-09-22 | Standalone tao binary unpacks its resources, then creates and compiles      | Reviewed: no surviving finding        | Standalone, publication |
| `3a99875e` | 2026-09-22 | Open emulator apps in a prebuilt Tao Companion instead of Expo Go           | Reviewed: no surviving finding        | Studio, Companion       |
| `7d352956` | 2026-09-22 | Record that the Android emulator cannot start in the sandbox                | Reviewed: no surviving finding        | Studio, Companion       |
| `ebe58ba0` | 2026-09-22 | Absorb the reactive-editing tranche at its implemented boundary             | Reviewed: no surviving finding        | Language, data, runtime |
| `c762839b` | 2026-09-22 | Trust landing host probes over inherited sandbox markers                    | Reviewed: no surviving finding        | Landing, governance     |
| `ff4f017c` | 2026-09-22 | Route WordFlower sync demo to Instant Cloud                                 | Reviewed: no surviving finding        | Language, data, runtime |

## Ranked candidates and cluster reviews

All 61 candidates received a first-parent diff review and a trace to the frozen current tree. The order below is the final review priority order, highest first within each band. The commit ledger names the reviewer cluster and the outcome for every commit; related changes stayed with one reviewer so the same package, runtime, or workflow context could be reused. The four issue bands rank surviving findings and tracked follow-up ahead of broad changes with no surviving finding.

| Rank  | Importance                              | Candidates, in priority order                                                                                                                                                                                                                                                                  | Result                                                                                                                            |
| ----- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1–4   | Immediate                               | `7f32eae2`, `0f678876`, `8840e420`, `530f4844`                                                                                                                                                                                                                                                 | Web artifact path traversal, unsandboxed message-file access, blocked Studio Saves, and an unverified landing path.               |
| 5–11  | High                                    | `c2166705`, `2bc90866`, `bfa09d9d`, `eaf6af68`, `7301ad22`, `6d16ca7b`, `4e6eff33`                                                                                                                                                                                                             | Reproducible tooling, native discovery, package-boundary, Lens, and workflow defects.                                             |
| 12–15 | Follow-up                               | `dd7eaac7`, `a14ac0fa`, `f145eaf1`, `9cfef39f`                                                                                                                                                                                                                                                 | Stale or truncated ledger state and the already-tracked `uuid` advisory. `f145eaf1`'s functional race was repaired by `a14ac0fa`. |
| 16–39 | Wide code changes, no surviving finding | `57ddb378`, `9af4dc70`, `472e3045`, `8987ce21`, `1a04f80a`, `22ea66d4`, `ff4f017c`, `3a99875e`, `2de16941`, `ab2ad0be`, `8c0f2210`, `f9a05977`, `ded7d78c`, `a7a0fc0d`, `c41a1d93`, `f48e80ec`, `33cd2103`, `1c487a7c`, `08957c44`, `6b6df32b`, `4ed0ecca`, `91fffc4b`, `93cc258f`, `862b53d6` | Language/runtime, Studio, standalone, package structure, and test infrastructure reviewed against current code and focused tests. |
| 40–61 | Bounded changes, no surviving finding   | `85f81aee`, `17b43ce6`, `f133680d`, `fa097334`, `8f2b05dd`, `9c048a99`, `99baa8ae`, `975e0372`, `7d352956`, `a3657cd0`, `7e3007db`, `ebe58ba0`, `375e0db2`, `cd0a2b34`, `0500269b`, `976c137c`, `b1348b1d`, `d660cc43`, `c762839b`, `31d2f9e7`, `1d46e1e3`, `9ea077af`                         | Narrow documentation, measurement, and workflow slices; later changes were considered before declaring an issue surviving.        |

## Surviving findings

The findings below are review results, not fixes in this pass. Every cited current-tree seam was independently checked against the frozen `ff4f017c` tree. An external host or device run was not used to claim acceptance.

| Priority | Landing                | Current-tree evidence and consequence                                                                                                                                                                                                                                                                                        | Smallest repair and proof                                                                                                                                                                                                        |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | `7f32eae2`             | `packages/cli/tao-cli/cli-src/build-command.ts:368–374` generates a server that binds Bun's default `0.0.0.0`, decodes once, checks only literal `..`, then constructs a file URL. `/%252e%252e/secret` passes that check and resolves outside `site/`; a repeated segment reaches `/etc/hosts` in the local URL/file probe. | Bind loopback, reject malformed encodings, resolve the final file path and enforce physical containment under `site/`; test double-encoded traversal. [Bun documents its default host](https://bun.sh/docs/runtime/http/server). |
| P1       | `0f678876`             | `.rulesync/permissions.jsonc` grants `./agent land …` host access, while `packages/cli/dev-cli/dev-cli-src/dev.ts:163–186` forwards any `--message-file`. `Finalize.ts:374–410,848–850` reads and can overwrite that path with `--redraft` before the landing lock.                                                          | Restrict the agent landing message to the resolved `.artifacts/merge/<branch>.msg` path before any read or write; test absolute and symlinked escape paths.                                                                      |
| P1       | `8840e420`             | `StudioPhoneSaveGate.ts:77–100` starts its timeout only after disconnection; a connected device behind the compiled revision resets the timer forever. A failed render deliberately withholds `device.applied`, so the next Save waits indefinitely.                                                                         | Apply one deadline from the start of the wait and release the pending Save as unsynced at expiry; test a permanently connected device whose revision never advances.                                                             |
| P1       | `530f4844`             | `dev.ts:165–186` exposes `--skip-verify-full --skip-verify` together through `./agent land`. `MergeWithMain.ts:1099–1118` then lands bytes with no verification lane, while only `--skip-all` asks for interactive confirmation.                                                                                             | Reject the combined skip flags on the agent landing surface; pin a noninteractive test for the two-flag combination.                                                                                                             |
| P2       | `530f4844`             | `Finalize.ts:250–262` records a just-generated `DRAFT:` message as current for HEAD. A later `land` accepts that untouched message via `keptMessageReason` at `:865–878`.                                                                                                                                                    | Require an author edit to a generated draft before landing; test `finalize`, no edit, then `land`. The underlying draft-state behavior predates this window but survived this landing.                                           |
| P2       | `c2166705`             | `admission-experiment.ts:214–264` reads `latest/summary.json` even when the new lane command fails before publishing; no run identity or freshness check separates the prior result.                                                                                                                                         | Require a new matching summary for each run and treat failure before publication as unmeasured/failed; test a failed later repeat after a passing one.                                                                           |
| P2       | `c2166705`             | `admission-worktrees.ts:54–75` discards the leftovers returned by cleanup when provisioning fails, so an incompletely removed checkout can be omitted from the error.                                                                                                                                                        | Combine the setup failure with every cleanup failure and leftover path; test partial setup followed by failed removal.                                                                                                           |
| P2       | `2bc90866`             | `NativeModuleCheck.ts:225–240` searches only `packages/<name>/ios`; the sole podspec is now `packages/providers/icloud/ios/TaoICloudNative.podspec`, so native module proof stops at line 114 with none found.                                                                                                               | Discover actual package roots through `PackageGraph` and test the grouped path.                                                                                                                                                  |
| P2       | `bfa09d9d`             | `Packages.ts:632–654` caches successful `realpath` results for a whole context. Retargeting an in-package symlink outside leaves `targetMatches` true until the context is rebuilt; the current-code probe returned true after retarget and false in a fresh context.                                                        | Invalidate candidate realpaths on document update/build while retaining per-build caching; test a retargeted symlink.                                                                                                            |
| P2       | `eaf6af68`             | `StudioDeviceGateway.ts:1023–1026` retains device Lens samples per session across `#assign`, and `StudioLensProjection.ts:28–32` filters by source version and render range but not cell. A timing sample from cell A appears when cell B renders the same source.                                                           | Clear samples on assignment identity change or store and filter cell identity; test switching scenarios with the same render span.                                                                                               |
| P2       | `7301ad22`             | `agent:41–49` rebuilds the bundled agent for changes to `RunWithCommands.ts`, but the new agent CLI imports `cli-kit/OutputText.ts`. Editing that dependency alone leaves the old `.artifacts/build/agent-dev/agent-dev.js` running.                                                                                         | Include all `cli-kit-src/**/*.ts` in the bootstrap freshness check; test a changed imported helper.                                                                                                                              |
| P2       | `6d16ca7b`             | `RepositoryDoctor.ts:25` accepts Bun `>=1.3.0`, while `standalone-build.ts:22` requires 1.4.2 for macOS binary output. The existing doctor ledger entry already tracks this mismatch.                                                                                                                                        | Share the standalone minimum/pin with doctor, or have doctor report capability-specific limitations.                                                                                                                             |
| P2       | `4e6eff33`             | The shipped `tao-run-and-ship/SKILL.md:10–13` says bare `tao dev` opens Expo targets, while current CLI help says it opens none unless `--ios`, `--android`, `--web`, or `--desktop` is supplied.                                                                                                                            | Correct the skill source and regenerate starter copies.                                                                                                                                                                          |
| P3       | `dd7eaac7`             | `repo-lint.ts:1208–1214` captures only the first physical line of a `Status` field; two generated ledger-index descriptions now end mid-sentence.                                                                                                                                                                            | Keep statuses to one line and move detail to evidence/update fields; reject multiline statuses in lint.                                                                                                                          |
| P3       | `a14ac0fa`, `f145eaf1` | The queued-landing main refresh now satisfies `DEVENV-LANDING-SNAPSHOTS-MAIN-BEFORE-WAITING-FOR-THE-LOCK.md` acceptance, yet that entry and its index remain Candidate.                                                                                                                                                      | Archive the resolved entry and regenerate both indexes after checking its remaining message-confirmation clause.                                                                                                                 |
| P3       | `7f32eae2`             | `Docs/Roadmap/Tao CLI workflows/Decisions - Development build ship and clean.md:3` still says the landed web/desktop build and clean work is pending integration.                                                                                                                                                            | Mark implementation landed while retaining external acceptance limits.                                                                                                                                                           |

## Remediation on this review branch

The initial findings above describe the frozen `main` tree. This branch subsequently changed the
four P1 paths and the P2 correctness paths: the generated web server now confines decoded file
requests to its site and binds to loopback; landing restricts the message path, rejects both silent
verification skips, and requires an edit to a generated draft; Studio Save has a deadline; admission
results cannot reuse a prior summary and cleanup reports leftover worktrees; native podspec discovery,
package-path cache invalidation, Lens assignment isolation, bootstrap freshness, doctor Bun minimum,
and the shipped `tao dev` skill have focused regressions. The two wrapped ledger statuses and stale
CLI workflow status were corrected; the queued-landing entry was archived after its existing
lock-wait regression was rechecked. These changes are on `feat/recurring-review-2026-09-22`, not
landed on `main` by this report.

Normal host-test runs now record ownership and results, prune this checkout at startup and finish,
retain a bounded set of failed runs, and remove generated builds/exports after successful proofs.
Explicit `prepare` and `export` outputs remain inspectable within the same age and byte budget.
Focused lifecycle controls, host typecheck, and a real Clockwork `prepare` run passed; real browser
or native proof cleanup has not been exercised. Older unmarked directories in another worktree and
the machine-wide Jest cache were left untouched because their ownership/liveness and separate
retention policy still need resolution. The tracked `uuid` advisory remains open.

## Temporary state and dependency checks

- **Host-testing output:** A read-only size inventory found about 31 GB across 234 `.artifacts/host-testing/<run-id>` directories in one worktree. The oldest and newest top-level modification times observed were September 19 and 20. `HostTestingCommand.runHostTesting` creates a unique root per invocation and has no finish or later-run retention path; generated app builds and web exports live beneath it. [DEVENV-HOST-TEST-ARTIFACTS-ACCUMULATE-WITHOUT-BOUND](<Developer environment upgrades/DEVENV-HOST-TEST-ARTIFACTS-ACCUMULATE-WITHOUT-BOUND.md>) records a normal-operation lifecycle fix. The worktree may still belong to another active task; nothing was removed.
- **Jest:** `$TMPDIR/jest_dx` occupied about 2.1 GB on September 23. The existing [DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND](<Developer environment upgrades/DEVENV-JEST-TRANSFORM-CACHE-GROWS-WITHOUT-BOUND.md>) already owns the missing bound and proposes a repository-owned cache directory with age-based retirement. Its size is current evidence, not a second ledger issue.
- **Other roots:** `$TMPDIR/tao-test-runs` occupied about 115 MB over four identity directories; `.android/avd` in the large worktree occupied about 4.2 GB. These warrant owner/liveness checks before any cleanup. User and vendor caches were measured only to locate buildup, not claimed as Tao-owned output.
- **Bun/npm:** `bun audit` against frozen `bun.lock` reported one moderate [`uuid` buffer-bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq). The [dependency advisory follow-up](<Dependency advisory follow-up.md>) records the prior call-site analysis and a September 28 review date. This pass made no dependency change and did not close the advisory.
- **Nixpkgs:** `devenv.lock` still pins `nixpkgs-src` at `73c703c22422b8951895a960959dbbaca7296492`; its [glibc derivation](https://raw.githubusercontent.com/NixOS/nixpkgs/73c703c22422b8951895a960959dbbaca7296492/pkgs/development/libraries/glibc/common.nix) uses 2.42-61. The [Nixpkgs security tracker](https://tracker.security.nixos.org/) and later upstream patch remain the primary comparison sources. No fresh Linux closure or host acceptance was obtained, so the existing follow-up remains open.

## Coverage and next actions

- **Complete within the chosen boundary:** 142 first-parent landings were accounted for; the prior independent audit covers 7, the Developer accepted the 74-commit catch-up handoff as reviewed, and this pass reviewed the remaining 61. The five specialist clusters and the CLI/workspace/test cluster inspected historical diffs and traced their touched behavior into frozen `ff4f017c`. Findings were rechecked against current paths before inclusion. The commit ledger retains a disposition for every landing.
- **Static review limits:** No broad gate, CocoaPods/Xcode build, physical phone or emulator, packaged Studio run, signed/notarized installation, Linux closure, real CloudKit/InstantDB external acceptance, marketplace publication, or end-to-end generated web-server run was performed. The path-traversal URL/file behavior and symlink retargeting were reproduced in focused local probes; the report does not treat those as host acceptance.
- **Next repair slice:** The remediation section records fixes made after this initial review; `verify-changed` and `verify --complete` passed on the repair tree. Review the merge message before any authorized landing. The Jest cache and older unmarked host-test roots remain separate lifecycle work.
- **Boundary for the next recurring pass:** start after `ff4f017ceb100c39c7d55bec8c228ef967097be4`, inspect these findings' repair commits, and revisit the tracked `uuid`/Nixpkgs advisories and temporary-state budgets. Do not infer any external acceptance from this static pass.

## September 24 continuation — main through `c4b627440f98508977bd2c4a8b6ef5860c4d6ffc`

The earlier boundary is confirmed by first-parent ancestry and counts: 142 landings in the
September 7–22 window, including 61 after the accepted `5e352643` catch-up, through
`ff4f017ceb100c39c7d55bec8c228ef967097be4`. This continuation reviewed the 20 newer
first-parent landings once each against the current `main` tree. Four distinct read-only
review units covered host operations, temporary state, release/device/dependencies, and
Studio/runtime; different reviewers challenged the surviving findings. The September 7–22
commit reviews above were not repeated.

| Landing | Disposition against `c4b62744` |
| --- | --- |
| `1c073062` | Release checklist accepted; later domain decision refined its identifier inventory. |
| `482ffec8` | Prebuilt-host download accepted functionally; artifact authenticity remains a prepublication concern. |
| `174e49a5` | File-watching placement accepted; its temporary removal of tracked Codex config was fixed by `0080044c`. |
| `62d25e81` | Simulator Companion route accepted; simulator proof does not cover a physical installation. |
| `24dc2360` | Standalone CLI release preparation accepted; unsigned install remains prepublication work. |
| `e0814ac1` | Landing-friction record accepted; missing-config portion later consolidated by `e667b5a9`. |
| `e667b5a9` | Deduplication accepted when landed; `0080044c` later left two now-stale active entries. |
| `17e51655` | Physical-iPhone hosted-sync acceptance accepted as development-build evidence, not distribution proof. |
| `0080044c` | Tracked Codex config repairs the fresh-worktree failure; two ledger entries need archival after clean integration proof. |
| `a1cdad93` | Host landing accepted apart from a conditional inherited-sandbox-marker rejection. |
| `0b4b8052` | Host wrapper accepted; later named-target dispatch in `f4c8114d` supersedes raw passthrough. |
| `7a74afbf` | Per-identity Jest cache bound accepted; aggregate identities and direct-Jest fallback remain unbounded. |
| `4cd16848` | Temporary-state review requirement accepted; this pass records the specific roots it exposed. |
| `f4c8114d` | Named host operations accepted; the wrapper retains the marker rejection from `a1cdad93`. |
| `533f7fa1` | Studio delay proof accepted; loading now precedes the latency assertion. |
| `c098cb17` | Studio/IDE release preparation accepted; account, signing, marketplace and installed-product gates remain external. |
| `2e9414bc` | `devtao.com` identifier move accepted; account/domain registration remains external. |
| `24eb8d4a` | Release fixture name matches the new bundle identifier; no surviving finding. |
| `cdcefefc` | Pagination and early exit handling work, but the fixed append-only emulator log can give a prior launch's reason. Five pages is a documented discovery limit, not proof every compatible host is reachable. |
| `c4b62744` | Named CocoaPods dispatch gains the UTF-8 locale, but direct native-module-check and ship paths omitted it; this branch repairs both. Simulator-host pod install is not full device acceptance. |

### Pending September repair recheck

Every repair recorded above remains applicable at `c4b62744`; none was superseded by a
newer main fix. The branch's proposed repairs were checked against current source and
their focused regressions. Main integration must retain the later named host dispatch
alongside the branch's agent bootstrap change.

| Original finding | Disposition on the review branch |
| --- | --- |
| Web-server traversal and bind exposure | Containment and loopback repair valid; this continuation removes its test's port race. |
| Alternate landing message paths | Restricted path repair valid. |
| Connected phone Save can wait forever | Absolute deadline repair valid. |
| Combined verification-skip flags | Rejection repair valid. |
| Untouched generated landing draft | Author-edit requirement valid. |
| Admission reuses a prior summary | Fresh-run check valid; this continuation also rejects failed current runs and baselines. |
| Admission provisioning loses cleanup leftovers | Error and leftover preservation valid. |
| Native podspec discovery misses grouped packages | Functional repair valid; helper duplication with `PackageGraph` is a later consolidation option. |
| Cached package realpath survives symlink retarget | Build/update invalidation repair valid. |
| Studio Lens samples cross assigned cells | Assignment identity reset repair valid. |
| Agent bootstrap misses `cli-kit` imports | Full source-glob repair valid; preserve it when merging named host dispatch. |
| Doctor accepts Bun below standalone minimum | Immediate 1.4.2 repair valid; shared-pin drift remains tracked. |
| Shipped skill misstates bare `tao dev` | Source and starter-copy correction valid. |
| Ledger status truncation | Single-line status and lint repair valid. |
| Queued-landing entry remains active | Archive valid; this continuation restores its date and current command guidance. |
| CLI build/clean status is stale | Landed-status correction valid. |

### Findings, evidence, and disposition

- **Measured temporary state:** On September 24, two read-only snapshots of
  `~/.cache/tao/jest-transform-cache` found 574–618 identity directories and 2.14–2.21 GiB;
  `jest-standalone` held about 1.18–1.19 GiB in ten identities. The managed implementation
  enforces 25,000 files/256 MiB only inside one runtime-path identity and has no parent-level
  retirement; direct Jest chooses a persistent path without entering that lifecycle. Those are
  confirmed P2 lifecycle gaps, not measured growth rates. The legacy shared `$TMPDIR/jest_dx`
  held 13.03 GiB/760,998 files, and `$TMPDIR/tao-test-runs` 763 MiB/137,778 files; neither
  owner nor safe deletion was established. No shared state was removed.
- **Measured host artifacts:** A separate worktree still held 31.3 GiB across 234 old
  receipt-less host-test directories. Current `main` has no ordinary cleanup; the prior review
  branch supplies receipt-based retention. A challenged interruption window on that branch
  allowed allocation before receipt publication. This continuation publishes an independent
  receipt first, treats it as authoritative across an interrupted local update, and lets
  pruning recover an interrupted partial allocation. The focused host controls passed.
  Old receipt-less directories were preserved for owner review.
- **Conditional host operation defect:** `agent:47` rejects a nonempty inherited
  `CODEX_SANDBOX` even when the host process probe is available, contrary to the landing
  contract. The default host path here cleared the marker and worked; a focused entrypoint
  regression proved the branch repair with a successful probe and retained marker. Failure
  on a host runner that retains the marker is inferred, not observed on this default path.
- **Repair quality:** A web-server containment test released a selected port before Bun could
  bind it. The test now starts the generated server with `PORT=0` and reads its bound port;
  it failed against the previous generator and passed after the change. The prior admission
  experiment repair also missed a nonzero lane outcome that wrote a fresh summary without
  failed gates and a failed baseline; focused regressions failed before the correction and
  passed after it. The prior queued-landing archive now has its required final `Archived`
  field and current command guidance.
- **New main landing:** `cdcefefc` improves release discovery and ends a newly started
  emulator's boot wait when its process exits. Its fixed `$TMPDIR/tao-android-emulator.log`
  is opened for append, and the diagnostic searches all lines for `Incompatible processor`.
  A later launch can therefore report an earlier launch's processor failure. This is a
  source-confirmed P2 diagnostic error, not a measured second launch; use a per-launch log
  with bounded cleanup after integration. The five-page release search cap is an explicit
  request-budget limit; no compatible host beyond that cap was observed. `c4b62744` passes
  UTF-8 locale variables through named CocoaPods dispatch without dropping inherited `PATH`,
  but the direct pod invocations in native-module-check and `tao ship` still lacked them.
  This branch now supplies the same locale on those paths; both focused regressions failed
  before the correction and passed after it. No live direct-pod host run was performed.
- **Release authenticity:** The standalone installer fetches executable and checksum from
  one mutable release before execution; prebuilt Companion download trusts an unsigned
  compatibility manifest and byte count, while publication permits asset replacement.
  Independent review confirmed both as prepublication trust gaps. No public release or live
  download was exercised, and implementing an immutable trust anchor requires a release
  decision and signing inputs. Signing, notarization, store/marketplace publication, Linux
  closure, and installed-binary acceptance remain external.
- **Dependencies:** A fresh `bun audit` reported the existing moderate `uuid@7.0.3`
  advisory through Expo's `xcode@3.0.1`; source review still found only an unaffected `v4()`
  call in that parent. The [advisory register](<Dependency advisory follow-up.md>) remains
  open for September 28. The pinned Nixpkgs glibc input still lacks a fresh Linux closure
  and upstream-patch comparison. No manifest, version, or lockfile was changed.

### Integration state

The new review branch was created at the prior review tip `98a82c8a`. Its checkout switch
could not replace protected `.codex/rules/tao.rules`, leaving that generated file dirty.
A read-only merge preview names three document conflicts in the two developer-environment
indexes and this recurring-pass handoff. The original review worktree, its index, and branch
were untouched. Source fixes in this continuation have focused proof, but main integration,
the full landing gate, and a landed archive ref are not yet established. The protected-path
write needs a Developer-approved host operation before the branch can be made clean and landed.
