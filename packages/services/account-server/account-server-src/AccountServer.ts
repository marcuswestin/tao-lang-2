import { Errors, FS } from '@shared'
import type { AccountProtocol } from 'tao-shared/auth'
import { type AccountPolicy, accountPolicyFromJSON, rejectAccountRequest } from './AccountPolicy'
import { AccountStore } from './AccountStore'

export type { AccountPolicy } from './AccountPolicy'

/** AccountServerOptions are trusted deployment configuration, not client-provided metadata. */
export type AccountServerOptions = {
  allowedOrigins?: readonly string[]
  clock?: () => number
  databasePath: string
  issuer: string
  policy: AccountPolicy
  port?: number
  resource: string
  sessionLifetimeMs?: number
}

/** AccountServer runs the durable localhost reference identity and entity authority. */
export class AccountServer {
  readonly #options: AccountServerOptions
  readonly #store: AccountStore
  readonly #server: Bun.Server<undefined>
  readonly #dummyHash: string
  readonly #requests = new Set<Promise<Response>>()
  #stopping: Promise<void> | undefined
  readonly url: string

  private constructor(options: AccountServerOptions, dummyHash: string) {
    this.#options = { ...options, policy: structuredClone(options.policy) }
    this.#dummyHash = dummyHash
    this.#store = new AccountStore(options.databasePath, options.policy)
    try {
      this.#server = Bun.serve({
        fetch: request => this.#accept(request),
        hostname: '127.0.0.1',
        maxRequestBodySize: 1024 * 1024,
        port: options.port ?? 0,
      })
    } catch (error) {
      this.#store.close()
      throw error
    }
    this.url = `http://127.0.0.1:${this.#server.port}`
  }

  static async start(options: AccountServerOptions): Promise<AccountServer> {
    accountPolicyFromJSON(options.policy)
    if (!options.issuer || !options.resource || !Object.hasOwn(options.policy.entities, options.policy.accountEntity)) {
      Errors.throwUserInput('The account server requires an issuer, resource, and Account entity.')
    }
    if (
      options.sessionLifetimeMs !== undefined
      && (!Number.isSafeInteger(options.sessionLifetimeMs) || options.sessionLifetimeMs <= 0)
    ) {
      Errors.throwUserInput('Session lifetime must be a positive integer number of milliseconds.')
    }
    await FS.mkdir(FS.dirname(options.databasePath))
    return new AccountServer(options, await Bun.password.hash('unavailable-local-account-password'))
  }

  async stop(): Promise<void> {
    this.#stopping ??= (async () => {
      await this.#server.stop(true)
      await Promise.all(this.#requests)
      this.#store.close()
    })()
    await this.#stopping
  }

  /** Trusted issuer adapter/test harness only; never available through HTTP. */
  provision(issuer: string, subject: string): { accountId: string; issuer: string; subject: string } {
    return this.#store.provision(issuer, subject)
  }

  /** Trusted fixture input; neither tokens nor callers can invoke this route. */
  seed(rows: readonly AccountProtocol.Row[]): void {
    this.#store.seed(rows)
  }

  /** Trusted test harness revocation, in addition to normal authenticated sign-out. */
  revoke(token: string): void {
    this.#store.revoke(token)
  }

  #accept(request: Request): Promise<Response> {
    const pending = this.#handle(request)
    this.#requests.add(pending)
    void pending.finally(() => this.#requests.delete(pending))
    return pending
  }

  async #handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin')
    const headers: Record<string, string> = { 'cache-control': 'no-store', 'content-type': 'application/json' }
    if (origin !== null && this.#options.allowedOrigins?.includes(origin)) {
      headers['access-control-allow-origin'] = origin
      headers['vary'] = 'Origin'
      headers['access-control-allow-headers'] = 'authorization, content-type'
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    }
    try {
      if (origin !== null && !this.#options.allowedOrigins?.includes(origin)) {
        rejectAccountRequest('forbidden', 'Origin is not allowed.')
      }
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers, status: 204 })
      }
      const body = await this.#route(request)
      return new Response(JSON.stringify(body), { headers })
    } catch (error) {
      const code = Errors.isTaoError(error) ? error.details?.['accountProtocolCode'] : undefined
      const statuses = { invalid: 400, unauthorized: 401, forbidden: 403, conflict: 409, unavailable: 503 } as const
      const known = typeof code === 'string' && Object.hasOwn(statuses, code)
      const category = known ? code as keyof typeof statuses : 'unavailable'
      const failure: AccountProtocol.Failure = {
        error: {
          code: category,
          message: known && Errors.isTaoError(error) ? error.messageForUser : 'The account service is unavailable.',
        },
      }
      return new Response(JSON.stringify(failure), { headers, status: statuses[category] })
    }
  }

  async #route(request: Request): Promise<unknown> {
    const path = new URL(request.url).pathname
    if (request.method === 'POST' && (path === '/v1/auth/sign-in' || path === '/v1/auth/sign-up')) {
      const body = await readObject(request)
      exactKeys(body, ['email', 'password', 'resource'])
      const email = text(body['email']).trim().toLowerCase()
      const password = text(body['password'])
      if (!email.includes('@') || password.length < 8 || password.length > 1024) {
        rejectAccountRequest('invalid', 'Enter an email and a password of 8 to 1024 characters.')
      }
      if (body['resource'] !== this.#options.resource) {
        rejectAccountRequest('unauthorized', 'The requested resource is not available.')
      }
      const identity = path === '/v1/auth/sign-up'
        ? this.#store.register(email, await Bun.password.hash(password), this.#options.issuer)
        : await this.#signIn(email, password)
      return this.#store.createSession(
        identity,
        this.#options.resource,
        this.#now() + (this.#options.sessionLifetimeMs ?? 60 * 60 * 1000),
      )
    }
    const authorization = request.headers.get('authorization') ?? ''
    if (!/^Bearer [a-f0-9]{96}$/.test(authorization)) {
      rejectAccountRequest('unauthorized', 'Sign in to continue.')
    }
    const token = authorization.slice(7)
    if (path === '/v1/auth/sign-out' && request.method === 'POST') {
      this.#store.signOut(token, this.#options.resource)
      return { signedOut: true }
    }
    if (path === '/v1/data/transactions' && request.method === 'POST') {
      // Read asynchronous request bytes first; verification occurs immediately before synchronous commit.
      const transaction = parseTransaction(await readObject(request))
      return this.#store.transact(token, this.#options.resource, () => this.#now(), transaction)
    }
    const session = this.#store.session(token, this.#options.resource, this.#now())
    if (path === '/v1/auth/session' && request.method === 'GET') {
      return { ...session, token }
    }
    if (path === '/v1/auth/data-key' && request.method === 'GET') {
      return this.#store.dataKey(token, this.#options.resource, () => this.#now())
    }
    if (path === '/v1/data' && request.method === 'GET') {
      return this.#store.snapshot(token, this.#options.resource, () => this.#now())
    }
    return rejectAccountRequest('invalid', 'Unknown account protocol route.')
  }

  async #signIn(email: string, password: string): Promise<{ accountId: string; issuer: string; subject: string }> {
    const stored = this.#store.password(email)
    const matches = await Bun.password.verify(password, stored?.hash ?? this.#dummyHash)
    if (stored === null || !matches) {
      rejectAccountRequest('unauthorized', 'The email or password was not accepted.')
    }
    return this.#store.provision(this.#options.issuer, stored.subject)
  }

  #now(): number {
    return (this.#options.clock ?? Date.now)()
  }
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    rejectAccountRequest('invalid', 'Expected JSON.')
  }
  try {
    return record(await request.json())
  } catch {
    return rejectAccountRequest('invalid', 'Expected a JSON object.')
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    rejectAccountRequest('invalid', 'Expected an object.')
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    rejectAccountRequest('invalid', 'Unexpected request fields.')
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    rejectAccountRequest('invalid', 'Expected nonempty text.')
  }
  return value
}

function parseTransaction(body: Record<string, unknown>): AccountProtocol.Transaction {
  exactKeys(body, ['operationId', 'operations'])
  const operationId = text(body['operationId'])
  if (!Array.isArray(body['operations']) || body['operations'].length < 1 || body['operations'].length > 100) {
    rejectAccountRequest('invalid', 'Expected 1 to 100 operations.')
  }
  const operations = body['operations'].map((raw: unknown): AccountProtocol.Operation => {
    const value = record(raw)
    const kind = value['kind']
    if (kind !== 'create' && kind !== 'update' && kind !== 'delete') {
      rejectAccountRequest('invalid', 'Unknown operation.')
    }
    const entity = text(value['entity'])
    const id = text(value['id'])
    if (kind === 'delete') {
      exactKeys(value, ['kind', 'entity', 'id'])
      return { entity, id, kind }
    }
    exactKeys(value, ['kind', 'entity', 'id', 'fields'])
    const fields = record(value['fields'])
    if (Object.keys(fields).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) {
      rejectAccountRequest('invalid', 'Invalid field name.')
    }
    return { entity, fields, id, kind }
  })
  return { operationId, operations }
}
