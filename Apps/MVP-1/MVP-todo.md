# MVP Tao Feature Coverage

This is a repo-grounded checklist of Tao features that are current, intended, or mentioned in specs, roadmap notes, grammar, test apps, and the MVP app.

Checked items are already featured somewhere in `Apps/MVP-1`. Unchecked items are mentioned elsewhere in the repo but not yet represented in the MVP-1 sample.

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

## Not Yet Featured In MVP

### App Capabilities

- [ ] strings/i18n capability
- [ ] locale capability
- [ ] production/staging runtime target capability
- [ ] environment/build profile capability
- [ ] secrets policy/runtime manifest boundaries

### Layout And Rendering

- [ ] layer concept
- [ ] popovers
- [ ] portals
- [ ] toasts
- [ ] render elision inside views
- [ ] angle render blocks, if that direction survives

### Type System And Values

- [ ] typed list elements
- [ ] explicit standalone item literal examples outside `data`
- [ ] explicit standalone list literal examples outside tests/data
- [ ] boolean literals as first-class typed examples
- [ ] `has`
- [ ] `match`
- [ ] type relation checks such as `Name is text`
- [ ] structural `like` types
- [ ] union types
- [ ] richer collection inference
- [ ] optional item properties outside data declarations
- [ ] extension `is item`
- [ ] general `TYPE Value` shorthand everywhere
- [ ] `Value with Value` overlays outside app/test overrides
- [ ] list merge semantics
- [ ] append/remove collection overlay semantics

### Operators And Expressions

- [ ] text concatenation
- [ ] text repetition
- [ ] list subtraction
- [ ] list containment
- [ ] value-level function tests/assertions
- [ ] magical-string replacement strategy

### Events And Actions

- [ ] time events such as `every 1.second`

### Data, Providers, And Mutation

- [ ] `delete`
- [ ] local InstantDB provider
- [ ] provider-neutral data IR
- [ ] provider auth setup
- [ ] provider reset/cleanup hooks
- [ ] datasource row seeding
- [ ] production datasource opt-in behavior
- [ ] CI datasource configuration examples
- [ ] provider adapters beyond Memory

### Navigation And Routing

- [ ] route tests for every navigator state
- [ ] deep-link examples beyond path metadata
- [ ] generated React Navigation runtime details in app-facing Tao
- [ ] native/web parity examples

### Testing

- [ ] focused `render` checks
- [ ] render checks with state overrides
- [ ] `using app`
- [ ] render checks with child content
- [ ] render checks with named slots
- [ ] role/name selectors
- [ ] accessibility-state selectors
- [ ] string-key selectors for i18n
- [ ] selector narrowing by row/region
- [ ] count assertions
- [ ] visible assertions
- [ ] screenshot/video/artifact retention
- [ ] `tao test --grep`
- [ ] `tao test --watch`
- [ ] `tao test --json`
- [ ] `tao test --fail-fast`
- [ ] `tao test --runtime=web`
- [ ] `tao test --runtime=ios`
- [ ] `tao test --runtime=android`
- [ ] headless test runtime
- [ ] package testing

### Design System

- [ ] explicit semantic token sections
- [ ] component recipes
- [ ] recipe variants
- [ ] recipe state styles
- [ ] pattern recipes
- [ ] design rules
- [ ] contrast diagnostics
- [ ] raw value diagnostics
- [ ] duplicate-style diagnostics
- [ ] token drift diagnostics
- [ ] source-level `tao design check`
- [ ] `tao design init`
- [ ] `tao design theme --preset`
- [ ] `tao design theme --seed`
- [ ] `tao design fix --safe`
- [ ] design lockfile
- [ ] generated design provenance
- [ ] starter theme presets
- [ ] platform-specific design blocks
- [ ] adaptive container-aware variants
- [ ] dark mode scenario
- [ ] density/motion/input-mode adaptation
- [ ] design screenshots
- [ ] design visual diff
- [ ] design lab
- [ ] AI-assisted design iteration
- [ ] design DTCG import/export
- [ ] Figma import/export
- [ ] Tao MCP design context

### Scenarios And Visual States

- [ ] `scenario`
- [ ] scenario-driven design checks
- [ ] loading scenario
- [ ] empty scenario
- [ ] normal scenario
- [ ] long text scenario
- [ ] many items scenario
- [ ] error scenario
- [ ] offline scenario
- [ ] large text scenario
- [ ] compact-width scenario

### Tooling And Developer Experience

- [ ] `tao create`
- [ ] default project scaffold
- [ ] default package layout scaffold
- [ ] design preview scaffold
- [ ] `tao dev`
- [ ] app switching in dev
- [ ] file watching across import roots
- [ ] iOS device LAN support
- [ ] Android/web dev parity
- [ ] production/staging build targets
- [ ] IDE live preview
- [ ] go-to-definition/reference examples
- [ ] source actions beyond import organization
- [ ] complete Kitchen Sink as v1 showcase

## Stale Or Conflicting Mentions To Reconcile

- [ ] Old `<...>` style clauses remain in specs/roadmap material, while MVP now uses unified `[]` specs.
- [ ] Roadmap mentions angle render blocks, while current MVP still uses brace render blocks.
