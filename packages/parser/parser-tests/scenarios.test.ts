import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { parseCodeWithErrors, rejectsParser, testParseCode } from './test-parse'

Describe('parser: fixtures and scenarios', () => {
  Test('parses and links grouped app-running scenarios with clause overrides', async () => {
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

      scenarios Skillet "devices" {
        fixture HomeKitchen
        device phone
        locale "es"
        network offline
        scenario "tablet" {
          prepare { update Shakshuka { Servings: 6 } }
          run at RecipeLink(Shakshuka)
          device laptop 1440 x 900
          appearance dark
        }
      }
    `)

    const fixture = result.entry.ast.statements.find(AST.isFixtureDeclaration)
    const group = result.entry.ast.statements.find(AST.isScenarioGroupDeclaration)
    const scenario = group?.block.entries.find(AST.isScenarioDeclaration)
    Expect.Is(fixture, AST.isFixtureDeclaration)
    Expect.Is(group, AST.isScenarioGroupDeclaration)
    Expect.Is(scenario, AST.isScenarioDeclaration)
    Expect(group.name).toBe('devices')
    Expect(group.subject?.ref?.name).toBe('Skillet')
    Expect(scenario.name).toBe('tablet')
    const fixtureClause = AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause)
    const run = scenario.block.entries.find(AST.isScenarioRunClause)
    Expect(fixtureClause?.fixture.ref).toBe(fixture)
    Expect(run?.app).toBeUndefined()
    Expect.Is(run?.argumentList?.arguments[0]?.value, AST.isFixtureValueReference)
  })

  Test('parses and links the canonical focused-view scenario group', async () => {
    const result = await testParseCode(`
      data Workspaces / Workspace { Title text }
      view WorkspaceRow(Workspace) { }
      fixture HNStories {
        LeadStory = create Workspace { Title: "Tao Studio" }
      }
      scenarios WorkspaceRow "states" {
        fixture HNStories
        device phone
        scenario "novel" { render (Workspace: LeadStory) }
      }
    `)

    const group = result.entry.ast.statements.find(AST.isScenarioGroupDeclaration)
    const scenario = group?.block.entries.find(AST.isScenarioDeclaration)
    Expect.Is(group, AST.isScenarioGroupDeclaration)
    Expect.Is(scenario, AST.isScenarioDeclaration)
    const render = scenario.block.entries.find(AST.isScenarioRenderClause)
    Expect(render?.view).toBeUndefined()
    Expect(AST.scenarioSubjectDeclaration(scenario)?.name).toBe('WorkspaceRow')
    Expect(render?.argumentList?.arguments[0]?.label).toBe('Workspace')
    const value = render?.argumentList?.arguments[0]?.value
    Expect.Is(value, AST.isFixtureValueReference)
    Expect(value.target.ref?.name).toBe('LeadStory')
  })

  Test('accepts arbitrary string group and entry identities', async () => {
    const result = await testParseCode(`
      scenarios "Review states" {
        scenario "dark mode" { }
        scenario "offline / RTL" { }
      }
    `)

    const group = result.entry.ast.statements.find(AST.isScenarioGroupDeclaration)
    Expect.Is(group, AST.isScenarioGroupDeclaration)
    Expect(group.name).toBe('Review states')
    Expect(AST.scenarioDeclarations(group).map(scenario => scenario.name)).toEqual(['dark mode', 'offline / RTL'])
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
      scenarios "unsupported" {
        scenario "clock" {
          clock "2026-08-30T09:00:00Z"
          network latency 350 ms
        }
      }
    `),
  )

  Test('retires the dotted singular scenario form', rejectsParser(`scenario Card.dark { }`))
})
