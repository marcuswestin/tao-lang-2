---
name: tao-testing
description: >-
  Prove Tao app behavior and prepare review scenarios. Use when writing or fixing .test.tao journeys,
  choosing selectors or fixtures, adding Studio scenarios, or reviewing app visuals.
---

# Tao Testing

Put black-box journeys in `<App>.test.tao` and import the app through ordinary visibility. Each
inner test starts a fresh mounted app, isolated Memory-backed data, navigation, state, and held
clock. Tests act on rendered controls and assert what a person can observe; they cannot read Tao
state, provider rows, or generated TypeScript.

```tao SkillProof.test.tao
use Pantry from ./

test "Installed skill proof" {
   test "opens the starter" {
      run Pantry
      expect navigation title "Ingredients"
      expect text "No ingredients yet"
      enter "Salt" into #ingredientName
      press #addIngredient
      select #ingredients[1] {
         expect label "Salt"
         press #openIngredient
      }
      expect navigation title "Salt"
   }
}
```

## Selectors and steps

- Prefer visible `text`, accessibility `label`, or input `placeholder`; matching is exact after
  whitespace normalization.
- `#tag` targets the immediately following render or loop. Tags are private test metadata, not IDs.
- A tagged loop must have one unconditional direct row root. Select its 1-based row with
  `select #rows[1] { ... }`; nested selectors stay inside that row.
- Actions: `press`, `enter ... into`, `submit`, `back`, `relaunch`, `relaunch fresh`, key/toolbar
  operations, focus, hover, narrowing, and `advance <duration>`.
- Assertions include present/missing text, labels, placeholders, input values, checkbox state,
  navigation title, toolbar command state, target/focus region, and ordered verbs.
- Group assertions with `expect { ... }` or scope them with `expect #tag { ... }`.

Run `tao test <paths>` for one file, feature folder, or project. A failure identifies the suite,
inner test, step, and Tao source location. Read the failing step first, then check whether its target
is visible, unique, enabled, and in the intended row or navigation surface. Assertions do not sleep
or poll; actions settle synchronous Tao updates before the next step.

## Fixtures, scenarios, and review

Fixtures and scenarios are Studio metadata, not test setup:

```tao SkillScenario.tao
use Ingredient, Pantry from ./

fixture SkillSample {
   Salt = create Ingredient {
      Name: "Salt"
      Quantity: 1
}  }

scenarios Pantry "skill preview" {
   fixture SkillSample
   scenario "phone" {
      device phone
      appearance light
      network online
      locale "en"
}  }
```

Use `tao review` after scenario-visible changes. It captures each authored scenario into a portable
visual-review bundle; pixel change is evidence to inspect, not an automatic pass/fail decision.
Focused test renders, direct state/action assertions, arbitrary sleeps, fixture seeding into ordinary
tests, entity-ID selectors, watch mode, and JSON test output are unavailable.
