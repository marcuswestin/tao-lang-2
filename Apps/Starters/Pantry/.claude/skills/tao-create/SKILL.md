---
name: tao-create
description: Create a Tao project from a description or add a starter-shaped feature by hand.
---

# Tao Create

Run `tao create "<description>"`. The command chooses or confirms a lowercase project id, writes a
formatted project, checks it, and runs its behavior tests. Use `--ai none` for the deterministic
plain starter, `--id <id>` to choose the directory, `--yes` for noninteractive acceptance, and
`--skip-tests` only when you will run `tao test` yourself.

The generated project also includes Tao skills under `.agents/skills/`.

## Starter shapes

- One entity: one feature folder and a `StackNav` whose `Initial` value is the list scene.
- Several entities: one feature folder and stack per entity, held by a `SelectionNav` with one keyed
  item per feature. Each item declares `Label`, optional `Icon`, and `Content`.

Both shapes keep project/app metadata in `App.tao`, data in `Data.tao`, navigation in `Chrome.tao`,
design in `Design.tao`, fixtures in `Scenarios.tao`, and journeys in `<App>.test.tao`.

## Add a feature by hand

1. Add its plural/singular `data` declaration to `Data.tao` with a text `(title)` field, defaults,
   and one `order by` when useful.
2. Create `<Feature>/<Feature>.tao`. Mark declarations `package` so root files can import them. Put
   the list query and create action in a list `scene`, one row in a `view`, and editing in a detail
   `scene`.
3. In the list, guard loading/error/empty states, tag the loop, and present the detail from the row.
4. In `Chrome.tao`, `use` the list scene from `./<Feature>`. For one feature, make it the stack's
   `Initial`; for several, add a stack plus a keyed `SelectionNav` item.
5. Add representative rows to a `fixture` and add app and row `scenarios` in `Scenarios.tao`.
6. Add a journey that creates a row, selects it, edits it, returns, and observes the changed label.
7. Run `tao fix`, `tao check`, `tao test`, then `tao dev`.

This is a compact feature file using the existing `Ingredients` entity:

```tao SkillFeature/SkillFeature.tao
use Col, Text from @tao/ui
use Ingredients from ..

package
scene SkillIngredientList() {
   Title "Ingredient summary"
   query Ingredients = Ingredients with { }
   render Col() [gap 8] {
      #skillIngredients
      loop Ingredients / Ingredient {
         SkillIngredientRow(Ingredient)
         on select -> { present SkillIngredientDetail(Ingredient) }
}  }  }

package
view SkillIngredientRow(Ingredient) {
   render Text(Ingredient.Name)
}

package
scene SkillIngredientDetail(Ingredient) {
   Title Ingredient.Name
   render Text("Quantity: { Ingredient.Quantity }")
}
```

Copy the starter patterns for forms and destructive actions instead of inventing field syntax. Load
`tao-data`, `tao-navigation-actions`, and `tao-testing` for the detailed contracts.
