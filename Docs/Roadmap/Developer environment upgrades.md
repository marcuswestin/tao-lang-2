# Developer environment upgrades

The durable backlog for repository setup, automation, verification, worktree, diagnostic, and
host-environment improvements. Product defects belong in their product roadmap; an entry here may
link one when the developer workflow is also affected.

**Generated.** `just _fix-ledger-index` renders this page from the entry files under
[`Developer environment upgrades/`](<Developer environment upgrades/>); do not hand-edit it. Entry
format, the `**Section:**` values, and how entries are selected, worked, and archived live in the
`devenv-upgrades` skill. An addressed entry moves to
[`Developer environment upgrades archive.md`](<Developer environment upgrades archive.md>) in the
change that addressed it.

## Deferred project — begin after the large branches land

- [DEVENV-015 — Reliable host-browser verification](<Developer environment upgrades/DEVENV-015-reliable-host-browser-verification.md>) — Planned
- [DEVENV-020 — Companion lifecycle and diagnostics](<Developer environment upgrades/DEVENV-020-companion-lifecycle-and-diagnostics.md>) — In progress
- [DEVENV-024 — Branch-local semantic cleanup](<Developer environment upgrades/DEVENV-024-branch-local-semantic-cleanup.md>) — Blocked

## External and observational findings

- [DEVENV-031 — Intermittent inspection-output anomalies](<Developer environment upgrades/DEVENV-031-intermittent-inspection-output-anomalies.md>) — Candidate
- [DEVENV-033 — Conflicting color-mode warning noise](<Developer environment upgrades/DEVENV-033-conflicting-color-mode-warning-noise.md>) — Candidate
- [DEVENV-034 — Bun worker-pool test scheduling](<Developer environment upgrades/DEVENV-034-bun-worker-pool-test-scheduling.md>) — Candidate
- [DEVENV-036 — Critical-path verification startup and host-wait concurrency](<Developer environment upgrades/DEVENV-036-critical-path-verification-startup-and-host-wait-concurrency.md>) — In progress
- [DEVENV-038 — Machine-lane lease age uses mismatched clocks](<Developer environment upgrades/DEVENV-038-machine-lane-lease-age-uses-mismatched-clocks.md>) — Candidate
- [DEVENV-039 — Native Studio launch resolves the generated app before it is written](<Developer environment upgrades/DEVENV-039-native-studio-launch-resolves-the-generated-app-before-it-is.md>) — Candidate
- [DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures](<Developer environment upgrades/DEVENV-040-bun-dependency-recovery-conflicts-with-protected-package-fix.md>) — Candidate
- [DEVENV-045 — Agent shell habits route routine commands through harness review](<Developer environment upgrades/DEVENV-045-agent-shell-habits-route-routine-commands-through-harness-re.md>) — In progress
- [DEVENV-046 — WordFlower remains the tail of the sharded Tao app tests](<Developer environment upgrades/DEVENV-046-the-tao-apps-suite-is-one-22-second-process-on-the-test-crit.md>) — Candidate
- [DEVENV-047 — Release-bundle proof shares Metro's cache with every other worktree](<Developer environment upgrades/DEVENV-047-release-bundle-proof-shares-metro-s-cache-with-every-other-w.md>) — Candidate
- [DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated](<Developer environment upgrades/DEVENV-048-a-fresh-linked-worktree-cannot-launch-studio-until-the-parse.md>) — Candidate
- [DEVENV-050 — `tao test` under a Git-ignored path says "No Tao tests found" without the reason](<Developer environment upgrades/DEVENV-050-tao-test-under-a-git-ignored-path-says-no-tao-tests-found-wi.md>) — Candidate
- [DEVENV-051 — `sips` exits 13 inside a sandboxed agent shell](<Developer environment upgrades/DEVENV-051-sips-exits-13-inside-a-sandboxed-agent-shell.md>) — Candidate
- [DEVENV-052 — `bun --tsconfig-override` fails for scripts outside the repository](<Developer environment upgrades/DEVENV-052-bun-tsconfig-override-fails-for-scripts-outside-the-reposito.md>) — Candidate
- [DEVENV-053 — Verifying a sibling worktree from an agent shell needs unsandboxed commands](<Developer environment upgrades/DEVENV-053-verifying-a-sibling-worktree-from-an-agent-shell-needs-unsan.md>) — Candidate
- [DEVENV-055 — No repository command compiles a native module](<Developer environment upgrades/DEVENV-055-no-repository-command-compiles-a-native-module.md>) — In progress
- [DEVENV-057 — `git hash-object --stdin-paths` cannot hash a directory symlink](<Developer environment upgrades/DEVENV-057-git-hash-object-stdin-paths-cannot-hash-a-directory-symlink.md>) — Candidate
- [DEVENV-059 — Xcode 27 runtime installation can strand Apple device services](<Developer environment upgrades/DEVENV-059-xcode-27-runtime-installation-can-strand-apple-device-servic.md>) — In progress
- [DEVENV-061 — `bun test` from the repository root loses subprocess output](<Developer environment upgrades/DEVENV-061-bun-test-from-the-repository-root-loses-subprocess-output.md>) — Candidate
- [DEVENV-062 — The documented setup command cannot refresh generated harness configuration](<Developer environment upgrades/DEVENV-062-the-documented-setup-command-cannot-refresh-generated-harn.md>) — Candidate
- [DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells](<Developer environment upgrades/DEVENV-063-studio-preview-needs-the-materialized-watchman-profile-in-ma.md>) — Candidate
- [DEVENV-065 — The raw-`Error` allowlist is line-precise with no way to re-derive it](<Developer environment upgrades/DEVENV-065-the-raw-error-allowlist-is-line-precise-with-no-way-to-re-de.md>) — Candidate
- [DEVENV-066 — Browser-harness gestures silently miss an occluded target](<Developer environment upgrades/DEVENV-066-browser-harness-gestures-silently-miss-an-occluded-target.md>) — Mitigated for offset gestures
- [DEVENV-067 — A failing deep-equality assertion on AST nodes can exhaust the machine's memory](<Developer environment upgrades/DEVENV-067-a-failing-deep-equality-assertion-on-ast-nodes-can-exhaust-t.md>) — In progress
- [DEVENV-068 — A child process cannot execute `ps` inside the Bash sandbox](<Developer environment upgrades/DEVENV-068-a-child-process-cannot-execute-ps-inside-the-bash-sandbox.md>) — Candidate
- [DEVENV-069 — An in-flight edit to a shared package fails other agents' test runs and names the wrong file](<Developer environment upgrades/DEVENV-069-an-in-flight-edit-to-a-shared-package-fails-other-agents-tes.md>) — Candidate
- [DEVENV-071 — `rg`'s `-r` is a replacement string, not grep's recursion flag](<Developer environment upgrades/DEVENV-071-rg-s-r-is-a-replacement-string-not-grep-s-recursion-flag.md>) — Candidate
- [DEVENV-072 — Shared devenv profile makes its coreutils vanish mid-command in every worktree](<Developer environment upgrades/DEVENV-072-shared-devenv-profile-makes-its-coreutils-vanish-mid-command.md>) — Candidate
- [DEVENV-073 — Gate-runner tests assume an idle machine, so contention handling fails its own suite](<Developer environment upgrades/DEVENV-073-gate-runner-tests-assume-an-idle-machine-so-contention-handl.md>) — Incoming
- [DEVENV-074 — `./agent fix` cannot format the skills it is told to format](<Developer environment upgrades/DEVENV-074-agent-fix-cannot-format-the-skills-it-is-told-to-format.md>) — Candidate
- [DEVENV-076 — A documentation-only change selects no test suites](<Developer environment upgrades/DEVENV-076-a-documentation-only-change-selects-no-test-suites.md>) — Candidate
- [DEVENV-077 — A busy machine could admit no lane at all](<Developer environment upgrades/DEVENV-077-a-busy-machine-could-admit-no-lane-at-all.md>) — Incoming
- [DEVENV-078 — A peer's exclusive confirmation blocks every other lane without bound](<Developer environment upgrades/DEVENV-078-a-peer-s-exclusive-confirmation-blocks-every-other-lane-with.md>) — Candidate
- [DEVENV-082 — No pseudo-terminal inside the agent sandbox](<Developer environment upgrades/DEVENV-082-no-pseudo-terminal-inside-the-agent-sandbox.md>) — Candidate
- [DEVENV-086 — The compiled-app fingerprint hashes all of `packages/`, so any concurrent edit invalidates every memo](<Developer environment upgrades/DEVENV-086-the-compiled-app-fingerprint-hashes-all-of-packages.md>) — Candidate
- [DEVENV-090 — A stale generated parser fails `runtime-jest` without naming itself](<Developer environment upgrades/DEVENV-090-a-stale-generated-parser-fails-runtime-jest-without-naming-i.md>) — Candidate
- [DEVENV-091 — A dependency tree can be unusable while every health check passes](<Developer environment upgrades/DEVENV-091-a-dependency-tree-can-be-unusable-while-every-health-check-p.md>) — Candidate
- [DEVENV-094 — Simultaneous worktree finalizations collapse verification throughput](<Developer environment upgrades/DEVENV-094-simultaneous-finalizations-collapse-verification-throughput.md>) — Candidate
- [DEVENV-097 — Verification in a freshly created worktree can never hit a green record](<Developer environment upgrades/DEVENV-097-verification-in-a-freshly-created-worktree-can-never-hit-a-green.md>) — Candidate
- [DEVENV-098 — A fixture holding the output-capture queue through a spawn stalls its whole shard](<Developer environment upgrades/DEVENV-098-a-fixture-holding-the-output-capture-queue-through-a-spawn.md>) — Candidate
- [DEVENV-101 — `_fix-dprint` cannot format a skill file inside the sandbox](<Developer environment upgrades/DEVENV-101-fix-dprint-cannot-format-a-skill-file-inside-the-sandbox.md>) — Candidate
- [DEVENV-102 — No gate parses `.tao-revolution` spec sources](<Developer environment upgrades/DEVENV-102-no-gate-parses-tao-revolution-spec-sources.md>) — Candidate
- [DEVENV-103 — `$TMPDIR` resolves to two different paths between tool calls](<Developer environment upgrades/DEVENV-103-tmpdir-resolves-to-two-different-paths-between-tool-calls.md>) — Candidate
- [DEVENV-109 — The dev-data cross-process test times out under a full lane](<Developer environment upgrades/DEVENV-109-dev-data-cross-process-test-times-out-under-a-full-lane.md>) — Candidate
- [DEVENV-110 — Concurrent writers in one worktree fail the pre-test app compile](<Developer environment upgrades/DEVENV-110-concurrent-writers-in-one-worktree-fail-the-pre-test-app-compile.md>) — Candidate
- [DEVENV-111 — `finalize`'s integration merge half-applies `main` in the sandbox and names no conflicting path](<Developer environment upgrades/DEVENV-111-finalize-s-integration-merge-half-applies-main-in-the-sandbox.md>) — In progress
- [DEVENV-113 — Uncached complete verification has no repeated stable tail](<Developer environment upgrades/DEVENV-113-uncached-complete-verification-has-no-repeated-stable-tail.md>) — Candidate
- [DEVENV-114 — The guidance invites agents to force-release a lock the design reserves for a person](<Developer environment upgrades/DEVENV-114-guidance-invites-agents-to-force-release-the-landing-lock.md>) — Candidate
- [DEVENV-A-GATE-RECOMPILES-THE-GENERATED-APP-UNDER-A-RUNNING-DEV-LOOP — A check or test lane replaces the app a running `tao dev` is serving](<Developer environment upgrades/DEVENV-A-GATE-RECOMPILES-THE-GENERATED-APP-UNDER-A-RUNNING-DEV-LOOP.md>) — Candidate
- [DEVENV-A-KILL-DEADLINE-NO-LONGER-CATCHES-A-SLOW-REGRESSION — A kill deadline no longer catches a slow regression](<Developer environment upgrades/DEVENV-A-KILL-DEADLINE-NO-LONGER-CATCHES-A-SLOW-REGRESSION.md>) — Candidate
- [DEVENV-A-MERGE-OF-MAIN-LEAVES-THE-CODEX-CONFIG-MISSING-UNTIL-SETUP-RUNS — A merge of main leaves the Codex config missing until setup runs](<Developer environment upgrades/DEVENV-A-MERGE-OF-MAIN-LEAVES-THE-CODEX-CONFIG-MISSING-UNTIL-SETUP-RUNS.md>) — In progress
- [DEVENV-ADMITTED-SEAT-HELD-BY-REGISTRATION-NOT-DEMAND — An admitted seat is held by registration, not by demand](<Developer environment upgrades/DEVENV-ADMITTED-SEAT-HELD-BY-REGISTRATION-NOT-DEMAND.md>) — Candidate
- [DEVENV-CODEX-HOST-COMMANDS-COST-THE-CREDENTIAL-READ-DENIES — Codex host commands cost the credential read denies](<Developer environment upgrades/DEVENV-CODEX-HOST-COMMANDS-COST-THE-CREDENTIAL-READ-DENIES.md>) — Deferred
- [DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN — `./agent doctor` passes a Bun older than the one devenv pins](<Developer environment upgrades/DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN.md>) — In progress
- [DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH — Emulator exit can report a prior launch's failure](<Developer environment upgrades/DEVENV-EMULATOR-EXIT-LOG-CAN-REPORT-PRIOR-LAUNCH.md>) — Candidate
- [DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN — Every Tao app shard compiles the project again](<Developer environment upgrades/DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN.md>) — In progress on `feat/verification-throughput`; idle-machine wall-time acceptance remains to be measured.
- [DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START — File watching depends on a Watchman server no agent can start](<Developer environment upgrades/DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START.md>) — Candidate
- [DEVENV-HOST-TEST-ARTIFACTS-ACCUMULATE-WITHOUT-BOUND — Host-test artifacts accumulate without bound](<Developer environment upgrades/DEVENV-HOST-TEST-ARTIFACTS-ACCUMULATE-WITHOUT-BOUND.md>) — In progress
- [DEVENV-JEST-CACHE-IDENTITIES-AND-DIRECT-RUNS-GROW-WITHOUT-BOUND — Jest cache identities and direct runs grow without bound](<Developer environment upgrades/DEVENV-JEST-CACHE-IDENTITIES-AND-DIRECT-RUNS-GROW-WITHOUT-BOUND.md>) — Candidate
- [DEVENV-LAND-REFUSES-A-MERGE-MESSAGE-WRITTEN-BEFORE-ITS-FIRST-CALL — Land refuses a merge message written before its first call](<Developer environment upgrades/DEVENV-LAND-REFUSES-A-MERGE-MESSAGE-WRITTEN-BEFORE-ITS-FIRST-CALL.md>) — Candidate
- [DEVENV-LANDING-TESTS-A-CODEX-CONFIG-IT-NEVER-REGENERATED — A landing tests a Codex config it never regenerated](<Developer environment upgrades/DEVENV-LANDING-TESTS-A-CODEX-CONFIG-IT-NEVER-REGENERATED.md>) — Candidate
- [DEVENV-METRO-FAILS-TO-START-WITHIN-ITS-WAIT-UNDER-CONTENTION — Expo Metro intermittently fails to start within its wait under machine contention](<Developer environment upgrades/DEVENV-METRO-FAILS-TO-START-WITHIN-ITS-WAIT-UNDER-CONTENTION.md>) — Candidate
- [DEVENV-ONE-TEST-FILE-SPAWNS-FIVE-TYPECHECKS — One test file spawns five typechecks, so its shard cannot be split](<Developer environment upgrades/DEVENV-ONE-TEST-FILE-SPAWNS-FIVE-TYPECHECKS.md>) — Candidate
- [DEVENV-QUEUED-NODE-FIRST-WAIT-CHARGED-TO-LANE-NOT-MACHINE — A queued node's first wait is charged to the lane, not the machine](<Developer environment upgrades/DEVENV-QUEUED-NODE-FIRST-WAIT-CHARGED-TO-LANE-NOT-MACHINE.md>) — Candidate
- [DEVENV-RELEASE-ACCEPTANCE-DIRECTORY-OPERATIONS-FAIL-IN-MANAGED-SHELL — Release acceptance directory operations fail in the managed shell](<Developer environment upgrades/DEVENV-RELEASE-ACCEPTANCE-DIRECTORY-OPERATIONS-FAIL-IN-MANAGED-SHELL.md>) — Candidate
- [DEVENV-SUBAGENT-SHELL-CANNOT-START-A-STUDIO-SMOKE-LANE — A subagent's unsandboxed shell fails the Watchman preflight the orchestrator's shell passes](<Developer environment upgrades/DEVENV-SUBAGENT-SHELL-CANNOT-START-A-STUDIO-SMOKE-LANE.md>) — Candidate
- [DEVENV-TAO-BUILD-SNAPSHOT-LOSES-PROJECT-PACKAGES — Tao build snapshot loses project packages](<Developer environment upgrades/DEVENV-TAO-BUILD-SNAPSHOT-LOSES-PROJECT-PACKAGES.md>) — Candidate
- [DEVENV-TAO-FIX-NEVER-REUSES-THE-CHECK-MEMO — Tao fix never reuses the check memo, so every verify lane refixes the whole repository](<Developer environment upgrades/DEVENV-TAO-FIX-NEVER-REUSES-THE-CHECK-MEMO.md>) — Candidate
- [DEVENV-TAO-PIPELINE-DEFECTS-SET-EVERY-LANES-FLOOR — Tao pipeline defects set every lane's floor](<Developer environment upgrades/DEVENV-TAO-PIPELINE-DEFECTS-SET-EVERY-LANES-FLOOR.md>) — Candidate
