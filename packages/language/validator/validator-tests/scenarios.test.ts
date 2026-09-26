import { Describe, Test } from '@shared/test'
import { scenarioValidationMessages } from '../validator-src/validators/scenarios-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
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
      scenarios StoryRow "states" {
        fixture HNStories
        device phone
        scenario "leading" { render (Story: LeadStory) }
      }
    `),
  )

  Test(
    'accepts the decided app-running scenario controls',
    accepts(`
      data Households / Household { Name text }
      data Recipes / Recipe { Household, Title text, Servings number }
      action StartKitchen(Sam item) { }
      view Main() {
        render inject ${tsFence}
          return null
        ${fence}
      }
      app Skillet { view Main }
      fixture HomeKitchen {
        account Sam { Name: "Sam", Email: "sam@example.com" }
        Home = create Household { Name: "Garden Kitchen" } through StartKitchen(Sam)
        Shakshuka = create Recipe { Household: Home, Title: "Shakshuka", Servings: 4 } for Sam
      }
      scenarios Skillet "devices" {
        fixture HomeKitchen
        device phone
        locale "es"
        network online
        scenario "tablet" {
          prepare { update Shakshuka { Servings: 6 } }
          run at RecipeLink(Shakshuka)
          device laptop 1440 x 900
          appearance dark
        }
      }
    `),
  )

  Test(
    'accepts a group without a header subject when its entry declares one',
    accepts(`
      view Main() { render inject ${tsFence} return null ${fence} }
      app Preview { view Main }
      fixture Empty { }
      scenarios "single display" {
        fixture Empty
        device phone
        scenario "only" { run Preview }
      }
    `),
  )

  Test(
    'accepts an empty-store focused scenario with an omitted required action and ordered pointer steps',
    accepts(`
      view SavedToast(Revert action()) {
        render inject Revert ${tsFence} return null ${fence}
      }
      scenarios SavedToast "states" {
        device phone
        scenario "held" {
          render ()
          press down #revertSave
          advance 600.ms
          press up #revertSave
          hover #revertSave
          focus #revertSave
        }
      }
    `),
  )

  Test(
    'still requires every omitted non-action render parameter',
    rejects(
      `
        view SavedToast(Label text, Revert action()) {
          render inject Revert ${tsFence} return null ${fence}
        }
        scenarios SavedToast "states" {
          device phone
          scenario "missing label" { render () }
        }
      `,
      scenarioValidationMessages.renderMissingArgument('SavedToast', 'Label'),
    ),
  )

  Test(
    'requires a fixture only when a scenario references a handle or prepares fixture data',
    rejects(
      `
        data Stories / Story { Title text }
        fixture StoriesFixture { Lead = create Story { Title: "Lead" } }
        view StoryRow(Story) { render inject ${tsFence} return null ${fence} }
        scenarios StoryRow "states" {
          device phone
          scenario "handle" { render (Story: Lead) }
          scenario "prepare" {
            render (Story: Lead)
            prepare { update Lead { Title: "Prepared" } }
          }
        }
      `,
      scenarioValidationMessages.fixtureRequired('states / handle'),
      scenarioValidationMessages.fixtureRequired('states / prepare'),
    ),
  )

  Test(
    'allows an explicitly empty prepare delta without a fixture',
    accepts(`
      view EmptyState() {
        render inject ${tsFence} return null ${fence}
      }
      scenarios EmptyState "states" {
        device phone
        scenario "empty delta" {
          render ()
          prepare { }
        }
      }
    `),
  )

  Test(
    'reports fixture declarations nested in a view body',
    rejects(
      `
        view Main() {
          fixture Nested { }
        }
      `,
      scenarioValidationMessages.fixturePlacement,
    ),
  )

  Test(
    'rejects assertions nested inside a scenario row selection',
    rejects(
      `
        view Rows() { render inject ${tsFence} return null ${fence} }
        scenarios Rows "states" {
          device phone
          scenario "invalid selected state" {
            render ()
            select #rows[1] {
              expect text "Not a replay operation"
            }
          }
        }
      `,
      testValidationMessages.scenarioSelectBlock,
    ),
  )

  Test(
    'rejects assertions nested inside nested scenario row selections',
    rejects(
      `
        view Rows() { render inject ${tsFence} return null ${fence} }
        scenarios Rows "states" {
          device phone
          scenario "invalid deeply selected state" {
            render ()
            select #sections[1] {
              select #rows[1] {
                expect text "Not a replay operation"
              }
            }
          }
        }
      `,
      testValidationMessages.scenarioSelectBlock,
    ),
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
        scenarios "invalid states" {
          fixture HNStories
          device phone
          scenario "invalid" {
            run HNReader
            render StoryRow(Story: LeadStory)
          }
        }
      `,
      scenarioValidationMessages.duplicateClause('invalid states / invalid', 'subject'),
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
        scenarios StoryRow "states" {
          fixture HNStories
          device phone
          scenario "unknown" { render (Other: LeadStory) }
          scenario "missing" { }
          scenario "duplicate" { render (Story: LeadStory, Story: LeadStory) }
          scenario "mistyped" { render TitleRow(Title: LeadStory) }
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
        data Stories / Story { Title text, Count number }
        fixture Broken {
          Lead = create Story { Title: 4, Unknown: "x" }
          Lead = create Story { Title: "duplicate", Count: 1 }
        }
        view StoryRow(Story) {
          render inject ${tsFence}
            return null
          ${fence}
        }
        scenarios "broken states" {
          fixture Broken
          device phone 0 x 10
          locale pseudolocale
          network offline
          network online
          scenario "broken" { render StoryRow(Story: Lead) }
        }
      `,
      scenarioValidationMessages.duplicateHandle('Broken', 'Lead'),
      scenarioValidationMessages.fieldType('Title', 'text', 'number'),
      scenarioValidationMessages.unknownField('Story', 'Unknown'),
      scenarioValidationMessages.missingField('Story', 'Count'),
      scenarioValidationMessages.deviceDimensions,
      scenarioValidationMessages.pseudolocaleDirection,
      scenarioValidationMessages.duplicateClause('broken states', 'network'),
    ),
  )

  Test(
    'requires unique string entry identities within each group',
    rejects(
      `
        view Card() { render inject ${tsFence} return null ${fence} }
        fixture Empty { }
        scenarios Card "states" {
          fixture Empty
          device phone
          scenario "same name" { }
          scenario "same name" { }
        }
      `,
      scenarioValidationMessages.duplicateScenario('states', 'same name'),
    ),
  )
})
