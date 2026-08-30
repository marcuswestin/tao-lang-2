import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { parseCodeWithErrors, rejectsParser, testParseCode } from './test-parse'

Describe('parser: fixtures and scenarios', () => {
  Test('parses and links the decided app-running fixture and scenario forms', async () => {
    const result = await testParseCode(`
      data Households / Household { Name text }
      data Recipes / Recipe { Household Title text Servings number }
      action StartKitchen(Ro item) { }
      view Main() { }
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
        network offline
      }
    `)

    const fixture = result.entry.ast.statements.find(AST.isFixtureDeclaration)
    const scenario = result.entry.ast.statements.find(AST.isScenarioDeclaration)
    Expect.Is(fixture, AST.isFixtureDeclaration)
    Expect.Is(scenario, AST.isScenarioDeclaration)
    Expect(scenario.name).toBe('Recipe.tablet')
    const fixtureClause = scenario.block.entries.find(AST.isScenarioFixtureClause)
    const run = scenario.block.entries.find(AST.isScenarioRunClause)
    Expect(fixtureClause?.fixture.ref).toBe(fixture)
    Expect(run?.app.ref?.name).toBe('Skillet')
    Expect.Is(run?.argumentList?.arguments[0]?.value, AST.isFixtureValueReference)
  })

  Test('parses and links the approved focused-view scenario subject', async () => {
    const result = await testParseCode(`
      data Stories / Story { Title text }
      view StoryRow(Story) { }
      fixture HNStories {
        LeadStory = create Story { Title: "Tao Studio" }
      }
      scenario StoryRow.leading {
        fixture HNStories
        render StoryRow(Story: LeadStory)
        device phone
      }
    `)

    const scenario = result.entry.ast.statements.find(AST.isScenarioDeclaration)
    Expect.Is(scenario, AST.isScenarioDeclaration)
    const render = scenario.block.entries.find(AST.isScenarioRenderClause)
    Expect(render?.view.ref?.name).toBe('StoryRow')
    Expect(render?.argumentList?.arguments[0]?.label).toBe('Story')
    const value = render?.argumentList?.arguments[0]?.value
    Expect.Is(value, AST.isFixtureValueReference)
    Expect(value.target.ref?.name).toBe('LeadStory')
  })

  Test('accepts environment keywords as natural scenario-name suffixes', async () => {
    const result = await testParseCode(`
      scenario Card.dark { }
      scenario Card.light { }
      scenario Card.offline { }
      scenario Card.rightToLeft { }
    `)

    Expect(result.entry.ast.statements.filter(AST.isScenarioDeclaration).map(scenario => scenario.name)).toEqual([
      'Card.dark',
      'Card.light',
      'Card.offline',
      'Card.rightToLeft',
    ])
  })

  Test('keeps fixture handles declaration ordered', async () => {
    const result = await parseCodeWithErrors(`
      data Stories / Story { Title text }
      fixture HNStories {
        First = create Story { Title: Later }
        Later = create Story { Title: "later" }
      }
    `)

    Expect(
      result.diagnostics.some(diagnostic =>
        diagnostic.message.includes("Could not resolve reference to FixtureValueDeclaration named 'Later'")
      ),
    ).toBe(true)
  })

  Test(
    'does not invent clock, latency, fixture inheritance, or arbitrary state-capture syntax',
    rejectsParser(`
      scenario Unsupported {
        clock "2026-08-30T09:00:00Z"
        network latency 350 ms
      }
    `),
  )
})
