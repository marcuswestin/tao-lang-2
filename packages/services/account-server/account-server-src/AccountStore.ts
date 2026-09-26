import { Platform } from '@shared'
import { Database } from 'bun:sqlite'
import type { AccountProtocol } from 'tao-shared/auth'
import { canonicalJSON, proposeAccountRows } from './AccountChanges'
import { type AccountPolicy, canAccess, rejectAccountRequest, validateAccountRows } from './AccountPolicy'

type Identity = { accountId: string; issuer: string; subject: string }
type StoredSession = Identity & { expiresAt: number; resource: string }

/** AccountStore serializes verified identities and entity transactions in SQLite. */
export class AccountStore {
  readonly #db: Database
  readonly #policy: AccountPolicy
  readonly #localEntities: boolean

  constructor(path: string, policy: AccountPolicy, localEntities = true) {
    this.#localEntities = localEntities
    this.#policy = structuredClone(policy)
    this.#db = new Database(path, { create: true, strict: true })
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS authority (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS persistenceMode (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS authConfiguration (id INTEGER PRIMARY KEY CHECK(id = 1), mode TEXT NOT NULL, issuer TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, accountId TEXT NOT NULL UNIQUE, PRIMARY KEY (issuer, subject));
      CREATE TABLE IF NOT EXISTS passwords (email TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, accountId TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL, expiresAt INTEGER NOT NULL, resource TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (entity TEXT NOT NULL, id TEXT NOT NULL, fields TEXT NOT NULL, PRIMARY KEY (entity, id));
      CREATE TABLE IF NOT EXISTS receipts (accountId TEXT NOT NULL, resource TEXT NOT NULL, operationId TEXT NOT NULL, fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(accountId, resource, operationId));
      CREATE TABLE IF NOT EXISTS dataKeys (accountId TEXT NOT NULL, resource TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(accountId, resource));
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO state VALUES (1, 0);
    `)
    try {
      this.#db.transaction(() => {
        const mode = this.#db.query<{ value: string }, []>('SELECT value FROM persistenceMode WHERE id = 1').get()
        const requested = localEntities ? 'local' : 'instant'
        if (mode !== null && mode.value !== requested) {
          rejectAccountRequest('unavailable', 'This account database belongs to another persistence mode.')
        }
        if (mode === null && !localEntities) {
          const existing = this.#db.query<{ count: number }, []>(
            'SELECT ((SELECT count(*) FROM identities) + (SELECT count(*) FROM passwords) + (SELECT count(*) FROM sessions) + (SELECT count(*) FROM rows)) AS count',
          ).get()!
          if (existing.count !== 0) {
            rejectAccountRequest(
              'unavailable',
              'An existing local account database requires an explicit migration before using Instant.',
            )
          }
        }
        this.#db.query('INSERT OR IGNORE INTO persistenceMode VALUES (1, ?)').run(requested)
      }).immediate()
    } catch (error) {
      this.#db.close()
      throw error
    }
  }

  close(): void {
    this.#db.close()
  }

  /** An auth database belongs to one login authority; changing it requires an explicit migration. */
  bindAuthentication(mode: 'local' | 'clerk', issuer: string): void {
    this.#db.transaction(() => {
      const existing = this.#db.query<{ mode: string; issuer: string }, []>(
        'SELECT mode, issuer FROM authConfiguration WHERE id = 1',
      ).get()
      if (existing !== null && (existing.mode !== mode || existing.issuer !== issuer)) {
        rejectAccountRequest(
          'unavailable',
          'This account database belongs to another authentication mode or issuer. Use a new database or an explicit migration.',
        )
      }
      if (existing === null && mode === 'clerk') {
        const contents = this.#db.query<{ count: number }, []>(
          'SELECT ((SELECT count(*) FROM identities) + (SELECT count(*) FROM passwords) + (SELECT count(*) FROM sessions) + (SELECT count(*) FROM rows) + (SELECT count(*) FROM receipts) + (SELECT count(*) FROM dataKeys)) AS count',
        ).get()!
        if (contents.count !== 0) {
          rejectAccountRequest(
            'unavailable',
            'An existing unbound account database requires an explicit migration before using Clerk.',
          )
        }
      }
      this.#db.query('INSERT OR IGNORE INTO authConfiguration VALUES (1, ?, ?)').run(mode, issuer)
    }).immediate()
  }

  /** Stable identity of this auth database, bound permanently to its remote app. */
  authorityId(): string {
    return this.#db.transaction(() => {
      this.#db.query('INSERT OR IGNORE INTO authority VALUES (1, ?)').run(Platform.randomUUID())
      return this.#db.query<{ value: string }, []>('SELECT value FROM authority WHERE id = 1').get()!.value
    }).immediate()
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
    if (this.#localEntities) {
      this.#put({ entity: this.#policy.accountEntity, fields: {}, id: accountId })
      this.#db.query('UPDATE state SET revision = revision + 1').run()
    }
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

  hasExpiredSessions(now: number): boolean {
    return this.#db.query<{ hash: string }, [number]>('SELECT hash FROM sessions WHERE expiresAt <= ? LIMIT 1').get(now)
      !== null
  }

  pruneExpiredSessions(now: number): void {
    this.#db.query('DELETE FROM sessions WHERE expiresAt <= ?').run(now)
  }

  /** Includes expired sessions: their previously admitted remote writes still need fencing. */
  hasSession(token: string, resource?: string): boolean {
    return this.#db.query<{ hash: string }, [string, string | null, string | null]>(
      'SELECT hash FROM sessions WHERE hash = ? AND (? IS NULL OR resource = ?)',
    ).get(Platform.sha256Hex(token), resource ?? null, resource ?? null) !== null
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
      const proposed = proposeAccountRows(this.#policy, before, request.operations, session.accountId)
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
