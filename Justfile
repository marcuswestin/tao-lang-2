set quiet := true

KITCHEN_SINK_APP := justfile_directory() + "/Apps/Kitchen Sink/Kitchen Sink.tao"

# Print available recipes
help:
  just --list

# Run all tests
test: _compile-kitchen-sink-app
  bun test packages/*/*-tests/*.test.ts
  cd packages/runtime && bunx jest --runInBand --watchman=false

# Format code
fmt:
  dprint fmt --config config/dprint.jsonc --incremental=false

# Check all code
check: _compile-kitchen-sink-app
  dprint check --config config/dprint.jsonc --incremental=false
  bunx tsc --build packages/*/tsconfig.json

# Build everything
build: _install_deps

# Generate parser artifacts
parser-gen: build
  cd packages/parser && bunx langium-cli generate

# Compile a Tao app path relative to the invocation directory into the local runtime package
compile-app app_path: build
  ./dev compile-app "{{app_path}}"

# Compile Kitchen Sink and start the Expo runtime. OPEN_MATCH_HOST_ONLY to reuse the currently running browser tab instead of opening a new one.
run: _compile-kitchen-sink-app
  cd packages/runtime && EXPO_NO_TELEMETRY=1 OPEN_MATCH_HOST_ONLY=true bunx expo start --localhost

# Clean run dependencies and build artifacts
clean:
  rm -rf .artifacts/build
  find . -name node_modules -type d -prune -exec rm -rf {} +

# Fix and format all code
fix: fmt

# Check, test, and fix all code
prep-commit: check test fix

# Private
#########

_install_deps:
  bun install

_compile-kitchen-sink-app: build
  ./dev compile-app "{{KITCHEN_SINK_APP}}"
