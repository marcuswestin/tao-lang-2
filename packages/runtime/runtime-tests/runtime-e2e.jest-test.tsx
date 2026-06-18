import { FS } from '@shared'
import { AfterEach, Describe, Expect, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { compileAndRenderApp, ExpectScreen, testCompileApp, testCompileFiles } from './test-compile-app'

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
    ExpectScreen(screen).toHaveText('Fixed Kitchen type')
    ExpectScreen(screen).toHaveText('Typed Kitchen')
    ExpectScreen(screen).toHaveText('item, list, type')
  })

  Test('compiles and renders Type System Tests custom values', async () => {
    const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
    const screen = await compileAndRenderApp(typeSystemTestsPath)

    ExpectScreen(screen).toHaveText('Open: 1')
    ExpectScreen(screen).toHaveText('Done: 2')
    Expect(screen.getAllByText('Ada').length).toBeGreaterThan(0)
    ExpectScreen(screen).toHaveText('40')
    Expect(screen.getAllByText('Compiler engineer').length).toBeGreaterThan(0)
    ExpectScreen(screen).toHaveText('types, items, lists')
    ExpectScreen(screen).toHaveText('People in the team: 2')
    ExpectScreen(screen).toHaveText('2 team member(s)')
    ExpectScreen(screen).toHaveText('Grace')
    ExpectScreen(screen).toHaveText('Constructed primitive text')
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

          view Text text as Value {
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

        view Text text as Value {
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

        view Text text as Value {
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
