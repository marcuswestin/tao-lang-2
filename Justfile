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

# Launch Tao Studio in its local Electron wrapper
studio-native project=".":
    ./dev studio-native "{{ project }}"

# Run the focused Tao Studio package suite
studio-test:
    bun test packages/studio/studio-tests

# Run an explicit slow Studio smoke file in an isolated lane
studio-smoke test_file run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" "{{ test_file }}"

# Run an explicit slow Studio smoke through the local Electron wrapper
studio-smoke-native test_file run_id="local":
    ./dev studio-smoke --native --run-id "{{ run_id }}" "{{ test_file }}"

# Prove Studio compile/edit/undo against the real HNReader app
studio-proof-real-app run_id="local":
    ./dev studio-smoke --run-id "{{ run_id }}" packages/dev/studio-smoke/studio-real-app.test.ts

# Package the local macOS Tao Studio wrapper
studio-package output_root=".artifacts/build/studio-native":
    ./dev package-studio-native --output-root "{{ output_root }}"

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

# Check and test all code
check: _compile-word-flower-app _parallel-check

# Run lint only
lint: _repo-lint

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

# Clean run dependencies and build artifacts
clean:
    rm -rf .artifacts/build .artifacts/dev packages/runtime-toolchain/.expo packages/runtime-toolchain/_gen_tao-app
    find . -name node_modules -type d -prune -exec rm -rf {} +

# Run clean + clean ALL artifacts
clean-all: clean
    rm -rf .artifacts packages/runtime-toolchain/ios packages/runtime-toolchain/android

# Prepare all code for commit
verify: fix _compile-word-flower-app _parallel-verify-check

# Private
#########

_agent-config:
    bun run scripts/generate-agent-config.ts

_dependency-health:
    cd packages/runtime-toolchain && "{{ DEVENV_NODE }}" -e 'require("expo/metro-config"); require("jest-expo/jest-preset")'

[parallel]
_parallel-check: _ide-extension-build _repo-lint _tao-check _dprint-check _typecheck _test _bench-check _runtime-pack-check

[parallel]
_parallel-verify-check: _ide-extension-build _repo-lint _typecheck _test _bench-check _runtime-pack-check

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

_typecheck:
    bunx tsc --build packages/*/tsconfig.json

_test PATTERN="":
    bun run packages/dev/dev-src/dev.ts test "{{ PATTERN }}"

_android-emulator:
    bun run packages/dev/dev-src/dev.ts android-emulator

_android-expo-go:
    bun run packages/dev/dev-src/dev.ts android-expo-go

_parser-gen:
    cd packages/parser && "{{ DEVENV_NODE }}" node_modules/langium-cli/bin/langium.js generate
