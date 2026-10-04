import TR from '@runtime/TR'
import { Assert, CLI, Errors, FS, Repo } from '@shared'
import { AfterAll, AfterEach, Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
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

async function createScenarioRuntimeRoot(prefix: string): Promise<string> {
  const runtimePackageRoot = await mkTestDir(prefix)
  // Register ownership before linking dependencies so AfterAll also covers a failed link.
  runtimeRoots.push(runtimePackageRoot)
  await FS.symlink(
    Repo.resolvePath('packages/apps/expo-host/node_modules'),
    FS.resolvePath('node_modules', runtimePackageRoot),
  )
  return runtimePackageRoot
}

Describe('Tao Studio scenario runtime', () => {
  Test('runtime-root cleanup reports every failure and continues to later roots', async () => {
    const removed: string[] = []
    let cleanupError: unknown
    try {
      await cleanupScenarioRuntimeRoots(
        ['runtime-first', 'runtime-second', 'runtime-third'],
        root => {
          removed.push(root)
          if (root !== 'runtime-third') {
            Errors.throwHostEnvironment(`${root} removal failed`)
          }
        },
      )
    } catch (error) {
      cleanupError = error
    }

    Expect(removed).toEqual(['runtime-first', 'runtime-second', 'runtime-third'])
    Expect(Errors.messageOf(cleanupError)).toContain('remove runtime root runtime-first: runtime-first removal failed')
    Expect(Errors.messageOf(cleanupError)).toContain(
      'remove runtime root runtime-second: runtime-second removal failed',
    )
  })

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
    const runtimePackageRoot = await createScenarioRuntimeRoot('tao-wordflower-runtime-')
    const generationScript = `
      import Runtime from ${JSON.stringify(Repo.resolvePath('packages/apps/expo-host/expo-host-src/runtime.ts'))}
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
    const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
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
      id: 'focused-occurrence-app',
      name: 'Focused occurrence app',
      navigator: () =>
        TR.Navigation.Configure(
          TR.Navigation.Declaration('Focused occurrence slot', TR.NavKind.Slot()),
          { Initial: TR.Navigation.BindView(focused, arguments_) },
        ),
      restoration: { exclusions: [], mode: 'fresh', variant: 'Focused occurrence app' },
      version: '1.0.0',
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

  Test("resolves a focused view's design in the scheme the app shell stamps", () => {
    const byScheme = { environment: 'Scheme', expected: 'dark', kind: 'conditional' } as const
    const design = TR.Design.Declaration({
      bundles: {
        NavigationChromeButton: TR.Design.Spec([['fg', 'chrome']]),
        NavigationHost: TR.Design.Spec([['bg', 'canvas']]),
      },
      colors: {
        canvas: { ...byScheme, negative: '#fafafa', positive: '#101010' },
        chrome: { ...byScheme, negative: '#202020', positive: '#e0e0e0' },
      },
      name: 'Scheme design',
      tokens: {},
    })
    const detail = TR.Navigation.View({ name: 'Scheme detail', render: () => createElement(RN.Text, null, 'Detail') })
    const focused = TR.Navigation.View({
      name: 'Scheme root',
      render: (_arguments, taoProps) =>
        createElement(RN.Pressable, {
          accessibilityLabel: 'Open detail',
          accessibilityRole: 'button',
          children: createElement(RN.Text, null, 'Root'),
          onPress: () => TR.Navigation.PresentIn(taoProps, undefined, detail, {}),
        }),
    })
    const definition = (): TR.AppDefinition => ({
      auxiliaries: () => ({}),
      design: () => design,
      id: 'scheme-app',
      name: 'Scheme app',
      navigator: () =>
        TR.Navigation.Configure(TR.Navigation.Declaration('Scheme slot', TR.NavKind.Slot()), { Initial: focused }),
      restoration: { exclusions: [], mode: 'fresh', variant: 'Scheme app' },
      version: '1.0.0',
    })
    const environment = { platform: 'web', system: 'light' } as const
    const tree = (appearance: TR.Scheme) =>
      createElement(
        TR.Scheme.Provider,
        { appearance, environment },
        createElement(TR.AppShell, null, createElement(TR.Studio.SubjectHost, { arguments: {}, definition })),
      )
    const screen = render(tree('dark'))
    const backgrounds = () =>
      screen.UNSAFE_getAllByType(RN.View).map(view => RN.StyleSheet.flatten(view.props.style)?.backgroundColor)

    // The shell stamps the resolved scheme on its root child; a subject host that dropped it left
    // every focused view's `when Scheme is Dark` colors resolving light.
    Expect(backgrounds()).toContain('#101010')
    Expect(backgrounds()).not.toContain('#fafafa')
    // The app's own Back control, shown once the focused view presents, is chrome the design styles.
    fireEvent.press(screen.getByLabelText('Open detail'))
    const backInk = () => RN.StyleSheet.flatten(screen.getByText('Back').props.style)?.color
    Expect(backInk()).toBe('#e0e0e0')
    screen.rerender(tree('light'))
    Expect(backgrounds()).toContain('#fafafa')
    Expect(backInk()).toBe('#202020')
  })

  Test('mounts an imported focused view with its fixture entity', async () => {
    const runtimePackageRoot = await createScenarioRuntimeRoot('tao-studio-scenario-runtime-')
    await withTaoFiles('tao-studio-scenario-source-', {
      'Data.tao': `
        project data Workspaces / Workspace {
          Name text
        }
      `,
      'Main.tao': `
        use Memory from @tao/data/providers/memory
        use StackNav from @tao/nav
        use Text from @tao/ui
        use Workspace from ./Data.tao
        use WorkspaceRow from ./Workspaces.tao

        app Preview { id "preview" version "1.0.0" name "Preview"
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
        use Workspace from ./Data.tao
        use Col, FormButton, Text from @tao/ui

        project view WorkspaceRow(Workspace) {
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
      const runtimeModulePath = Repo.resolvePath('packages/apps/expo-host/expo-host-src/runtime.ts')
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
      const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
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
    const runtimePackageRoot = await createScenarioRuntimeRoot('tao-studio-fixtureless-runtime-')
    await withTaoFiles('tao-studio-fixtureless-scenario-', {
      'Main.tao': `
        use Button, Col, Text from @tao/ui

        app Preview { id "preview" version "1.0.0" name "Preview" view Main }
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
            advance 1.5.ms
            press up #revertSave
            hover #revertSave
            focus #revertSave
          }
        }
      `,
    }, async paths => {
      const generationScript = `
        import Runtime from ${JSON.stringify(Repo.resolvePath('packages/apps/expo-host/expo-host-src/runtime.ts'))}
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
      const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
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
      Expect(scenario.steps[1]).toMatchObject({ kind: 'advance', milliseconds: 1.5 })

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
  await cleanupScenarioRuntimeRoots(runtimeRoots.splice(0))
})

async function cleanupScenarioRuntimeRoots(
  roots: readonly string[],
  remove: (root: string) => Promise<void> | void = root => FS.remove(root),
): Promise<void> {
  const failures: Array<{ error: unknown; label: string }> = []
  for (const root of roots) {
    try {
      await remove(root)
    } catch (error) {
      failures.push({ error, label: `remove runtime root ${root}` })
    }
  }
  if (failures.length > 0) {
    Errors.throwUnexpected(
      `${failures.length} Studio scenario cleanup operations failed:\n${
        failures.map(failure => `- ${failure.label}: ${Errors.messageOf(failure.error)}`).join('\n')
      }`,
      {
        cause: failures.map(failure => ({
          error: Errors.formatForLog(failure.error),
          label: failure.label,
        })),
      },
    )
  }
}
