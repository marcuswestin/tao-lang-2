import { FS, Platform } from '@shared'
import { Database } from 'bun:sqlite'
import type { AccountProtocol } from 'tao-shared/auth'
import { canonicalJSON, proposeAccountRows } from './AccountChanges'
import { type AccountPolicy, canAccess, rejectAccountRequest, validateAccountRows } from './AccountPolicy'

type InstantOptions = { apiURI: string; appId: string; adminToken: string }
type Document = Record<string, unknown> & { id: string }
type State = { rows: AccountProtocol.Row[]; revision: number; receipts: Document[] }
type Step = readonly unknown[]
const authorityNamespace = 'taoAccountAuthority'
const guardNamespace = 'taoAccountGuard'
const receiptNamespace = 'taoAccountReceipt'

/** A single local gateway owns identities; Instant owns every entity, revision, and receipt. */
export class InstantAccountStore {
  readonly #options: InstantOptions
  readonly #policy: AccountPolicy
  readonly #resource: string
  readonly #lock: Database
  readonly #namespaces: string[]

  private constructor(options: InstantOptions, policy: AccountPolicy, resource: string, lock: Database) {
    this.#options = options
    this.#policy = policy
    this.#resource = resource
    this.#lock = lock
    this.#namespaces = [
      authorityNamespace,
      guardNamespace,
      receiptNamespace,
      ...Object.keys(policy.entities).map(namespace),
    ]
  }

  static async open(
    options: InstantOptions,
    policy: AccountPolicy,
    resource: string,
    databasePath: string,
    authorityId: string,
  ): Promise<InstantAccountStore> {
    if ([options.apiURI, options.appId, options.adminToken].some(value => typeof value !== 'string' || !value.trim())) {
      rejectAccountRequest(
        'invalid',
        'The Instant account configuration requires an endpoint, app ID, and admin token.',
      )
    }
    let url: URL
    try {
      url = new URL(options.apiURI)
    } catch {
      return rejectAccountRequest('invalid', 'The Instant endpoint requires a valid HTTP origin.')
    }
    if (
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || url.pathname !== '/'
    ) {
      rejectAccountRequest('invalid', 'The Instant endpoint requires an HTTP origin without credentials.')
    }
    const lock = new Database(`${await FS.realPath(databasePath)}.instant-writer.sqlite`, {
      create: true,
      strict: true,
    })
    try {
      // This separate transaction lives for the process lifetime. SQLite releases it on process
      // death; there is no expiring lease that could admit two live authorities.
      lock.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;')
    } catch {
      lock.close()
      rejectAccountRequest('unavailable', 'Another gateway owns this Instant account database.')
    }
    const store = new InstantAccountStore({ ...options }, structuredClone(policy), resource, lock)
    try {
      await store.#schema()
      await store.#denyDirectAccess()
      await store.#bindAuthority(authorityId)
      await store.barrier()
      return store
    } catch (error) {
      store.close()
      throw error
    }
  }

  close(): void {
    this.#lock.close()
  }

  /** Consume a revision before acknowledging revocation or serving after process recovery. */
  async barrier(): Promise<void> {
    await this.#write(() => '$barrier', Platform.randomUUID(), 'barrier', rows => rows)
  }

  async snapshot(accountId: string): Promise<AccountProtocol.Snapshot> {
    const state = await this.#read()
    return {
      revision: state.revision,
      rows: state.rows.filter(row => canAccess(this.#policy, state.rows, row, accountId, 'read')),
    }
  }

  async transact(accountId: () => string, request: AccountProtocol.Transaction): Promise<AccountProtocol.Receipt> {
    return this.#write(
      accountId,
      request.operationId,
      canonicalJSON(request.operations),
      rows => proposeAccountRows(this.#policy, rows, request.operations, accountId()),
    )
  }

  async provision(accountId: string): Promise<void> {
    await this.#write(() => '$provision', `account:${accountId}`, canonicalJSON(accountId), rows => {
      if (rows.some(row => row.entity === this.#policy.accountEntity && row.id === accountId)) {
        return rows
      }
      return [...rows, { entity: this.#policy.accountEntity, id: accountId, fields: {} }]
    })
  }

  async seed(rows: readonly AccountProtocol.Row[]): Promise<void> {
    await this.#write(() => '$seed', Platform.randomUUID(), canonicalJSON(rows), before => {
      const proposed = before.filter(row => !rows.some(value => value.entity === row.entity && value.id === row.id))
      proposed.push(...structuredClone(rows))
      validateAccountRows(this.#policy, proposed)
      return proposed
    })
  }

  async #write(
    authorize: () => string,
    operationId: string,
    payload: string,
    propose: (rows: AccountProtocol.Row[]) => AccountProtocol.Row[],
  ): Promise<AccountProtocol.Receipt> {
    const fingerprint = Platform.sha256Hex(payload)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = await this.#read()
      const accountId = authorize()
      const key = canonicalJSON([accountId, this.#resource, operationId])
      const previous = state.receipts.find(receipt => receipt['key'] === key)
      if (previous !== undefined) {
        if (previous['fingerprint'] !== fingerprint) {
          rejectAccountRequest('conflict', 'Operation ID already identifies a different write.')
        }
        return previous['receipt'] as AccountProtocol.Receipt
      }
      const proposed = propose(state.rows)
      const receipt: AccountProtocol.Receipt = { operationId, revision: state.revision + 1, status: 'saved' }
      const steps: Step[] = []
      for (const row of state.rows) {
        if (!proposed.some(value => value.entity === row.entity && value.id === row.id)) {
          steps.push(['delete', namespace(row.entity), rowId(row.entity, row.id)])
        }
      }
      for (const row of proposed) {
        const before = state.rows.find(value => value.entity === row.entity && value.id === row.id)
        if (before === undefined || canonicalJSON(before.fields) !== canonicalJSON(row.fields)) {
          steps.push(['update', namespace(row.entity), rowId(row.entity, row.id), {
            taoId: row.id,
            fields: row.fields,
          }])
        }
      }
      steps.push(
        ['create', guardNamespace, Platform.randomUUID(), {
          key: `${this.#resource}:${receipt.revision}`,
          revision: receipt.revision,
        }],
        ['create', receiptNamespace, Platform.randomUUID(), { key, fingerprint, receipt }],
      )
      // Both unique values fence stale/duplicate attempts, including requests still in flight
      // after a crash. Fresh IDs prevent update/upsert from defeating unique constraints.
      if (await this.#submit(steps)) {
        return receipt
      }
    }
    // A final read recovers a committed last attempt whose response was lost.
    const state = await this.#read()
    const key = canonicalJSON([authorize(), this.#resource, operationId])
    const saved = state.receipts.find(receipt => receipt['key'] === key && receipt['fingerprint'] === fingerprint)
    if (saved !== undefined) {
      return saved['receipt'] as AccountProtocol.Receipt
    }
    return rejectAccountRequest(
      'unavailable',
      'The account service could not confirm this write. Retry with the same operation ID.',
    )
  }

  async #read(): Promise<State> {
    const result = await this.#request('/admin/query', {
      query: Object.fromEntries(this.#namespaces.map(name => [name, {}])),
    })
    const rows = Object.keys(this.#policy.entities).flatMap(entity =>
      documents(result, namespace(entity)).filter(row => row['sentinel'] !== true).map(row => ({
        entity,
        id: row['taoId'] as string,
        fields: row['fields'] as Record<string, unknown>,
      }))
    )
    const revisions = documents(result, guardNamespace).filter(row => row['sentinel'] !== true)
    return {
      rows,
      revision: revisions.reduce((revision, row) => Math.max(revision, row['revision'] as number), 0),
      receipts: documents(result, receiptNamespace).filter(row => row['sentinel'] !== true),
    }
  }

  async #bindAuthority(authorityId: string): Promise<void> {
    const fingerprint = Platform.sha256Hex(canonicalJSON([this.#resource, this.#policy]))
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await this.#request('/admin/query', { query: { [authorityNamespace]: {} } })
      const existing = documents(result, authorityNamespace).find(row => row['key'] === 'authority')
      if (existing !== undefined) {
        if (existing['authorityId'] !== authorityId || existing['fingerprint'] !== fingerprint) {
          rejectAccountRequest('unavailable', 'This Instant app belongs to another account database or policy.')
        }
        return
      }
      await this.#submit([['create', authorityNamespace, Platform.randomUUID(), {
        key: 'authority',
        authorityId,
        fingerprint,
      }]])
    }
    rejectAccountRequest('unavailable', 'The Instant account authority could not be confirmed.')
  }

  async #schema(): Promise<void> {
    const definitions: Record<string, Record<string, boolean>> = {
      [authorityNamespace]: { key: true, authorityId: false, fingerprint: false },
      [guardNamespace]: { key: true, revision: false },
      [receiptNamespace]: { key: true, fingerprint: false, receipt: false },
      ...Object.fromEntries(
        Object.keys(this.#policy.entities).map(entity => [namespace(entity), { taoId: true, fields: false }]),
      ),
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const schema = await this.#request('/admin/schema')
      const blobs = ((schema['schema'] as Record<string, unknown>)['blobs'] ?? {}) as Record<
        string,
        Record<string, Record<string, unknown>>
      >
      const missing: Step[] = []
      for (const [name, fields] of Object.entries(definitions)) {
        for (const [field, unique] of Object.entries({ id: true, sentinel: false, ...fields })) {
          const existing = blobs[name]?.[field]
          if (existing !== undefined) {
            if (
              existing['unique?'] !== unique || existing['cardinality'] !== 'one' || existing['value-type'] !== 'blob'
            ) {
              rejectAccountRequest('unavailable', 'The Instant account schema does not match its required constraints.')
            }
          } else {
            missing.push(['add-attr', {
              id: uuid(`attribute:${this.#options.appId}:${name}:${field}`),
              'forward-identity': [uuid(`identity:${this.#options.appId}:${name}:${field}`), name, field],
              'value-type': 'blob',
              cardinality: 'one',
              'unique?': unique,
              'index?': unique,
            }])
          }
        }
      }
      if (missing.length === 0) {
        return
      }
      await this.#submit(missing)
    }
    rejectAccountRequest('unavailable', 'The Instant account schema could not be confirmed.')
  }

  async #denyDirectAccess(): Promise<void> {
    // Nonsecret sentinels make view/update/delete programs inspectable before storing user data.
    // Merely observing a false decision on sample data would not prove a deny-all policy.
    const sentinels = this.#namespaces.map(name => ['update', name, uuid(`sentinel:${name}`), { sentinel: true }])
    await this.#request('/admin/transact', { steps: sentinels })
    const view = await this.#request('/admin/query_perms_check', {
      query: Object.fromEntries(this.#namespaces.map(name => [name, {}])),
    }, true)
    for (const name of this.#namespaces) {
      requireDenial(view, name, 'view')
      for (const action of ['create', 'update', 'delete']) {
        const step = action === 'delete'
          ? ['delete', name, uuid(`sentinel:${name}`)]
          : [action, name, action === 'create' ? Platform.randomUUID() : uuid(`sentinel:${name}`), { sentinel: true }]
        const result = await this.#request('/admin/transact_perms_check', { steps: [step] }, true)
        requireDenial(result, name, action)
      }
    }
    const attrs = await this.#request('/admin/transact_perms_check', {
      steps: [['add-attr', {
        id: Platform.randomUUID(),
        'forward-identity': [
          Platform.randomUUID(),
          `taoPermissionProbe_${Platform.randomUUID().replaceAll('-', '')}`,
          'probe',
        ],
        'value-type': 'blob',
        cardinality: 'one',
        'unique?': false,
        'index?': false,
      }]],
    }, true)
    requireDenial(attrs, 'attrs', 'create')
  }

  async #submit(steps: readonly Step[]): Promise<boolean> {
    try {
      const response = await fetch(`${this.#options.apiURI.replace(/\/$/, '')}/admin/transact`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ steps }),
        signal: AbortSignal.timeout(30_000),
      })
      return response.ok
    } catch {
      // Network failure and transaction deadlock are both ambiguous to the caller. The receipt
      // and unique revision guard, not this HTTP result, determine whether retrying is safe.
      return false
    }
  }

  async #request(path: string, body?: Record<string, unknown>, guest = false): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.#options.apiURI.replace(/\/$/, '')}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...this.#headers(), ...(guest ? { 'As-Guest': 'true' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        rejectAccountRequest('unavailable', 'The Instant account service is unavailable.')
      }
      return await response.json() as Record<string, unknown>
    } catch {
      return rejectAccountRequest('unavailable', 'The Instant account service is unavailable.')
    }
  }

  #headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'App-Id': this.#options.appId,
      Authorization: `Bearer ${this.#options.adminToken}`,
    }
  }
}

function namespace(entity: string): string {
  return `taoAccountRow_${Platform.sha256Hex(entity).slice(0, 16)}`
}

function rowId(entity: string, id: string): string {
  return uuid(canonicalJSON(['row', entity, id]))
}

function uuid(value: string): string {
  const hex = Platform.sha256Hex(value)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function documents(value: Record<string, unknown>, namespace: string): Document[] {
  const rows = value[namespace]
  if (!Array.isArray(rows)) {
    rejectAccountRequest('unavailable', 'The Instant account response is invalid.')
  }
  return rows as Document[]
}

function requireDenial(result: Record<string, unknown>, namespace: string, action: string): void {
  const checks = result['check-results'] as
    | { program?: { etype?: string; action?: string; code?: string } }[]
    | undefined
  const matching = checks?.filter(check => check.program?.etype === namespace && check.program.action === action) ?? []
  if (matching.length === 0 || matching.some(check => check.program?.code?.trim() !== 'false')) {
    rejectAccountRequest('unavailable', 'The Instant account app must deny all direct client access.')
  }
}
