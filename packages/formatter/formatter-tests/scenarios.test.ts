import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('Tao formatter fixtures and scenarios', () => {
  Test(
    'formats grouped app-running and focused-view scenarios',
    formats(
      `
        fixture HomeKitchen{account Ro{Name:"Ro",Email:"ro@example.com"}Home=create Household{Name:"Garden Kitchen"}through StartKitchen(Ro)Shakshuka=create Recipe{Household:Home,Title:"Shakshuka",Servings:4}for Ro}
        scenarios Skillet "devices"{fixture HomeKitchen device phone locale "es" network offline scenario "tablet"{prepare{update Shakshuka{Servings:6}}run at RecipeLink(Shakshuka)device laptop 1440 x 900 appearance dark}}
        scenarios StoryRow "states"{fixture HNStories device phone scenario "leading"{render (Story:LeadStory)}}
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

        scenarios Skillet "devices" {
           fixture HomeKitchen
           device phone
           locale "es"
           network offline
           scenario "tablet" {
              prepare {
                 update Shakshuka {
                    Servings: 6
              }  }
              run at RecipeLink(Shakshuka)
              device laptop 1440 x 900
              appearance dark
        }  }

        scenarios StoryRow "states" {
           fixture HNStories
           device phone
           scenario "leading" {
              render (Story: LeadStory)
        }  }
      `,
    ),
  )
})
