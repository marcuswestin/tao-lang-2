# October 7 afternoon repository health review

## Boundary and method

Reviewed the five first-parent landings after `a198e71b6` through `fe7a4da74`, skipping
`c4b48ea1b`, which was the morning pass. The Developer approved the plan, the isolation checks,
and a closing decision round. Two read-only reviewers covered the landings: one for CI and
verification, one for process lifecycle and the iOS runtime. Health checks and the temp-state
inventory were run directly. Fixes are on `feat/repository-pass-2026-10-07-b`; the pass's code
commit is `63e027607`.

## Findings and disposition

| ID | Finding                                                                                                                                                                                                                                                                                                                                                                                                         | Disposition                                                                                                                                                                                                                                                                                  |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 | Hosted Verify has skipped the fixers since `9c128d74d`, on the grounds that `_dprint-check` and `_tao-check` catch the same defects. Neither gate is in `VERIFY_FULL_GATES` (`Justfile:18`), so neither ran on hosted Verify. Unformatted TypeScript, JSON, Markdown, Justfile or `.tao` files passed there. The runner test named the check gates in its own lane, so it could not catch this.                 | Fixed: each fixer declares a `checkedBy` gate, and `GateCatalog.hostedLinuxGates` adds it to a hosted partition's lane. The runner test now passes only the fixers. A new test reads the real `VERIFY_FULL_GATES`. The workflow comment and the hosted-verification reference are corrected. |
| V2 | `main`'s Verify was red on three of seven runs since the boundary. On `b08bbbfa3`, all 20 partitions refused a module-link symlink, because `9c128d74d` cached the WordFlower app without its manifest. The other two reds were `studio-metro-refresh` timing out on Chrome's DevTools port.                                                                                                                    | The cache defect was already fixed in `c4b48ea1b`. The timeouts are added to `DEVENV-HOSTED-CHROME-STARTUP-TIMES-OUT-BEFORE-DEVTOOLS`: five failures across three browser gates in two days, all before `fe7a4da74`'s stall snapshot landed.                                                 |
| D1 | Two parallel October 4 commits gave the Agent MVP Roadmap duplicate item IDs A20, A21 and A22, so documents citing "A22" pointed at two items.                                                                                                                                                                                                                                                                  | Fixed: the newer items are now A31, A32 and A33, and their citations follow. The QA result citing the light/dark A22 keeps its number. repo-lint now rejects a duplicate item ID in either MVP roadmap.                                                                                      |
| N1 | A missing maintained native-binding manifest printed its regeneration hint twice.                                                                                                                                                                                                                                                                                                                               | Fixed. The generator's identity changed, so the bindings were republished.                                                                                                                                                                                                                   |
| T1 | `tao test` removed its Jest resource directory only after a successful run (`test-command.ts`). On the same seam, the descendant refresh never drops dead PIDs, and a synchronous Bun helper runs on every poll.                                                                                                                                                                                                | Cleanup fixed: it now runs in a `finally`. The polling costs were not measured and are recorded only.                                                                                                                                                                                        |
| T2 | `tao test`'s 120 s idle-output bound (`test-command.ts:655`) can kill a run before Jest's deadlines fire, since those stretch under load to 300 s. The 3 s drain is fixed.                                                                                                                                                                                                                                      | Not observed failing. Recorded for the Developer, because the bound trades a hung run's cost against a slow run's.                                                                                                                                                                           |
| T3 | `waitForOwnedExit` in `CLI.ts` joins process trees without a bound (`ProcessTree.ts`).                                                                                                                                                                                                                                                                                                                          | Read from source and never observed hanging. Recorded only.                                                                                                                                                                                                                                  |
| T4 | The test process policy that `./agent test*`, `verify*`, `check` and `finalize` apply (`AgentRunner.ts`) may fail a run that leaves legitimate long-lived survivors, such as an adb server or an emulator.                                                                                                                                                                                                      | For the Developer: which survivors are legitimate is a policy choice.                                                                                                                                                                                                                        |
| U1 | `b08bbbfa3` changed what `./agent unsandboxed app-dev --ios` reaches. It now downloads Expo Go from Expo's CDN into the global Expo home and installs it on the simulator, and the Developer was not told. `processes stop` does not check that a process belongs to this repository. `contributor-macos-test` and `start-branch` have no `argsPolicy`, though the first validates its arguments in its script. | Reported to the Developer, who chose to keep the download and install. The `processes stop` check is open. The October 7 U1 and U2 are unchanged. The allowlist has 98 prefixes.                                                                                                             |
| E1 | `IosExpoGo.ts:44` fetches Expo's version metadata before comparing it with the installed Expo Go. A machine with the right Expo Go installed therefore cannot start an iOS dev loop offline.                                                                                                                                                                                                                    | Fixed after the Developer's approval: when the metadata fetch fails, the installed client opens. Without an installed client, the fetch error is still reported.                                                                                                                             |
| Q8 | The committed QA dashboard, packet, capabilities and inventory are stale against HEAD. Regenerating them with `qa report` produces a 613/449-line diff. The six tutorial observations still read needs-recheck.                                                                                                                                                                                                 | Not rechecked or regenerated. Under Q7, any later code change makes a fresh recheck stale again, so a recheck is worth doing only after the renderer-hash decision.                                                                                                                          |
| K4 | New developer-command overlaps: `merge-main`, `my-sync` and `sync-main` all bring `main` in; `my-land` is an alias of `land`; four `studio-*` recipes are `studio-smoke` with a fixed file.                                                                                                                                                                                                                     | Listed for the Developer, together with the October 7 K2 and K3, all of which remain. Correction to K2: `Apps/Test Apps/Auth Review` uses Convex and Pylon.                                                                                                                                  |

`776a84ed8`'s process-teardown changes are T1, T3 and T4. `5a2ba4b6c` (README command tables)
and `fe7a4da74` (the hosted Chrome stall snapshot) had no defects; every command the README names
exists.

## Decisions

The closing decision round settled six items; the Developer took every recommendation.

- **A. Docker memory.** The Developer raises it to 16 GB. Docker was stopped when the pass ended, so the Ubuntu check did not run.
- **B. Expo Go download.** `app-dev --ios` keeps downloading and installing the SDK-matched client (U1).
- **C. Offline fallback.** Done in this pass (E1).
- **D. Remote heads.** The Developer deleted the six heads already in `main`. No repository command deletes remote branches.
- **E. `land-fix` gates.** `land-fix` now runs `_parser-gen`, `_compile-word-flower-app`, `_repo-lint`, `_typecheck` and `_test-changed` after the conflict check and before it builds the commit. A failure stops it before anything is pushed. `DEVENV-LAND-FIX-PUSHES-UNGATED-PRE-SQUASH-COMMITS` is resolved and archived.
- **F. Tart provisioning.** The approved route was to copy the harness in after boot through the guest agent. It cannot work for the vanilla image, which has no guest agent: the agent itself has to be written to the stopped disk before boot, and the transport deliberately uses no SSH and no shared folders. `DEVENV-TART-PROVISIONING-REQUIRES-HOST-UID-501` lists the three routes that remain, and choosing one is the Developer's.

These change what unsandboxed operations do:

- `app-dev --ios` no longer fails offline when Expo Go is already installed.
- `land-fix` now runs `./dev gates` before it pushes.

## Health inventory

Allocated sizes come from `du -sk`. The machine had just been cleaned, with an uptime of about 80
minutes, so most figures fell.

| Location                      | October 7 morning | October 7 afternoon |
| ----------------------------- | ----------------: | ------------------: |
| Primary checkout `.artifacts` |          14.6 GiB |            1.56 GiB |
| `~/.codex/worktrees`          |         124.5 GiB |             3.8 GiB |
| `tao-lang.worktrees`          |                 — |             3.8 GiB |
| `tao-lang-2.worktrees`        |     about 116 GiB |              absent |
| Primary `.claude/worktrees`   |           9.0 GiB |              absent |
| Process records               |               920 |                   2 |

- **Caches and Tart.** Bun's cache is 3.5 GiB, `~/.cache` 2.0 GiB and `~/.tao` 0.48 GiB. Tart storage was empty, so the retained clones from October 7 are gone, and the crashed clone's Nix install log with them. `tao resources` warns "Legacy process inspection failed; partial".
- **Repository size.** Tracked blobs are 42.6 MB, up from 42.4 MB. The 32 files added since the boundary are all source, tests or docs. Packs total 35.1 MiB.
- **Tests.** There are no unconditional skips. This worktree has no recorded timings, so the slowest suites and flakes were not measured.
- **`main` and CI.** The median green hosted Verify took about 7–8 minutes, down from 9. One CI macOS run was cancelled. `land-fix` was not used.
- **Remote heads.** There are 449, up from 445. Six are contained in `main` and deletable: `dev/marcus`, `feat/companion-hosts-nightly`, `feat/september-remediation-backlog`, `feat/untitled-session-2866c7`, `feat/untitled-session-3c4023` and `feat/verify-admission`. Eleven hold unlanded work. Six of those have had no commit for over a week: `cloud-contributor-continuation`, `git-bug-issue-tracking`, `happy-noether-sjqmdo`, `kind-ramanujan-j4sw32`, `staged-release-qa` and `tao-debugger-poc`. Open pull requests were not listed.
- **Hook overrides.** None can be counted: no `hook-overrides.jsonl` survived the cleanup.
- **Dependencies.** `bun audit` matches the advisory record, and its October 20 review date has not passed. `marked`, `@pylonsync/sync` and `better-opn` still have no importer. The `@pylonsync/sync` declaration is in `packages/apps/providers/pylon`, not Studio tooling. The same five majors lag, 15 packages are a major or more behind, and `uuid` resolves to five versions. `dead-exports` passes.
- **Docs.** No links are broken across 508 files. `packages/AGENTS.md` is 6,786 characters against its 6,000 budget. The `delegation` skill is at 11,995 of 12,000 and `agent-coordinator` at 11,979 of 12,000. 83 package-README commands use `./agent` (D3).
- **Ledger.** 143 open entries, no duplicates, and none fixed but unarchived.

## Isolation acceptance

No macOS isolation check can run from this host account.

- **Vanilla installed-CLI acceptance.**
  - Run `tao-acceptance-1791402497-64188` at `63e027607` pulled `ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bf…` in 865 s.
  - Provisioning then failed after 15 s with `Guest admin ownership 501:20 differs from host 503:20.`
  - Provisioning writes into the stopped guest disk as the host user, so it works only from uid 501, and this account is 503: `DEVENV-TART-PROVISIONING-REQUIRES-HOST-UID-501`.
  - The prepared Xcode base and `contributor-macos-test` call the same `provision`, so they were not run.
  - The clone was removed. The vanilla base stays cached in Tart (27 GB on disk) for the next run.
  - Logs: `.artifacts/standalone-vm/tao-acceptance-1791402497-64188/logs`.
- **Ubuntu contributor.** Not run. Docker Desktop reports 7.75 GiB, and the check refuses below 16 GB.
- **`performance-check`.** Inconclusive. It ran at `63e027607` and took 306 s.
  - **Over budget:** check one-shot median 1.8 s against 1.7 s; check session median 1.5 s against 1.3 s.
  - **Within budget:** compile, format, and all six Studio preview cases. The HNReader editor padding edit has a warm p50 of 2.6–2.7 s.
  - **Host load:** load average 5–7 on 16 CPUs throughout, from Spotlight's first index of the freshly cleaned machine (`spotlightknowledged` and `knowledgeconstructiond`, about one core each).
  - Under the procedure, a busy host makes the result inconclusive. Rerun the same code once indexing settles.
  - Evidence: `.artifacts/performance/performance-899b195d-fb8f-4c90-90fe-759782b262a3/summary.json`.
- **Retained resources.** The cached vanilla base image, which is reusable. Nothing else from this pass.

## Routing and advisories

`./agent model-audit` found no mismatch. Anthropic's pricing page now lists Haiku 5.5 at $0.10
input and $0.50 output per million tokens, rising to $0.50 and $2.50 for prompts over 100K tokens.
That is down from $1 and $5, and it makes fast-tier sweeps nearly free. The other prices are
unchanged: frontier $10/$50, Opus $4/$20, Sonnet $2/$10. The page's table gives Sonnet's cache
read as $0.20 and its text as $0.10. The October 15 retirement applies to Haiku 4.5. OpenAI's page
lists `gpt-6-astra` at $10/$50, but whether `gpt-6.1-sol` is still the newest Sol was not
confirmed. The Sonnet row remains the Developer's choice.

## Verification

- Focused suites passed after the last change: the whole `testing/verification` package (893 tests), the native-bindings tests, and the Tao CLI test-command lifecycle suite. Typecheck and lint pass.
- `verify-changed` stopped in `shared#1`. The sandbox cannot remove the resource inventory's `.env` fixtures (`DEVENV-SANDBOXED-LANES-CANNOT-REMOVE-ENV-FIXTURES`); this pass did not touch that suite. The stranded fixtures were removed on the host.
- After the decision round, the iOS runtime preparation suite (7 tests) and the `land-fix` suite (10 tests) passed, along with typecheck, lint and the `check` lane.
- Landing proof is hosted Verify and the `Verify (host)` complement on the landed head. With V1 fixed, hosted Verify now runs `_dprint-check` and `_tao-check` for the first time since `9c128d74d`. The local `check` lane, which runs both gates, passes on this branch, so no formatting or Tao-check debt landed in between.
