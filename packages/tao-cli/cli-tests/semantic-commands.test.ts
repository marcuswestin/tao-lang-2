import { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { checkedProjectFile, runTaoCliForTest, withTaoFixture } from './test-cli-files'

Describe('tao semantic commands', () => {
  Test('reports non-empty Studio facts and complete coverage through versioned JSON using a project-relative entry', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': `
        use Button, Col, Text from @tao/ui

        app Demo { view Home }

        view Home() {
          action Active() { }
          action Unused() { }
          render Col() {
            Text("Welcome")
            Button("Activate") { on press Active }
          }
        }
      `,
      'App.test.tao': `
        suite Home {
          test "shows welcome" { expect text "Welcome" }
        }
      `,
    }, async root => {
      const facts = await runTaoCliForTest(['facts', root, 'App.tao', 'Demo'])
      const coverage = await runTaoCliForTest(['coverage', root, 'App.tao', 'Demo', 'Home'])

      const factsJson = JSON.parse(facts.stdout) as {
        app: string
        diagnostics: unknown[]
        facts: Array<{ kind: string; subject: string }>
        format: string
        version: number
      }
      const coverageJson = JSON.parse(coverage.stdout) as {
        coverage: {
          actions: unknown[]
          checks: string[]
          note: string
          shows: Array<{ by: string; checks: string[]; text: string }>
          view: string
        }
        diagnostics: unknown[]
        format: string
        version: number
      }

      Expect(facts.exitCode).toBe(0)
      Expect(Object.keys(factsJson).sort()).toEqual(['app', 'diagnostics', 'facts', 'format', 'version'])
      Expect(factsJson).toMatchObject({ app: 'Demo', diagnostics: [], format: 'tao-semantic-facts-v1', version: 1 })
      Expect(factsJson.facts.length).toBeGreaterThan(0)
      Expect(factsJson.facts).toContainEqual(Expect.objectContaining({
        kind: 'action-never-invoked',
        subject: 'Home.Unused',
      }))
      Expect(coverage.exitCode).toBe(0)
      Expect(Object.keys(coverageJson).sort()).toEqual(['coverage', 'diagnostics', 'format', 'version'])
      Expect(Object.keys(coverageJson.coverage).sort()).toEqual(['actions', 'checks', 'note', 'shows', 'view'])
      Expect(coverageJson).toMatchObject({
        coverage: {
          actions: [],
          checks: ['shows welcome'],
          note: 'Matched by text, not by the compiler: a check that asserts a string this view renders is treated as exercising it. 1 of 2 texts this view shows appear in no check.',
          shows: [
            { by: 'exact', checks: ['shows welcome'], text: 'Welcome' },
            { by: 'none', checks: [], text: 'Activate' },
          ],
          view: 'Home',
        },
        diagnostics: [],
        format: 'tao-semantic-coverage-v1',
        version: 1,
      })
    })
  })

  Test('rejects an invalid entry as a typed user error instead of leaking ENOENT', async () => {
    await withTaoFixture(checkedProjectFile, async root => {
      const result = await runTaoCliForTest(['facts', root, 'missing.tao', 'Demo'])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Studio entry is not a Tao file in the project: missing.tao')
      Expect(result.stderr).not.toContain('ENOENT')
    })
  })

  Test('rejects a requested app that is absent from the semantic graph as a typed user error', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': 'app Demo { view Home }\nview Home() { render Text("Welcome") }\n',
    }, async root => {
      const result = await runTaoCliForTest(['facts', root, 'App.tao', 'DoesNotExist'])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain("No app named 'DoesNotExist' exists in the selected project.")
    })
  })

  Test('ignores stale Git-ignored Tao sources and behavior tests just as Studio discovery does', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      '.gitignore': 'stale/\n',
      'App.tao': `
        use Button, Col, Text from @tao/ui

        app Demo { view Home }

        view Home() {
          action Active() { }
          action Unused() { }
          render Col() {
            Text("Welcome")
            Button("Activate") { on press Active }
          }
        }
      `,
      'App.test.tao': `
        suite Home {
          test "shows welcome" { expect text "Welcome" }
        }
      `,
      'stale/Old.tao': 'app Stale { view Old }\nview Old() { do Unused() }\n',
      'stale/Old.test.tao': 'suite Old { test "shows stale welcome" { expect text "Welcome" } }\n',
    }, async root => {
      await CLI.mustRun('git', { args: ['init', '--quiet'], cwd: root })

      const facts = JSON.parse((await runTaoCliForTest(['facts', root, 'App.tao', 'Demo'])).stdout) as {
        facts: Array<{ kind: string; subject: string }>
      }
      const coverage = JSON.parse((await runTaoCliForTest(['coverage', root, 'App.tao', 'Demo', 'Home'])).stdout) as {
        coverage: { checks: string[]; shows: Array<{ checks: string[] }> }
      }

      Expect(facts.facts).toContainEqual(Expect.objectContaining({
        kind: 'action-never-invoked',
        subject: 'Home.Unused',
      }))
      Expect(coverage.coverage.checks).toEqual(['shows welcome'])
      Expect(coverage.coverage.shows).toEqual([
        { by: 'exact', checks: ['shows welcome'], text: 'Welcome' },
        { by: 'none', checks: [], text: 'Activate' },
      ])
    })
  })
})
