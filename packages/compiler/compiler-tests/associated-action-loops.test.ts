import { Assert, CLI, FS, Repo } from '@shared'
import { Deferred, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace'

const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
const { settleActionRoots } = await import(
  Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts')
)

let runtimeFixture: Promise<void> = Promise.resolve()

Describe('compiler: associated action loops', () => {
  Test(
    'snapshots membership once, preserves item identity, joins iterations, and drains return or failure cleanup',
    async () => {
      await withCompiledFixture(async ({ actions, configure, events, collectionReads, seenItems }) => {
        const first = { Name: 'first' }
        const second = { Name: 'second' }
        const members = [first, second]
        configure({ members })

        await TR.Do(actions['Visit'])
        Expect(events()).toEqual(['item:first', 'item:second'])
        Expect(collectionReads()).toBe(1)
        Expect(seenItems()).toEqual([first, second])

        const returned = await TR.DoResult(actions['StopAt'], TR.Value(['one', 'target', 'later']))
        Expect(returned.evaluate().jsValue).toBe('target')
        Expect(events()).toEqual([
          'item:first',
          'item:second',
          'enter:one',
          'cleanup:one',
          'enter:target',
          'cleanup:target',
        ])

        events().length = 0
        const entered = Deferred()
        const release = Deferred()
        configure({
          members,
          suspend() {
            events().push('suspended')
            entered.resolve()
            return release.promise
          },
        })
        const pending = Promise.resolve(TR.Do(
          actions['HandleFailure'],
          TR.Value(['first', 'later']),
        ))
        try {
          await Promise.race([
            entered.promise,
            pending.then(() => Assert(false, 'the first iteration reaches its gate before completion')),
          ])
          Expect(events()).toEqual(['enter:first', 'suspended'])
          release.resolve()
          await pending
          Expect(events()).toEqual([
            'enter:first',
            'suspended',
            'cleanup:first',
            'handled',
            'caller-tail',
          ])
        } finally {
          release.resolve()
          await pending
        }
      })
    },
  )
})

async function withCompiledFixture(
  test: (fixture: {
    actions: Record<string, any>
    configure(value: { members: Array<{ Name: string }>; suspend?: () => Promise<void> }): void
    events(): string[]
    collectionReads(): number
    seenItems(): Array<{ Name: string }>
  }) => Promise<void>,
): Promise<void> {
  const previous = runtimeFixture
  const released = Deferred()
  runtimeFixture = released.promise
  await previous
  await settleActionRoots()
  TR.Debug.Reset()
  try {
    await withTaoFiles('tao-associated-action-loops-', {
      'Main.tao': `
        use Visit, StopAt, HandleFailure from ./Actions
        app ActionLoops { id "com.tao.actionloops" version "1.0.0" name "Action loops" view Main }
        view Main() { render Empty() }
        view Empty() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Actions.tao': `
        type Failure is one of Offline
        type Item is { Name text }
        public action Observe(Label text) from ./Native.ts
        public action ObserveItem(Value Item) from ./Native.ts
        public action Append() from ./Native.ts
        public action Suspend() from ./Native.ts
        public function ItemList() returns list of Item { return ItemList() from ./Native.ts }
        public action Visit() {
          loop ItemList() / Item {
            do ObserveItem(Item)
            if Item.Name == "first" { do Append() }
          }
        }
        public action StopAt(Items list of text) {
          loop Items / Item {
            defer { do Observe("cleanup:" + Item) }
            do Observe("enter:" + Item)
            if Item == "target" { return Item }
          }
          do Observe("loop-tail")
          return "none"
        }
        action FailInside(Items list of text) {
          loop Items / Item {
            defer { do Observe("cleanup:" + Item) }
            do Observe("enter:" + Item)
            do Suspend()
            fail Offline "loop failed"
            do Observe("body-tail")
          }
          do Observe("loop-tail")
        }
        public action HandleFailure(Items list of text) {
          do FailInside(Items) then {
            error -> { do Observe("handled") }
          }
          do Observe("caller-tail")
        }
      `,
      'Native.ts': `
        type Item = { Name: string }
        type Probe = { members: Item[]; suspend?: () => Promise<void> }
        const events: string[] = []
        const seen: Item[] = []
        let collectionReads = 0
        let probe: Probe = { members: [], suspend: () => Promise.resolve() }
        export function Configure(value: Probe): void { probe = value }
        export function Observe(label: string): void { events.push(label) }
        export function ObserveItem(item: Item): void { seen.push(item); events.push("item:" + item.Name) }
        export function Append(): void { probe.members.push({ Name: "late" }) }
        export function Suspend(): Promise<void> { return probe.suspend?.() ?? Promise.resolve() }
        export function ItemList(): Item[] { collectionReads += 1; return probe.members }
        export function Events(): string[] { return events }
        export function CollectionReads(): number { return collectionReads }
        export function SeenItems(): Item[] { return seen }
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
      Assert(checked.exitCode === 0, 'compiled action loop graph typechecks', {
        stdout: checked.stdout,
        stderr: checked.stderr,
      })

      const actionModule = compiled.files.find(file =>
        file.sourcePath === paths['Actions.tao'] && file.relativePath.endsWith('.tsx')
      )
      const nativeModule = compiled.files.find(file => file.sourcePath === paths['Native.ts'])
      Assert.defined(actionModule, 'the authored action loops are emitted as a TSX module')
      Assert.defined(nativeModule, 'the loop probe sidecar is copied')
      const actions = await import(FS.resolvePath(actionModule.relativePath, output))
      const native = await import(FS.resolvePath(nativeModule.relativePath, output))
      await test({
        actions,
        configure: native.Configure,
        events: native.Events,
        collectionReads: native.CollectionReads,
        seenItems: native.SeenItems,
      })
    })
  } finally {
    TR.Debug.Reset()
    await settleActionRoots()
    released.resolve()
  }
}
