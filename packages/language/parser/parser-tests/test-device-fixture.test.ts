import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { parseCodeWithErrors, testParseCode } from './test-parse'

Describe('parser: test device and fixture clauses', () => {
  Test('parses `on` and `with` on a test head and links the fixture reference', async () => {
    const result = await testParseCode(`
      data Households / Household { Name text }
      view Main() { render inject \`\`\`ts return null \`\`\` }
      app WordFlower { view Main }

      fixture StarterWorkspace {
        Home = create Household { Name: "Home" }
      }

      test "WordFlower full target" on phone with StarterWorkspace {
        test "opens the starter workspace" {
          run WordFlower
        }
      }
    `)

    const suite = result.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(suite, AST.isTestDeclaration)
    Expect(suite.name).toBe('WordFlower full target')
    const device = suite.headClauses.find(AST.isTestDeviceClause)
    const fixtureClause = suite.headClauses.find(AST.isTestFixtureClause)
    Expect.Is(device, AST.isTestDeviceClause)
    Expect.Is(fixtureClause, AST.isTestFixtureClause)
    Expect(device.device).toBe('phone')
    Expect(device.width).toBeUndefined()
    Expect(fixtureClause.fixture.ref?.name).toBe('StarterWorkspace')

    const check = suite.block.statements.find(AST.isTestDeclaration)
    Expect.Is(check, AST.isTestDeclaration)
    Expect(check.headClauses).toEqual([])
    // A nested test with no clause of its own inherits its nearest ancestor's.
    Expect(AST.effectiveTestClause(check, AST.isTestDeviceClause)).toBe(device)
    Expect(AST.effectiveTestClause(check, AST.isTestFixtureClause)).toBe(fixtureClause)
  })

  Test('parses an explicit device viewport and a nested override', async () => {
    const result = await testParseCode(`
      view Main() { render inject \`\`\`ts return null \`\`\` }
      app WordFlower { view Main }

      test "WordFlower" on tablet 900 x 1200 {
        test "on a phone" on phone {
          run WordFlower
        }
      }
    `)

    const suite = result.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(suite, AST.isTestDeclaration)
    const device = suite.headClauses.find(AST.isTestDeviceClause)
    Expect.Is(device, AST.isTestDeviceClause)
    Expect(device.device).toBe('tablet')
    Expect(device.width).toBe(900)
    Expect(device.height).toBe(1200)

    const [overridden] = suite.block.statements.filter(AST.isTestDeclaration)
    Expect.Is(overridden, AST.isTestDeclaration)
    const overriddenDevice = AST.effectiveTestClause(overridden, AST.isTestDeviceClause)
    Expect.Is(overriddenDevice, AST.isTestDeviceClause)
    Expect(overriddenDevice.device).toBe('phone')
    Expect(overriddenDevice).not.toBe(device)
  })

  Test('reports an unresolved fixture reference on `with`', async () => {
    const result = await parseCodeWithErrors(`
      view Main() { render inject \`\`\`ts return null \`\`\` }
      app WordFlower { view Main }

      test "WordFlower" with NoSuchFixture {
        test "opens" {
          run WordFlower
        }
      }
    `)

    Expect(result.diagnostics.some(diagnostic => diagnostic.message.includes('NoSuchFixture'))).toBe(true)
  })
})
