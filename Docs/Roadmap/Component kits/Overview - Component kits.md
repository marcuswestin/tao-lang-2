# Overview - Component kits

Working draft. The mechanism, styling fallback, conformance model, and navigation-surface split
below were settled with Ro in conversation; spellings marked _proposed_ are still mine to lose.

## The three targets

1. **Native by default.** A new app's tabs, stacks, buttons, lists, inputs render as the OS's own
   components — Liquid Glass on iOS, Material on Android — with fast virtualized lists, without
   the app opting in.
2. **Custom everywhere.** Any element — tab bar included — is replaceable without changing how app
   code uses it.
3. **A wireframe tier.** A grayscale, minimally-styled version of every element: behavior, layout,
   accessibility, state feedback, nothing else — the base a `design` styles up with §13 element
   defaults (`styles { Button [...] }`).

## The mechanism: packages and pass-through aliases (settled)

`@tao/ui` publishes the definitions; implementations live in subpackages; the published names are
aliases. Selection is imports — no new value kind, no registry:

```tao
// @tao/ui/Components.tao
use package ./native

public view Button = native.Button
public view Slider = native.Slider
```

- **`use package <path> [as name]`** imports a package as a namespace. The name defaults to the
  path's last segment; `as` renames — which also covers segments that collide with keywords
  (`use package @tao/nav as navs`).
- **`view Name = ns.Member`** declares a pass-through alias, with ordinary visibility. Implemented:
  the alias form targets a `view` — since the unified view tranche there is only one renderable
  kind, and call-site checks (caller content, named slots, `responds`) are inferred from the
  target's body, so the alias publishes the target's whole interface. Configurable types use the
  parallel identity-preserving form `type Name = ns.Member`; `@tao/nav` uses it to republish the
  native declarations while retaining their configuration interfaces and protocol identities.
- **Namespace member access** is cheap at runtime — the generated module does the equivalent of
  `import * as ns` from the target module, which generated code already does for every import.
  The cost is per grammar position; alias right-hand sides and render sites
  (`render native.Sheet(...)`) come first, other positions as needed.
- An app that wants a different set writes `use Button from @tao/ui/basic` or
  `use Button from @some-other-ui-package`; bare `@tao/ui` is the native pass-through set.

Implementations are ordinary Tao views — `render inject` pass-throughs, exactly the shape today's
stdlib views already have — so a "native component" is a Tao declaration whose inject renders the
platform host (RN.Button, a SwiftUI/Material host) instead of styled primitives.

## Styling (settled)

- §13 element defaults are the custom-styling story and land fully on basic/custom implementations.
- A native implementation is **best-effort**: it inspects the props/styles passed through and
  honors what the host can represent; a clause it cannot honor is **ignored with a runtime dev
  warning**. A later tightening — per-element honorable-clause tables in the §13 design check —
  can move much of that warning to build time without changing the model.

## Conditional compilation (direction agreed; spelling proposed)

The native package needs per-target code: a host component that exists on iOS, doesn't on web, and
must not even be required under Jest. Rather than a new tag syntax, the proposal is the fold tier
Tao already has (§13: "entries fold or react — two tiers, one grammar"): a compile-time environment
subject, folded at build, with dead branches stripped — sidecar imports included:

````tao
public view Button(Label text, Disabled boolean default false) {
   render when Target {
      Ios -> { inject Label, Disabled ```ts ... RN.Button ... ``` }
      Android -> { inject Label, Disabled ```ts ... RN.Button ... ``` }
      otherwise -> { basic.Button(Label, Disabled) }   // Web, Test
   }
}
````

- `Target` is a build-time value with a closed case set (working names: `Ios`, `Android`, `Web`,
  `Test`) — deliberately distinct from §13's render-time `Platform` (`Phone/Tablet/Laptop`), which
  is a form factor, not a build target.
- **This is also the degradation rule** (settled in direction): where no native host exists — web,
  the Jest harness, a component whose bridging hasn't landed — the native package renders the basic
  implementation behind the same import. One rule covers web, tests, and rollout; apps get more
  native per release with no source change. Under `tao test`, everything resolves `Target Test`,
  so journeys are deterministic and never need a native host.

## Conformance: tests declare their dependencies (settled; details to pin)

`@tao/ui` carries one journey suite that is simultaneously the stdlib's own correctness suite and
the published conformance contract. Two language additions make it retargetable:

1. **A test declares what it tests**: `test <dependencies> <optional string> { ... }` —
   `test Button "Handles press" { ... }`, or a group `test Button { test "..." { } }`, with
   multiple dependencies as `test Button, Pressable "..." { ... }`. Tests gain visibility
   (`public test ...`) so a package can export its suite.
2. **A test instantiates a package's suite against another implementation**:

```tao
// @tao/ui/conformity/Button.test.tao
use Button from @tao/ui

public test Button "Button conformity" { ... }

// a third-party package or app:
view MyButton ...

test MyButton using @tao/ui/conformity          // runs every `test Button ...` there
test MyButton using @tao/ui/conformity Button   // explicit formal, for multi-dependency suites
```

Rules to pin during implementation:

- **Substitution is package-level**: `using` compiles the target package's test unit with the
  dependency rebound everywhere — probe apps and helper views inside the suite included — so the
  suite's own scaffolding follows the substitution.
- **Matching**: an actual matches a formal by name when the names coincide; otherwise a
  single-dependency suite matches positionally; otherwise the explicit trailing formals are
  required.
- **The contract stays pinned**: substitution rebinds the dependency only; the contract types the
  suite references stay `@tao/ui`'s. A nonconforming implementation fails statically at the
  instantiation with a named diagnostic, before any journey runs.
- The suite asserts **behavior and accessibility, never pixels** — a custom implementation must
  act like ours, not look like it.

## Navigation surfaces (settled)

The native **tab bar** is a native SelectionNav implementation — the nav-kind seam exists and
`Display "automatic"` was already pointing at it. Native **stack navigation** maps the same Tao
reducer-owned entries to platform transitions and header chrome; the directly presented view's
reactive `Title` and `Toolbar` supplied slots drive that header. **Sheet** is a presentation mode
(`present X as sheet`) beside overlay and toast. App code keeps writing `nav X = SelectionNav
{ ... }` and `present Y`; native-ness lives in the imported implementation, never at the call site.
Bare `@tao/nav` aliases `native/`; an explicit `@tao/nav/basic` import selects the portable host.

## Starting set (settled: conservative, bridge-first)

Controls through `@tao/ui/native`: **Button**, plus one or two more RN-core-native controls
(Switch is the obvious second). Navigation surfaces through the nav layer: native tabs, sheet
mode. Full parity is explicitly not the goal of the first pass — getting the bridging seams right
is.

## Order of work (proposal)

1. `use package` + namespace references + visual-kind aliases — the enabling mechanism.
2. `@tao/ui/Components.tao` + `@tao/ui/native` with Button (+ Switch): pass-through bridging,
   best-effort style inspection, runtime dev warning.
3. Test dependencies + `using` instantiation; the Button conformity suite.
4. `when Target` compile-time folding (unblocks true per-platform hosts and strips dead imports).
5. Native tabs as a SelectionNav implementation; `as sheet`; then widen the set.

## Status

Landed:

- **`use package <path> [as name]`** and `ns.Member`, with namespace names derived from the path's
  last segment; **`view Name = ns.Member`** pass-through aliases carrying the target's interface.
- **`@tao/ui` publishes the native set** — Button, FormButton, Switch, Slider, Picker,
  SegmentedControl, DatePicker, Spinner — as aliases over `@tao/ui/native`. `@tao/ui/basic` holds
  the clause-honoring wireframe tier.
- **Native navigation surfaces**: `SelectionNav` with `Display "automatic"` renders through
  `react-native-screens`' BottomTabs (UITabBarController on iOS — Liquid Glass on an iOS 26 build —
  and the Material bar on Android), controlled by Tao's reducer; `present X as sheet` hosts a view in
  the platform's modal. `StackNav` now uses the platform stack/header while retaining Tao's reducer,
  reads direct reactive `Title`/`Toolbar` slots, and falls back to the same fixed-header basic host on
  web or under deterministic behavior checks.
- **`@tao/nav` has the standard kit shape**: root configurable-type aliases publish `native/` by
  default, and `basic/` publishes the portable implementations with the same family contracts and
  `TR.NavKind` conformance coverage.
- **Best-effort styling** with a development-time warning for clauses a native control cannot honor.
- **Optional hosts**: every platform module is required lazily; a missing one renders a portable
  equivalent, so web, the Jest harness, and a partial rollout all work behind the same import.
- **Tests declare their dependencies** (`test Button "…"`), and take visibility.
- **A change event reports any scalar** the control produced, not only text and a boolean.

Open:

- **`test X using @pkg`** — instantiating a package's suite against another implementation. The
  declaration half is in; the instantiation needs the substitution threaded through the app-compile
  cache and across a package boundary, and the suite's probe apps need a home a package can hold
  (an app cannot currently be declared inside one).
- **Contract types** for published components, so a third-party implementation is checked
  statically rather than only by the journeys.
- **`when Target`** compile-time folding. Degradation is a runtime check today, which is correct on
  every platform but does not strip a native-only host from a web bundle.
- **Components with no cross-platform host**: progress bar, action sheet.
- **Element defaults** (§13 `styles { Button [...] }`) meeting the wireframe tier, which lands with
  the design system MVP.
