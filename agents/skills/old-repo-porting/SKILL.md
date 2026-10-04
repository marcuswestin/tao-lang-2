---
name: old-repo-porting
description: >-
  Compare, port, or recover Tao behavior from the previous repository. Use when consulting
  ~/code/tao-lang for proven semantics or edge cases, while checking the current architecture and
  conventions before reusing its behavior.
---

# Old Repo Porting

- Reuse proven semantics and edge cases, not whole files or obsolete architecture; `packages/AGENTS.md` owns where the reused code lives. Record task-specific conclusions in the active roadmap task.
- Use `_gen_` for generated names. Do not commit generated output unless the task requires it.
- Do not downgrade Langium as part of a port. Tao's type system is the hand-rolled structural `Type` in `@ast-utils`.
- Do not add an `unknown` Tao type only to represent unresolved inference; current unresolved paths use `undefined`.
- Keep language behavior feature-sliced; `packages/apps/runtime/AGENTS.md` owns generated TypeScript and `TR` changes.
- Search changed exports, paths, and generated names for old conventions before handoff.
