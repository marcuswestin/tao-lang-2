import { type CreationPlan, DEFAULT_PALETTE } from './creation-plan'

/** StarterPlan is one checked-in starter: the plan and description that lower to `Apps/Starters/<directory>`. */
export type StarterPlan = {
  directory: string
  description: string
  plan: CreationPlan
}

/**
 * starterPlans are the reference plans behind `Apps/Starters`. Each starter is the lowering's exact
 * output for its plan, byte for byte after canonical formatting, and `tao test Apps` runs it; that is
 * how the lowering stays a proven, runnable app rather than a template that can rot.
 */
export const starterPlans: readonly StarterPlan[] = [
  {
    directory: 'Notebook',
    description: 'A notebook for short notes I can pin.',
    plan: {
      name: 'Notebook',
      id: 'notebook',
      summary: 'Keeps short notes on this device.',
      entities: [
        {
          plural: 'Notes',
          singular: 'Note',
          purpose: 'One note: a title, a body, and whether it is pinned.',
          fields: [
            { name: 'Title', type: 'text', title: true },
            { name: 'Body', type: 'text' },
            { name: 'Pinned', type: 'yesno' },
            { name: 'CreatedAt', type: 'time' },
          ],
        },
      ],
      palette: DEFAULT_PALETTE,
      samples: {
        Notes: [
          { Title: 'Groceries', Body: 'Milk, eggs, bread' },
          { Title: 'Ideas', Pinned: true },
          { Title: 'Call the plumber', Body: 'Ask about the kitchen tap.' },
        ],
      },
    },
  },
  {
    directory: 'Pantry',
    description: 'Track what is in my kitchen and the recipes that use it.',
    plan: {
      name: 'Pantry',
      id: 'pantry',
      summary: 'Tracks what is in the kitchen and the recipes that use it.',
      entities: [
        {
          plural: 'Ingredients',
          singular: 'Ingredient',
          purpose: 'One ingredient in the kitchen and how much of it is left.',
          fields: [
            { name: 'Name', type: 'text', title: true },
            { name: 'Quantity', type: 'number' },
            { name: 'InStock', type: 'yesno' },
            { name: 'AddedAt', type: 'time' },
          ],
        },
        {
          plural: 'Recipes',
          singular: 'Recipe',
          purpose: 'One recipe: its steps, how long it takes, and whether it is a favorite.',
          fields: [
            { name: 'Title', type: 'text', title: true },
            { name: 'Steps', type: 'text' },
            { name: 'Minutes', type: 'number' },
            { name: 'Favorite', type: 'yesno' },
          ],
        },
      ],
      palette: { canvas: '#f7f3ea', ink: '#2b2118', accent: '#b5562a' },
      samples: {
        Ingredients: [
          { Name: 'Olive oil', Quantity: 1, InStock: true },
          { Name: 'Eggs', Quantity: 6, InStock: true },
          { Name: 'Basil', Quantity: 0 },
        ],
        Recipes: [
          { Title: 'Tomato pasta', Steps: 'Boil pasta, warm the sauce, toss with basil.', Minutes: 25, Favorite: true },
          { Title: 'Omelette', Steps: 'Whisk eggs, cook slowly, fold.', Minutes: 10 },
        ],
      },
    },
  },
]
