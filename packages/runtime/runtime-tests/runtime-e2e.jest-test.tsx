import { FS, Repo } from '@shared'
import { AfterEach, Describe, Expect, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { compileAndRenderApp, testCompileApp } from './test-compile-app'

AfterEach(() => cleanup())

Describe('Expo runtime', () => {
  Test('compiles and renders Kitchen Sink text and number aliases', async () => {
    const repoRoot = Repo.getRoot()
    const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
    const screen = await compileAndRenderApp(repoRoot, kitchenSinkPath)

    Expect(screen.getByText('Hello, World!')).toBeDefined()
    Expect(screen.getByText('Launch count: 3')).toBeDefined()
  })

  Test('renders alias references to earlier aliases', async () => {
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
        Expect(screen.getByText('Ordered output')).toBeDefined()
      },
    )
  })
})
