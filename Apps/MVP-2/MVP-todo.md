# MVP Tao Feature Coverage

This is a repo-grounded checklist of Tao features that are current, intended, or mentioned in specs, roadmap notes, grammar, test apps, and the MVP app.

Checked items are already featured somewhere in `Apps/MVP-2`. MVP-2 includes the baseline sample plus expanded examples for features mentioned elsewhere in the repo.

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

## Expanded In MVP-2

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

- [x] MVP-2 uses unified `[]` specs while old `<...>` style clauses remain external cleanup work.
- [x] MVP-2 includes an angle render block sketch while MVP-1 keeps brace render blocks.
