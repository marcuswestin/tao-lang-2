# Pre-Merge MVP Exploration Follow-Ups

These fixes intentionally follow the current documentation/navigation handoff commit. Each must be a separate reviewed commit before this branch merges.

## 1. Preserve comments in compact inline actions

The compact-action formatter behavior was introduced on this branch by `4abda990`. It currently collapses any one-statement `ActionExpression`, even when comments inside the block require multiline formatting.

Required behavior:

- Format a comment-free one-statement inline action as `{ statement }`.
- Keep an action multiline when it contains a leading, trailing, or block comment that cannot remain valid and readable on one line.
- Preserve comment attachment and indentation.
- Produce identical output on the first and second formatting pass.
- Keep named action declarations multiline under the existing rule.

Required work:

- Make the compactness decision aware of CST comments between the action braces, rather than checking only `statements.length`.
- Add formatter tests for leading line comments, trailing comments, block comments, and comment-free compact actions.
- Add an explicit formatter-idempotence assertion for the commented cases.
- Run focused formatter tests followed by `./agent just verify`.

Suggested commit title: `Preserve comments in compact inline actions`

## 2. Define and bootstrap immutable project IDs

Navigation descriptor identity depends on a checked-in logical project ID. Existing Tao projects and MVP fixtures predate that requirement, so identity must never be generated transiently during checking, compiling, or launching.

Required contract:

- Every project that forms restorable UI/nav descriptors has one opaque immutable `project.id` stored in source metadata.
- `tao create` writes the ID for new projects.
- One explicit CLI migration operation creates and persists an ID for an existing project. Choose its final spelling in this commit; it must be deliberate and reviewable rather than an automatic side effect of ordinary commands.
- Clones and published artifacts retain the ID. An independent fork regenerates it explicitly.
- A missing ID produces a diagnostic with the migration command; it never falls back to a filesystem path, remote URL, package-lock key, or random per-run value.

Required work:

- Add parser, AST, formatter, and validator support for the metadata if any part is missing.
- Implement or plan the explicit migration command in the same coherent slice; do not document a command that cannot be run.
- Add IDs to the authoritative target and foundation fixtures.
- Test creation, migration, repeat invocation, clone stability, explicit regeneration, and missing-ID diagnostics.
- Run focused CLI/parser/validator tests followed by `./agent just verify`.

Suggested commit title: `Bootstrap stable Tao project identity`
