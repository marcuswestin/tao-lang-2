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
- [DEVENV-ARCHIVE-WORKFLOW-CANNOT-ARCHIVE-A-WORKFLOW-CHANGE — the Archive workflow cannot archive a workflow change](<Developer environment upgrades/DEVENV-ARCHIVE-WORKFLOW-CANNOT-ARCHIVE-A-WORKFLOW-CHANGE.md>) — Candidate
- [DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap](<Developer environment upgrades/DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP.md>) — In progress
- [DEVENV-FINALIZE-HIDES-PROGRESS-IN-A-SECOND-LOG — Finalize hides progress in a second log](<Developer environment upgrades/DEVENV-FINALIZE-HIDES-PROGRESS-IN-A-SECOND-LOG.md>) — Candidate
- [DEVENV-IOS-BUILD-HIDES-POD-INSTALL-FAILURES — iOS build hides pod install failures](<Developer environment upgrades/DEVENV-IOS-BUILD-HIDES-POD-INSTALL-FAILURES.md>) — Candidate
- [DEVENV-NATIVE-MODULE-CHECK-CANNOT-LIST-SWIFT-PACKAGE-PODS — native module check cannot list Swift package Pods](<Developer environment upgrades/DEVENV-NATIVE-MODULE-CHECK-CANNOT-LIST-SWIFT-PACKAGE-PODS.md>) — Candidate
- [DEVENV-NO-FRONT-DOOR-REPEATS-A-TEST-UNDER-CPU-LOAD — No front door repeats a test under CPU load](<Developer environment upgrades/DEVENV-NO-FRONT-DOOR-REPEATS-A-TEST-UNDER-CPU-LOAD.md>) — Candidate
- [DEVENV-PERSISTENT-UI-CONTROLLER-POST-MVP — Persistent UI controller after MVP](<Developer environment upgrades/DEVENV-PERSISTENT-UI-CONTROLLER-POST-MVP.md>) — Planned
- [DEVENV-STANDALONE-SERVER-STARTUP-HIDES-CHILD-FAILURE — Standalone server startup hides child failure](<Developer environment upgrades/DEVENV-STANDALONE-SERVER-STARTUP-HIDES-CHILD-FAILURE.md>) — Candidate
- [DEVENV-STUDIO-STARTUP-STAGES-NEED-MEASUREMENT — Studio startup stages need measurement](<Developer environment upgrades/DEVENV-STUDIO-STARTUP-STAGES-NEED-MEASUREMENT.md>) — Planned
- [DEVENV-VERIFY-TRIMS-LEFT-TO-OTHER-BRANCHES-POST-MVP — Verification trims left to other branches, checked after MVP](<Developer environment upgrades/DEVENV-VERIFY-TRIMS-LEFT-TO-OTHER-BRANCHES-POST-MVP.md>) — Planned

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
- [DEVENV-057 — `git hash-object --stdin-paths` cannot hash a directory symlink](<Developer environment upgrades/DEVENV-057-git-hash-object-stdin-paths-cannot-hash-a-directory-symlink.md>) — Candidate
- [DEVENV-059 — Xcode 27 runtime installation can strand Apple device services](<Developer environment upgrades/DEVENV-059-xcode-27-runtime-installation-can-strand-apple-device-servic.md>) — In progress
- [DEVENV-061 — `bun test` from the repository root loses subprocess output](<Developer environment upgrades/DEVENV-061-bun-test-from-the-repository-root-loses-subprocess-output.md>) — Candidate
- [DEVENV-062 — The documented setup command cannot refresh generated harness configuration](<Developer environment upgrades/DEVENV-062-the-documented-setup-command-cannot-refresh-generated-harn.md>) — Candidate
- [DEVENV-065 — The raw-`Error` allowlist is line-precise with no way to re-derive it](<Developer environment upgrades/DEVENV-065-the-raw-error-allowlist-is-line-precise-with-no-way-to-re-de.md>) — Candidate
- [DEVENV-066 — Browser-harness gestures silently miss an occluded target](<Developer environment upgrades/DEVENV-066-browser-harness-gestures-silently-miss-an-occluded-target.md>) — Candidate
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
- [DEVENV-113 — Uncached complete verification has no repeated stable tail](<Developer environment upgrades/DEVENV-113-uncached-complete-verification-has-no-repeated-stable-tail.md>) — Candidate
- [DEVENV-114 — The guidance invites agents to force-release a lock the design reserves for a person](<Developer environment upgrades/DEVENV-114-guidance-invites-agents-to-force-release-the-landing-lock.md>) — Candidate
- [DEVENV-A-FIXED-LOCK-DEADLINE-FAILS-A-LANE-ON-A-LOADED-MACHINE — A fixed lock deadline fails a lane on a loaded machine](<Developer environment upgrades/DEVENV-A-FIXED-LOCK-DEADLINE-FAILS-A-LANE-ON-A-LOADED-MACHINE.md>) — Incoming
- [DEVENV-A-GATE-RECOMPILES-THE-GENERATED-APP-UNDER-A-RUNNING-DEV-LOOP — A check or test lane replaces the app a running `tao run` is serving](<Developer environment upgrades/DEVENV-A-GATE-RECOMPILES-THE-GENERATED-APP-UNDER-A-RUNNING-DEV-LOOP.md>) — Candidate
- [DEVENV-A-HIDDEN-COMMAND-REAPPEARED-IN-ONE-BATCHED-WORDFLOWER-RUN — A hidden command reappeared in one batched WordFlower run](<Developer environment upgrades/DEVENV-A-HIDDEN-COMMAND-REAPPEARED-IN-ONE-BATCHED-WORDFLOWER-RUN.md>) — Incoming
- [DEVENV-A-KILL-DEADLINE-NO-LONGER-CATCHES-A-SLOW-REGRESSION — A kill deadline no longer catches a slow regression](<Developer environment upgrades/DEVENV-A-KILL-DEADLINE-NO-LONGER-CATCHES-A-SLOW-REGRESSION.md>) — Candidate
- [DEVENV-A-MERGE-OF-MAIN-LEAVES-THE-CODEX-CONFIG-MISSING-UNTIL-SETUP-RUNS — A merge of main leaves the Codex config missing until setup runs](<Developer environment upgrades/DEVENV-A-MERGE-OF-MAIN-LEAVES-THE-CODEX-CONFIG-MISSING-UNTIL-SETUP-RUNS.md>) — In progress
- [DEVENV-A-WORKTREE-INSIDE-THE-PRIMARY-CHECKOUT-FAILS-DOCTOR-AND-CANNOT-MOVE — A worktree inside the primary checkout fails doctor and cannot be moved](<Developer environment upgrades/DEVENV-A-WORKTREE-INSIDE-THE-PRIMARY-CHECKOUT-FAILS-DOCTOR-AND-CANNOT-MOVE.md>) — Candidate
- [DEVENV-ACTIVE-NETWORK-POLICY-KEEPS-OLD-DOMAINS — Active network policy keeps old domains](<Developer environment upgrades/DEVENV-ACTIVE-NETWORK-POLICY-KEEPS-OLD-DOMAINS.md>) — Blocked
- [DEVENV-ADMITTED-SEAT-HELD-BY-REGISTRATION-NOT-DEMAND — An admitted seat is held by registration, not by demand](<Developer environment upgrades/DEVENV-ADMITTED-SEAT-HELD-BY-REGISTRATION-NOT-DEMAND.md>) — Candidate
- [DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT — Android emulator lease release precedes confirmed exit](<Developer environment upgrades/DEVENV-ANDROID-EMULATOR-LEASE-RELEASE-PRECEDES-EXIT.md>) — Candidate
- [DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND — `app-dev --web` opens Chrome in the foreground](<Developer environment upgrades/DEVENV-APP-DEV-WEB-OPENS-CHROME-IN-THE-FOREGROUND.md>) — Planned
- [DEVENV-CLAUDE-CODE-BELOW-CONFIGURED-OPUS-MINIMUM — Claude Code is below the configured Opus minimum](<Developer environment upgrades/DEVENV-CLAUDE-CODE-BELOW-CONFIGURED-OPUS-MINIMUM.md>) — Candidate
- [DEVENV-CLOSED-STDIN-PIPE-TEST-FLAKES-UNDER-LOAD — The closed-stdin-pipe test fails `verify-changed` under load](<Developer environment upgrades/DEVENV-CLOSED-STDIN-PIPE-TEST-FLAKES-UNDER-LOAD.md>) — Candidate
- [DEVENV-CODEX-HOST-COMMANDS-COST-THE-CREDENTIAL-READ-DENIES — Codex host commands cost the credential read denies](<Developer environment upgrades/DEVENV-CODEX-HOST-COMMANDS-COST-THE-CREDENTIAL-READ-DENIES.md>) — Deferred
- [DEVENV-COLD-SHELL-EVALUATION-REPEATS-PER-WORKTREE — Cold shell evaluation repeats per worktree](<Developer environment upgrades/DEVENV-COLD-SHELL-EVALUATION-REPEATS-PER-WORKTREE.md>) — Candidate
- [DEVENV-COMPANION-CAPTURE-REGISTRATION-FAILS-AFTER-LIVE-EDIT — Companion capture registration fails after live edit](<Developer environment upgrades/DEVENV-COMPANION-CAPTURE-REGISTRATION-FAILS-AFTER-LIVE-EDIT.md>) — Candidate
- [DEVENV-COMPILED-TEST-STORE-RETAINS-BROKEN-MODULE-LINKS — Compiled test store retains broken module links](<Developer environment upgrades/DEVENV-COMPILED-TEST-STORE-RETAINS-BROKEN-MODULE-LINKS.md>) — Candidate
- [DEVENV-DEV-CLI-SHELL-TESTS-CANNOT-COPY-ZSHRC-IN-THE-SANDBOX — dev-cli shell tests cannot copy a zshrc inside the agent sandbox](<Developer environment upgrades/DEVENV-DEV-CLI-SHELL-TESTS-CANNOT-COPY-ZSHRC-IN-THE-SANDBOX.md>) — Candidate
- [DEVENV-DEV-CLIENT-CRASHES-RELOADING-WITH-AN-OPEN-WEBSOCKET — The dev client crashes reloading with an open websocket](<Developer environment upgrades/DEVENV-DEV-CLIENT-CRASHES-RELOADING-WITH-AN-OPEN-WEBSOCKET.md>) — Candidate
- [DEVENV-DEVICE-HUB-APPROVAL-PROMPT-IS-MISSING — Device Hub approval prompt is missing](<Developer environment upgrades/DEVENV-DEVICE-HUB-APPROVAL-PROMPT-IS-MISSING.md>) — Candidate
- [DEVENV-DIRENV-RELOAD-REPORTS-RUNNING-COMMAND-NOT-FOUND — direnv reload reports Running command not found](<Developer environment upgrades/DEVENV-DIRENV-RELOAD-REPORTS-RUNNING-COMMAND-NOT-FOUND.md>) — Candidate
- [DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN — `./agent doctor` passes a Bun older than the one devenv pins](<Developer environment upgrades/DEVENV-DOCTOR-PASSES-A-BUN-OLDER-THAN-THE-DEVENV-PIN.md>) — In progress
- [DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN — Every Tao app shard compiles the project again](<Developer environment upgrades/DEVENV-EVERY-TAO-APP-SHARD-COMPILES-THE-PROJECT-AGAIN.md>) — In progress on `feat/verification-throughput`; idle-machine wall-time acceptance remains to be measured.
- [DEVENV-EXPENSIVE-TEST-TRIMS-NEEDING-A-DECISION — Expensive test trims that need a decision](<Developer environment upgrades/DEVENV-EXPENSIVE-TEST-TRIMS-NEEDING-A-DECISION.md>) — Candidate
- [DEVENV-FAILING-UNTIL-WAIT-STALLS-TEST-FILE — A failing `until` wait stalls `test-file` for minutes](<Developer environment upgrades/DEVENV-FAILING-UNTIL-WAIT-STALLS-TEST-FILE.md>) — Candidate
- [DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START — File watching depends on a Watchman server no agent can start](<Developer environment upgrades/DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START.md>) — Candidate
- [DEVENV-GIT-WORKTREE-TIMEOUTS-RECUR-AFTER-COMPLETION-REPAIR — Git worktree timeouts recur after completion repair](<Developer environment upgrades/DEVENV-GIT-WORKTREE-TIMEOUTS-RECUR-AFTER-COMPLETION-REPAIR.md>) — Candidate
- [DEVENV-HOOK-REVIEW-IGNORES-DESCRIPTIVE-NAMES — Hook review ignores descriptive names](<Developer environment upgrades/DEVENV-HOOK-REVIEW-IGNORES-DESCRIPTIVE-NAMES.md>) — Blocked
- [DEVENV-IOS-BUILDS-LACK-COCOAPODS-METADATA-ACCESS — iOS builds lack CocoaPods metadata access](<Developer environment upgrades/DEVENV-IOS-BUILDS-LACK-COCOAPODS-METADATA-ACCESS.md>) — In progress
- [DEVENV-LANDING-TESTS-A-CODEX-CONFIG-IT-NEVER-REGENERATED — A landing tests a Codex config it never regenerated](<Developer environment upgrades/DEVENV-LANDING-TESTS-A-CODEX-CONFIG-IT-NEVER-REGENERATED.md>) — Candidate
- [DEVENV-LAZY-TEST-REGISTRATION-FAILS-CI-IMPORT — Lazy test registration fails CI import](<Developer environment upgrades/DEVENV-LAZY-TEST-REGISTRATION-FAILS-CI-IMPORT.md>) — In progress
- [DEVENV-LOCAL-HOST-TESTS-FAIL-PORT-ZERO — Local host tests fail while binding port zero](<Developer environment upgrades/DEVENV-LOCAL-HOST-TESTS-FAIL-PORT-ZERO.md>) — Candidate
- [DEVENV-MACOS-STARTUP-AFTER-CACHE-CLEANUP-NEEDS-VERIFICATION — macOS startup after cache cleanup needs verification](<Developer environment upgrades/DEVENV-MACOS-STARTUP-AFTER-CACHE-CLEANUP-NEEDS-VERIFICATION.md>) — Planned
- [DEVENV-MANAGED-COMMIT-DENIES-WORKTREE-GIT-METADATA — Managed commit denies worktree Git metadata](<Developer environment upgrades/DEVENV-MANAGED-COMMIT-DENIES-WORKTREE-GIT-METADATA.md>) — Candidate
- [DEVENV-MERGE-EXPOSES-LEGACY-GENERATED-CACHES — Merge exposes legacy generated caches](<Developer environment upgrades/DEVENV-MERGE-EXPOSES-LEGACY-GENERATED-CACHES.md>) — Candidate
- [DEVENV-MERGE-WRITE-PROBE-REFUSES-READ-ONLY-SKETCHES — Merge write probe refuses read-only tracked sketches](<Developer environment upgrades/DEVENV-MERGE-WRITE-PROBE-REFUSES-READ-ONLY-SKETCHES.md>) — Candidate
- [DEVENV-METRO-FAILS-TO-START-WITHIN-ITS-WAIT-UNDER-CONTENTION — Expo Metro intermittently fails to start within its wait under machine contention](<Developer environment upgrades/DEVENV-METRO-FAILS-TO-START-WITHIN-ITS-WAIT-UNDER-CONTENTION.md>) — Candidate
- [DEVENV-METRO-STALLS-AFTER-ANDROID-DEV-STOP — iOS dev loop can stall after an Android loop stops](<Developer environment upgrades/DEVENV-METRO-STALLS-AFTER-ANDROID-DEV-STOP.md>) — Candidate
- [DEVENV-MODEL-ROUTING-TRAILS-INSTALLED-CATALOG — Model routing trails the installed catalog](<Developer environment upgrades/DEVENV-MODEL-ROUTING-TRAILS-INSTALLED-CATALOG.md>) — Candidate
- [DEVENV-NATIVE-KIT-OMITS-PROVIDER-TRANSITIVES — Native kit omits provider transitives](<Developer environment upgrades/DEVENV-NATIVE-KIT-OMITS-PROVIDER-TRANSITIVES.md>) — In progress
- [DEVENV-NATIVE-SESSION-TIMESTAMPS-USE-MONOTONIC-TIME — Native session timestamps use monotonic time](<Developer environment upgrades/DEVENV-NATIVE-SESSION-TIMESTAMPS-USE-MONOTONIC-TIME.md>) — Candidate
- [DEVENV-ONE-TEST-FILE-SPAWNS-FIVE-TYPECHECKS — One test file spawns five typechecks, so its shard cannot be split](<Developer environment upgrades/DEVENV-ONE-TEST-FILE-SPAWNS-FIVE-TYPECHECKS.md>) — Candidate
- [DEVENV-OUTPUT-HOOK-REQUIRES-UNAVAILABLE-READ-TOOL — Output hook requires an unavailable read tool](<Developer environment upgrades/DEVENV-OUTPUT-HOOK-REQUIRES-UNAVAILABLE-READ-TOOL.md>) — Candidate
- [DEVENV-PR-CHECKS-SPENDS-THE-ANONYMOUS-API-LIMIT — Following checks spends GitHub's anonymous API limit](<Developer environment upgrades/DEVENV-PR-CHECKS-SPENDS-THE-ANONYMOUS-API-LIMIT.md>) — Candidate
- [DEVENV-PROCESS-GROUP-PROBE-REJECTS-PS-SNAPSHOT — Process group probe rejects the system process snapshot](<Developer environment upgrades/DEVENV-PROCESS-GROUP-PROBE-REJECTS-PS-SNAPSHOT.md>) — Candidate
- [DEVENV-PROFILE-LACKS-DIRENV-WHILE-DOCTOR-PASSES — Profile lacks direnv while doctor passes](<Developer environment upgrades/DEVENV-PROFILE-LACKS-DIRENV-WHILE-DOCTOR-PASSES.md>) — Candidate
- [DEVENV-PROJECT-TOOLING-RECEIPT-TESTS-BRUSH-THE-CI-TEST-BUDGET — Project-tooling receipt tests brush CI's 45-second test budget](<Developer environment upgrades/DEVENV-PROJECT-TOOLING-RECEIPT-TESTS-BRUSH-THE-CI-TEST-BUDGET.md>) — Candidate
- [DEVENV-PROJECT-TOOLING-REFRESH-AND-WATCH-TESTS-TIME-OUT-UNDER-BROAD-LANES — Project-tooling refresh and watch tests time out under broad lanes](<Developer environment upgrades/DEVENV-PROJECT-TOOLING-REFRESH-AND-WATCH-TESTS-TIME-OUT-UNDER-BROAD-LANES.md>) — Candidate
- [DEVENV-QA-CAPTURE-BLOCKS-RUNTIME-SDK-IMPORTS — QA capture blocks runtime SDK imports](<Developer environment upgrades/DEVENV-QA-CAPTURE-BLOCKS-RUNTIME-SDK-IMPORTS.md>) — Candidate
- [DEVENV-QUEUED-NODE-FIRST-WAIT-CHARGED-TO-LANE-NOT-MACHINE — A queued node's first wait is charged to the lane, not the machine](<Developer environment upgrades/DEVENV-QUEUED-NODE-FIRST-WAIT-CHARGED-TO-LANE-NOT-MACHINE.md>) — Candidate
- [DEVENV-QUIET-UI-HOST-ACCEPTANCE — Quiet UI host acceptance](<Developer environment upgrades/DEVENV-QUIET-UI-HOST-ACCEPTANCE.md>) — Candidate
- [DEVENV-RELEASE-ACCEPTANCE-DIRECTORY-OPERATIONS-FAIL-IN-MANAGED-SHELL — Release acceptance directory operations fail in the managed shell](<Developer environment upgrades/DEVENV-RELEASE-ACCEPTANCE-DIRECTORY-OPERATIONS-FAIL-IN-MANAGED-SHELL.md>) — Candidate
- [DEVENV-RESOURCES-REGISTER-DIRECTORY-PRINTS-THE-WHOLE-INVENTORY — Registering a directory prints the whole resource inventory](<Developer environment upgrades/DEVENV-RESOURCES-REGISTER-DIRECTORY-PRINTS-THE-WHOLE-INVENTORY.md>) — Candidate
- [DEVENV-RUNTIME-JOURNEY-OBSERVATION-TEST-TIMES-OUT — Runtime journey observation test can time out in a broad lane](<Developer environment upgrades/DEVENV-RUNTIME-JOURNEY-OBSERVATION-TEST-TIMES-OUT.md>) — Candidate
- [DEVENV-SANDBOXED-GIT-XCRUN-CACHE-WARNING-FAILS-STDERR-ASSERTIONS — Sandboxed git's xcrun cache warning fails stderr assertions](<Developer environment upgrades/DEVENV-SANDBOXED-GIT-XCRUN-CACHE-WARNING-FAILS-STDERR-ASSERTIONS.md>) — Candidate
- [DEVENV-SANDBOXED-LANES-CANNOT-REMOVE-ENV-FIXTURES — Sandboxed lanes cannot remove `.env` fixtures](<Developer environment upgrades/DEVENV-SANDBOXED-LANES-CANNOT-REMOVE-ENV-FIXTURES.md>) — Candidate
- [DEVENV-SANDBOXED-TEST-CACHE-REGISTRATION-DENIED — Sandboxed test cache registration denied](<Developer environment upgrades/DEVENV-SANDBOXED-TEST-CACHE-REGISTRATION-DENIED.md>) — Candidate
- [DEVENV-SANDBOXED-VERIFY-CHANGED-CANNOT-REMOVE-ENV-FIXTURES — Sandboxed verify-changed cannot remove `.env` fixtures](<Developer environment upgrades/DEVENV-SANDBOXED-VERIFY-CHANGED-CANNOT-REMOVE-ENV-FIXTURES.md>) — Candidate
- [DEVENV-SANDBOXED-VERIFY-FAILS-DEV-CLI-SHELL-TESTS — Sandboxed verification fails the dev-cli shell tests](<Developer environment upgrades/DEVENV-SANDBOXED-VERIFY-FAILS-DEV-CLI-SHELL-TESTS.md>) — Candidate
- [DEVENV-SECRET-MATERIALIZATION-MISSING-FROM-AGENT-COMMANDS — Secret materialization is missing from agent commands](<Developer environment upgrades/DEVENV-SECRET-MATERIALIZATION-MISSING-FROM-AGENT-COMMANDS.md>) — Candidate
- [DEVENV-SETUP-SUCCEEDS-WHEN-RULESYNC-REJECTS-HOOKS — Setup succeeds when rulesync rejects the hooks file](<Developer environment upgrades/DEVENV-SETUP-SUCCEEDS-WHEN-RULESYNC-REJECTS-HOOKS.md>) — Candidate
- [DEVENV-SIX-HOST-ONLY-GATES-HAVE-NO-UNSANDBOXED-SHAPE — Six host-only gates have no unsandboxed shape](<Developer environment upgrades/DEVENV-SIX-HOST-ONLY-GATES-HAVE-NO-UNSANDBOXED-SHAPE.md>) — Candidate
- [DEVENV-STRANDED-DEVELOPMENT-RESOURCE-DISCOVERY — Stranded development resource discovery](<Developer environment upgrades/DEVENV-STRANDED-DEVELOPMENT-RESOURCE-DISCOVERY.md>) — In progress
- [DEVENV-STUDIO-AGENT-BROWSER-GATE-TIMES-OUT-UNDER-THE-COMPLEMENT-LANE — Studio agent browser gate times out under the complement lane](<Developer environment upgrades/DEVENV-STUDIO-AGENT-BROWSER-GATE-TIMES-OUT-UNDER-THE-COMPLEMENT-LANE.md>) — Candidate
- [DEVENV-STUDIO-LEGACY-LOCK-TEST-IS-INTERMITTENT — Studio legacy-lock test is intermittent](<Developer environment upgrades/DEVENV-STUDIO-LEGACY-LOCK-TEST-IS-INTERMITTENT.md>) — Candidate
- [DEVENV-STUDIO-REAL-APP-PROOF-FAILS-INTERMITTENTLY-UNDER-LOAD — The Studio real-app proof fails intermittently under load](<Developer environment upgrades/DEVENV-STUDIO-REAL-APP-PROOF-FAILS-INTERMITTENTLY-UNDER-LOAD.md>) — In progress
- [DEVENV-STUDIO-SMOKE-GENERATED-SOURCE-FRESHNESS-RACE — Studio smoke generated-source freshness race](<Developer environment upgrades/DEVENV-STUDIO-SMOKE-GENERATED-SOURCE-FRESHNESS-RACE.md>) — Candidate
- [DEVENV-STUDIO-SMOKE-LEAVES-EXPO-SERVERS-RUNNING — Studio smoke leaves Expo servers running](<Developer environment upgrades/DEVENV-STUDIO-SMOKE-LEAVES-EXPO-SERVERS-RUNNING.md>) — Candidate
- [DEVENV-TAO-BUILD-SNAPSHOT-LOSES-PROJECT-PACKAGES — Tao build snapshot loses project packages](<Developer environment upgrades/DEVENV-TAO-BUILD-SNAPSHOT-LOSES-PROJECT-PACKAGES.md>) — Candidate
- [DEVENV-TAO-DEV-IGNORES-PROVIDER-PACKAGE-EDITS — A running `tao run` ignores provider package edits](<Developer environment upgrades/DEVENV-TAO-DEV-IGNORES-PROVIDER-PACKAGE-EDITS.md>) — Candidate
- [DEVENV-TAO-FIX-NEVER-REUSES-THE-CHECK-MEMO — Tao fix never reuses the check memo, so every verify lane refixes the whole repository](<Developer environment upgrades/DEVENV-TAO-FIX-NEVER-REUSES-THE-CHECK-MEMO.md>) — Candidate
- [DEVENV-TAO-INSTALL-DEFAULT-NPM-CACHE-IS-OUTSIDE-WRITABLE-PROJECT — Tao install defaults to an npm cache outside the writable project](<Developer environment upgrades/DEVENV-TAO-INSTALL-DEFAULT-NPM-CACHE-IS-OUTSIDE-WRITABLE-PROJECT.md>) — Candidate
- [DEVENV-TAO-PIPELINE-DEFECTS-SET-EVERY-LANES-FLOOR — Tao pipeline defects set every lane's floor](<Developer environment upgrades/DEVENV-TAO-PIPELINE-DEFECTS-SET-EVERY-LANES-FLOOR.md>) — Candidate
- [DEVENV-TAO-TEST-WAITS-FOREVER-ON-A-JEST-WORKER-LEFT-OPEN — `tao test` waits forever on a Jest worker left open](<Developer environment upgrades/DEVENV-TAO-TEST-WAITS-FOREVER-ON-A-JEST-WORKER-LEFT-OPEN.md>) — Candidate
- [DEVENV-TEST-FILE-REFUSES-STANDALONE-APP-TESTS — Focused test-file refuses standalone app tests](<Developer environment upgrades/DEVENV-TEST-FILE-REFUSES-STANDALONE-APP-TESTS.md>) — Candidate
- [DEVENV-TEST-FILE-TAKES-NO-TAO-FILE-OR-TEST-NAME — `test-file` takes no Tao test file or test name](<Developer environment upgrades/DEVENV-TEST-FILE-TAKES-NO-TAO-FILE-OR-TEST-NAME.md>) — Candidate
- [DEVENV-TEST-FILE-WRAPPER-REMAINS-AFTER-FAILED-SUITE — Test-file wrapper remains after a failed suite reports](<Developer environment upgrades/DEVENV-TEST-FILE-WRAPPER-REMAINS-AFTER-FAILED-SUITE.md>) — Candidate
- [DEVENV-TEST-RUNS-CANNOT-BE-CPU-PROFILED — Test runs cannot be CPU-profiled](<Developer environment upgrades/DEVENV-TEST-RUNS-CANNOT-BE-CPU-PROFILED.md>) — Candidate
- [DEVENV-VISUAL-REVIEW-SCENARIO-READINESS-TIMEOUTS — Visual review scenario readiness timeouts](<Developer environment upgrades/DEVENV-VISUAL-REVIEW-SCENARIO-READINESS-TIMEOUTS.md>) — Candidate
- [DEVENV-WATCHOS-SWIFT-PROBE-FAILS-UNDER-BROAD-LANES — watchOS Swift probe fails under broad lanes](<Developer environment upgrades/DEVENV-WATCHOS-SWIFT-PROBE-FAILS-UNDER-BROAD-LANES.md>) — Candidate
