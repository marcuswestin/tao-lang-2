import { Assert, CLI, FS, Repo } from '@shared'
import { Deferred, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace'

const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
const { settleActionRoots } = await import(
  Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts')
)

let runtimeFixture: Promise<void> = Promise.resolve()

Describe('compiler: action when', () => {
  Test('emits an atomic press handler in a strictly checked application graph', async () => {
    await withCompiledFixture(async ({ appCode }) => {
      const code = appCode.replace(/\s+/g, ' ')
      Expect(code).toContain('await TR.WhenAll(')
      Expect(code).toContain('["true", async _TaoCasePayload =>')
      Expect(code).toContain('["false", async _TaoCasePayload =>')
      Expect(code).toContain('TR.Set(_Scope.GroupMode, () => TR.Value(false))')
    })
  })

  Test('returns from a matching body after its cleanup and preserves nonmatching fallthrough', async () => {
    await withCompiledFixture(async ({ actions, events }) => {
      const chosen = await TR.DoResult(actions['Choose'], TR.Value(true))
      Expect(chosen.evaluate().jsValue).toBe('chosen')
      Expect(events).toEqual(['return-cleanup'])

      events.length = 0
      const fallthrough = await TR.DoResult(actions['Choose'], TR.Value(false))
      Expect(fallthrough.evaluate().jsValue).toBe('fallthrough')
      Expect(events).toEqual(['after-when', 'return-cleanup'])
    })
  })

  Test('cleans up after a source failure following an unmatched case', async () => {
    await withCompiledFixture(async ({ actions, events }) => {
      await actions['FailThroughWhen'].jsValue.invoke(TR.Value(false))
      Expect(events).toEqual(['failure-cleanup', 'handled-failure', 'caller-tail'])
    })
  })

  Test('joins a gated matching branch cleanup before its failure handler and caller tail', async () => {
    await withCompiledFixture(async ({ actions, configure, events }) => {
      const branchStarted = Deferred()
      const releaseBranch = Deferred()
      configure({
        suspend() {
          events.push('suspend-start')
          branchStarted.resolve()
          return releaseBranch.promise
        },
      })
      const pending = Promise.resolve(actions['HandleBranchFailure'].jsValue.invoke())
      try {
        await started(branchStarted, pending)
        Expect(events).toEqual(['suspend-start'])
        releaseBranch.resolve()
        await pending
        Expect(events).toEqual([
          'suspend-start',
          'branch-cleanup',
          'handled-branch-failure',
          'caller-tail',
        ])
      } finally {
        releaseBranch.resolve()
        await pending
      }
    })
  })
})

async function started(gate: Deferred, completion: Promise<void>): Promise<void> {
  await Promise.race([
    gate.promise,
    completion.then(() => {
      Assert(false, 'the selected branch reached its gate before completing')
    }),
  ])
}

async function withCompiledFixture(
  test: (fixture: {
    appCode: string
    actions: Record<string, any>
    configure(probe: { suspend(): Promise<void> }): void
    events: string[]
  }) => Promise<void>,
): Promise<void> {
  const previous = runtimeFixture
  const released = Deferred()
  runtimeFixture = released.promise
  await previous
  await settleActionRoots()
  TR.Debug.Reset()
  try {
    await withTaoFiles('tao-action-when-', {
      'Main.tao': `
        use Button from @tao/ui
        use Observe from ./Actions
        app Demo { id "com.tao.action-when" version "1.0.0" name "Action when" view Main }
        view Main() {
          state GroupMode is boolean = true
          render Button("Group") {
            on press -> when GroupMode {
              yes -> { set GroupMode = false do Observe("yes") }
              no -> { do Observe("no") }
            }
          }
        }
      `,
      'Actions.tao': `
        type Failure is one of Offline
        public action Observe(Label text) from ./Native.ts
        action Suspend() from ./Native.ts
        action Failing() { fail Offline "primary" }
        public action Choose(Mode boolean) {
          defer { do Observe("return-cleanup") }
          when Mode {
            yes -> { return "chosen" }
          }
          do Observe("after-when")
          return "fallthrough"
        }
        public action FailAfterWhen(Mode boolean) {
          defer { do Observe("failure-cleanup") }
          when Mode {
            yes -> { do Observe("matched") }
          }
          do Failing()
        }
        public action FailThroughWhen(Mode boolean) {
          do FailAfterWhen(Mode) then {
            error -> { do Observe("handled-failure") }
          }
          do Observe("caller-tail")
        }
        action FailInsideWhen(Mode boolean) {
          when Mode {
            yes -> {
              defer { do Observe("branch-cleanup") }
              do Suspend()
              do Failing()
              do Observe("body-tail")
            }
            no -> { do Observe("no-body") }
            otherwise -> { do Observe("otherwise") }
          }
          do Observe("outer-when-tail")
        }
        public action HandleBranchFailure() {
          do FailInsideWhen(true) then {
            error -> { do Observe("handled-branch-failure") }
          }
          do Observe("caller-tail")
        }
      `,
      'Native.ts': `
        type Probe = { suspend(): Promise<void> }
        const events: string[] = []
        let probe: Probe = { suspend: () => Promise.resolve() }
        export function Configure(value: Probe): void { probe = value }
        export function Observe(label: string): void { events.push(label) }
        export function Suspend(): Promise<void> { return probe.suspend() }
        export function Events(): string[] { return events }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      const output = FS.resolvePath('output', root)
      for (const file of compiled.files) {
        await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
      }
      await FS.symlink(
        Repo.resolvePath('packages/apps/expo-host/node_modules'),
        FS.resolvePath('node_modules', root),
      )
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
      Assert(checked.exitCode === 0, 'compiled action when graph typechecks', {
        stdout: checked.stdout,
        stderr: checked.stderr,
      })

      const appModule = compiled.files.find(file =>
        file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
      )
      const actionModule = compiled.files.find(file =>
        file.sourcePath === paths['Actions.tao'] && file.relativePath.endsWith('.tsx')
      )
      const nativeModule = compiled.files.find(file => file.sourcePath === paths['Native.ts'])
      Assert.defined(appModule, 'the authored app is emitted as a TSX module')
      Assert.defined(actionModule, 'the authored source actions are emitted as a TSX module')
      Assert.defined(nativeModule, 'the foreign observation function is copied')
      const actions = await import(FS.resolvePath(actionModule.relativePath, output))
      const native = await import(FS.resolvePath(nativeModule.relativePath, output))
      await test({ appCode: appModule.code, actions, configure: native.Configure, events: native.Events() })
    })
  } finally {
    TR.Debug.Reset()
    await settleActionRoots()
    released.resolve()
  }
}
