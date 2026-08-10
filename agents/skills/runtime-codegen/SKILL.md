---
name: runtime-codegen
description: >-
  Change Tao compiler-generated TypeScript, the TR generated-code runtime API, @runtime/TR imports, or packages/runtime/TaoRuntime-src and TR-tests behavior.
---

# Runtime Codegen

- Keep the generated-code runtime facade as default `TR` from `@runtime/TR`, implemented under `packages/runtime/TaoRuntime-src/` and tested under `packages/runtime/TR-tests/`.
- Keep generated app TypeScript minimal. Generated code describes app-specific wiring; reusable language semantics, values, control flow, and view behavior belong on `TR`.
- Extend `TR` before emitting repeated helper implementations into generated files.
- Keep compiler handlers AST-node-oriented and recurse through `Compile.<Node>`. Compile lists with existing generator helpers at the use site.
- Preserve source order unless validated semantic lowering requires runtime declaration order.
- Keep feature naming aligned across parser, validator, formatter, compiler, and runtime slices.
- Test through Tao AST, diagnostics, compilation, or runtime behavior rather than generated text substrings.
