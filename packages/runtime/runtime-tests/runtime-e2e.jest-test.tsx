import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { CLI, FS, Repo, Text } from '@shared'
import { cleanup, render } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'

afterEach(() => cleanup())

describe('Expo runtime', () => {
  test('compiles and renders Kitchen Sink text and number aliases', async () => {
    const generatedAppPath = FS.repoPath('packages/runtime/_gen_tao-app/App.tsx')

    jest.resetModules()
    const appModule = require(generatedAppPath) as { default: ComponentType }
    const screen = render(createElement(appModule.default))

    expect(screen.getByText('Hello, World!')).toBeDefined()
    expect(screen.getByText('Text from a local alias')).toBeDefined()
    expect(screen.getByText('Nested scope greeting')).toBeDefined()
    expect(screen.getByText('Hello World')).toBeDefined()
    expect(screen.getByText('Launch count: 3')).toBeDefined()
  })

  test('renders alias references to earlier aliases', async () => {
    const repoRoot = Repo.getRoot()
    const appDir = await FS.mkTmpDir(FS.resolvePath('tao-runtime-e2e-', { cwd: FS.tmpdir() }))
    const appPath = FS.resolvePath('Ordered Alias.tao', { cwd: appDir })

    await testCompileApp(
      repoRoot,
      appPath,
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
            render inject \`\`\`ts
                const text = _ViewProps.Value.evaluate();
                return <RN.Text>{text.jsValue}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        expect(screen.getByText('Ordered output')).toBeDefined()
      },
    )
  })

  test('renders block-local aliases that shadow file-level aliases', async () => {
    const repoRoot = Repo.getRoot()
    const appDir = await FS.mkTmpDir(FS.resolvePath('tao-runtime-e2e-', { cwd: FS.tmpdir() }))
    const appPath = FS.resolvePath('Scoped Alias.tao', { cwd: appDir })

    await testCompileApp(
      repoRoot,
      appPath,
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
            render inject \`\`\`ts
                const text = _ViewProps.Value.evaluate();
                return <RN.Text>{text.jsValue}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        expect(screen.getByText('Inner')).toBeDefined()
        expect(screen.getByText('Outer')).toBeDefined()
      },
    )
  })
})

async function testCompileApp(
  repoRoot: string,
  appPath: string,
  source: string,
  testsFunction: (screen: ReturnType<typeof render>) => void,
): Promise<void> {
  const appDir = FS.dirname(appPath)
  const runtimePackageRoot = FS.repoPath('packages/runtime')
  const generatedAppPath = FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot })

  try {
    await FS.writeText(appPath, Text.stripIndent(source))
    await CLI.mustRun(FS.repoPath('dev'), {
      args: ['compile-app', appPath],
      cwd: repoRoot,
    })

    jest.resetModules()
    const appModule = require(generatedAppPath) as { default: ComponentType }
    const screen = render(createElement(appModule.default))

    testsFunction(screen)
  } finally {
    await FS.remove(appDir)
  }
}
