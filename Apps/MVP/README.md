# Tao MVP Applications

`Current/Still.tao` is the executable functional MVP and the integrated product reference for the language surface implemented in this repository. `Current/Still.test.tao` exercises its primary behavior through the normal Tao test runtime.

## Current MVP

Still is authored entirely in Tao and demonstrates:

- an app-owned typed stack with workspace/task destinations, state-preserving covered screens, and automatic Back behavior;
- durable asynchronous Local workspace and related-task data, with deterministic Memory isolation in tests;
- reactive queries, AND filtering, time-based ordering, live entity and relationship reads, explicit cascade deletion, and strict create/update/delete writes;
- controlled text inputs, structurally typed change/submit/press actions, validation, typed defaults, disabled controls, accessible labels, placeholders, and stable IDs;
- loading, provider-error, empty, populated, open-task, and completed-task UI states;
- workspace and task editors whose entity-valued destinations stay live after writes;
- explicit `interpolate`, expressions, total `when`, and `for` rendering; focused test apps own broader `let`, pure-function, and `none` coverage;
- mandatory invocation delimiters: `render View(args) [layout] { children }`, `View(args) [layout] { children }`, `do Action(args)`, `Function(args)`, and `present Stack.Destination(args)`.

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
