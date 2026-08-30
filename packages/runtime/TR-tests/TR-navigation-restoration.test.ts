import { Describe, Expect, Test } from '@shared/test'
import TR from '../TaoRuntime-src/TR'
import type { TaoKeyValueStorage } from '../TaoRuntime-src/TR-data'
import type { TaoNavigationArguments } from '../TaoRuntime-src/TR-navigation'
import type { TaoDeclarationIdentityTuple } from '../TaoRuntime-src/TR-navigation-identity'
import { RuntimeStackNav } from '../TaoRuntime-src/TR-navigation-mounts'
import {
  type NavigationRestorationDiagnostic,
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
  options: { mode?: 'automatic' | 'fresh' } = {},
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
      exclusions: [],
      mode: options.mode ?? 'automatic',
      variant,
    },
  })
  return { app, detail }
}

Describe('navigation restoration', () => {
  Test('round-trips stack entries and arguments through a relaunch', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(mapStorage(values))
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

  Test('falls back as one whole app on a schema-version mismatch and emits a tooling diagnostic', async () => {
    const values = new Map<string, string>()
    const diagnostics: NavigationRestorationDiagnostic[] = []
    const restoreStorage = setNavigationRestorationStorageForTests(mapStorage(values))
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

  Test('keys snapshots by app variant so preview and production bindings remain isolated', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(mapStorage(values))
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
    const restoreStorage = setNavigationRestorationStorageForTests(mapStorage(values))
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
    const restoreStorage = setNavigationRestorationStorageForTests(mapStorage(values))
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

function memoryProvider(): TR.DataProvider {
  const snapshots = new Map<string, string>()
  return {
    connect: ({ storageKey }) => ({
      load: () => snapshots.get(storageKey),
      referenceToken: reference => reference.id,
      resolveReference: reference => reference.token,
      save: snapshot => {
        snapshots.set(storageKey, snapshot)
      },
    }),
  }
}

function mapStorage(values: Map<string, string>): TaoKeyValueStorage {
  return {
    async getItem(key) {
      return values.get(key) ?? null
    },
    async setItem(key, value) {
      values.set(key, value)
    },
  }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>(resolve => queueMicrotask(resolve))
}
