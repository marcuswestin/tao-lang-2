# Runtime and Generated Codegen

- Keep the generated-code runtime facade as default `TR` from `@runtime/TR`, implemented under
  `TaoRuntime-src/` and tested under `TR-tests/`.
- Keep generated app TypeScript minimal: it describes app-specific wiring, while reusable language
  semantics, values, control flow, and view behavior belong on `TR`. Extend `TR` before emitting a
  repeated helper implementation into generated files.
- Keep compiler handlers AST-node-oriented and recurse through `Compile.<Node>`; compile lists with
  the existing generator helpers at the use site.
- Preserve source order unless validated semantic lowering requires runtime declaration order.
  `packages/AGENTS.md` owns cross-slice feature naming.
- Test through Tao AST, diagnostics, compilation, or runtime behavior rather than generated text
  substrings.
- This package imports nothing from `@shared`, so `TR-errors.ts` and `TR-assert.ts` mirror the
  shared `Errors` classes and `Assert` the way `TR-switch.ts` mirrors `Switch`; keep the two in step.
  `TR-errors.ts` owns the vocabulary, action-failure history, unowned-failure reporting, redaction,
  and contained-failure warnings, and `TR.Errors` exposes that whole surface rather than a subset.
