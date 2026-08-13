# Archived MVP-4 Presentation And Navigation Exploration

Status: historical. This document no longer owns decisions or open work.

Superseded by:

- `Spec/Tao Presentation and Navigation.md` for normative behavior.
- `Spec/Tao Type System.md` for `let`, declaration properties, argument binding, and `with`.
- `Roadmap/Archive/Add navigation and routing MVP/Research - Add navigation and routing MVP.md` for rationale and traceability.
- `Roadmap/Add navigation and routing MVP/Follow-ups - Add navigation and routing MVP.md` for deferred work.
- `Apps/MVP-4/MVP-Writer.tao` for complete intended usage.

## What This Exploration Established

The exploration began with separate destination declarations such as screen, overlay, toast, window, complication, and scene. It converged on a smaller semantic model:

- `view` is reusable visual content.
- `ui` is presentable content.
- `nav` is a native-backed or composed presentation container.
- `dialogue` is response-demanding content invoked with `ask`.
- `present` is non-blocking navigation or placement.
- `ask`/`respond` is an explicit suspending conversation.

Navigation became an active semantic tree rather than a graph of all possible routes. Native push, pop, tab selection, drawer selection, overlay display, and window creation became provider policies behind semantic operations.

The exploration also established restorable UI/nav properties, entity references by default, explicit snapshots, immutable configured descriptors, distinct semantic/occurrence/mount identities, and one Tao-owned reducer reconciled by native providers.

## Important Revisions

Several earlier conclusions were intentionally replaced:

- **Only UI is presentable** became `presentable = ui | nav`, while nav remains distinct from UI and has restricted placement.
- **Named navs are best-effort logical contexts** became strict mounted targets. Explicit paths never fall back; omitted targets delegate contextually.
- **Binding names identify nav instances** became transparent immutable `let` values that can locate a descriptor only when it has one active mount.
- **`alias` is a macro-like definition synonym** became real immutable `let` binding. Functions and specialized declarations provide reusable code.
- **`WindowNav { Host ... }` materializes an auxiliary** became explicit app auxiliary registration plus `WindowHost` and `Window` occurrence descriptors.
- **Configurable presentation strictness** was removed. Explicit target behavior is always strict.
- **Nav definitions expose state** was rejected. Definition properties configure descriptors; reducer-owned runtime state remains private.

## Rejected Syntax Families

These forms should not be revived without a new design project:

```tao
screen TaskScreen { ... }
present TaskUi as overlay
app.nav.push TaskUi
navigation tab Home
workspace nav AppStack = Nav.StackNav Initial HomeUi
alias AppStack = Nav.StackNav Initial HomeUi
Nav.WindowNav { Host Writer }
presentation strictness development
```

Their replacement forms are demonstrated in `MVP-Writer.tao`.

## Preserved Future Questions

The deleted exploration also contained legitimate later questions. They are retained under stable IDs rather than active comments here:

- Routes, restoration migrations, scenes, window geometry, durable suspension, guards/lifecycle, and presentation handles: `DEF-NAV-001` through `DEF-NAV-007`.
- Target-specific declarations, values crossing suspension, unsafe native boundaries, event concurrency, conditional navigation chrome, restoration API/policy, user-defined identity metadata, dynamic occurrence targeting, and refreshed Toast child identity: `DEF-NAV-008` through `DEF-NAV-017`.
- Broader non-navigation syntax options from the 30-file triage: `Roadmap/Deferred Tao language decisions.md`.
- Minimal non-normative code forms retained from staged-only sketches: `Roadmap/Archive/Add navigation and routing MVP/Deferred syntax explorations.md`.

Git history preserves committed option sketches. Material that existed only in staged or uncommitted files is summarized by the active preservation records. Active work should start from the superseding sources above.
