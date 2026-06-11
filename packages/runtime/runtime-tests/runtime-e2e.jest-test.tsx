import { FS } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
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

  Test('renders imported alias references through circular module imports', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app CircularAliasApp {
              ui MainView
          }

          use AView from ./

          ui MainView {
              render AView
          }
        `,
        'A.tao': `
          use BView from ./

          alias SharedTitle = "Circular alias"

          ui AView {
              render BView
          }
        `,
        'B.tao': `
          use SharedTitle from ./

          alias ImportedTitle = SharedTitle

          ui BView {
              render Text ImportedTitle
          }

          ui Text Value text {
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
            ui MainView
        }

        alias Message = "Ordered output"
        alias Greeting = Message

        ui MainView {
            render Text Greeting { }
        }

        ui Text Value text {
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
            ui MainView
        }

        alias Greeting = "Outer"

        ui MainView {
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

        ui Text Value text {
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
