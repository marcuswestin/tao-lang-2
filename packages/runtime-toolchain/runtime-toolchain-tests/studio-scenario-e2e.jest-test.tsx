import TR from '@runtime/TR'
import { Assert, CLI, Errors, FS, Repo } from '@shared'
import { AfterAll, AfterEach, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'
import type {
  TaoStudioFixturePlan,
  TaoStudioFixtureValue,
} from '../../runtime/TaoRuntime-src/TR-studio-environment'

const runtimeRoots: string[] = []
const wordFlowerDir = Repo.resolvePath('Apps/WordFlower/1 - Current')

Describe('Tao Studio scenario runtime', () => {
  Test('shows a render failure inside the preview canvas', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    function BrokenPreview(): never {
      return Errors.throwUnexpected('WorkspaceRow could not render.')
    }
    try {
      const screen = render(
        createElement(TR.Studio.ErrorBoundary, null, createElement(BrokenPreview)),
      )

      Expect(screen.getByText('Tao Studio preview error')).toBeDefined()
      Expect(screen.getByText('WorkspaceRow could not render.')).toBeDefined()
    } finally {
      consoleError.mockRestore()
    }
  })

  Test('mounts the real WordFlower focused-view scenario', async () => {
    const artifactsRoot = Repo.resolvePath('packages/runtime-toolchain/.artifacts/studio-scenario-e2e-tests')
    await FS.mkdir(artifactsRoot)
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('wordflower-runtime-', artifactsRoot))
    runtimeRoots.push(runtimePackageRoot)
    const generationScript = `
      import Runtime from ${
      JSON.stringify(Repo.resolvePath('packages/runtime-toolchain/runtime-toolchain-src/runtime.ts'))
    }
      await Runtime.generateApp(${JSON.stringify(FS.resolvePath('WordFlower.tao', wordFlowerDir))}, ${
      JSON.stringify({
        appName: 'WordFlower',
        preview: { project: wordFlowerDir, revision: 1, sourceVersions: {} },
        runtimePackageRoot,
      })
    })
    `
    const generation = await CLI.run('bun', { args: ['-e', generationScript], cwd: Repo.getRoot() })
    Assert(generation.exitCode === 0, 'WordFlower Studio scenario app generation succeeds', {
      stderr: generation.stderr,
      stdout: generation.stdout,
    })
    // `current` is the stable link to the newest published revision root, which holds the compiled graph.
    const generatedRoot = FS.resolvePath('_gen_tao-app/current', runtimePackageRoot)
    const manifest = require(FS.resolvePath('TaoStudioManifest.ts', generatedRoot)).default as {
      fixtures: Array<TaoStudioFixturePlan & { id: string }>
      scenarios: Array<{
        fixtureId: string
        group: string
        name: string
        prepare: readonly []
        subject: {
          arguments: Readonly<Record<string, TaoStudioFixtureValue>>
          kind: 'app' | 'view'
          subjectId: string
        }
      }>
    }
    const scenario = manifest.scenarios.find(candidate => candidate.group === 'states' && candidate.name === 'novel')
    Assert.defined(scenario, 'real WordFlower focused-view scenario exists')
    const fixture = manifest.fixtures.find(candidate => candidate.id === scenario.fixtureId)
    Assert.defined(fixture, 'real WordFlower scenario fixture exists')
    const generatedApp = require(FS.resolvePath('TaoApp.tsx', generatedRoot)) as { default: ComponentType }

    const screen = render(
      createElement(
        TR.Studio.Environment.Host,
        {
          cell: {
            environment: {
              network: { mode: 'online' },
              scheme: {
                requested: 'light',
                source: 'scenario',
              },
              version: 1,
            },
            fixture,
            scenario: {
              arguments: scenario.subject.arguments,
              kind: 'view',
              prepare: scenario.prepare,
              subjectId: scenario.subject.subjectId,
            },
          },
          children: createElement(generatedApp.default),
        },
      ),
    )

    await waitFor(() => Expect(screen.getByText('Novel')).toBeDefined())
    Expect(screen.getByTestId('openWorkspace')).toBeDefined()
    Expect(screen.getByTestId('deleteWorkspace')).toBeDefined()

    // Presenting is legal in any view body, and this row does it. Mounted bare, `present` found no
    // navigation above it and the cell died on the first tap with 'no enclosing or explicit
    // navigation target' — on the phone, where a person is tapping rather than reading a stack.
    fireEvent.press(screen.getByTestId('openWorkspace'))
    await waitFor(() => Expect(screen.getByText('WORKSPACE DETAILS')).toBeDefined())
    Expect(screen.getByTestId('saveWorkspace')).toBeDefined()
  })

  Test('mounts an imported focused view with its fixture entity', async () => {
    const artifactsRoot = Repo.resolvePath('packages/runtime-toolchain/.artifacts/studio-scenario-e2e-tests')
    await FS.mkdir(artifactsRoot)
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('runtime-', artifactsRoot))
    runtimeRoots.push(runtimePackageRoot)
    await withTaoFiles('tao-studio-scenario-source-', {
      'Data.tao': `
        workspace data Workspaces / Workspace {
          Name text
        }
      `,
      'Main.tao': `
        use Memory from @tao/data/providers/memory
        use StackNav from @tao/nav
        use Text from @tao/ui
        use Workspaces from ./Data.tao
        use WorkspaceRow from ./Workspaces.tao

        app Preview {
          Name "Preview"
          Navigator StackNav { Initial Main }
          Datasource Memory { }
        }

        scene Main() { Title "Main" render Text("Main") }

        fixture StudioWorkspace {
          Novel = create Workspace { Name: "Novel" }
        }

        scenarios WorkspaceRow "states" {
          fixture StudioWorkspace
          device phone
          appearance light
          network online
          locale "en"
          scenario "novel" {
            render (Workspace: Novel)
          }
        }
      `,
      'Workspaces.tao': `
        use Workspaces from ./Data.tao
        use Col, FormButton, Text from @tao/ui

        workspace view WorkspaceRow(Workspace) {
          render Col() {
            Text(Workspace.Name)
            #openWorkspace
            FormButton("Open workspace") {
              on press -> { delete Workspace }
            }
          }
        }
      `,
    }, async paths => {
      const runtimeModulePath = Repo.resolvePath('packages/runtime-toolchain/runtime-toolchain-src/runtime.ts')
      const generationScript = `
        import Runtime from ${JSON.stringify(runtimeModulePath)}
        await Runtime.generateApp(${JSON.stringify(paths['Main.tao'])}, ${
        JSON.stringify({
          appName: 'Preview',
          preview: {
            project: FS.dirname(paths['Main.tao']),
            revision: 1,
            sourceVersions: {},
          },
          runtimePackageRoot,
        })
      })
      `
      const generation = await CLI.run('bun', { args: ['-e', generationScript], cwd: Repo.getRoot() })
      Assert(generation.exitCode === 0, 'Studio scenario app generation succeeds', {
        stderr: generation.stderr,
        stdout: generation.stdout,
      })
      // `current` is the stable link to the newest published revision root, which holds the compiled graph.
      const generatedRoot = FS.resolvePath('_gen_tao-app/current', runtimePackageRoot)
      const manifestModule = require(FS.resolvePath('TaoStudioManifest.ts', generatedRoot)) as {
        default: {
          fixtures: Array<TaoStudioFixturePlan & { id: string }>
          scenarios: Array<{
            fixtureId: string
            group: string
            name: string
            prepare: readonly []
            subject: {
              arguments: Readonly<Record<string, TaoStudioFixtureValue>>
              kind: 'app' | 'view'
              subjectId: string
            }
          }>
        }
      }
      const manifest = manifestModule.default
      const scenario = manifest.scenarios.find(candidate => candidate.group === 'states' && candidate.name === 'novel')
      Assert.defined(scenario, 'fixture-backed focused-view scenario exists')
      Assert(scenario.subject.kind === 'view', 'scenario focuses a view')
      const fixture = manifest.fixtures.find(candidate => candidate.id === scenario.fixtureId)
      Assert.defined(fixture, 'scenario fixture exists')
      const generatedAppPath = FS.resolvePath('TaoApp.tsx', generatedRoot)
      const generatedApp = require(generatedAppPath) as { default: ComponentType }
      const screen = render(
        createElement(
          TR.Studio.Environment.Host,
          {
            cell: {
              environment: {
                network: { mode: 'online' },
                scheme: {
                  requested: 'light',
                  source: 'scenario',
                },
                version: 1,
              },
              fixture,
              scenario: {
                arguments: scenario.subject.arguments,
                kind: 'view',
                prepare: scenario.prepare,
                subjectId: scenario.subject.subjectId,
              },
            },
            children: createElement(generatedApp.default),
          },
        ),
      )

      await waitFor(() => Expect(screen.getByText('Novel')).toBeDefined())
      const button = screen.getByTestId('openWorkspace')
      Expect(button.props['testID']).toBe('openWorkspace')
      let selectableRoot = button.parent
      while (selectableRoot !== null && selectableRoot.props['dataSet'] === undefined) {
        selectableRoot = selectableRoot.parent
      }
      Assert.defined(selectableRoot, 'native FormButton has a Studio-selectable host ancestor')
      const studioIdentity = JSON.parse(String(
        (selectableRoot.props['dataSet'] as Record<string, unknown>)['taoStudio'],
      ))
      Expect(studioIdentity).toMatchObject({
        kind: 'render',
        ownerName: 'WorkspaceRow',
        sourcePath: paths['Workspaces.tao'],
      })
    })
  })
})

AfterEach(cleanup)

AfterAll(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})
