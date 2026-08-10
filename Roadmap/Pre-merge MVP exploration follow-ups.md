# Pre-Merge MVP Exploration Follow-Ups

These follow-ups originated in the documentation/navigation handoff review. The formatter fix is required before merge. Project-ID implementation is deliberately deferred until stable navigation identity has its first runtime consumer.

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

## 2. Deferred: Define and bootstrap immutable project IDs

Navigation descriptor identity depends on a checked-in logical project ID. Existing Tao projects and MVP fixtures predate that requirement, so identity must never be generated transiently during checking, compiling, or launching.

Status: deferred to the navigation identity implementation. This is not a merge blocker for the syntax-exploration branch, and current projects do not require an ID.

Settled contract for that implementation:

- Every project that forms restorable UI/nav descriptors has one opaque immutable `project.id` stored in source metadata.
- `tao create <id>` uses the developer-supplied project directory name as the checked-in ID; Tao does not generate identity.
- `tao project id <id> [path]` creates and persists a developer-supplied ID for an existing project. It is deliberate and reviewable rather than an automatic side effect of ordinary commands.
- Clones and published artifacts retain the ID. An independent fork explicitly supplies a replacement with `--replace`.
- A missing ID produces a diagnostic with the migration command; it never falls back to a filesystem path, remote URL, package-lock key, or random per-run value.

Work required when the feature is activated:

- Add parser, AST, formatter, and validator support for the metadata if any part is missing.
- Implement or plan the explicit migration command in the same coherent slice; do not document a command that cannot be run.
- Add IDs to the authoritative target and foundation fixtures.
- Test creation, migration, repeat invocation, clone stability, explicit replacement, and missing-ID diagnostics.
- Run focused CLI/parser/validator tests followed by `./agent just verify`.

Suggested commit title: `Bootstrap stable Tao project identity`
