import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('Tao formatter fixtures and scenarios', () => {
  Test(
    'formats decided app-running and focused-view scenarios',
    formats(
      `
        fixture HomeKitchen{account Ro{Name:"Ro",Email:"ro@example.com"}Home=create Household{Name:"Garden Kitchen"}through StartKitchen(Ro)Shakshuka=create Recipe{Household:Home,Title:"Shakshuka",Servings:4}for Ro}
        scenario Recipe.tablet{fixture HomeKitchen prepare{update Shakshuka{Servings:6}}run Skillet at RecipeLink(Shakshuka)device laptop 1440 x 900 appearance dark locale "es" network offline}
        scenario StoryRow.leading{fixture HNStories render StoryRow(Story:LeadStory)device phone}
      `,
      `
        fixture HomeKitchen {
           account Ro {
              Name: "Ro",
              Email: "ro@example.com"
           }
           Home = create Household {
              Name: "Garden Kitchen"
           } through StartKitchen(Ro)
           Shakshuka = create Recipe {
              Household: Home,
              Title: "Shakshuka",
              Servings: 4
           } for Ro
        }

        scenario Recipe.tablet {
           fixture HomeKitchen
           prepare {
              update Shakshuka {
                 Servings: 6
           }  }
           run Skillet at RecipeLink(Shakshuka)
           device laptop 1440 x 900
           appearance dark
           locale "es"
           network offline
        }

        scenario StoryRow.leading {
           fixture HNStories
           render StoryRow(Story: LeadStory)
           device phone
        }
      `,
    ),
  )
})
