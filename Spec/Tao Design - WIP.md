## North star

Tao should make UI design feel like this:

> Write semantic structure and layout. Tao gives it taste, coherence, accessibility, responsiveness, and platform polish by default. When you want a different vibe, you ask the design system to evolve, not every component to be hand-styled.

The big opportunity is that Tao can treat design as a **language/compiler concern**, not a CSS-library concern. That means design tokens, visual rules, component recipes, accessibility checks, AI iteration, screenshot comparison, and platform adaptation can all be first-class.

---

## What current design tooling suggests

Several strong signals point in the same direction:

Design systems are converging on **tokens as portable source of truth**. The Design Tokens Community Group announced a stable 2025.10 specification for sharing colors, typography, spacing, themes, aliases, component references, and cross-platform outputs across iOS, Android, web, and Flutter. [oai_citation:0‡W3C](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/) Fluent 2 describes tokens as stored values for color, typography, spacing, elevation, and other styles, with global tokens plus semantic alias tokens. [oai_citation:1‡Fluent 2 Design System](https://fluent2.microsoft.design/design-tokens) Material 3 similarly organizes themes around color, typography, and shapes, and uses color roles rather than raw colors directly. [oai_citation:2‡Android Developers](https://developer.android.com/develop/ui/compose/designsystems/material3)

The most successful developer-first systems do **beautiful defaults plus local ownership**. shadcn/ui’s premise is “not a component library” but a way to build your own component library, with open code, composition, distribution, beautiful defaults, and AI-readable component code. [oai_citation:3‡Shadcn UI](https://ui.shadcn.com/docs) Its registry model lets teams distribute components, hooks, pages, config, rules, and other files to projects, and it is not limited to React. [oai_citation:4‡Shadcn UI](https://ui.shadcn.com/docs/registry)

Modern styling systems are moving toward **static, typed, predictable output**. StyleX avoids selector specificity conflicts, compiles to atomic CSS, supports typed styles, and relies on build-time optimization. [oai_citation:5‡StyleX](https://stylexjs.com/blog/introducing-stylex) Panda CSS emphasizes zero-runtime, build-time generated styles, token support, semantic tokens, and typed recipe variants. [oai_citation:6‡Panda CSS](https://panda-css.com/) vanilla-extract similarly generates static CSS at build time with type-safe themes and token contracts. [oai_citation:7‡vanilla-extract](https://vanilla-extract.style/)

AI UI generation works best when constrained by **tokens, components, and registries** rather than unconstrained visual guessing. Vercel’s guidance for AI prototyping starts with existing tokens, then builds components and blocks, then publishes a registry so humans and models share the same design-system context. [oai_citation:8‡Vercel](https://vercel.com/blog/ai-powered-prototyping-with-design-systems) Figma’s MCP server is explicitly aimed at connecting design components to code components, generating design-system rules aligned to a codebase, and translating designs into production-ready code. [oai_citation:9‡Figma Help Center](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)

For Tao specifically, the Expo path is promising because Expo has first-class web support for React apps, so a Tao app that lowers to Expo can be opened in a browser for automated design inspection. [oai_citation:10‡Expo Documentation](https://docs.expo.dev/workflow/web/) Playwright can generate and compare screenshots through `toHaveScreenshot`, which gives Tao a practical visual-feedback loop for `tao design`. [oai_citation:11‡Playwright](https://playwright.dev/docs/test-snapshots)

Accessibility should be built into the design compiler, not added later. WCAG 2.2 requires normal text contrast of at least 4.5:1 and large text contrast of at least 3:1 at Level AA. [oai_citation:12‡W3C](https://www.w3.org/TR/WCAG22/) WCAG 2.2 target-size guidance is intended to reduce accidental activation of small adjacent targets, and recommends at least meeting the minimum target-size requirement regardless of spacing. [oai_citation:13‡W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) React Native exposes accessibility APIs across iOS and Android, but platform behavior differs, so Tao should own semantic accessibility at the language level and lower it correctly. [oai_citation:14‡React Native](https://reactnative.dev/docs/accessibility)

---

## Core concept: split layout from design

You already have layout-ish syntax like:

```tao
[pad 10, fill]
```

I would make that division explicit:

```tao
[ ... ]   layout, sizing, flow, containment
< ... >   design, visual treatment, semantic appearance
```

Examples:

```tao
Screen <bg canvas, fg text> [safe, scroll] {
  Col [pad screen, gap xl, fill] {
    Text "Welcome back" <type display, fg text.strong>

    Card <surface raised, border subtle, radius xl, shadow sm> [pad lg, gap md] {
      Text "Your progress" <type title>
      Text "3 tasks completed today" <type body, fg muted>
    }

    Button "Continue" <primary, size lg, full>
  }
}
```

This gives Tao three styling levels:

```tao
[pad lg, gap md, fill]
```

Layout primitives.

```tao
<bg surface, border subtle, radius lg>
```

Low-level visual tokens.

```tao
<card raised>
<button primary>
<input error>
<screen calm>
```

Semantic design recipes.

The key: `<bg #FF00AA>` can exist for prototyping, but Tao should prefer `<bg accent>` or `<bg brand.primary>`. Raw values should compile, but `tao design check` should suggest tokenizing them.

---

## The Tao design stack

I would structure Tao design around five layers.

### 1. Raw tokens

These are primitive values.

```tao
tokens {
  color {
    indigo.500 = oklch(55% 0.18 275)
    gray.950 = oklch(12% 0.02 260)
  }

  space {
    0 = 0
    1 = 4
    2 = 8
    3 = 12
    4 = 16
    5 = 24
    6 = 32
    screen = 20
  }

  radius {
    sm = 6
    md = 10
    lg = 16
    xl = 24
    pill = 999
  }

  shadow {
    sm = ...
    md = ...
  }
}
```

Tao can export these to the DTCG JSON format, but the Tao-native authoring format can be nicer than JSON.

### 2. Semantic tokens

These name intent, not implementation.

```tao
semantic {
  bg.canvas = color.gray.50
  bg.surface = color.white
  bg.raised = color.white
  fg.text = color.gray.950
  fg.muted = color.gray.600
  border.subtle = color.gray.200

  intent.primary.bg = color.indigo.500
  intent.primary.fg = color.white
  intent.destructive.bg = color.red.600
}
```

This follows the direction of Fluent alias tokens and Material color roles: app code should use meanings like `surface`, `muted`, `primary`, and `danger`, not raw hex values. [oai_citation:15‡Fluent 2 Design System](https://fluent2.microsoft.design/design-tokens)

### 3. Component recipes

Recipes define how components look by default.

```tao
recipe Button {
  base {
    [center, minTap 44, pad x.md y.sm]
    <radius md, type label, transition press>
  }

  variant size {
    sm { [pad x.sm y.xs] <type label.sm> }
    md { [pad x.md y.sm] <type label> }
    lg { [pad x.lg y.md] <type label.lg> }
  }

  variant intent {
    primary {
      <bg intent.primary.bg, fg intent.primary.fg, border transparent>
    }

    secondary {
      <bg surface, fg text, border subtle>
    }

    destructive {
      <bg intent.destructive.bg, fg white>
    }
  }

  state pressed {
    <brightness -4%, scale .98>
  }

  state disabled {
    <opacity disabled>
  }

  default {
    size = md
    intent = primary
  }
}
```

This borrows from the “recipe/variant” direction in systems like Panda, but Tao can make it language-native instead of library-specific. Panda’s recipe model connects variants to tokens and extracts atomic styles ahead of time. [oai_citation:16‡Panda CSS](https://panda-css.com/docs/concepts/recipes)

### 4. Pattern recipes

Components are not enough. Tao should have patterns like:

```tao
pattern AuthScreen
pattern EmptyState
pattern ListDetail
pattern DashboardShell
pattern SettingsForm
pattern OnboardingStep
pattern Paywall
pattern ChatThread
```

A design system with only buttons, inputs, and cards is still too low-level. Tao should ship with “screen grammar.”

Example:

```tao
pattern EmptyState {
  layout {
    [center, gap lg, maxWidth 420, pad screen]
  }

  slots {
    icon <size xl, fg muted>
    title <type title, align center>
    body <type body, fg muted, align center>
    action <primary, size lg>
  }
}
```

This matches the design-system lesson that teams need patterns, not just primitives. [oai_citation:17‡tkdodo.eu](https://tkdodo.eu/blog/designing-design-systems)

### 5. Design rules

Rules are constraints the compiler and design agent can check.

```tao
rules {
  contrast minimum = wcag.aa
  tapTarget minimum = 44
  rawColor allowed = themeOnly
  maxRadiiPerScreen = 3
  maxTypeStylesPerScreen = 5
  requireSemanticRole interactive
  preferTokensForSpacing = true
}
```

This is where Tao becomes more than styling. It becomes a design compiler.

---

## Syntax ideas

### Basic visual modifiers

```tao
Box <bg surface, border subtle, radius lg, shadow sm>
Text <fg muted, type body>
Button <bg primary, fg onPrimary, radius md>
```

### Semantic shorthands

```tao
Card <raised>
Button <primary>
Button <secondary>
Button <destructive>
Text <title>
Text <caption muted>
```

### States

```tao
Button "Save" <
  primary,
  hover bg primary.hover,
  press bg primary.press,
  focus ring focus,
  disabled opacity disabled
>
```

Alternative terser syntax:

```tao
Button "Save" <primary, hover:bg primary.hover, press:scale .98, focus:ring>
```

### Platform variants

```tao
Card <
  surface raised,
  ios material glass,
  android elevation 2,
  web shadow sm
>
```

### Adaptive variants

```tao
Col [gap md] {
  Card <compact when container < sm>
  Card <spacious when container >= md>
}
```

Container-driven design is a modern responsive direction: CSS container queries let components adapt based on their container rather than the whole viewport. [oai_citation:18‡MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) Every Layout makes the related argument that layout systems should use composable, algorithmic primitives instead of magic numbers and breakpoint hacks. [oai_citation:19‡every-layout.dev](https://every-layout.dev/) Tao can bring that model to native and web.

### Scoped themes

```tao
Theme <brand "midnight"> {
  Dashboard {}
}

Theme <density compact> {
  Sidebar {}
}
```

### Style slots

Instead of CSS selectors, use typed slots:

```tao
recipe Card {
  slots {
    root <surface raised, radius lg, border subtle>
    title <type title>
    body <type body, fg muted>
    action <button secondary>
  }
}
```

Then:

```tao
Card {
  Text slot:title "Billing"
  Text slot:body "Your next invoice is ready."
  Button slot:action "View invoice"
}
```

This avoids CSS specificity problems entirely. StyleX’s emphasis on avoiding specificity conflicts and having predictable “last style wins” merging is a strong precedent. [oai_citation:20‡StyleX](https://stylexjs.com/blog/introducing-stylex)

---

## `tao init`: make every app good-looking immediately

Start here.

`tao init` should create:

```text
tao.design
tao.tokens.json
tao.design.lock
app/
  ...
design/
  preview.tao
  screenshots/
```

Initial CLI:

```bash
tao init
```

Prompts:

```text
App name?
Primary platform? mobile / web / universal
Style direction? calm / playful / editorial / professional / futuristic / native
Density? cozy / normal / compact
Brand color? auto / choose / from logo
Use platform-native defaults? yes/no
```

Generated files:

```tao
design AppTheme {
  personality = calm
  density = normal
  platform = universal

  tokens { ... }
  semantic { ... }

  recipes {
    Button { ... }
    Card { ... }
    TextInput { ... }
    Screen { ... }
    NavBar { ... }
  }

  patterns {
    EmptyState { ... }
    FormSection { ... }
    ListItem { ... }
  }

  rules {
    contrast = wcag.aa
    tapTarget = 44
  }
}
```

The default should not feel like “unstyled React Native.” It should feel like “a coherent app shell appeared.”

Recommended built-in starter themes:

```text
Tao Native       clean platform-adaptive default
Tao Studio       polished SaaS/editorial
Tao Play         colorful consumer app
Tao Calm         wellness/notes/coaching apps
Tao Ledger       finance/data-heavy apps
Tao Field        operational/internal tools
Tao Night        dark-first premium apps
Tao Kids         large, friendly, accessible
```

Each theme should be generated from the same underlying token architecture so switching themes is safe.

---

## `tao design`: the long-term magic

I would make `tao design` a suite of commands, starting deterministic and becoming agentic over time.

### 1. Deterministic template generator

```bash
tao design init
tao design theme --preset calm
tao design theme --seed "#635bff"
```

This updates only `tao.design`.

### 2. Static design analyzer

```bash
tao design scan
```

Outputs:

```text
Design scan

✓ 42 components use semantic colors
⚠ 7 raw colors found
⚠ 11 raw spacing values found
✗ 2 text/background pairs fail WCAG AA contrast
⚠ Button "Delete" has destructive intent but uses primary style
⚠ Settings screen uses 6 radius values; theme defines 4
```

Then:

```bash
tao design fix --safe
```

Safe fixes:

```text
- Replace raw spacing 16 with space.4
- Replace #FFFFFF with bg.surface
- Add minTap to icon-only buttons
- Convert repeated card styles into recipe Card.raised
```

### 3. App-specific theme generation

```bash
tao design generate
```

This should read:

```text
- app name
- routes
- component tree
- visible text
- data schema names
- icon usage
- interaction types
- current styles
- screenshots if available
```

Then generate a unique design direction:

```text
Detected app type: personal finance tracker
Suggested design direction: Ledger Calm
Traits: high trust, low ornament, strong number hierarchy, compact dashboards, soft contrast
```

Outputs:

```text
tao.design        updated tokens and recipes
tao.design.lock   records generated decisions
design/report.md  explanation and before/after screenshots
```

### 4. Screenshot style import

```bash
tao design --from reference.png
```

Modes:

```bash
tao design --from reference.png --scope theme
tao design --from reference.png --scope spacing
tao design --from reference.png --scope typography
tao design --from reference.png --scope layout
```

Important distinction: this should infer a **style direction**, not blindly clone a third-party UI. It should extract things like density, contrast, radius, typography scale, surface layering, and color temperature.

### 5. Expo visual loop

```bash
tao design iterate --route /dashboard --device iphone,tablet,web
```

Internal loop:

```text
1. Compile Tao app to Expo.
2. Open Expo web route in a hidden browser.
3. Take screenshots across device sizes, themes, and states.
4. Run deterministic checks: contrast, tap targets, overflow, clipping, hierarchy.
5. Run AI critique on screenshots and UI AST.
6. Propose patch to tokens, recipes, or layout modifiers.
7. Re-render.
8. Stop when score improves or max iterations is reached.
9. Show visual diff and ask developer to accept changes.
```

Expo web plus Playwright makes this plausible today: Expo can render a universal app in the browser, and Playwright can generate and compare screenshots. [oai_citation:21‡Expo Documentation](https://docs.expo.dev/workflow/web/)

### 6. Visual diff

```bash
tao design diff
```

Output:

```text
/dashboard
  light / phone
    hierarchy +12%
    contrast pass
    layout shift: low
    changed: Button.primary, Card.raised, space.screen

/settings
  dark / phone
    contrast fail fixed
    changed: fg.muted
```

### 7. Design lab

```bash
tao design lab
```

This opens a local design workbench:

```text
- token editor
- component gallery
- screen gallery
- state matrix
- dark/light toggle
- density toggle
- platform toggle
- screenshot baselines
- AI critique panel
- design history
```

Storybook’s core value is isolated UI development, testing, and documentation. [oai_citation:22‡Storybook](https://storybook.js.org/?utm_source=chatgpt.com) Tao should have its own version, but language-native.

---

## `tao.design.lock`

A lockfile is the right idea. It should prevent AI/design churn.

Example:

```yaml
version: 1

theme:
  id: app-theme-ledger-calm
  generatedBy: tao-design-template@0.1
  tokenHash: 9fb3e2
  acceptedAt: 2026-06-24T10:12:00-07:00

appFingerprint:
  routesHash: 32a991
  componentsHash: f89d20
  copyHash: a91b40

generated:
  tokens:
    color.brand.primary:
      source: seed
      locked: true

    radius.lg:
      source: preset
      locked: false

  recipes:
    Button:
      source: tao-default
      modifiedByUser: false

    Card.raised:
      source: tao-design-ai
      modifiedByUser: true
      locked: true

screens:
  /dashboard:
    lastRenderedHash: 902aa1
    baselines:
      iphone.light: design/screenshots/dashboard.iphone.light.png
      iphone.dark: design/screenshots/dashboard.iphone.dark.png
    score:
      contrast: pass
      tapTargets: pass
      overflow: pass
      visualHierarchy: 0.82

ai:
  lastModel: ...
  lastPromptHash: ...
  maxEditScope:
    - tao.design
    - design/generated/*
```

Rules:

```text
- Never rewrite user-locked tokens.
- Never change raw UI structure unless --layout is passed.
- Never touch business logic.
- Prefer token and recipe edits over per-component edits.
- Keep generated changes explainable.
- Store before/after screenshot hashes.
```

This makes AI design iteration reproducible and reviewable.

---

## Tao’s killer feature: design as compile-time feedback

The design checker should feel like TypeScript for visual quality.

Examples:

```text
error[contrast.aa]
Text "Continue" uses fg.muted on bg.primary.
Contrast is 2.8:1; required 4.5:1.
Suggested fix: use fg.onPrimary.
```

```text
warning[tap.target]
IconButton at app/settings.tao:42 renders 32x32.
Recommended minimum is 44x44.
Suggested fix: [minTap 44] or <size md>.
```

```text
warning[hierarchy.flat]
Dashboard screen has 14 text elements with type body.
Suggested fix: promote "Balance" to <type title> and "$4,290" to <type display>.
```

```text
warning[token.drift]
This screen uses 7 distinct spacing values.
Theme scale defines 5.
Suggested fix: map 18 → space.4 and 22 → space.5.
```

```text
info[recipe.extract]
The same visual treatment appears 6 times.
Suggested recipe: Card.stat
```

This is where Tao can be genuinely next-generation. Most frameworks provide styling APIs. Tao can provide **design diagnostics**.

---

## Make Tao designs unique without making them chaotic

The generator should not merely pick colors. It should generate a **design genome**:

```tao
personality {
  warmth = 0.62
  contrast = 0.48
  density = 0.35
  roundness = 0.72
  elevation = 0.25
  motion = 0.30
  ornament = 0.18
  nativeAffinity = 0.80
}
```

Then tokens derive from that:

```text
roundness → radius scale
density → spacing scale and component heights
contrast → foreground/background pairs
warmth → neutral palette temperature
elevation → shadow/surface strategy
motion → animation duration/easing
nativeAffinity → iOS/Android/web adaptation strength
```

This gives `tao design` a knob-based design space that is stable, explainable, and editable.

Commands:

```bash
tao design tune --warmer
tao design tune --more-premium
tao design tune --denser
tao design tune --more-native
tao design tune --less-rounded
```

Generated patch:

```diff
personality.roundness 0.72 -> 0.56
radius.md 10 -> 8
radius.lg 16 -> 12
Button.radius pill -> lg
```

This is much better than “AI randomly changed a bunch of CSS.”

---

## AI should edit constrained design objects, not arbitrary UI code

The safest architecture:

```text
AI can edit:
  - design genome
  - tokens
  - semantic tokens
  - recipes
  - pattern choices
  - explicit generated design blocks

AI cannot edit by default:
  - app logic
  - data queries
  - navigation
  - event handlers
  - arbitrary component structure
```

For layout iteration, require explicit scope:

```bash
tao design iterate --layout
```

Even then, Tao should produce a structured patch:

```text
Change 1
Route: /dashboard
Reason: primary CTA below fold on 390x844 viewport
Patch: move Button slot:primaryAction into HeaderActions pattern

Change 2
Route: /dashboard
Reason: stat cards too cramped
Patch: change Grid minCell 140 -> 164
```

This keeps the design agent from becoming a vague code mutator.

---

## Build a Tao MCP server

Long-term, this is important.

```bash
tao mcp
```

Expose structured context to external AI tools:

```text
- UI AST
- route list
- component recipes
- token graph
- design lockfile
- screenshot baselines
- design rules
- compiler diagnostics
- allowed patch scopes
```

Figma is moving in this direction with its MCP server and Code Connect, using structured design/code context to improve AI output. [oai_citation:23‡Figma Help Center](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server) Tao can be designed for this from day one.

Unique advantage: Tao’s UI syntax is already structured and semantic. AI does not need to reverse-engineer a pile of JSX, Tailwind classes, and CSS files.

---

## Figma, but optional

Tao should not depend on Figma, but should interoperate.

Possible commands:

```bash
tao design export figma
tao design import figma <file-or-node>
tao design export tokens --format dtcg
tao design import tokens --format dtcg
```

A strong Tao workflow:

```text
Code → Tao UI AST → Tao design preview → optional Figma layers
Figma → MCP/Code Connect-like metadata → Tao recipes/tokens
Screenshot → inferred style genome → Tao theme
```

Figma’s current direction is explicitly about giving AI agents structured design context and connecting code components with design components. [oai_citation:24‡Figma Help Center](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server?utm_source=chatgpt.com) Tao can mirror this while staying code-native.

---

## Component registry

Tao should have a registry, but it should distribute more than components.

```bash
tao add block auth/signup
tao add block dashboard/metrics
tao add theme ledger-calm
tao add recipe button/split
tao add pattern settings/form-section
```

Registry package contents:

```text
- Tao component/pattern source
- recipes
- tokens
- screenshots
- accessibility expectations
- design rules
- scenarios
- AI instructions
```

Inspired by shadcn/ui, the registry should give developers actual source they can own, not opaque package components. shadcn’s docs emphasize open code, composition, CLI distribution, and beautiful defaults. [oai_citation:25‡Shadcn UI](https://ui.shadcn.com/docs)

---

## Scenario-driven design

Because Tao already has app/data semantics, design can be tested against realistic states.

```bash
tao design scenarios
```

Generated matrix:

```text
Dashboard
  - empty
  - loading
  - normal
  - long names
  - many items
  - error
  - offline
  - large text
  - dark mode
  - compact width
```

Syntax:

```tao
scenario Dashboard.empty {
  user = null
  tasks = []
}

scenario Dashboard.longText {
  user.name = "Alexandria Cassandra Montgomery-Smith"
}
```

Then:

```bash
tao design check --scenarios all
tao design screenshots --scenarios all
```

This is where Tao can outperform traditional design tools: it can understand app states, not just static frames.

---

## Platform-native adaptation

Tao should not force every platform to look identical.

```tao
design AppTheme {
  platform ios {
    nav = native
    material = glass
    radius.bias = +2
  }

  platform android {
    nav = material
    dynamicColor = true
    elevation = tonal
  }

  platform web {
    focusRing = visible
    hover = true
    containerQueries = true
  }
}
```

Material You dynamic color derives custom colors from a user’s wallpaper and uses them to generate light and dark color schemes. [oai_citation:26‡Android Developers](https://developer.android.com/develop/ui/compose/designsystems/material3) Tao can support that kind of adaptation while preserving app identity.

---

## The first implementation path

### Phase 1: syntax + static theme

Build:

```text
- `<...>` parser
- design token file
- semantic token resolution
- style lowering to React Native/Expo
- `tao init` theme generator
- 5–8 built-in recipes: Screen, Text, Button, Card, Input, ListItem, NavBar, Badge
```

Do not start with AI. Make a deterministic system first.

### Phase 2: recipes + linter

Build:

```text
- recipe definitions
- variants
- state styles
- design diagnostics
- raw value warnings
- contrast checks
- tap target checks
- duplicate-style extraction
```

Command:

```bash
tao design check
tao design fix --safe
```

### Phase 3: lockfile + app-specific generation

Build:

```text
- tao.design.lock
- app fingerprinting
- route/component scan
- generated theme provenance
- safe patch generation
- design reports
```

Command:

```bash
tao design generate
tao design diff
tao design accept
```

### Phase 4: screenshot loop

Build:

```text
- Expo web preview integration
- Playwright screenshots
- baseline screenshots
- route/device/theme matrix
- visual diff reports
- AI critique constrained to design files
```

Command:

```bash
tao design iterate --route /home --device phone,tablet,web
```

### Phase 5: ecosystem

Build:

```text
- Tao design lab
- Tao MCP server
- Figma import/export
- DTCG token import/export
- block/theme registry
- design branches
```

---

## The product experience I would aim for

A new user runs:

```bash
tao init habit-tracker
```

They get a coherent app.

They write:

```tao
Screen [safe, scroll] {
  Col [pad screen, gap lg] {
    Text "Today" <display>
    HabitList habits
    Button "Add habit" <primary, full>
  }
}
```

It already looks good.

Then:

```bash
tao design generate --vibe "calm, encouraging, not childish"
```

Tao updates the theme, recipes, and pattern choices.

Then:

```bash
tao design iterate --all
```

Tao renders the app, critiques screenshots, fixes contrast, normalizes spacing, improves hierarchy, and proposes a diff.

Then:

```bash
tao design lab
```

The developer sees every component, every screen, every state, every theme, and every suggested change.

That is the next-generation experience: design is not a separate phase, not a CSS file, not a pile of classes, and not an uncontrolled AI code rewrite. It is a structured, typed, visual, iterative part of the language.
