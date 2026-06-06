import { FS, Repo } from '@shared'
import { AfterEach, Describe, Expect, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { testCompileApp } from './test-compile-app'

AfterEach(() => cleanup())

Describe('Tao injection runtime', () => {
  Test('renders inject arguments as direct TS values', async () => {
    const repoRoot = await Repo.getRoot()
    const appDir = await FS.mkTmpDir(FS.resolvePath('tao-runtime-e2e-', { cwd: FS.tmpdir() }))
    const appPath = FS.resolvePath('Inject Args.tao', { cwd: appDir })

    await testCompileApp(
      repoRoot,
      appPath,
      `
        app InjectArgs {
            ui MainView
        }

        alias UserName = "Ro"
        alias Count = 3

        ui MainView {
            render Text "Hello"
        }

        ui Text Value text {
            render inject Value, Name UserName, Count \`\`\`ts
                return <RN.Text>{Value + " " + Name + " " + Count}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        Expect(screen.getByText('Hello Ro 3')).toBeDefined()
      },
    )
  })
})
