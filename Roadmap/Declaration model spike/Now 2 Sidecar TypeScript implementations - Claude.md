# Now 2 - Sidecar TypeScript Implementations

Historical build slice, now landed. It was self-contained from `Now 1`: it touched the `implement`
clause's right-hand side and compiler module-resolution path, not the slot/declaration model.

## What exists today

`packages/parser/parser-grammar/configuration.langium:31-35`:

```
ConfigurationImplementation:
    'implement' 'inject' protocol=ConfigurationImplementationProtocol tsCodeBlock=TS_CODE_BLOCK;

ConfigurationImplementationProtocol returns string:
    'nav' | 'provider';
```

An inline fenced TS block can inject a nav implementation that returns `TR.NavKind.Stack()`; the
shipped `StackNav` and `Memory` declarations use this form today. **Keep this form working — do not
remove it in this slice.**

## What to build

An alternative right-hand side: a path to a sibling `.ts` file instead of an inline block.

```tao
implement inject nav "./StackNav.ts"
```

Keep today's `implement inject nav|provider` vocabulary rather than inventing new keywords. The
later Q11 resolution explicitly rejected the historical `implement is "..."` alternative; this
slice's whole job was a second RHS form for the clause that already exists.

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
  `Spec/Tao Packages.md`. This slice only adds the _capability_ to point at a sidecar file; it does not
  move anything that ships today.
- Any protocol-version negotiation between a sidecar and `TR`. Stays single-version and implicit, as it
  is today.
- Native-backed visual declarations. WordFlower Tranche 4 subsequently settled those on
  `render inject`, not a `ui` `implement` slot; that work was absorbed through the tranche rather
  than this landed sidecar slice.

## Validation

`./agent verify`. Add one fixture nav (or reuse a `StackNav`/`Memory`-shaped test double) exercising
the full path: `.tao` declaration → emitted `.d.ts` → sidecar `.ts` importing it → generated module
wiring it in → `TR.testNavKind` (or the provider equivalent) passing against it. Branch `feat/<name>`;
never commit from detached HEAD. Preserve work from other concurrent worktrees.
