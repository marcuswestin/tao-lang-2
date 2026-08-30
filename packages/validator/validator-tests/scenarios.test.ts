import { Describe, Test } from '@shared/test'
import { scenarioValidationMessages } from '../validator-src/validators/scenarios-validator'
import { accepts, fence, rejects, tsFence } from './test-validate'

const storyFixture = `
  data Stories / Story { Title text }
  fixture HNStories {
    LeadStory = create Story { Title: "Tao Studio" }
  }
`

Describe('validator: fixtures and scenarios', () => {
  Test(
    'accepts the approved focused-view scenario and typed fixture handle',
    accepts(`
      ${storyFixture}
      view StoryRow(Story) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      scenario StoryRow.leading {
        fixture HNStories
        render StoryRow(Story: LeadStory)
        device phone
      }
    `),
  )

  Test(
    'accepts the decided app-running scenario controls',
    accepts(`
      data Households / Household { Name text }
      data Recipes / Recipe { Household Title text Servings number }
      action StartKitchen(Ro item) { }
      view Main() {
        render inject ${tsFence}
          return null
        ${fence}
      }
      app Skillet { view Main }
      fixture HomeKitchen {
        account Ro { Name: "Ro", Email: "ro@example.com" }
        Home = create Household { Name: "Garden Kitchen" } through StartKitchen(Ro)
        Shakshuka = create Recipe { Household: Home, Title: "Shakshuka", Servings: 4 } for Ro
      }
      scenario Recipe.tablet {
        fixture HomeKitchen
        prepare { update Shakshuka { Servings: 6 } }
        run Skillet at RecipeLink(Shakshuka)
        device laptop 1440 x 900
        appearance dark
        locale "es"
        network online
      }
    `),
  )

  Test(
    'requires run and render to be mutually exclusive',
    rejects(
      `
        ${storyFixture}
        view StoryRow(Story) {
          render inject ${tsFence}
            return null
          ${fence}
        }
        view Main() {
          render inject ${tsFence}
            return null
          ${fence}
        }
        app HNReader { view Main }
        scenario Invalid {
          fixture HNStories
          run HNReader
          render StoryRow(Story: LeadStory)
          device phone
        }
      `,
      scenarioValidationMessages.subjectCount('Invalid'),
    ),
  )

  Test(
    'validates focused render argument names, completeness, duplication, and types',
    rejects(
      `
        ${storyFixture}
        view StoryRow(Story) {
          render inject ${tsFence}
            return null
          ${fence}
        }
        view TitleRow(Title text) {
          render inject ${tsFence}
            return null
          ${fence}
        }
        scenario Unknown {
          fixture HNStories
          render StoryRow(Other: LeadStory)
          device phone
        }
        scenario Missing {
          fixture HNStories
          render StoryRow()
          device phone
        }
        scenario Duplicate {
          fixture HNStories
          render StoryRow(Story: LeadStory, Story: LeadStory)
          device phone
        }
        scenario Mistyped {
          fixture HNStories
          render TitleRow(Title: LeadStory)
          device phone
        }
      `,
      scenarioValidationMessages.renderUnknownArgument('StoryRow', 'Other'),
      scenarioValidationMessages.renderMissingArgument('StoryRow', 'Story'),
      scenarioValidationMessages.renderDuplicateArgument('StoryRow', 'Story'),
      scenarioValidationMessages.renderArgumentType('TitleRow', 'Title', 'TitleRow.Title', 'Story'),
    ),
  )

  Test(
    'validates fixture rows, scenario clause counts, dimensions, and pseudolocale direction',
    rejects(
      `
        data Stories / Story { Title text Count number }
        fixture Broken {
          Lead = create Story { Title: 4, Unknown: "x" }
          Lead = create Story { Title: "duplicate", Count: 1 }
        }
        view StoryRow(Story) {
          render inject ${tsFence}
            return null
          ${fence}
        }
        scenario BrokenScenario {
          fixture Broken
          render StoryRow(Story: Lead)
          device phone 0 x 10
          locale pseudolocale
          network offline
          network online
        }
      `,
      scenarioValidationMessages.duplicateHandle('Broken', 'Lead'),
      scenarioValidationMessages.fieldType('Title', 'text', 'number'),
      scenarioValidationMessages.unknownField('Story', 'Unknown'),
      scenarioValidationMessages.missingField('Story', 'Count'),
      scenarioValidationMessages.deviceDimensions,
      scenarioValidationMessages.pseudolocaleDirection,
      scenarioValidationMessages.duplicateClause('BrokenScenario', 'network'),
    ),
  )
})
