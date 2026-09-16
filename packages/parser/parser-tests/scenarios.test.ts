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

  Test('keeps the narrow scenario journey prefix in authored order after its render subject', async () => {
    const result = await testParseCode(`
      view SavedToast(Revert action()) { }
      scenarios SavedToast "interaction states" {
        device phone
        scenario "held revert" {
          render ()
          press down label "Revert"
          advance 600.ms
          press up #revertSave
          hover placeholder "Revert save"
          focus #revertSave
          hover "Revert by text"
        }
      }
    `)

    const group = result.entry.ast.statements.find(AST.isScenarioGroupDeclaration)
    const scenario = group?.block.entries.find(AST.isScenarioDeclaration)
    Expect.Is(scenario, AST.isScenarioDeclaration)
    Expect(scenario.block.steps.map(step => step.$type)).toEqual([
      AST.PressWordStep.$type,
      AST.AdvanceStep.$type,
      AST.PressWordStep.$type,
      AST.InteractionWordStep.$type,
      AST.InteractionWordStep.$type,
      AST.InteractionWordStep.$type,
    ])
    const down = scenario.block.steps[0]
    Expect.Is(down, AST.isPressWordStep)
    Expect(down.subject).toBe('down')
    Expect(down.selector).toBe('label')
    Expect(down.target).toBe('Revert')
    const up = scenario.block.steps[2]
    Expect.Is(up, AST.isPressWordStep)
    Expect(up.tag).toBe('#revertSave')
  })

  Test(
    'requires scenario clauses to precede its journey prefix',
    rejectsParser(`
      view Card() { }
      scenarios Card "states" {
        device phone
        scenario "invalid" {
          render ()
          focus #card
          appearance dark
        }
      }
    `),
  )

  Test('keeps pointer journey words available as ordinary declaration names', async () => {
    const result = await testParseCode(`
      view hover() { }
      view down() { }
      view up() { }
    `)

    Expect(result.entry.ast.statements.filter(AST.isViewDeclaration).map(view => view.name))
      .toEqual(['hover', 'down', 'up'])
  })

  Test('keeps ordinary identifier-headed view statements distinct from interaction words', async () => {
    const result = await testParseCode(`
      view Card(Title text) { }
      view Home() { Card("hover") }
    `)

    const home = result.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Home',
    )
    Expect.Is(home, AST.isViewDeclaration)
    Expect.Is(home.block?.statements[0], AST.isViewRender)
  })

  Test(
    'does not widen scenario journeys to the full test language',
    rejectsParser(`
      view Card() { }
      scenarios Card "states" {
        device phone
        scenario "invalid" {
          render ()
          expect text "Card"
        }
      }
    `),
  )

  Test('accepts the existing test-body interaction family as a scenario journey prefix', async () => {
    const result = await testParseCode(`
      view Card() { }
      scenarios Card "states" {
        device phone
        scenario "edited second row" {
          render ()
          press #card
          enter "Tao" into label "Name"
          submit #name
          select #rows[2] {
            press text "Open"
          }
        }
      }
    `)

    const group = result.entry.ast.statements.find(AST.isScenarioGroupDeclaration)
    const scenario = group?.block.entries.find(AST.isScenarioDeclaration)
    Expect.Is(scenario, AST.isScenarioDeclaration)
    Expect(scenario.block.steps.map(step => step.$type)).toEqual([
      AST.TagPressStep.$type,
      AST.EnterTextStep.$type,
      AST.TagSubmitStep.$type,
      AST.SelectStep.$type,
    ])
    const select = scenario.block.steps[3]
    Expect.Is(select, AST.isSelectStep)
    Expect(select.block.statements.map(step => step.$type)).toEqual([AST.PressTextStep.$type])
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
