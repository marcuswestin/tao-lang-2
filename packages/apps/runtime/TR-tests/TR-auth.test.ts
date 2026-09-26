import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnectionObserver } from '../TaoRuntime-src/TR-data'
import { HostEnvironmentError, onUnownedFailure } from '../TaoRuntime-src/TR-errors'

const definition: TR.DataSchemaDefinition = {
  name: 'PrivateNotes',
  entities: {
    Account: {
      collection: 'Accounts',
      fields: { DisplayName: { kind: 'text' } },
      grants: [{ operations: ['read'], principal: [] }, {
        operations: ['update'],
        principal: [],
        updateFields: ['DisplayName'],
      }],
    },
    Note: {
      collection: 'Notes',
      fields: { Body: { kind: 'text' }, Owner: { kind: 'relation', relation: 'Account' } },
      grants: [{ operations: ['read', 'create', 'delete'], principal: ['Owner'] }, {
        operations: ['update'],
        principal: ['Owner'],
        updateFields: ['Body'],
      }],
    },
  },
}
const alice: TR.AuthSession = {
  state: 'SignedIn',
  identity: { accountId: 'account-a', issuer: 'local', subject: 'alice' },
}
const bob: TR.AuthSession = { state: 'SignedIn', identity: { accountId: 'account-b', issuer: 'local', subject: 'bob' } }
const input: TR.AuthInput = { method: 'Password', fields: { Email: 'alice@example.test', Password: 'transient' } }

Describe('mounted app authentication', () => {
  Test('discards a restore that completes after sign-out', async () => {
    const pending = Deferred<TR.AuthSession>()
    const harness = authHarness({ restore: () => pending.promise })
    const restoring = harness.scope.restore()
    await harness.scope.signOut()
    pending.resolve(alice)
    await restoring
    Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
    Expect(harness.scope.generation).toBe(0)
    harness.scope.dispose()
  })

  Test('rejects unsupported and test-only providers before connecting a real authenticated session', async () => {
    for (const authority of [undefined, 'test'] as const) {
      let connections = 0
      const pending = Deferred<TR.AuthSession>()
      const harness = authHarness({ restore: () => pending.promise })
      const restoring = harness.scope.restore()
      const declaration = TR.Data.Schema(definition)
      const source = TR.Data.Configure(
        TR.Data.Declaration('LegacySnapshot', {
          ...(authority ? { authenticatedAuthority: authority } : {}),
          connect: () => {
            connections += 1
            return { load: () => accountSnapshot('account-a'), save: () => undefined }
          },
        }),
        {},
      )
      harness.scope.bindDatasources([{ store: declaration, source }])
      Expect(connections).toBe(0)
      Expect(harness.scope.session.state).toBe('Restoring')
      pending.resolve(alice)
      await restoring
      const store = harness.scope.store(declaration)
      Expect(connections).toBe(0)
      const availability = store.availability(store.entity('Account', 'account-a'))
      Expect(availability.status).toBe('error')
      if (availability.status === 'error') {
        Expect(availability.message).toContain('cannot enforce authenticated account access')
      }
      Expect(harness.scope.session.state).toBe('SignedIn')
      await harness.scope.signOut()
      Expect(harness.scope.session.state).toBe('SignedOut')
      Expect(connections).toBe(0)
      harness.scope.dispose()
    }
  })

  Test(
    'allows declared local test authority only under TestAuth and keeps legacy unauthenticated apps working',
    async () => {
      let connections = 0
      const provider: TR.DataProvider = {
        authenticatedAuthority: 'test',
        connect: () => {
          connections += 1
          return { load: () => accountSnapshot('account-a'), save: () => undefined }
        },
      }
      const source = TR.Data.Configure(TR.Data.Declaration('Memory', provider), {})
      const scope = TR.Auth.CreateScope(TR.Auth.Configure(
        TR.Auth.Declaration('TestAuth', {
          testing: true,
          connect: () => ({ ...authConnection(), restore: async () => alice }),
        }),
        {},
      ))
      await scope.restore()
      const declaration = TR.Data.Schema(definition)
      scope.bindDatasources([{ store: declaration, source }])
      Expect(connections).toBe(1)
      Expect(TR.Data.EntityAvailability(scope.store(declaration).entity('Account', 'account-a'))).toEqual({
        status: 'available',
      })
      scope.dispose()
      const legacy = TR.Data.Schema(definition)
      legacy.bindConfigured(TR.Data.Configure(
        TR.Data.Declaration('Legacy', {
          connect: () => {
            connections += 1
            return { load: () => accountSnapshot('account-a'), save: () => undefined }
          },
        }),
        {},
      ))
      Expect(connections).toBe(2)
      Expect(TR.Data.EntityAvailability(legacy.entity('Account', 'account-a'))).toEqual({ status: 'available' })
    },
  )

  Test('settles finite auth work without waiting for presented input or cancelled restoration', async () => {
    const signedIn = Deferred<TR.AuthResult>()
    const harness = authHarness({ signIn: () => signedIn.promise })
    await harness.scope.restore()
    const presentation = harness.scope.requestSignIn()
    await TR.Auth.SettleAll()
    Expect(harness.scope.presenting).toBe(true)
    const signingIn = harness.scope.signIn(input)
    let settled = false
    const barrier = TR.Auth.SettleAll().then(() => {
      settled = true
    })
    await Promise.resolve()
    Expect(settled).toBe(false)
    signedIn.resolve({ outcome: { status: 'completed' }, session: alice })
    await barrier
    Expect(await signingIn).toEqual({ status: 'completed' })
    Expect(await presentation).toEqual({ status: 'completed' })
    harness.scope.dispose()

    const pending = Deferred<TR.AuthSession>()
    const restoring = authHarness({ restore: () => pending.promise })
    const restore = restoring.scope.restore()
    const cancellationBarrier = TR.Auth.SettleAll()
    await restoring.scope.signOut()
    await cancellationBarrier
    Expect(restoring.scope.session.state).toBe('SignedOut')
    pending.resolve(alice)
    await restore
    restoring.scope.dispose()
  })

  Test('unsupported sign-in preserves a signed-in revocation watcher and pending restoration', async () => {
    const signedIn = authHarness({ restore: async () => alice })
    await signedIn.scope.restore()
    Expect((await signedIn.scope.signIn({ method: 'Unsupported' })).status).toBe('rejected')
    Expect(signedIn.stopped()).toBe(0)
    signedIn.emit({ state: 'ReauthenticationRequired' })
    Expect(signedIn.scope.session.state).toBe('ReauthenticationRequired')
    signedIn.scope.dispose()

    const pending = Deferred<TR.AuthSession>()
    let signal: AbortSignal | undefined
    const restoring = authHarness({
      restore: current => {
        signal = current
        return pending.promise
      },
    })
    const restored = restoring.scope.restore()
    Expect((await restoring.scope.signIn({ method: 'Unsupported' })).status).toBe('rejected')
    Expect(signal!.aborted).toBe(false)
    pending.resolve(alice)
    await restored
    Expect(restoring.scope.session.state).toBe('SignedIn')
    restoring.scope.dispose()
  })

  Test('cancels a superseded sign-in and keeps the newer identity', async () => {
    const pending = Deferred<TR.AuthResult>()
    let calls = 0
    const harness = authHarness({
      signIn: () =>
        ++calls === 1 ? pending.promise : Promise.resolve({ outcome: { status: 'completed' }, session: bob }),
    })
    const first = harness.scope.signIn(input)
    await harness.scope.signIn(input)
    pending.resolve({ outcome: { status: 'completed' }, session: alice })
    Expect(await first).toEqual({ status: 'cancelled' })
    Expect(harness.scope.session.identity?.accountId).toBe('account-b')
    harness.scope.dispose()
  })

  Test('never exposes a challenge identity or allows it to request resource credentials', async () => {
    const harness = authHarness({
      signIn: async () => ({
        outcome: { status: 'completed' },
        session: { ...alice, state: 'ChallengeRequired', challenge: { id: 'one', kind: 'MFA' } },
      }),
    })
    await harness.scope.signIn(input)
    Expect(harness.scope.session.identity).toBeUndefined()
    Expect(harness.scope.session.state).toBe('ChallengeRequired')
    await Expect(harness.scope.credential({ audience: 'notes', signal: new AbortController().signal })).rejects.toThrow(
      'Sign in',
    )
    harness.scope.dispose()
  })

  Test('invalidates an in-flight resource credential and the old broker on account switch', async () => {
    const pending = Deferred<TR.AuthCredential>()
    const contexts: TR.DataProviderContext[] = []
    const harness = authHarness({ restore: async () => alice, credential: () => pending.promise })
    await harness.scope.restore()
    bind(harness.scope, contexts)
    const oldBroker = contexts[0]!.auth!
    const credential = oldBroker.credential('notes')
    harness.emit(bob)
    pending.resolve({ audience: 'notes', value: 'old-secret' })
    await Expect(credential).rejects.toThrow('no longer active')
    Expect(oldBroker.signal.aborted).toBe(true)
    await Expect(oldBroker.credential('notes')).rejects.toThrow('Sign in')
    Expect(contexts[1]!.auth!.accountId).toBe('account-b')
    harness.scope.dispose()
  })

  Test('rejects wrong-audience and expired resource credentials without exposing them to Tao', async () => {
    let audience = 'wrong-resource'
    const harness = authHarness({
      restore: async () => alice,
      credential: async () => ({ audience, value: 'secret', expiresAt: 0 }),
    })
    await harness.scope.restore()
    await Expect(harness.scope.credential({ audience: 'notes', signal: new AbortController().signal })).rejects.toThrow(
      'not valid',
    )
    audience = 'notes'
    await Expect(harness.scope.credential({ audience: 'notes', signal: new AbortController().signal })).rejects.toThrow(
      'not valid',
    )
    Expect(JSON.stringify(TR.Auth.Session(harness.scope).evaluate().jsValue)).toBe('{"State":"SignedIn"}')
    harness.scope.dispose()
  })

  Test('isolates two mounts of the same schema and clears only the departing account', async () => {
    const declaration = TR.Data.Schema(definition)
    const first = authHarness({ restore: async () => alice })
    const second = authHarness({ restore: async () => bob })
    await Promise.all([first.scope.restore(), second.scope.restore()])
    const contexts: TR.DataProviderContext[] = []
    const firstStore = bind(first.scope, contexts, declaration)
    const secondStore = bind(second.scope, contexts, declaration)
    Expect(firstStore).not.toBe(secondStore)
    createNote(firstStore, 'Alice private')
    createNote(secondStore, 'Bob private', 'account-b')
    Expect(firstStore.query({ entity: 'Note', filters: [] }).map(row => (row as { Body: string }).Body)).toEqual([
      'Alice private',
    ])
    Expect(secondStore.query({ entity: 'Note', filters: [] }).map(row => (row as { Body: string }).Body)).toEqual([
      'Bob private',
    ])
    Expect(contexts.map(context => context.storageKey)).toEqual([
      '["PrivateNotes","account-a"]',
      '["PrivateNotes","account-b"]',
    ])
    await first.scope.signOut()
    Expect(firstStore.query({ entity: 'Note', filters: [] })).toHaveLength(0)
    Expect(secondStore.query({ entity: 'Note', filters: [] })).toHaveLength(1)
    first.scope.dispose()
    second.scope.dispose()
  })

  Test('seals queued writes before dispatch while allowing the already-started write to settle', async () => {
    const started = Deferred<void>()
    const pending = Deferred<void>()
    const saves: string[] = []
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const schema = TR.Data.Schema(definition)
    const source = TR.Data.Configure(
      TR.Data.Declaration('Memory', {
        authenticatedAuthority: 'server',
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          save: async value => {
            saves.push(value)
            started.resolve()
            await pending.promise
          },
        }),
      }),
      {},
    )
    harness.scope.bindDatasources([{ store: schema, source }])
    const store = harness.scope.store(schema)
    createNote(store, 'First')
    await started.promise
    createNote(store, 'Must stay sealed')
    const settled = store.settle()
    await harness.scope.signOut()
    pending.resolve()
    await settled
    Expect(saves).toHaveLength(1)
    Expect(saves[0]).not.toContain('Must stay sealed')
    Expect(() => TR.Data.Create(store, 'Note', { Body: TR.Value('Signed out') })).toThrow()
    harness.scope.dispose()
  })

  Test('separates signed-in state from the availability of its application account row', async () => {
    const pending = Deferred<string | undefined>()
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    const source = TR.Data.Configure(
      TR.Data.Declaration('Remote', {
        authenticatedAuthority: 'server',
        connect: () => ({ load: () => pending.promise, save: () => undefined }),
      }),
      {},
    )
    harness.scope.bindDatasources([{ store: declaration, source }])
    const account = TR.Auth.Account(harness.scope, declaration, 'Account')
    Expect(TR.Data.EntityAvailability(account.evaluate().jsValue)).toEqual({ status: 'loading' })
    pending.resolve(
      JSON.stringify({
        formatVersion: 1,
        schemaVersion: 1,
        nextId: 1,
        rows: { Account: [{ Id: 'account-a', DisplayName: 'Alice' }], Note: [] },
      }),
    )
    await harness.scope.store(declaration).settle()
    Expect(TR.Data.EntityAvailability(account.evaluate().jsValue)).toEqual({ status: 'available' })
    Expect(TR.Data.Read(account.evaluate().jsValue, 'DisplayName')).toBe('Alice')
    await harness.scope.signOut()
    Expect(account.evaluate().jsValue).toBeUndefined()
    harness.scope.dispose()
  })

  Test('discards a pending restore after disposal without installing a subscription', async () => {
    const pending = Deferred<TR.AuthSession>()
    const harness = authHarness({ restore: () => pending.promise })
    const restoring = harness.scope.restore()
    harness.scope.dispose()
    pending.resolve(alice)
    harness.emit(bob)
    await restoring
    Expect(harness.closed()).toBe(1)
    Expect(harness.stopped()).toBe(0)
    Expect(harness.scope.session.identity).toBeUndefined()
  })

  Test('keeps only generic safe error text from a failing provider', async () => {
    const harness = authHarness({
      signIn: async () => {
        throw new HostEnvironmentError('password=secret provider stack')
      },
    })
    Expect(await harness.scope.signIn(input)).toEqual({
      status: 'error',
      message: 'Unable to sign in. Please try again.',
    })
    Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
    harness.scope.dispose()
  })

  Test('uses secure opaque identifiers for mounted data without changing deterministic legacy IDs', async () => {
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const store = bind(harness.scope, [])
    createNote(store, 'one')
    createNote(store, 'two')
    const ids = store.query({ entity: 'Note', filters: [] }).map(row => (row as { Id: string }).Id)
    Expect(ids[0]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    Expect(ids[0]).not.toBe(ids[1])
    const legacy = TR.Data.Schema(definition, { load: () => accountSnapshot('account-a'), save: () => undefined })
    createNote(legacy, 'legacy')
    Expect((legacy.query({ entity: 'Note', filters: [] })[0] as { Id: string }).Id).toBe('Note-1')
    harness.scope.dispose()
  })

  Test('rejects captured subscription callbacks after logout and disposes the live subscription once', async () => {
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    await harness.scope.signOut()
    harness.emit(alice)
    Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
    Expect(harness.stopped()).toBe(1)
    harness.scope.dispose()
    Expect(harness.stopped()).toBe(1)
    Expect(harness.closed()).toBe(1)
  })

  Test('survives the StrictMode effect probe then disposes the actual unmount', async () => {
    let restores = 0
    const harness = authHarness({
      restore: async () => {
        restores += 1
        return alice
      },
    })
    const firstRelease = harness.scope.retain()
    firstRelease()
    const finalRelease = harness.scope.retain()
    await harness.scope.restore()
    Expect(harness.scope.session.identity?.accountId).toBe('account-a')
    Expect(restores).toBe(1)
    Expect(harness.closed()).toBe(0)
    finalRelease()
    await Promise.resolve()
    Expect(harness.closed()).toBe(1)
    Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
  })

  Test('waits for durable account cleanup while clearing the account synchronously', async () => {
    const cleanup = Deferred<void>()
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    const source = TR.Data.Configure(
      TR.Data.Declaration('Durable', {
        authenticatedAuthority: 'server',
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          save: () => undefined,
          invalidateAuth: () => cleanup.promise,
        }),
      }),
      {},
    )
    harness.scope.bindDatasources([{ store: declaration, source }])
    let settled = false
    const signingOut = harness.scope.signOut().then(outcome => {
      settled = true
      return outcome
    })
    Expect(TR.Auth.Account(harness.scope, declaration, 'Account').evaluate().jsValue).toBeUndefined()
    await Promise.resolve()
    Expect(settled).toBe(false)
    cleanup.resolve()
    Expect(await signingOut).toEqual({ status: 'completed' })
    harness.scope.dispose()
  })

  Test('awaits cleanup of a replaced datasource lease before completing logout', async () => {
    const oldCleanup = Deferred<void>()
    const newCleanup = Deferred<void>()
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    let invalidated = 0
    const source = (cleanup: Promise<void>) =>
      TR.Data.Configure(
        TR.Data.Declaration('Durable', {
          authenticatedAuthority: 'server',
          connect: () => ({
            load: () => accountSnapshot('account-a'),
            save: () => undefined,
            invalidateAuth: () => {
              invalidated += 1
              return cleanup
            },
          }),
        }),
        {},
      )
    harness.scope.bindDatasources([{ store: declaration, source: source(oldCleanup.promise) }])
    harness.scope.bindDatasources([{ store: declaration, source: source(newCleanup.promise) }])
    let settled = false
    const signOut = harness.scope.signOut().then(result => {
      settled = true
      return result
    })
    Expect(invalidated).toBe(2)
    newCleanup.resolve()
    await Promise.resolve()
    await Promise.resolve()
    Expect(settled).toBe(false)
    oldCleanup.resolve()
    Expect(await signOut).toEqual({ status: 'completed' })
    harness.scope.dispose()
  })

  Test('releases a synchronous subscription that invalidates the session during setup', async () => {
    let stops = 0
    const harness = authHarness({
      restore: async () => alice,
      subscribe: listener => {
        listener({ state: 'SignedOut' })
        return () => {
          stops += 1
        }
      },
    })
    await harness.scope.restore()
    Expect(harness.scope.session.state).toBe('SignedOut')
    Expect(stops).toBe(1)
    harness.scope.dispose()
    Expect(stops).toBe(1)
  })

  Test('keeps presented sign-in open through a required challenge, then completes or cancels explicitly', async () => {
    let challenge = true
    const harness = authHarness({
      signIn: async () => ({
        outcome: { status: 'completed' },
        session: challenge ? { state: 'ChallengeRequired', challenge: { id: 'mfa', kind: 'MFA' } } : alice,
      }),
    })
    const presented = harness.scope.requestSignIn(() => 'Sign-in UI')
    Expect(harness.scope.presenting).toBe(true)
    await harness.scope.signIn(input)
    Expect(harness.scope.presenting).toBe(true)
    challenge = false
    await harness.scope.signIn(input)
    Expect(await presented).toEqual({ status: 'completed' })
    Expect(harness.scope.presenting).toBe(false)
    await harness.scope.signOut()
    const cancelled = harness.scope.requestSignIn()
    harness.scope.cancel()
    Expect(await cancelled).toEqual({ status: 'cancelled' })
    harness.scope.dispose()
  })

  Test('distinguishes completed and cancelled auth effects from saved data effects', async () => {
    const harness = authHarness()
    const seen: string[] = []
    const action = TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(TR.Auth.SignInAction(harness.scope)), {
        declared: ['cancelled', 'rejected'],
        name: 'SignIn',
        success: 'completed',
      }, [['completed', () => seen.push('completed')], ['cancelled', () => seen.push('cancelled')], [
        'saved',
        () => seen.push('saved'),
      ]])
    })
    const run = action.jsValue.invoke()
    harness.scope.cancel()
    await run
    Expect(seen).toEqual(['cancelled'])
    const completed = action.jsValue.invoke()
    await harness.scope.signIn(input)
    await completed
    Expect(seen).toEqual(['cancelled', 'completed'])
    harness.scope.dispose()
  })

  Test('maps Session.State to the declared enum and guards absent accounts without exposing identity', async () => {
    const pending = Deferred<TR.AuthSession>()
    const harness = authHarness({ restore: () => pending.promise })
    const schema = TR.Data.Schema(definition)
    const account = TR.Alias(TR.Auth.Account(harness.scope, schema, 'Account'))
    const readNet = {
      app: { readNet: { loading: () => 'app loading', unauthorized: () => 'app login' } },
    } as unknown as TR.TaoProps
    Expect(TR.GuardRender(account, [], () => 'private', readNet)).toBe('app loading')
    Expect(TR.GuardRender(account, [['loading', () => 'site loading']], () => 'private', readNet)).toBe('site loading')
    const restoring = harness.scope.restore()
    pending.resolve({ state: 'SignedOut' })
    await restoring
    Expect(account.evaluate().jsValue).toBeUndefined()
    Expect(TR.GuardRender(account, [], () => 'private', readNet)).toBe('app login')
    const states = TR.Enum(
      TR.Navigation.Identity(['tao.declaration', 1, 'test', '@workspace', 'Auth', 'enum', 'State']),
      ['SignedOut'],
    )
    Expect(TR.Member(TR.Auth.Session(harness.scope, states), ['State']).evaluate().jsValue).toBe(
      states['SignedOut']!.jsValue,
    )
    harness.scope.dispose()
  })

  Test('keeps evaluated auth aliases evaluable for compiled member access', async () => {
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    bind(harness.scope, [], declaration)
    const session = TR.Auth.Session(harness.scope).evaluate() as TR.Evaluable
    const account = TR.Auth.Account(harness.scope, declaration, 'Account').evaluate() as TR.Evaluable
    Expect(TR.Member(session, ['State']).evaluate().jsValue).toBe('SignedIn')
    Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Alice')
    harness.scope.dispose()
  })

  Test('updates sensitive reactive members without replacing their branded owner', async () => {
    let secret = ''
    const flow = TR.ReactiveValue({
      subscribe: () => () => undefined,
      get Password() {
        return secret
      },
      writeMember: (path: readonly string[], value: unknown) => {
        if (path[0] === 'Password') {
          secret = String(value)
        }
      },
    })
    const state = TR.Cell(TR.Value(flow))
    TR.Member(state, ['Password']).set!(TR.Value('kept in flow'))
    Expect(state.evaluate().jsValue).toBe(flow)
    Expect(TR.Member(state, ['Password']).evaluate().jsValue).toBe('kept in flow')
  })

  Test('authenticates sealed checkpoints and binds them to their exact account resource', () => {
    const key = '12'.repeat(32)
    const first = TR.Auth.Seal(key, 'private data', 'account-a/notes')
    const second = TR.Auth.Seal(key, 'private data', 'account-a/notes')
    Expect(first).not.toBe(second)
    Expect(first).not.toContain('private data')
    Expect(TR.Auth.Open(key, first, 'account-a/notes')).toBe('private data')
    Expect(() => TR.Auth.Open(key, first, 'account-b/notes')).toThrow('could not be opened')
    Expect(() => TR.Auth.Open('34'.repeat(32), first, 'account-a/notes')).toThrow('could not be opened')
    const tampered = JSON.parse(first) as { box: string }
    tampered.box = `${tampered.box.startsWith('A') ? 'B' : 'A'}${tampered.box.slice(1)}`
    Expect(() => TR.Auth.Open(key, JSON.stringify(tampered), 'account-a/notes')).toThrow('could not be opened')
  })

  Test('keeps profile input out of the account row until its submitted change is confirmed', async () => {
    const receipt = Deferred<{ status: 'saved' | 'queued' }>()
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    const source = TR.Data.Configure(
      TR.Data.Declaration('Remote', {
        authenticatedAuthority: 'server',
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          save: () => undefined,
          submit: () => receipt.promise,
        }),
      }),
      {},
    )
    harness.scope.bindDatasources([{ store: declaration, source }])
    const account = TR.Auth.Account(harness.scope, declaration, 'Account')
    const save = TR.Auth.SaveProfile(harness.scope, account, { DisplayName: TR.Value('Confirmed') })
    Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Alice')
    receipt.resolve({ status: 'saved' })
    Expect(await save).toEqual({ status: 'completed' })
    Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Confirmed')
    harness.scope.dispose()
  })

  Test('denies reads and every write path against another account including owner reassignment', async () => {
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    const snapshot = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 1,
      nextId: 1,
      rows: {
        Account: [{ Id: 'account-a', DisplayName: 'Alice' }, { Id: 'account-b', DisplayName: 'Bob' }],
        Note: [{ Id: 'bob-note', Body: 'private', Owner: 'account-b' }],
      },
    })
    const source = TR.Data.Configure(
      TR.Data.Declaration('Remote', {
        authenticatedAuthority: 'server',
        connect: () => ({ load: () => snapshot, save: () => undefined }),
      }),
      {},
    )
    harness.scope.bindDatasources([{ store: declaration, source }])
    const store = harness.scope.store(declaration)
    const other = store.entity('Note', 'bob-note')
    Expect(TR.Data.Read(other, 'Body')).toBeUndefined()
    Expect(TR.Data.EntityAvailability(other)).toEqual({ status: 'unauthorized' })
    Expect(store.query({ entity: 'Note', filters: [] })).toEqual([])
    Expect(() => TR.Data.Update(TR.Value(other), { Body: TR.Value('stolen') })).toThrow('permission')
    Expect(() => TR.Data.Update(TR.Value(other), { Owner: TR.Value(store.entity('Account', 'account-a')) })).toThrow(
      'permission',
    )
    Expect(() => TR.Data.Delete(TR.Value(other))).toThrow('permission')
    Expect(() => createNote(store, 'forged', 'account-b')).toThrow('permission')
    harness.scope.dispose()
  })

  Test('rejects an async data action whose account switched before transaction commit', async () => {
    const gate = Deferred<void>()
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const store = bind(harness.scope, [])
    const action = TR.Action(async () => {
      createNote(store, 'old draft')
      await gate.promise
    })
    const failures: unknown[] = []
    const stop = onUnownedFailure(error => failures.push(error))
    const pending = TR.Do(action)
    harness.emit(bob)
    gate.resolve()
    await pending
    Expect(failures).toHaveLength(1)
    Expect(String(failures[0])).toContain('no longer active')
    stop()
    Expect(store.query({ entity: 'Note', filters: [] })).toEqual([])
    harness.scope.dispose()
  })

  Test('sends the consumed write baseline while newer subscription rows are buffered', async () => {
    const firstSave = Deferred<void>()
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const declaration = TR.Data.Schema(definition)
    let observer: TaoDataConnectionObserver | undefined
    const baselines: string[] = []
    const source = TR.Data.Configure(
      TR.Data.Declaration('Remote', {
        authenticatedAuthority: 'server',
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          subscribe: next => {
            observer = next
            return () => undefined
          },
          save: (_snapshot, _intents, context) => {
            baselines.push(context!.previousSnapshot)
            return baselines.length === 1 ? firstSave.promise : undefined
          },
        }),
      }),
      {},
    )
    harness.scope.bindDatasources([{ store: declaration, source }])
    const store = harness.scope.store(declaration)
    createNote(store, 'First')
    await Promise.resolve()
    const remote = JSON.parse(accountSnapshot('account-a'))
    remote.rows.Note.push({ Id: 'peer-note', Owner: 'account-a', Body: 'Peer' })
    observer!.snapshot(JSON.stringify(remote))
    createNote(store, 'Second')
    firstSave.resolve()
    await store.settle()
    Expect(JSON.parse(baselines[0]!).rows.Note).toEqual([])
    Expect(JSON.parse(baselines[1]!).rows.Note.map((row: { Body: string }) => row.Body)).toEqual(['First'])
    harness.scope.dispose()
  })

  Test('keeps queued and rejected profile inputs out of the loaded Account', async () => {
    for (const rejection of [false, true]) {
      const harness = authHarness({ restore: async () => alice })
      await harness.scope.restore()
      const declaration = TR.Data.Schema(definition)
      const source = TR.Data.Configure(
        TR.Data.Declaration('Remote', {
          authenticatedAuthority: 'server',
          connect: () => ({
            load: () => accountSnapshot('account-a'),
            save: () => undefined,
            submit: async () => {
              if (rejection) {
                throw new HostEnvironmentError('denied')
              }
              return { status: 'queued' as const }
            },
          }),
        }),
        {},
      )
      harness.scope.bindDatasources([{ store: declaration, source }])
      TR.Auth.BindAccount(harness.scope, declaration, 'Account')
      const account = TR.Auth.Account(harness.scope)
      const result = await TR.Auth.SaveProfile(harness.scope, account, { DisplayName: TR.Value('Unsaved') })
      Expect(result.status).toBe(rejection ? 'error' : 'rejected')
      Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Alice')
      harness.scope.dispose()
    }
  })

  Test('keeps entity picker candidates within the explicitly mounted account scope', async () => {
    const first = authHarness({ restore: async () => alice })
    const second = authHarness({ restore: async () => bob })
    await Promise.all([first.scope.restore(), second.scope.restore()])
    const declaration = TR.Data.Schema(definition)
    const firstStore = bind(first.scope, [], declaration)
    const secondStore = bind(second.scope, [], declaration)
    createNote(firstStore, 'Alice')
    createNote(secondStore, 'Bob', 'account-b')
    Expect(TR.Data.interactionCandidates('Note', first.scope).map(row => TR.Data.Read(row, 'Body'))).toEqual(['Alice'])
    Expect(TR.Data.interactionCandidates('Note', second.scope).map(row => TR.Data.Read(row, 'Body'))).toEqual(['Bob'])
    Expect(TR.Data.interactionCandidates('Note')).not.toContain(firstStore.query({ entity: 'Note', filters: [] })[0])
    first.scope.dispose()
    second.scope.dispose()
  })

  Test('enforces composite uniqueness with distinct absent tuples and validates enum identities', () => {
    const cases = TR.Enum(
      TR.Navigation.Identity(['tao.declaration', 1, 'test', '@workspace', 'Auth', 'enum', 'Role']),
      ['Owner', 'Member'],
    )
    const schema = TR.Data.Schema({
      name: 'Memberships',
      entities: {
        Membership: {
          collection: 'Memberships',
          uniqueConstraints: [['Team', 'Email']],
          fields: {
            Team: { kind: 'text' },
            Email: { kind: 'text', optional: true },
            Role: { kind: 'enum', cases: ['Owner', 'Member'], enumValues: () => cases },
          },
        },
      },
    }, { load: () => undefined, save: () => undefined })
    const add = (team: string, email?: string) =>
      TR.Data.Create(schema, 'Membership', {
        Team: TR.Value(team),
        ...(email === undefined ? {} : { Email: TR.Value(email) }),
        Role: cases['Member']!,
      })
    add('a', 'x')
    add('b', 'x')
    add('a')
    add('a')
    Expect(() => add('a', 'x')).toThrow('Unique constraint')
    const rows = schema.query({ entity: 'Membership', filters: [] })
    Expect(rows).toHaveLength(4)
    Expect(TR.Data.Read(rows[0], 'Role')).toBe(cases['Member']!.jsValue)
    Expect(() => TR.Data.Update(TR.Value(rows[1]), { Team: TR.Value('a') })).toThrow('Unique constraint')
    Expect(TR.Data.Read(rows[1], 'Team')).toBe('b')
    Expect(() => TR.Data.Update(TR.Value(rows[1]), { Role: TR.Value('Unknown') })).toThrow()
  })

  Test('uses only TestAuth to provision fixture accounts and keeps actor overrides operation-local', async () => {
    const source = TR.Auth.Configure(
      TR.Auth.Declaration('TestAuth', { testing: true, connect: () => authConnection() }),
      {},
    )
    const scope = TR.Auth.CreateScope(source)
    const declaration = TR.Data.Schema(definition)
    const store = bind(scope, [], declaration)
    const accounts = await scope.prepareFixture({
      accounts: [{ name: 'Alice', fields: { DisplayName: 'Alice' } }, { name: 'Bob', fields: { DisplayName: 'Bob' } }],
      signedIn: 'Alice',
    }, [store])
    scope.fixtureCreate(store, 'Note', { Body: 'Alice private', Owner: accounts['Alice'] })
    scope.fixtureCreate(store, 'Note', { Body: 'Bob private', Owner: accounts['Bob'] }, 'Bob')
    Expect(() => scope.fixtureCreate(store, 'Note', { Body: 'Forged owner', Owner: accounts['Bob'] })).toThrow(
      'permission',
    )
    scope.finishFixture()
    Expect(scope.session.identity?.subject).toBe('Alice')
    Expect(store.query({ entity: 'Note', filters: [] }).map(row => TR.Data.Read(row, 'Body'))).toEqual([
      'Alice private',
    ])
    scope.dispose()
    const production = authHarness()
    await Expect(production.scope.prepareFixture({ accounts: [], signedIn: 'Alice' }, [])).rejects.toThrow('TestAuth')
    production.scope.dispose()
  })
})

function authHarness(overrides: Partial<TR.AuthConnection> = {}) {
  let listener: ((session: TR.AuthSession) => void) | undefined
  let closed = 0
  let stopped = 0
  const connection: TR.AuthConnection = {
    ...authConnection(),
    capabilities: { methods: ['Password'] },
    restore: async () => ({ state: 'SignedOut' }),
    signIn: async () => ({ outcome: { status: 'completed' }, session: alice }),
    signOut: async () => ({ status: 'completed' }),
    credential: async request => ({ audience: request.audience, value: 'private-resource-credential' }),
    subscribe: next => {
      listener = next
      return () => {
        stopped += 1
      }
    },
    close: () => {
      closed += 1
    },
    ...overrides,
  }
  const source = TR.Auth.Configure(TR.Auth.Declaration('Deterministic', { connect: () => connection }), {})
  return {
    scope: TR.Auth.CreateScope(source),
    emit: (session: TR.AuthSession) => listener?.(session),
    closed: () => closed,
    stopped: () => stopped,
  }
}

function authConnection(): TR.AuthConnection {
  return {
    capabilities: { methods: ['Password'] },
    restore: async () => ({ state: 'SignedOut' }),
    signIn: async () => ({ outcome: { status: 'completed' }, session: alice }),
    signOut: async () => ({ status: 'completed' }),
    credential: async request => ({ audience: request.audience, value: 'private-resource-credential' }),
  }
}

function bind(
  scope: TR.AuthScope,
  contexts: TR.DataProviderContext[],
  declaration = TR.Data.Schema(definition),
): TR.DataSchema {
  const source = TR.Data.Configure(
    TR.Data.Declaration('Memory', {
      authenticatedAuthority: 'server',
      connect: context => {
        contexts.push(context)
        return { load: () => accountSnapshot(context.auth!.accountId), save: () => undefined }
      },
    }),
    {},
  )
  scope.bindDatasources([{ store: declaration, source }])
  return scope.store(declaration)
}

function accountSnapshot(id: string): string {
  return JSON.stringify({
    formatVersion: 1,
    schemaVersion: 1,
    nextId: 1,
    rows: { Account: [{ Id: id, DisplayName: id === 'account-a' ? 'Alice' : 'Bob' }], Note: [] },
  })
}

function createNote(store: TR.DataSchema, body: string, accountId = 'account-a'): void {
  TR.Data.Create(store, 'Note', { Body: TR.Value(body), Owner: TR.Value(store.entity('Account', accountId)) })
}
