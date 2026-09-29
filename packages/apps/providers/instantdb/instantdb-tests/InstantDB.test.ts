import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test, until } from '@shared/test'
import { acquireInstantClient } from '../instantdb-src/instant-clients'
import { InstantDBProvider } from '../instantdb-src/InstantDB'
import { notesSchema, publicNotesSchema } from './fixtures'

type Rows = Record<string, Record<string, unknown>[]>
type Chunk = Readonly<{ args?: unknown; id: string; namespace: string; op: string }>

let appCounter = 0
/** Every test takes its own app id, because the client registry is shared by the whole process. */
const nextAppId = (): string => `app-${++appCounter}`

function envelope(rows: Rows, nextId = 1): string {
  return JSON.stringify({ formatVersion: 1, nextId, rows, schemaVersion: 1 })
}

function connect(
  sdk: ReturnType<typeof fakeInstantSDK>,
  appId: string,
  schema: TR.DataSchemaDefinition = publicNotesSchema,
  extra: Partial<TR.DataProviderContext> = {},
): TR.DataConnection {
  return InstantDBProvider(() => sdk.instantSDK as never).connect({
    configuration: { AppId: appId },
    schema,
    storageKey: 'Notes',
    ...extra,
  })
}

async function loaded(sdk: ReturnType<typeof fakeInstantSDK>, connection: TR.DataConnection, data: unknown) {
  const loading = connection.load() as Promise<string | undefined>
  sdk.latestSubscription()({ data })
  return JSON.parse((await loading)!) as { nextId: number; rows: Rows }
}

Describe('InstantDB provider', () => {
  Test('shares one client per address, subscribes every namespace, and projects rows into a snapshot', async () => {
    const sdk = fakeInstantSDK()
    const appId = nextAppId()
    const first = InstantDBProvider(() => sdk.instantSDK as never).connect({
      configuration: {
        ApiURI: ' http://localhost:9020 ',
        AppId: ` ${appId} `,
        WebsocketURI: ' ws://localhost:9020/runtime/session ',
      },
      schema: publicNotesSchema,
      storageKey: 'Notes',
    })
    const second = InstantDBProvider(() => sdk.instantSDK as never).connect({
      configuration: {
        ApiURI: 'http://localhost:9020',
        AppId: appId,
        WebsocketURI: 'ws://localhost:9020/runtime/session',
      },
      schema: notesSchema,
      storageKey: 'Other',
    })

    Expect(sdk.inits).toHaveLength(2)
    Expect(sdk.inits[0]).toMatchObject({
      apiURI: 'http://localhost:9020',
      appId,
      websocketURI: 'ws://localhost:9020/runtime/session',
    })
    // The second datasource's namespaces join the first's on the one shared client.
    Expect(Object.keys((sdk.inits[1]!['schema'] as { entities: object }).entities).sort()).toEqual([
      '$users',
      'accounts',
      'notes',
      'tags',
    ])
    Expect(sdk.cores).toHaveLength(1)

    const loading = first.load() as Promise<string | undefined>
    Expect(sdk.core().queries.at(-1)).toEqual({
      notes: {},
      tags: { note: { $: { fields: ['id'] } } },
    })
    sdk.latestSubscription()({
      data: {
        notes: [{ body: 'hello', id: uuid(1), pinned: true, ref: 'EXT-1' }],
        tags: [{ id: uuid(2), label: 'first', note: [{ id: uuid(1) }] }],
      },
    })
    Expect(JSON.parse((await loading)!)).toEqual({
      formatVersion: 1,
      nextId: 1,
      rows: {
        Note: [{ Body: 'hello', Id: uuid(1), Pinned: true, Ref: 'EXT-1' }],
        Tag: [{ Id: uuid(2), Label: 'first', Note: uuid(1) }],
      },
      schemaVersion: 1,
    })

    // A result between load and the runtime's subscribe replays on subscribe, errors included.
    sdk.latestSubscription()({ data: { notes: [], tags: [] } })
    const snapshots: Rows[] = []
    const errors: unknown[] = []
    const stop = first.subscribe!({
      error: error => errors.push(error),
      snapshot: snapshot => snapshots.push((JSON.parse(snapshot!) as { rows: Rows }).rows),
    })
    Expect(snapshots).toEqual([{ Note: [], Tag: [] }])
    sdk.latestSubscription()({ data: { notes: [], tags: [] } })
    Expect(snapshots).toHaveLength(1)
    sdk.latestSubscription()({ error: { message: 'offline' } })
    Expect(errors).toHaveLength(1)
    Expect(Errors.messageOf(errors[0])).toBe('InstantDB subscription failed.')
    stop()

    first.close?.()
    Expect(sdk.core().unsubscribes).toBe(1)
    Expect(sdk.core().shutdowns).toBe(0)
    second.close?.()
    second.close?.()
    Expect(sdk.core().shutdowns).toBe(1)
  })

  Test('turns each save into one transaction of per-row creates, field updates, links, and deletes', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    const empty = await loaded(sdk, connection, { notes: [], tags: [] })

    const created = envelope({
      Note: [{ Body: 'hello', Id: 'Note-1', Pinned: false, Ref: null }],
      Tag: [{ Id: 'Tag-1', Label: 'first', Note: 'Note-1' }],
    }, 3)
    await connection.save(created, [], { previousSnapshot: envelope(empty.rows) })
    Expect(sdk.core().transactions).toEqual([[
      { args: { body: 'hello', pinned: false }, id: uuid(101), namespace: 'notes', op: 'update' },
      { args: { label: 'first' }, id: uuid(102), namespace: 'tags', op: 'update' },
      { args: { note: uuid(101) }, id: uuid(102), namespace: 'tags', op: 'link' },
    ]])

    // Only changed fields travel, plus any field an intent says the author set to its old value.
    const edited = envelope({
      Note: [
        { Body: 'hello', Id: 'Note-1', Pinned: true, Ref: 'EXT-1' },
        { Body: 'second', Id: 'Note-2', Pinned: false, Ref: null },
      ],
      Tag: [{ Id: 'Tag-1', Label: 'first', Note: 'Note-2' }],
    }, 3)
    await connection.save(edited, [{ entity: 'Note', fields: ['Body'], id: 'Note-1' }], {
      previousSnapshot: created,
    })
    Expect(sdk.core().transactions[1]).toEqual([
      { args: { body: 'hello', pinned: true, ref: 'EXT-1' }, id: uuid(101), namespace: 'notes', op: 'update' },
      { args: { body: 'second', pinned: false }, id: uuid(103), namespace: 'notes', op: 'update' },
      { args: { note: uuid(103) }, id: uuid(102), namespace: 'tags', op: 'link' },
    ])

    await connection.save(
      envelope({ Note: [{ Body: 'second', Id: 'Note-2', Pinned: false, Ref: null }], Tag: [] }),
      [],
      {
        previousSnapshot: edited,
      },
    )
    Expect(sdk.core().transactions[2]).toEqual([
      { id: uuid(101), namespace: 'notes', op: 'delete' },
      { id: uuid(102), namespace: 'tags', op: 'delete' },
    ])

    // A save that changes nothing sends nothing.
    await connection.save(edited, [], { previousSnapshot: edited })
    Expect(sdk.core().transactions).toHaveLength(3)

    // The authority's rows project back under the ids the store created them with, and keep
    // the store's row order; the id counter follows the latest save.
    sdk.latestSubscription()({
      data: {
        notes: [
          { body: 'second', id: uuid(103), pinned: false },
          { body: 'hello', id: uuid(101), pinned: true, ref: 'EXT-1' },
          { body: 'peer', id: uuid(7), pinned: false },
        ],
        tags: [{ id: uuid(102), label: 'first', note: { id: uuid(103) } }],
      },
    })
    const published: string[] = []
    connection.subscribe!({ error: () => {}, snapshot: snapshot => published.push(snapshot!) })
    Expect(JSON.parse(published[0]!)).toMatchObject({
      nextId: 3,
      rows: {
        Note: [
          { Id: 'Note-1' },
          { Id: 'Note-2' },
          { Body: 'peer', Id: uuid(7) },
        ],
        Tag: [{ Id: 'Tag-1', Note: 'Note-2' }],
      },
    })
    Expect(connection.referenceToken!({ entity: 'Note', id: 'Note-1', schema: 'InstantPublicNotes' })).toBe(uuid(101))
    Expect(connection.resolveReference!({ entity: 'Note', schema: 'InstantPublicNotes', token: uuid(101) })).toBe(
      'Note-1',
    )
    Expect(connection.resolveReference!({ entity: 'Note', schema: 'InstantPublicNotes', token: uuid(7) })).toBe(
      uuid(7),
    )
    connection.close?.()
  })

  Test('clears an optional relation with an unlink and keeps a UUID row id as its own', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId(), notesSchema)
    const account = { DisplayName: 'Alice', Id: uuid(50) }
    const note = { Body: 'b', CreatedAt: 1, Id: uuid(51), Owner: uuid(50), Pinned: false, Status: 'Draft' }
    const tag = { Id: uuid(52), Label: 'x', Note: uuid(51) }
    const before = envelope({ Account: [account], Note: [note], Tag: [tag] })
    await connection.save(envelope({ Account: [account], Note: [note], Tag: [{ ...tag, Note: null }] }), [], {
      previousSnapshot: before,
    })
    Expect(sdk.core().transactions).toEqual([[
      { args: { note: uuid(51) }, id: uuid(52), namespace: 'tags', op: 'unlink' },
    ]])
    connection.close?.()
  })

  Test('reads absent or mistyped values as defaults and leaves out rows whose required relation is gone', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId(), notesSchema)
    const snapshot = await loaded(sdk, connection, {
      accounts: [{ id: uuid(1) }],
      notes: [
        { body: 42, id: uuid(2), owner: [{ id: uuid(1) }], status: 'Unknown' },
        { body: 'orphan', id: uuid(3), owner: [] },
        { body: 'foreign', id: uuid(4), owner: { id: uuid(9) } },
      ],
      tags: [
        { id: uuid(5), label: 'kept', note: [{ id: uuid(2) }] },
        { id: uuid(6), label: 'loose', note: [{ id: uuid(3) }] },
      ],
    })
    Expect(snapshot.rows).toEqual({
      Account: [{ DisplayName: null, Id: uuid(1) }],
      Note: [{ Body: '', CreatedAt: 0, Id: uuid(2), Owner: uuid(1), Pinned: false, Status: 'Draft' }],
      // The optional relation to a left-out note reads as empty.
      Tag: [
        { Id: uuid(5), Label: 'kept', Note: uuid(2) },
        { Id: uuid(6), Label: 'loose', Note: null },
      ],
    })
    connection.close?.()

    // A signed-in store keeps a row whose related row this account cannot read.
    const authenticated = connect(sdk, nextAppId(), notesSchema, { auth: {} as never })
    const partial = await loaded(sdk, authenticated, {
      notes: [{ body: 'shared', id: uuid(4), owner: { id: uuid(9) } }],
    })
    Expect(partial.rows['Note']).toEqual([
      { Body: 'shared', CreatedAt: 0, Id: uuid(4), Owner: uuid(9), Pinned: false, Status: 'Draft' },
    ])
    authenticated.close?.()
  })

  Test('names a server refusal by kind and keeps the raw failure out of the message', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    const before = envelope({ Note: [], Tag: [] })
    const after = envelope({ Note: [{ Body: 'x', Id: 'Note-1', Pinned: false, Ref: null }], Tag: [] })

    sdk.core().failTransactionsWith({ body: { message: 'token=hidden', type: 'permission-denied' }, status: 400 })
    const refused = connection.save(after, [], { previousSnapshot: before }) as Promise<void>
    await Expect(refused).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    await Expect(refused).rejects.toThrow('InstantDB save failed (permission-denied).')

    sdk.core().failTransactionsWith({ body: { type: 'Not A Kind; token=hidden' } })
    const raw = connection.save(after, [], { previousSnapshot: before }) as Promise<void>
    await Expect(raw).rejects.toThrow(/^InstantDB save failed\.$/)

    const categorized = new Errors.UserInputError('A categorized failure.')
    sdk.core().failTransactionsWith(categorized)
    await Expect(connection.save(after, [], { previousSnapshot: before }) as Promise<void>).rejects.toBe(categorized)
    connection.close?.()
  })

  Test('classifies load failures and recovers a load after an unsubscribe failure', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    const failing = connection.load() as Promise<string | undefined>
    sdk.latestSubscription()({ error: { message: 'device is offline' } })
    await Expect(failing).rejects.toThrow('InstantDB load failed.')
    await Expect(failing).rejects.toBeInstanceOf(Errors.HostEnvironmentError)

    sdk.core().failNextUnsubscribeWith({ message: 'raw unsubscribe detail' })
    await Expect(connection.load() as Promise<string | undefined>).rejects.toThrow('InstantDB unsubscribe failed.')

    const recovered = connection.load() as Promise<string | undefined>
    sdk.latestSubscription()({ data: { notes: [{ body: 'back', id: uuid(1) }] } })
    Expect(JSON.parse((await recovered)!).rows.Note).toEqual([{ Body: 'back', Id: uuid(1), Pinned: false, Ref: null }])
    connection.close?.()
  })

  Test('aggregates unsubscribe and shutdown failures on close', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, nextAppId())
    await loaded(sdk, connection, {})
    sdk.core().failNextUnsubscribeWith(Errors.abortError('raw unsubscribe failure'))
    sdk.core().failNextShutdownWith('raw shutdown failure')
    Expect(() => connection.close?.()).toThrow('InstantDB cleanup failed during unsubscribe and shutdown.')
    Expect(sdk.core().shutdowns).toBe(1)
    connection.close?.()
    Expect(sdk.core().shutdowns).toBe(1)

    const categorized = new Errors.UnexpectedBehaviorError('Categorized shutdown failure.')
    const other = connect(sdk, nextAppId())
    sdk.core().failNextShutdownWith(categorized)
    let closeError: unknown
    try {
      other.close?.()
    } catch (error) {
      closeError = error
    }
    Expect(closeError).toBe(categorized)
  })

  Test('validates required configuration and the schema mapping before loading the SDK', () => {
    let sdkLoads = 0
    const provider = InstantDBProvider(() => {
      sdkLoads += 1
      return Errors.throwUnexpected('SDK should not load')
    })
    Expect(() => provider.connect({ configuration: {}, schema: publicNotesSchema, storageKey: 'Notes' })).toThrow(
      "InstantDB datasource configuration 'AppId' expects non-empty text.",
    )
    const compound = structuredClone(publicNotesSchema)
    compound.entities['Tag'] = { ...compound.entities['Tag']!, uniqueConstraints: [['Label', 'Note']] }
    Expect(() => provider.connect({ configuration: { AppId: 'a' }, schema: compound, storageKey: 'Notes' })).toThrow(
      "compound unique constraint 'Tag.Label + Note'",
    )
    Expect(sdkLoads).toBe(0)
  })
})

Describe('InstantDB sign-in', () => {
  const subject = uuid(60)
  const accountQuery = { accounts: { $: { fields: ['id'], where: { id: subject } } } }

  /** signIn authenticates with an InstantAuth Session proof for `appId`, as the runtime passes it. */
  function signIn(
    sdk: ReturnType<typeof fakeInstantSDK>,
    appId: string,
    options: { signal?: AbortSignal; value?: Record<string, unknown> } = {},
  ) {
    const context: TR.DataAuthenticationContext = {
      configuration: { AppId: appId },
      schema: notesSchema,
      principal: { issuer: `instantdb:${appId}`, subject },
      provider: 'InstantAuth',
      proof: (async () => ({
        issuer: `instantdb:${appId}`,
        kind: 'Session',
        provider: 'InstantAuth',
        subject,
        value: options.value ?? { appId, refreshToken: 'refresh-token' },
      })) as TR.DataAuthenticationContext['proof'],
      signal: options.signal ?? new AbortController().signal,
    }
    return InstantDBProvider(() => sdk.instantSDK as never).authenticate!(context)
  }

  /** answerAccountLookup serves the account lookup its first result once authenticate subscribes. */
  async function answerAccountLookup(sdk: ReturnType<typeof fakeInstantSDK>, rows: readonly object[]) {
    await until(() => sdk.cores.length > 0 && sdk.core().queries.length > 0, { description: 'the account lookup' })
    Expect(sdk.core().queries).toEqual([accountQuery])
    sdk.latestSubscription()({ data: { accounts: rows } })
  }

  Test(
    "creates the user's account row linked to its $users row on first sign-in and resolves to the user",
    async () => {
      const sdk = fakeInstantSDK({ signedIn: subject })
      const resolving = signIn(sdk, nextAppId())
      await answerAccountLookup(sdk, [])
      const authentication = await resolving
      Expect(authentication.accountId).toBe(subject)
      Expect(sdk.core().transactions).toEqual([[
        { args: {}, id: subject, namespace: 'accounts', op: 'create' },
        { args: { $user: subject }, id: subject, namespace: 'accounts', op: 'link' },
      ]])
      // The auth provider signed this very client in, so the token is not spent again.
      Expect(sdk.core().tokenSignIns).toEqual([])
      await until(() => sdk.core().unsubscribes === 1, { description: 'the lookup to unsubscribe' })

      // Release drops the lease authenticate took and never signs InstantDB out.
      await authentication.release!(new AbortController().signal)
      Expect(sdk.core().shutdowns).toBe(1)
      Expect(await sdk.core().getAuth()).toMatchObject({ id: subject })
    },
  )

  Test('keeps an existing account row and signs a client that has not caught up in with the token', async () => {
    const sdk = fakeInstantSDK({ tokenUser: subject })
    const resolving = signIn(sdk, nextAppId())
    await answerAccountLookup(sdk, [{ id: subject }])
    Expect((await resolving).accountId).toBe(subject)
    Expect(sdk.core().tokenSignIns).toEqual(['refresh-token'])
    Expect(sdk.core().transactions).toEqual([])
  })

  Test('accepts the row another device created first, and reports a create the server refused', async () => {
    // Both devices found no row; this one's create lost to the other's.
    const sdk = fakeInstantSDK({ signedIn: subject })
    const second = signIn(sdk, nextAppId())
    await until(() => sdk.cores.length > 0, { description: 'the shared client' })
    sdk.core().failTransactionsWith({ body: { type: 'record-not-unique' }, status: 400 })
    sdk.core().serveQueryOnce({ accounts: [{ id: subject }] })
    await answerAccountLookup(sdk, [])
    Expect((await second).accountId).toBe(subject)

    const refused = fakeInstantSDK({ signedIn: subject })
    const losing = signIn(refused, nextAppId())
    await until(() => refused.cores.length > 0, { description: 'the shared client' })
    refused.core().failTransactionsWith({ body: { message: 'token=hidden', type: 'permission-denied' }, status: 400 })
    await answerAccountLookup(refused, [])
    await Expect(losing).rejects.toThrow(/^InstantDB account setup failed \(permission-denied\)\.$/)
    // A failed sign-in holds no lease.
    Expect(refused.core().shutdowns).toBe(1)
  })

  Test(
    'refuses a proof for another InstantDB address or from another provider before touching the client',
    async () => {
      const sdk = fakeInstantSDK()
      const appId = nextAppId()
      await Expect(signIn(sdk, appId, { value: { appId: 'other-app', refreshToken: 'refresh-token' } })).rejects
        .toThrow(
          'Auth InstantAuth and Datasource InstantDB name different InstantDB apps. Give both the same AppId, ApiURI, and WebsocketURI.',
        )
      await Expect(
        signIn(sdk, appId, { value: { apiURI: 'http://localhost:9020', appId, refreshToken: 'refresh-token' } }),
      ).rejects.toBeInstanceOf(Errors.UserInputError)
      await Expect(signIn(sdk, appId, { value: { accountId: 'a', token: 't' } })).rejects.toThrow(
        'InstantDB accepts Session proofs from InstantAuth only.',
      )
      Expect(sdk.inits).toEqual([])
    },
  )

  Test('asks for a new sign-in when the server refuses the token or it signs in someone else', async () => {
    for (const options of [{ tokenRefusal: { status: 401 } }, { tokenUser: uuid(61) }]) {
      const sdk = fakeInstantSDK(options)
      const resolving = signIn(sdk, nextAppId())
      await Expect(resolving).rejects.toThrow(/^Sign in again to access account data\.$/)
      await Expect(resolving).rejects.toBeInstanceOf(Errors.UserInputError)
      Expect(sdk.core().queries).toEqual([])
      Expect(sdk.core().shutdowns).toBe(1)
    }
    const offline = fakeInstantSDK({ tokenRefusal: new TypeError('Network request failed') })
    const failing = signIn(offline, nextAppId())
    await Expect(failing).rejects.toThrow(/^InstantDB sign-in failed\.$/)
    await Expect(failing).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
  })

  Test('stops when the account lifetime ends during the lookup, releasing the client', async () => {
    const sdk = fakeInstantSDK({ signedIn: subject })
    const lifetime = new AbortController()
    const resolving = signIn(sdk, nextAppId(), { signal: lifetime.signal })
    await until(() => sdk.cores.length > 0 && sdk.core().queries.length > 0, { description: 'the account lookup' })
    lifetime.abort()
    await Expect(resolving).rejects.toThrow('The authentication request was cancelled.')
    Expect(sdk.core().transactions).toEqual([])
    Expect(sdk.core().shutdowns).toBe(1)
    await until(() => sdk.core().unsubscribes === 1, { description: 'the lookup to unsubscribe' })
  })
})

Describe('InstantDB sign-in with Clerk', () => {
  const clerkSubject = 'user_2clerk'
  const instantUser = uuid(70)
  const accountQuery = { accounts: { $: { fields: ['id'], where: { id: instantUser } } } }

  /** signIn authenticates with a Clerk IdentityToken proof, as the runtime passes it. */
  function signIn(
    sdk: ReturnType<typeof fakeInstantSDK>,
    appId: string,
    options: {
      configuration?: Record<string, unknown>
      provider?: string
      signal?: AbortSignal
      token?: string
    } = {},
  ) {
    const proofs: string[] = []
    const context: TR.DataAuthenticationContext = {
      configuration: options.configuration ?? { AppId: appId, ClerkClientName: 'clerk' },
      schema: notesSchema,
      principal: { issuer: 'https://clerk.example.test', subject: clerkSubject },
      provider: options.provider ?? 'Clerk',
      proof: (async (kind: string) => {
        proofs.push(kind)
        return {
          issuer: 'https://clerk.example.test',
          kind: 'IdentityToken',
          provider: 'Clerk',
          subject: clerkSubject,
          token: options.token ?? 'clerk-session-token',
        }
      }) as TR.DataAuthenticationContext['proof'],
      signal: options.signal ?? new AbortController().signal,
    }
    return { proofs, resolving: InstantDBProvider(() => sdk.instantSDK as never).authenticate!(context) }
  }

  async function answerAccountLookup(sdk: ReturnType<typeof fakeInstantSDK>, rows: readonly object[]) {
    await until(() => sdk.cores.length > 0 && sdk.core().queries.length > 0, { description: 'the account lookup' })
    Expect(sdk.core().queries).toEqual([accountQuery])
    sdk.latestSubscription()({ data: { accounts: rows } })
  }

  Test(
    'signs in through the registered Clerk client, resolves to the InstantDB user, and signs out on release',
    async () => {
      const sdk = fakeInstantSDK({ idTokenUser: instantUser })
      const { proofs, resolving } = signIn(sdk, nextAppId())
      await answerAccountLookup(sdk, [])
      const authentication = await resolving
      Expect(proofs).toEqual(['IdentityToken'])
      Expect(sdk.core().idTokenSignIns).toEqual([{ clientName: 'clerk', idToken: 'clerk-session-token' }])
      // The account is the InstantDB user, not the Clerk subject.
      Expect(authentication.accountId).toBe(instantUser)
      Expect(sdk.core().transactions).toEqual([[
        { args: {}, id: instantUser, namespace: 'accounts', op: 'create' },
        { args: { $user: instantUser }, id: instantUser, namespace: 'accounts', op: 'link' },
      ]])

      // Clerk knows nothing of InstantDB, so the session this datasource made ends with its release.
      await authentication.release!(new AbortController().signal)
      Expect(sdk.core().signOuts).toBe(1)
      Expect(sdk.core().shutdowns).toBe(1)
      Expect(await sdk.core().getAuth()).toBeNull()
      await authentication.release!(new AbortController().signal)
      Expect(sdk.core().signOuts).toBe(1)
    },
  )

  Test('keeps the lease through a failed sign-out, so a retried release can finish it', async () => {
    const sdk = fakeInstantSDK({ idTokenUser: instantUser })
    const { resolving } = signIn(sdk, nextAppId())
    await answerAccountLookup(sdk, [{ id: instantUser }])
    const authentication = await resolving
    sdk.core().failNextSignOutWith(new Errors.HostEnvironmentError('storage unavailable'))
    await Expect(authentication.release!(new AbortController().signal)).rejects.toThrow('storage unavailable')
    Expect(sdk.core().shutdowns).toBe(0)
    await authentication.release!(new AbortController().signal)
    Expect(sdk.core().signOuts).toBe(2)
    Expect(sdk.core().shutdowns).toBe(1)
  })

  Test('refuses a missing client name or an unknown auth provider before touching the client', async () => {
    const sdk = fakeInstantSDK()
    const appId = nextAppId()
    const unnamed = signIn(sdk, appId, { configuration: { AppId: appId } })
    await Expect(unnamed.resolving).rejects.toThrow(
      'Datasource InstantDB signs in with Clerk through a Clerk client registered with the InstantDB app; set ClerkClientName to the name it was registered under.',
    )
    Expect(unnamed.proofs).toEqual([])
    await Expect(signIn(sdk, appId, { provider: 'LocalAuth' }).resolving).rejects.toThrow(
      'InstantDB cannot sign in with LocalAuth. Use InstantAuth or Clerk.',
    )
    Expect(sdk.inits).toEqual([])
  })

  Test('names a refused token as a client problem and a network failure as a failed sign-in', async () => {
    const refused = fakeInstantSDK({ idTokenRefusal: { body: { message: 'secret' }, status: 400 } })
    const rejecting = signIn(refused, nextAppId()).resolving
    await Expect(rejecting).rejects.toThrow(
      "InstantDB refused the Clerk sign-in. Check that the InstantDB app has a Clerk client named 'clerk' for this Clerk instance, then sign in again.",
    )
    await Expect(rejecting).rejects.toBeInstanceOf(Errors.UserInputError)
    // Nothing signed in, so there is nothing to sign out; the lease is still returned.
    Expect(refused.core().signOuts).toBe(0)
    Expect(refused.core().shutdowns).toBe(1)

    const offline = fakeInstantSDK({ idTokenRefusal: new TypeError('Network request failed') })
    const failing = signIn(offline, nextAppId()).resolving
    await Expect(failing).rejects.toThrow(/^InstantDB sign-in failed\.$/)
    await Expect(failing).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
  })

  Test('signs out a Clerk sign-in whose account setup failed or was cancelled', async () => {
    const refused = fakeInstantSDK({ idTokenUser: instantUser })
    const losing = signIn(refused, nextAppId()).resolving
    await until(() => refused.cores.length > 0, { description: 'the shared client' })
    refused.core().failTransactionsWith({ body: { type: 'permission-denied' }, status: 400 })
    await answerAccountLookup(refused, [])
    await Expect(losing).rejects.toThrow(/^InstantDB account setup failed \(permission-denied\)\.$/)
    Expect(refused.core().signOuts).toBe(1)
    Expect(refused.core().shutdowns).toBe(1)

    const cancelled = fakeInstantSDK({ idTokenUser: instantUser })
    const lifetime = new AbortController()
    const resolving = signIn(cancelled, nextAppId(), { signal: lifetime.signal }).resolving
    await until(() => cancelled.cores.length > 0 && cancelled.core().queries.length > 0, {
      description: 'the account lookup',
    })
    lifetime.abort()
    await Expect(resolving).rejects.toThrow('The authentication request was cancelled.')
    Expect(cancelled.core().signOuts).toBe(1)
    Expect(cancelled.core().shutdowns).toBe(1)
  })

  Test('signs in one at a time on a shared client and ends only the session each one opened', async () => {
    let answerSignIns!: () => void
    const sdk = fakeInstantSDK({ idTokenGate: new Promise<void>(resolve => (answerSignIns = resolve)) })
    const appId = nextAppId()
    const account = (userId: string) => ({ data: { accounts: [{ id: userId }] } })
    const released = new AbortController().signal

    // A newer sign-in waits for a stale one still in flight, whose answer would otherwise land on
    // top of its own; the stale one, cancelled, ends only the session it opened.
    const lifetime = new AbortController()
    const stale = signIn(sdk, appId, { signal: lifetime.signal, token: 'stale-token' })
    await until(() => sdk.cores.length > 0 && sdk.core().idTokenSignIns.length > 0, {
      description: 'the stale sign-in',
    })
    const current = signIn(sdk, appId, { token: 'current-token' })
    await until(() => sdk.inits.length === 2, { description: 'the current lease' })
    Expect(sdk.core().idTokenSignIns).toHaveLength(1)
    lifetime.abort()
    answerSignIns()
    await Expect(stale.resolving).rejects.toThrow('The authentication request was cancelled.')
    await until(() => sdk.core().queries.length > 0, { description: 'the current account lookup' })
    sdk.latestSubscription()(account('user-of-current-token'))
    const authentication = await current.resolving
    Expect(sdk.core().idTokenSignIns.map(params => params.idToken)).toEqual(['stale-token', 'current-token'])
    Expect(authentication.accountId).toBe('user-of-current-token')
    Expect(sdk.core().signOuts).toBe(1)

    // A later sign-in replaces the session; releasing the replaced one leaves the later one alone.
    const later = signIn(sdk, appId, { token: 'later-token' })
    await until(() => sdk.core().queries.length > 1, { description: 'the later account lookup' })
    sdk.latestSubscription()(account('user-of-later-token'))
    const replacing = await later.resolving
    await authentication.release!(released)
    Expect(sdk.core().signOuts).toBe(1)
    Expect(await sdk.core().getAuth()).toMatchObject({ id: 'user-of-later-token' })
    await replacing.release!(released)
    Expect(sdk.core().signOuts).toBe(2)
    Expect(sdk.core().shutdowns).toBe(1)
  })
})

Describe('InstantDB client registry', () => {
  Test('keys clients by app and endpoints, counts leases, and releases once', () => {
    const sdk = fakeInstantSDK()
    const appId = nextAppId()
    const local = acquireInstantClient(sdk.instantSDK as never, { apiURI: 'http://localhost:9020', appId })
    const again = acquireInstantClient(sdk.instantSDK as never, { apiURI: 'http://localhost:9020', appId })
    const hosted = acquireInstantClient(sdk.instantSDK as never, { appId })
    Expect(again.db.core).toBe(local.db.core)
    Expect(hosted.db.core).not.toBe(local.db.core)
    // A lease without a schema reuses the client instead of calling init again.
    Expect(sdk.inits).toHaveLength(2)

    local.release()
    local.release()
    Expect(sdk.cores[0]!.shutdowns).toBe(0)
    again.release()
    Expect(sdk.cores[0]!.shutdowns).toBe(1)
    hosted.release()
    Expect(sdk.cores[1]!.shutdowns).toBe(1)
  })
})

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

type FakeCore = ReturnType<typeof fakeCore>

/**
 * FakeClientOptions set who a new client is signed in as and what signing in with a refresh token or
 * an external id token does.
 */
type FakeClientOptions = Readonly<{
  /** idTokenGate holds every id-token sign-in's answer until it settles. */
  idTokenGate?: Promise<void>
  idTokenRefusal?: unknown
  idTokenUser?: string
  signedIn?: string
  tokenRefusal?: unknown
  tokenUser?: string
}>

function fakeCore(options: FakeClientOptions = {}) {
  const state = {
    queries: [] as unknown[],
    queryOnceResult: {} as unknown,
    shutdownFailure: undefined as { error: unknown } | undefined,
    shutdowns: 0,
    signInFailure: (options.tokenRefusal === undefined ? undefined : { error: options.tokenRefusal }) as
      | { error: unknown }
      | undefined,
    idTokenSignIns: [] as Readonly<{ clientName: string; idToken: string }>[],
    signOutFailure: undefined as { error: unknown } | undefined,
    signOuts: 0,
    subscriptions: [] as ((result: unknown) => void)[],
    tokenSignIns: [] as string[],
    transactionFailure: undefined as { error: unknown } | undefined,
    transactions: [] as Chunk[][],
    unsubscribeFailure: undefined as { error: unknown } | undefined,
    unsubscribes: 0,
    user: (options.signedIn === undefined ? null : { id: options.signedIn, refresh_token: 'restored' }) as
      | Readonly<{ id: string; refresh_token: string }>
      | null,
  }
  let issued = 0
  return {
    auth: {
      signInWithToken: async (token: string) => {
        state.tokenSignIns.push(token)
        if (state.signInFailure !== undefined) {
          throw state.signInFailure.error
        }
        state.user = { id: options.tokenUser ?? `user-of-${token}`, refresh_token: token }
        return { user: state.user }
      },
      signInWithIdToken: async (params: Readonly<{ clientName: string; idToken: string }>) => {
        state.idTokenSignIns.push(params)
        await options.idTokenGate
        if (options.idTokenRefusal !== undefined) {
          throw options.idTokenRefusal
        }
        state.user = { id: options.idTokenUser ?? `user-of-${params.idToken}`, refresh_token: `issued-${++issued}` }
        return { user: state.user }
      },
      signOut: async () => {
        state.signOuts += 1
        const failure = state.signOutFailure
        state.signOutFailure = undefined
        if (failure !== undefined) {
          throw failure.error
        }
        state.user = null
      },
    },
    failNextSignOutWith: (error: unknown) => {
      state.signOutFailure = { error }
    },
    get idTokenSignIns() {
      return state.idTokenSignIns
    },
    get signOuts() {
      return state.signOuts
    },
    getAuth: async () => state.user,
    queryOnce: async () => ({ data: state.queryOnceResult }),
    serveQueryOnce: (data: unknown) => {
      state.queryOnceResult = data
    },
    get tokenSignIns() {
      return state.tokenSignIns
    },
    failNextShutdownWith: (error: unknown) => {
      state.shutdownFailure = { error }
    },
    failNextUnsubscribeWith: (error: unknown) => {
      state.unsubscribeFailure = { error }
    },
    failTransactionsWith: (error: unknown) => {
      state.transactionFailure = { error }
    },
    get queries() {
      return state.queries
    },
    get shutdowns() {
      return state.shutdowns
    },
    shutdown: () => {
      state.shutdowns += 1
      const failure = state.shutdownFailure
      state.shutdownFailure = undefined
      if (failure !== undefined) {
        throw failure.error
      }
    },
    subscribeQuery: (query: unknown, callback: (result: unknown) => void) => {
      state.queries.push(query)
      state.subscriptions.push(callback)
      return () => {
        state.unsubscribes += 1
        const failure = state.unsubscribeFailure
        state.unsubscribeFailure = undefined
        if (failure !== undefined) {
          throw failure.error
        }
      }
    },
    get subscriptions() {
      return state.subscriptions
    },
    transact: async (chunks: Chunk | Chunk[]) => {
      if (state.transactionFailure !== undefined) {
        throw state.transactionFailure.error
      }
      state.transactions.push(Array.isArray(chunks) ? chunks : [chunks])
      return { status: 'synced' }
    },
    get transactions() {
      return state.transactions
    },
    get unsubscribes() {
      return state.unsubscribes
    },
  }
}

/** fakeInstantSDK emulates the SDK boundary, including its one cached core per init config. */
function fakeInstantSDK(options: FakeClientOptions = {}) {
  const cores = new Map<string, FakeCore>()
  const inits: Record<string, unknown>[] = []
  let minted = 100
  const attribute = (valueType: string): Record<string, unknown> => {
    const definition: Record<string, unknown> = { valueType }
    return Object.assign(definition, {
      indexed: () => Object.assign(definition, { indexed: true }),
      optional: () => definition,
      unique: () => Object.assign(definition, { unique: true }),
    })
  }
  const row = (namespace: string, id: string) => ({
    // A created row's chained link travels with it, as the SDK's chunk does.
    create: (args: unknown) => {
      const created = { args, id, namespace, op: 'create' }
      return Object.defineProperty(created, 'link', {
        enumerable: false,
        value: (link: unknown) => [created, { args: link, id, namespace, op: 'link' }],
      })
    },
    delete: () => ({ id, namespace, op: 'delete' }),
    link: (args: unknown) => ({ args, id, namespace, op: 'link' }),
    unlink: (args: unknown) => ({ args, id, namespace, op: 'unlink' }),
    update: (args: unknown) => ({ args, id, namespace, op: 'update' }),
  })
  const instantSDK = {
    i: {
      boolean: () => attribute('boolean'),
      entity: (attrs: unknown) => ({ attrs }),
      json: () => attribute('json'),
      number: () => attribute('number'),
      schema: (definition: unknown) => definition,
      string: () => attribute('string'),
    },
    id: () => uuid(++minted),
    init: (config: Record<string, unknown>) => {
      inits.push(config)
      const key = JSON.stringify([config['appId'], config['apiURI'], config['websocketURI']])
      const core = cores.get(key) ?? fakeCore(options)
      cores.set(key, core)
      return { core }
    },
    tx: new Proxy({}, {
      get: (_target, namespace) => new Proxy({}, { get: (_rows, id) => row(String(namespace), String(id)) }),
    }),
  }
  return {
    core: (): FakeCore => [...cores.values()].at(-1)!,
    get cores() {
      return [...cores.values()]
    },
    inits,
    instantSDK,
    latestSubscription: () => [...cores.values()].at(-1)!.subscriptions.at(-1)!,
  }
}
