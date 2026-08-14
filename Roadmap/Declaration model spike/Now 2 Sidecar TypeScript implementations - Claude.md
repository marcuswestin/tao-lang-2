# Now 2 - Sidecar TypeScript Implementations

Ready to build now. No dependency on anything in `Open questions - Declaration model spike - Claude.md`.
Self-contained from `Now 1` — this only touches the `implement` clause's right-hand side and the
compiler's module-resolution path, not the slot/declaration model — so it can run in a separate
worktree in parallel with it. Verified against `main` at `6cfd88be` on 2026-08-14; re-verify before
starting.

## What exists today

`packages/parser/parser-grammar/configuration.langium:31-35`:
```
ConfigurationImplementation:
    'implement' 'inject' protocol=ConfigurationImplementationProtocol tsCodeBlock=TS_CODE_BLOCK;

ConfigurationImplementationProtocol returns string:
    'nav' | 'provider';
```
An inline fenced TS block, e.g. `implement inject nav \`\`\`ts return TR.NavKind.Stack() \`\`\``, used
today by the shipped `StackNav` and `Memory` declarations. **Keep this form working — do not remove it
in this slice.**

## What to build

An alternative right-hand side: a path to a sibling `.ts` file instead of an inline block.

```tao
implement inject nav "./StackNav.ts"
```

Keep today's `implement inject nav|provider` vocabulary rather than inventing new keywords
(`implement is "..."` reads on the declaration-model side and belongs to `Now 1`/the open questions,
not here) — this slice's whole job is a second RHS form for the clause that already exists.

**Compiler:**
- Emit a `.d.ts` alongside the generated module for the `.tao` declaration's configuration shape — the
  type of `config` in `TR.NavKind<Profile, ConfigurationT>` or `TR.DataProvider` — so a sidecar can
  `import type { XConfig } from './X.tao'`, compiler-emitted rather than hand-written.
- Resolve the sidecar path relative to the `.tao` file, import its default export, and wire it into the
  generated module the same way the inline block is spliced in today. Find and match that existing
  lowering shape rather than inventing a second one — check where `ConfigurationImplementation`
  currently lowers (`packages/runtime/TaoRuntime-src/TR-navigation-kinds.ts` and its compiler-side
  counterpart are the starting points from this session's earlier reading).

**Validator:**
- File-exists check on the sidecar path.
- A cheap "has a default export" check if that's inexpensive at validation time; deeper conformance
  (does it actually implement `NavKind`/`DataProvider`) is `TR.testNavKind`/`TR.testProvider`'s job at
  runtime, not the validator's.

## Explicitly deferred — do not build here

- Moving `StackNav`/`Memory` out of `TR` into `@tao/nav`/`@tao/data`. That relocation depends on
  package resolution (`requires`, lockfiles, external workspace installation) landing first, per
  `Spec/Tao Packages.md`. This slice only adds the *capability* to point at a sidecar file; it does not
  move anything that ships today.
- Any protocol-version negotiation between a sidecar and `TR`. Stays single-version and implicit, as it
  is today.
- `ui`'s `implement` slot — gated on open questions, not this.

## Validation

`./agent verify`. Add one fixture nav (or reuse a `StackNav`/`Memory`-shaped test double) exercising
the full path: `.tao` declaration → emitted `.d.ts` → sidecar `.ts` importing it → generated module
wiring it in → `TR.testNavKind` (or the provider equivalent) passing against it. Branch `feat/<name>`;
never commit from detached HEAD. Preserve work from other concurrent worktrees.
