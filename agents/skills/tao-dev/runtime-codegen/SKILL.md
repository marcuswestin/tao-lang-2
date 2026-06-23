---
name: runtime-codegen
description: >-
  Use when changing compiler-generated TypeScript, the generated-code runtime API named TR, @runtime/TR imports, or files under packages/runtime/TaoRuntime-src.
---

# Runtime codegen

Use this skill when a change touches generated app TypeScript or the `TR` runtime API consumed by generated code.

## Naming and location

- Call the generated-code runtime facade `TR`; the source folder is `packages/runtime/TaoRuntime-src/`.
- Keep `TR` tests in `packages/runtime/TR-tests/`.
- Import it only as default `TR` from `@runtime/TR`; generated code should call `TR.*`, not named imports.
- Keep `TR` in `packages/runtime` because generated apps run inside the Expo runtime package. Do not move it to `compiler`, `shared`, `parser`, or `ast-utils`.

## Codegen rules

- Generated app files should describe the app with minimal TS and delegate reusable semantics to `TR.*`.
- Add or extend `TR` constructs before emitting repeated helpers into generated files. Target shapes like `TR.IfElse(...)`, `TR.Expression(...)`, and `TR.Block(...)` when those abstractions exist.
- Keep app-specific wiring in generated code; keep language semantics, reusable runtime values, control flow, view helpers, and evaluation behavior in `TR`.
- Keep `Compile` entries node-oriented. For lists, call `gen.list(items, Compile.<Node>)` at the use site instead of adding aggregate helpers like `Compile.<Nodes>`.
- Do not reorder aliases in compiler. Validator owns source-order reference rules, and generated aliases should preserve source order.
- Preserve feature-sliced naming across packages: parser, validator, formatter, compiler, and `TaoRuntime-src` files should use the same feature term when practical.
