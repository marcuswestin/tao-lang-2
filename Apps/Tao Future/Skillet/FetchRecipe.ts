// The TypeScript side of `action FetchRecipe(Link text) returns RecipeDraft … from ./FetchRecipe.ts`
// in Import.tao-revolution. Tao declares the contract and emits `FetchRecipeAction` from it; this file
// implements it, and the compiler checks the join both ways.
//
// There are no default exports: `<expression> from <path>` resolves the expression's free names against
// this module, so the export's name is the one the Tao declaration uses. Failing selects one of the
// cases that declaration names — `NotARecipe` or `Unreachable` — rather than returning a free string,
// which is what makes renaming a case break a test at compile time instead of passing silently. A
// thrown error stays `error`.
//
// (A real Skillet would name the Tao file `Import.tao`; the `-revolution` suffix only keeps this folder
// out of Tao's discovery.)
import type { FetchRecipeAction } from './Import.tao-revolution'

export const FetchRecipe: FetchRecipeAction = async ({ Link }, { fail, signal }) => {
  const response = await fetch(Link, { signal }).catch(() => null)
  if (!response?.ok) {
    return fail('Unreachable')
  }
  const recipe = readJsonLdRecipe(await response.text())
  if (!recipe) {
    return fail('NotARecipe')
  }
  return {
    Title: recipe.name,
    Servings: recipe.recipeYield ?? 4,
    Ingredients: recipe.recipeIngredient,
    Steps: recipe.recipeInstructions,
    Source: Link,
  }
}

// Most recipe sites publish schema.org/Recipe as JSON-LD; that is all this reads.
function readJsonLdRecipe(html: string) {
  const blocks = html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)
  for (const [, json] of blocks) {
    try {
      const found = [JSON.parse(json)]
        .flat()
        .flatMap((node) => node['@graph'] ?? node)
        .find((node) => node['@type'] === 'Recipe' || node['@type']?.includes?.('Recipe'))
      if (found?.name && found.recipeIngredient && found.recipeInstructions) {
        return {
          name: String(found.name),
          recipeYield: Number.parseInt(String([found.recipeYield].flat()[0] ?? '')) || undefined,
          recipeIngredient: found.recipeIngredient.map(String),
          recipeInstructions: [found.recipeInstructions].flat().map((step) => String(step?.text ?? step)),
        }
      }
    } catch {
      // not JSON we can use; try the next block
    }
  }
  return undefined
}
