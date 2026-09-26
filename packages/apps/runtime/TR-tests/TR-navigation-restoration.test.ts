import { Describe, Expect, Test } from '@shared/test'
import TR from '../TaoRuntime-src/TR'
import type { TaoAppDatasourceBinding } from '../TaoRuntime-src/TR-data'
import { memoryDataProvider, memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import type { TaoNavigationArguments } from '../TaoRuntime-src/TR-navigation'
import type { TaoDeclarationIdentityTuple } from '../TaoRuntime-src/TR-navigation-identity'
import { RuntimeStackNav } from '../TaoRuntime-src/TR-navigation-mounts'
import {
  beginNavigationPreviewCell,
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
  options: {
    datasources?: () => readonly TaoAppDatasourceBinding[]
    exclusions?: readonly ('menus' | 'sheets' | 'toasts')[]
    mode?: 'automatic' | 'fresh'
  } = {},
) {
  const home = TR.Navigation.View({ identity: identity('view', 'Home'), name: 'Home', render: () => null })
  const detail = TR.Navigation.View({ identity: identity('view', 'Detail'), name: 'Detail', render: () => null })
  const stack = TR.Navigation.Declaration('Stack', TR.NavKind.Stack(), identity('nav', 'Stack'))
  const app = TR.Navigation.App({
    auxiliaries: () => ({}),
    ...(options.datasources ? { datasources: options.datasources } : {}),
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
  Test('passes each mounted auth scope into lazy navigator and auxiliary configuration', () => {
    const scopes: Array<TR.AuthScope | undefined> = []
    const home = TR.Navigation.View({
      identity: identity('view', 'ScopedHome'),
      name: 'ScopedHome',
      render: () => null,
    })
    const stack = TR.Navigation.Declaration('ScopedStack', TR.NavKind.Stack(), identity('nav', 'ScopedStack'))
    const declared = TR.Navigation.App({
      name: 'ScopedCallbacks',
      navigator: scope => {
        scopes.push(scope)
        return TR.Navigation.Configure(stack, { Initial: home })
      },
      auxiliaries: scope => {
        scopes.push(scope)
        return {}
      },
    })
    const first = TR.Auth.CreateScope()
    const second = TR.Auth.CreateScope()
    const firstApp = first.app(declared)
    const secondApp = second.app(declared)
    void firstApp.navigator
    void firstApp.auxiliaries
    void secondApp.navigator
    void secondApp.auxiliaries
    Expect(scopes).toEqual([first, first, second, second])
    first.dispose()
    second.dispose()
    declared.dispose()
  })

  Test(
    'restores entity arguments in the destination mount when accounts and datasource declarations match',
    async () => {
      const source = TR.Auth.Configure(
        TR.Auth.Declaration('Auth', {
          connect: () => ({
            capabilities: { methods: ['Password'] },
            restore: async () => ({
              state: 'SignedIn' as const,
              identity: { accountId: 'same-account', issuer: 'test', subject: 'alice' },
            }),
            signIn: async () => ({ outcome: { status: 'cancelled' as const } }),
            signOut: async () => ({ status: 'completed' as const }),
            credential: async () => ({ audience: 'unused', value: 'unused' }),
          }),
        }),
        {},
      )
      const firstScope = TR.Auth.CreateScope(source)
      const secondScope = TR.Auth.CreateScope(source)
      await Promise.all([firstScope.restore(), secondScope.restore()])
      const schema = TR.Data.Schema({
        name: 'ScopedRestore',
        entities: {
          Account: {
            collection: 'Accounts',
            fields: { Name: { kind: 'text' } },
            grants: [{ operations: ['read'], principal: [] }],
          },
        },
      })
      const provider = TR.Data.Declaration('ScopedMemory', {
        authenticatedAuthority: 'server',
        connect: context => ({
          load: () =>
            JSON.stringify({
              formatVersion: 1,
              schemaVersion: 1,
              nextId: 1,
              rows: { Account: [{ Id: 'same-account', Name: context.configuration['Name'] }] },
            }),
          save: () => undefined,
          referenceToken: reference => reference.id,
          resolveReference: reference => reference.token,
        }),
      }, identity('datasource', 'ScopedMemory'))
      firstScope.bindDatasources([{ store: schema, source: TR.Data.Configure(provider, { Name: 'First mount' }) }])
      secondScope.bindDatasources([{ store: schema, source: TR.Data.Configure(provider, { Name: 'Second mount' }) }])
      const declared = runtimeApp('scoped-reference')
      const firstApp = firstScope.app(declared.app)
      const secondApp = secondScope.app(declared.app)
      Expect(firstApp).not.toBe(secondApp)
      secondApp.present(secondApp.navigator, declared.detail, {
        Row: TR.Value(secondScope.store(schema).entity('Account', 'same-account')),
      })
      const captured = secondApp.captureNavigation()
      secondApp.restoreNavigation(captured)
      const entries =
        (secondApp.navigator as unknown as { entries: Array<{ arguments: TaoNavigationArguments }> }).entries
      const restored = entries[1]!.arguments['Row']!.evaluate().jsValue
      Expect(TR.Data.Read(restored, 'Name')).toBe('Second mount')
      firstScope.dispose()
      Expect(TR.Data.EntityAvailability(restored)).toEqual({ status: 'available' })
      Expect(TR.Data.Read(restored, 'Name')).toBe('Second mount')
      secondScope.dispose()
      declared.app.dispose()
    },
  )

  Test('keeps private scalar route arguments out of another account and resets navigation on logout', async () => {
    const storage = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(storage))
    const scopeFor = async (accountId: string) => {
      const scope = TR.Auth.CreateScope(TR.Auth.Configure(
        TR.Auth.Declaration('Auth', {
          connect: () => ({
            capabilities: { methods: [] },
            restore: async () => ({
              state: 'SignedIn' as const,
              identity: { accountId, issuer: 'test', subject: accountId },
            }),
            signIn: async () => ({ outcome: { status: 'cancelled' as const } }),
            signOut: async () => ({ status: 'completed' as const }),
            credential: async () => ({ audience: 'unused', value: 'unused' }),
          }),
        }),
        {},
      ))
      await scope.restore()
      return scope
    }
    const alice = await scopeFor('alice')
    const bob = await scopeFor('bob')
    const returnedAlice = await scopeFor('alice')
    const declared = runtimeApp('private-scalar')
    try {
      const first = alice.app(declared.app)
      const detach = await first.attachRestoration()
      first.present(first.navigator, declared.detail, { Message: TR.Value('Alice private route') })
      await drainMicrotasks()
      detach()
      const second = bob.app(declared.app)
      const detachBob = await second.attachRestoration()
      Expect((second.navigator as RuntimeStackNav).depth).toBe(1)
      detachBob()
      const returned = returnedAlice.app(declared.app)
      const detachAlice = await returned.attachRestoration()
      Expect((returned.navigator as RuntimeStackNav).depth).toBe(2)
      await returnedAlice.signOut()
      Expect((returned.navigator as RuntimeStackNav).depth).toBe(1)
      detachAlice()
    } finally {
      alice.dispose()
      bob.dispose()
      returnedAlice.dispose()
      declared.app.dispose()
      restoreStorage()
    }
  })

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

  Test('starts each preview cell from the store, on the one app definition a device reuses', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      // One app definition for every cell: the compiler emits it once at module scope, and a device
      // is assigned cell after cell in that same process. Building a second one here would hide the
      // defect entirely — the mounted navigation, not the stored position, is what leaked.
      const { app, detail } = runtimeApp('main')

      beginNavigationPreviewCell('cell:one')
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, { Message: TR.Value('from cell one') })
      await drainMicrotasks()
      Expect((app.navigator as RuntimeStackNav).depth).toBe(2)

      // A different cell is a different launch. Its fixture replaces the provider generation the
      // stack above holds handles from, so it has to open where a fresh app opens.
      app.reset()
      beginNavigationPreviewCell('cell:two')
      const detachSecond = await app.attachRestoration()
      Expect((app.navigator as RuntimeStackNav).depth).toBe(1)

      // The late detach of a launch this one replaced must not decrement the live count. A host
      // detaches on its own schedule, so this arrives after the relaunch; counted, it would leave
      // the running cell unsubscribed and every later cell persisting nothing at all.
      detach()
      app.present(app.navigator, detail, { Message: TR.Value('recorded in cell two') })
      await drainMicrotasks()
      detachSecond()

      app.reset()
      beginNavigationPreviewCell('cell:two')
      const detachThird = await app.attachRestoration()
      Expect((app.navigator as RuntimeStackNav).depth).toBe(2)
      detachThird()

      // And the first cell still finds its own stack, which is what the scoping is for.
      app.reset()
      beginNavigationPreviewCell('cell:one')
      const detachFourth = await app.attachRestoration()
      Expect((app.navigator as RuntimeStackNav).depth).toBe(2)
      detachFourth()
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

  Test('keys snapshots by every store an app mounts, and not at all when one cannot be represented', async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      const store = TR.Data.Schema({ name: 'RestorationStores', schemaVersion: 1, entities: {} })
      const feed = TR.Data.Declaration('Feed', memoryProvider(), identity('datasource', 'Feed'))
      const personal = TR.Data.Declaration('Personal', memoryProvider(), identity('datasource', 'Personal'))
      const bindings = (): readonly TaoAppDatasourceBinding[] => [
        { source: TR.Data.Configure(feed, {}), storageName: 'Feed', store },
        { source: TR.Data.Configure(personal, {}), storageName: 'Personal', store },
      ]

      const first = runtimeApp('stores', { datasources: bindings })
      const detach = await first.app.attachRestoration()
      first.app.present(first.app.navigator, first.detail, {})
      await drainMicrotasks()
      detach()

      // A variant that inherits the same bindings restores the same position.
      const inherited = runtimeApp('stores', { datasources: () => TR.Data.PatchBindings(bindings(), [[], []]) })
      const detachInherited = await inherited.app.attachRestoration()
      Expect((inherited.app.navigator as RuntimeStackNav).depth).toBe(2)
      detachInherited()

      // Reconfiguring one member of the set starts afresh rather than restoring into other data.
      const patched = runtimeApp('stores', {
        datasources: () => TR.Data.PatchBindings(bindings(), [[], [{ StorageKey: TR.Value('elsewhere') }]]),
      })
      const detachPatched = await patched.app.attachRestoration()
      Expect((patched.app.navigator as RuntimeStackNav).depth).toBe(1)
      detachPatched()

      const written = values.size
      const unidentified = TR.Data.Declaration('Unidentified', memoryProvider())
      const unkeyed = runtimeApp('stores', {
        datasources: () => [...bindings(), { source: TR.Data.Configure(unidentified, {}), store }],
      })
      const detachUnkeyed = await unkeyed.app.attachRestoration()
      unkeyed.app.present(unkeyed.app.navigator, unkeyed.detail, {})
      await drainMicrotasks()
      Expect(values.size).toBe(written)
      detachUnkeyed()
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
