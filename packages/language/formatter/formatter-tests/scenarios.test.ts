import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('Tao formatter fixtures and scenarios', () => {
  Test(
    'formats grouped app-running and focused-view scenarios',
    formats(
      `
        fixture HomeKitchen{account Sam{Name:"Sam",Email:"sam@example.com"}Home=create Household{Name:"Garden Kitchen"}through StartKitchen(Sam)Shakshuka=create Recipe{Household:Home,Title:"Shakshuka",Servings:4}for Sam}
        scenarios Skillet "devices"{fixture HomeKitchen device phone locale "es" network offline scenario "tablet"{prepare{update Shakshuka{Servings:6}}run at RecipeLink(Shakshuka)device laptop 1440 x 900 appearance dark}}
        scenarios StoryRow "states"{fixture HNStories device phone scenario "leading"{render (Story:LeadStory)}}
      `,
      `
        fixture HomeKitchen {
           account Sam {
              Name: "Sam",
              Email: "sam@example.com"
           }
           Home = create Household {
              Name: "Garden Kitchen"
           } through StartKitchen(Sam)
           Shakshuka = create Recipe {
              Household: Home,
              Title: "Shakshuka",
              Servings: 4
           } for Sam
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

  Test(
    'formats an ordered pointer journey after its focused render',
    formats(
      `scenarios SavedToast "states"{device phone scenario "held"{render()press down label "Revert" advance 600.ms press up #revertSave hover placeholder "Revert save" focus #revertSave}}`,
      `
        scenarios SavedToast "states" {
           device phone
           scenario "held" {
              render ()
              press down label "Revert"
              advance 600.ms
              press up #revertSave
              hover placeholder "Revert save"
              focus #revertSave
        }  }
      `,
    ),
  )

  Test(
    'inserts the required space between focus and its tag',
    formats(
      `test "focus spacing"{test "focuses"{focus#target}}`,
      `
        test "focus spacing" {
           test "focuses" {
              focus #target
        }  }
      `,
    ),
  )
})
