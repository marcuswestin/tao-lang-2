set quiet

WORD_FLOWER_APP := justfile_directory() + "/Apps/WordFlower/1 - Current/WordFlower.tao"
IDE_EXTENSION_VSIX := justfile_directory() + "/.artifacts/build/tao-ide-extension.vsix"
BUN_CACHE_DIR := justfile_directory() + "/.artifacts/cache/bun"
BUN_TMP_DIR := justfile_directory() + "/.artifacts/tmp/bun"
LOCAL_INSTANTDB_APP_ID := "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
LOCAL_INSTANTDB_DIR := justfile_directory() + "/config/local-instantdb"
LOCAL_INSTANTDB_COMPOSE := "docker compose --project-name tao-local-instantdb --file \"" + LOCAL_INSTANTDB_DIR + "/docker-compose.yml\""
FULL_VERIFY_GATES := "_fix-dprint _fix-tao _fix-just-fmt _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test _runtime-pack-check _doctor-json dead-exports _ship-bundle-proof _full-verify-smoke-launch _full-verify-real-app _full-verify-simulated _full-verify-native _full-verify-canary"

# Print available recipes
help:
    just --list

# `just setup` is what every harness runs through `./agent setup`: Worktrunk's pre-start hook
# (.config/wt.toml), the Claude Code and Codex SessionStart hooks (.rulesync/hooks.jsonc), and
# Cursor's worktree setup (.cursor/worktrees.json). Changing what setup does changes them all.
# Setup dependencies and generated agent adapters
setup: deps _agent-config

# Decrypt the repository secrets into .env.secrets; `add <KEY>`, `list`, or `setup` to manage them
secrets *ARGS:
    ./dev secrets {{ ARGS }}

# Launch Claude Code with the Bash sandbox off; switch a running session with /sandbox
claude-unsandboxed *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.unsandboxed.json" {{ ARGS }}

# Launch Claude Code in read-only planning mode
claude-review *ARGS:
    claude --permission-mode plan {{ ARGS }}

# Launch Claude Code with opt-in Docker access for the local InstantDB stack
claude-local-services *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.local-services.json" {{ ARGS }}

# Launch Claude Code with prompted native-device commands and native build directories
claude-native *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.native.json" {{ ARGS }}

# Launch Claude Code with prompted signing/notarization tools and Xcode release directories
claude-release *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.release.json" {{ ARGS }}

# Discover and run Tao apps through the Tao CLI dev loop; optionally select one app by name
[positional-arguments]
dev app_path="Apps" APP="":
    ./tao dev "$1" {{ if APP == "" { "" } else { "--app \"$2\"" } }}

# Start the official self-hosted InstantDB stack and provision WordFlower's local app
start-local-instantdb:
    {{ LOCAL_INSTANTDB_COMPOSE }} up --detach --wait
    {{ LOCAL_INSTANTDB_COMPOSE }} exec -T postgres psql --set ON_ERROR_STOP=1 --username instant --dbname instant --set app_id="{{ LOCAL_INSTANTDB_APP_ID }}" --file /dev/stdin < "{{ LOCAL_INSTANTDB_DIR }}/seed-app.sql"
    echo "InstantDB is ready at http://localhost:9020 (dashboard: http://localhost:3000)"

# Stop local InstantDB while preserving its database and object-storage volumes
stop-local-instantdb:
    {{ LOCAL_INSTANTDB_COMPOSE }} down

# Launch Tao Studio against a project folder; HNReader by default, whose project names its DefaultApp
studio project="Apps/HNReader":
    ./dev studio "{{ project }}"

# Launch Tao Studio in its local Electrobun shell; offers to stop another session holding the native host
studio-native project="Apps/HNReader":
    ./dev studio-native "{{ project }}"

# Install the Tao Companion development build on a connected iPhone or iPad, once per native change
studio-companion-install device="":
    ./dev studio-companion-install --device "{{ device }}"

# Install the Tao Companion development build on an iOS simulator; no phone, pairing, or unlock needed
studio-companion-simulator simulator="":
    ./dev studio-companion-install --simulator "{{ simulator }}"

# Run the focused Tao Studio package suite
studio-test:
    bun test packages/studio/studio-tests

# Run an explicit slow Studio smoke file in an isolated lane
studio-smoke test_file="packages/dev/studio-smoke/studio-launch.test.ts" run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" "{{ test_file }}"

# Run an explicit slow Studio shell smoke through Electrobun
studio-smoke-native test_file="packages/dev/studio-smoke/studio-simulated-user.test.ts" run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" "{{ test_file }}"

# Prove Studio compile/edit/undo against the real HNReader app
studio-proof-real-app run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" packages/dev/studio-smoke/studio-real-app.test.ts

# Run native Tao Studio against a deterministic project and report what it proved
studio-canary project="Apps/HNReader" app="HNReader":
    ./dev studio-canary --project "{{ project }}" --app "{{ app }}"

# Export real release and Studio-preview iOS bundles and prove only the preview carries Studio code
ship-bundle-proof:
    just _ship-bundle-proof

# Run the native Studio checks that require a person; never part of test or verify
studio-manual-checks project="Apps/HNReader" app="HNReader":
    ./dev studio-manual-checks --project "{{ project }}" --app "{{ app }}"

# Validate a built native Studio release without publishing anything
studio-release-check payload_root=".artifacts/build/studio-native/service-stage/payload" artifacts_root=".artifacts/build/studio-native/project/artifacts" *ARGS:
    ./dev studio-release-check --payload-root "{{ payload_root }}" --artifacts-root "{{ artifacts_root }}" {{ ARGS }}

# Build signed/notarized Tao Studio artifacts through Electrobun and Hutch
studio-package release_base_url=env("TAO_STUDIO_RELEASE_BASE_URL", "https://releases.example.com/tao-studio") channel="stable" output_root=".artifacts/build/studio-native":
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
deps:
    mkdir -p "{{ BUN_TMP_DIR }}"
    TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile
    if ! just _dependency-health; then TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile --force; fi
    if ! just _dependency-health; then mkdir -p "{{ BUN_CACHE_DIR }}"; TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile --force --cache-dir="{{ BUN_CACHE_DIR }}"; just _dependency-health; fi

# Run all tests, or pass one simple test-name pattern such as `just test "formats imports"`
test PATTERN="": _compile-word-flower-app
    just _test '{{ PATTERN }}'

# Run tests selected by changes since a ref; defaults to this branch's main merge base
test-changed ref="": _compile-word-flower-app
    ./dev test-changed {{ if ref == "" { "" } else { "\"" + ref + "\"" } }}

# Run one exact package Bun or runtime Jest test file through the repository test lane
test-file path: _compile-word-flower-app
    ./dev test-file "{{ path }}"

# Re-run files that are not green since this checkout's latest complete test run
test-retry: _compile-word-flower-app
    ./dev test-retry

# Report tests whose outcome flipped without their file changing
test-flakes limit="20":
    ./dev test-flakes --limit "{{ limit }}"

# Report the slowest tests recorded in this checkout's ledger
test-slowest limit="20":
    ./dev test-slowest --limit "{{ limit }}"

# Dry-run the human-only feature landing workflow; pass --execute explicitly to mutate refs
[arg('abort', long='abort')]
[arg('execute', long='execute', value='true')]
[arg('message_file', long='message-file')]
[arg('push', long='push', value='true')]
[arg('skip_full_verify', long='skip-full-verify', value='true')]
[arg('yes', long='yes', value='true')]
merge-with-main execute='false' yes='false' push='false' skip_full_verify='false' message_file='' abort='':
    ./dev merge-with-main {{ if execute == "true" { "--execute" } else { "" } }} {{ if yes == "true" { "--yes" } else { "" } }} {{ if push == "true" { "--push" } else { "" } }} {{ if skip_full_verify == "true" { "--skip-full-verify" } else { "" } }} {{ if message_file == "" { "" } else { "--message-file " + quote(message_file) } }} {{ if abort == "" { "" } else { "--abort " + quote(abort) } }}

# Format code, without applying the other Tao source fixes
fmt: _parser-gen
    dprint fmt --incremental=false
    ./tao fmt
    just --fmt

# Fix and format all code
fix: _parser-gen
    dprint fmt --incremental=false
    ./tao fix
    just --fmt

# Check and test all code
check:
    ./dev gates _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _tao-check _dprint-check _typecheck _test _runtime-pack-check --lane check --skipped "studio-smoke=slow lane; run just studio-smoke or just full-verify"

# Run the repository lint on its own
lint: _repo-lint

# Report exported symbols nothing imports; a report, not a gate
dead-exports:
    bun run packages/dev/dev-src/repository-tests/DeadExports.ts

# Diagnose this checkout without changing it; pass --json for a structured report
doctor *ARGS:
    ./dev doctor {{ ARGS }}

# Report process, socket, simulator, and local-service capabilities without changing anything
capabilities *ARGS:
    ./dev capabilities {{ ARGS }}

# Benchmark cold and steady-state language-service performance
bench iterations="10":
    bun run packages/dev/dev-src/performance/language-performance.ts "{{ iterations }}"

# Compile a Tao app path relative to the invocation directory into the local runtime host
compile-app app_path: _parser-gen
    ./tao compile "{{ app_path }}"

# Build and install the IDE extension into local editor apps
install-ide-extension: _ide-extension-package
    if command -v cursor >/dev/null 2>&1; then cursor --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi
    if command -v code >/dev/null 2>&1; then code --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi
    if command -v antigravity >/dev/null 2>&1; then antigravity --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi

# Compile WordFlower, launch an Android emulator, and start the Expo runtime on Android.
android: _compile-word-flower-app _android-emulator _android-expo-go
    bun run packages/dev/dev-src/dev.ts expo-android

# Reclaim bootstrap scratch a failed dependency install abandoned, reporting what it freed
clean-scratch:
    zsh -c 'source "{{ justfile_directory() }}/packages/dev/dev-src/cli/agent-worktree-profile.zsh"; tao_prune_bootstrap_scratch "{{ justfile_directory() }}/.artifacts/tmp" --report'

# Clean run dependencies and build artifacts
clean: clean-scratch
    rm -rf .artifacts/build .artifacts/dev packages/runtime-toolchain/.expo packages/runtime-toolchain/_gen_tao-app packages/runtime-toolchain/_gen_tao-app-test
    find . -name node_modules -type d -prune -exec rm -rf {} +

# Run clean + clean ALL artifacts
clean-all: clean
    rm -rf .artifacts packages/runtime-toolchain/ios packages/runtime-toolchain/android

# Bootstrap dependencies, then prepare all code for commit
verify: deps
    ./dev gates _fix-dprint _fix-tao _fix-just-fmt _parser-gen _compile-word-flower-app _ide-extension-build _repo-lint _typecheck _test _runtime-pack-check --lane verify --json .artifacts/logs/verify/summary.json --skipped "studio-smoke=slow lane; run just studio-smoke or just full-verify"

# Bootstrap dependencies, then run one graph of everything: verify, doctor, dead-exports, and every automated Studio lane
full-verify: deps
    ./dev gates {{ FULL_VERIFY_GATES }} --lane full-verify

# Run full-verification's sandbox-compatible gates without installing dependencies or claiming the five Studio lanes passed
full-verify-sandbox:
    ./dev gates {{ FULL_VERIFY_GATES }} --skip-unsandboxed --lane full-verify-sandbox

# Private
#########

# The full-verify Studio lanes. One recipe per lane, each on its own worker index so
# StudioSmoke.resources() hands it ports and an artifact root no other lane touches.

_full-verify-smoke-launch:
    ./dev studio-smoke --run-id full-verify-launch --worker 0 packages/dev/studio-smoke/studio-launch.test.ts

_full-verify-real-app:
    ./dev studio-smoke --run-id full-verify-real-app --worker 1 packages/dev/studio-smoke/studio-real-app.test.ts

_full-verify-simulated:
    ./dev studio-smoke --run-id full-verify-simulated --worker 2 packages/dev/studio-smoke/studio-simulated-user.test.ts

_full-verify-native:
    ./dev studio-smoke --native --run-id full-verify-native --worker 3 packages/dev/studio-smoke/studio-simulated-user.test.ts

_full-verify-canary:
    ./dev studio-canary --project Apps/HNReader --app HNReader

_ship-bundle-proof:
    bun run packages/runtime-toolchain/runtime-toolchain-src/testing/verify-release-bundle.ts

# The doctor's own versioned report, so the node's log is the artifact
_doctor-json:
    ./dev doctor --json

_agent-config:
    ./dev agent-config

_dependency-health:
    bun run packages/dev/dev-src/doctor/DependencyHealth.ts

# The three fix steps, each over its own file class, as the verify graph runs them
_fix-dprint:
    dprint fmt --incremental=false

_fix-tao: _parser-gen
    ./tao fix

_fix-just-fmt:
    just --fmt

_runtime-pack-check:
    bun run packages/dev/dev-src/repository-tests/runtime-package-pack.ts

_compile-word-flower-app: _parser-gen
    ./tao compile "{{ WORD_FLOWER_APP }}" --app WordFlower

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

_typecheck:
    bunx tsc --build packages/*/tsconfig.json

_test PATTERN="":
    bun run packages/dev/dev-src/dev.ts test "{{ PATTERN }}"

_android-emulator:
    bun run packages/dev/dev-src/dev.ts android-emulator

_android-expo-go:
    bun run packages/dev/dev-src/dev.ts android-expo-go

_parser-gen:
    bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts
