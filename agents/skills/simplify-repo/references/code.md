# Code focus

## Remove code

- Search `@shared` before adding a helper; a helper two packages need lives there once.
  `packages/apps/runtime` imports nothing, so a mirrored copy there names its original.
- One home per constant. Repeated literals (`'main'`, `'origin'`, app names, env-var names) are the
  cheap finds.
- Families of near-identical functions collapse onto one parameterized helper (the `findOwning*`
  parent walks are the model case).
- Run `./agent dead-exports` after every wave; removing a caller often strands an export.
- While an agent owns paths exclusively, it returns requests for `shared` helpers to the agent that
  owns `shared` instead of editing it.

## After a package move

Every real defect a move exposes is a string, a regex, a table key, a cache key, an allowlist entry,
or a runtime resolution — never a type error, since none of these has one to fail on. Sweep for all
of them by the old path's literal text, not by memory of which files used it: a test nested under the
wrong folder belongs to no suite; a cache keyed on the old path fails open instead of failing loud; a
cross-package lint or a packaged-app payload that counts folder depth breaks silently when a level
changes; a handler table keyed by an unvalidated wire value can resolve `constructor`, `toString`, or
`__proto__` to an inherited member instead of failing to find one.
Prefer resolving through a package name over counting directories to reach a sibling
(`../x`, `:h:h:h:h`, `../../node_modules` are all the same mistake): a package rename or regroup
breaks a directory count every time and breaks a name lookup never.

## House patterns

`packages/AGENTS.md` owns the dispatch, error, and platform-access patterns and their gates.

1. A condition gets a name when it mixes `&&` with `||`, negates a group, or appears twice.
   - `if (!task.done && (task.owned || task.recent))` becomes `if (Tasks.isOwnedOrRecent(task))`
     when a namespace owns the concept, `if (isOwnedOrRecentTask(task))` otherwise.
   - Shape checks (`typeof x === 'object' && x !== null …`) become shared guards such as
     `Json.isRecord`.
   - Review-only: no lint can judge "non-trivial".
2. Errors go through `Assert` and `Errors.throw*`, or `TR-errors` in the runtime. Already gated.
3. Platform access goes through `Platform`, `FS`, `CLI`, `Time`. Shrink the allowlists by adding
   the missing wrapper (as `Platform.sha256Hex` and `Platform.signES256` did for `node:crypto`), not
   by adding entries. Entries for emitted script text stay.
4. Utilities live in namespaced modules named for their concept, not as loose functions.

## Structure

- No file-size cap. Split a large file only along a seam that gives each part one concept.
- Message handling across a wire has one dispatch shape on both ends, driven by the protocol's
  message union, so adding a message fails to compile until both ends handle it.
