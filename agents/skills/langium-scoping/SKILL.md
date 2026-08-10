---
name: langium-scoping
description: >-
  Change Tao Langium scoping, name resolution, local value visibility, symbol shadowing, cross-references, or parser and workspace scope providers.
---

# Langium Scoping

- Read [references/langium-scoping.md](references/langium-scoping.md) before changing scope behavior.
- Separate local-symbol, file/global-symbol, and future module/import concerns.
- Never resolve `.ref` while computing scopes; linking belongs in `ScopeProvider.getScope`.
- Cross-referenced grammar rules must expose their key as `name`. Ignore incomplete recovery nodes without real names.
- Build scope chains in explicit nearest-to-farthest precedence so inner symbols shadow outer symbols.
- Keep visibility rules in the existing parser or workspace scoping owners.
- Test with Langium documents so linking and diagnostics run; cover shadowing and out-of-scope behavior.
