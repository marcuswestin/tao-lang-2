import TR from '@runtime/TR'
import { Deferred, Describe, Expect, settle, Test, until } from '@shared/test'
import { RuntimeAuthScope } from '../TaoRuntime-src/TR-auth'
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
const alice: TR.AuthConnectionSession = { state: 'SignedIn', principal: { issuer: 'local', subject: 'alice' } }
const bob: TR.AuthConnectionSession = { state: 'SignedIn', principal: { issuer: 'local', subject: 'bob' } }
const input: TR.AuthInput = { method: 'Password', fields: { Email: 'alice@example.test', Password: 'transient' } }

Describe('mounted app authentication', () => {
  Test('discards a restore that completes after sign-out', async () => {
    const pending = Deferred<TR.AuthConnectionSession>()
    const harness = authHarness({ restore: () => pending.promise })
    const restoring = harness.scope.restore()
    await harness.scope.signOut()
    pending.resolve(alice)
    await restoring
    Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
    Expect(harness.scope.generation).toBe(0)
    harness.scope.dispose()
  })

  Test('refuses a datasource that cannot resolve the account before connecting it, naming both', async () => {
    let connections = 0
    const connect = (): TR.DataConnection => {
      connections += 1
      return { load: () => accountSnapshot('account-a'), save: () => undefined }
    }
    const pending = Deferred<TR.AuthConnectionSession>()
    const harness = authHarness({ restore: () => pending.promise }, { provider: { authenticate: undefined, connect } })
    const restoring = harness.scope.restore()
    Expect(harness.scope.session.state).toBe('Restoring')
    pending.resolve(alice)
    await restoring
    Expect(connections).toBe(0)
    Expect(harness.scope.session).toEqual({
      state: 'Error',
      message:
        'Datasource Remote accepts sign-in proofs from Auth Deterministic but its provider does not authenticate them.',
    })
    Expect(
      TR.Data.EntityAvailability(TR.Auth.Account(harness.scope, harness.declaration, 'Account').evaluate().jsValue),
    )
      .toBeUndefined()
    await harness.scope.signOut()
    Expect(harness.scope.session.state).toBe('SignedOut')
    Expect(connections).toBe(0)
    harness.scope.dispose()
  })

  Test('repeats the pairing check with both declarations, respecting from and test authority', async () => {
    const cases: readonly [TR.AuthPairing, TR.DataPairing, TR.AuthProvider['testing'], string | undefined][] = [
      [{ issues: ['Session'] }, { accepts: [{ kind: 'IdentityToken' }], supports: [] }, undefined, 'issues Session'],
      [
        { issues: ['Session'] },
        { accepts: [{ kind: 'Session', from: 'LocalAuth' }], supports: [] },
        undefined,
        'Session from LocalAuth',
      ],
      [
        { issues: ['TestIdentity'] },
        { accepts: [{ kind: 'TestIdentity' }], supports: [] },
        undefined,
        'accepts TestIdentity',
      ],
      [{ issues: ['TestIdentity'] }, { accepts: [{ kind: 'TestIdentity' }], supports: [] }, true, undefined],
      [
        { issues: ['Session'] },
        { accepts: [{ kind: 'Session', from: 'Deterministic' }], supports: [] },
        undefined,
        undefined,
      ],
    ]
    for (const [issued, accepted, testing, problem] of cases) {
      const harness = authHarness({ restore: async () => alice }, {
        authPairing: issued,
        dataPairing: accepted,
        testing,
      })
      await harness.scope.restore()
      if (problem === undefined) {
        Expect(harness.scope.session.identity?.accountId).toBe('account-a')
      } else {
        Expect(harness.scope.session.state).toBe('Error')
        Expect(harness.scope.session.message).toContain('Datasource Remote cannot sign in with Auth Deterministic')
        Expect(harness.scope.session.message).toContain(problem)
        Expect(harness.contexts).toEqual([])
      }
      harness.scope.dispose()
    }
  })

  Test('requires pairing metadata on both declarations, naming both', async () => {
    for (const unpaired of [{ authPairing: null }, { dataPairing: null }] as const) {
      const harness = authHarness({ restore: async () => alice }, unpaired)
      await harness.scope.restore()
      Expect(harness.scope.session).toEqual({
        state: 'Error',
        message:
          'Auth Deterministic and Datasource Remote must both declare sign-in pairing: the proofs Deterministic issues and the proofs Remote accepts.',
      })
      Expect(harness.contexts).toEqual([])
      harness.scope.dispose()
    }
  })

  Test('a principal restored before the app binds its datasources waits for them instead of failing', async () => {
    const early = authHarness({ restore: async () => alice }, { bind: false })
    await early.scope.restore()
    await TR.Auth.SettleAll()
    Expect(early.scope.session).toEqual({ state: 'Restoring' })
    Expect(early.contexts).toEqual([])
    early.scope.bindDatasources([{ store: early.declaration, source: dataSource(early.contexts) }])
    Expect(early.scope.session).toEqual({ state: 'Restoring' })
    await TR.Auth.SettleAll()
    Expect(early.scope.session.identity?.accountId).toBe('account-a')
    early.scope.dispose()

    const signingIn = authHarness({}, { bind: false })
    Expect(await signingIn.scope.signIn(input)).toEqual({ status: 'completed' })
    Expect(signingIn.scope.session).toEqual({ state: 'Authenticating' })
    signingIn.scope.bindDatasources([{ store: signingIn.declaration, source: dataSource(signingIn.contexts) }])
    await TR.Auth.SettleAll()
    Expect(signingIn.scope.session.identity?.accountId).toBe('account-a')
    signingIn.scope.dispose()
  })

  Test('holds the account in exactly one datasource once binding settles', async () => {
    const empty = authHarness({ restore: async () => alice }, { bind: false })
    await empty.scope.restore()
    empty.scope.bindDatasources([])
    Expect(empty.scope.session).toEqual({
      state: 'Error',
      message: 'Auth Deterministic needs a datasource to hold the signed-in Account.',
    })
    // Binding the datasource afterwards resolves the principal that is already signed in.
    empty.scope.bindDatasources([{ store: empty.declaration, source: dataSource(empty.contexts) }])
    await until(() => empty.scope.session.state === 'SignedIn')
    Expect(empty.scope.session.identity?.accountId).toBe('account-a')
    empty.scope.dispose()

    const several = authHarness({ restore: async () => alice })
    const other = TR.Data.Schema({ ...definition, name: 'Other' })
    several.scope.bindDatasources([
      { store: several.declaration, source: dataSource(several.contexts) },
      {
        store: other,
        source: TR.Data.Configure(TR.Data.Declaration('Elsewhere', dataProvider(), undefined, sessionPairing), {}),
      },
    ])
    await several.scope.restore()
    Expect(several.scope.session.state).toBe('Error')
    Expect(several.scope.session.message).toBe(
      'Auth Deterministic can sign in to one datasource, but this app binds Remote, Elsewhere. Keep the Account and account data in one datasource.',
    )
    Expect(several.contexts).toEqual([])
    several.scope.dispose()
  })

  Test('stays restoring or authenticating until the datasource resolves the account', async () => {
    const resolved = Deferred<TR.DataAuthentication>()
    const principals: TR.AuthPrincipal[] = []
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
        authenticate: async context => {
          principals.push(context.principal)
          return resolved.promise
        },
      },
    })
    const account = TR.Auth.Account(harness.scope, harness.declaration, 'Account')
    const restoring = harness.scope.restore()
    await until(() => principals.length === 1)
    Expect(harness.scope.session).toEqual({ state: 'Restoring' })
    Expect(TR.Data.EntityAvailability(account.evaluate().jsValue)).toBeUndefined()
    Expect(harness.contexts).toEqual([])
    resolved.resolve({ accountId: 'account-a' })
    await restoring
    Expect(principals).toEqual([{ issuer: 'local', subject: 'alice' }])
    Expect(harness.scope.session).toEqual({
      state: 'SignedIn',
      identity: { issuer: 'local', subject: 'alice', accountId: 'account-a' },
    })
    Expect(harness.contexts.map(context => context.auth?.accountId)).toEqual(['account-a'])
    await harness.scope.signOut()

    const signingIn = Deferred<TR.DataAuthentication>()
    const later = authHarness({}, { provider: { authenticate: () => signingIn.promise } })
    await later.scope.restore()
    const signIn = later.scope.signIn(input)
    await until(() => later.scope.session.state === 'Authenticating' && later.contexts.length === 0)
    await Promise.resolve()
    Expect(later.scope.session).toEqual({ state: 'Authenticating' })
    signingIn.resolve({ accountId: 'account-a' })
    Expect(await signIn).toEqual({ status: 'completed' })
    Expect(later.scope.session.identity?.accountId).toBe('account-a')
    later.scope.dispose()
    harness.scope.dispose()
  })

  Test('turns a failed account resolution into an error and abandons the unaccepted sign-in', async () => {
    let signOuts = 0
    const failing = { authenticate: async () => Promise.reject(new HostEnvironmentError('gateway=secret offline')) }
    const restored = authHarness({ restore: async () => alice }, { provider: failing })
    await restored.scope.restore()
    Expect(restored.scope.session).toEqual({ state: 'Error', message: 'Unable to restore your session.' })
    restored.scope.dispose()

    const signedIn = authHarness({
      signOut: async () => {
        signOuts += 1
        return { status: 'completed' }
      },
    }, { provider: failing })
    Expect(await signedIn.scope.signIn(input)).toEqual({
      status: 'error',
      message: 'Unable to sign in. Please try again.',
    })
    Expect(signedIn.scope.session).toEqual({ state: 'Error', message: 'Unable to sign in. Please try again.' })
    await TR.Auth.SettleAll()
    Expect(signOuts).toBe(1)
    signedIn.scope.dispose()
  })

  Test('cancelling while the account resolves abandons the provider sign-in and releases a late result', async () => {
    const resolved = Deferred<TR.DataAuthentication>()
    const released: string[] = []
    let signOuts = 0
    const harness = authHarness({
      signOut: async () => {
        signOuts += 1
        return { status: 'completed' }
      },
    }, { provider: { authenticate: () => resolved.promise } })
    const signingIn = harness.scope.signIn(input)
    await until(() => harness.scope.session.state === 'Authenticating')
    await Promise.resolve()
    harness.scope.cancel()
    resolved.resolve({
      accountId: 'account-a',
      release: async () => {
        released.push('account-a')
      },
    })
    Expect(await signingIn).toEqual({ status: 'cancelled' })
    await TR.Auth.SettleAll()
    await until(() => released.length === 1)
    Expect(signOuts).toBe(1)
    Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
    Expect(harness.contexts).toEqual([])
    harness.scope.dispose()
  })

  Test('a rebind with an equal account datasource does not resolve the account again', async () => {
    let resolutions = 0
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
        authenticate: async () => {
          resolutions += 1
          return { accountId: 'account-a' }
        },
      },
    })
    await harness.scope.restore()
    const source = harness.source
    for (let render = 0; render < 3; render += 1) {
      harness.scope.bindDatasources([{
        store: harness.declaration,
        source: TR.Data.Configure(source.declaration, { ...source.config }),
      }])
    }
    await TR.Auth.SettleAll()
    Expect(resolutions).toBe(1)
    Expect(harness.scope.session.identity?.accountId).toBe('account-a')
    harness.scope.dispose()
  })

  Test(
    'allows TestIdentity proofs only from a testing provider and keeps legacy unauthenticated apps working',
    async () => {
      let connections = 0
      const testings: (true | undefined)[] = []
      const failures: string[] = []
      const provider: TR.DataProvider = {
        authenticate: async context => {
          testings.push(context.testing)
          try {
            return { accountId: (await context.proof('TestIdentity', context.signal)).accountId }
          } catch (error) {
            failures.push(String(error))
            throw error
          }
        },
        connect: () => {
          connections += 1
          return { load: () => accountSnapshot('account-a'), save: () => undefined }
        },
      }
      const source = TR.Data.Configure(TR.Data.Declaration('Memory', provider, undefined, testIdentityPairing), {})
      const testIdentity: TR.AuthConnection['proof'] = async () => ({
        kind: 'TestIdentity',
        issuer: 'local',
        subject: 'alice',
        accountId: 'account-a',
      })
      const scope = TR.Auth.CreateScope(TR.Auth.Configure(
        TR.Auth.Declaration('TestAuth', {
          testing: true,
          connect: () => ({ ...authConnection(), restore: async () => alice, proof: testIdentity }),
        }, { issues: ['TestIdentity'] }),
        {},
      ))
      const declaration = TR.Data.Schema(definition)
      scope.bindDatasources([{ store: declaration, source }])
      await scope.restore()
      Expect(connections).toBe(1)
      Expect(TR.Data.EntityAvailability(scope.store(declaration).entity('Account', 'account-a'))).toEqual({
        status: 'available',
      })
      scope.dispose()
      // Declaring TestIdentity does not let a production provider issue one.
      const production = authHarness({ restore: async () => alice, proof: testIdentity }, {
        authPairing: { issues: ['Session', 'TestIdentity'] },
        provider: { authenticate: provider.authenticate },
      })
      await production.scope.restore()
      Expect(production.scope.session).toEqual({ state: 'Error', message: 'Unable to restore your session.' })
      Expect(testings).toEqual([true, undefined])
      Expect(failures).toHaveLength(1)
      Expect(failures[0]).toContain('Auth Deterministic cannot issue TestIdentity sign-in proofs; only TestAuth can.')
      production.scope.dispose()
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

  Test('releases the data-side session before the provider signs out and retries an unconfirmed release', async () => {
    const order: string[] = []
    let failRelease = true
    const harness = authHarness({
      restore: async () => alice,
      signOut: async () => {
        order.push('provider')
        return { status: 'completed' }
      },
    }, {
      provider: {
        authenticate: async () => ({
          accountId: 'account-a',
          release: async () => {
            order.push('release')
            if (failRelease) {
              throw new HostEnvironmentError('offline')
            }
          },
        }),
      },
    })
    await harness.scope.restore()
    Expect(await harness.scope.signOut()).toEqual({
      status: 'error',
      message: 'Signed out on this device. Remote sign-out could not be confirmed.',
    })
    Expect(order).toEqual(['release', 'provider'])
    failRelease = false
    Expect(await harness.scope.signOut()).toEqual({ status: 'completed' })
    Expect(order).toEqual(['release', 'provider', 'release', 'provider'])
    Expect(await harness.scope.signOut()).toEqual({ status: 'completed' })
    Expect(order).toEqual(['release', 'provider', 'release', 'provider', 'provider'])
    harness.scope.dispose()
  })

  Test(
    'a sign-in during a pending release waits for the provider sign-out, which cannot end the new session',
    async () => {
      const events: string[] = []
      const releasing = Deferred<void>()
      let signedIn: string | undefined
      const harness = authHarness({
        restore: async () => {
          signedIn = 'alice'
          return alice
        },
        signIn: async () => {
          events.push('provider signIn bob')
          signedIn = 'bob'
          return { outcome: { status: 'completed' }, session: bob }
        },
        signOut: async signal => {
          events.push(`provider signOut of ${signedIn} aborted=${signal.aborted}`)
          signedIn = undefined
          return { status: 'completed' }
        },
      }, {
        provider: {
          authenticate: async context => ({
            accountId: accountOf(context.principal),
            release: async () => {
              await releasing.promise
              events.push(`release ${context.principal.subject}`)
            },
          }),
        },
      })
      await harness.scope.restore()
      const signingOut = harness.scope.signOut()
      Expect(harness.scope.session).toEqual({ state: 'SignedOut' })
      const signingIn = harness.scope.signIn(input)
      await until(() => harness.scope.session.state === 'Authenticating')
      await settle()
      Expect(events).toEqual([])
      releasing.resolve()
      Expect(await signingIn).toEqual({ status: 'completed' })
      Expect(await signingOut).toEqual({ status: 'cancelled' })
      Expect(events).toEqual(['release alice', 'provider signOut of alice aborted=false', 'provider signIn bob'])
      Expect(signedIn).toBe('bob')
      Expect(harness.scope.session.identity?.accountId).toBe('account-b')
      harness.scope.dispose()
    },
  )

  Test(
    'a release that outlasts its deadline is abandoned, the provider signs out, and the next sign-out retries it',
    async () => {
      const clock = manualTimers()
      const order: string[] = []
      const signals: AbortSignal[] = []
      let hang = true
      const harness = authHarness({
        restore: async () => alice,
        signOut: async () => {
          order.push('provider')
          return { status: 'completed' }
        },
      }, {
        timers: clock.timers,
        provider: {
          authenticate: async () => ({
            accountId: 'account-a',
            release: async signal => {
              order.push('release')
              signals.push(signal)
              if (hang) {
                // A hung revoke that ignores its signal still cannot hold back the provider sign-out.
                await new Promise<never>(() => undefined)
              }
            },
          }),
        },
      })
      await harness.scope.restore()
      const signingOut = harness.scope.signOut()
      await until(() => clock.pending.length === 1)
      Expect(clock.pending[0]!.delayMs).toBe(5_000)
      await settle()
      Expect(order).toEqual(['release'])
      clock.fire()
      Expect(await signingOut).toEqual({
        status: 'error',
        message: 'Signed out on this device. Remote sign-out could not be confirmed.',
      })
      Expect(order).toEqual(['release', 'provider'])
      Expect(signals[0]!.aborted).toBe(true)
      hang = false
      Expect(await harness.scope.signOut()).toEqual({ status: 'completed' })
      Expect(order).toEqual(['release', 'provider', 'release', 'provider'])
      Expect(signals[1]!.aborted).toBe(false)
      Expect(clock.pending).toEqual([])
      harness.scope.dispose()
    },
  )

  Test('stamps checked proofs and refuses expired, mismatched, and unissued ones', async () => {
    const cases: readonly [TR.AuthIssuedProof, TR.AuthPairing | undefined, string | undefined][] = [
      [{ kind: 'Session', issuer: 'local', subject: 'alice', value: { token: 't' } }, undefined, undefined],
      [{ kind: 'Session', issuer: 'local', subject: 'alice', value: {}, expiresAt: 0 }, undefined, 'expired'],
      [{ kind: 'Session', issuer: 'local', subject: 'bob', value: {} }, undefined, 'does not match'],
      [{ kind: 'Session', issuer: 'elsewhere', subject: 'alice', value: {} }, undefined, 'does not match'],
      [{ kind: 'IdentityToken', issuer: 'local', subject: 'alice', token: 't' }, undefined, 'does not match'],
      [
        { kind: 'Session', issuer: 'local', subject: 'alice', value: {} },
        { issues: ['IdentityToken'] },
        'does not issue',
      ],
    ]
    for (const [issued, pairing, problem] of cases) {
      let proof: TR.AuthProof | undefined
      let failure = ''
      const harness = authHarness({ restore: async () => alice, proof: async () => issued }, {
        authPairing: pairing,
        // The datasource also accepts IdentityToken, so an auth issuing only that kind still pairs.
        dataPairing: { accepts: [{ kind: 'Session' }, { kind: 'IdentityToken' }], supports: [] },
        provider: {
          authenticate: async context => {
            try {
              proof = await context.proof('Session', context.signal)
            } catch (error) {
              failure = String(error)
              throw error
            }
            return { accountId: 'account-a' }
          },
        },
      })
      await harness.scope.restore()
      if (problem === undefined) {
        Expect(proof).toEqual({ ...issued, provider: 'Deterministic' })
        Expect(Object.isFrozen(proof)).toBe(true)
        Expect(harness.scope.session.state).toBe('SignedIn')
      } else {
        Expect(failure).toContain(problem)
        Expect(JSON.stringify(TR.Auth.Session(harness.scope).evaluate().jsValue)).toBe('{"State":"Error"}')
      }
      harness.scope.dispose()
    }
  })

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

    const pending = Deferred<TR.AuthConnectionSession>()
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

    const pending = Deferred<TR.AuthConnectionSession>()
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
    Expect(harness.contexts).toEqual([])
    harness.scope.dispose()
  })

  Test('invalidates an in-flight resource credential and the old broker on account switch', async () => {
    const pending = Deferred<string>()
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
        authenticate: async context => ({
          accountId: accountOf(context.principal),
          credential: context.principal.subject === 'alice' ? () => pending.promise : async () => 'new-secret',
        }),
      },
    })
    await harness.scope.restore()
    const oldBroker = harness.contexts[0]!.auth!
    const credential = oldBroker.credential()
    harness.emit(bob)
    pending.resolve('old-secret')
    await Expect(credential).rejects.toThrow('no longer active')
    Expect(oldBroker.signal.aborted).toBe(true)
    await Expect(oldBroker.credential()).rejects.toThrow('Sign in')
    await until(() => harness.contexts.length === 2)
    Expect(harness.contexts[1]!.auth!.accountId).toBe('account-b')
    Expect(await harness.contexts[1]!.auth!.credential()).toBe('new-secret')
    harness.scope.dispose()
  })

  Test('rejects an empty resource credential and a datasource without one', async () => {
    const harness = authHarness({ restore: async () => alice }, {
      provider: { authenticate: async () => ({ accountId: 'account-a', credential: async () => '' }) },
    })
    await harness.scope.restore()
    await Expect(harness.contexts[0]!.auth!.credential()).rejects.toThrow('not valid')
    harness.scope.dispose()
    const without = authHarness({ restore: async () => alice }, {
      provider: { authenticate: async () => ({ accountId: 'account-a' }) },
    })
    await without.scope.restore()
    await Expect(without.contexts[0]!.auth!.credential()).rejects.toThrow('does not issue resource credentials')
    without.scope.dispose()
  })

  Test('isolates two mounts of the same schema and clears only the departing account', async () => {
    const declaration = TR.Data.Schema(definition)
    const contexts: TR.DataProviderContext[] = []
    const first = authHarness({ restore: async () => alice }, { contexts, declaration })
    const second = authHarness({ restore: async () => bob }, { contexts, declaration })
    await Promise.all([first.scope.restore(), second.scope.restore()])
    const firstStore = first.store
    const secondStore = second.store
    Expect(firstStore).not.toBe(secondStore)
    createNote(firstStore, 'Alice private')
    createNote(secondStore, 'Bob private', 'account-b')
    Expect(firstStore.query({ entity: 'Note', filters: [] }).map(row => (row as { Body: string }).Body)).toEqual([
      'Alice private',
    ])
    Expect(secondStore.query({ entity: 'Note', filters: [] }).map(row => (row as { Body: string }).Body)).toEqual([
      'Bob private',
    ])
    Expect(contexts.map(context => context.storageKey).sort()).toEqual([
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
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          save: async value => {
            saves.push(value)
            started.resolve()
            await pending.promise
          },
        }),
      },
    })
    await harness.scope.restore()
    const store = harness.store
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
    const harness = authHarness({ restore: async () => alice }, {
      provider: { connect: () => ({ load: () => pending.promise, save: () => undefined }) },
    })
    await harness.scope.restore()
    const declaration = harness.declaration
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
    const pending = Deferred<TR.AuthConnectionSession>()
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
    const store = harness.store
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

  Test('observes provider account transitions through a signed-out interval', async () => {
    const harness = authHarness({ restore: async () => alice })
    await harness.scope.restore()
    const store = harness.store
    const previous = store.entity('Account', 'account-a')
    harness.emit({ state: 'SignedOut' })
    Expect(harness.scope.session.identity).toBeUndefined()
    Expect(TR.Data.EntityAvailability(previous)?.status).not.toBe('available')
    harness.emit(bob)
    Expect(harness.scope.session).toEqual({ state: 'Authenticating' })
    await until(() => harness.scope.session.identity?.accountId === 'account-b')
    Expect(harness.stopped()).toBe(0)
    harness.scope.dispose()
    Expect(harness.stopped()).toBe(1)
  })

  Test('observes provider sign-in after an initially signed-out restore', async () => {
    const harness = authHarness()
    await harness.scope.restore()
    harness.emit(alice)
    await until(() => harness.scope.session.identity?.accountId === 'account-a')
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
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          save: () => undefined,
          invalidateAuth: () => cleanup.promise,
        }),
      },
    })
    await harness.scope.restore()
    const declaration = harness.declaration
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
    const declaration = harness.declaration
    let invalidated = 0
    const source = (cleanup: Promise<void>) =>
      TR.Data.Configure(
        TR.Data.Declaration(
          'Durable',
          {
            ...dataProvider(),
            connect: () => ({
              load: () => accountSnapshot('account-a'),
              save: () => undefined,
              invalidateAuth: () => {
                invalidated += 1
                return cleanup
              },
            }),
          },
          undefined,
          sessionPairing,
        ),
        {},
      )
    harness.scope.bindDatasources([{ store: declaration, source: source(oldCleanup.promise) }])
    await until(() => harness.scope.session.state === 'SignedIn')
    // A different account datasource resolves the account again under a new lifetime.
    harness.scope.bindDatasources([{ store: declaration, source: source(newCleanup.promise) }])
    await until(() => harness.scope.session.state === 'SignedIn')
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

  Test('retains synchronous signed-out notifications until explicit disposal', async () => {
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
    Expect(stops).toBe(0)
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
    const pending = Deferred<TR.AuthConnectionSession>()
    const harness = authHarness({ restore: () => pending.promise })
    const schema = TR.Data.Schema(definition)
    const account = TR.Alias(TR.Auth.Account(harness.scope, schema, 'Account'))
    const contexts: unknown[] = []
    const localContexts: unknown[] = []
    const entityHint = { readKind: 'entity' as const, subjectType: 'Account' }
    const readNet = {
      app: {
        readNet: {
          loading: (_: unknown, context: TR.Evaluable) => {
            contexts.push(context.evaluate().jsValue)
            return 'app loading'
          },
          unauthorized: (_: unknown, context: TR.Evaluable) => {
            contexts.push(context.evaluate().jsValue)
            return 'app login'
          },
        },
      },
    } as unknown as TR.TaoProps
    Expect(TR.GuardRender(account, [], () => 'private', readNet, entityHint)).toBe('app loading')
    Expect(TR.GuardRender(
      account,
      [['loading', context => {
        localContexts.push(context.evaluate().jsValue)
        return 'site loading'
      }]],
      () => 'private',
      readNet,
      entityHint,
    )).toBe('site loading')
    const restoring = harness.scope.restore()
    pending.resolve({ state: 'SignedOut' })
    await restoring
    Expect(account.evaluate().jsValue).toBeUndefined()
    Expect(TR.GuardRender(account, [], () => 'private', readNet, entityHint)).toBe('app login')
    Expect(contexts).toMatchObject([
      { State: 'loading', ReadKind: 'account', LoadingPhase: 'initial' },
      { State: 'unauthorized', ReadKind: 'account', UnauthorizedReason: 'signed-out' },
    ])
    Expect(localContexts).toMatchObject([{ State: 'loading', ReadKind: 'account', SubjectType: 'Account' }])
    Expect((contexts[1] as { Message: string; SubjectType: string }).Message).toBe('Sign in to view this account.')
    Expect((contexts[1] as { SubjectType: string }).SubjectType).toBe('Account')
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
    const declaration = harness.declaration
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
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
        connect: () => ({
          load: () => accountSnapshot('account-a'),
          save: () => undefined,
          submit: () => receipt.promise,
        }),
      },
    })
    await harness.scope.restore()
    const declaration = harness.declaration
    const account = TR.Auth.Account(harness.scope, declaration, 'Account')
    const save = TR.Auth.SaveProfile(harness.scope, account, { DisplayName: TR.Value('Confirmed') })
    Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Alice')
    receipt.resolve({ status: 'saved' })
    Expect(await save).toEqual({ status: 'completed' })
    Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Confirmed')
    harness.scope.dispose()
  })

  Test('denies reads and every write path against another account including owner reassignment', async () => {
    const snapshot = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 1,
      nextId: 1,
      rows: {
        Account: [{ Id: 'account-a', DisplayName: 'Alice' }, { Id: 'account-b', DisplayName: 'Bob' }],
        Note: [{ Id: 'bob-note', Body: 'private', Owner: 'account-b' }],
      },
    })
    const harness = authHarness({ restore: async () => alice }, {
      provider: { connect: () => ({ load: () => snapshot, save: () => undefined }) },
    })
    await harness.scope.restore()
    const store = harness.store
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
    const store = harness.store
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
    let observer: TaoDataConnectionObserver | undefined
    const baselines: string[] = []
    const harness = authHarness({ restore: async () => alice }, {
      provider: {
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
      },
    })
    await harness.scope.restore()
    const store = harness.store
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
      const harness = authHarness({ restore: async () => alice }, {
        provider: {
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
        },
      })
      await harness.scope.restore()
      const declaration = harness.declaration
      TR.Auth.BindAccount(harness.scope, declaration, 'Account')
      const account = TR.Auth.Account(harness.scope)
      const result = await TR.Auth.SaveProfile(harness.scope, account, { DisplayName: TR.Value('Unsaved') })
      Expect(result.status).toBe(rejection ? 'error' : 'rejected')
      Expect(TR.Member(account, ['DisplayName']).evaluate().jsValue).toBe('Alice')
      harness.scope.dispose()
    }
  })

  Test('keeps entity picker candidates within the explicitly mounted account scope', async () => {
    const declaration = TR.Data.Schema(definition)
    const first = authHarness({ restore: async () => alice }, { declaration })
    const second = authHarness({ restore: async () => bob }, { declaration })
    await Promise.all([first.scope.restore(), second.scope.restore()])
    const firstStore = first.store
    const secondStore = second.store
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
      TR.Auth.Declaration('TestAuth', { testing: true, connect: () => authConnection() }, { issues: ['TestIdentity'] }),
      {},
    )
    const scope = TR.Auth.CreateScope(source)
    const declaration = TR.Data.Schema(definition)
    scope.bindDatasources([{ store: declaration, source: dataSource([]) }])
    const store = scope.store(declaration)
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

const sessionPairing: TR.DataPairing = { accepts: [{ kind: 'Session' }], supports: [] }
const testIdentityPairing: TR.DataPairing = { accepts: [{ kind: 'TestIdentity' }], supports: [] }

/** HarnessOptions default to a Session-issuing auth and a Session-accepting datasource; `null` omits pairing. */
type HarnessOptions = {
  authPairing?: TR.AuthPairing | null
  bind?: false
  contexts?: TR.DataProviderContext[]
  dataPairing?: TR.DataPairing | null
  declaration?: TR.DataSchema
  provider?: Partial<TR.DataProvider>
  testing?: true
  timers?: ReturnType<typeof manualTimers>['timers']
}

/** authHarness mounts a deterministic auth provider over one bound account datasource. */
function authHarness(overrides: Partial<TR.AuthConnection> = {}, options: HarnessOptions = {}) {
  let listener: ((session: TR.AuthConnectionSession) => void) | undefined
  let closed = 0
  let stopped = 0
  const connection: TR.AuthConnection = {
    ...authConnection(),
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
  const source = TR.Auth.Configure(
    TR.Auth.Declaration(
      'Deterministic',
      { ...(options.testing ? { testing: true as const } : {}), connect: () => connection },
      options.authPairing === null ? undefined : options.authPairing ?? { issues: ['Session'] },
    ),
    {},
  )
  const scope = options.timers ? new RuntimeAuthScope(source, options.timers) : TR.Auth.CreateScope(source)
  const declaration = options.declaration ?? TR.Data.Schema(definition)
  const contexts = options.contexts ?? []
  const data = dataSource(contexts, options.provider, options.dataPairing)
  if (options.bind !== false) {
    scope.bindDatasources([{ store: declaration, source: data }])
  }
  return {
    scope,
    contexts,
    declaration,
    source: data,
    store: scope.store(declaration),
    emit: (session: TR.AuthConnectionSession) => listener?.(session),
    closed: () => closed,
    stopped: () => stopped,
  }
}

/** manualTimers records scheduled callbacks so a test fires the release deadline itself. */
function manualTimers() {
  const pending: { callback: () => void; delayMs: number }[] = []
  return {
    pending,
    timers: {
      clearTimeout: (handle: unknown) => {
        const index = pending.findIndex(timer => timer === handle)
        if (index >= 0) {
          pending.splice(index, 1)
        }
      },
      setTimeout: (callback: () => void, delayMs: number) => {
        const timer = { callback, delayMs }
        pending.push(timer)
        return timer
      },
    },
    fire: () => {
      for (const timer of pending.splice(0)) {
        timer.callback()
      }
    },
  }
}

function authConnection(): TR.AuthConnection {
  return {
    capabilities: { methods: ['Password'] },
    restore: async () => ({ state: 'SignedOut' }),
    signIn: async () => ({ outcome: { status: 'completed' }, session: alice }),
    signOut: async () => ({ status: 'completed' }),
    proof: async () => ({ kind: 'Session', issuer: 'local', subject: 'alice', value: {} }),
  }
}

/** dataProvider resolves `alice` to `account-a` and `bob` to `account-b`, the way a server would. */
function dataProvider(provider: Partial<TR.DataProvider> = {}): TR.DataProvider {
  return {
    authenticate: async context => ({
      accountId: accountOf(context.principal),
      credential: async () => 'private-resource-credential',
    }),
    connect: context => ({ load: () => accountSnapshot(context.auth!.accountId), save: () => undefined }),
    ...provider,
  }
}

function dataSource(
  contexts: TR.DataProviderContext[],
  provider: Partial<TR.DataProvider> = {},
  pairing: TR.DataPairing | null = sessionPairing,
): TR.ConfiguredDatasource {
  const base = dataProvider(provider)
  return TR.Data.Configure(
    TR.Data.Declaration(
      'Remote',
      {
        ...base,
        connect: context => {
          contexts.push(context)
          return base.connect(context)
        },
      },
      undefined,
      pairing ?? undefined,
    ),
    {},
  )
}

function accountOf(principal: TR.AuthPrincipal): string {
  return `account-${principal.subject.slice(0, 1)}`
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
