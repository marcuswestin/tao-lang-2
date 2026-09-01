---
name: old-repo-porting
description: >-
  Port, compare, or recover Tao behavior from the previous repository at ~/code/tao-lang while avoiding its stale conventions and copied implementation cruft.
---

# Old Repo Porting

- Understand the current repository and feature boundaries before consulting the old implementation.
- Reuse proven semantics and edge cases, not whole files or obsolete architecture. Record task-specific conclusions in the active roadmap task.
- Use `_gen_` for generated names. Do not commit generated output unless the task requires it.
- Expose needed Langium and LSP APIs through the parser wrapper instead of importing their packages directly from consumers.
- Do not downgrade Langium as part of a port. Tao's type system is the hand-rolled structural `Type` in `@ast-utils`; the old repository's Typir bridge has been retired, so do not port anything that reintroduces it.
- Do not add an `unknown` Tao type only to represent unresolved inference; current unresolved paths use `undefined`.
- Put shared parser-dependent semantics in `packages/ast-utils`, not generic shared code.
- Keep language behavior feature-sliced and use the `runtime-codegen` skill for generated TypeScript or `TR` changes.
- Port only IDE and packaging behavior currently in scope.
- Search changed exports, paths, and generated names for old conventions before handoff.
