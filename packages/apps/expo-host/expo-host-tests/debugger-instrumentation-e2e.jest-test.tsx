import TR from '@runtime/TR'
import { Assert, CLI, FS, ProjectIdentity, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { act, render, waitFor } from '@testing-library/react-native'
import { type ComponentType, createElement } from 'react'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

type TaoDebugEvent = Parameters<Parameters<typeof TR.Debug.onEvent>[0]>[0]

registerRuntimeE2ELifecycle()

Describe('generated debugger instrumentation', () => {
  Test('executes compiler-emitted statement gates inside a Studio preview', async () => {
    await withTaoFiles(
      'tao-debugger-generated-',
      {
        'Main.tao': `
          app DebugApp { id "debugapp" version "1.0.0" name "DebugApp" view Main }

          view Main() {
            state Count = 0
            action AddTwo() {
              set Count += 1
              set Count += 1
            }
            render NativeButton(Count, AddTwo)
          }

          view NativeButton(Label number, Press action()) {
            render inject Label, Press \`\`\`ts
              return (
                <RN.Pressable accessibilityRole="button" onPress={() => { void Press.invoke() }}>
                  <RN.Text>{Label}</RN.Text>
                </RN.Pressable>
              )
            \`\`\`
          }
        `,
      },
      async (paths, root) => {
        const runtimePackageRoot = FS.resolvePath('runtime', root)
        const generationScript = `
          import Runtime from ${JSON.stringify(Repo.resolvePath('packages/apps/expo-host/expo-host-src/runtime.ts'))}
          await Runtime.generateApp(${JSON.stringify(paths['Main.tao'])}, ${
          JSON.stringify({
            appName: 'DebugApp',
            preview: { project: root, revision: 1, sourceVersions: {} },
            runtimePackageRoot,
          })
        })
        `
        const generation = await CLI.run('bun', { args: ['-e', generationScript], cwd: Repo.getRoot() })
        Assert(generation.exitCode === 0, 'instrumented Studio preview generation succeeds', {
          stderr: generation.stderr,
          stdout: generation.stdout,
        })
        // Previews publish in place. The compiled app keeps the stable `TaoApp.tsx` path while
        // `App.tsx` is reserved for the Studio host, and the retired `current/` directory is gone.
        const generated = require(FS.resolvePath('_gen_tao-app/TaoApp.tsx', runtimePackageRoot)) as {
          default: ComponentType
        }
        const screen = render(createElement(generated.default))
        await act(async () => {
          await Promise.resolve()
          await Promise.resolve()
          await new Promise<void>(resolve => queueMicrotask(resolve))
        })
        await waitFor(() => Expect(screen.getByText('0')).toBeDefined())
        const paused = nextDebugEvent('paused')
        TR.Debug.Break()
        try {
          let button = screen.getByText('0')
          while (typeof button.props.onPress !== 'function') {
            Assert.defined(button.parent, 'the accessible button has a pressable ancestor')
            button = button.parent
          }
          button.props.onPress()
          await paused

          Expect(screen.getByText('0')).toBeDefined()
          Expect(TR.Debug.Paused()?.step).toMatchObject({ action: 'AddTwo', path: '0' })
          const projectId = ProjectIdentity.read(root)
          Expect(projectId).toBeDefined()
          const declaration = TR.Debug.Paused()?.step.declaration
          Assert.defined(declaration, 'the debugger pause includes a declaration identity')
          Expect(JSON.parse(declaration)).toEqual([
            'tao.declaration',
            1,
            projectId,
            '@workspace',
            'Main',
            'view',
            'Main',
          ])
          Expect(TR.Debug.Paused()?.step.statement).toBe('block.statements[1].block.statements[0]')

          act(() => TR.Debug.Continue())
          await waitFor(() => Expect(screen.getByText('2')).toBeDefined())
        } finally {
          TR.Debug.Reset()
        }
      },
    )
  })
})

function nextDebugEvent(kind: TaoDebugEvent['kind']): Promise<TaoDebugEvent> {
  return new Promise(resolve => {
    const stop = TR.Debug.onEvent(event => {
      if (event.kind === kind) {
        stop()
        resolve(event)
      }
    })
  })
}
