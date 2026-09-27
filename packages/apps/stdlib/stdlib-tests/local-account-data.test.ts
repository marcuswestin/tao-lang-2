import TR from '@runtime/TR'
import { Errors, FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until, withCapturedOutput } from '@shared/test'
import { TestAuthProvider } from '../@tao/auth/testing/TestAuth'
import { LocalProvider } from '../@tao/data/providers/local/Local'
import { MemoryProvider } from '../@tao/data/providers/memory/Memory'

const alice: TR.AuthIdentity = { accountId: 'a', issuer: 'issuer', subject: 'alice' }
const bob: TR.AuthIdentity = { accountId: 'b', issuer: 'issuer', subject: 'bob' }
const definition: TR.DataSchemaDefinition = {
  name: 'LocalData',
  entities: { Draft: { collection: 'Drafts', fields: { Body: { kind: 'text' } } } },
}

Describe('authenticated local-only persistence', () => {
  Test(
    'persists actual Local snapshots per app and full account identity, sealing signed-out reads and writes',
    async () => {
      const disk = await diskStorage()
      const mounted = mount(disk.storage)
      try {
        await mounted.scope.restore()
        Expect(bodies(mounted.store)).toEqual([])
        Expect(() => create(mounted.store, 'signed out')).toThrow('unauthorized')
        mounted.accept(alice)
        await mounted.store.settle()
        const first = create(mounted.store, 'Alice draft')
        Expect(() => mounted.store.withFixtureActor('a', () => undefined)).toThrow('require TestAuth')
        await mounted.store.settle()
        Expect(await disk.savedBodies()).toEqual([['Alice draft']])
        Expect(bodies(mounted.store)).toEqual(['Alice draft'])
        const aliceIdentity = mounted.store.captureIdentity()
        await mounted.scope.signOut()
        Expect(bodies(mounted.store)).toEqual([])
        Expect(() => TR.Data.Read(first, 'Body')).toThrow('inactive provider generation')
        Expect(() => TR.Data.Update(TR.Value(first), { Body: TR.Value('stale') })).toThrow()
        await mounted.signIn(bob)
        await mounted.store.settle()
        Expect(bodies(mounted.store)).toEqual([])
        Expect(mounted.store.captureIdentity()).not.toBe(aliceIdentity)
        create(mounted.store, 'Bob draft')
        await mounted.store.settle()
        await mounted.signIn(alice)
        await mounted.store.settle()
        Expect(bodies(mounted.store)).toEqual(['Alice draft'])
        mounted.scope.dispose()

        // Fresh provider and auth scope: bytes must be recovered from disk, not a retained store.
        for (
          const [identity, app, expected] of [
            [alice, 'app-a', ['Alice draft']],
            [bob, 'app-a', ['Bob draft']],
            [{ ...alice, issuer: 'other-issuer' }, 'app-a', []],
            [{ ...alice, subject: 'other-subject' }, 'app-a', []],
            [alice, 'app-b', []],
          ] as const
        ) {
          const next = mount(disk.storage, app)
          try {
            await next.scope.restore()
            next.accept(identity)
            await next.store.settle()
            Expect(bodies(next.store)).toEqual(expected)
          } finally {
            next.scope.dispose()
          }
        }
        // Local keeps device custody only: it resolves no account, so it cannot pair with a sign-in.
        Expect(LocalProvider(() => disk.storage).authenticate).toBeUndefined()
        const ordinary = mount(disk.storage, undefined, false)
        try {
          await ordinary.scope.restore()
          ordinary.accept(alice)
          await ordinary.store.settle()
          Expect(ordinary.scope.session.state).toBe('Error')
          Expect(ordinary.scope.session.message).toContain('must both declare sign-in pairing')
          Expect(() => create(ordinary.store, 'unpaired')).toThrow('unauthorized')
        } finally {
          ordinary.scope.dispose()
        }
      } finally {
        mounted.scope.dispose()
      }
    },
  )

  Test('drains both committed snapshots before same-account remount without blocking another account', async () => {
    const entered = Deferred<void>()
    const release = Deferred<void>()
    let writes = 0
    const disk = await diskStorage({
      beforeWrite: async () => {
        if (++writes === 1) {
          entered.resolve()
          await release.promise
        }
      },
    })
    const old = mount(disk.storage)
    const next = mount(disk.storage)
    const other = mount(disk.storage)
    let leaving: Promise<TR.AuthOutcome> | undefined
    try {
      await Promise.all([old.scope.restore(), next.scope.restore(), other.scope.restore()])
      old.accept(alice)
      await old.store.settle()
      create(old.store, 'Started')
      await until(() => entered.promise.then(() => true), { description: 'the first durable write to start' })
      create(old.store, 'Queued before logout')
      leaving = old.scope.signOut()
      Expect(bodies(old.store)).toEqual([])
      next.accept(alice)
      other.accept(bob)
      await until(async () => {
        await other.store.settle()
        return true
      }, { description: 'the other account to load independently' })
      Expect(bodies(other.store)).toEqual([])
      create(other.store, 'Other account')
      await other.store.settle()
      await settle()
      Expect(next.store.availability(next.store.entity('Draft', 'missing'))).toMatchObject({ status: 'loading' })
      release.resolve()
      await leaving
      await next.store.settle()
      Expect(bodies(next.store)).toEqual(['Started', 'Queued before logout'])
      create(next.store, 'New mount')
      await next.store.settle()
      old.scope.dispose()
      Expect(bodies(next.store)).toEqual(['Started', 'Queued before logout', 'New mount'])
      Expect((await disk.savedBodies()).sort((a, b) => a[0]!.localeCompare(b[0]!)))
        .toEqual([['Other account'], ['Started', 'Queued before logout', 'New mount']])
    } finally {
      release.resolve()
      await leaving
      old.scope.dispose()
      next.scope.dispose()
      other.scope.dispose()
    }
  })

  Test('discards an old account disk load completing after a direct account switch', async () => {
    const release = Deferred<void>()
    const entered = Deferred<void>()
    let holdReads = false
    const disk = await diskStorage({
      beforeRead: async key => {
        if (holdReads && key.includes('alice')) {
          entered.resolve()
          await release.promise
        }
      },
    })
    const seed = mount(disk.storage)
    const mounted = mount(disk.storage)
    let oldLoad: Promise<void> | undefined
    try {
      await seed.scope.restore()
      seed.accept(alice)
      await seed.store.settle()
      create(seed.store, 'Secret Alice draft')
      await seed.store.settle()
      seed.scope.dispose()
      holdReads = true
      await mounted.scope.restore()
      mounted.accept(alice)
      await until(() => entered.promise.then(() => true), { description: 'the delayed account read to start' })
      oldLoad = mounted.store.settle()
      mounted.accept(bob)
      await mounted.store.settle()
      create(mounted.store, 'Bob only')
      await mounted.store.settle()
      release.resolve()
      await oldLoad
      Expect(bodies(mounted.store)).toEqual(['Bob only'])
    } finally {
      release.resolve()
      await oldLoad
      seed.scope.dispose()
      mounted.scope.dispose()
    }
  })

  Test('preserves admitted local saves and rejects new work after invalidation', async () => {
    const entered = Deferred<void>()
    const release = Deferred<void>()
    const disk = await diskStorage({
      beforeWrite: async () => {
        entered.resolve()
        await release.promise
      },
    })
    const lifetime = new AbortController()
    const context = { configuration: {}, schema: definition, storageKey: 'shared-key' }
    const first = LocalProvider(() => disk.storage).connect(context)
    const stale = LocalProvider(() => disk.storage).connect({ ...context, signal: lifetime.signal })
    const writing = first.save('durable first')
    let queued: Promise<unknown> | undefined
    try {
      await until(() => entered.promise.then(() => true), { description: 'the first provider write to start' })
      queued = Promise.resolve(stale.save('admitted before logout'))
      lifetime.abort()
      const rejected = Promise.resolve(stale.save('must not persist')).catch(error => error)
      release.resolve()
      await writing
      await queued
      Expect(await rejected).toMatchObject({ message: 'This local data connection is no longer active.' })
      Expect(await first.load()).toBe('admitted before logout')
    } finally {
      release.resolve()
      await Promise.allSettled([writing, queued])
      first.close?.()
      stale.close?.()
    }
  })

  Test('rejects an uncommitted local action after its account switches', async () => {
    const disk = await diskStorage()
    const mounted = mount(disk.storage)
    const release = Deferred<void>()
    const failures: unknown[] = []
    const stop = TR.Errors.onUnowned(error => failures.push(error))
    let pending: ReturnType<typeof TR.Do> = undefined
    try {
      await mounted.scope.restore()
      mounted.accept(alice)
      await mounted.store.settle()
      create(mounted.store, 'Committed Alice draft')
      await mounted.store.settle()
      pending = TR.Do(TR.Action(async () => {
        create(mounted.store, 'Uncommitted draft')
        await release.promise
      }))
      mounted.accept(bob)
      release.resolve()
      await pending
      await mounted.store.settle()
      Expect(failures).toHaveLength(1)
      Expect(String(failures[0])).toContain('no longer active')
      Expect(bodies(mounted.store)).toEqual([])
      mounted.accept(alice)
      await mounted.store.settle()
      Expect(bodies(mounted.store)).toEqual(['Committed Alice draft'])
      Expect(await disk.savedBodies()).toEqual([['Committed Alice draft']])
    } finally {
      release.resolve()
      await pending
      stop()
      mounted.scope.dispose()
    }
  })

  Test('a rejected late save cannot replace the invalidation drain for an admitted write', async () => {
    const entered = Deferred<void>()
    const release = Deferred<void>()
    const disk = await diskStorage({
      beforeWrite: async () => {
        entered.resolve()
        await release.promise
      },
    })
    const lifetime = new AbortController()
    const context = { configuration: {}, schema: definition, storageKey: 'drain-admission' }
    const connection = LocalProvider(() => disk.storage).connect({ ...context, signal: lifetime.signal })
    const writing = Promise.resolve(connection.save('admitted snapshot'))
    let draining: Promise<unknown> | undefined
    try {
      await until(() => entered.promise.then(() => true), { description: 'the admitted disk write to start' })
      lifetime.abort()
      const rejected = Promise.resolve(connection.save('rejected snapshot')).catch(error => error)
      Expect(await rejected).toMatchObject({ message: 'This local data connection is no longer active.' })
      let drained = false
      draining = Promise.resolve(connection.invalidateAuth?.()).then(
        () => {
          drained = true
        },
        error => {
          drained = true
          return error
        },
      )
      await settle()
      Expect(drained).toBe(false)
      release.resolve()
      await writing
      Expect(await draining).toBeUndefined()
      const remounted = LocalProvider(() => disk.storage).connect(context)
      try {
        Expect(await remounted.load()).toBe('admitted snapshot')
      } finally {
        remounted.close?.()
      }
    } finally {
      release.resolve()
      await Promise.allSettled([writing, draining])
      connection.close?.()
    }
  })

  Test('rejects both a failed durable save and its invalidation drain', async () => {
    const entered = Deferred<void>()
    const release = Deferred<void>()
    const disk = await diskStorage({
      beforeWrite: async () => {
        entered.resolve()
        await release.promise
        Errors.throwHostEnvironment('Disk unavailable')
      },
    })
    const connection = LocalProvider(() => disk.storage).connect({
      configuration: {},
      schema: definition,
      storageKey: 'failed-write',
    })
    const writing = Promise.resolve(connection.save('snapshot')).catch(error => error)
    try {
      await until(() => entered.promise.then(() => true), { description: 'the failing write to start' })
      const draining = Promise.resolve(connection.invalidateAuth?.()).catch(error => error)
      release.resolve()
      Expect(await writing).toMatchObject({ message: 'Disk unavailable' })
      Expect(await draining).toMatchObject({ message: 'Disk unavailable' })
    } finally {
      release.resolve()
      await writing
      connection.close?.()
    }
  })

  Test('lets a successful cumulative snapshot recover the provider invalidation drain', async () => {
    let writes = 0
    const disk = await diskStorage({
      beforeWrite: async () => {
        if (++writes === 1) {
          Errors.throwHostEnvironment('Temporary disk outage')
        }
      },
    })
    const connection = LocalProvider(() => disk.storage).connect({
      configuration: {},
      schema: definition,
      storageKey: 'recoverable-write',
    })
    try {
      await Expect(connection.save('first snapshot')).rejects.toThrow('Temporary disk outage')
      await connection.save('new complete snapshot')
      Expect(await connection.load()).toBe('new complete snapshot')
      await Expect(Promise.resolve(connection.invalidateAuth?.())).resolves.toBeUndefined()
    } finally {
      connection.close?.()
    }
  })

  Test('reports completed sign-out after a failed snapshot is replaced by durable recovered rows', async () => {
    let writes = 0
    const disk = await diskStorage({
      beforeWrite: async () => {
        if (++writes === 1) {
          Errors.throwHostEnvironment('Temporary disk outage')
        }
      },
    })
    const mounted = mount(disk.storage)
    try {
      await mounted.scope.restore()
      mounted.accept(alice)
      await mounted.store.settle()
      create(mounted.store, 'First')
      await mounted.store.settle()
      const failed = mounted.store.query({ entity: 'Draft', filters: [] }) as unknown[] & { Error: string }
      Expect(failed.Error).toContain('Temporary disk outage')
      create(mounted.store, 'Second')
      await mounted.store.settle()
      const recovered = mounted.store.query({ entity: 'Draft', filters: [] }) as unknown[] & { Error: string }
      Expect(recovered.Error).toBe('')
      Expect(await disk.savedBodies()).toEqual([['First', 'Second']])
      const leaving = await withCapturedOutput(() => mounted.scope.signOut())
      Expect(leaving.result).toEqual({ status: 'completed' })
      await mounted.signIn(alice)
      await mounted.store.settle()
      Expect(bodies(mounted.store)).toEqual(['First', 'Second'])
    } finally {
      mounted.scope.dispose()
    }
  })

  Test('keys a local-only catalog under the account its paired datasource resolves', async () => {
    const disk = await diskStorage()
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(
      TR.Auth.Declaration('TestAuth', TestAuthProvider(), { issues: ['TestIdentity'] }),
      {},
    ))
    const accounts = TR.Data.Schema({ name: 'Accounts', entities: { Account: { collection: 'Accounts', fields: {} } } })
    const local = TR.Data.Schema(definition)
    const memory = TR.Data.Declaration('Memory', MemoryProvider(), undefined, {
      accepts: [{ kind: 'TestIdentity' }],
      supports: [],
    })
    // The Local catalog sits beside the paired datasource and is not a second account target.
    scope.bindDatasources([
      { store: accounts, source: TR.Data.Configure(memory, {}) },
      {
        store: local,
        source: TR.Data.Configure(TR.Data.Declaration('Local', LocalProvider(() => disk.storage)), {}),
        localOnly: 'paired-app',
      },
    ])
    const store = scope.store(local)
    try {
      await scope.restore()
      await scope.signIn({ method: 'Password' })
      Expect(scope.session.state).toBe('SignedIn')
      await store.settle()
      create(store, 'Paired draft')
      await store.settle()
      Expect(await disk.savedBodies()).toEqual([['Paired draft']])
      Expect(disk.savedKeys()[0]).toContain(JSON.stringify(scope.session.identity!.accountId))
      Expect(disk.savedKeys()[0]).toContain('paired-app')
    } finally {
      scope.dispose()
    }
  })

  Test('seeds local fixtures only for the selected TestAuth account without writing device storage', async () => {
    const disk = await diskStorage()
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(TR.Auth.Declaration('TestAuth', TestAuthProvider()), {}))
    const accounts = TR.Data.Schema({
      name: 'Accounts',
      entities: {
        Account: { collection: 'Accounts', fields: {} },
      },
    })
    const local = TR.Data.Schema(definition)
    scope.bindDatasources([
      { store: accounts, source: TR.Data.Configure(TR.Data.Declaration('Memory', MemoryProvider()), {}) },
      {
        store: local,
        source: TR.Data.Configure(TR.Data.Declaration('Local', LocalProvider(() => disk.storage)), {}),
        localOnly: 'fixture-app',
      },
    ])
    const store = scope.store(local)
    try {
      await scope.prepareFixture({
        accounts: [{ name: 'Alice', fields: {} }, { name: 'Bob', fields: {} }],
        signedIn: 'Alice',
      }, [scope.store(accounts), store])
      scope.fixtureCreate(store, 'Draft', { Body: 'Default actor' })
      scope.fixtureCreate(store, 'Draft', { Body: 'Explicit current actor' }, 'Alice')
      Expect(() => scope.fixtureCreate(store, 'Draft', { Body: 'Other account' }, 'Bob'))
        .toThrow('Local-only fixture creates require the signed-in fixture account')
      scope.finishFixture()
      await store.settle()
      Expect(bodies(store)).toEqual(['Default actor', 'Explicit current actor'])
      Expect(await disk.savedBodies()).toEqual([])
    } finally {
      scope.dispose()
    }
  })
})

/** principalOf is what a provider verifies; a local-only app uses its subject as the account. */
function principalOf(identity: TR.AuthIdentity) {
  return { issuer: identity.issuer, subject: identity.subject }
}

function create(store: TR.DataSchema, body: string) {
  TR.Data.Create(store, 'Draft', { Body: TR.Value(body) })
  return store.query({ entity: 'Draft', filters: [] }).at(-1)!
}

function bodies(store: TR.DataSchema): unknown[] {
  return store.query({ entity: 'Draft', filters: [] }).map(row => TR.Data.Read(row, 'Body'))
}

function mount(
  storage: NonNullable<Parameters<typeof LocalProvider>[0]> extends () => infer S ? S : never,
  app = 'app-a',
  localOnly = true,
) {
  let listener: ((session: NonNullable<TR.AuthResult['session']>) => void) | undefined
  let signingIn = alice
  const scope = TR.Auth.CreateScope(TR.Auth.Configure(
    TR.Auth.Declaration('Verified', {
      connect: () => ({
        capabilities: { methods: ['Password'] },
        restore: async () => ({ state: 'SignedOut' }),
        signIn: async () => ({
          outcome: { status: 'completed' },
          session: { state: 'SignedIn', principal: principalOf(signingIn) },
        }),
        signOut: async () => ({ status: 'completed' }),
        proof: async () => TR.Errors.failInput('Local data must not request sign-in proofs.'),
        subscribe: next => {
          listener = next
          return () => {
            listener = undefined
          }
        },
      }),
    }),
    {},
  ))
  const declaration = TR.Data.Schema(definition)
  const source = TR.Data.Configure(TR.Data.Declaration('Local', LocalProvider(() => storage)), {})
  scope.bindDatasources([{ store: declaration, source, ...(localOnly ? { localOnly: app } : {}) }])
  return {
    scope,
    store: TR.Auth.Store(scope, declaration),
    accept: (identity: TR.AuthIdentity) => listener?.({ state: 'SignedIn', principal: principalOf(identity) }),
    signIn: (identity: TR.AuthIdentity) => {
      signingIn = identity
      return scope.signIn({ method: 'Password' })
    },
  }
}

async function diskStorage(hooks: {
  beforeRead?(key: string): Promise<void>
  beforeWrite?(): Promise<void>
} = {}) {
  const root = await mkTestDir('local-account-data-')
  const keys = new Set<string>()
  const path = (key: string) => FS.resolvePath(encodeURIComponent(key), root)
  return {
    storage: {
      getItem: async (key: string) => {
        await hooks.beforeRead?.(key)
        return await FS.exists(path(key)) ? await FS.readText(path(key)) : null
      },
      setItem: async (key: string, value: string) => {
        await hooks.beforeWrite?.()
        await FS.writeText(path(key), value)
        keys.add(key)
      },
      removeItem: async (key: string) => {
        await FS.remove(path(key))
      },
    },
    savedKeys: () => [...keys],
    savedBodies: async () =>
      await Promise.all([...keys].map(async key => {
        const snapshot = JSON.parse(await FS.readText(path(key))) as { rows: { Draft: { Body: string }[] } }
        return snapshot.rows.Draft.map(row => row.Body)
      })),
  }
}
