# Working across packages

A single language feature (views, expressions, etc.) usually spans every stage of the pipeline. Implement it as a vertical slice: one focused file per stage, named after the feature, so a feature can be read and changed in one pass across packages.

## Feature-sliced file naming

Add or edit the feature's file in each relevant package source dir (`<package>/<package>-src/...`):

- `parser/`: `views.langium`, `expressions.langium`, ...
- `validator/`: `views-validator.ts`, `expressions-validator.ts`, ...
- `formatter/`: `views-formatter.ts`, `expressions-formatter.ts`, ...
- `compiler/`: `views-compiler.ts`, `expressions-compiler.ts`, ...
- `runtime/` (`TR/`): `TR-views.tsx`, `TR-expressions.tsx`, ...

## Rules

- Keep the same feature name across stages so the slice is greppable end to end.
- Add a stage only when that stage actually handles the feature; don't create empty placeholder files.
- Prefer extending the matching slice over adding cross-cutting catch-all files.
