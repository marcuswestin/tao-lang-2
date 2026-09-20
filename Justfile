set quiet

WORD_FLOWER_APP := justfile_directory() + "/Apps/WordFlower/1 - Current/WordFlower.tao"
IDE_EXTENSION_VSIX := justfile_directory() + "/.artifacts/build/tao-ide-extension.vsix"
BUN_CACHE_DIR := justfile_directory() + "/.artifacts/cache/bun"
BUN_TMP_DIR := justfile_directory() + "/.artifacts/tmp/bun"
LOCAL_INSTANTDB_APP_ID := "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
LOCAL_INSTANTDB_DIR := justfile_directory() + "/config/local-instantdb"
LOCAL_INSTANTDB_COMPOSE := "docker compose --project-name tao-local-instantdb --file \"" + LOCAL_INSTANTDB_DIR + "/docker-compose.yml\""
VERIFY_FULL_GATES := "_fix-dprint _fix-tao _fix-just-fmt _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test _runtime-pack-check _doctor-json dead-exports ship-bundle-proof studio-smoke studio-proof-real-app studio-smoke-simulated-user keyboard-navigation-smoke studio-dialog-browser studio-agent-browser studio-smoke-native studio-canary"
VERIFY_FULL_SKIPPED := ""

# Print available recipes
help:
    just --list

# `just setup` is what every harness runs through `./agent setup`: Worktrunk's pre-start hook
# (.config/wt.toml), the harness SessionStart hooks (.rulesync/hooks.jsonc), and
# Cursor's worktree setup (.cursor/worktrees.json). Changing what setup does changes them all.
# Setup dependencies and generated agent adapters
[group('Setup')]
setup: deps _agent-config

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
studio project="Apps/HNReader":
    ./dev studio "{{ project }}"

# Launch Tao Studio in its local Electrobun shell; offers to stop another session holding the native host
[group('Run')]
studio-native project="Apps/HNReader":
    ./dev studio-native "{{ project }}"

# Install the Tao Companion development build on a connected iPhone or iPad, once per native change
[group('Run')]
studio-companion-install device="":
    ./dev studio-companion-install --device "{{ device }}"

# Install the Tao Companion development build on an iOS simulator; no phone, pairing, or unlock needed
[group('Run')]
studio-companion-simulator simulator="":
    ./dev studio-companion-install --simulator "{{ simulator }}"

# Run the opt-in real-host testing prototype; does not run or replace the existing suites
[group('Host proofs')]
test-host *ARGS:
    ./dev test-host {{ ARGS }}

# Run an explicit slow Studio smoke file in an isolated lane
[group('Host proofs')]
studio-smoke test_file="packages/dev/studio-smoke/studio-launch.test.ts" run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" "{{ test_file }}"

# Run an explicit slow Studio shell smoke through Electrobun
[group('Host proofs')]
studio-smoke-native test_file="packages/dev/studio-smoke/studio-simulated-user.test.ts" run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" "{{ test_file }}"

# Prove Studio compile/edit/undo against the real HNReader app
[group('Host proofs')]
studio-proof-real-app run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" packages/dev/studio-smoke/studio-real-app.test.ts

# Export WordFlower and prove its physical keyboard path in real headless Chrome
[group('Host proofs')]
keyboard-navigation-smoke run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" --worker 4 packages/dev/studio-smoke/runtime-keyboard-navigation.test.ts

# Run native Tao Studio against a deterministic project and report what it proved
[group('Host proofs')]
studio-canary project="Apps/HNReader" app="HNReader":
    ./dev studio-canary --project "{{ project }}" --app "{{ app }}"

# Export real release and Studio-preview iOS bundles and prove only the preview carries Studio code
[group('Host proofs')]
ship-bundle-proof:
    bun run packages/runtime-toolchain/runtime-toolchain-src/testing/verify-release-bundle.ts

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
studio-package release_base_url=env("TAO_STUDIO_RELEASE_BASE_URL") channel="stable" output_root=".artifacts/build/studio-native":
    ./dev package-studio-native --release-base-url "{{ release_base_url }}" --channel "{{ channel }}" --output-root "{{ output_root }}"

# Install development dependencies
# Install dependencies, then repair a partial tree. Bun's own verification only checks that
# package directories exist, so an install stopped partway through reports "no changes" forever;
# `_dependency-health` loads what the entry commands load and is what notices. The repair
# re-extracts from the shared cache first, and only falls back to a cold worktree-local cache
# when the shared one is itself the fault — that fallback re-downloads every package.
#
# A repair fails loudly rather than reporting what the health probe alone can see. `--force`
# deletes before it re-clones, and the few packages shipping `.idea/` or `.gitmodules` cannot be
# deleted inside an agent sandbox, so a sandboxed repair can leave one of them uninstalled while
# every probed module still loads. When that happens, or when one of those packages is itself the
# damaged one, no sandboxed repair can reach it: run `rm -rf node_modules && bun install` from an
# unsandboxed shell.
# Install dependencies and repair a partial dependency tree
[group('Setup')]
deps:
    mkdir -p "{{ BUN_TMP_DIR }}"
    TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile
    if ! just _dependency-health; then TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile --force; if ! just _dependency-health; then mkdir -p "{{ BUN_CACHE_DIR }}"; TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile --force --cache-dir="{{ BUN_CACHE_DIR }}"; just _dependency-health; fi; fi

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
    ./dev test-file packages/studio/studio-tests

# Both ledger reports read the same recorded outcomes and answer the same question — which tests to
# distrust — so they are one command rather than two names to remember. One `limit` bounds both
# lists: a developer asking for a longer report wants a longer report, not one of each length.
# Report ledger evidence about the tests themselves: suspected flakes, then the slowest tests
[group('Report')]
report-test-stats limit="20":
    ./dev test-flakes --limit "{{ limit }}"
    echo
    ./dev test-slowest --limit "{{ limit }}"

# Bring a feature branch to the state where merge-with-main can run; safe and cheap to re-run
[arg('check', long='check', value='true')]
[arg('fresh', long='fresh', value='true')]
finalize check='false' fresh='false':
    ./dev finalize {{ if check == "true" { "--check" } else { "" } }} {{ if fresh == "true" { "--fresh" } else { "" } }}

# Switch this checkout to your own dev/* branch, creating it from main the first time
[group('Mine')]
my-branch name='':
    ./dev my-branch {{ quote(name) }}

# Fast-forward main, move the mirrors that follow it, and merge it into your branch
[group('Mine')]
my-sync:
    ./dev sync-main

# Hand the merge conflicts in this checkout to an agent, which resolves them, verifies, and commits
[group('Mine')]
my-resolve *ARGS:
    if [ -z "$(git diff --name-only --diff-filter=U)" ]; then printf 'No conflicted files: there is nothing to resolve.\n'; exit 1; fi
    claude {{ ARGS }} "Finish the merge that is in progress in this checkout, on branch $(git symbolic-ref --quiet --short HEAD). Resolve every conflicted file on its merits, keeping both sides' intent rather than taking one side wholesale, and preserving work you did not write. Read AGENTS.md first. Then run \`./agent verify\`, and commit the merge with \`git commit --no-edit\` once it is green. Do not land anything on main, do not push, and do not touch other worktrees. Report what you resolved in each file and what the verification said."

# Squash-merge your dev/* branch into main; the same landing agents use, with the same gates
[group('Mine')]
my-land *ARGS:
    ./dev finalize
    ./dev merge-with-main {{ ARGS }}

# Squash-merge this feature branch into main and push it; flags only remove work, never add it
[arg('abort', long='abort')]
[arg('message_file', long='message-file')]
[arg('skip_all', long='skip-all', value='true')]
[arg('skip_verify', long='skip-verify', value='true')]
[arg('skip_verify_full', long='skip-verify-full', value='true')]
[group('Ship')]
merge-with-main skip_verify='false' skip_verify_full='false' skip_all='false' message_file='' abort='':
    ./dev merge-with-main {{ if skip_verify == "true" { "--skip-verify" } else { "" } }} {{ if skip_verify_full == "true" { "--skip-verify-full" } else { "" } }} {{ if skip_all == "true" { "--skip-all" } else { "" } }} {{ if message_file == "" { "" } else { "--message-file " + quote(message_file) } }} {{ if abort == "" { "" } else { "--abort " + quote(abort) } }}

# Format code, without applying the other Tao source fixes
[group('Dev')]
fmt: _parser-gen
    dprint fmt --incremental=false --excludes "@/" "**/@/**"
    dprint check --incremental=false --allow-no-files "@/**/*" "**/@/**/*"
    ./tao fmt
    just --fmt

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

# Run the repository lint on its own
[group('Dev')]
lint: _repo-lint

# Fail on exported symbols nothing imports; a gate in verify and verify-full
[group('Dev')]
dead-exports:
    bun run packages/dev/dev-src/repository-tests/DeadExports.ts

# Diagnose this checkout without changing it; pass --json for a structured report
[group('Report')]
doctor *ARGS:
    ./dev doctor {{ ARGS }}

# The landing lock is the one turn-taking primitive: claiming it is what earns the right to run a
# merge-evidence lane and then move refs. `land-lock` blocks until it is yours and exits holding it,
# so no agent writes a sleep-poll loop of its own; `land-unlock` gives it back. Nothing reclaims a
# lock on a timer, by design, so a wedged lock surfaces as a warning naming its holder rather than
# as a takeover — `land-unlock --force` is the person-shaped way out.
# `just` splits `*ARGS` on whitespace, so a multi-word `--label` has to go through `./dev land-lock`
# directly; the default label names this worktree, which is what a waiting agent needs anyway.
# Claim the machine-wide landing lock, waiting for whoever holds it, and exit holding it
[group('Dev')]
land-lock *ARGS:
    ./dev land-lock {{ ARGS }}

# Release the machine-wide landing lock this worktree holds
[group('Dev')]
land-unlock *ARGS:
    ./dev land-unlock {{ ARGS }}

# Report every worktree, the machine-wide lane and lease registry, and whether this machine is busy
board *ARGS:
    ./dev board {{ ARGS }}

# Report process, socket, simulator, and local-service capabilities without changing anything
[group('Report')]
capabilities *ARGS:
    ./dev capabilities {{ ARGS }}

# Summarise which subagents were spawned, at which model, and for how long
[group('Report')]
delegation-report *ARGS:
    ./dev delegation-report {{ ARGS }}

# Measure what a simplification pass targets: size, dispatch chains, allowlists, instructions, docs
[group('Report')]
simplify-audit *ARGS:
    ./dev simplify-audit {{ ARGS }}

# Benchmark cold and steady-state language-service performance
[group('Report')]
bench iterations="10":
    bun run packages/dev/dev-src/performance/language-performance.ts "{{ iterations }}"

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
    bun run packages/dev/dev-src/dev.ts expo-android

# Reclaim bootstrap scratch a failed dependency install abandoned, reporting what it freed
[group('Setup')]
clean-scratch:
    zsh -c 'source "{{ justfile_directory() }}/packages/dev/dev-src/cli/agent-worktree-profile.zsh"; tao_prune_bootstrap_scratch "{{ justfile_directory() }}/.artifacts/tmp" --report'

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
verify complete='false' no_cache='false': deps
    ./dev gates _fix-dprint _fix-tao _fix-just-fmt _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test _runtime-pack-check dead-exports --lane verify --json .artifacts/logs/verify/summary.json --skipped "studio-smoke=slow lane; run just studio-smoke or just verify-full" --green-tree verify verify-full-sandbox verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# Verify narrowed to the suites the branch diff reaches: the iteration gate, never merge evidence. --no-cache ignores a recorded green tree
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
verify-changed no_cache='false': deps
    ./dev gates _fix-dprint _fix-tao _fix-just-fmt _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test-changed _runtime-pack-check --lane verify-changed --json .artifacts/logs/verify-changed/summary.json --skipped "studio-smoke=slow lane; run just studio-smoke or just verify-full" --green-tree verify-changed verify verify-full-sandbox verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

# `--needs-machine` is declared here and nowhere else. It is a fact about this lane, not about any
# one gate: the browser, native, and simulator gates share one window server between them, so a
# second lane anywhere on this host makes the verdict a report about interference. `verify-repo`
# inherits it by invoking this recipe, which is why it carries no declaration of its own.
# Verify everything plus the browser, native and bundle lanes; needs the machine to itself. --no-cache ignores a recorded green tree
[arg('no_cache', long='no-cache', value='true')]
[group('Dev')]
verify-full no_cache='false': deps
    ./dev gates {{ VERIFY_FULL_GATES }} --needs-machine --lane verify-full {{ if VERIFY_FULL_SKIPPED == "" { "" } else { "--skipped \"" + VERIFY_FULL_SKIPPED + "\"" } }} --green-tree verify-full {{ if no_cache == "true" { "--no-cache" } else { "" } }}

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

_dependency-health:
    bun run packages/dev/dev-src/doctor/DependencyHealth.ts

# The three fix steps, each over its own file class, as the verify graph runs them
_fix-dprint:
    dprint fmt --incremental=false --excludes "@/" "**/@/**"
    dprint check --incremental=false --allow-no-files "@/**/*" "**/@/**/*"

_fix-tao: _parser-gen
    ./tao fix

_fix-just-fmt:
    just --fmt

_runtime-pack-check:
    bun run packages/dev/dev-src/repository-tests/runtime-package-pack.ts

# `CompileApp.ts` stamps and then delegates to `./tao compile`. Four test recipes and both verify
# lanes depend on this gate, so an unconditional 2.7s compile was paid before a single test could
# start; the stamp skips it while the sources it reads and the tree it wrote are unchanged. It runs
# as a module rather than through `./dev`, matching `_parser-gen`: nobody types a private recipe, so
# the discoverable command bought nothing and cost `./dev`'s boot on every run.
_compile-word-flower-app: _parser-gen
    bun run packages/dev/dev-src/repository-tests/CompileApp.ts "{{ WORD_FLOWER_APP }}" --app WordFlower

_ide-extension-build: _parser-gen
    cd packages/ide-extension && bun esbuild.config.ts

_ide-extension-package: _ide-extension-build
    mkdir -p .artifacts/build
    cd packages/ide-extension && bunx @vscode/vsce package --allow-missing-repository --no-dependencies --out "{{ IDE_EXTENSION_VSIX }}" 1> /dev/null

_tao-check: _parser-gen
    ./tao check

_dprint-check:
    dprint check --incremental=false
    just --fmt --check

_repo-lint:
    bun run packages/dev/dev-src/repository-tests/repo-lint.ts

# TypeScript 7's native compiler, installed under the `typescript-native` npm alias: the same
# build takes ~2s where `typescript` 5.9 takes ~17s. `typescript` itself stays at 5.9 because the
# editor's tsserver and `bunx tsc` still need its JavaScript API, which 7.0 does not ship.
_typecheck:
    bun node_modules/typescript-native/bin/tsc --build packages/*/tsconfig.json

# `just test`'s own runner. In a lane's gate list, `_test` and `_test-changed` are not recipes at
# all: `./dev gates` replaces each with one node per test suite and per shard of a long suite, so the
# suites a verification lane schedules are the same nodes `./dev test` schedules. There is no
# `_test-changed` recipe for that reason — nothing would ever run it.
_test PATTERN="":
    bun run packages/dev/dev-src/dev.ts test "{{ PATTERN }}"

_android-emulator:
    bun run packages/dev/dev-src/dev.ts android-emulator

_android-expo-go:
    bun run packages/dev/dev-src/dev.ts android-expo-go

_parser-gen:
    bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts
