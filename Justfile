set quiet

WORD_FLOWER_APP := justfile_directory() + "/Apps/WordFlower/1 - Current/WordFlower.tao"
IDE_EXTENSION_VSIX := justfile_directory() + "/.artifacts/build/tao-ide-extension.vsix"
LOCAL_INSTANTDB_APP_ID := "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
LOCAL_INSTANTDB_DIR := justfile_directory() + "/packages/services/tao-cloud/tao-cloud-src/local"
LOCAL_INSTANTDB_COMPOSE := "docker compose --project-name tao-local-instantdb --file \"" + LOCAL_INSTANTDB_DIR + "/docker-compose.yml\""
VERIFY_FULL_GATES := "_fix-dprint _fix-tao _fix-just-fmt _fix-ledger-index _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test _runtime-pack-check _doctor-json dead-exports ship-bundle-proof studio-smoke studio-proof-real-app studio-smoke-simulated-user keyboard-navigation-smoke studio-dialog-browser studio-agent-browser studio-network-simulation studio-smoke-native studio-canary"
VERIFY_FULL_SKIPPED := ""

# Print available recipes
help:
    just --list

# The private setup recipe is what every harness reaches through `./agent setup`: Worktrunk's pre-start hook
# (.config/wt.toml), the harness SessionStart hooks (.rulesync/hooks.jsonc), and
# Cursor's worktree setup (.cursor/worktrees.json). Changing what setup does changes them all.
_setup: _deps _agent-config _git-hooks

# Configure this checkout and GitHub CLI for HTTPS Git authentication
[group('Setup')]
github-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    git config --global --unset-all 'url.git@github.com:.insteadOf' 2>/dev/null || true
    git config --global --unset-all 'url.ssh://git@github.com/.insteadOf' 2>/dev/null || true
    git config --global --replace-all 'url.https://github.com/.insteadOf' 'git@github.com:'
    git config --global --add 'url.https://github.com/.insteadOf' 'ssh://git@github.com/'
    if ! gh auth status --hostname github.com >/dev/null 2>&1; then
      gh auth login --hostname github.com --git-protocol https --web
    fi
    gh config set git_protocol https --host github.com
    gh auth setup-git --hostname github.com
    git remote set-url origin https://github.com/marcuswestin/tao-lang-2.git
    git ls-remote --exit-code origin refs/heads/main >/dev/null
    printf 'GitHub HTTPS authentication is ready for %s.\n' "$(git remote get-url origin)"

# Decrypt the repository secrets into .env.secrets; `add <KEY>`, `list`, or `setup` to manage them
[group('Setup')]
secrets *ARGS:
    ./dev secrets {{ ARGS }}

# Launch the agent harness with the Bash sandbox off; switch a running session with /sandbox
[group('Sessions')]
session-unsandboxed *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.unsandboxed.json" {{ ARGS }}

# Launch the agent harness in read-only planning mode
[group('Sessions')]
session-review *ARGS:
    claude --permission-mode plan {{ ARGS }}

# Launch the agent harness with opt-in Docker access for the local InstantDB stack
[group('Sessions')]
session-local-services *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.local-services.json" {{ ARGS }}

# Launch the agent harness with prompted native-device commands and native build directories
[group('Sessions')]
session-native *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.native.json" {{ ARGS }}

# Launch the agent harness with prompted signing/notarization tools and Xcode release directories
[group('Sessions')]
session-release *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.release.json" {{ ARGS }}

# Start the official self-hosted InstantDB stack and provision WordFlower's local app
[group('Run')]
start-local-instantdb:
    {{ LOCAL_INSTANTDB_COMPOSE }} up --detach --wait
    {{ LOCAL_INSTANTDB_COMPOSE }} exec -T postgres psql --set ON_ERROR_STOP=1 --username instant --dbname instant --set app_id="{{ LOCAL_INSTANTDB_APP_ID }}" --file /dev/stdin < "{{ LOCAL_INSTANTDB_DIR }}/seed-app.sql"
    echo "InstantDB is ready at http://localhost:9020 (dashboard: http://localhost:3000)"

# Stop local InstantDB while preserving its database and object-storage volumes
[group('Run')]
stop-local-instantdb:
    {{ LOCAL_INSTANTDB_COMPOSE }} down

# Launch Tao Studio against a project folder; HNReader by default, whose project names its DefaultApp
[group('Run')]
studio project="Apps/HNReader": _parser-gen
    ./dev studio "{{ project }}"

# Launch Tao Studio in its local Electrobun shell; offers to stop another session holding the native host
[group('Run')]
studio-native project="Apps/HNReader": _parser-gen
    ./dev studio-native "{{ project }}"

# Install the Tao Companion development build on a connected iPhone or iPad, once per native change
[group('Run')]
studio-companion-install device="":
    ./dev studio-companion-install --device "{{ device }}"

# Install the Tao Companion development build on an iOS simulator; no phone, pairing, or unlock needed
[group('Run')]
studio-companion-simulator simulator="":
    ./dev studio-companion-install --simulator "{{ simulator }}"

# Build the Tao Companion as a prebuilt host (--platform ios-simulator for the simulator); tao dev opens apps in it
[group('Run')]
companion-host-build *ARGS:
    ./dev companion-host-build {{ ARGS }}

# Publish the built Companion hosts to their GitHub release, where tao dev downloads them; needs gh
[group('Run')]
companion-host-publish:
    ./dev companion-host-publish

# Run the opt-in real-host testing prototype; does not run or replace the existing suites
[group('Host proofs')]
test-host *ARGS:
    ./dev test-host {{ ARGS }}

# Run an explicit slow Studio smoke file in an isolated lane
[group('Host proofs')]
studio-smoke test_file="packages/ides/studio-tooling/studio-smoke/studio-launch.test.ts" run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" "{{ test_file }}"

# Run an explicit slow Studio shell smoke through Electrobun
[group('Host proofs')]
studio-smoke-native test_file="packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts" run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" "{{ test_file }}"

# Prove semantic host control against the owned native Studio shell
[group('Host proofs')]
studio-host-control-smoke run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" packages/ides/studio-tooling/studio-smoke/studio-host-control.test.ts

# Probe external Studio accessibility and physical input through Appium Mac2
[group('Host proofs')]
studio-mac2-acceptance run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" packages/ides/studio-tooling/studio-smoke/studio-mac2-acceptance.test.ts

# Prove Studio compile/edit/undo against the real HNReader app
[group('Host proofs')]
studio-proof-real-app run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts

# Export WordFlower and prove its physical keyboard path in real headless Chrome
[group('Host proofs')]
keyboard-navigation-smoke run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" --worker 4 packages/ides/studio-tooling/studio-smoke/runtime-keyboard-navigation.test.ts

# Run native Tao Studio against a deterministic project and report what it proved
[group('Host proofs')]
studio-canary project="Apps/HNReader" app="HNReader":
    ./dev studio-canary --project "{{ project }}" --app "{{ app }}"

# Export real release and Studio-preview iOS bundles and prove only the preview carries Studio code
[group('Host proofs')]
ship-bundle-proof:
    bun run packages/apps/expo-host/expo-host-src/testing/verify-release-bundle.ts

# Compile every repository native module for the iOS simulator; intentionally outside routine verification
[group('Host proofs')]
native-module-check:
    ./dev native-module-check

# Run the native Studio checks that require a person; never part of test or verify
[group('Host proofs')]
studio-manual-checks project="Apps/HNReader" app="HNReader":
    ./dev studio-manual-checks --project "{{ project }}" --app "{{ app }}"

# Validate a built native Studio release without publishing anything
[group('Ship')]
studio-release-check payload_root=".artifacts/build/studio-native/service-stage/payload" artifacts_root=".artifacts/build/studio-native/project/artifacts" *ARGS:
    ./dev studio-release-check --payload-root "{{ payload_root }}" --artifacts-root "{{ artifacts_root }}" {{ ARGS }}

# Build signed/notarized Tao Studio artifacts through Electrobun and Hutch
[group('Ship')]
studio-package release_base_url=env("TAO_STUDIO_RELEASE_BASE_URL") channel="stable" output_root=".artifacts/build/studio-native" version="0.0.1":
    ./dev package-studio-native --release-base-url "{{ release_base_url }}" --channel "{{ channel }}" --output-root "{{ output_root }}" --version "{{ version }}"

# Build signed Studio artifacts and check the app, DMG, update metadata, and isolated payload before upload
[group('Ship')]
studio-release-prepare repo version="0.0.1":
    ./dev release-studio-prepare --repo "{{ repo }}" --version "{{ version }}"

# Upload the prepared Studio artifacts to a public GitHub Release and verify public download bytes
[group('Ship')]
studio-release-publish repo:
    ./dev release-studio-publish --repo "{{ repo }}"

# Package the IDE extension and prove the VSIX installs in a clean VS Code profile
[group('Ship')]
ide-extension-release-prepare:
    ./dev release-ide-prepare

# Publish the prepared VSIX to both registries; pass open-vsx or marketplace to retry one after a partial failure
[group('Ship')]
ide-extension-release-publish target="all":
    ./dev release-ide-publish --target "{{ target }}"

# Build a standalone Tao binary for this host, with its runtime resources embedded, after generating its parser
[group('Ship')]
standalone-cli-build: _parser-gen
    bun run packages/cli/tao-cli/cli-src/standalone-build.ts .artifacts/build/tao

# Build the files one standalone Tao release publishes, and print the command that publishes them
[group('Ship')]
standalone-cli-release version: _parser-gen
    bun run packages/cli/tao-cli/cli-src/standalone-build.ts --release "{{ version }}"

# Build a release, install it through curl | sh into a throwaway HOME, and prove create, check, compile, and build --compile-only work with no Bun or Node on PATH
[group('Ship')]
standalone-cli-acceptance: _parser-gen
    bun run packages/cli/tao-cli/cli-src/standalone-build.ts --release 0.0.0
    bun run packages/cli/tao-cli/cli-src/standalone-acceptance.ts .artifacts/release/v0.0.0

# Discover and run Tao apps through the Tao CLI dev loop; optionally select one app by name
[group('Dev')]
[positional-arguments]
dev app_path="Apps" APP="":
    ./tao dev "$1" {{ if APP == "" { "" } else { "--app \"$2\"" } }}

# `just test` is the fast default, so it runs the suites this branch's diff reaches rather than all
# of them. Selection is a heuristic over the diff: a run can be green while a suite the change broke
# somewhere else never ran, which is what `test-all` is for and what the description says out loud.
#
# One optional positional means either a path or a test-name pattern, and the difference is decided
# by whether the argument exists on disk, never by how it is spelled — a test name with a slash in it
# and a path that was deleted both resolve the way the filesystem says. The chosen reading is printed
# before the run so a wrong guess is visible in the first line of output instead of in a confusing
# empty result.
#
# A name pattern narrows the same default scope rather than replacing it: `just test "<name>"` is the
# changed suites filtered to that name, not every suite filtered to it. Scope and filter compose, so
# the fast default stays fast and only `test-all` widens it.
# Run the suites this branch's diff reaches; a wider change can still break a suite it never ran, so `test-all` before a merge. One optional target is a test path or a test name
[group('Dev')]
test target="": _compile-word-flower-app
    if [ {{ quote(target) }} = '' ]; then ./dev test-changed; elif [ -e {{ quote(target) }} ]; then printf 'Running tests in %s\n' {{ quote(target) }}; ./dev test-file {{ quote(target) }}; else printf 'Filtering the changed suites to tests matching "%s"\n' {{ quote(target) }}; ./dev test-changed --name {{ quote(target) }}; fi

# Run every test suite, whatever this branch changed; the scope `verify` runs. One optional test-name pattern filters them
[group('Dev')]
test-all pattern="": _compile-word-flower-app
    ./dev test{{ if pattern == "" { "" } else { " " + quote(pattern) } }}

# Run tests selected by changes since a ref; defaults to this branch's main merge base
[group('Dev')]
test-changed ref="": _compile-word-flower-app
    ./dev test-changed {{ if ref == "" { "" } else { "\"" + ref + "\"" } }}

# Run one package Bun or runtime Jest test file, or every test file under a directory
[group('Dev')]
test-file path: _compile-word-flower-app
    ./dev test-file "{{ path }}"

# Re-run files that are not green since this checkout's latest complete test run
[group('Dev')]
test-retry: _compile-word-flower-app
    ./dev test-retry

# `retry` is the spelling to type and `test-retry` is the spelling to discover: the test family
# completes together under `just test<TAB>`, and the one command reached for by name after a red run
# does not have to be spelled out. It is a dependency rather than a `just` alias so it carries its
# own group and description into the menu.
# Re-run files that are not green since the latest complete test run; the short name for `test-retry`
[group('Dev')]
retry: test-retry

# A bare `bun test` on a relative path is the thing `./dev test-file` exists to stop: Bun reads it as
# a filter, walks the whole repository to resolve it, and leaves a file descriptor open per visited
# entry, so children spawned by a test inherit an exhausted descriptor table and their piped output
# never arrives. The runner resolves the path and routes it to its owning suite instead.
# Run the focused Tao Studio package suite
[group('Dev')]
test-studio:
    ./dev test-file packages/ides/studio/studio-tests

# Both ledger reports read the same recorded outcomes and answer the same question — which tests to
# distrust — so they are one command rather than two names to remember. One `limit` bounds both
# lists: a developer asking for a longer report wants a longer report, not one of each length.
# Report ledger evidence about the tests themselves: suspected flakes, then the slowest tests
[group('Report')]
report-test-stats limit="20":
    ./dev test-flakes --limit "{{ limit }}"
    echo
    ./dev test-slowest --limit "{{ limit }}"

# Bring a feature branch to ready while iterating; `land` does its own preparation. Safe to re-run
[arg('check', long='check', value='true')]
[arg('fresh', long='fresh', value='true')]
[arg('redraft', long='redraft', value='true')]
finalize check='false' fresh='false' redraft='false':
    ./dev finalize {{ if check == "true" { "--check" } else { "" } }} {{ if fresh == "true" { "--fresh" } else { "" } }} {{ if redraft == "true" { "--redraft" } else { "" } }}

# Merge current main into this feature branch and nothing else; agents use ./agent unsandboxed merge-main when main writes paths the sandbox protects
merge-main:
    ./dev merge-main

# Switch this checkout to your own dev/* branch, creating it from main the first time
[group('Mine')]
my-branch name='':
    ./dev my-branch {{ quote(name) }}

# Fast-forward main, move the mirrors that follow it, and merge it into your branch
[group('Mine')]
my-sync:
    ./dev sync-main

# Hand the merge conflicts in this checkout to an agent (claude or codex), which resolves them, verifies, and commits
[group('Mine')]
my-resolve agent='claude' *ARGS:
    if [ -z "$(git diff --name-only --diff-filter=U)" ]; then printf 'No conflicted files: there is nothing to resolve.\n'; exit 1; fi
    {{ if agent == "claude" { "claude" } else if agent == "codex" { "codex" } else { error("my-resolve takes claude or codex") } }} {{ ARGS }} "Finish the merge that is in progress in this checkout, on branch $(git symbolic-ref --quiet --short HEAD). Resolve every conflicted file on its merits, keeping both sides' intent rather than taking one side wholesale, and preserving work you did not write. Read AGENTS.md first. Then run \`./agent verify\`, and commit the merge with \`git commit --no-edit\` once it is green. Do not land anything on main, do not push, and do not touch other worktrees. Report what you resolved in each file and what the verification said."

# Squash-merge your dev/* branch into main; the same landing agents use, with the same gates
[group('Mine')]
my-land *ARGS:
    ./dev land {{ ARGS }}

# `land` is the whole landing, as one command and one process. It settles readiness and the merge
# message first, unlocked, because those are the parts that may need an author; then it takes the
# machine-wide landing lock once and, inside a single `try`/`finally`, integrates main, runs the
# cheap-gate barrier, verifies, squashes, pushes, archives, and releases. The lock is therefore held
# for the work rather than across the gaps between commands, which is where the 36-44 minute holds
# came from: the merge itself never took more than 94s.
# A conflict while integrating main is the one failure that gives the lock back and stops: resolve it
# here, unlocked, commit the merge, and run `just land` again.
# Land this feature branch: prepare unlocked, then integrate, verify, squash and push under one lock
[arg('dry_run', long='dry-run', value='true')]
[arg('message_file', long='message-file')]
[arg('redraft', long='redraft', value='true')]
[arg('skip_verify', long='skip-verify', value='true')]
[arg('skip_verify_full', long='skip-verify-full', value='true')]
[group('Ship')]
land dry_run='false' message_file='' redraft='false' skip_verify='false' skip_verify_full='false':
    ./dev land {{ if dry_run == "true" { "--dry-run" } else { "" } }} {{ if redraft == "true" { "--redraft" } else { "" } }} {{ if skip_verify == "true" { "--skip-verify" } else { "" } }} {{ if skip_verify_full == "true" { "--skip-verify-full" } else { "" } }} {{ if message_file == "" { "" } else { "--message-file " + quote(message_file) } }}

# The cheap-gate barrier a landing runs first, inside the lock, before anything expensive. It is
# `check` — generation and formatting consistency, repository lint, types — plus `dead-exports`, and
# it is deliberately the CHECK-mode gates rather than the `_fix-*` fixers the verify lanes run: a
# fixer writes to the tree the landing is about to commit, and the landing then refuses itself with
# `Verification changed the tree this landing was about to commit.` A red barrier costs ~30s to
# learn; the suites behind it cost 60-170s more to learn the same thing.
# Run the cheap gates a landing checks before it spends the expensive suites
[group('Dev')]
land-barrier: check dead-exports

# Squash-merge this feature branch into main and push it; flags only remove work, never add it
[arg('abort', long='abort')]
[arg('dry_run', long='dry-run', value='true')]
[arg('message_file', long='message-file')]
[arg('skip_all', long='skip-all', value='true')]
[arg('skip_verify', long='skip-verify', value='true')]
[arg('skip_verify_full', long='skip-verify-full', value='true')]
[group('Ship')]
merge-with-main skip_verify='false' skip_verify_full='false' skip_all='false' dry_run='false' message_file='' abort='':
    ./dev merge-with-main {{ if skip_verify == "true" { "--skip-verify" } else { "" } }} {{ if skip_verify_full == "true" { "--skip-verify-full" } else { "" } }} {{ if skip_all == "true" { "--skip-all" } else { "" } }} {{ if dry_run == "true" { "--dry-run" } else { "" } }} {{ if message_file == "" { "" } else { "--message-file " + quote(message_file) } }} {{ if abort == "" { "" } else { "--abort " + quote(abort) } }}

# Format code, without applying the other Tao source fixes
[group('Dev')]
fmt: _parser-gen
    dprint fmt --incremental=false --excludes "@/" "**/@/**"
    dprint check --incremental=false --allow-no-files "@/**/*" "**/@/**/*"
    ./tao fmt
    just --fmt

# Each harness write-protects its own agent configuration — skills, hooks, settings — against shell
# commands, while allowing the harness's own edit tools, so that a change to an agent's instructions
# reaches a diff somebody reads. A sandboxed `_fix-dprint` therefore fails outright on an unformatted
# skill file (DEVENV-101), and `_agent-config` cannot rewrite generated settings (DEVENV-062). This
# recipe is excluded from the sandbox in `.rulesync/permissions.jsonc` so those two can succeed.
#
# It stays safe to exclude because it takes no paths and writes no content of its own: it formats
# files already in the tree and regenerates files from `.rulesync`, which is reviewed. Neither
# produces instruction text that was not reviewed, which is what the protection is actually for.
# Keep it that way — nothing that runs tests or takes an argument belongs here. The formatter
# plugins resolve from installed local packages, including when dprint's cache is cold.
# Fix the files a sandboxed shell may not write: skill formatting and generated harness config
[group('Dev')]
fix-agent-config:
    dprint fmt --incremental=false --allow-no-files "agents/skills/**/*"
    ./dev agent-config

# Apply every auto-fix, writing to the tree: dprint formatting, Tao source fixes, Justfile formatting
[group('Dev')]
fix: _parser-gen
    dprint fmt --incremental=false --excludes "@/" "**/@/**"
    dprint check --incremental=false --allow-no-files "@/**/*" "**/@/**/*"
    ./tao fix
    just --fmt

# Check all code without changing it or running tests: Tao and dprint canonical source, lint, types. --no-cache ignores a recorded green tree
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
check no_cache='false':
    ./dev gates _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _tao-check _dprint-check _typecheck _runtime-pack-check --lane check --green-tree check {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# Build a VSIX without installing it, for VS Code packager compatibility checks
[group('Dev')]
ide-extension-package: _ide-extension-package

# Run the repository lint on its own
[group('Dev')]
lint: _repo-lint

# Fail on exported symbols nothing imports; a gate in verify and verify-full
[group('Dev')]
dead-exports:
    bun run packages/testing/verification/verification-src/DeadExports.ts

# Diagnose this checkout without changing it; pass --json for a structured report
[group('Report')]
doctor *ARGS:
    ./dev doctor {{ ARGS }}

# The landing lock is the one turn-taking primitive, and `land` now takes it for the whole landing
# in one process, so these two are **recovery and debugging tools** rather than part of the normal
# path: claiming the lock by hand before a landing only adds a durable claim the landing does not
# need. Reach for them to hold the machine while investigating, or to give a lock back by hand.
# Nothing reclaims a lock on a timer, by design, so a wedged lock surfaces as a warning naming its
# holder rather than as a takeover — `land-unlock --force` is the person-shaped way out.
# `just` splits `*ARGS` on whitespace, so a multi-word `--label` has to go through `./dev land-lock`
# directly; the default label names this worktree, which is what a waiting agent needs anyway.
# Recovery and debugging: claim the machine-wide landing lock by hand and exit holding it
[group('Dev')]
land-lock *ARGS:
    ./dev land-lock {{ ARGS }}

# Recovery and debugging: release the machine-wide landing lock this worktree holds
[group('Dev')]
land-unlock *ARGS:
    ./dev land-unlock {{ ARGS }}

# Report every worktree, the machine-wide lane and lease registry, and whether this machine is busy
[group('Dev')]
board *ARGS:
    ./dev board {{ ARGS }}

# Report whether a branch landed, by the archive ref a landing pushes rather than by command output
[group('Dev')]
landed *ARGS:
    ./dev landed {{ ARGS }}

# Classify worktrees without removal by default; use ./agent unsandboxed reclaim --execute to remove
[group('Dev')]
reclaim *ARGS:
    ./dev reclaim {{ ARGS }}

# List each worktree with its reclaim verdict and latest attached agent task
[group('Report')]
worktree-status:
    ./dev worktree-status

# Push this feature branch, open or reuse its pull request against main, then stream the checks opening starts
[group('Dev')]
open-pr *ARGS:
    ./dev open-pr {{ ARGS }}

# Report process, socket, simulator, and local-service capabilities without changing anything
[group('Report')]
capabilities *ARGS:
    ./dev capabilities {{ ARGS }}

# Summarise which subagents were spawned, at which model, and for how long
[group('Report')]
delegation-report *ARGS:
    ./dev delegation-report {{ ARGS }}

# Report where the delegation routing table lags the models this machine runs, and measure context
[group('Report')]
model-audit *ARGS:
    ./dev model-audit {{ ARGS }}

# Measure what a simplification pass targets: size, dispatch chains, allowlists, instructions, docs
[group('Report')]
simplify-audit *ARGS:
    ./dev simplify-audit {{ ARGS }}

# Benchmark cold and steady-state language-service performance; fails when a steady-state median passes its budget
[group('Report')]
bench iterations="10":
    bun run packages/cli/dev-cli/dev-cli-src/performance/language-performance.ts "{{ iterations }}"

# Measure machine-wide lane admission against DEVENV-094's bar; agents use ./agent unsandboxed admission-experiment on a quiet machine. --provision <count> makes and removes its own checkouts
[group('Report')]
admission-experiment *ARGS:
    bun run packages/cli/dev-cli/dev-cli-src/performance/admission-experiment.ts {{ ARGS }}

# Compile a Tao app path relative to the invocation directory into the local runtime host
[group('Run')]
compile-app app_path: _parser-gen
    ./tao compile "{{ app_path }}"

# Build and install the IDE extension into local editor apps
[group('Run')]
install-ide-extension: _ide-extension-package
    if command -v cursor >/dev/null 2>&1; then cursor --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi
    if command -v code >/dev/null 2>&1; then code --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi
    if command -v antigravity >/dev/null 2>&1; then antigravity --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi

# Compile WordFlower, launch an Android emulator, and start the Expo runtime on Android.
[group('Run')]
android: _compile-word-flower-app _android-emulator _android-expo-go
    bun run packages/cli/dev-cli/dev-cli-src/dev.ts expo-android

# Reclaim bootstrap scratch a failed dependency install abandoned, reporting what it freed
[group('Setup')]
clean-scratch:
    zsh -c 'source "{{ justfile_directory() }}/packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh"; tao_prune_bootstrap_scratch "{{ justfile_directory() }}/.artifacts/tmp" --report'

# Clean run dependencies and build artifacts
[group('Setup')]
clean: clean-scratch
    ./dev clean

# `clean-all` removes what `clean` removes and then the rest. It runs those same steps in one
# command rather than depending on `clean`, so the whole run reports as one sequence of steps;
# scratch is still reclaimed first, by the same dependency `clean` uses.
# Run clean + clean ALL artifacts
[group('Setup')]
clean-all: clean-scratch
    ./dev clean --all

# The four verification scopes are four names rather than one name and three flags, because a name
# completes under `just v<TAB>` while a flag has to be remembered. They sort into the order they
# widen in — `verify`, `verify-changed`, `verify-full`, `verify-full-sandbox` — and share every gate
# but the test gate and the host lanes. Each records the tree it proved green under its own lane
# name and stands on a record from any lane whose gates contain its own, which is why the
# `--green-tree` lists differ. `--no-cache` is the one flag they all take: it is orthogonal to scope,
# choosing whether recorded evidence is trusted at all rather than which gates run. It is named for
# what it does to the cache of recorded verdicts, and matches the `TAO_TEST_NO_CACHE` key the graph
# already exports; it deletes nothing, which is what `clean` is for.
#
# `--complete` remains accepted on `verify` as the explicit spelling of what bare `verify` already
# does, because the merge command and the repository's instructions name it that way.
# Verify everything: fix, check, and every test suite. --no-cache ignores a recorded green tree
[arg('complete', long='complete', value='true')]
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
verify complete='false' no_cache='false': _deps
    ./dev gates _fix-dprint _fix-tao _fix-just-fmt _fix-ledger-index _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test _runtime-pack-check dead-exports --lane verify --json .artifacts/logs/verify/summary.json --skipped "studio-smoke=slow lane; run ./agent studio-smoke or ./agent verify-full" --green-tree verify verify-full-sandbox verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# Verify narrowed to the suites the branch diff reaches: the iteration gate, never merge evidence. --no-cache ignores a recorded green tree
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
verify-changed no_cache='false': _deps
    ./dev gates _fix-dprint _fix-tao _fix-just-fmt _fix-ledger-index _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test-changed _runtime-pack-check dead-exports --lane verify-changed --json .artifacts/logs/verify-changed/summary.json --skipped "studio-smoke=slow lane; run ./agent studio-smoke or ./agent verify-full" --green-tree verify-changed verify verify-full-sandbox verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# This lane no longer refuses to start beside another one. The gates that genuinely cannot share a
# host — the native shell and the canary, which contend on the window server — declare `gui` in the
# catalog and take a machine-wide lease for exactly as long as they run. Everything else here is
# headless and parallel-safe, so refusing the whole lane priced six gates at the cost of two.
# Verify everything plus browser, native and bundle lanes; stop starting checks after a definite failure. --no-cache ignores a recorded green tree
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
verify-full no_cache='false': _deps
    ./dev gates {{ VERIFY_FULL_GATES }} --lane verify-full {{ if VERIFY_FULL_SKIPPED == "" { "" } else { "--skipped \"" + VERIFY_FULL_SKIPPED + "\"" } }} --green-tree verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# Run verify-full's gate membership in a managed shell, skipping the host-only lanes and claiming nothing about them. --no-cache ignores a recorded green tree
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
verify-full-sandbox no_cache='false':
    ./dev gates {{ VERIFY_FULL_GATES }} --skip-unsandboxed --lane verify-full-sandbox {{ if VERIFY_FULL_SKIPPED == "" { "" } else { "--skipped \"" + VERIFY_FULL_SKIPPED + "\"" } }} --green-tree verify-full-sandbox verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# `verify-repo` is the end of the widening order, past where a scope can go: it is the only entry
# that gives up every shortcut the others keep. `clean` removes the build outputs and the generated
# trees, `verify-full --no-cache` then rebuilds and re-runs all of it rather than standing on a green
# record, and `studio-manual-checks` adds the judgments only a person can make. What survives is the
# flake ledger under `.artifacts/testing`, which is history rather than a shortcut and which only
# `clean-all` removes. It composes the three existing recipes rather than restating their gate lists,
# so widening `verify-full` widens this too.
#
# It stops for a person partway through, so it is not a lane an agent or CI can run to completion,
# and it is not `--no-cache` on a name: a flag would have to be remembered, and this one has to be
# chosen deliberately anyway.
# Everything, slowest first to last: delete artifacts, verify-full against nothing cached, then the checks that need a person at the keyboard. Reach for it when a green may be stale, or before a release
[group('Dev')]
verify-repo: clean (verify-full "true") studio-manual-checks

# Private
#########

# The doctor's own versioned report, so the node's log is the artifact
_doctor-json:
    ./dev doctor --json

_agent-config:
    ./dev agent-config

_deps:
    zsh packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh "{{ justfile_directory() }}" --health

_git-hooks:
    ./packages/cli/agent-cli/agent-cli-src/cli/agent-git-hooks.zsh install

_dependency-health:
    bun run packages/testing/verification/verification-src/DependencyHealth.ts

# The three fix steps, each over its own file class, as the verify graph runs them
_fix-dprint:
    #!/usr/bin/env zsh
    # A sandboxed shell may not write a harness's own agent configuration, so an unformatted skill
    # file fails this gate with `Operation not permitted` and nothing saying what to do (DEVENV-101).
    # The denial is named here rather than left for the reader to recognise.
    set -e -o pipefail
    # `status` is read-only in zsh, being its own name for `?`.
    out="$(dprint fmt --incremental=false --excludes "@/" "**/@/**" 2>&1)" && code=0 || code=$?
    print -r -- "$out"
    if [[ $code -ne 0 && "$out" == *"Operation not permitted"* ]]; then
      print -u2 -r -- "The sandbox write-protects the paths above, which is why formatting them failed."
      print -u2 -r -- "Run \`./agent fix-agent-config\` (excluded from the sandbox) and re-run this gate."
    fi
    [[ $code -eq 0 ]]
    dprint check --incremental=false --allow-no-files "@/**/*" "**/@/**/*"

_fix-tao: _parser-gen
    ./tao fix

_fix-just-fmt:
    just --fmt

# Both developer-environment index pages are generated from the entry files; never hand-edit them.
_fix-ledger-index:
    bun run packages/testing/verification/verification-src/fix-ledger-index.ts

_runtime-pack-check:
    bun run packages/testing/verification/verification-src/runtime-package-pack.ts

# `CompileApp.ts` stamps and then delegates to `./tao compile`. Four test recipes and both verify
# lanes depend on this gate, so an unconditional 2.7s compile was paid before a single test could
# start; the stamp skips it while the sources it reads and the tree it wrote are unchanged. It runs
# as a module rather than through `./dev`, matching `_parser-gen`: nobody types a private recipe, so
# the discoverable command bought nothing and cost `./dev`'s boot on every run.
_compile-word-flower-app: _parser-gen
    bun run packages/testing/verification/verification-src/CompileApp.ts "{{ WORD_FLOWER_APP }}" --app WordFlower

_ide-extension-build: _parser-gen
    cd packages/ides/ide-extension && bun esbuild.config.ts

_ide-extension-package: _parser-gen
    mkdir -p .artifacts/build
    cd packages/ides/ide-extension && bun esbuild.config.ts --minify
    cd packages/ides/ide-extension && bunx @vscode/vsce package --no-dependencies --out "{{ IDE_EXTENSION_VSIX }}" 1> /dev/null

_tao-check: _parser-gen
    ./tao check

_dprint-check:
    dprint check --incremental=false
    just --fmt --check

_repo-lint:
    bun run packages/cli/dev-cli/dev-cli-src/repo-lint-entry.ts

# TypeScript 7's native compiler, installed under the `typescript-native` npm alias: the same
# build takes ~2s where `typescript` 5.9 takes ~17s. `typescript` itself stays at 5.9 because the
# editor's tsserver and `bunx tsc` still need its JavaScript API, which 7.0 does not ship.
_typecheck:
    bun node_modules/typescript-native/bin/tsc --build packages/*/tsconfig.json packages/*/*/tsconfig.json

# `just test`'s own runner. In a lane's gate list, `_test` and `_test-changed` are not recipes at
# all: `./dev gates` replaces each with one node per test suite and per shard of a long suite, so the
# suites a verification lane schedules are the same nodes `./dev test` schedules. There is no
# `_test-changed` recipe for that reason — nothing would ever run it.
_test PATTERN="":
    bun run packages/cli/dev-cli/dev-cli-src/dev.ts test "{{ PATTERN }}"

_android-emulator:
    bun run packages/cli/dev-cli/dev-cli-src/dev.ts android-emulator

_android-expo-go:
    bun run packages/cli/dev-cli/dev-cli-src/dev.ts android-expo-go

_parser-gen:
    bun run packages/testing/verification/verification-src/ParserGenerate.ts
