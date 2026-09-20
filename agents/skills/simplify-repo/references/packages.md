# Packages focus

- Merge packages by pipeline role when the import graph shows they already import each other
  densely; the old packages survive as folders of the new one.
- A package stays separate when it is its own deployable (has a `bin`, is an app, or is a native
  module with its own podspec) or when a dependency property depends on the boundary:
  `packages/runtime` imports nothing, so nothing that imports `shared` merges into it.
- Bring Ro the exact before-and-after package list, with what moves where, before executing.
- Rename import aliases to match the new packages (`@language/parser`) in the same mechanical
  commit. Boundary lints that named a package become folder rules.
- Consolidation is the last wave: it rewrites `tsconfig.base.json`, `config/knip.json`, and
  `bun.lock`, which every concurrent branch also touches. Merge `main` first.
