import React from 'react'
import { RuntimeAssert } from './TR-assert'
import { AuthSecrets } from './TR-auth-secrets'
import { createElement } from './TR-create-element'
import type {
  TaoAppDatasourceBinding,
  TaoConfiguredDatasource,
  TaoDataSchema,
  TaoDatasourceDeclaration,
} from './TR-data'
import { entityHandle, metadataOf } from './TR-data-entity'
import { registerDataSchema, unregisterDataSchema } from './TR-data-registry'
import { RuntimeDataSchema } from './TR-data-schema'
import { UserInputError, warnContainedFailure } from './TR-errors'
import { runtimeRevisionStore } from './TR-listeners'
import { NativeModules } from './TR-native-modules'
import type { RuntimeAppDefinition } from './TR-navigation-app'
import type { Evaluable } from './TR-navigation-presentables'
import type { TaoAuthPairing } from './TR-pairing'
import { withReadAvailability } from './TR-read-availability'

export type TaoAuthIdentity = Readonly<{ issuer: string; subject: string; accountId: string }>
export type TaoAuthSession = Readonly<{
  state:
    | 'Restoring'
    | 'SignedOut'
    | 'Authenticating'
    | 'ChallengeRequired'
    | 'ReauthenticationRequired'
    | 'SignedIn'
    | 'Error'
  identity?: TaoAuthIdentity
  challenge?: Readonly<{ id: string; kind: string; expiresAt?: number }>
  message?: string
}>
export type TaoAuthOutcome = Readonly<{
  status: 'completed' | 'cancelled' | 'rejected' | 'error'
  message?: string
}>
export type TaoAuthResult = Readonly<{ outcome: TaoAuthOutcome; session?: TaoAuthSession }>
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
export type TaoAuthCredentialRequest = Readonly<{ audience: string; signal: AbortSignal }>
export type TaoAuthCredential = Readonly<{ audience: string; value: string; expiresAt?: number }>
export type TaoAuthSecretStorage = Readonly<{
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}>
export type TaoAuthConnection = {
  capabilities: TaoAuthCapabilities
  restore(signal: AbortSignal): Promise<TaoAuthSession>
  signIn(input: TaoAuthInput, signal: AbortSignal): Promise<TaoAuthResult>
  cancel?(): void
  signOut(signal: AbortSignal): Promise<TaoAuthOutcome>
  credential(request: TaoAuthCredentialRequest): Promise<TaoAuthCredential>
  subscribe?(listener: (session: TaoAuthSession) => void): () => void
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
/** Only transports receive this broker; Tao expressions cannot obtain resource credentials. */
export type TaoDataAuthBinding = Readonly<{
  accountId: string
  generation: number
  signal: AbortSignal
  testing?: true
  onInvalidate?(cleanup: () => void | Promise<void>): () => void
  credential(audience: string): Promise<TaoAuthCredential>
}>

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

  constructor(readonly source?: TaoConfiguredAuth) {
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
    try {
      const connection = this.connect()
      const session = await connection.restore(operation.signal)
      if (this.isCurrent(operation.generation)) {
        this.accept(session)
        this.watch()
      }
    } catch {
      if (this.isCurrent(operation.generation)) {
        this.accept({ state: 'Error', message: 'Unable to restore your session.' })
      }
    }
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
      return { status: 'error', message: 'Unable to sign in. Please try again.' }
    }
    if (!connection.capabilities.methods.includes(input.method)) {
      return { status: 'rejected', message: 'This sign-in method is not available.' }
    }
    const operation = this.beginOperation()
    try {
      this.accept({ state: 'Authenticating' })
      const result = await connection.signIn(input, operation.signal)
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
      if (result.outcome.status === 'completed' && result.session) {
        this.accept(result.session)
      } else {
        this.accept(signedOut)
      }
      this.watch()
      if (result.outcome.status === 'completed' && this.current.state === 'SignedIn') {
        this.finishPresentation(completed)
      }
      if (result.outcome.status === 'cancelled') {
        this.finishPresentation(cancelled)
      }
      return result.outcome
    } catch {
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
      this.accept(signedOut)
      return { status: 'error', message: 'Unable to sign in. Please try again.' }
    }
  }

  cancel(): TaoAuthOutcome {
    this.beginOperation()
    this.accept(signedOut)
    this.finishPresentation(cancelled)
    try {
      this.connection?.cancel?.()
    } catch (error) {
      warnContainedFailure('Authentication cancellation cleanup failed.', error)
    }
    return cancelled
  }

  signOut(): Promise<TaoAuthOutcome> {
    return trackAuthOperation(this.signOutSession(), this.operation.signal)
  }

  private async signOutSession(): Promise<TaoAuthOutcome> {
    if (this.disposed) {
      return cancelled
    }
    const operation = this.beginOperation()
    this.accept(signedOut)
    this.finishPresentation(cancelled)
    const cleanup = this.cleanup
    try {
      const outcome = await this.connection?.signOut(operation.signal) ?? completed
      const cleaned = await cleanup
      if (!this.isCurrent(operation.generation)) {
        return cancelled
      }
      return cleaned
        ? outcome
        : { status: 'error', message: 'Signed out. Some local account data could not be removed.' }
    } catch {
      await cleanup
      return this.isCurrent(operation.generation)
        ? { status: 'error', message: 'Signed out on this device. Remote sign-out could not be confirmed.' }
        : cancelled
    }
  }

  async credential(request: TaoAuthCredentialRequest): Promise<TaoAuthCredential> {
    const identity = this.current.identity
    const generation = this.identityGeneration
    const lifetime = this.identityLifetime.signal
    if (this.disposed || this.current.state !== 'SignedIn' || !identity || request.signal.aborted) {
      throw new UserInputError('Sign in to access this resource.')
    }
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    lifetime.addEventListener('abort', abort, { once: true })
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      const credential = await this.connect().credential({ audience: request.audience, signal: controller.signal })
      if (controller.signal.aborted || generation !== this.identityGeneration || this.disposed) {
        throw new UserInputError('This session is no longer active.')
      }
      RuntimeAssert.input(
        credential.audience === request.audience && credential.value.length > 0
          && (credential.expiresAt === undefined || credential.expiresAt > Date.now()),
        'The resource credential is not valid for this request.',
      )
      return credential
    } finally {
      lifetime.removeEventListener('abort', abort)
      request.signal.removeEventListener('abort', abort)
    }
  }

  app(declaration: RuntimeAppDefinition): RuntimeAppDefinition {
    let app = this.apps.get(declaration)
    if (!app) {
      RuntimeAssert.input(!this.disposed, 'This app is no longer mounted.')
      app = declaration.mountForAuth(this)
      this.apps.set(declaration, app)
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
    for (const binding of bindings) {
      this.store(binding.store)
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
    this.accept(
      accountId === undefined ? signedOut : {
        state: 'SignedIn',
        identity: { accountId, issuer: 'tao-test', subject: fixture.signedIn! },
      },
    )
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
      this.operation.abort()
      this.operationGeneration += 1
      this.accept(session)
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

  private accept(session: TaoAuthSession): void {
    RuntimeAssert.input(
      session.state !== 'SignedIn' || !!(
        session.identity?.accountId && session.identity.issuer && session.identity.subject
      ),
      'An authenticated session requires a verified account identity.',
    )
    const identity = session.state === 'SignedIn' ? session.identity : undefined
    const before = this.current.identity
    const identityChanged = before?.accountId !== identity?.accountId || before?.issuer !== identity?.issuer
      || before?.subject !== identity?.subject
    this.current = Object.freeze({
      state: session.state,
      ...(identity ? { identity: Object.freeze({ ...identity }) } : {}),
      ...(session.challenge ? { challenge: Object.freeze({ ...session.challenge }) } : {}),
      ...(session.message ? { message: session.message } : {}),
    })
    if (identityChanged) {
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
      const signal = this.identityLifetime.signal
      const invalidations = this.invalidations
      this.dataAuth = identity
        ? Object.freeze({
          accountId: identity.accountId,
          generation: this.identityGeneration,
          signal,
          onInvalidate: (cleanup: () => void | Promise<void>) => {
            RuntimeAssert.input(!signal.aborted, 'This account data connection is no longer active.')
            invalidations.add(cleanup)
            return () => invalidations.delete(cleanup)
          },
          ...(this.source?.declaration.provider.testing ? { testing: true as const } : {}),
          credential: (audience: string) => this.credential({ audience, signal }),
        })
        : undefined
      this.bindStores()
      for (const app of this.apps.values()) {
        app.reset()
      }
    }
    this.changes.changed()
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
        store.bindConfigured(
          this.fixtureSource(store, binding.source),
          binding.storageName,
          this.dataAuth ?? fixtureAuth,
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
          authenticatedAuthority: 'test' as const,
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
