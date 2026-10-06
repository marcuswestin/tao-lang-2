---
name: tao-syntax
description: >-
  Write implemented Tao syntax. Use before authoring or correcting declarations, render trees,
  slots, expressions, conditions, or canonical source; future language design needs a separate decision.
---

# Tao Syntax

## Declarations

- `.tao/` marks the project root. Runnable apps own lowercase `id`, `version`, and `name`, plus
  dependencies; variants inherit them and may override identity fields. Effective ID/version pairs
  must be unique. Root-only `package { ... }` blocks define publications with optional name, version,
  license, dependencies, and `includes` of named modules.
- `app Name { ... }` configures a launchable app.
- `data Plural / Singular { ... }` declares stored entity shape.
- `nav Name = NavType { ... }` configures a navigation value.
- `scene Name(...) { ... }` declares presented content with host-facing slots such as `Title`.
- `view Name(...) { ... }` declares reusable rendered content.
- `design Name { ... }` declares flat color tokens and named clause bundles.
- `test "suite" { test "journey" { ... } }` declares black-box behavior journeys.
- `action Name(...) { ... }`, `command Name(...) { ... }`, `function Name(...) { ... }`, `let`,
  `state`, `query`, and `type Name is Base with { ... }` are also implemented.

Invocable parameters use parentheses. Argument-free views may omit them in declarations and
render placement; actions/functions retain invocation parentheses.

## Properties, children, and slots

Capitalized `Name Value` entries fill properties owned by the receiving declaration. Item/write
fields are comma-separated. Unnamed render expressions are children; `@@content` places unnamed
content. Named slots use `@name: Default`, parameterized slots use `@name(Types): Renderer`, and
callers fill them with `@name: Content` or `@name Binders -> Content`. Placements may repeat;
`@name: @other` forwards a compatible renderer. Arguments and styles precede the render body.

```tao SkillSyntax.tao
use Col, Text from @tao/ui

view SkillCard(Title text) {
   @actions: empty
   render Col [gap 8] {
      Title
      @@content
      @actions
}  }

view SkillSyntaxExample {
   render SkillCard("Syntax") {
      "Unnamed child"
      @actions: "Named slot"
}  }
```

## Names and expressions

- Import with `use X from ./Feature`, `use X, Y from @tao/ui`, `use all from @tao/ui`, or bare `use X`
  in one package. Import aliases preserve declaration identity.
- Calls bind roles/types independently of argument order; explicit labels remain supported.
  `Subtract(Right 2, Left 5)` constructs signature roles; `.Right 2` forces signature lookup when
  necessary. `PersonName.GivenName` projects its signature type. Ambiguous matches are errors.
- `type Child is Parent` preserves nominal ancestry. Upward admission is implicit; narrowing and
  sibling conversion require explicit construction/conversion. `as` binds tighter than comparison.
- `can` is structural: compatible associated methods satisfy it without an adoption declaration.
  `Self` retains the concrete domain; generic constraints use `where type T is Capability`.
- Function results may be inferred; `-> Type` restricts them. `fails never`, `fails X, Y` or an open
  contract describe failure bounds. Functions/converters cannot invoke actions, perform I/O or suspend.
- Values include text, numbers, yes/no, `none`, lists, members, calls and configured values. Signed
  quantities use lowercase postfix units, such as `-2 seconds` or `2 Duration.seconds`.
- Strings interpolate full scalar expressions: `"{ Count } items"`.
- Operators include arithmetic, comparisons, `==`, `!=`, `and`, `or`, and `Value is Case` or
  `Value is empty`.
- Use one-sided `if`, snapshot multi-match `when`, single-result `pick`, block-scoped `guard`, and
  `loop Items / Item`. `otherwise` is the fallback. A matched guard stops its enclosing block.
- Bare text values render through ui and omit a node when empty. Quoted text is render sugar;
  explicit `Text("")` retains a node. Types/entities can supply an associated `view Render()`.
- Event handlers use `on press -> do Commit()` or a block/control statement. Action calls join their
  caller; `then { done Result -> ... }` handles completion and named/error branches handle failures.
  `async` starts detached owned work. `defer DeleteTemporaryFile(File)` registers joined LIFO cleanup.
- `#tag accessible label "Description"` annotates the following render; omit the tag when unnecessary.
- `//` starts a line comment; `/* ... */` is an inline or block comment.

Layout or design entries may end in implemented conditions: light/dark scheme, `when pressed`,
`when focused`, `when hovered`, `when selected` (the active navigation tab), or
`when <Region> is active`. Do not invent breakpoint or platform-condition syntax.

## Formatting

Tao uses three-space indentation and gathers adjacent closing braces as `}  }`. Run `tao fix`; it
owns formatting, render-last placement, and `use` organization. Do not hand-format around it.
