set quiet

KITCHEN_SINK_APP := justfile_directory() + "/Apps/Kitchen Sink/Kitchen Sink.tao"
IDE_EXTENSION_VSIX := justfile_directory() + "/.artifacts/build/tao-ide-extension.vsix"
DEVENV_NODE := justfile_directory() + "/.devenv/profile/bin/node"

# Print available recipes
help:
    just --list

# Setup dependencies and generated agent adapters
setup: deps _agent-config

# Run the dev loop
dev app_path="":
    ./dev "{{ app_path }}"

# Install development dependencies
deps:
    bun install

# Run all tests, optionally filtered by test name
test PATTERN="": _compile-kitchen-sink-app
    just _test '{{ PATTERN }}'

# Format code
fmt: _parser-gen
    dprint fmt
    ./tao fmt
    just --fmt

# Fix and format all code
fix: _agent-config _parser-gen
    dprint fmt --incremental=false
    ./tao fix

# Check and test all code
check: _compile-kitchen-sink-app _parallel-check

# Compile a Tao app path relative to the invocation directory into the local runtime package
compile-app app_path: _parser-gen
    ./tao compile "{{ app_path }}"

# Build and install the IDE extension into local editor apps
install-ide-extension: _ide-extension-package
    if command -v cursor >/dev/null 2>&1; then cursor --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi
    if command -v code >/dev/null 2>&1; then code --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi
    if command -v antigravity >/dev/null 2>&1; then antigravity --install-extension "{{ IDE_EXTENSION_VSIX }}" --force; fi

# Compile Kitchen Sink, launch an Android emulator, and start the Expo runtime on Android.
android: _compile-kitchen-sink-app _android-emulator _android-expo-go
    ./dev expo-android

# Clean run dependencies and build artifacts
clean:
    rm -rf .artifacts/build .artifacts/dev packages/runtime/.expo packages/runtime/_gen_tao-app
    find . -name node_modules -type d -prune -exec rm -rf {} +

# Run clean + clean ALL artifacts
clean-all: clean
    rm -rf .artifacts packages/runtime/ios packages/runtime/android

# Prepare all code for commit
verify: fix _compile-kitchen-sink-app _parallel-verify-check

# Private
#########

_agent-config:
    bun run scripts/generate-agent-config.ts

[parallel]
_parallel-check: _ide-extension-build _tao-check _dprint-check _typecheck _test

[parallel]
_parallel-verify-check: _ide-extension-build _typecheck _test

_compile-kitchen-sink-app: _parser-gen
    ./tao compile "{{ KITCHEN_SINK_APP }}"

_ide-extension-build: _parser-gen
    cd packages/ide-extension && bun esbuild.config.ts

_ide-extension-package: _ide-extension-build
    mkdir -p .artifacts/build
    cd packages/ide-extension && bunx @vscode/vsce package --allow-missing-repository --no-dependencies --out "{{ IDE_EXTENSION_VSIX }}" 1> /dev/null

_tao-check: _parser-gen
    ./tao check

_dprint-check:
    dprint check --incremental=false
    just --check

_typecheck:
    bunx tsc --build packages/*/tsconfig.json

_test PATTERN="":
    bun run packages/dev/dev-src/dev.ts test "{{ PATTERN }}"

_android-emulator:
    ./dev android-emulator

_android-expo-go:
    ./dev android-expo-go

_parser-gen:
    cd packages/parser && "{{ DEVENV_NODE }}" node_modules/langium-cli/bin/langium.js generate
