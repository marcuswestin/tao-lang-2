import React from 'react'
import { RuntimeAssert } from './TR-assert'
import { AuthSecrets } from './TR-auth-secrets'
import { createElement } from './TR-create-element'
import type {
  TaoAppDatasourceBinding,
  TaoConfiguredDatasource,
  TaoDataAuthentication,
  TaoDataSchema,
  TaoDataSchemaDefinition,
  TaoDatasourceDeclaration,
} from './TR-data'
import { entityHandle, metadataOf } from './TR-data-entity'
import { registerDataSchema, unregisterDataSchema } from './TR-data-registry'
import { configurationValuesEqual, evaluatedDatasourceConfiguration, RuntimeDataSchema } from './TR-data-schema'
import { errorMessage, UserInputError, warnContainedFailure } from './TR-errors'
import { runtimeRevisionStore } from './TR-listeners'
import { NativeModules } from './TR-native-modules'
import type { RuntimeAppDefinition } from './TR-navigation-app'
import type { Evaluable } from './TR-navigation-presentables'
import type { TaoAuthPairing, TaoAuthProofKind, TaoDataAcceptance } from './TR-pairing'
import { withReadAvailability } from './TR-read-availability'

type TaoAuthState =
  | 'Restoring'
  | 'SignedOut'
  | 'Authenticating'
  | 'ChallengeRequired'
  | 'ReauthenticationRequired'
  | 'SignedIn'
  | 'Error'
type TaoAuthChallenge = Readonly<{ id: string; kind: string; expiresAt?: number }>
/** TaoAuthPrincipal is who the auth provider signed in; it carries no application account. */
export type TaoAuthPrincipal = Readonly<{ issuer: string; subject: string; email?: string; emailVerified?: boolean }>
/** TaoAuthIdentity is the signed-in principal once the account datasource resolved its Account. */
export type TaoAuthIdentity = Readonly<{ issuer: string; subject: string; accountId: string }>
/** TaoAuthSession is the app-visible session: `SignedIn` means account data can be read. */
export type TaoAuthSession = Readonly<{
  state: TaoAuthState
  identity?: TaoAuthIdentity
  challenge?: TaoAuthChallenge
  message?: string
}>
/** TaoAuthConnectionSession is what an auth provider reports: `SignedIn` carries a principal. */
export type TaoAuthConnectionSession = Readonly<{
  state: TaoAuthState
  principal?: TaoAuthPrincipal
  challenge?: TaoAuthChallenge
  message?: string
}>
export type TaoAuthOutcome = Readonly<{
  status: 'completed' | 'cancelled' | 'rejected' | 'error'
  message?: string
}>
export type TaoAuthResult = Readonly<{ outcome: TaoAuthOutcome; session?: TaoAuthConnectionSession }>
/** TaoAuthIssuedProof is a sign-in proof as the auth connection returns it, before the runtime stamps it. */
export type TaoAuthIssuedProof =
  | Readonly<{
    kind: 'IdentityToken'
    issuer: string
    subject: string
    token: string
    expiresAt?: number
    email?: string
    emailVerified?: boolean
  }>
  | Readonly<{
    kind: 'Session'
    issuer: string
    subject: string
    value: Readonly<Record<string, unknown>>
    expiresAt?: number
  }>
  | Readonly<{ kind: 'TestIdentity'; issuer: string; subject: string; accountId: string }>
/** TaoAuthProof is a checked sign-in proof; `provider` is the issuing auth declaration's name. */
export type TaoAuthProof = TaoAuthIssuedProof & Readonly<{ provider: string }>
export type TaoAuthProofRequest = Readonly<{ kind: TaoAuthProofKind; signal: AbortSignal }>
export type TaoAuthInput = Readonly<{
  method: string
  fields?: Readonly<Record<string, string>>
  challengeId?: string
}>
export type TaoAuthCapabilities = Readonly<{
  methods: readonly string[]
  recovery?: boolean
  mfa?: boolean
  passkeys?: boolean
  linking?: boolean
  sessions?: boolean
}>
export type TaoAuthSecretStorage = Readonly<{
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}>
export type TaoAuthConnection = {
  capabilities: TaoAuthCapabilities
  restore(signal: AbortSignal): Promise<TaoAuthConnectionSession>
  signIn(input: TaoAuthInput, signal: AbortSignal): Promise<TaoAuthResult>
  cancel?(): void
  signOut(signal: AbortSignal): Promise<TaoAuthOutcome>
  /** Issues a fresh proof of the signed-in principal; the runtime checks and stamps it. */
  proof(request: TaoAuthProofRequest): Promise<TaoAuthIssuedProof>
  subscribe?(listener: (session: TaoAuthConnectionSession) => void): () => void
  close?(): void
}
export type TaoAuthProvider = {
  /** Only the deterministic testing provider may accept authored fixture identities. */
  testing?: true
  /** Optional SDK host; receives the same app-scoped configuration as connect. */
  Host?: React.ComponentType<{
    configuration: Readonly<Record<string, unknown>>
    children?: React.ReactNode
  }>
  connect(context: Readonly<{ configuration: Readonly<Record<string, unknown>> }>): TaoAuthConnection
}
export type TaoAuthDeclaration = Readonly<{
  name: string
  identity: symbol
  pairing?: TaoAuthPairing
  provider: TaoAuthProvider
}>
export type TaoConfiguredAuth = Readonly<{
  declaration: TaoAuthDeclaration
  config: Readonly<Record<string, unknown>>
  evaluate(): TaoConfiguredAuth
}>
/**
 * Only transports receive this broker; Tao expressions cannot obtain resource credentials.
 * `credential` is the credential source the datasource's own `authenticate` returned.
 */
export type TaoDataAuthBinding = Readonly<{
  accountId: string
  generation: number
  signal: AbortSignal
  testing?: true
  onInvalidate?(cleanup: () => void | Promise<void>): () => void
  credential(signal?: AbortSignal): Promise<string>
}>

/** AccountTarget is the one datasource that resolves the signed-in principal to an Account. */
type AccountTarget = Readonly<{
  configuration: Readonly<Record<string, unknown>>
  declaration: TaoDatasourceDeclaration
  schema: TaoDataSchemaDefinition
}>
/** An attempt's target is an AccountTarget, or the sentence explaining why none could be chosen. */
type AccountAttempt = {
  promise: Promise<void>
  status: 'failed' | 'pending' | 'resolved'
  target: AccountTarget | string
  token: number
}
type PendingState = 'Authenticating' | 'Restoring'
/** PendingRelease is one running data-side release; the controller abandons it at the deadline. */
type PendingRelease = Readonly<{ controller: AbortController; running: Promise<void> }>
/** AuthTimers schedules the release deadline; tests inject timers they fire themselves. */
type AuthTimers = Readonly<{
  clearTimeout(handle: unknown): void
  setTimeout(callback: () => void, delayMs: number): unknown
}>

/**
 * releaseDeadlineMs bounds how long a sign-out waits for data-side releases before the provider signs
 * out. A release is one revoke round trip, so five seconds admits a slow mobile network, while a hung
 * one cannot hold back the provider's sign-out, and its durable record, for longer than that.
 */
const releaseDeadlineMs = 5_000
const hostTimers: AuthTimers = {
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
}
const restoreFailed = 'Unable to restore your session.'
const signInFailed = 'Unable to sign in. Please try again.'
const remoteSignOutUnconfirmed = 'Signed out on this device. Remote sign-out could not be confirmed.'
const completed: TaoAuthOutcome = Object.freeze({ status: 'completed' })
const cancelled: TaoAuthOutcome = Object.freeze({ status: 'cancelled' })
const signedOut: TaoAuthSession = Object.freeze({ state: 'SignedOut' })
const pendingAuthOperations = new Set<Promise<unknown>>()

/** Host test runners wait for network auth work, never a presentation waiting for user input. */
function trackAuthOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  const tracked = new Promise<void>(resolve => {
    const complete = (): void => {
      signal?.removeEventListener('abort', complete)
      resolve()
    }
    if (signal?.aborted) {
      complete()
    } else {
      signal?.addEventListener('abort', complete, { once: true })
    }
    void operation.then(complete, complete)
  })
  pendingAuthOperations.add(tracked)
  void tracked.then(() => pendingAuthOperations.delete(tracked))
  return operation
}

/** RuntimeAuthScope owns one mounted app's principal and store instances, including async work. */
export class RuntimeAuthScope {
  private readonly changes = runtimeRevisionStore()
  private readonly apps = new Map<RuntimeAppDefinition, RuntimeAppDefinition>()
  private readonly stores = new Map<TaoDataSchema, RuntimeDataSchema>()
  private readonly storeSubscriptions = new Map<TaoDataSchema, () => void>()
  private bindings: readonly TaoAppDatasourceBinding[] = []
  /** bindingsSettled is false until the app binds its datasources, so an early principal waits for them. */
  private bindingsSettled = false
  private connection: TaoAuthConnection | undefined
  private evaluatedConfiguration: Readonly<Record<string, unknown>> | undefined
  private stop: (() => void) | undefined
  private subscriptionGeneration = 0
  private operation = new AbortController()
  private identityLifetime = new AbortController()
  private operationGeneration = 0
  private identityGeneration = 0
  private disposed = false
  private restored: Promise<void> | undefined
  private current: TaoAuthSession
  /** principal is the provider's signed-in principal; the public identity appears once it resolves. */
  private principal: TaoAuthPrincipal | undefined
  /** authentication is the resolved account; a fixture account has no target and is never re-resolved. */
  private authentication: { result: TaoDataAuthentication; target?: AccountTarget } | undefined
  private attempt: AccountAttempt | undefined
  private attemptToken = 0
  /** pendingState is how the in-progress account resolution presents: restoring or signing in. */
  private pendingState: PendingState = 'Authenticating'
  /** unreleased holds data-side sessions to end; a failed release is retried on the next sign-out. */
  private readonly unreleased = new Map<TaoDataAuthentication, PendingRelease | undefined>()
  /** signingOut settles once every provider sign-out in flight has finished; sign-ins wait for it. */
  private signingOut: Promise<void> | undefined
  /** providerSessions counts provider sign-ins and restores, so a sign-out never ends a newer session. */
  private providerSessions = 0
  private signingIn = false
  private dataAuth: TaoDataAuthBinding | undefined
  private cleanup: Promise<boolean> = Promise.resolve(true)
  private invalidations = new Set<() => void | Promise<void>>()
  accountBinding: { schema: TaoDataSchema; entity: string } | undefined
  private mounts = 0
  private mountRevision = 0
  private presentation: {
    promise: Promise<TaoAuthOutcome>
    render?: (scope: RuntimeAuthScope) => React.ReactNode
    resolve(outcome: TaoAuthOutcome): void
  } | undefined
  private readonly fixtureAccounts = new Map<string, string>()
  private readonly fixtureSnapshots = new Map<TaoDataSchema, string>()
  private readonly fixtureDeclarations = new Map<TaoDataSchema, TaoDatasourceDeclaration>()
  private preparingFixture = false

  readonly subscribe = this.changes.subscribe
  readonly snapshot = this.changes.snapshot

  constructor(readonly source?: TaoConfiguredAuth, private readonly timers: AuthTimers = hostTimers) {
    this.current = source ? Object.freeze({ state: 'Restoring' }) : signedOut
  }

  get session(): TaoAuthSession {
    return this.current
  }

  get generation(): number {
    return this.identityGeneration
  }

  get capabilities(): TaoAuthCapabilities {
    return this.connection?.capabilities ?? { methods: [] }
  }

  get presenting(): boolean {
    return this.presentation !== undefined
  }

  get presentationRenderer(): ((scope: RuntimeAuthScope) => React.ReactNode) | undefined {
    return this.presentation?.render
  }

  /** retain tolerates React's synchronous setup/cleanup/setup probe without sharing app scopes. */
  retain(): () => void {
    RuntimeAssert.input(!this.disposed, 'This app is no longer mounted.')
    this.mounts += 1
    this.mountRevision += 1
    void this.restore()
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.mounts -= 1
      const revision = ++this.mountRevision
      queueMicrotask(() => {
        if (this.mounts === 0 && revision === this.mountRevision) {
          this.dispose()
        }
      })
    }
  }

  requestSignIn(render?: (scope: RuntimeAuthScope) => React.ReactNode): Promise<TaoAuthOutcome> {
    if (this.disposed) {
      return Promise.resolve(cancelled)
    }
    if (this.current.state === 'SignedIn') {
      return Promise.resolve(completed)
    }
    if (this.presentation) {
      return this.presentation.promise
    }
    let resolve!: (outcome: TaoAuthOutcome) => void
    const promise = new Promise<TaoAuthOutcome>(complete => {
      resolve = complete
    })
    this.presentation = { promise, render, resolve }
    this.changes.changed()
    return promise
  }

  /** restore starts side effects only once the mounted owner or explicit test asks for them. */
  restore(): Promise<void> {
    for (const store of this.stores.values()) {
      registerDataSchema(store, true)
    }
    return this.restored ??= trackAuthOperation(this.restoreSession(), this.operation.signal)
  }

  private async restoreSession(): Promise<void> {
    if (!this.source || this.disposed) {
      return
    }
    const operation = this.beginOperation()
    let resolving: Promise<void>
    try {
      const connection = this.connect()
      if (this.signingOut && !(await this.afterProviderSignOut(operation.generation))) {
        return
      }
      this.providerSessions += 1
      const session = await connection.restore(operation.signal)
      if (!this.isCurrent(operation.generation)) {
        return
      }
      resolving = this.accept(session, 'Restoring')
      // The provider may report a new principal while the datasource is still resolving this one.
      this.watch()
    } catch {
      if (this.isCurrent(operation.generation)) {
        void this.accept({ state: 'Error', message: restoreFailed })
      }
      return
    }
    await resolving
  }

  signIn(input: TaoAuthInput): Promise<TaoAuthOutcome> {
    return trackAuthOperation(this.signInSession(input), this.operation.signal)
  }

  private async signInSession(input: TaoAuthInput): Promise<TaoAuthOutcome> {
    if (this.disposed) {
      return cancelled
    }
    let connection: TaoAuthConnection
    try {
      connection = this.connect()
    } catch {
      return { status: 'error', message: signInFailed }
    }
    if (!connection.capabilities.methods.includes(input.method)) {
      return { status: 'rejected', message: 'This sign-in method is not available.' }
    }
    const operation = this.beginOperation()
    let result: TaoAuthResult
    try {
      void this.accept({ state: 'Authenticating' })
      if (this.signingOut && !(await this.afterProviderSignOut(operation.generation))) {
        return cancelled
      }
      this.providerSessions += 1
      result = await connection.signIn(input, operation.signal)
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
    } catch {
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
      void this.accept(signedOut)
      return { status: 'error', message: signInFailed }
    }
    let resolving: Promise<void> | undefined
    try {
      resolving = result.outcome.status === 'completed' && result.session
        ? this.accept(result.session, 'Authenticating')
        : void this.accept(signedOut)
    } catch {
      void this.accept(signedOut)
      this.abandonProviderSession()
      return { status: 'error', message: signInFailed }
    }
    this.watch()
    if (resolving) {
      this.signingIn = true
      try {
        await resolving
      } finally {
        this.signingIn = false
      }
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
      if (this.current.state === 'Error') {
        // The provider signed in, but the datasource could not resolve the account. Leaving the
        // provider session would let the next launch restore a sign-in the app never accepted.
        this.abandonProviderSession()
        return { status: 'error', message: this.current.message ?? signInFailed }
      }
    }
    if (result.outcome.status === 'completed' && this.current.state === 'SignedIn') {
      this.finishPresentation(completed)
    }
    if (result.outcome.status === 'cancelled') {
      this.finishPresentation(cancelled)
    }
    return result.outcome
  }

  cancel(): TaoAuthOutcome {
    const abandoning = this.signingIn
    this.beginOperation()
    void this.accept(signedOut)
    this.finishPresentation(cancelled)
    try {
      this.connection?.cancel?.()
    } catch (error) {
      warnContainedFailure('Authentication cancellation cleanup failed.', error)
    }
    if (abandoning) {
      this.abandonProviderSession()
    }
    return cancelled
  }

  /** abandonProviderSession signs the provider out of a sign-in the app did not accept. */
  private abandonProviderSession(): void {
    if (!this.connection) {
      return
    }
    void trackAuthOperation(
      this.signOutProvider(Promise.resolve()).catch(error => {
        warnContainedFailure('Abandoning an unaccepted sign-in failed.', error)
        return cancelled
      }),
    )
  }

  signOut(): Promise<TaoAuthOutcome> {
    return trackAuthOperation(this.signOutSession(), this.operation.signal)
  }

  private async signOutSession(): Promise<TaoAuthOutcome> {
    if (this.disposed) {
      return cancelled
    }
    const operation = this.beginOperation()
    // The datasource's session ends before the provider's, so no backend session outlives sign-out.
    this.retireAuthentication()
    void this.accept(signedOut)
    this.finishPresentation(cancelled)
    const cleanup = this.cleanup
    const releasing = this.releaseBeforeSignOut()
    try {
      const outcome = await this.signOutProvider(releasing)
      const cleaned = await cleanup
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
      if (!(await releasing)) {
        return { status: 'error', message: remoteSignOutUnconfirmed }
      }
      return cleaned
        ? outcome
        : { status: 'error', message: 'Signed out. Local account data cleanup could not be completed.' }
    } catch {
      await cleanup
      return this.isCurrent(operation.generation)
        ? { status: 'error', message: remoteSignOutUnconfirmed }
        : cancelled
    }
  }

  /**
   * signOutProvider signs the provider out once `before` settles. Sign-ins and restores wait for it
   * before contacting the provider, so it cannot end the next user's session; should one have reached
   * the provider anyway, it leaves that session alone. A later operation does not cancel it: the
   * signal it passes never aborts, because an explicit sign-out must still reach the provider.
   */
  private signOutProvider(before: Promise<unknown>): Promise<TaoAuthOutcome> {
    const connection = this.connection
    const sessions = this.providerSessions
    const signingOut = before.then(() => {
      if (!connection) {
        return completed
      }
      return sessions === this.providerSessions ? connection.signOut(new AbortController().signal) : cancelled
    })
    const settled: Promise<void> = Promise.allSettled([this.signingOut, signingOut]).then(() => {
      if (this.signingOut === settled) {
        this.signingOut = undefined
      }
    })
    this.signingOut = settled
    return signingOut
  }

  /** afterProviderSignOut waits out every provider sign-out in flight; false once `generation` is superseded. */
  private async afterProviderSignOut(generation: number): Promise<boolean> {
    while (this.signingOut) {
      await this.signingOut
      if (!this.isCurrent(generation)) {
        return false
      }
    }
    return this.isCurrent(generation)
  }

  /**
   * issueProof asks the provider for a fresh proof of the principal `generation` signed in, and
   * refuses a kind the declaration does not issue, a proof for another principal, and an expired one.
   */
  private async issueProof<KindT extends TaoAuthProofKind>(
    kind: KindT,
    signal: AbortSignal,
    generation: number,
  ): Promise<Extract<TaoAuthProof, { kind: KindT }>> {
    const principal = this.principal
    if (this.disposed || generation !== this.identityGeneration || !principal || signal.aborted) {
      throw new UserInputError('Sign in to access this resource.')
    }
    const declaration = this.authDeclaration()
    RuntimeAssert.input(
      declaration.pairing === undefined || declaration.pairing.issues.includes(kind),
      `Auth ${declaration.name} does not issue ${kind} sign-in proofs.`,
    )
    RuntimeAssert.input(
      kind !== 'TestIdentity' || declaration.provider.testing === true,
      `Auth ${declaration.name} cannot issue TestIdentity sign-in proofs; only TestAuth can.`,
    )
    const request = linkedAbort(this.identityLifetime.signal, signal)
    try {
      const issued = await this.connect().proof({ kind, signal: request.signal })
      if (request.signal.aborted || generation !== this.identityGeneration || this.disposed) {
        throw new UserInputError('This session is no longer active.')
      }
      RuntimeAssert.input(
        validIssuedProof(issued) && issued.kind === kind && issued.issuer === principal.issuer
          && issued.subject === principal.subject,
        `Auth ${declaration.name} returned a sign-in proof that does not match the signed-in account.`,
      )
      RuntimeAssert.input(
        !('expiresAt' in issued) || issued.expiresAt === undefined || issued.expiresAt > Date.now(),
        'The sign-in proof has expired. Sign in again.',
      )
      return Object.freeze({ ...issued, provider: declaration.name }) as Extract<TaoAuthProof, { kind: KindT }>
    } finally {
      request.dispose()
    }
  }

  /** resourceCredential brokers the resolved datasource's own credential source for its transport. */
  private async resourceCredential(
    authentication: TaoDataAuthentication,
    generation: number,
    signal?: AbortSignal,
  ): Promise<string> {
    if (
      this.disposed || generation !== this.identityGeneration || this.current.state !== 'SignedIn'
      || signal?.aborted
    ) {
      throw new UserInputError('Sign in to access this resource.')
    }
    RuntimeAssert.input(
      authentication.credential !== undefined,
      'This datasource does not issue resource credentials.',
    )
    const request = linkedAbort(this.identityLifetime.signal, signal)
    try {
      const credential = await authentication.credential(request.signal)
      if (request.signal.aborted || generation !== this.identityGeneration || this.disposed) {
        throw new UserInputError('This session is no longer active.')
      }
      RuntimeAssert.input(
        typeof credential === 'string' && credential.length > 0,
        'The resource credential is not valid for this request.',
      )
      return credential
    } finally {
      request.dispose()
    }
  }

  app(declaration: RuntimeAppDefinition): RuntimeAppDefinition {
    let app = this.apps.get(declaration)
    if (!app) {
      RuntimeAssert.input(!this.disposed, 'This app is no longer mounted.')
      app = declaration.mountForAuth(this)
      this.apps.set(declaration, app)
      if (!this.bindingsSettled && declaration.definition.datasources === undefined) {
        // This app binds no datasource, so no later binding can hold the signed-in Account.
        this.bindDatasources([])
      }
    }
    return app
  }

  store(declaration: TaoDataSchema): RuntimeDataSchema {
    let store = this.stores.get(declaration)
    if (!store) {
      RuntimeAssert.input(!this.disposed, 'This app is no longer mounted.')
      store = new RuntimeDataSchema(
        declaration.definition,
        { load: () => undefined, save: () => undefined },
        undefined,
        this.source ? authOperationId : undefined,
      )
      if (this.source) {
        store.seal()
      }
      this.stores.set(declaration, store)
      if (this.restored) {
        registerDataSchema(store, true)
      }
      this.storeSubscriptions.set(declaration, store.subscribe(() => this.changes.changed()))
      const peers = [...this.stores.values()]
      for (const peer of peers) {
        peer.linkStores(peers)
      }
    }
    return store
  }

  bindDatasources(bindings: readonly TaoAppDatasourceBinding[]): void {
    this.bindings = bindings
    this.bindingsSettled = true
    for (const binding of bindings) {
      this.store(binding.store)
    }
    // Generated apps rebind on every render; only a changed account datasource resolves again.
    if (this.principal && !this.disposed) {
      void trackAuthOperation(this.resolveAccount(this.pendingState, false))
    }
    this.bindStores()
  }

  ownsStore(store: TaoDataSchema): boolean {
    return [...this.stores.values()].includes(store)
  }

  async prepareFixture(
    fixture: { accounts: readonly { name: string; fields: Readonly<Record<string, unknown>> }[]; signedIn?: string },
    schemas: readonly TaoDataSchema[],
  ): Promise<Readonly<Record<string, unknown>>> {
    RuntimeAssert.input(this.source?.declaration.provider.testing === true, 'Auth fixtures require TestAuth.')
    this.beginOperation()
    this.restored = Promise.resolve()
    this.preparingFixture = true
    this.fixtureAccounts.clear()
    const accountSchema = schemas.find(schema => schema.definition.entities['Account'] !== undefined)
    RuntimeAssert.input(
      accountSchema !== undefined || fixture.accounts.length === 0,
      'Auth fixtures require an Account collection.',
    )
    for (const schema of schemas) {
      RuntimeAssert.input(this.ownsStore(schema), 'Auth fixture stores must belong to the mounted app.')
      const temporary = new RuntimeDataSchema(schema.definition, { load: () => undefined, save: () => undefined })
      if (schema === accountSchema) {
        for (const account of fixture.accounts) {
          const definition = schema.definition.entities['Account']!
          const fields = Object.fromEntries(
            Object.entries(account.fields).filter(([name]) => name in definition.fields),
          )
          const handle = temporary.create('Account', fields)
          this.fixtureAccounts.set(account.name, metadataOf(handle).id)
        }
      }
      this.fixtureSnapshots.set(schema, temporary.captureSnapshot())
      await temporary.settle()
    }
    const accountId = fixture.signedIn === undefined ? undefined : this.fixtureAccounts.get(fixture.signedIn)
    RuntimeAssert.input(
      fixture.signedIn === undefined || accountId !== undefined,
      'The signed-in fixture account is not declared.',
    )
    if (accountId === undefined) {
      void this.accept(signedOut)
    } else {
      // A fixture names its signed-in account directly; no datasource resolves it.
      this.changePrincipal({ issuer: 'tao-test', subject: fixture.signedIn! })
      this.authenticated({ accountId })
    }
    this.bindStores()
    for (const schema of schemas) {
      await schema.settle()
    }
    return Object.freeze(
      Object.fromEntries([...this.fixtureAccounts].map(([name, id]) => [name, accountSchema!.entity('Account', id)])),
    )
  }

  fixtureCreate(store: TaoDataSchema, entity: string, fields: Record<string, unknown>, actorName?: string): unknown {
    RuntimeAssert.input(
      this.preparingFixture && this.source?.declaration.provider.testing === true && this.ownsStore(store),
      'Fixture creation requires the active TestAuth fixture setup.',
    )
    const actor = actorName === undefined ? this.current.identity?.accountId : this.fixtureAccounts.get(actorName)
    RuntimeAssert.input(actor !== undefined, 'A fixture create requires a signed-in account or explicit actor.')
    return store.withFixtureActor(actor, () => store.create(entity, fields))
  }

  finishFixture(): void {
    this.preparingFixture = false
    if (this.current.state !== 'SignedIn') {
      for (const store of this.stores.values()) {
        store.seal()
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.operation.abort()
    this.invalidateIdentity()
    this.unwatch()
    this.finishPresentation(cancelled)
    this.current = signedOut
    // Unmounting is not a sign-out: nothing is released and the provider stays signed in for the next
    // launch to restore. A datasource session held only in memory, such as a Reference gateway
    // session, is not restored; the next launch resolves a new one and the old one expires.
    this.principal = undefined
    this.authentication = undefined
    this.attempt = undefined
    this.attemptToken += 1
    this.dataAuth = undefined
    try {
      this.connection?.close?.()
    } catch (error) {
      warnContainedFailure('Authentication provider cleanup failed.', error)
    }
    for (const store of this.stores.values()) {
      void store.invalidateAuth().catch(error => warnContainedFailure('Account data cleanup failed.', error))
      unregisterDataSchema(store)
    }
    for (const stop of this.storeSubscriptions.values()) {
      stop()
    }
    this.storeSubscriptions.clear()
    this.stores.clear()
    for (const app of this.apps.values()) {
      app.dispose()
    }
    this.apps.clear()
    this.changes.clear()
  }

  get configuration(): Readonly<Record<string, unknown>> {
    RuntimeAssert.input(this.source !== undefined, 'This app has no authentication provider.')
    this.evaluatedConfiguration ??= Object.freeze(Object.fromEntries(
      Object.entries(this.source.config).map(([key, value]) => [key, evaluated(value)]),
    ))
    return this.evaluatedConfiguration
  }

  private connect(): TaoAuthConnection {
    RuntimeAssert.input(this.source !== undefined, 'This app has no authentication provider.')
    if (!this.connection) {
      this.connection = this.source.declaration.provider.connect({ configuration: this.configuration })
    }
    return this.connection
  }

  private authDeclaration(): TaoAuthDeclaration {
    RuntimeAssert.input(this.source !== undefined, 'This app has no authentication provider.')
    return this.source.declaration
  }

  private beginOperation(): { generation: number; signal: AbortSignal } {
    this.unwatch()
    this.operation.abort()
    this.operation = new AbortController()
    return { generation: ++this.operationGeneration, signal: this.operation.signal }
  }

  private unwatch(): void {
    this.subscriptionGeneration += 1
    const stop = this.stop
    this.stop = undefined
    try {
      stop?.()
    } catch (error) {
      warnContainedFailure('Authentication subscription cleanup failed.', error)
    }
  }

  private watch(): void {
    this.unwatch()
    if (this.disposed) {
      return
    }
    const generation = this.subscriptionGeneration
    const stop = this.connection?.subscribe?.(session => {
      if (this.disposed || generation !== this.subscriptionGeneration) {
        return
      }
      // A provider re-reporting the same principal (a refreshed session) does not supersede the
      // operation that signed it in; any other transition does.
      if (session.state !== 'SignedIn' || !samePrincipal(session.principal, this.principal)) {
        this.operation.abort()
        this.operationGeneration += 1
      }
      void this.accept(session, 'Authenticating')
      // Provider transitions can temporarily clear identity while exchanging a new account.
      // Explicit user operations and disposal invalidate this subscription separately.
    })
    if (generation === this.subscriptionGeneration && !this.disposed) {
      this.stop = stop
    } else {
      stop?.()
    }
  }

  private finishPresentation(outcome: TaoAuthOutcome): void {
    const presentation = this.presentation
    if (!presentation) {
      return
    }
    this.presentation = undefined
    presentation.resolve(outcome)
    this.changes.changed()
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.operationGeneration
  }

  /**
   * accept applies a provider-reported session. A new principal ends the previous one's data access;
   * a signed-in principal stays `pendingState` until the account datasource resolves its Account.
   */
  private accept(session: TaoAuthConnectionSession, pendingState: PendingState = 'Authenticating'): Promise<void> {
    RuntimeAssert.input(
      session.state !== 'SignedIn' || !!(session.principal?.issuer && session.principal.subject),
      'An authenticated session requires a verified account identity.',
    )
    const principal = session.state === 'SignedIn' ? session.principal : undefined
    if (!samePrincipal(principal, this.principal)) {
      this.changePrincipal(principal)
    } else if (principal) {
      // Claims such as email may change for the same principal; its data access does not.
      this.principal = Object.freeze({ ...principal })
    }
    if (!principal) {
      this.publish({
        state: session.state,
        ...(session.challenge ? { challenge: Object.freeze({ ...session.challenge }) } : {}),
        ...(session.message ? { message: session.message } : {}),
      })
      return Promise.resolve()
    }
    return this.resolveAccount(pendingState, true)
  }

  /** changePrincipal ends every account binding of the previous principal and starts a new lifetime. */
  private changePrincipal(principal: TaoAuthPrincipal | undefined): void {
    this.principal = principal ? Object.freeze({ ...principal }) : undefined
    this.retireAuthentication()
    this.resetIdentity()
  }

  /** resetIdentity seals account data behind a new identity lifetime and abandons resolution in flight. */
  private resetIdentity(): void {
    this.attempt = undefined
    this.attemptToken += 1
    this.invalidateIdentity()
    const cleanups = [...this.stores.values()].map(store =>
      store.invalidateAuth().then(
        () => true,
        error => {
          warnContainedFailure('Account data cleanup failed.', error)
          return false
        },
      )
    )
    this.cleanup = Promise.all([this.cleanup, ...cleanups]).then(results => results.every(Boolean))
    this.identityLifetime = new AbortController()
    this.identityGeneration += 1
    this.dataAuth = undefined
    this.bindStores()
  }

  /**
   * resolveAccount asks the datasource holding Account to resolve the principal. `retry` repeats a
   * failed attempt against the same datasource; a rebind without retry resolves only when the
   * account datasource changed, so per-render rebinds and failures never loop.
   */
  private resolveAccount(pendingState: PendingState, retry: boolean): Promise<void> {
    const principal = this.principal
    if (!principal || this.disposed) {
      return Promise.resolve()
    }
    if (this.authentication && this.authentication.target === undefined) {
      return Promise.resolve()
    }
    if (!this.bindingsSettled) {
      // Restoration can finish before the app's first layout binds its datasources; the principal
      // stays pending until they arrive, and bindDatasources resolves it then.
      this.pendingState = pendingState
      this.publish({ state: pendingState })
      return Promise.resolve()
    }
    if (this.bindings.length > 0 && this.bindings.every(binding => binding.localOnly !== undefined)) {
      // Device-local data has no remote Account to resolve: the verified principal is the account,
      // and each local store's custody key names its issuer and subject.
      if (this.authentication) {
        this.retireAuthentication()
        this.resetIdentity()
      }
      this.attempt = undefined
      this.attemptToken += 1
      this.authenticated({ accountId: principal.subject })
      return Promise.resolve()
    }
    let target: AccountTarget | string
    try {
      target = this.accountTarget()
    } catch (error) {
      target = errorMessage(error)
    }
    const attempt = this.attempt
    if (attempt && sameTarget(attempt.target, target) && (!retry || attempt.status !== 'failed')) {
      return attempt.promise
    }
    if (this.authentication) {
      // A different account datasource may resolve a different Account.
      this.retireAuthentication()
      this.resetIdentity()
    }
    const token = ++this.attemptToken
    this.pendingState = pendingState
    if (typeof target === 'string') {
      this.attempt = { promise: Promise.resolve(), status: 'failed', target, token }
      this.publish({ state: 'Error', message: target })
      return this.attempt.promise
    }
    const resolved = target
    const generation = this.identityGeneration
    const signal = this.identityLifetime.signal
    const auth = this.authDeclaration()
    const provider = resolved.declaration.provider
    this.publish({ state: pendingState })
    const current: AccountAttempt = { promise: Promise.resolve(), status: 'pending', target: resolved, token }
    this.attempt = current
    current.promise = (async () => {
      let result: TaoDataAuthentication | undefined
      try {
        result = await provider.authenticate!(Object.freeze({
          configuration: resolved.configuration,
          schema: resolved.schema,
          principal,
          provider: auth.name,
          proof: <KindT extends TaoAuthProofKind>(kind: KindT, request: AbortSignal) =>
            this.issueProof(kind, request, generation),
          signal,
          ...(auth.provider.testing ? { testing: true as const } : {}),
        }))
        RuntimeAssert.input(
          typeof result === 'object' && result !== null && typeof result.accountId === 'string'
            && result.accountId.length > 0,
          `Datasource ${resolved.declaration.name} did not resolve an account.`,
        )
      } catch (error) {
        if (token !== this.attemptToken) {
          return
        }
        warnContainedFailure('Account resolution failed.', error)
        current.status = 'failed'
        this.publish({ state: 'Error', message: pendingState === 'Restoring' ? restoreFailed : signInFailed })
        return
      }
      if (token !== this.attemptToken) {
        // Superseded before it was handed out: end the backend session it created. A sign-out does
        // not wait for a resolution in flight, so this release can follow the provider's sign-out.
        this.queueRelease(result)
        void this.releasePending()
        return
      }
      current.status = 'resolved'
      this.authenticated(result, resolved)
    })()
    return current.promise
  }

  /** authenticated publishes the resolved account and binds its data under the current lifetime. */
  private authenticated(result: TaoDataAuthentication, target?: AccountTarget): void {
    const principal = this.principal
    RuntimeAssert.defined(principal, 'a resolved account belongs to a signed-in principal')
    this.authentication = { result, ...(target ? { target } : {}) }
    const generation = this.identityGeneration
    const signal = this.identityLifetime.signal
    const invalidations = this.invalidations
    this.dataAuth = Object.freeze({
      accountId: result.accountId,
      generation,
      signal,
      onInvalidate: (cleanup: () => void | Promise<void>) => {
        RuntimeAssert.input(!signal.aborted, 'This account data connection is no longer active.')
        invalidations.add(cleanup)
        return () => invalidations.delete(cleanup)
      },
      ...(this.source?.declaration.provider.testing ? { testing: true as const } : {}),
      credential: (request?: AbortSignal) => this.resourceCredential(result, generation, request),
    })
    this.bindStores()
    this.publish({
      state: 'SignedIn',
      identity: Object.freeze({ issuer: principal.issuer, subject: principal.subject, accountId: result.accountId }),
    })
  }

  /** accountTarget chooses the one datasource that resolves the Account and checks it can pair. */
  private accountTarget(): AccountTarget {
    const auth = this.authDeclaration()
    const targets: (AccountTarget & { holdsAccount: boolean })[] = []
    // A local-only catalog keeps device custody under the resolved account and never resolves it.
    for (const binding of this.bindings.filter(binding => binding.localOnly === undefined)) {
      const declaration = binding.source.declaration
      const configuration = evaluatedDatasourceConfiguration(binding.source)
      const holdsAccount = binding.store.definition.entities['Account'] !== undefined
      const index = targets.findIndex(target =>
        target.declaration === declaration && configurationValuesEqual(target.configuration, configuration)
      )
      if (index < 0) {
        targets.push({ configuration, declaration, holdsAccount, schema: binding.store.definition })
      } else if (holdsAccount && !targets[index]!.holdsAccount) {
        targets[index] = { ...targets[index]!, holdsAccount, schema: binding.store.definition }
      }
    }
    RuntimeAssert.input(targets.length > 0, `Auth ${auth.name} needs a datasource to hold the signed-in Account.`)
    RuntimeAssert.input(
      targets.length === 1,
      `Auth ${auth.name} can sign in to one datasource, but this app binds ${
        targets.map(target => target.declaration.name).join(', ')
      }. Keep the Account and account data in one datasource.`,
    )
    const { holdsAccount: _holdsAccount, ...target } = targets[0]!
    const data = target.declaration
    RuntimeAssert.input(
      auth.pairing !== undefined && data.pairing !== undefined,
      `Auth ${auth.name} and Datasource ${data.name} must both declare sign-in pairing: the proofs ${auth.name} issues and the proofs ${data.name} accepts.`,
    )
    const issues = auth.pairing.issues
    const accepted = data.pairing.accepts.filter(acceptance =>
      issues.includes(acceptance.kind) && (acceptance.from === undefined || acceptance.from === auth.name)
      && (acceptance.kind !== 'TestIdentity' || auth.provider.testing === true)
    )
    RuntimeAssert.input(
      accepted.length > 0,
      `Datasource ${data.name} cannot sign in with Auth ${auth.name}: ${auth.name} issues ${
        issues.length > 0 ? issues.join(', ') : 'no sign-in proofs'
      }, and ${data.name} accepts ${describeAcceptances(data.pairing.accepts)}.`,
    )
    RuntimeAssert.input(
      data.provider.authenticate !== undefined,
      `Datasource ${data.name} accepts sign-in proofs from Auth ${auth.name} but its provider does not authenticate them.`,
    )
    return target
  }

  /** publish replaces the app-visible session, resetting apps when the account identity changes. */
  private publish(session: TaoAuthSession): void {
    const next: TaoAuthSession = Object.freeze({ ...session })
    if (sameSession(this.current, next)) {
      return
    }
    const identityChanged = !sameIdentity(this.current.identity, next.identity)
    this.current = next
    if (identityChanged) {
      for (const app of this.apps.values()) {
        app.reset()
      }
    }
    this.changes.changed()
  }

  /** retireAuthentication queues the current account's data-side session for release. */
  private retireAuthentication(): void {
    const authentication = this.authentication
    this.authentication = undefined
    if (authentication) {
      this.queueRelease(authentication.result)
      void this.releasePending()
    }
  }

  private queueRelease(result: TaoDataAuthentication): void {
    if (result.release && !this.unreleased.has(result)) {
      this.unreleased.set(result, undefined)
    }
  }

  /** releasePending ends every queued data-side session; a failure stays queued for the next sign-out. */
  private releasePending(): Promise<boolean> {
    return Promise.all([...this.unreleased.keys()].map(result => {
      let pending = this.unreleased.get(result)
      if (!pending) {
        const controller = new AbortController()
        const running: Promise<void> = Promise.resolve().then(() => result.release!(controller.signal)).then(
          () => {
            this.unreleased.delete(result)
          },
          error => {
            // A release abandoned at the deadline is already queued again; a retry may be running.
            if (this.unreleased.get(result)?.running === running) {
              this.unreleased.set(result, undefined)
            }
            warnContainedFailure('Remote account sign-out could not be confirmed.', error)
            throw error
          },
        )
        pending = { controller, running }
        this.unreleased.set(result, pending)
      }
      return pending.running.then(() => true, () => false)
    })).then(results => results.every(Boolean))
  }

  /**
   * releaseBeforeSignOut waits at most `releaseDeadlineMs` for the queued releases. At the deadline it
   * aborts the ones still running and queues them again, so the next sign-out retries them.
   */
  private releaseBeforeSignOut(): Promise<boolean> {
    const releasing = this.releasePending()
    if (this.unreleased.size === 0) {
      return releasing
    }
    return new Promise(resolve => {
      const deadline = this.timers.setTimeout(() => {
        for (const [result, pending] of this.unreleased) {
          if (pending) {
            this.unreleased.set(result, undefined)
            pending.controller.abort()
          }
        }
        resolve(false)
      }, releaseDeadlineMs)
      void releasing.then(released => {
        this.timers.clearTimeout(deadline)
        resolve(released)
      })
    })
  }

  private invalidateIdentity(): void {
    this.identityLifetime.abort()
    const callbacks = this.invalidations
    this.invalidations = new Set()
    const pending = [...callbacks].map(cleanup => {
      try {
        return Promise.resolve(cleanup())
      } catch (error) {
        return Promise.reject(error)
      }
    }).map(promise =>
      promise.then(() => true, error => {
        warnContainedFailure('Account data cleanup failed.', error)
        return false
      })
    )
    this.cleanup = Promise.all([this.cleanup, ...pending]).then(results => results.every(Boolean))
  }

  private bindStores(): void {
    for (const binding of this.bindings) {
      const store = this.store(binding.store)
      if (this.source && !this.dataAuth && !this.preparingFixture) {
        store.seal()
      } else {
        const fixtureAuth: TaoDataAuthBinding | undefined = this.preparingFixture && !this.dataAuth
          ? {
            accountId: '@fixture-signed-out',
            generation: this.identityGeneration,
            signal: this.identityLifetime.signal,
            testing: true,
            credential: async () => {
              throw new UserInputError('Fixtures cannot request production credentials.')
            },
          }
          : undefined
        const auth = this.dataAuth ?? fixtureAuth
        // Stores bind before the session publishes, so custody follows the verified principal.
        const identity = this.dataAuth ? this.principal : undefined
        const local = binding.localOnly && auth
          ? {
            storageKey: JSON.stringify([
              'tao.auth.local',
              1,
              binding.localOnly,
              store.name,
              identity?.issuer ?? '@fixture',
              identity?.subject ?? '@fixture',
              auth.accountId,
            ]),
            signal: auth.signal,
            ...(auth.testing ? { fixtureAccountId: auth.accountId } : {}),
          }
          : undefined
        store.bindConfigured(
          this.fixtureSource(store, binding.source),
          binding.storageName,
          local ? undefined : auth,
          local,
        )
      }
    }
  }

  private fixtureSource(store: TaoDataSchema, source: TaoConfiguredDatasource): TaoConfiguredDatasource {
    if (!this.fixtureSnapshots.has(store)) {
      return source
    }
    let declaration = this.fixtureDeclarations.get(store)
    if (!declaration) {
      declaration = Object.freeze({
        ...source.declaration,
        provider: {
          connect: () => ({
            load: () => this.fixtureSnapshots.get(store),
            save: (value: string) => {
              this.fixtureSnapshots.set(store, value)
            },
            submit: async (value: string) => {
              this.fixtureSnapshots.set(store, value)
              return { status: 'saved' as const }
            },
          }),
        },
      })
      this.fixtureDeclarations.set(store, declaration)
    }
    const configured: TaoConfiguredDatasource = Object.freeze({ ...source, declaration, evaluate: () => configured })
    return configured
  }
}

const AuthContext = React.createContext<RuntimeAuthScope | undefined>(undefined)

/** AuthControls is the explicit context API emitted by the compiler for named auth exports. */
export const AuthControls = {
  ...AuthSecrets,
  Declaration(name: string, provider: TaoAuthProvider, pairing?: TaoAuthPairing): TaoAuthDeclaration {
    return Object.freeze({ name, provider, identity: Symbol(name), ...(pairing ? { pairing } : {}) })
  },
  Configure(declaration: TaoAuthDeclaration, config: Record<string, unknown>): TaoConfiguredAuth {
    const value: TaoConfiguredAuth = Object.freeze({
      declaration,
      config: Object.freeze({ ...config }),
      evaluate: () => value,
    })
    return value
  },
  Patch(base: TaoConfiguredAuth, patch: Record<string, unknown>): TaoConfiguredAuth {
    return AuthControls.Configure(base.declaration, { ...base.config, ...patch })
  },
  CreateScope(source?: TaoConfiguredAuth): RuntimeAuthScope {
    return new RuntimeAuthScope(source)
  },
  UseScope(source?: TaoConfiguredAuth): RuntimeAuthScope {
    const [scope] = React.useState(() => new RuntimeAuthScope(source))
    React.useEffect(() => scope.retain(), [scope])
    return scope
  },
  Host(
    props: {
      scope: RuntimeAuthScope
      children?: React.ReactNode
      renderPresentation?: (scope: RuntimeAuthScope) => React.ReactNode
    },
  ): React.ReactElement {
    const children = createElement(
      AuthContext.Provider,
      { value: props.scope },
      props.children,
      createElement(AuthPresentation, { scope: props.scope, render: props.renderPresentation }),
    )
    const Host = props.scope.source?.declaration.provider.Host
    return Host ? createElement(Host, { configuration: props.scope.configuration }, children) : children
  },
  UseContext(): RuntimeAuthScope {
    const scope = AuthControls.UseOptionalContext()
    RuntimeAssert.input(scope !== undefined, 'Authentication requires a mounted app context.')
    return scope
  },
  UseOptionalContext(): RuntimeAuthScope | undefined {
    const scope = React.useContext(AuthContext)
    React.useSyncExternalStore(
      scope?.subscribe ?? emptySubscribe,
      scope?.snapshot ?? emptySnapshot,
      scope?.snapshot ?? emptySnapshot,
    )
    return scope
  },
  OperationId: authOperationId,
  async SettleAll(): Promise<void> {
    while (pendingAuthOperations.size > 0) {
      await Promise.allSettled([...pendingAuthOperations])
    }
  },
  /** SecureStorage has no browser fallback: a provider must declare its browser key custody. */
  SecureStorage(): TaoAuthSecretStorage | undefined {
    if (NativeModules.platform() === 'web') {
      return undefined
    }
    const secure = NativeModules.required<{
      getItemAsync(key: string): Promise<string | null>
      setItemAsync(key: string, value: string): Promise<void>
      deleteItemAsync(key: string): Promise<void>
    }>('Persistent account credentials', 'expo-secure-store')
    return {
      getItem: key => secure.getItemAsync(key),
      setItem: (key, value) => secure.setItemAsync(key, value),
      removeItem: key => secure.deleteItemAsync(key),
    }
  },
  Session(scope: RuntimeAuthScope, cases?: Readonly<Record<string, Evaluable>>): Evaluable {
    return liveValue(() => ({ State: cases?.[scope.session.state]?.evaluate().jsValue ?? scope.session.state }))
  },
  BindAccount(scope: RuntimeAuthScope, schema: TaoDataSchema, entity: string): void {
    scope.accountBinding = { schema, entity }
  },
  Account(scope: RuntimeAuthScope, schema?: TaoDataSchema, entity?: string): Evaluable {
    return {
      evaluate: () => {
        const identity = scope.session.identity
        if (identity) {
          const binding = schema && entity ? { schema, entity } : scope.accountBinding
          RuntimeAssert.input(binding !== undefined, 'This app has no Account data binding.')
          return evaluatedValue(scope.store(binding.schema).entity(binding.entity, identity.accountId))
        }
        return withReadAvailability(
          evaluatedValue(undefined),
          scope.session.state === 'Restoring'
            ? { status: 'loading' }
            : scope.session.state === 'Error'
            ? { status: 'error', message: scope.session.message ?? 'Unable to load your account.' }
            : { status: 'unauthorized' },
        )
      },
    }
  },
  SignIn(scope: RuntimeAuthScope, input: TaoAuthInput): Promise<TaoAuthOutcome> {
    return scope.signIn(input)
  },
  SignOut(scope: RuntimeAuthScope): Promise<TaoAuthOutcome> {
    return scope.signOut()
  },
  SaveProfile(
    scope: RuntimeAuthScope,
    account: Evaluable,
    fields: Readonly<Record<string, Evaluable>>,
  ): Promise<TaoAuthOutcome> {
    return trackAuthOperation((async (): Promise<TaoAuthOutcome> => {
      const handle = entityHandle(account.evaluate().jsValue)
      if (!handle || scope.session.state !== 'SignedIn') {
        return { status: 'rejected', message: 'Sign in to update your profile.' }
      }
      const metadata = metadataOf(handle)
      if (metadata.id !== scope.session.identity?.accountId || !scope.ownsStore(metadata.schema)) {
        return { status: 'rejected', message: 'This profile does not belong to the signed-in account.' }
      }
      const generation = scope.generation
      try {
        const result = await metadata.schema.submitUpdate(
          handle,
          Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.evaluate().jsValue])),
        )
        if (generation !== scope.generation) {
          return cancelled
        }
        return result.status === 'saved'
          ? completed
          : { status: 'rejected', message: 'Your change is queued. Keep this form open until it is saved.' }
      } catch {
        return generation !== scope.generation
          ? cancelled
          : { status: 'error', message: 'Unable to save your profile. Your input has been kept.' }
      }
    })())
  },
  Store(scope: RuntimeAuthScope | undefined, declaration: TaoDataSchema): TaoDataSchema {
    return scope?.store(declaration) ?? declaration
  },
  BindDatasources(scope: RuntimeAuthScope, bindings: readonly TaoAppDatasourceBinding[]): void {
    scope.bindDatasources(bindings)
  },
  UseDatasources(scope: RuntimeAuthScope, bindings: readonly TaoAppDatasourceBinding[]): void {
    React.useLayoutEffect(() => scope.bindDatasources(bindings), [scope, bindings])
  },
} as const

function AuthPresentation(
  props: { scope: RuntimeAuthScope; render?: (scope: RuntimeAuthScope) => React.ReactNode },
): React.ReactNode {
  React.useSyncExternalStore(props.scope.subscribe, props.scope.snapshot, props.scope.snapshot)
  return props.scope.presenting ? (props.scope.presentationRenderer ?? props.render)?.(props.scope) ?? null : null
}

function samePrincipal(left: TaoAuthPrincipal | undefined, right: TaoAuthPrincipal | undefined): boolean {
  return left?.issuer === right?.issuer && left?.subject === right?.subject
}

function sameIdentity(left: TaoAuthIdentity | undefined, right: TaoAuthIdentity | undefined): boolean {
  return left?.issuer === right?.issuer && left?.subject === right?.subject && left?.accountId === right?.accountId
}

function sameSession(left: TaoAuthSession, right: TaoAuthSession): boolean {
  return left.state === right.state && left.message === right.message && sameIdentity(left.identity, right.identity)
    && left.challenge?.id === right.challenge?.id && left.challenge?.kind === right.challenge?.kind
    && left.challenge?.expiresAt === right.challenge?.expiresAt
}

function sameTarget(left: AccountTarget | string, right: AccountTarget | string): boolean {
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right
  }
  return left.declaration === right.declaration && left.schema === right.schema
    && configurationValuesEqual(left.configuration, right.configuration)
}

function describeAcceptances(accepts: readonly TaoDataAcceptance[]): string {
  return accepts.length === 0
    ? 'no sign-in proofs'
    : accepts.map(acceptance => acceptance.from ? `${acceptance.kind} from ${acceptance.from}` : acceptance.kind)
      .join(', ')
}

/** validIssuedProof checks the payload each proof kind must carry before the runtime stamps it. */
function validIssuedProof(value: unknown): value is TaoAuthIssuedProof {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proof = value as Partial<Record<string, unknown>>
  const text = (name: string): boolean => typeof proof[name] === 'string' && (proof[name] as string).length > 0
  if (!text('issuer') || !text('subject')) {
    return false
  }
  if (
    proof['expiresAt'] !== undefined && !(typeof proof['expiresAt'] === 'number' && Number.isFinite(proof['expiresAt']))
  ) {
    return false
  }
  const payloads: Readonly<Record<TaoAuthProofKind, () => boolean>> = {
    IdentityToken: () => text('token'),
    Session: () => typeof proof['value'] === 'object' && proof['value'] !== null && !Array.isArray(proof['value']),
    TestIdentity: () => text('accountId'),
  }
  const kind = proof['kind']
  return typeof kind === 'string' && Object.hasOwn(payloads, kind) && payloads[kind as TaoAuthProofKind]()
}

/** linkedAbort aborts when any given signal does, and detaches from them once disposed. */
function linkedAbort(...signals: readonly (AbortSignal | undefined)[]): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  for (const signal of signals) {
    if (signal?.aborted) {
      controller.abort()
    }
    signal?.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) {
        signal?.removeEventListener('abort', abort)
      }
    },
  }
}

function emptySubscribe(): () => void {
  return () => undefined
}

function emptySnapshot(): number {
  return 0
}

/** RFC 4122 version 4 identifiers use host cryptographic entropy on web and native. */
function authOperationId(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    NativeModules.required('Authenticated data identifiers', 'react-native-get-random-values')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function liveValue(read: () => unknown): Evaluable {
  return { evaluate: () => evaluatedValue(read()) }
}

function evaluated(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if ('evaluate' in value && typeof value.evaluate === 'function') {
    return evaluated(value.evaluate().jsValue)
  }
  if (Array.isArray(value)) {
    return value.map(evaluated)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evaluated(item)]))
}

function evaluatedValue(jsValue: unknown): Evaluable & { jsValue: unknown } {
  return {
    jsValue,
    evaluate() {
      return this
    },
  }
}
