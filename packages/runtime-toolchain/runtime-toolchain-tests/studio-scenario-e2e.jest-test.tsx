import TR from '@runtime/TR'
import { Assert, CLI, Errors, FS, Repo } from '@shared'
import { AfterAll, AfterEach, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'
import * as RN from 'react-native'
import type {
  TaoStudioFixturePlan,
  TaoStudioFixtureValue,
} from '../../runtime/TaoRuntime-src/TR-studio-environment'
import type { TaoJourneyStep } from '../../runtime/TaoRuntime-src/TR-studio-journey'

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
    fireEvent.press(screen.getByTestId('openWorkspace'))
    await waitFor(() => Expect(screen.getByTestId('workspaceTitle')).toBeDefined())
    Expect(screen.getByText('WORKSPACE DETAILS')).toBeDefined()
    act(() => Expect(TR.Navigation.Back()).toBe(true))
    await waitFor(() => Expect(screen.queryByText('WORKSPACE DETAILS')).toBeNull())
    Expect(screen.getByTestId('openWorkspace')).toBeDefined()
    Expect(screen.getByTestId('deleteWorkspace')).toBeDefined()

    // Presenting is legal in any view body, and this row does it. Mounted bare, `present` found no
    // navigation above it and the cell died on the first tap with 'no enclosing or explicit
    // navigation target' — on the phone, where a person is tapping rather than reading a stack.
    fireEvent.press(screen.getByTestId('openWorkspace'))
    await waitFor(() => Expect(screen.getByText('WORKSPACE DETAILS')).toBeDefined())
    Expect(screen.getByTestId('saveWorkspace')).toBeDefined()
  })

  Test('keeps focused occurrences in isolated app-owned lanes with their app design', () => {
    const design = TR.Design.Declaration({ bundles: {}, name: 'Studio design', tokens: {} })
    const detail = TR.Navigation.View({
      name: 'Focused detail',
      render: arguments_ =>
        createElement(
          RN.Text,
          null,
          `${String(arguments_['Label']?.evaluate().jsValue)} detail`,
        ),
    })
    const focused = TR.Navigation.View({
      name: 'Focused root',
      render: (arguments_, taoProps) => {
        const label = String(arguments_['Label']?.evaluate().jsValue)
        return createElement(
          RN.View,
          null,
          createElement(RN.Text, null, `${label} root`),
          createElement(
            RN.Text,
            null,
            taoProps?.app?.design === design ? `${label} app design` : `${label} detached`,
          ),
          createElement(RN.Pressable, {
            accessibilityLabel: `Open ${label}`,
            accessibilityRole: 'button',
            children: createElement(RN.Text, null, `Open ${label}`),
            onPress: () => TR.Navigation.PresentIn(taoProps, undefined, detail, { Label: TR.Value(label) }),
          }),
        )
      },
    })
    const subject = (arguments_: TR.NavigationArguments): TR.AppDefinition => ({
      auxiliaries: () => ({}),
      design: () => design,
      name: 'Focused occurrence app',
      navigator: () =>
        TR.Navigation.Configure(
          TR.Navigation.Declaration('Focused occurrence slot', TR.NavKind.Slot()),
          { Initial: TR.Navigation.BindView(focused, arguments_) },
        ),
      restoration: { exclusions: [], mode: 'fresh', variant: 'Focused occurrence app' },
    })
    const screen = render(createElement(
      RN.View,
      null,
      createElement(TR.Studio.SubjectHost, {
        arguments: { Label: TR.Value('Left') },
        definition: subject,
      }),
      createElement(TR.Studio.SubjectHost, {
        arguments: { Label: TR.Value('Right') },
        definition: subject,
      }),
    ))

    Expect(screen.getByText('Left app design')).toBeDefined()
    Expect(screen.getByText('Right app design')).toBeDefined()
    fireEvent.press(screen.getByLabelText('Open Left'))
    Expect(screen.getByText('Left detail')).toBeDefined()
    Expect(screen.queryByText('Right detail')).toBeNull()
    fireEvent.press(screen.getByLabelText('Open Right'))
    Expect(screen.getByText('Right detail')).toBeDefined()
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

  Test('mounts a fixtureless journey view with an action stand-in and leaves it interactive', async () => {
    const artifactsRoot = Repo.resolvePath('packages/runtime-toolchain/.artifacts/studio-scenario-e2e-tests')
    await FS.mkdir(artifactsRoot)
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('fixtureless-runtime-', artifactsRoot))
    runtimeRoots.push(runtimePackageRoot)
    await withTaoFiles('tao-studio-fixtureless-scenario-', {
      'Main.tao': `
        use Button, Col, Text from @tao/ui

        app Preview { view Main }
        view Main() { render Text("Main") }
        view SavedToast(Revert action()) {
          render Col() {
            Text("Saved")
            #revertSave
            Button("Revert") { on press Revert }
          }
        }
        scenarios SavedToast "interaction" {
          device phone
          scenario "held" {
            render ()
            press down #revertSave
            advance 600.ms
            press up #revertSave
            hover #revertSave
            focus #revertSave
          }
        }
      `,
    }, async paths => {
      const generationScript = `
        import Runtime from ${
        JSON.stringify(Repo.resolvePath('packages/runtime-toolchain/runtime-toolchain-src/runtime.ts'))
      }
        await Runtime.generateApp(${JSON.stringify(paths['Main.tao'])}, ${
        JSON.stringify({
          appName: 'Preview',
          preview: { project: FS.dirname(paths['Main.tao']), revision: 1, sourceVersions: {} },
          runtimePackageRoot,
        })
      })
      `
      const generation = await CLI.run('bun', { args: ['-e', generationScript], cwd: Repo.getRoot() })
      Assert(generation.exitCode === 0, 'fixtureless Studio scenario app generation succeeds', {
        stderr: generation.stderr,
        stdout: generation.stdout,
      })
      const generatedRoot = FS.resolvePath('_gen_tao-app/current', runtimePackageRoot)
      const manifest = require(FS.resolvePath('TaoStudioManifest.ts', generatedRoot)).default as {
        fixtures: readonly unknown[]
        scenarios: readonly {
          fixtureId?: string
          prepare: readonly []
          steps: readonly TaoJourneyStep[]
          subject: {
            arguments: Readonly<Record<string, TaoStudioFixtureValue>>
            kind: 'view'
            subjectId: string
          }
        }[]
      }
      const scenario = manifest.scenarios[0]
      Assert.defined(scenario, 'fixtureless held scenario exists')
      Expect(manifest.fixtures).toEqual([])
      Expect(scenario.fixtureId).toBeUndefined()
      Expect(scenario.subject.arguments).toEqual({ Revert: { kind: 'action-stand-in', parameter: 'Revert' } })
      Expect(scenario.steps.map(step => step.kind)).toEqual([
        'pressDown',
        'advance',
        'pressUp',
        'hover',
        'focus',
      ])
      Expect(scenario.steps[1]).toMatchObject({ kind: 'advance', milliseconds: 600 })

      const generatedApp = require(FS.resolvePath('TaoApp.tsx', generatedRoot)) as { default: ComponentType }
      const consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {})
      try {
        const screen = render(
          createElement(
            TR.Studio.Environment.Host,
            {
              cell: {
                environment: {
                  network: { mode: 'online' },
                  scheme: { requested: 'light', source: 'scenario' },
                  version: 1,
                },
                fixture: { accounts: [], creates: [] },
                scenario: {
                  arguments: scenario.subject.arguments,
                  kind: 'view',
                  prepare: scenario.prepare,
                  steps: scenario.steps,
                  subjectId: scenario.subject.subjectId,
                },
              },
              children: createElement(generatedApp.default),
            },
          ),
        )

        await waitFor(() => Expect(screen.getByText('Saved')).toBeDefined())
        const revert = screen.getByTestId('revertSave')
        fireEvent(revert, 'pressIn')
        fireEvent(revert, 'pressOut')
        fireEvent(revert, 'hoverIn')
        fireEvent(revert, 'focus')
        Expect(consoleInfo).not.toHaveBeenCalled()
        fireEvent.press(revert)
        Expect(consoleInfo).toHaveBeenCalledWith("Tao Studio action stand-in 'Revert' invoked.")
      } finally {
        consoleInfo.mockRestore()
      }
    })
  })
})

AfterEach(cleanup)

AfterAll(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})
