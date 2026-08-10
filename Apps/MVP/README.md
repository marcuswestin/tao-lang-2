# Tao MVP Applications

`Current/Still.tao` is the executable functional MVP and the integrated product reference for the language surface implemented in this repository. `Current/Still.test.tao` exercises its primary behavior through the normal Tao test runtime.

## Current MVP

Still is authored entirely in Tao and demonstrates:

- a project and app-owned typed stack with list/detail presentation and back behavior;
- durable local workspace and related-task data, with deterministic in-memory isolation in tests;
- reactive queries, filtering, ordering, relationship cascade deletion, and create/update/delete writes;
- controlled text inputs, submit/press actions, validation, disabled controls, labels, and stable IDs;
- loading, provider-error, empty, populated, open-task, and completed-task UI states;
- pure functions, interpolation, expressions, `if/else`, and `for` rendering;
- mandatory invocation delimiters: `render View(args) [layout] { children }`, `View(args) [layout] { children }`, `do Action(args)`, and `Function(args)`.

Focused feature coverage remains in `Apps/Test Apps/*` and the owning package tests.

## Run And Verify

From the repository root:

```sh
./tao check "Apps/MVP/Current/Still.tao"
./tao test "Apps/MVP/Current"
./tao compile "Apps/MVP/Current/Still.tao"
./dev "Apps/MVP/Current/Still.tao"
```

The first three commands are automated verification paths. The final command launches the Expo development path for interactive use.

## Historical Design Seed

`.tao-future/` preserves an earlier non-executable product sketch. It is excluded from Tao discovery because it is dot-prefixed and is no longer authoritative for implemented behavior or syntax. Its remaining ideas are inputs to later language-design work, not MVP requirements.

Design tokens, advanced navigation containers, remote sync, authentication, collaboration, production deployment, and the broader future package/UI surfaces remain deliberately outside this functional MVP.
