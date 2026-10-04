import { Assert, CLI, FS, Repo } from '@shared'
import { Deferred, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace'

type Probe = {
  register(label: string): void
  suspend(): Promise<void>
  mark(label: string): void
}

type ActionName = 'Run' | 'Recover' | 'Otherwise' | 'CheckExit' | 'GuardExit' | 'Inline' | 'Detached' | 'Sync'
type Actions = Record<ActionName, { jsValue: { invoke(...args: unknown[]): void | Promise<void> } }>

// Compiler tests have no JSX target. Load the real JSX-bearing runtime through its file boundary;
// the complete emitted graph below is separately checked with the app's JSX compiler options.
const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
const { settleActionRoots } = await import(
  Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts')
)

// The real transaction queue and debugger are process-wide; these fixtures own them one at a time.
let runtimeFixture: Promise<void> = Promise.resolve()

const authoredActions = `
  action Register(Label text) from ./Native.ts
  action Suspend() from ./Native.ts
  action Mark(Label text) from ./Native.ts
  type Failure is one of Offline
  action Failing() { fail Offline "Unavailable." }
  action Succeed() { }
  public action Run(Label text) {
    do Register(Label)
    if true { do Register("inner") do Suspend() }
    do Mark("tail")
  }
  public action Recover() {
    do Register("outer")
    when do Failing() { Offline -> { do Register("recovered") do Suspend() } }
    do Mark("tail")
  }
  public action Otherwise() {
    do Register("outer")
    when do Failing() | otherwise -> { do Register("otherwise") }
    do Mark("tail")
  }
  public action CheckExit() {
    do Register("check")
    check false
    do Mark("unreachable")
  }
  public action GuardExit() {
    do Register("guard-owner")
    guard true true -> { do Register("guard") }
    do Mark("unreachable")
  }
  public action Inline() {
    do Register("outer")
    do action { do Register("inline") check false do Mark("unreachable") }()
    do Mark("tail")
  }
  public action Detached() {
    do Register("outer")
    async { do Register("detached") do Suspend() }
    do Mark("parent-tail")
  }
  public action Sync() { do Succeed() check false }
`

Describe('compiler: lexical action cleanup', () => {
  for (const debug of [false, true]) {
    Test(`joins an if block's body and cleanup before its parent's tail (debug ${debug})`, async () => {
      await withCompiledActions(debug, async (actions, native) => {
        const events: string[] = []
        const bodyStarted = Deferred()
        const releaseBody = Deferred()
        const cleanupStarted = Deferred()
        const releaseCleanup = Deferred()
        native.Configure({
          register(label) {
            events.push(`register:${label}`)
            TR.Defer(async () => {
              events.push(`cleanup:${label}`)
              if (label === 'inner') {
                cleanupStarted.resolve()
                await releaseCleanup.promise
                events.push('cleanup:inner:done')
              }
            })
          },
          suspend() {
            bodyStarted.resolve()
            return releaseBody.promise
          },
          mark(label) {
            events.push(label)
          },
        })
        let settled = false
        const pending = Promise.resolve(actions.Run!.jsValue.invoke(TR.Value('outer'))).then(() => {
          settled = true
        })
        try {
          await started(bodyStarted, pending)
          Expect(events).toEqual(['register:outer', 'register:inner'])
          Expect(settled).toBe(false)
          releaseBody.resolve()
          await started(cleanupStarted, pending)
          Expect(events).toEqual(['register:outer', 'register:inner', 'cleanup:inner'])
          Expect(settled).toBe(false)
          releaseCleanup.resolve()
          await pending
          Expect(events).toEqual([
            'register:outer',
            'register:inner',
            'cleanup:inner',
            'cleanup:inner:done',
            'tail',
            'cleanup:outer',
          ])
        } finally {
          releaseBody.resolve()
          releaseCleanup.resolve()
          await pending
        }
      })
    })

    Test(`joins a contained recovery frame's final await and cleanup (debug ${debug})`, async () => {
      await withCompiledActions(debug, async (actions, native) => {
        const events: string[] = []
        const bodyStarted = Deferred()
        const releaseBody = Deferred()
        const cleanupStarted = Deferred()
        const releaseCleanup = Deferred()
        native.Configure({
          register(label) {
            events.push(`register:${label}`)
            TR.Defer(async () => {
              events.push(`cleanup:${label}`)
              if (label === 'recovered') {
                cleanupStarted.resolve()
                await releaseCleanup.promise
              }
            })
          },
          suspend() {
            bodyStarted.resolve()
            return releaseBody.promise
          },
          mark(label) {
            events.push(label)
          },
        })
        const pending = Promise.resolve(actions.Recover!.jsValue.invoke())
        try {
          await started(bodyStarted, pending)
          Expect(events).toEqual(['register:outer', 'register:recovered'])
          releaseBody.resolve()
          await started(cleanupStarted, pending)
          Expect(events).toEqual(['register:outer', 'register:recovered', 'cleanup:recovered'])
          releaseCleanup.resolve()
          await pending
          Expect(events).toEqual([
            'register:outer',
            'register:recovered',
            'cleanup:recovered',
            'tail',
            'cleanup:outer',
          ])
        } finally {
          releaseBody.resolve()
          releaseCleanup.resolve()
          await pending
        }
      })
    })

    Test(`keeps check and guard exits local and drains inline/otherwise frames (debug ${debug})`, async () => {
      await withCompiledActions(debug, async (actions, native) => {
        const events: string[] = []
        native.Configure({
          register(label) {
            events.push(`register:${label}`)
            TR.Defer(() => {
              events.push(`cleanup:${label}`)
            })
          },
          suspend() {
            return Promise.resolve()
          },
          mark(label) {
            events.push(label)
          },
        })
        for (const name of ['CheckExit', 'GuardExit', 'Inline', 'Otherwise'] as const) {
          await actions[name]!.jsValue.invoke()
        }
        Expect(events).toEqual([
          'register:check',
          'cleanup:check',
          'register:guard-owner',
          'register:guard',
          'cleanup:guard',
          'cleanup:guard-owner',
          'register:outer',
          'register:inline',
          'cleanup:inline',
          'tail',
          'cleanup:outer',
          'register:outer',
          'register:otherwise',
          'cleanup:otherwise',
          'tail',
          'cleanup:outer',
        ])
      })
    })
  }

  Test('preserves synchronous completion for an authored synchronous call chain', async () => {
    await withCompiledActions(false, async actions => {
      Expect(actions.Sync!.jsValue.invoke()).toBeUndefined()
    })
  })

  Test('restores the lexical frame after a real debugger pause', async () => {
    await withCompiledActions(true, async (actions, native) => {
      const events: string[] = []
      native.Configure({
        register(label) {
          events.push(`register:${label}`)
          TR.Defer(() => {
            events.push(`cleanup:${label}`)
          })
        },
        suspend() {
          return Promise.resolve()
        },
        mark(label) {
          events.push(label)
        },
      })
      TR.Debug.Configure({ actions: ['Run'] })
      const pending = Promise.resolve(actions.Run!.jsValue.invoke(TR.Value('outer')))
      try {
        Expect(TR.Debug.Paused()?.step.action).toBe('Run')
        Expect(events).toEqual([])
        TR.Debug.Continue()
        await pending
        Expect(events).toEqual(['register:outer', 'register:inner', 'cleanup:inner', 'tail', 'cleanup:outer'])
      } finally {
        TR.Debug.Reset()
        await pending
      }
    })
  })

  Test('gives detached authored work its own frame after the parent completes', async () => {
    await withCompiledActions(false, async (actions, native) => {
      const events: string[] = []
      const bodyStarted = Deferred()
      const releaseBody = Deferred()
      const cleanupStarted = Deferred()
      const releaseCleanup = Deferred()
      const detachedDone = Deferred()
      native.Configure({
        register(label) {
          events.push(`register:${label}`)
          TR.Defer(async () => {
            events.push(`cleanup:${label}`)
            if (label === 'detached') {
              cleanupStarted.resolve()
              await releaseCleanup.promise
              events.push('cleanup:detached:done')
              detachedDone.resolve()
            }
          })
        },
        suspend() {
          bodyStarted.resolve()
          return releaseBody.promise
        },
        mark(label) {
          events.push(label)
        },
      })
      try {
        await actions.Detached!.jsValue.invoke()
        await bodyStarted.promise
        Expect(events).toEqual(['register:outer', 'parent-tail', 'cleanup:outer', 'register:detached'])
        releaseBody.resolve()
        await cleanupStarted.promise
        Expect(events.at(-1)).toBe('cleanup:detached')
        releaseCleanup.resolve()
        await detachedDone.promise
        Expect(events.at(-1)).toBe('cleanup:detached:done')
      } finally {
        releaseBody.resolve()
        releaseCleanup.resolve()
        await detachedDone.promise
      }
    })
  })
})

async function started(gate: Deferred, completion: Promise<void>): Promise<void> {
  await Promise.race([
    gate.promise,
    completion.then(() => {
      Assert(false, 'compiled action reached the gate before completing')
    }),
  ])
}

async function withCompiledActions(
  debug: boolean,
  test: (actions: Actions, native: { Configure(probe: Probe): void }) => Promise<void>,
): Promise<void> {
  const previous = runtimeFixture
  const released = Deferred()
  runtimeFixture = released.promise
  await previous
  await settleActionRoots()
  TR.Debug.Reset()
  try {
    await withTaoFiles('tao-lexical-actions-', {
      'Main.tao': `
        use Run, Recover, Otherwise, CheckExit, GuardExit, Inline, Detached, Sync from ./Actions
        app Demo { id "com.tao.lexical" version "1.0.0" name "Lexical" view Main }
        view Main() {
          render inject Run, Recover, Otherwise, CheckExit, GuardExit, Inline, Detached, Sync
            \`\`\`ts
              void Run; void Recover; void Otherwise; void CheckExit; void GuardExit; void Inline; void Detached; void Sync
              return null
            \`\`\`
        }
      `,
      'Actions.tao': authoredActions,
      'Native.ts': `
        type Probe = { register(label: string): void; suspend(): Promise<void>; mark(label: string): void }
        let probe: Probe
        export function Configure(value: Probe): void { probe = value }
        export function Register(label: string): void { probe.register(label) }
        export function Suspend(): Promise<void> { return probe.suspend() }
        export function Mark(label: string): void { probe.mark(label) }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'], { debug })
      const output = FS.resolvePath('output', root)
      for (const file of compiled.files) {
        await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
      }
      await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
      const config = FS.resolvePath('tsconfig.json', root)
      await FS.writeJson(config, {
        extends: Repo.resolvePath('packages/tsconfig.base.json'),
        compilerOptions: {
          allowImportingTsExtensions: true,
          composite: false,
          declaration: false,
          incremental: false,
          jsx: 'react-jsx',
          lib: ['ES2023', 'DOM'],
          noEmit: true,
          rootDir: '/',
          typeRoots: [Repo.resolvePath('node_modules/@types')],
          types: ['bun', 'node'],
        },
        include: [`${output}/**/*.ts`, `${output}/**/*.tsx`],
      })
      const checked = await CLI.run('bun', {
        args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
      })
      Assert(checked.exitCode === 0, 'compiled lexical action graph typechecks', {
        stdout: checked.stdout,
        stderr: checked.stderr,
      })
      const actionModule = compiled.files.find(file =>
        file.sourcePath === paths['Actions.tao'] && file.relativePath.endsWith('.tsx')
      )
      const nativeModule = compiled.files.find(file => file.sourcePath === paths['Native.ts'])
      Assert.defined(actionModule, 'authored public actions are emitted')
      Assert.defined(nativeModule, 'foreign action implementation is copied')
      const native = await import(FS.resolvePath(nativeModule.relativePath, output))
      const actions = await import(FS.resolvePath(actionModule.relativePath, output))
      await test(actions, native)
    })
  } finally {
    TR.Debug.Reset()
    await settleActionRoots()
    released.resolve()
  }
}
