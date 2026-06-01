set quiet := true

# Print available recipes
help:
  just --list

# Run all tests
test: build
  bun test packages/*/*-tests/*.test.ts

# Format code
fmt:
  dprint fmt --config config/dprint.jsonc --incremental=false

# Check all code
check: _install_deps
  dprint check --config config/dprint.jsonc --incremental=false
  bunx tsc --build packages/*/tsconfig.json

# Build everything
build: _install_deps

# Generate parser artifacts
parser-gen: build
  cd packages/parser && bunx langium-cli generate

# Clean run dependencies and build artifacts
clean:
  rm -rf .artifacts
  find . -name node_modules -type d -prune -exec rm -rf {} +

# Fix and format all code
fix: fmt

# Check, test, and fix all code
prep-commit: check test fix

# Private
#########

_install_deps:
  bun install
