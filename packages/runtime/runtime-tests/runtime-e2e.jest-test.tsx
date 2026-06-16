import { FS } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup, fireEvent } from '@testing-library/react-native'
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
    ExpectScreen(screen).toHaveText('0')
    ExpectScreen(screen).toHaveText('Add kitchen count')
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

  Test('runs state actions from Button presses and rerenders stateful values', async () => {
    const stateActionMvpPath = FS.repoPath('Apps/Test Apps/State Action MVP/State Action MVP.tao')
    const screen = await compileAndRenderApp(stateActionMvpPath)

    ExpectScreen(screen).toHaveText('State/action MVP')
    ExpectScreen(screen).toHaveText('0')

    fireEvent.press(screen.getByText('Add twice'))
    ExpectScreen(screen).toHaveText('2')

    fireEvent.press(screen.getByText('Reset'))
    ExpectScreen(screen).toHaveText('0')

    fireEvent.press(screen.getByText('Inline add one'))
    ExpectScreen(screen).toHaveText('1')

    fireEvent.press(screen.getByText('Add five'))
    ExpectScreen(screen).toHaveText('6')

    fireEvent.press(screen.getByText('Double'))
    ExpectScreen(screen).toHaveText('12')

    fireEvent.press(screen.getByText('Halve'))
    ExpectScreen(screen).toHaveText('6')

    fireEvent.press(screen.getByText('Decrement'))
    ExpectScreen(screen).toHaveText('5')

    fireEvent.press(screen.getByText('Reset'))
    ExpectScreen(screen).toHaveText('0')
  })

  Test('passes action values through render inject arguments', async () => {
    await testCompileApp(
      `
        app InjectedActionApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddOne {
            set Count += 1
          }
          render Stack {
            NativeButton "Native add", AddOne
            Number Count
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title text, Action action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Native add'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('runs actions whose parameters shadow generated runtime names', async () => {
    await testCompileApp(
      `
        app ShadowedActionParameterApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddStep _Scope number {
            set Count += _Scope
          }
          action AddOne {
            do AddStep 1
          }
          render Stack {
            NativeButton "Add with shadowed parameter", AddOne
            Number Count
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title text, Action action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Add with shadowed parameter'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
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
