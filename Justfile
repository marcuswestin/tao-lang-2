set quiet

WORD_FLOWER_APP := justfile_directory() + "/Apps/WordFlower/1 - Current/WordFlower.tao"
IDE_EXTENSION_VSIX := justfile_directory() + "/.artifacts/build/tao-ide-extension.vsix"
DEVENV_NODE := justfile_directory() + "/.devenv/profile/bin/node"
BUN_CACHE_DIR := justfile_directory() + "/.artifacts/cache/bun"
BUN_TMP_DIR := justfile_directory() + "/.artifacts/tmp/bun"
LOCAL_INSTANTDB_APP_ID := "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
LOCAL_INSTANTDB_DIR := justfile_directory() + "/config/local-instantdb"
LOCAL_INSTANTDB_COMPOSE := "docker compose --project-name tao-local-instantdb --file \"" + LOCAL_INSTANTDB_DIR + "/docker-compose.yml\""

# Print available recipes
help:
    just --list

# Setup dependencies and generated agent adapters
setup: deps _agent-config

# Launch Claude Code with the Bash sandbox off; switch a running session with /sandbox
claude-unsandboxed *ARGS:
    claude --settings "{{ justfile_directory() }}/.claude/settings.unsandboxed.json" {{ ARGS }}

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

# Launch Tao Studio against a project folder
studio project=".":
    ./dev studio "{{ project }}"

# Launch Tao Studio in its local Electrobun shell
studio-native project=".":
    ./dev studio-native "{{ project }}"

# Run the focused Tao Studio package suite
studio-test:
    bun test packages/studio/studio-tests

# Run an explicit slow Studio smoke file in an isolated lane
studio-smoke test_file run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" "{{ test_file }}"

# Run an explicit slow Studio shell smoke through Electrobun
studio-smoke-native test_file run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" "{{ test_file }}"

# Prove Studio compile/edit/undo against the real HNReader app
studio-proof-real-app run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" packages/dev/studio-smoke/studio-real-app.test.ts

# Run native Tao Studio against a deterministic project and report what it proved
studio-canary project="Apps/HNReader" app="HNReader":
    ./dev studio-canary --project "{{ project }}" --app "{{ app }}"

# Validate a built native Studio release without publishing anything
studio-release-check payload_root artifacts_root *ARGS:
    ./dev studio-release-check --payload-root "{{ payload_root }}" --artifacts-root "{{ artifacts_root }}" {{ ARGS }}

# Build signed/notarized Tao Studio artifacts through Electrobun and Hutch
studio-package release_base_url channel="stable" output_root=".artifacts/build/studio-native":
    ./dev package-studio-native --release-base-url "{{ release_base_url }}" --channel "{{ channel }}" --output-root "{{ output_root }}"

# Install development dependencies
deps:
    mkdir -p "{{ BUN_CACHE_DIR }}" "{{ BUN_TMP_DIR }}"
    TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile
    if ! just _dependency-health; then TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile --force --cache-dir="{{ BUN_CACHE_DIR }}"; just _dependency-health; fi

# Run all tests, optionally filtered by test name
test PATTERN="": _compile-word-flower-app
    just _test '{{ PATTERN }}'

# Format code
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
check: _compile-word-flower-app
    ./dev gates _ide-extension-build _repo-lint _dependency-check _tao-check _dprint-check _typecheck _test _runtime-pack-check --skipped "studio-smoke=slow lane; run just studio-smoke <file>"

# Run lint only
lint: _repo-lint

# Diagnose this checkout without changing it; pass --json for a structured report
doctor *ARGS:
    ./dev doctor {{ ARGS }}

# Benchmark cold and steady-state language-service performance
bench iterations="10": _bench-check
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
    rm -rf .artifacts/build .artifacts/dev packages/runtime-toolchain/.expo packages/runtime-toolchain/_gen_tao-app
    find . -name node_modules -type d -prune -exec rm -rf {} +

# Run clean + clean ALL artifacts
clean-all: clean
    rm -rf .artifacts packages/runtime-toolchain/ios packages/runtime-toolchain/android

# Prepare all code for commit
verify: fix _compile-word-flower-app
    ./dev gates _ide-extension-build _repo-lint _dependency-check _typecheck _test _runtime-pack-check --json .artifacts/logs/verify/summary.json --skipped "_tao-check=covered by check" "_dprint-check=fix formatted this tree with dprint and just --fmt" "studio-smoke=slow lane; run just studio-smoke <file>"

# Private
#########

_agent-config:
    bun run scripts/generate-agent-config.ts

_dependency-health:
    cd packages/runtime-toolchain && "{{ DEVENV_NODE }}" -e 'require("expo/metro-config"); require("jest-expo/jest-preset")'

_bench-check:
    bun test packages/dev/performance-checks/language-performance.test.ts

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

_dependency-check:
    bun run packages/dev/dev-src/repository-tests/DependencyCompatibility.ts

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
