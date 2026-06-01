set quiet := true

_DEV_PACKAGE := "packages/dev"
_SHARED_PACKAGE := "packages/shared"

# Print available recipes
help:
  just --list

# Run all tests
test:
  bun test {{ _SHARED_PACKAGE }}/shared-tests/*.test.ts

# Format code
fmt:
  dprint fmt --config config/dprint.jsonc --incremental=false

# Check all code
check: _install-deps
  dprint check --config config/dprint.jsonc --incremental=false
  cd {{ _DEV_PACKAGE }} && bunx tsc --noEmit -p tsconfig.json
  cd {{ _SHARED_PACKAGE }} && bunx tsc --noEmit -p tsconfig.json

# Build everything
build: _install-deps

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

_install-deps:
  cd {{ _DEV_PACKAGE }} && bun install
  cd {{ _SHARED_PACKAGE }} && bun install
