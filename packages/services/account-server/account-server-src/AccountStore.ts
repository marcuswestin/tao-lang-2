import { Platform, Switch } from '@shared'
import { Database } from 'bun:sqlite'
import type { AccountProtocol } from 'tao-shared/auth'
import { type AccountPolicy, canAccess, rejectAccountRequest, validateAccountRows } from './AccountPolicy'

type Identity = { accountId: string; issuer: string; subject: string }
type StoredSession = Identity & { expiresAt: number; resource: string }

/** AccountStore serializes verified identities and entity transactions in SQLite. */
export class AccountStore {
  readonly #db: Database
  readonly #policy: AccountPolicy

  constructor(path: string, policy: AccountPolicy) {
    this.#policy = structuredClone(policy)
    this.#db = new Database(path, { create: true, strict: true })
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, accountId TEXT NOT NULL UNIQUE, PRIMARY KEY (issuer, subject));
      CREATE TABLE IF NOT EXISTS passwords (email TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, accountId TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL, expiresAt INTEGER NOT NULL, resource TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (entity TEXT NOT NULL, id TEXT NOT NULL, fields TEXT NOT NULL, PRIMARY KEY (entity, id));
      CREATE TABLE IF NOT EXISTS receipts (accountId TEXT NOT NULL, resource TEXT NOT NULL, operationId TEXT NOT NULL, fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(accountId, resource, operationId));
      CREATE TABLE IF NOT EXISTS dataKeys (accountId TEXT NOT NULL, resource TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(accountId, resource));
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO state VALUES (1, 0);
    `)
  }

  close(): void {
    this.#db.close()
  }

  password(email: string): { subject: string; hash: string } | null {
    return this.#db.query<{ subject: string; hash: string }, [string]>(
      'SELECT subject, hash FROM passwords WHERE email = ?',
    ).get(email)
  }

  register(email: string, hash: string, issuer: string): Identity {
    return this.#db.transaction(() => {
      if (this.password(email) !== null) {
        rejectAccountRequest('conflict', 'Unable to register this login.')
      }
      const subject = Platform.randomUUID()
      this.#db.query('INSERT INTO passwords VALUES (?, ?, ?)').run(email, subject, hash)
      return this.#provision(issuer, subject)
    }).immediate()
  }

  /** provision is a trusted issuer-verification boundary, never an HTTP operation. */
  provision(issuer: string, subject: string): Identity {
    return this.#db.transaction(() => this.#provision(issuer, subject)).immediate()
  }

  #provision(issuer: string, subject: string): Identity {
    const existing = this.#db.query<Identity, [string, string]>(
      'SELECT * FROM identities WHERE issuer = ? AND subject = ?',
    ).get(issuer, subject)
    if (existing !== null) {
      return existing
    }
    const accountId = Platform.randomUUID()
    this.#db.query('INSERT INTO identities VALUES (?, ?, ?)').run(issuer, subject, accountId)
    this.#put({ entity: this.#policy.accountEntity, fields: {}, id: accountId })
    this.#db.query('UPDATE state SET revision = revision + 1').run()
    return { accountId, issuer, subject }
  }

  session(token: string, resource: string, now: number): StoredSession {
    const session = this.#db.query<StoredSession, [string]>(
      'SELECT accountId, issuer, subject, expiresAt, resource FROM sessions WHERE hash = ?',
    ).get(Platform.sha256Hex(token))
    if (session === null || session.expiresAt <= now || session.resource !== resource) {
      rejectAccountRequest('unauthorized', 'Sign in to continue.')
    }
    return session
  }

  createSession(identity: Identity, resource: string, expiresAt: number): AccountProtocol.Session {
    const token = Array.from({ length: 3 }, () => Platform.randomUUID().replaceAll('-', '')).join('')
    this.#db.query('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run(
      Platform.sha256Hex(token),
      identity.accountId,
      identity.issuer,
      identity.subject,
      expiresAt,
      resource,
    )
    return { ...identity, expiresAt, resource, token }
  }

  revoke(token: string): void {
    this.#db.query('DELETE FROM sessions WHERE hash = ?').run(Platform.sha256Hex(token))
  }

  signOut(token: string, resource: string): void {
    this.#db.query('DELETE FROM sessions WHERE hash = ? AND resource = ?').run(Platform.sha256Hex(token), resource)
  }

  dataKey(token: string, resource: string, now: () => number): AccountProtocol.DataKey {
    return this.#db.transaction(() => {
      const { accountId } = this.session(token, resource, now())
      let entry = this.#db.query<{ key: string }, [string, string]>(
        'SELECT key FROM dataKeys WHERE accountId = ? AND resource = ?',
      ).get(accountId, resource)
      if (entry === null) {
        entry = { key: Platform.sha256Hex(Array.from({ length: 3 }, () => Platform.randomUUID()).join('')) }
        this.#db.query('INSERT INTO dataKeys VALUES (?, ?, ?)').run(accountId, resource, entry.key)
      }
      return { accountId, key: entry.key, resource }
    }).immediate()
  }

  snapshot(token: string, resource: string, now: () => number): AccountProtocol.Snapshot {
    return this.#db.transaction(() => {
      const { accountId } = this.session(token, resource, now())
      const rows = this.#rows()
      return {
        revision: this.#revision(),
        rows: rows.filter(row => canAccess(this.#policy, rows, row, accountId, 'read')),
      }
    })()
  }

  transact(
    token: string,
    resource: string,
    now: () => number,
    request: AccountProtocol.Transaction,
  ): AccountProtocol.Receipt {
    return this.#db.transaction(() => {
      // Verify under the same lock as writes: another authority process can revoke a session
      // while this process is waiting to enter its transaction.
      const session = this.session(token, resource, now())
      const fingerprint = Platform.sha256Hex(canonicalJSON(request.operations))
      const previous = this.#db.query<{ fingerprint: string; receipt: string }, [string, string, string]>(
        'SELECT fingerprint, receipt FROM receipts WHERE accountId = ? AND resource = ? AND operationId = ?',
      ).get(session.accountId, session.resource, request.operationId)
      if (previous !== null) {
        if (previous.fingerprint !== fingerprint) {
          rejectAccountRequest('conflict', 'Operation ID already identifies a different write.')
        }
        return JSON.parse(previous.receipt) as AccountProtocol.Receipt
      }
      const before = this.#rows()
      const proposed = structuredClone(before)
      const touched = new Set<string>()
      for (const operation of request.operations) {
        const key = JSON.stringify([operation.entity, operation.id])
        if (touched.has(key)) {
          rejectAccountRequest('invalid', 'Each row may appear once per transaction.')
        }
        touched.add(key)
        const index = proposed.findIndex(row => row.entity === operation.entity && row.id === operation.id)
        Switch.kind(operation, {
          create: value => {
            if (index >= 0) {
              rejectAccountRequest('conflict', 'Row already exists.')
            }
            if (value.entity === this.#policy.accountEntity) {
              rejectAccountRequest('forbidden', 'Accounts require trusted provisioning.')
            }
            proposed.push({ entity: value.entity, id: value.id, fields: value.fields })
          },
          delete: () => {
            if (index < 0) {
              rejectAccountRequest('forbidden', 'Write is not authorized.')
            }
            proposed.splice(index, 1)
          },
          update: value => {
            if (index < 0) {
              rejectAccountRequest('forbidden', 'Write is not authorized.')
            }
            proposed[index] = { ...proposed[index]!, fields: { ...proposed[index]!.fields, ...value.fields } }
          },
        })
      }
      for (const operation of request.operations) {
        const source = operation.kind === 'delete' ? before : proposed
        const row = source.find(candidate => candidate.entity === operation.entity && candidate.id === operation.id)!
        const changed = operation.kind === 'update' ? Object.keys(operation.fields) : []
        if (
          !canAccess(
            this.#policy,
            operation.kind === 'delete' ? before : proposed,
            row,
            session.accountId,
            operation.kind,
            changed,
          )
        ) {
          rejectAccountRequest('forbidden', 'Write is not authorized.')
        }
      }
      validateAccountRows(this.#policy, proposed)
      for (const operation of request.operations) {
        if (operation.kind === 'delete') {
          this.#db.query('DELETE FROM rows WHERE entity = ? AND id = ?').run(operation.entity, operation.id)
        } else {
          this.#put(proposed.find(row => row.entity === operation.entity && row.id === operation.id)!)
        }
      }
      this.#db.query('UPDATE state SET revision = revision + 1').run()
      const receipt: AccountProtocol.Receipt = {
        operationId: request.operationId,
        revision: this.#revision(),
        status: 'saved',
      }
      this.#db.query('INSERT INTO receipts VALUES (?, ?, ?, ?, ?)').run(
        session.accountId,
        session.resource,
        request.operationId,
        fingerprint,
        JSON.stringify(receipt),
      )
      return receipt
    }).immediate()
  }

  /** seed is trusted fixture/deployment input and has no HTTP route. */
  seed(rows: readonly AccountProtocol.Row[]): void {
    this.#db.transaction(() => {
      for (const row of rows) {
        this.#put(row)
      }
      validateAccountRows(this.#policy, this.#rows())
      this.#db.query('UPDATE state SET revision = revision + 1').run()
    }).immediate()
  }

  #put(row: AccountProtocol.Row): void {
    this.#db.query('INSERT INTO rows VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET fields = excluded.fields')
      .run(row.entity, row.id, JSON.stringify(row.fields))
  }
  #rows(): AccountProtocol.Row[] {
    return this.#db.query<{ entity: string; id: string; fields: string }, []>('SELECT * FROM rows').all().map(row => ({
      ...row,
      fields: JSON.parse(row.fields) as Record<string, unknown>,
    }))
  }
  #revision(): number {
    return this.#db.query<{ revision: number }, []>('SELECT revision FROM state WHERE id = 1').get()!.revision
  }
}

/** Object field order is transport trivia, while operation and array order remain meaningful. */
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${
      Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')
    }}`
  }
  return JSON.stringify(value)
}
