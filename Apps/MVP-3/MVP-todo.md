# MVP Tao Feature Coverage

This is a repo-grounded checklist of Tao features that are current, intended, or mentioned in specs, roadmap notes, grammar, test apps, and the MVP app.

Checked items are already featured somewhere in `Apps/MVP-3`. MVP-3 includes the MVP-2 expanded sample plus old-repo carry-forward capabilities represented as future Tao code.

## In MVP

### Project, Packages, And App Shape

- [x] `project { ... }` metadata
- [x] `project app`
- [x] app capability selection
- [x] `design` capability selection
- [x] `datasource` capability selection
- [x] `navigator` capability selection
- [x] `use ... from @package`
- [x] bare same-package `use ...`
- [x] `project` visibility
- [x] `package` visibility
- [x] `publish` visibility
- [x] `requires`
- [x] external project/package install semantics
- [x] `use ... from ./`
- [x] `use ... from ../`
- [x] sibling relative imports
- [x] `@package/subfolder` imports
- [x] package publishing
- [x] app publishing
- [x] app install from a published Tao project

### App Capabilities

- [x] `theme` capability
- [x] assets capability
- [x] permissions capability

### Data And Datasources

- [x] `data` declarations
- [x] entity declarations
- [x] slash-form collection/entity declarations
- [x] scalar fields
- [x] field-specific scalar types through `is`
- [x] relationship fields
- [x] list relationship fields
- [x] shorthand relationship fields inferred from existing entity or collection names
- [x] plural collection names inferring list fields
- [x] enum-backed fields
- [x] context-inferred enum defaults
- [x] optional fields
- [x] `indexed`
- [x] `unique`
- [x] field defaults
- [x] `datasource`
- [x] `provider Memory`
- [x] `appId`
- [x] typed data values through data paths

### UI Structure

- [x] `project screen`
- [x] `project view`
- [x] `project layout`
- [x] explicit `render`
- [x] caller content through `@@content`
- [x] named caller actions through `@@actions`
- [x] render IDs with `Name: View ...`
- [x] shared app shell
- [x] reusable sections
- [x] reusable row/card views with behavior

### Runtime UI Primitives

- [x] `Screen`
- [x] `Col`
- [x] `Row`
- [x] `Stack`
- [x] `WrappingRow`
- [x] `Text`
- [x] `Number`
- [x] `Button`
- [x] `TextInput`
- [x] `TextArea`
- [x] `Checkbox`
- [x] `Toggle`
- [x] `Icon`
- [x] `Badge`
- [x] `Box`
- [x] `TextFrame`
- [x] `TextMultiline`
- [x] `Image`
- [x] `ImageInput`
- [x] `Pressable`
- [x] `List`
- [x] `ScrollView`
- [x] `Spinner`
- [x] `Progress`
- [x] `Modal`
- [x] `Link`
- [x] `IconButton`

### Layout And Design

- [x] bracketed `[]` modifier clauses
- [x] combined layout/style specs
- [x] `project design`
- [x] flat design token declarations
- [x] flat style-spec declarations
- [x] style specs containing other style specs
- [x] direct style-spec invocation by name
- [x] typography specs
- [x] color tokens
- [x] spacing tokens
- [x] radius tokens
- [x] background, text, border, radius, shadow, opacity, focus, and press treatment
- [x] `content`
- [x] `gap`
- [x] `pad`
- [x] `width fill`
- [x] `width hug`
- [x] `fill`
- [x] `maxWidth`
- [x] `center`
- [x] `minWidth`
- [x] `minHeight`
- [x] `minTap`
- [x] `flex`
- [x] `wrap`
- [x] `nudge`
- [x] `frame`
- [x] named render slots such as `@icon`
- [x] slot defaults
- [x] slot fill syntax
- [x] render-slot layout merging
- [x] `margin`
- [x] `height`
- [x] bare `hug`
- [x] `compress`
- [x] `rigid`
- [x] `aligned`
- [x] `centered`
- [x] baseline alignment
- [x] bottom/left/right/stretch alignment examples
- [x] wrapped-line layout controls
- [x] overflow handling
- [x] scroll-specific layout handling
- [x] `disabled`
- [x] `selected`

### State, Actions, And Control

- [x] `state`
- [x] field-typed local state
- [x] `alias`
- [x] `project alias`
- [x] named `action`
- [x] inline `action`
- [x] inline event blocks
- [x] event blocks delegating to named actions
- [x] `on press`
- [x] `on change`
- [x] `on submit`
- [x] `on focus`
- [x] push notification events
- [x] network failure events
- [x] `toggle`
- [x] `do Action args` with argument examples
- [x] shorthand `->`
- [x] `set =`
- [x] `set +=`
- [x] `do`
- [x] action parameters
- [x] reactive state reads
- [x] `if`
- [x] `else`
- [x] `when`
- [x] `for`
- [x] `.Empty`
- [x] `.First`
- [x] `.count`

### Expressions And Types

- [x] `text`
- [x] `number`
- [x] boolean-style values and expressions
- [x] custom `type ... is ...`
- [x] `type ... is enum`
- [x] typed constructors
- [x] space-applied typed constructors
- [x] context-inferred enum literals
- [x] member access
- [x] equality and inequality
- [x] comparison
- [x] arithmetic `+`
- [x] arithmetic `-`
- [x] arithmetic `*`
- [x] arithmetic `/`
- [x] compound `-=`
- [x] compound `*=`
- [x] compound `/=`
- [x] boolean `and`
- [x] boolean `or`
- [x] boolean `not`
- [x] ternary-style conditional modifier expressions
- [x] `call`
- [x] general function declarations beyond package helper functions
- [x] package functions with `return`
- [x] string interpolation
- [x] typed `inject` expression aliases

### Queries, Mutations, And Guards

- [x] `query`
- [x] query aliases with `as`
- [x] nested query selections
- [x] `where`
- [x] `order by`
- [x] `guard ... when`
- [x] `loading`
- [x] `missing`
- [x] `error`
- [x] `create`
- [x] create with explicit default field values
- [x] create omitting default-valued fields
- [x] row-handle `update`
- [x] post-write UI consistency patterns

### Navigation

- [x] `project navigator`
- [x] stack navigators
- [x] tab navigators
- [x] screens
- [x] tabs
- [x] route params
- [x] path metadata
- [x] title metadata
- [x] icon metadata
- [x] presentation metadata
- [x] transition metadata
- [x] `navigation push`
- [x] `navigation pop`
- [x] `navigation tab`
- [x] back behavior in tests

### Forms, Inputs, And Accessibility Metadata

- [x] text inputs
- [x] multiline text inputs
- [x] field labels
- [x] placeholders
- [x] local form state
- [x] field-typed form state
- [x] save/submit action flow
- [x] loading metadata
- [x] disabled metadata
- [x] selected metadata
- [x] accessibility labels
- [x] status role
- [x] alert role

### Loading, Empty, And Error States

- [x] loading state view
- [x] empty state view
- [x] error state view
- [x] retry action
- [x] provider/runtime error surface

### Testing

- [x] sidecar `.test.tao`
- [x] `test`
- [x] `check`
- [x] `app = Base with { ... }`
- [x] `run`
- [x] `run ... with { ... }`
- [x] datasource app-id override
- [x] `expect text`
- [x] `expect missing text`
- [x] `press label`
- [x] `press id`
- [x] `press text`
- [x] `press placeholder`
- [x] `write`
- [x] `write into <selector>`
- [x] `clear`
- [x] `submit`
- [x] `back`
- [x] `scroll until`
- [x] `expect id`
- [x] `expect missing id`
- [x] `expect input ... value`
- [x] `expect button ... enabled`
- [x] `expect button ... disabled`
- [x] `expect checkbox ... checked`
- [x] direct action invocation test surface, if ever added

### Tooling And Developer Experience

- [x] MVP-local Justfile recipes for run, dev, design, compile, test, publish, package, and install

## Inherited From MVP-2

### App Capabilities

- [x] strings/i18n capability
- [x] locale capability
- [x] production/staging runtime target capability
- [x] environment/build profile capability
- [x] secrets policy/runtime manifest boundaries

### Layout And Rendering

- [x] layer concept
- [x] popovers
- [x] portals
- [x] toasts
- [x] render elision inside views
- [x] angle render blocks, if that direction survives

### Type System And Values

- [x] typed list elements
- [x] explicit standalone item literal examples outside `data`
- [x] explicit standalone list literal examples outside tests/data
- [x] boolean literals as first-class typed examples
- [x] `has`
- [x] `match`
- [x] type relation checks such as `Name is text`
- [x] structural `like` types
- [x] union types
- [x] richer collection inference
- [x] optional item properties outside data declarations
- [x] extension `is item`
- [x] general `TYPE Value` shorthand everywhere
- [x] `Value with Value` overlays outside app/test overrides
- [x] list merge semantics
- [x] append/remove collection overlay semantics

### Operators And Expressions

- [x] text concatenation
- [x] text repetition
- [x] list subtraction
- [x] list containment
- [x] value-level function tests/assertions
- [x] magical-string replacement strategy

### Events And Actions

- [x] time events such as `every 1.second`

### Data, Providers, And Mutation

- [x] `delete`
- [x] local InstantDB provider
- [x] provider-neutral data IR
- [x] provider auth setup
- [x] provider reset/cleanup hooks
- [x] datasource row seeding
- [x] production datasource opt-in behavior
- [x] CI datasource configuration examples
- [x] provider adapters beyond Memory

### Navigation And Routing

- [x] route tests for every navigator state
- [x] deep-link examples beyond path metadata
- [x] generated React Navigation runtime details in app-facing Tao
- [x] native/web parity examples

### Testing

- [x] focused `render` checks
- [x] render checks with state overrides
- [x] `using app`
- [x] render checks with child content
- [x] render checks with named slots
- [x] role/name selectors
- [x] accessibility-state selectors
- [x] string-key selectors for i18n
- [x] selector narrowing by row/region
- [x] count assertions
- [x] visible assertions
- [x] screenshot/video/artifact retention
- [x] `tao test --grep`
- [x] `tao test --watch`
- [x] `tao test --json`
- [x] `tao test --fail-fast`
- [x] `tao test --runtime=web`
- [x] `tao test --runtime=ios`
- [x] `tao test --runtime=android`
- [x] headless test runtime
- [x] package testing

### Design System

- [x] explicit semantic token sections
- [x] component recipes
- [x] recipe variants
- [x] recipe state styles
- [x] pattern recipes
- [x] design rules
- [x] contrast diagnostics
- [x] raw value diagnostics
- [x] duplicate-style diagnostics
- [x] token drift diagnostics
- [x] source-level `tao design check`
- [x] `tao design init`
- [x] `tao design theme --preset`
- [x] `tao design theme --seed`
- [x] `tao design fix --safe`
- [x] design lockfile
- [x] generated design provenance
- [x] starter theme presets
- [x] platform-specific design blocks
- [x] adaptive container-aware variants
- [x] dark mode scenario
- [x] density/motion/input-mode adaptation
- [x] design screenshots
- [x] design visual diff
- [x] design lab
- [x] AI-assisted design iteration
- [x] design DTCG import/export
- [x] Figma import/export
- [x] Tao MCP design context

### Scenarios And Visual States

- [x] `scenario`
- [x] scenario-driven design checks
- [x] loading scenario
- [x] empty scenario
- [x] normal scenario
- [x] long text scenario
- [x] many items scenario
- [x] error scenario
- [x] offline scenario
- [x] large text scenario
- [x] compact-width scenario

### Tooling And Developer Experience

- [x] `tao create`
- [x] default project scaffold
- [x] default package layout scaffold
- [x] design preview scaffold
- [x] `tao dev`
- [x] app switching in dev
- [x] file watching across import roots
- [x] iOS device LAN support
- [x] Android/web dev parity
- [x] production/staging build targets
- [x] IDE live preview
- [x] go-to-definition/reference examples
- [x] source actions beyond import organization
- [x] complete Kitchen Sink as v1 showcase

## Reconciled Sketch Directions

- [x] MVP-3 uses unified `[]` specs while old `<...>` style clauses remain external cleanup work.
- [x] MVP-3 includes an angle render block sketch while MVP-1 keeps brace render blocks.

## Expanded In MVP-3

### Accessibility And I18n Policy

- [x] first-class accessibility policy
- [x] explicit accessibility labels, hints, roles, state, and value requirements
- [x] route and sync announcements
- [x] focus order policy
- [x] keyboard, screen-reader, TV, and gamepad focus movement
- [x] stable render identifiers from render IDs, slots, and row keys
- [x] stable row-key requirements for repeated rows
- [x] high contrast adaptation
- [x] bold text adaptation
- [x] reduced transparency adaptation
- [x] invert-colors asset policy
- [x] larger text adaptation
- [x] category-specific warning policy
- [x] release warnings-as-errors
- [x] warning waivers with reasons
- [x] pluralized localized strings
- [x] rich localized text fragments
- [x] raw user-visible string policy
- [x] missing translation fallback and release policy
- [x] intentionally untranslated strings
- [x] locale-specific assets
- [x] right-to-left direction policy
- [x] mirrored icons and navigation affordances
- [x] logical direction preference for reusable components
- [x] currency, unit, date, and duration formatting policy

### Motion And Animation

- [x] `project motion`
- [x] typed motion intent examples
- [x] duration tokens
- [x] easing tokens
- [x] spring tokens
- [x] transform presets
- [x] state transitions
- [x] progress transitions
- [x] repeated animations
- [x] lifecycle enter and exit motion
- [x] reduced-motion adaptation
- [x] deterministic motion test behavior
- [x] runtime motion facade
- [x] platform and headless motion fallback policy
- [x] motion-aware design recipe

### Events And Interactions

- [x] custom `event` declarations
- [x] typed event payloads
- [x] `does` event declarations on views and actions
- [x] `emit`
- [x] action lifecycle handlers: started, done, failed, cancelled
- [x] block-scoped action lifecycle handling
- [x] query lifecycle events: updated, refreshing, stale, failed
- [x] `on after`
- [x] app lifecycle events: foreground, background, inactive
- [x] network online/offline events
- [x] orientation change events
- [x] keyboard show/hide events
- [x] safe-area change events
- [x] long-press events
- [x] hover events
- [x] scroll events
- [x] swipe events
- [x] drag events
- [x] pinch events

### Advanced Data And Providers

- [x] `date` field type
- [x] `json` field type
- [x] session declaration
- [x] `CurrentUser` provider auth binding
- [x] provider rule params
- [x] provider capability manifest
- [x] provider capability validation targets
- [x] `exists` query predicates
- [x] `missing` query predicates
- [x] `in` query predicates
- [x] `like` text-search predicates
- [x] cursor pagination
- [x] query `limit`
- [x] query-once reads
- [x] counts and aggregations
- [x] multi-root query bundle
- [x] provider schema push
- [x] schema diff policy
- [x] migrations folder
- [x] offline-first sync
- [x] optimistic updates
- [x] realtime subscriptions
- [x] conflict-resolution policy
- [x] `transaction`
- [x] `upsert`
- [x] `merge` as provider capability
- [x] `link`
- [x] `unlink`
- [x] lookup-style write target through `upsert ... by`
- [x] admin/backend provider boundary
- [x] server-only secrets

### Renderer Slots And Children

- [x] renderer slots such as `@row Item`
- [x] value slots such as `@key Item`
- [x] optional slots
- [x] required slots
- [x] slot defaults
- [x] slot return arrows
- [x] variadic `@@children`
- [x] fixed child-count constraints
- [x] keyed list rendering
- [x] empty-state renderer slot

### TypeScript And Native Bridges

- [x] bridge manifests
- [x] generated Tao declaration modules
- [x] npm bridge targets
- [x] React Native bridge targets
- [x] Expo module bridge targets
- [x] platform availability metadata
- [x] permission metadata
- [x] headless fallback metadata
- [x] async action bridging
- [x] function bridging
- [x] view/component bridging
- [x] hook/component/action boundary policy
- [x] bridge version lockfile
- [x] unsafe `any` and overload manual-annotation policy
- [x] subscription lifecycle ownership policy
- [x] haptics bridge example
- [x] clipboard bridge example
- [x] share-sheet bridge example
- [x] gesture bridge example

### Error Handling And Boundaries

- [x] result/error wrapper type
- [x] `ok` and `error` result construction
- [x] `try`
- [x] `catch`
- [x] `finally`
- [x] error wrapping with cause
- [x] case matching on result values
- [x] release policy requiring error handling
- [x] boundary declarations
- [x] preserving previous content across loading/error
- [x] boundary-specific loading, missing, and error branches

### Semantic Standard Library Types

- [x] unit-backed `Duration`
- [x] duration unit conversions
- [x] `Percent`
- [x] `Money`
- [x] `CurrencyCode`
- [x] semantic `Email`, `Url`, and `DeviceId`
- [x] constrained `random`
- [x] random typed text
- [x] random constrained number
- [x] random constrained percent

### Debugging And Tooling

- [x] dual authored/generated source maps
- [x] source map modes
- [x] repo-relative source paths
- [x] line-level stepping policy
- [x] Tao and generated TSX breakpoint mapping
- [x] source-map segment density policy
- [x] native/Hermes symbolication plan
- [x] per-module source-map logging
- [x] Tao devtools panels
- [x] action/event replay surface
- [x] direct source-map tests
- [x] `tao bridge generate`
- [x] `tao schema push`
- [x] `tao debug sourcemaps`
- [x] accessibility/i18n warning gate recipe
- [x] i18n extraction recipe
- [x] motion preview recipe
