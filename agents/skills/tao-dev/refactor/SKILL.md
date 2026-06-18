---
name: refactor
description: >-
  Simplify and reorganize focused Tao repo code without changing required behavior. Use when Ro asks to refactor, simplify, clean up, reduce cross-file surface area, reorganize files, shrink exports, or closely analyze a named subsystem such as TR/runtime internals while preserving functionality.
---

# Refactor

Refactor the code Ro points at by simplifying its internal design first, changing callers as needed, and preserving required behavior. Prefer deleting, collapsing, and localizing code over adding new abstractions.

## Workflow

1. Confirm the focused target: files, package, subsystem, or API surface Ro named. Do not broaden to unrelated cleanup unless it directly reduces complexity in that target.
2. Read the target files, their direct callers, exports, tests, and any nested `AGENTS.md` or relevant Tao skill instructions.
3. Build a short refactor map before editing:
   - responsibilities in the focused code
   - exported functions/types and who calls them
   - cross-file data/control flow
   - behavior that must remain unchanged
   - complexity that looks accidental or now-obsolete
4. Identify simplifications before designing replacements. Ask:
   - Can this file/export/helper disappear?
   - Can callers use a simpler shape?
   - Can two layers collapse into one?
   - Can a generic helper become a local private function?
   - Can parameters be removed, renamed, grouped, or made harder to misuse?
   - Can state, ownership, or lifecycle move to the code that already owns it?
5. Edit in the focused area first. Update callers only to support the cleaner internal shape.
6. Validate behavior with the narrowest relevant tests, then broader validation when the touched surface is shared or risky. In this repo, final validation is usually `./agent just prep`.
7. Summarize what got simpler: deleted files/exports, collapsed layers, renamed APIs, behavior preserved, tests run, and simplifications intentionally skipped.

## Refactor Priorities

- Reduce cross-file code surface area whenever possible. Prefer one clear owner over many pass-through files.
- Minimize exports. Export only package or cross-file APIs that real callers need.
- Prefer private helpers near their only use. Move helpers out only when it reduces duplication, cycles, or file responsibility confusion.
- Collapse pass-through wrappers, mirror types, and parameter forwarding when they do not carry a real boundary.
- Remove stale compatibility names, historical aliases, dead branches, and TODO-shaped scaffolding inside the focused scope.
- Prefer boring names that describe ownership and behavior. Rename functions, parameters, and files when the current names hide what the code does.
- Keep file names aligned with contents. Split a file only when it has multiple real responsibilities; merge files when separation creates indirection without ownership value.
- Preserve behavior unless Ro explicitly asks for behavior change. If the simpler design exposes a likely behavior bug, state the bug and fix it only when the fix is clearly in scope.
- Prefer behavior tests or existing integration tests over tests that only freeze the old internal shape.

## Extra Checks

- Look for data that is calculated statically but can be owned more naturally at runtime, or vice versa.
- Look for options, flags, and parameters that are always passed the same way.
- Look for functions whose only job is to call another function with renamed arguments.
- Look for types that duplicate another type with a different name.
- Look for module boundaries that force imports in both directions or make a small concept span too many files.
- Look for hidden invariants and either make them unnecessary or encode them in one obvious place.
- Check whether existing tests assert implementation details that should change with the refactor.
- Check docs, examples, and skills for stale references after file/export renames.

## Boundaries

- Do not turn a refactor into a feature project, syntax migration, broad formatting sweep, or roadmap rewrite.
- Do not preserve public-looking APIs just because they exist; verify real callers. If removing an export affects external or generated-code contracts, call that out before cutting it.
- Do not add an abstraction merely to make code look organized. Add one only when it removes meaningful duplication, clarifies ownership, or creates a real boundary.
- Do not stage, unstage, stash, commit, or reset unless Ro explicitly asks in the current request.
