# Follow-up — Tao sidecar value API

Status: deferred by the Developer on 2026-10-02. Design and implementation are a separate
post-MVP workstream, not a prerequisite for the current package, project-layout, generated
TypeScript, and watcher migration. The current bridge conversions remain unchanged in that work.

## Intended developer experience

Explore a stable public TypeScript API for constructing and using Tao semantic values. Generated
runtime exports could let a handwritten sidecar import a declared item or named type from its
logical relative Tao module and construct values explicitly:

```ts
// Illustrative future API; not implemented or final syntax.
import { Bar, Foo, Name } from './Foo.tao'

export function BuildFoo() {
  return Foo.create({ Bar: Bar(1), Name: Name('Hi') })
}
```

The Developer accepted investigating this direction, not a universal wrapper requirement or the
illustrated constructor spellings. Ordinary TypeScript implementation helpers do not need matching
Tao files. Published package APIs remain public Tao declarations backed by optional sidecars;
direct public TypeScript entrypoints are outside the current implementation.

## Decisions for the follow-up

- Whether explicit construction is required, optional, or specific to semantic types; which
  primitives and lists retain plain JavaScript representations.
- A consistent public representation for sidecar inputs and results, including external-value
  conversion, optional values, union cases, lists, and named or unit-bearing types.
- Detached item construction versus stored entity identity, references, and store-aware writes.
  Constructing a value must not silently imply persistence.
- Which Tao-defined operations become available through generated runtime values, and how their
  behavior remains consistent with ordinary Tao evaluation.
- A stable public value API separate from internal reactive/evaluable wrappers and writable cells.
- Runtime constructor generation and import resolution without initializing cyclic
  Tao-module/sidecar imports or executing generated contract checks as application code.
- Compatibility and migration if a released sidecar contract changes; coordinate with the
  [source compatibility plan](<../MVP Roadmap/Plan - Tao source compatibility.md>).

## Evidence required before adoption

Prove representative item, named-type/unit, list, and entity-handle round trips; useful diagnostics
for wrong types and invalid external input; no duplicate wrapping; predictable mutation and
identity; safe module initialization; and editor type checking/navigation from authored sidecars.
Measure constructor/conversion costs before promising a universal wrapped representation.

This record does not adopt new value syntax or change the current plain-value bridge.
