# Developer environment upgrades

This is the one durable backlog for repository setup, automation, verification, worktree,
diagnostic, and host-environment improvements. Product defects belong in their product roadmap;
an entry here may link one when the developer workflow is also affected.

Every entry is its own file under [`Developer environment upgrades/`](<Developer environment upgrades/>),
named `DEVENV-NNN-<slug>.md`. This page is the index: one line per entry, in its section, with the
status the entry itself records. `_repo-lint` fails when an entry file is missing from this index,
when the index names a file that does not exist, or when two files claim the same ID.

This page indexes **open** work only. An addressed entry moves to
[`Developer environment upgrades archive.md`](<Developer environment upgrades archive.md>) and its file
to `Developer environment upgrades/Archive/`, in the change that addressed it. Search both before
adding an entry, and count both when choosing an ID.

## Agent entry rules

- Search by ID, symptom, command, and area before adding an entry. Update the existing entry instead
  of appending a duplicate.
- The owning agent consolidates updates once after delegated findings return; subagents do not edit
  this backlog independently. Keep evidence concise: an entry file is private to its branch, but this
  index is shared, so every entry still costs exactly one shared line.
- A new entry is a new file. Write `Developer environment upgrades/DEVENV-NNN-<slug>.md` with the
  entry as its `# DEVENV-NNN — Title` heading and body, and add its one line to the section below.
  Never renumber an existing entry: its ID is quoted from other documents and from commit messages.
- Choose `NNN` as one past the highest ID that exists on `main` across this index and the archive,
  not one past the highest in your own worktree — a branch that has been open a while is behind. Two branches can still choose the same
  number, and because each entry is its own file that collision merges silently; `_repo-lint` is what
  catches it. Whoever resolves it renames the **later-merged** file and its index line, and fixes any
  reference written in that same branch. Nothing else moves.
- Record only observed problems or credible improvements with concrete evidence; ordinary product
  failures do not belong here.
- Record: **Status**, **Area**, **Impact**, **Evidence**, **Workaround**, **Proposed change**,
  **Dependencies**, **Acceptance**, and **Source**. Use `None` when there is genuinely no workaround
  or dependency.
- Statuses are `Candidate`, `Planned`, `In progress`, `Incoming`, and `Blocked`. `Incoming` means
  another unmerged branch owns the fix; re-verify it after that branch lands before resolving it.
  `Resolved` and `Closed` entries do not live here: setting either status is what moves the entry to
  the archive, in the same change. The `devenv-upgrades` skill owns how entries are chosen, worked,
  and archived.
- Keep the index line's status in step with the entry's own `**Status:**` when you change it; that is
  the one fact stated in two places, and `_repo-lint` does not read it for you.
- A task that adds or materially updates an entry links this index once in its handoff. A task that
  changes nothing here says nothing about developer-environment feedback.

## Incoming fixes — do not duplicate

- [DEVENV-010 — Preview publication and per-session bundler cache](<Developer environment upgrades/DEVENV-010-preview-publication-and-per-session-bundler-cache.md>) — Incoming
- [DEVENV-011 — Preview and native-launch diagnosis](<Developer environment upgrades/DEVENV-011-preview-and-native-launch-diagnosis.md>) — Incoming
- [DEVENV-012 — Companion endpoint and harness correctness](<Developer environment upgrades/DEVENV-012-companion-endpoint-and-harness-correctness.md>) — Incoming
- [DEVENV-013 — Repository-owned Expo cache and fast smoke failure](<Developer environment upgrades/DEVENV-013-repository-owned-expo-cache-and-fast-smoke-failure.md>) — Incoming
- [DEVENV-014 — Interaction-test cleanup and durable manual QA](<Developer environment upgrades/DEVENV-014-interaction-test-cleanup-and-durable-manual-qa.md>) — Incoming

## Deferred project — begin after the large branches land

- [DEVENV-015 — Reliable host-browser verification](<Developer environment upgrades/DEVENV-015-reliable-host-browser-verification.md>) — Planned
- [DEVENV-016 — Studio process ownership and status](<Developer environment upgrades/DEVENV-016-studio-process-ownership-and-status.md>) — Planned
- [DEVENV-017 — Studio snapshot command consistency](<Developer environment upgrades/DEVENV-017-studio-snapshot-command-consistency.md>) — Planned
- [DEVENV-018 — Semantic facts and coverage commands](<Developer environment upgrades/DEVENV-018-semantic-facts-and-coverage-commands.md>) — Planned
- [DEVENV-019 — Idempotent workspace opening](<Developer environment upgrades/DEVENV-019-idempotent-workspace-opening.md>) — Planned
- [DEVENV-020 — Companion lifecycle and diagnostics](<Developer environment upgrades/DEVENV-020-companion-lifecycle-and-diagnostics.md>) — Planned
- [DEVENV-021 — Safe scratch scripts and concurrent staging](<Developer environment upgrades/DEVENV-021-safe-scratch-scripts-and-concurrent-staging.md>) — Planned
- [DEVENV-022 — Raw Error policy for failure mocks](<Developer environment upgrades/DEVENV-022-raw-error-policy-for-failure-mocks.md>) — Planned
- [DEVENV-023 — React Native test renderer convention](<Developer environment upgrades/DEVENV-023-react-native-test-renderer-convention.md>) — Planned
- [DEVENV-024 — Branch-local semantic cleanup](<Developer environment upgrades/DEVENV-024-branch-local-semantic-cleanup.md>) — Blocked

## External and observational findings

- [DEVENV-031 — Intermittent inspection-output anomalies](<Developer environment upgrades/DEVENV-031-intermittent-inspection-output-anomalies.md>) — Candidate
- [DEVENV-033 — Conflicting color-mode warning noise](<Developer environment upgrades/DEVENV-033-conflicting-color-mode-warning-noise.md>) — Candidate
- [DEVENV-034 — Bun worker-pool test scheduling](<Developer environment upgrades/DEVENV-034-bun-worker-pool-test-scheduling.md>) — Candidate
- [DEVENV-036 — Critical-path verification startup and host-wait concurrency](<Developer environment upgrades/DEVENV-036-critical-path-verification-startup-and-host-wait-concurrency.md>) — In progress
- [DEVENV-038 — Machine-lane lease age uses mismatched clocks](<Developer environment upgrades/DEVENV-038-machine-lane-lease-age-uses-mismatched-clocks.md>) — Candidate
- [DEVENV-039 — Native Studio launch resolves the generated app before it is written](<Developer environment upgrades/DEVENV-039-native-studio-launch-resolves-the-generated-app-before-it-is.md>) — Candidate
- [DEVENV-040 — Bun dependency recovery conflicts with protected package fixtures](<Developer environment upgrades/DEVENV-040-bun-dependency-recovery-conflicts-with-protected-package-fix.md>) — Candidate
- [DEVENV-042 — Studio smoke observes persistence before browser reconciliation](<Developer environment upgrades/DEVENV-042-studio-smoke-observes-persistence-before-browser-reconciliat.md>) — In progress
- [DEVENV-045 — Agent shell habits route routine commands through harness review](<Developer environment upgrades/DEVENV-045-agent-shell-habits-route-routine-commands-through-harness-re.md>) — In progress
- [DEVENV-046 — The tao-apps suite is one 22-second process on the test critical path](<Developer environment upgrades/DEVENV-046-the-tao-apps-suite-is-one-22-second-process-on-the-test-crit.md>) — Candidate
- [DEVENV-047 — Release-bundle proof shares Metro's cache with every other worktree](<Developer environment upgrades/DEVENV-047-release-bundle-proof-shares-metro-s-cache-with-every-other-w.md>) — Candidate
- [DEVENV-048 — A fresh linked worktree cannot launch Studio until the parser is generated](<Developer environment upgrades/DEVENV-048-a-fresh-linked-worktree-cannot-launch-studio-until-the-parse.md>) — Candidate
- [DEVENV-049 — A fresh worktree cannot run `./tao` until the parser is generated](<Developer environment upgrades/DEVENV-049-a-fresh-worktree-cannot-run-tao-until-the-parser-is-generate.md>) — Candidate
- [DEVENV-050 — `tao test` under a Git-ignored path says "No Tao tests found" without the reason](<Developer environment upgrades/DEVENV-050-tao-test-under-a-git-ignored-path-says-no-tao-tests-found-wi.md>) — Candidate
- [DEVENV-051 — `sips` exits 13 inside the Claude Code Bash sandbox](<Developer environment upgrades/DEVENV-051-sips-exits-13-inside-the-claude-code-bash-sandbox.md>) — Candidate
- [DEVENV-052 — `bun --tsconfig-override` fails for scripts outside the repository](<Developer environment upgrades/DEVENV-052-bun-tsconfig-override-fails-for-scripts-outside-the-reposito.md>) — Candidate
- [DEVENV-055 — No repository command compiles a native module](<Developer environment upgrades/DEVENV-055-no-repository-command-compiles-a-native-module.md>) — Candidate
- [DEVENV-053 — Verifying a sibling worktree from an agent shell needs unsandboxed commands](<Developer environment upgrades/DEVENV-053-verifying-a-sibling-worktree-from-an-agent-shell-needs-unsan.md>) — Candidate
- [DEVENV-057 — `git hash-object --stdin-paths` cannot hash a directory symlink](<Developer environment upgrades/DEVENV-057-git-hash-object-stdin-paths-cannot-hash-a-directory-symlink.md>) — Candidate
- [DEVENV-058 — The CLI's bundled `@tao/*` module directory is never filled](<Developer environment upgrades/DEVENV-058-the-cli-s-bundled-tao-module-directory-is-never-filled.md>) — Candidate
- [DEVENV-059 — Xcode 27 runtime installation can strand Apple device services](<Developer environment upgrades/DEVENV-059-xcode-27-runtime-installation-can-strand-apple-device-servic.md>) — Incoming
- [DEVENV-060 — One denied host probe crashes the capabilities report](<Developer environment upgrades/DEVENV-060-one-denied-host-probe-crashes-the-capabilities-report.md>) — Incoming
- [DEVENV-061 — `bun test` from the repository root loses subprocess output](<Developer environment upgrades/DEVENV-061-bun-test-from-the-repository-root-loses-subprocess-output.md>) — Candidate
- [DEVENV-062 — The default Codex profile cannot refresh its generated Codex configuration](<Developer environment upgrades/DEVENV-062-the-default-codex-profile-cannot-refresh-its-generated-codex.md>) — Candidate
- [DEVENV-063 — Studio preview needs the materialized Watchman profile in managed task shells](<Developer environment upgrades/DEVENV-063-studio-preview-needs-the-materialized-watchman-profile-in-ma.md>) — Candidate
- [DEVENV-064 — Generated-artifact cleanup is denied after files gain macOS provenance](<Developer environment upgrades/DEVENV-064-generated-artifact-cleanup-is-denied-after-files-gain-macos.md>) — In progress
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
- [DEVENV-088 — `merge-with-main`'s preflight cannot reach `origin` from inside the sandbox](<Developer environment upgrades/DEVENV-088-merge-with-main-s-preflight-cannot-reach-origin-from-inside-the-sandbox.md>) — Candidate
- [DEVENV-089 — `finalize` overwrites a reviewed merge message](<Developer environment upgrades/DEVENV-089-finalize-overwrites-a-reviewed-merge-message.md>) — Candidate
- [DEVENV-090 — A stale generated parser fails `runtime-jest` without naming itself](<Developer environment upgrades/DEVENV-090-a-stale-generated-parser-fails-runtime-jest-without-naming-i.md>) — Candidate
- [DEVENV-091 — A dependency tree can be unusable while every health check passes](<Developer environment upgrades/DEVENV-091-a-dependency-tree-can-be-unusable-while-every-health-check-p.md>) — Candidate
- [DEVENV-093 — Ready branches convoy behind each other, each re-verifying the whole tree](<Developer environment upgrades/DEVENV-093-landing-branches-convoy-behind-each-other.md>) — Candidate
- [DEVENV-094 — Simultaneous worktree finalizations collapse verification throughput](<Developer environment upgrades/DEVENV-094-simultaneous-finalizations-collapse-verification-throughput.md>) — Candidate
- [DEVENV-096 — The devenv Bun cannot produce a runnable compiled binary on macOS 27](<Developer environment upgrades/DEVENV-096-the-devenv-bun-cannot-produce-a-runnable-compiled-binary.md>) — Candidate
- [DEVENV-097 — Verification in a freshly created worktree can never hit a green record](<Developer environment upgrades/DEVENV-097-verification-in-a-freshly-created-worktree-can-never-hit-a-green.md>) — Candidate
- [DEVENV-098 — No command reclaims dead worktrees and merged branches](<Developer environment upgrades/DEVENV-098-no-command-reclaims-dead-worktrees-and-merged-branches.md>) — Candidate
