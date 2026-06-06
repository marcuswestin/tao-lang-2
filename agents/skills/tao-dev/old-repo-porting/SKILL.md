---
name: old-repo-porting
description: >-
  Port or reference behavior from the previous Tao repo at ~/code/tao-lang while avoiding copied cruft, stale conventions, and known repo-specific gotchas.
---

# Old Repo Porting

Use this when a task compares against, ports from, or cites `~/code/tao-lang`.

## Rules

- Read the current repo first, then use the old repo as reference material for proven ideas and edge cases.
- Do not copy old code wholesale unless it is already exactly right for this repo's current design.
- Record project-specific conclusions in the current roadmap task's research or plan, not in `AGENTS.md`.
- Add durable cross-project gotchas here; keep `AGENTS.md` terse.

## Gotchas

- Generated directories and files use the `_gen_` prefix, not `_gen-`. Generated outputs should be ignored and should not be committed unless a task explicitly says otherwise.
- Package consumers should use local wrapper exports for Langium/LSP APIs. Do not import directly from `langium`, `langium/lsp`, `langium/node`, or `vscode-languageserver` when the parser wrapper can expose the needed surface.
- Before adding Typir dependencies, verify the `typir` / `typir-langium` pair against this repo's current Langium version. Do not downgrade Langium as part of a port.
- Do not add an `unknown` Tao type, Typir primitive, or public unresolved sentinel unless the old repo proves that exact shape is needed. The validator/type-system slice used `undefined` / `InferenceRuleNotApplicable` for unresolved Typir paths.
- Keep language surfaces feature-sliced across parser, validator, compiler, formatter, and runtime files. Avoid catch-all files when a matching feature file can own the behavior.
- Put parser-dependent semantic helpers shared by validator/compiler/formatter/IDE in `packages/ast-utils`, not in generic `shared`.
- Use the `runtime-codegen` skill for generated Tao TS, `TR`, `@runtime/TR`, and shared runtime behavior details.
- Old IDE extension code is useful for architecture and edge cases, but omit stdlib bundling, formatter registration, install commands, navigation providers, and packaging breadth until this repo has those features in scope.
- Before finalizing, search changed exports and old-repo-derived paths/names. Remove private exports and stale old conventions rather than preserving them for convenience.
