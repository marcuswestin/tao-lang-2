set quiet := true

KITCHEN_SINK_APP := justfile_directory() + "/Apps/Kitchen Sink/Kitchen Sink.tao"
IDE_EXTENSION_VSIX := justfile_directory() + "/.artifacts/build/tao-ide-extension.vsix"

# Print available recipes
help:
  just --list

# Setup the development environment
setup: deps

# Run the dev loop
dev app_path="":
  ./dev "{{app_path}}"

# Install development dependencies
deps:
  bun install

# Run all tests
test: _compile-kitchen-sink-app
  bun test packages/*/*-tests/*.test.ts
  cd packages/runtime && node node_modules/jest/bin/jest.js --runInBand --watchman=false

# Format code
fmt:
  dprint fmt
  ./tao fmt Apps

# Fix and format all code
fix:
  dprint fmt --incremental=false
  ./tao fmt Apps

# Check and test all code
check: _compile-kitchen-sink-app _ide-extension-build
  dprint check --incremental=false
  bunx tsc --build packages/*/tsconfig.json
  just test


# Compile a Tao app path relative to the invocation directory into the local runtime package
compile-app app_path: _parser-gen
  ./tao compile "{{app_path}}"

# Build and install the IDE extension into local editor apps
install-ide-extension: _ide-extension-package
  if command -v cursor >/dev/null 2>&1; then cursor --install-extension "{{IDE_EXTENSION_VSIX}}" --force; fi
  if command -v code >/dev/null 2>&1; then code --install-extension "{{IDE_EXTENSION_VSIX}}" --force; fi
  if command -v antigravity >/dev/null 2>&1; then antigravity --install-extension "{{IDE_EXTENSION_VSIX}}" --force; fi

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
prep: fix check

# Private
#########

_compile-kitchen-sink-app: _parser-gen
  ./tao compile "{{KITCHEN_SINK_APP}}"

_ide-extension-build: _parser-gen
  cd packages/ide-extension && bun esbuild.config.ts

_ide-extension-package: _ide-extension-build
  mkdir -p .artifacts/build
  cd packages/ide-extension && bunx @vscode/vsce package --allow-missing-repository --no-dependencies --out "{{IDE_EXTENSION_VSIX}}" 1> /dev/null

_android-emulator:
  ./dev android-emulator

_android-expo-go:
  ./dev android-expo-go

_parser-gen:
  cd packages/parser && bunx langium generate
