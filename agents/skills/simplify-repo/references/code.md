# Code focus

## Remove code

- Search `@shared` before adding a helper; a helper two packages need lives there once.
  `packages/runtime` imports nothing, so a mirrored copy there names its original.
- One home per constant. Repeated literals (`'main'`, `'origin'`, app names, env-var names) are the
  cheap finds.
- Families of near-identical functions collapse onto one parameterized helper (the `findOwning*`
  parent walks are the model case).
- Run `just dead-exports` after every wave; removing a caller often strands an export.
- While an agent owns paths exclusively, it returns requests for `shared` helpers to the agent that
  owns `shared` instead of editing it.

## House patterns

1. Dispatch on `.kind`, `.type`, `.$type`, or a literal union uses `Switch.*`
   (`packages/shared/shared-src/core/Switch_TypeSafe.ts`). Native `switch` and if/else-if chains
   over one discriminant are linted at zero tolerance.
2. A condition gets a name when it mixes `&&` with `||`, negates a group, or appears twice.
   - `if (!task.done && (task.owned || task.recent))` becomes `if (Tasks.isOwnedOrRecent(task))`
     when a namespace owns the concept, `if (isOwnedOrRecentTask(task))` otherwise.
   - Shape checks (`typeof x === 'object' && x !== null …`) become shared guards such as
     `Json.isRecord`.
   - Review-only: no lint can judge "non-trivial".
3. Errors go through `Assert` and `Errors.throw*`, or `TR-errors` in the runtime. Already gated.
4. Platform access goes through `Platform`, `FS`, `CLI`, `Time`. Shrink the allowlists by adding
   the missing wrapper (as `Platform.sha256Hex` and `Platform.signES256` did for `node:crypto`), not
   by adding entries. Entries for emitted script text stay.
   - Dispatch on a plain property of a wire union uses `Switch.on(message, 'type', handlers)`, and a
     deliberately ignored branch uses `Switch.nothing`. Every `Switch` form reads own keys only.
5. Utilities live in namespaced modules named for their concept, not as loose functions.

## Structure

- No file-size cap. Split a large file only along a seam that gives each part one concept.
- Message handling across a wire has one dispatch shape on both ends, driven by the protocol's
  message union, so adding a message fails to compile until both ends handle it.
