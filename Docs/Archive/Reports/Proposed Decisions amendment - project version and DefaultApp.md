# Adopted Decisions amendment — project version and DefaultApp

Status: adopted and folded into Decisions §11, **App composition and providers**, on 2026-09-16.
This file retains the focused amendment record.

## Project release metadata

The project envelope may declare a source-owned release version and a default runnable app:

```tao
project {
   id "wordflower"
   name "WordFlower"
   version "1.0.0"
   DefaultApp WordFlower
}
```

- `version` is the version currently under development. Its value is numeric SemVer core:
  `major.minor.patch`, where each component is a decimal integer with no leading zeroes except `0`.
  Prerelease and build suffixes are not accepted. A project may omit `version` when it is not
  shipped; `tao ship` requires it and owns source bumps under its version policy.
- `DefaultApp` references one `app` declaration in the project, including a declared app variant.
  A project may omit it. A command's explicit `--app` selection wins; an interactive tool may ask
  when neither is present.
- `DefaultApp` is parsed as a capitalized identifier and validated in this project slot; it remains
  source-compatible without becoming a grammar keyword.
- Each field may appear at most once. These fields are project/tooling metadata and do not add
  runtime-visible app state.
