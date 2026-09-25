# Packages focus

- Merge packages by pipeline role when the import graph shows they already import each other
  densely; the old packages survive as folders of the new one.
- A package stays separate when it is its own deployable (has a `bin`, is an app, or is a native
  module with its own podspec) or when a dependency property depends on the boundary:
  `packages/apps/runtime` imports nothing, so nothing that imports `shared` merges into it.
- Bring the Developer the exact before-and-after package list, with what moves where, before executing.
- Rename import aliases to match the new packages (`@language/parser`) in the same mechanical
  commit. Boundary lints that named a package become folder rules.
- Consolidation is the last wave: it rewrites `tsconfig.base.json`, `config/knip.json`, and
  `bun.lock`, which every concurrent branch also touches. Merge `main` first.

## Groups vs. merges

Group packages by role folder (`packages/language/`, `packages/cli/`) rather than merging them when
each keeps its own tests, gated and cached separately: a group change to one package's tests does not
rerun or reshard a sibling's, where a merge would share one gate run and one test cache across all of
them. A group also keeps each package's declared dependencies as the enforcement point for the
layering between them — a stated dependency a merge would erase — and keeps every consumer's
dependency declaration honest about which package it actually uses, rather than always resolving
through one bundle. Merge two packages only where one is already the other's sole front door: no
consumer reaches one without the other, so a boundary between them protects nothing.
