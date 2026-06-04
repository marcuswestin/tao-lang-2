set quiet := true

KITCHEN_SINK_APP := justfile_directory() + "/Apps/Kitchen Sink/Kitchen Sink.tao"

# Print available recipes
help:
  just --list

# Setup the development environment
setup: deps

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

# Fix and format all code
fix:
  dprint fmt --incremental=false

# Check all code
check: _compile-kitchen-sink-app _ide-extension-build
  dprint check --incremental=false
  bunx tsc --build packages/*/tsconfig.json


# Compile a Tao app path relative to the invocation directory into the local runtime package
compile-app app_path: _parser-gen
  ./dev compile-app "{{app_path}}"

# Compile Kitchen Sink and start the Expo runtime. OPEN_MATCH_HOST_ONLY to reuse the currently running browser tab instead of opening a new one.
run: _compile-kitchen-sink-app
  cd packages/runtime && EXPO_NO_TELEMETRY=1 OPEN_MATCH_HOST_ONLY=true bunx expo start --localhost

# Compile Kitchen Sink, launch an Android emulator, and start the Expo runtime on Android.
android: _compile-kitchen-sink-app _android-emulator _android-expo-go
  ./dev expo-android

# Clean run dependencies and build artifacts
clean:
  rm -rf .artifacts/build
  find . -name node_modules -type d -prune -exec rm -rf {} +

# Run clean + clean ALL artifacts
clean-all: clean
  rm -rf .artifacts

# Check, test, and fix all code
prep-commit: fix check test

# Private
#########

_compile-kitchen-sink-app: _parser-gen
  ./dev compile-app "{{KITCHEN_SINK_APP}}"

_ide-extension-build:
  cd packages/ide-extension && bun esbuild.config.ts

_android-emulator:
  ./dev android-emulator

_android-expo-go:
  ./dev android-expo-go

_parser-gen:
  cd packages/parser && bunx langium generate
