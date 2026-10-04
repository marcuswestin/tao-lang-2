import { Describe, Expect, Test } from '@shared/test'
import { withCompiledTestPlan } from './test-compile'

const app = `
  app WordFlower { id "com.tao.test.wordflower" version "1.0.0" name "WordFlower"  view MainView }
  view MainView() { render inject \`\`\`ts return null \`\`\` }
`

Describe('compiler: test device and fixture plan IR', () => {
  Test('compiles an explicit device viewport over its defaults', async () => {
    await withCompiledTestPlan(
      'tao-test-device-plan-',
      {
        'Main.test.tao': `
          use WordFlower from ./

          test "WordFlower" on tablet 900 x 1200 {
            test "opens" {
              run WordFlower
            }
          }
        `,
        'Main.tao': app,
      },
      plan => {
        Expect(plan.suites[0]?.checks[0]?.device).toEqual({ device: 'tablet', height: 1200, width: 900 })
      },
    )
  })

  Test('compiles a fixture into created rows with resolved literal and reference field values', async () => {
    await withCompiledTestPlan(
      'tao-test-fixture-plan-',
      {
        'Main.test.tao': `
          use WordFlower from ./

          data Households / Household { Name text }
          data Recipes / Recipe { Household, Title text }
          fixture StarterWorkspace {
            Home = create Household { Name: "Home" }
            Shakshuka = create Recipe { Household: Home, Title: "Shakshuka" }
          }

          test "WordFlower" with StarterWorkspace {
            test "opens" {
              run WordFlower
            }
          }
        `,
        'Main.tao': app,
      },
      plan => {
        Expect(plan.suites[0]?.checks[0]?.fixture).toEqual({
          name: 'StarterWorkspace',
          accounts: [],
          creates: [
            { entity: 'Household', fields: { Name: 'Home' }, name: 'Home' },
            {
              entity: 'Recipe',
              fields: { Household: { handle: 'Home', kind: 'fixture-reference' }, Title: 'Shakshuka' },
              name: 'Shakshuka',
            },
          ],
        })
      },
    )
  })

  Test(
    'carries a nearest ancestor device/fixture through several nesting levels and lets an override win',
    async () => {
      await withCompiledTestPlan(
        'tao-test-nesting-plan-',
        {
          'Main.test.tao': `
          use WordFlower from ./

          data Households / Household { Name text }
          fixture StarterWorkspace {
            Home = create Household { Name: "Home" }
          }

          test "WordFlower" on phone with StarterWorkspace {
            test "workspace" {
              test "deep" {
                test "opens the starter workspace" {
                  run WordFlower
                }
              }
            }
            test "on a tablet" on tablet {
              test "opens" {
                run WordFlower
              }
            }
          }
        `,
          'Main.tao': app,
        },
        plan => {
          const checks = plan.suites[0]?.checks ?? []
          Expect(checks).toHaveLength(2)
          const deep = checks.find(check => check.name === 'opens the starter workspace')
          const tabletCheck = checks.find(check => check.name === 'opens')
          Expect(deep?.device).toEqual({ device: 'phone', height: 844, width: 390 })
          Expect(deep?.fixture?.name).toBe('StarterWorkspace')
          Expect(tabletCheck?.device).toEqual({ device: 'tablet', height: 1024, width: 768 })
          Expect(tabletCheck?.fixture?.name).toBe('StarterWorkspace')
        },
      )
    },
  )
})
