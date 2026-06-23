---
name: langium-scoping
description: >-
  Guides Tao Langium scoping, value visibility, symbol shadowing, and reference-resolution changes.
---

# Langium Scoping

Use this skill when changing Tao name resolution, local value visibility, symbol shadowing, or Langium reference behavior.

## Rules

- Read `references/langium-scoping.md` before changing scoping behavior.
- Decide whether the change affects local symbols, global/file symbols, scope lookup, or future module/import resolution.
- Do not read `.ref` while computing scopes; linking happens through `ScopeProvider.getScope`.
- Any grammar rule referenced by cross-reference syntax must expose its key as `name`.
- Optional AST fields may be `undefined` during IDE recovery parses; only describe nodes with real names.
- Build scope chains in explicit precedence order so closer symbols shadow outer symbols.
- Keep visibility rules centralized in the existing parser/validator scoping helpers.
- Add tests that build Langium documents and exercise reference resolution or diagnostics.
- Run `./agent just verify` for parser or cross-package scoping changes.
