import { FS } from '@shared'
import { AfterEach, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { compileAndRenderApp, ExpectScreen, testCompileApp, testCompileFiles } from './test-compile-app'
import { runTaoTestPlan } from './test-tao-test-plan'

AfterEach(() => cleanup())

Describe('Expo runtime', () => {
  Test('compiles and renders Kitchen Sink scoped aliases and inject arguments', async () => {
    const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
    const screen = await compileAndRenderApp(kitchenSinkPath)

    ExpectScreen(screen).toHaveText('Hello, World!')
    ExpectScreen(screen).toHaveText('Text from a local alias')
    ExpectScreen(screen).toHaveText('Nested scope greeting')
    ExpectScreen(screen).toHaveText('Hello World')
    ExpectScreen(screen).toHaveText('Launch count: 3')
  })

  Test('runs Tao-authored Kitchen Sink smoke tests', async () => {
    const kitchenSinkTestPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.test.tao')

    await runTaoTestPlan(kitchenSinkTestPath)
  })

  Test('runs Tao text expectations with duplicate rendered text', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use DuplicateTextApp from ./

        test "Duplicate text" {
          check "matches at least one text node" {
            run DuplicateTextApp
            expect text "Repeated"
          }
        }
      `,
        'Main.tao': `
        app DuplicateTextApp { view MainView }
        view MainView {
          render Stack {
            Text "Repeated"
            Text "Repeated"
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view Text Value text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports Tao suite and check context for failed text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken text" {
          check "misses expected text" {
            run BrokenTextApp
            expect text "Expected"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { view MainView }
        view MainView {
          render Text "Actual"
        }
        view Text Value text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken text > misses expected text[\s\S]*expect text "Expected"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('cleans up rendered apps between Tao checks', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use FirstApp, SecondApp from ./

        test "Isolated checks" {
          check "first app" {
            run FirstApp
            expect text "First"
          }

          check "second app" {
            run SecondApp
            expect missing text "First"
            expect text "Second"
          }
        }
      `,
        'First.tao': `
        app FirstApp { view MainView }
        view MainView {
          render Text "First"
        }
        view Text Value text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
        'Second.tao': `
        app SecondApp { view MainView }
        view MainView {
          render Text "Second"
        }
        view Text Value text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('compiles and renders runtime stdlib imports', async () => {
    const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
    const screen = await compileAndRenderApp(runtimeStdlibTestsPath)

    ExpectScreen(screen).toHaveText('Runtime stdlib smoke')
    ExpectScreen(screen).toHaveText('3')
    ExpectScreen(screen).toHaveText('Tap me')
    ExpectScreen(screen).toHaveText('Label')
    ExpectScreen(screen).toHaveText('Wrapped')
  })

  Test('compiles and renders local package access', async () => {
    const packageAccessPath = FS.repoPath('Apps/Test Apps/Package Access/Package Access.tao')
    const screen = await compileAndRenderApp(packageAccessPath)

    ExpectScreen(screen).toHaveText('Package access works')
    ExpectScreen(screen).toHaveText('Package sibling file works')
    ExpectScreen(screen).toHaveText('Package sibling folder works')
    ExpectScreen(screen).toHaveText('Package child folder works')
    ExpectScreen(screen).toHaveText('Project alias works')
    ExpectScreen(screen).toHaveText('Project view works')
  })

  Test('renders imported alias references through circular module imports', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app CircularAliasApp {
              view MainView
          }

          use AView from ./

          view MainView {
              render AView
          }
        `,
        'A.tao': `
          use BView from ./

          project alias SharedTitle = "Circular alias"

          project view AView {
              render BView
          }
        `,
        'B.tao': `
          use SharedTitle from ./

          alias ImportedTitle = SharedTitle

          project view BView {
              render Text ImportedTitle
          }

          view Text Value text {
              render inject Value \`\`\`ts
                  return <RN.Text>{Value}</RN.Text>
              \`\`\`
          }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Circular alias')
      },
    )
  })

  Test('renders alias references to earlier aliases', async () => {
    await testCompileApp(
      `
        app OrderedAlias {
            view MainView
        }

        alias Message = "Ordered output"
        alias Greeting = Message

        view MainView {
            render Text Greeting { }
        }

        view Text Value text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Ordered output')
      },
    )
  })

  Test('renders block-local aliases that shadow file-level aliases', async () => {
    await testCompileApp(
      `
        app ScopedAlias {
            view MainView
        }

        alias Greeting = "Outer"

        view MainView {
            alias OuterGreeting = Greeting
            render Stack {
                alias Greeting = "Inner"
                Text Greeting
                Text OuterGreeting
            }
        }

        layout Stack {
            render inject \`\`\`ts
                return <>{_ViewProps.children}</>
            \`\`\`
        }

        view Text Value text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Inner')
        ExpectScreen(screen).toHaveText('Outer')
      },
    )
  })
})
