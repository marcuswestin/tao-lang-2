---
name: tao-syntax
description: Write implemented Tao declarations, render trees, slots, expressions, conditions, and canonical source.
---

# Tao Syntax

## Declarations

- `project { ... }` supplies checked-in id, name, version, default app, remote, and license metadata.
- `app Name { ... }` configures a launchable app.
- `data Plural / Singular { ... }` declares stored entity shape.
- `nav Name = NavType { ... }` configures a navigation value.
- `scene Name(...) { ... }` declares presented content with host-facing slots such as `Title`.
- `view Name(...) { ... }` declares reusable rendered content.
- `design Name { ... }` declares flat color tokens and named clause bundles.
- `test "suite" { test "journey" { ... } }` declares black-box behavior journeys.
- `action Name(...) { ... }`, `command Name(...) { ... }`, `function Name(...) { ... }`, `let`,
  `state`, `query`, and `type Name is Base with { ... }` are also implemented.

Every view, action, and function declaration uses parentheses, including an empty `()`.

## Properties, children, and slots

Capitalized `Name Value` entries fill properties owned by the receiving declaration. Unnamed render
expressions are children. A view accepts unnamed children only when it places `@@content`. It offers
an optional named slot by declaring `@name = empty`; callers fill it once with `@name View(...)`.

```tao SkillSyntax.tao
use Col, Text from @tao/ui

view SkillCard(Title text) {
   @actions = empty
   render Col() [gap 8] {
      Text(Title)
      @@content
      @actions
}  }

view SkillSyntaxExample() {
   render SkillCard("Syntax") {
      Text("Unnamed child")
      @actions Text("Named slot")
}  }
```

## Names and expressions

- Import with `use X from ./Feature`, `use X, Y from @tao/ui`, or bare `use X` in one package.
- Calls bind `Name: Value` labels or uniquely matching unlabeled types; multiple arguments use commas.
- Values include text, numbers, booleans, `none`, `now`, durations such as `250.ms`, homogeneous
  lists, members, calls, and configured values.
- Strings interpolate full scalar expressions: `"{ Count } items"`.
- Operators include arithmetic, comparisons, `==`, `!=`, `and`, `or`, and `Value is Case` or
  `Value is empty`.
- Use one-sided `if`, exhaustive subject `when`, block-scoped `guard`, and `loop Items / Item`.
- `//` starts a line comment; `/* ... */` is an inline or block comment.

Layout or design entries may end in implemented conditions: light/dark scheme, `when pressed`,
`when focused`, `when hovered`, `when selected` (the active navigation tab), or
`when <Region> is active`. Do not invent breakpoint or platform-condition syntax.

## Formatting

Tao uses three-space indentation and gathers adjacent closing braces as `}  }`. Run `tao fix`; it
owns formatting, render-last placement, and `use` organization. Do not hand-format around it.
