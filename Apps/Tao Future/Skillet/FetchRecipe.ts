// The TypeScript side of `action FetchRecipe … = inject "./FetchRecipe.ts"` in Import.tao-revolution.
// Tao declares the contract and emits `FetchRecipeAction` from it; this file implements it, and the
// compiler checks the join both ways. Rejecting is a returned value, never a thrown exception: Tao sees
// `reject(…)` as the `rejected -> Reason` outcome and a thrown error as `error -> Message`.
//
// (A real Skillet would name the Tao file `Import.tao`; the `-revolution` suffix only keeps this folder
// out of Tao's discovery.)
import type { FetchRecipeAction } from './Import.tao-revolution'

const FetchRecipe: FetchRecipeAction = async ({ Link }, { reject, signal }) => {
  const response = await fetch(Link, { signal }).catch(() => null)
  if (!response?.ok) {
    return reject('The page could not be reached.')
  }
  const recipe = readJsonLdRecipe(await response.text())
  if (!recipe) {
    return reject('No recipe was found on that page.')
  }
  return {
    Title: recipe.name,
    Servings: recipe.recipeYield ?? 4,
    Ingredients: recipe.recipeIngredient,
    Steps: recipe.recipeInstructions,
    Source: Link,
  }
}

export default FetchRecipe

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
