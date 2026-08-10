# Tao MVP Applications

This folder separates the product target from the currently executable integration app.

## Target

`.tao-future/` is the single authoritative full-target Still app. It uses intended Tao syntax that is not executable yet. Tao discovery already skips every dot-prefixed path segment; `.tao-future` is a repository convention, not a Tao language or CLI feature. Move files into a normal source directory as their complete surface becomes executable.

`Design` and `Datasource` are required target capabilities, even though earlier implementation milestones omit them.

The target should evolve in place. Git history replaces numbered whole-app snapshots.

## Current

`Current/` is the rolling integration app. It may use only implemented Tao behavior, must remain discoverable, and must pass its Tao behavior test. Each implementation project advances this app only after its feature works end to end.

`Current/Still.tao` is now a working productivity app: workspaces and tasks stored through the durable local provider, list and detail screens with back navigation, create/update/delete flows, capture forms with validation and disabled actions, a task filter, and loading, empty, provider-error, and populated states. `Current/Still.test.tao` covers those journeys.

Focused parser, validator, compiler, runtime, and behavior cases belong in package tests and `Apps/Test Apps/*`; they do not require another copy of the integration app.

## Coverage

| Capability family                                                                        | Target source                                        | Current executable coverage                                                        | Focused ownership                                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Project, app, imports, UI, types, layout, state, actions, and tests                      | `.tao-future/Still.tao`, `.tao-future/@ui/ui.tao`    | `Current/Still.tao`, `Current/Still.test.tao`                                      | Existing package tests and Test Apps                                 |
| Expressions, control flow, iteration, and interpolation                                  | `.tao-future/@ui/ui.tao`                             | Derived values, `when` branches, `for` rows, and interpolated copy throughout      | `Apps/Test Apps/Expressions`, `Control Flow`, `Collections and Text` |
| Interaction and forms                                                                    | `.tao-future/@ui/ui.tao`                             | `on change`/`on submit` capture forms with validation and disabled actions         | `Apps/Test Apps/Forms and Events`                                    |
| Datasource, schema, query, and mutation                                                  | `.tao-future/Still.tao`, `.tao-future/@ui/ui.tao`    | Workspaces and tasks with queries, create/update/delete, and durable local storage | `Apps/Test Apps/Data MVP`                                            |
| Navigation and presentation                                                              | `.tao-future/Still.tao`; navigation roadmap examples | `present`/`dismiss` screen stack with back; containers and targets pending         | `Roadmap/Add navigation and routing MVP/`                            |
| Design tokens and combined specs                                                         | `.tao-future/@ui/ui.tao`                             | Implemented layout entries only                                                    | `Roadmap/Add Tao design system MVP/`                                 |
| Packages, capabilities, advanced UI, accessibility, motion, errors, bridges, and tooling | Target extensions as decisions settle                | Feature-specific tests when implemented                                            | `Roadmap/Deferred Tao language decisions.md`                         |

Specifications contain minimal normative examples. Larger non-executable subsystem examples live with the roadmap project that owns their decisions, so they cannot be mistaken for runnable applications.
