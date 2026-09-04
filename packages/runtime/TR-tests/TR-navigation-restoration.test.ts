import { Describe, Expect, Test } from '@shared/test'
import TR from '../TaoRuntime-src/TR'
import { memoryDataProvider, memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import type { TaoNavigationArguments } from '../TaoRuntime-src/TR-navigation'
import type { TaoDeclarationIdentityTuple } from '../TaoRuntime-src/TR-navigation-identity'
import { RuntimeStackNav } from '../TaoRuntime-src/TR-navigation-mounts'
import {
  type NavigationRestorationDiagnostic,
  setNavigationPreviewScope,
  setNavigationRestorationStorageForTests,
  subscribeNavigationRestorationDiagnostics,
} from '../TaoRuntime-src/TR-navigation-restoration'

function identity(kind: string, name: string) {
  return TR.Navigation.Identity([
    'tao.declaration',
    1,
    'navigation-restoration-test',
    '@workspace',
    'App',
    kind,
    name,
  ] as TaoDeclarationIdentityTuple)
}

function runtimeApp(
  variant: string,
  options: { exclusions?: readonly ('menus' | 'sheets' | 'toasts')[]; mode?: 'automatic' | 'fresh' } = {},
) {
  const home = TR.Navigation.View({ identity: identity('view', 'Home'), name: 'Home', render: () => null })
  const detail = TR.Navigation.View({ identity: identity('view', 'Detail'), name: 'Detail', render: () => null })
  const stack = TR.Navigation.Declaration('Stack', TR.NavKind.Stack(), identity('nav', 'Stack'))
  const app = TR.Navigation.App({
    auxiliaries: () => ({}),
    declaration: TR.Navigation.AppDeclaration('RestoreApp', identity('app', 'RestoreApp')),
    name: 'RestoreApp',
    navigator: () => TR.Navigation.Configure(stack, { Initial: home }),
    restoration: {
      exclusions: options.exclusions ?? [],
      mode: options.mode ?? 'automatic',
      variant,
    },
  })
  return { app, detail }
}

Describe('navigation restoration', () => {
  Test('round-trips stack entries and arguments through a relaunch', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      const first = runtimeApp('main')
      const detach = await first.app.attachRestoration()
      first.app.present(first.app.navigator, first.detail, { Message: TR.Value('restored') })
      await drainMicrotasks()
      detach()

      const second = runtimeApp('main')
      const detachSecond = await second.app.attachRestoration()
      Expect((second.app.navigator as RuntimeStackNav).depth).toBe(2)
      detachSecond()
    } finally {
      restoreStorage()
    }
  })

  /**
   * Two Studio scenarios of one app differ by fixture, and their stored stacks hold entity handles
   * for rows the other one does not have. On a device this is not hypothetical: one process renders
   * every cell it is assigned and keeps real device storage between them, so an unscoped key left a
   * scenario restoring the other's stack and failing to render at all.
   */
  Test("a preview scope keeps one cell from restoring another cell's stack", async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      setNavigationPreviewScope('cell:one')
      const first = runtimeApp('main')
      const detach = await first.app.attachRestoration()
      first.app.present(first.app.navigator, first.detail, { Message: TR.Value('from cell one') })
      await drainMicrotasks()
      detach()

      // The same app, a different cell: it must start where a fresh app starts.
      setNavigationPreviewScope('cell:two')
      const second = runtimeApp('main')
      const detachSecond = await second.app.attachRestoration()
      Expect((second.app.navigator as RuntimeStackNav).depth).toBe(1)
      detachSecond()

      // Returning to the first cell finds its own stack where it left it.
      setNavigationPreviewScope('cell:one')
      const third = runtimeApp('main')
      const detachThird = await third.app.attachRestoration()
      Expect((third.app.navigator as RuntimeStackNav).depth).toBe(2)
      detachThird()
    } finally {
      setNavigationPreviewScope(undefined)
      restoreStorage()
    }
  })

  Test('falls back as one whole app on a schema-version mismatch and emits a tooling diagnostic', async () => {
    const values = new Map<string, string>()
    const diagnostics: NavigationRestorationDiagnostic[] = []
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    const unsubscribe = subscribeNavigationRestorationDiagnostics(diagnostic => diagnostics.push(diagnostic))
    try {
      const first = runtimeApp('main')
      const detach = await first.app.attachRestoration()
      first.app.present(first.app.navigator, first.detail, {})
      await drainMicrotasks()
      detach()
      const [key, serialized] = [...values.entries()][0]!
      values.set(key, JSON.stringify({ ...JSON.parse(serialized), schemaVersion: 999 }))

      const second = runtimeApp('main')
      const detachSecond = await second.app.attachRestoration()
      Expect((second.app.navigator as RuntimeStackNav).depth).toBe(1)
      Expect(diagnostics.some(diagnostic => diagnostic.code === 'NAV_RESTORE_FALLBACK')).toBe(true)
      detachSecond()
    } finally {
      unsubscribe()
      restoreStorage()
    }
  })

  Test('retries an identical snapshot the device refused rather than treating it as already stored', async () => {
    const values = new Map<string, string>()
    const attempts: string[] = []
    const diagnostics: NavigationRestorationDiagnostic[] = []
    const restoreStorage = setNavigationRestorationStorageForTests({
      getItem: key => Promise.resolve(values.get(key) ?? null),
      setItem: async (key, value) => {
        attempts.push(value)
        // One transient refusal, of the kind a full or briefly unavailable device gives.
        if (attempts.length === 1) {
          throw new UnexpectedBehaviorError('The device refused this write.')
        }
        values.set(key, value)
      },
    })
    const unsubscribe = subscribeNavigationRestorationDiagnostics(diagnostic => diagnostics.push(diagnostic))
    try {
      const { app, detail } = runtimeApp('transient', { exclusions: ['sheets'] })
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, {})
      await drainMicrotasks()
      Expect(attempts).toHaveLength(1)
      Expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(['NAV_RESTORE_FALLBACK'])
      Expect([...values.values()]).toEqual([])

      // An excluded sheet leaves the stored position exactly as it was, so the next snapshot is
      // byte-identical to the one the device refused. It has to be written, not skipped.
      app.presentOverlay(app.navigator, detail, {}, { sheet: true })
      await drainMicrotasks()
      Expect(attempts).toHaveLength(2)
      Expect(attempts[1]).toBe(attempts[0])
      detach()

      // The device now really holds the position, so the next launch reads it back.
      const relaunched = runtimeApp('transient', { exclusions: ['sheets'] })
      const detachRelaunched = await relaunched.app.attachRestoration()
      Expect((relaunched.app.navigator as RuntimeStackNav).depth).toBe(2)
      detachRelaunched()
    } finally {
      unsubscribe()
      restoreStorage()
    }
  })

  Test('keys snapshots by app variant so preview and production bindings remain isolated', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      const production = runtimeApp('production')
      const detachProduction = await production.app.attachRestoration()
      production.app.present(production.app.navigator, production.detail, {})
      await drainMicrotasks()
      detachProduction()

      const preview = runtimeApp('preview')
      const detachPreview = await preview.app.attachRestoration()
      Expect((preview.app.navigator as RuntimeStackNav).depth).toBe(1)
      detachPreview()
    } finally {
      restoreStorage()
    }
  })

  Test('Restore fresh neither reads nor writes host storage', async () => {
    let reads = 0
    let writes = 0
    const restoreStorage = setNavigationRestorationStorageForTests({
      async getItem() {
        reads += 1
        return null
      },
      async setItem() {
        writes += 1
      },
    })
    try {
      const fresh = runtimeApp('test', { mode: 'fresh' })
      const detach = await fresh.app.attachRestoration()
      fresh.app.present(fresh.app.navigator, fresh.detail, {})
      await drainMicrotasks()
      Expect(reads).toBe(0)
      Expect(writes).toBe(0)
      detach()
    } finally {
      restoreStorage()
    }
  })

  Test('skips a presentation whose action argument cannot serialize', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      const first = runtimeApp('actions')
      const detach = await first.app.attachRestoration()
      first.app.present(first.app.navigator, first.detail, { Callback: TR.Action(() => {}) })
      await drainMicrotasks()
      detach()

      const second = runtimeApp('actions')
      const detachSecond = await second.app.attachRestoration()
      Expect((second.app.navigator as RuntimeStackNav).depth).toBe(1)
      detachSecond()
    } finally {
      restoreStorage()
    }
  })

  Test('restores an entity argument as a live missing handle instead of a stale row snapshot', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      const providerDeclaration = TR.Data.Declaration(
        'EntityMemory',
        memoryProvider(),
        identity('datasource', 'EntityMemory'),
      )
      const schema = TR.Data.Schema({
        name: 'RestorationEntities',
        schemaVersion: 1,
        entities: {
          Note: {
            collection: 'Notes',
            fields: { Title: { kind: 'text' } },
          },
        },
      })
      TR.Data.BindConfigured(schema, TR.Data.Configure(providerDeclaration, {}))
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Temporary') })
      const row = schema.query({ entity: 'Note', filters: [] })[0]

      let restoredRow: unknown
      const home = TR.Navigation.View({
        identity: identity('view', 'EntityHome'),
        name: 'EntityHome',
        render: () => null,
      })
      const detail = TR.Navigation.View({
        identity: identity('view', 'EntityDetail'),
        name: 'EntityDetail',
        render: arguments_ => {
          restoredRow = arguments_['Row']?.evaluate().jsValue
          return null
        },
      })
      const stack = TR.Navigation.Declaration('EntityStack', TR.NavKind.Stack(), identity('nav', 'EntityStack'))
      const createApp = () =>
        TR.Navigation.App({
          auxiliaries: () => ({}),
          declaration: TR.Navigation.AppDeclaration('EntityApp', identity('app', 'EntityApp')),
          name: 'EntityApp',
          navigator: () => TR.Navigation.Configure(stack, { Initial: home }),
          restoration: { exclusions: [], mode: 'automatic', variant: 'entity' },
        })

      const first = createApp()
      const detach = await first.attachRestoration()
      first.present(first.navigator, detail, { Row: TR.Value(row) })
      await drainMicrotasks()
      detach()

      // A fresh store under the same declaration binding: the restored token matches the
      // provider identity while the row itself is gone.
      schema.configure(
        memoryProvider().connect({
          configuration: {},
          schema: schema.definition,
          storageKey: schema.definition.name,
        }),
        { configuration: {}, declaration: providerDeclaration },
      )
      const second = createApp()
      const detachSecond = await second.attachRestoration()
      const restoredEntries = (second.navigator as unknown as {
        entries: Array<{ arguments: TaoNavigationArguments }>
      }).entries
      restoredRow = restoredEntries[1]?.arguments['Row']?.evaluate().jsValue
      Expect(TR.Data.EntityAvailability(restoredRow)).toEqual({ status: 'missing' })
      detachSecond()
    } finally {
      restoreStorage()
    }
  })
})

// Restoration needs the optional reference capability the shared memory provider deliberately omits.
function memoryProvider(): TR.DataProvider {
  const snapshots = memoryDataProvider()
  return {
    connect: context => ({
      ...snapshots.connect(context),
      referenceToken: reference => reference.id,
      resolveReference: reference => reference.token,
    }),
  }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>(resolve => queueMicrotask(resolve))
}
