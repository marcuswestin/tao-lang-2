/** Direct, opt-in hosted authorization probe. Run only against the fixed public projects below. */
import * as CLI from '../../../packages/shared/shared-src/CLI'
import * as FS from '../../../packages/shared/shared-src/FS'
import * as HCI from '../../../packages/shared/shared-src/HCI'
import * as Platform from '../../../packages/shared/shared-src/Platform'
import connections from '../tao.connections.json'

const firebaseProject = 'tao-hosted-crud-79c429'
const appwriteProject = 'tao-hosted-crud-160214'
const appwriteEndpoint = 'https://fra.cloud.appwrite.io/v1'
const proofPrefix = 'hostile-probe-'
const requestTimeoutMs = 30_000

type Fetcher = typeof fetch
type Credential = { email: string; password: string }
type Accounts = { a: Credential; b: Credential }
type Json = Record<string, unknown>
type Reply = {
  status: number
  body: Json | undefined
  code?: string
  type?: string
  message?: string
  transport?: true
}
type Observation = {
  case: string
  expected: string
  actual: string
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'FINDING'
  status?: number
  code?: string
  type?: string
  message?: string
  authCategory?: AuthCategory
  row?: { id?: string; ownerId?: string; permissions?: string[] }
}
type AuthCategory =
  | 'credentials_rejected'
  | 'account_disabled'
  | 'rate_limited'
  | 'provider_configuration'
  | 'invalid_input'
  | 'session_unavailable'
  | 'unclassified_auth_failure'
  | 'provider_unavailable'
type AuthReason = { category: AuthCategory; code?: string; type?: string }
const firebaseAuthCodes: Readonly<Record<string, AuthCategory>> = {
  INVALID_LOGIN_CREDENTIALS: 'credentials_rejected',
  INVALID_PASSWORD: 'credentials_rejected',
  EMAIL_NOT_FOUND: 'credentials_rejected',
  USER_DISABLED: 'account_disabled',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'rate_limited',
  INVALID_EMAIL: 'invalid_input',
  OPERATION_NOT_ALLOWED: 'provider_configuration',
  API_KEY_INVALID: 'provider_configuration',
  INVALID_API_KEY: 'provider_configuration',
  PROJECT_NOT_FOUND: 'provider_configuration',
  CONFIGURATION_NOT_FOUND: 'provider_configuration',
}
const appwriteAuthTypes: Readonly<Record<string, AuthCategory>> = {
  user_invalid_credentials: 'credentials_rejected',
  user_password_mismatch: 'credentials_rejected',
  user_blocked: 'account_disabled',
  user_email_not_whitelisted: 'provider_configuration',
  project_platform_unsupported: 'provider_configuration',
  project_unknown: 'provider_configuration',
  general_argument_invalid: 'invalid_input',
}
export type Evidence = {
  provider: 'firebase' | 'appwrite'
  projectId: string
  startedAt: string
  observations: Observation[]
  leftoverIds: string[]
  cleanup: { id: string; status: string }[]
}
export type ProbeReport = {
  schema: 1
  startedAt: string
  checkpointAt: string
  state: 'prepared' | 'firebase-complete' | 'complete' | 'interrupted'
  interruptedProvider?: 'firebase' | 'appwrite'
  source: { head: string; dirty: boolean | 'unknown'; scriptSha256: string; testSha256: string }
  projects: { firebase: string; appwrite: string }
  firebase?: Evidence
  appwrite?: Evidence
}

const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
export const randomId = () =>
  `${proofPrefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 36 - proofPrefix.length)}`
const statusText = (reply: Reply) => reply.transport ? 'transport failure' : `HTTP ${reply.status}`

function safeMessage(value: unknown, secrets: readonly string[]): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  let safe = value.replace(/[\r\n\t]/gu, ' ')
  for (const secret of secrets) {
    if (secret.length > 0) {
      safe = safe.replaceAll(secret, '[redacted]')
    }
  }
  safe = safe.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[redacted-token]')
  safe = safe.replace(/[\w.+-]+@[\w.-]+/gu, '[redacted-email]')
  return safe.slice(0, 160)
}

async function request(
  fetcher: Fetcher,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  secrets: readonly string[],
): Promise<Reply> {
  try {
    const response = await fetcher(url, {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeoutMs),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    let parsed: Json | undefined
    try {
      parsed = object(await response.json())
    } catch { /* Empty or malformed server response. */ }
    const rawCode = parsed?.code ?? object(parsed?.error)?.code
    const rawType = parsed?.type ?? object(parsed?.error)?.status
    return {
      status: response.status,
      body: parsed,
      code: typeof rawCode === 'number' && Number.isInteger(rawCode)
          || typeof rawCode === 'string' && /^\d{1,4}$/u.test(rawCode)
        ? String(rawCode)
        : undefined,
      type: typeof rawType === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/u.test(rawType)
          && !secrets.some(secret => secret.length > 0 && rawType.includes(secret))
        ? rawType
        : undefined,
      message: safeMessage(parsed?.message ?? object(parsed?.error)?.message, secrets),
    }
  } catch {
    // Caught fetch errors can contain URLs or request details. Never emit them.
    return { status: 0, body: undefined, transport: true }
  }
}

function observation(
  name: string,
  expected: string,
  reply: Reply,
  verdict: Observation['verdict'],
  row?: Observation['row'],
): Observation {
  return {
    case: name,
    expected,
    actual: statusText(reply),
    verdict,
    ...(!reply.transport && { status: reply.status }),
    ...(reply.code && { code: reply.code }),
    ...(reply.type && { type: reply.type }),
    ...(reply.message && { message: reply.message }),
    ...(row && { row }),
  }
}

function firebaseAuthReason(reply: Reply): AuthReason | undefined {
  const message = string(object(reply.body?.error)?.message)
  const code = /^([A-Z][A-Z0-9_]{2,79})(?=\s*(?::|$))/u.exec(message ?? '')?.[1]
  const category = code && Object.prototype.hasOwnProperty.call(firebaseAuthCodes, code)
    ? firebaseAuthCodes[code]
    : undefined
  return category ? { category, code } : undefined
}

function appwriteAuthReason(rawType: unknown): AuthReason | undefined {
  const type = string(rawType)
  const category = type && Object.prototype.hasOwnProperty.call(appwriteAuthTypes, type)
    ? appwriteAuthTypes[type]
    : undefined
  return category ? { category, type } : undefined
}

function authObservation(
  name: string,
  expected: string,
  reply: Reply,
  valid: boolean,
  reason?: AuthReason,
): Observation {
  // Authentication response bodies and error text never enter evidence.
  const category = valid
    ? undefined
    : reason?.category ?? (reply.status >= 500 ? 'provider_unavailable' : 'unclassified_auth_failure')
  return {
    case: name,
    expected,
    actual: statusText(reply),
    verdict: valid ? 'PASS' : 'INCONCLUSIVE',
    ...(!reply.transport && { status: reply.status }),
    ...(category && { authCategory: category }),
    ...(!valid && reason?.code && { code: reason.code }),
    ...(!valid && reason?.type && { type: reason.type }),
  }
}

function success(name: string, reply: Reply, valid: boolean): Observation {
  return observation(
    name,
    '2xx with matching fixture',
    reply,
    reply.transport || reply.status >= 500 || reply.status === 429 ? 'INCONCLUSIVE' : valid ? 'PASS' : 'FAIL',
  )
}

function denial(name: string, reply: Reply, concealedNotFound = false): Observation {
  return observation(
    name,
    'permission denied',
    reply,
    reply.transport || reply.status >= 500 || reply.status === 429 || reply.status === 0 || reply.status === 400
      || reply.status === 401
      ? 'INCONCLUSIVE'
      : reply.status === 403 || concealedNotFound && reply.status === 404
      ? 'PASS'
      : reply.status === 404
      ? 'INCONCLUSIVE'
      : 'FAIL',
  )
}

function grant(name: string, reply: Reply, row?: Observation['row']): Observation {
  return observation(
    name,
    'grant response recorded; B read assessed separately',
    reply,
    is2xx(reply) || reply.status === 403 ? 'PASS' : 'INCONCLUSIVE',
    row,
  )
}

function is2xx(reply: Reply): boolean {
  return reply.status >= 200 && reply.status < 300
}
function validFirebase(reply: Reply, name: string, text: string, deleted: boolean): boolean {
  const fields = object(reply.body?.fields)
  return is2xx(reply) && reply.body?.name === name && object(fields?.text)?.stringValue === text
    && object(fields?._deleted)?.booleanValue === deleted
}

function firestoreDocument(uid: string, id: string): string {
  return `projects/${firebaseProject}/databases/(default)/documents/users/${encodeURIComponent(uid)}/notes/${
    encodeURIComponent(id)
  }`
}

export function firebaseWrite(name: string, text: string, deleted: boolean, exists: boolean, extra?: Json): Json {
  return {
    writes: [{
      update: {
        name,
        fields: {
          text: { stringValue: text },
          done: { booleanValue: false },
          updatedAt: { integerValue: String(Date.now()) },
          _deleted: { booleanValue: deleted },
          ...extra,
        },
      },
      currentDocument: { exists },
      updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }],
    }],
  }
}

export async function runFirebase(
  fetcher: Fetcher,
  accounts: Accounts,
  config: typeof connections.firebase = connections.firebase,
): Promise<Evidence> {
  const evidence: Evidence = {
    provider: 'firebase',
    projectId: firebaseProject,
    startedAt: new Date().toISOString(),
    observations: [],
    leftoverIds: [],
    cleanup: [],
  }
  const out = evidence.observations
  if (config.projectId !== firebaseProject || accounts.a.email === accounts.b.email) {
    out.push({
      case: 'setup',
      expected: 'fixed project and distinct accounts',
      actual: 'invalid input',
      verdict: 'INCONCLUSIVE',
    })
    return evidence
  }
  const secrets = [accounts.a.password, accounts.b.password]
  const auth = async (account: Credential, label: string) => {
    const reply = await request(
      fetcher,
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,
      'POST',
      { 'content-type': 'application/json' },
      { email: account.email, password: account.password, returnSecureToken: true },
      secrets,
    )
    const token = string(reply.body?.idToken)
    const uid = string(reply.body?.localId)
    out.push(
      authObservation(
        `auth-${label}`,
        'existing account login',
        reply,
        Boolean(is2xx(reply) && token && uid),
        firebaseAuthReason(reply),
      ),
    )
    return is2xx(reply) && token && uid ? { token, uid } : undefined
  }
  const a = await auth(accounts.a, 'A')
  const b = await auth(accounts.b, 'B')
  if (!a || !b || a.uid === b.uid) {
    if (a && b) {
      out.push({ case: 'distinct-accounts', expected: 'different UIDs', actual: 'same UID', verdict: 'INCONCLUSIVE' })
    }
    return evidence
  }
  secrets.push(a.token, b.token)
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseProject}/databases/(default)/documents`
  const call = (who: typeof a, path: string, method = 'GET', body?: Json) =>
    request(
      fetcher,
      `${base}${path}`,
      method,
      { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' },
      body,
      secrets,
    )
  const commit = (who: typeof a, write: Json) => call(who, ':commit', 'POST', write)
  const get = (who: typeof a, owner: string, id: string) =>
    call(who, `/users/${encodeURIComponent(owner)}/notes/${encodeURIComponent(id)}`)
  const create = async (who: typeof a, owner: string, id: string, text: string, extra?: Json) => {
    const name = firestoreDocument(owner, id)
    return commit(who, firebaseWrite(name, text, false, false, extra))
  }
  const finish = async (): Promise<Evidence> => {
    // Firestore rules forbid physical deletion. Tombstone only IDs created by this run.
    for (const name of evidence.leftoverIds) {
      const owner = name.includes(`/users/${encodeURIComponent(a.uid)}/notes/`)
        ? a
        : name.includes(`/users/${encodeURIComponent(b.uid)}/notes/`)
        ? b
        : undefined
      if (!owner) {
        evidence.cleanup.push({ id: name, status: 'owner unknown; left untouched' })
        continue
      }
      const result = await commit(owner, firebaseWrite(name, 'probe-cleanup', true, true))
      evidence.cleanup.push({
        id: name,
        status: is2xx(result) ? 'tombstone retained' : `tombstone failed: ${statusText(result)}`,
      })
    }
    return evidence
  }
  const aId = randomId()
  const bId = randomId()
  const aName = firestoreDocument(a.uid, aId)
  const bName = firestoreDocument(b.uid, bId)
  const aCreate = await create(a, a.uid, aId, 'probe-A')
  const bCreate = await create(b, b.uid, bId, 'probe-B')
  if (is2xx(aCreate)) {
    evidence.leftoverIds.push(aName)
  }
  if (is2xx(bCreate)) {
    evidence.leftoverIds.push(bName)
  }
  out.push(success('create-A', aCreate, is2xx(aCreate) && Array.isArray(aCreate.body?.writeResults)))
  out.push(success('create-B', bCreate, is2xx(bCreate) && Array.isArray(bCreate.body?.writeResults)))
  const aGet = await get(a, a.uid, aId)
  const bGet = await get(b, b.uid, bId)
  out.push(success('get-A', aGet, validFirebase(aGet, aName, 'probe-A', false)))
  out.push(success('get-B', bGet, validFirebase(bGet, bName, 'probe-B', false)))
  const ownList = await call(a, `/users/${encodeURIComponent(a.uid)}/notes?pageSize=1000`)
  const ownDocuments = Array.isArray(ownList.body?.documents) ? ownList.body.documents : undefined
  out.push(
    success('list-A', ownList, is2xx(ownList) && Boolean(ownDocuments?.some(row => object(row)?.name === aName))),
  )
  const updated = await commit(a, firebaseWrite(aName, 'probe-A-updated', false, true))
  const updatedGet = await get(a, a.uid, aId)
  out.push(success('update-A', updated, is2xx(updated) && validFirebase(updatedGet, aName, 'probe-A-updated', false)))
  const tombstone = await commit(b, firebaseWrite(bName, 'probe-B', true, true))
  const tombstoneGet = await get(b, b.uid, bId)
  out.push(success('tombstone-B', tombstone, is2xx(tombstone) && validFirebase(tombstoneGet, bName, 'probe-B', true)))
  if (
    out.some(x =>
      ['create-A', 'create-B', 'get-A', 'get-B', 'list-A', 'update-A', 'tombstone-B'].includes(x.case)
      && x.verdict !== 'PASS'
    )
  ) {
    out.push({
      case: 'hostile-gate',
      expected: 'positive controls pass',
      actual: 'control failed',
      verdict: 'INCONCLUSIVE',
    })
    return finish()
  }
  out.push(denial('foreign-list', await call(b, `/users/${encodeURIComponent(a.uid)}/notes?pageSize=10`)))
  out.push(denial('foreign-get', await get(b, a.uid, aId)))
  const attackNames: string[] = []
  for (const caseName of ['update', 'tombstone', 'hard-delete']) {
    const id = randomId()
    const name = firestoreDocument(a.uid, id)
    const made = await create(a, a.uid, id, `attack-${caseName}`)
    if (is2xx(made)) {
      evidence.leftoverIds.push(name)
    }
    const seen = await get(a, a.uid, id)
    out.push(
      success(
        `attack-fixture-${caseName}`,
        made,
        is2xx(made) && validFirebase(seen, name, `attack-${caseName}`, false),
      ),
    )
    attackNames.push(name)
  }
  if (out.some(x => x.case.startsWith('attack-fixture-') && x.verdict !== 'PASS')) {
    return finish()
  }
  out.push(denial('foreign-update', await commit(b, firebaseWrite(attackNames[0]!, 'hostile-update', false, true))))
  out.push(denial('foreign-tombstone', await commit(b, firebaseWrite(attackNames[1]!, 'hostile-delete', true, true))))
  out.push(
    denial(
      'foreign-hard-delete',
      await commit(b, { writes: [{ delete: attackNames[2], currentDocument: { exists: true } }] }),
    ),
  )
  const foreignId = randomId()
  const foreignCreate = await create(b, a.uid, foreignId, 'hostile-create')
  if (is2xx(foreignCreate)) {
    evidence.leftoverIds.push(firestoreDocument(a.uid, foreignId))
  }
  out.push(denial('foreign-create', foreignCreate))
  const forgedId = randomId()
  const forged = await create(a, a.uid, forgedId, 'forged-owner', { ownerId: { stringValue: b.uid } })
  if (is2xx(forged)) {
    evidence.leftoverIds.push(firestoreDocument(a.uid, forgedId))
  }
  out.push(denial('forged-ownerId', forged))
  out.push(
    denial(
      'same-owner-hard-delete',
      await commit(a, { writes: [{ delete: aName, currentDocument: { exists: true } }] }),
    ),
  )
  return finish()
}

function rowMetadata(body: Json | undefined): Observation['row'] | undefined {
  if (!body) {
    return undefined
  }
  const id = string(body.$id)
  const ownerId = string(body.ownerId)
  const permissions = Array.isArray(body.$permissions)
    ? body.$permissions.filter((x): x is string => typeof x === 'string').slice(0, 16)
    : undefined
  return id || ownerId || permissions
    ? { ...(id && { id }), ...(ownerId && { ownerId }), ...(permissions && { permissions }) }
    : undefined
}

function validRow(reply: Reply, id: string, owner: string, text: string): boolean {
  return is2xx(reply) && reply.body?.$id === id && reply.body.ownerId === owner && reply.body.text === text
}

function cookieFrom(response: Response, projectId: string): string | undefined {
  const header = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = header.getSetCookie?.() ?? [header.get('set-cookie') ?? '']
  for (const raw of values) {
    const match = raw.match(new RegExp(`(?:^|,\\s*)(a_session_${projectId}=[^;,\\s]+)`))
    if (match?.[1]) {
      return match[1]
    }
  }
  return undefined
}

export async function runAppwrite(
  fetcher: Fetcher,
  accounts: Accounts,
  config: typeof connections.appwrite = connections.appwrite,
): Promise<Evidence> {
  const evidence: Evidence = {
    provider: 'appwrite',
    projectId: appwriteProject,
    startedAt: new Date().toISOString(),
    observations: [],
    leftoverIds: [],
    cleanup: [],
  }
  const out = evidence.observations
  if (
    config.projectId !== appwriteProject || config.endpoint !== appwriteEndpoint || config.databaseId !== 'tao_notes'
    || config.tableId !== 'notes' || config.platform !== 'dev.tao.hostedcrudspike'
    || accounts.a.email === accounts.b.email
  ) {
    out.push({
      case: 'setup',
      expected: 'fixed project, endpoint and distinct accounts',
      actual: 'invalid input',
      verdict: 'INCONCLUSIVE',
    })
    return evidence
  }
  const secrets = [accounts.a.password, accounts.b.password]
  const headers = {
    'X-Appwrite-Project': appwriteProject,
    Origin: `appwrite-ios://${config.platform}`,
    'content-type': 'application/json',
  }
  const sessionCookies: string[] = []
  const login = async (account: Credential, label: string) => {
    // The client login response is a Session object, not a bearer token. Use only its Set-Cookie.
    let response: Response
    try {
      response = await fetcher(`${appwriteEndpoint}/account/sessions/email`, {
        method: 'POST',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify({ email: account.email, password: account.password }),
      })
    } catch {
      out.push({
        case: `auth-${label}`,
        expected: 'existing account login',
        actual: 'transport failure',
        verdict: 'INCONCLUSIVE',
      })
      return undefined
    }
    const cookie = cookieFrom(response, appwriteProject)
    // Failed login bodies yield only an allowlisted error type; no body is retained or printed.
    if (!is2xx({ status: response.status, body: undefined }) || !cookie) {
      let reason: AuthReason | undefined
      if (response.status >= 400) {
        try {
          reason = appwriteAuthReason(object(await response.json())?.type)
        } catch { /* Ignore untrusted auth body. */ }
      }
      out.push(
        authObservation(
          `auth-${label}`,
          '2xx and session cookie',
          { status: response.status, body: undefined },
          false,
          reason
            ?? (is2xx({ status: response.status, body: undefined }) ? { category: 'session_unavailable' } : undefined),
        ),
      )
      return undefined
    }
    secrets.push(cookie)
    secrets.push(cookie.slice(cookie.indexOf('=') + 1))
    sessionCookies.push(cookie)
    const identity = await request(
      fetcher,
      `${appwriteEndpoint}/account`,
      'GET',
      { ...headers, Cookie: cookie },
      undefined,
      secrets,
    )
    const uid = string(identity.body?.$id)
    out.push(
      authObservation(
        `auth-${label}`,
        'session resolves to an account',
        identity,
        Boolean(is2xx(identity) && uid),
        appwriteAuthReason(identity.body?.type)
          ?? (identity.status === 401 ? { category: 'session_unavailable' } : undefined),
      ),
    )
    return is2xx(identity) && uid ? { uid, cookie } : undefined
  }
  const a = await login(accounts.a, 'A')
  const b = await login(accounts.b, 'B')
  const endSessions = async () => {
    for (const [index, cookie] of sessionCookies.entries()) {
      const ended = await request(
        fetcher,
        `${appwriteEndpoint}/account/sessions/current`,
        'DELETE',
        { ...headers, Cookie: cookie },
        undefined,
        secrets,
      )
      out.push(
        observation(
          `session-delete-${index === 0 ? 'A' : 'B'}`,
          'session removed',
          ended,
          is2xx(ended) ? 'PASS' : 'INCONCLUSIVE',
        ),
      )
    }
  }
  if (!a || !b || a.uid === b.uid) {
    if (a && b) {
      out.push({ case: 'distinct-accounts', expected: 'different UIDs', actual: 'same UID', verdict: 'INCONCLUSIVE' })
    }
    await endSessions()
    return evidence
  }
  const root = `${appwriteEndpoint}/tablesdb/${encodeURIComponent(config.databaseId)}/tables/${
    encodeURIComponent(config.tableId)
  }/rows`
  const call = (who: typeof a, path: string, method = 'GET', body?: Json) =>
    request(fetcher, `${root}${path}`, method, { ...headers, Cookie: who.cookie }, body, secrets)
  const create = (who: typeof a, id: string, owner: string, text: string, permissions?: string[]) =>
    call(who, '', 'POST', {
      rowId: id,
      data: { ownerId: owner, text, done: false, updatedAt: Date.now() },
      ...(permissions && { permissions }),
    })
  const get = (who: typeof a, id: string) => call(who, `/${encodeURIComponent(id)}`)
  const update = (who: typeof a, id: string, data: Json, permissions?: string[]) =>
    call(who, `/${encodeURIComponent(id)}`, 'PATCH', { data, ...(permissions && { permissions }) })
  const remove = (who: typeof a, id: string) => call(who, `/${encodeURIComponent(id)}`, 'DELETE')
  try {
    const aId = randomId()
    const bId = randomId()
    const ac = await create(a, aId, a.uid, 'probe-A')
    const bc = await create(b, bId, b.uid, 'probe-B')
    if (is2xx(ac)) {
      evidence.leftoverIds.push(aId)
    }
    if (is2xx(bc)) {
      evidence.leftoverIds.push(bId)
    }
    out.push(success('create-A', ac, validRow(ac, aId, a.uid, 'probe-A')))
    out.push(success('create-B', bc, validRow(bc, bId, b.uid, 'probe-B')))
    const ag = await get(a, aId)
    const bg = await get(b, bId)
    out.push(success('get-A', ag, validRow(ag, aId, a.uid, 'probe-A')))
    out.push(success('get-B', bg, validRow(bg, bId, b.uid, 'probe-B')))
    const au = await update(a, aId, { text: 'probe-A-updated' })
    out.push(success('update-A', au, validRow(au, aId, a.uid, 'probe-A-updated')))
    const bd = await remove(b, bId)
    const bAfterDelete = await get(b, bId)
    out.push(success('delete-B', bd, is2xx(bd) && bAfterDelete.status === 404))
    out.push(
      observation(
        'delete-B-readback',
        'row absent after delete',
        bAfterDelete,
        bAfterDelete.status === 404
          ? 'PASS'
          : bAfterDelete.transport || bAfterDelete.status >= 500 || bAfterDelete.status === 401
          ? 'INCONCLUSIVE'
          : 'FAIL',
      ),
    )
    if (is2xx(bd)) {
      evidence.leftoverIds = evidence.leftoverIds.filter(id => id !== bId)
    }
    if (
      out.some(x =>
        ['create-A', 'create-B', 'get-A', 'get-B', 'update-A', 'delete-B', 'delete-B-readback'].includes(x.case)
        && x.verdict !== 'PASS'
      )
    ) {
      out.push({
        case: 'hostile-gate',
        expected: 'positive controls pass',
        actual: 'control failed',
        verdict: 'INCONCLUSIVE',
      })
      return evidence
    }
    const byId = (who: typeof a, id: string) => {
      const query = JSON.stringify({ method: 'equal', attribute: '$id', values: [id] })
      return call(who, `?${new URLSearchParams({ 'queries[0]': query })}`)
    }
    const ownList = await byId(a, aId)
    const ownRows = Array.isArray(ownList.body?.rows) ? ownList.body.rows : undefined
    out.push(
      success(
        'list-by-id-A',
        ownList,
        is2xx(ownList) && typeof ownList.body?.total === 'number' && ownList.body.total >= 1
          && Boolean(ownRows?.some(row => object(row)?.$id === aId)),
      ),
    )
    if (out[out.length - 1]?.verdict !== 'PASS') {
      return evidence
    }
    const list = await byId(b, aId)
    const rows = Array.isArray(list.body?.rows) ? list.body.rows : undefined
    const total = list.body?.total
    out.push(
      observation(
        'foreign-list-by-id',
        'A row absent from B list by known ID',
        list,
        !is2xx(list) || !rows || typeof total !== 'number' || !Number.isInteger(total) || total < 0
          ? 'INCONCLUSIVE'
          : rows.length > 0 || total > 0
          ? 'FAIL'
          : 'PASS',
      ),
    )
    out.push(denial('foreign-direct-get', await get(b, aId), true))
    const attackRows = [randomId(), randomId()]
    for (const id of attackRows) {
      const made = await create(a, id, a.uid, 'attack-fixture')
      if (is2xx(made)) {
        evidence.leftoverIds.push(id)
      }
      out.push(success(`attack-fixture-${attackRows.indexOf(id)}`, made, validRow(made, id, a.uid, 'attack-fixture')))
    }
    if (out.some(x => x.case.startsWith('attack-fixture-') && x.verdict !== 'PASS')) {
      return evidence
    }
    out.push(denial('foreign-update', await update(b, attackRows[0]!, { text: 'hostile-update' }), true))
    out.push(denial('foreign-delete', await remove(b, attackRows[1]!), true))
    const forgedId = randomId()
    const forged = await create(b, forgedId, a.uid, 'forged-owner')
    if (is2xx(forged)) {
      evidence.leftoverIds.push(forgedId)
    }
    out.push(denial('forged-ownerId-create', forged, true))
    const transferId = randomId()
    const transferBase = await create(b, transferId, b.uid, 'transfer-base')
    if (is2xx(transferBase)) {
      evidence.leftoverIds.push(transferId)
    }
    out.push(success('transfer-base', transferBase, validRow(transferBase, transferId, b.uid, 'transfer-base')))
    if (validRow(transferBase, transferId, b.uid, 'transfer-base')) {
      out.push(denial('forged-ownerId-transfer', await update(b, transferId, { ownerId: a.uid }), true))
    }
    for (const target of ['any', `user:${b.uid}`]) {
      const permission = `read("${target}")`
      const own = [`read("user:${a.uid}")`, `update("user:${a.uid}")`, `delete("user:${a.uid}")`]
      const createId = randomId()
      const widened = await create(a, createId, a.uid, `widen-create-${target}`, [...own, permission])
      if (is2xx(widened)) {
        evidence.leftoverIds.push(createId)
      }
      const bRead = is2xx(widened) ? await get(b, createId) : undefined
      if (bRead) {
        out.push(
          observation(
            `permission-create-${target}-B-read`,
            'B cannot read the granted A row',
            bRead,
            validRow(bRead, createId, a.uid, `widen-create-${target}`)
              ? 'FINDING'
              : bRead.transport || bRead.status >= 500 || bRead.status === 429 || bRead.status === 401
              ? 'INCONCLUSIVE'
              : bRead.status === 403 || bRead.status === 404
              ? 'PASS'
              : 'FAIL',
            rowMetadata(bRead.body),
          ),
        )
      }
      out.push(grant(`permission-create-${target}-grant`, widened, rowMetadata(widened.body)))
      const updateId = randomId()
      const base = await create(a, updateId, a.uid, `widen-update-${target}`)
      if (is2xx(base)) {
        evidence.leftoverIds.push(updateId)
      }
      out.push(success(`permission-base-${target}`, base, validRow(base, updateId, a.uid, `widen-update-${target}`)))
      if (!validRow(base, updateId, a.uid, `widen-update-${target}`)) {
        continue
      }
      const changed = await update(a, updateId, { updatedAt: Date.now() }, [...own, permission])
      const after = is2xx(changed) ? await get(b, updateId) : undefined
      if (after) {
        out.push(
          observation(
            `permission-update-${target}-B-read`,
            'B cannot read the granted A row',
            after,
            validRow(after, updateId, a.uid, `widen-update-${target}`)
              ? 'FINDING'
              : after.transport || after.status >= 500 || after.status === 429 || after.status === 401
              ? 'INCONCLUSIVE'
              : after.status === 403 || after.status === 404
              ? 'PASS'
              : 'FAIL',
            rowMetadata(after.body),
          ),
        )
      }
      out.push(grant(`permission-update-${target}-grant`, changed, rowMetadata(changed.body)))
    }
    return evidence
  } finally {
    // Only this invocation's randomized rows are eligible for cleanup. Failed deletions remain in evidence.
    for (const id of [...evidence.leftoverIds]) {
      const clean = await remove(a, id)
      const cleanB = is2xx(clean) ? undefined : await remove(b, id)
      const removed = is2xx(clean) || Boolean(cleanB && is2xx(cleanB))
      evidence.cleanup.push({
        id,
        status: removed ? 'deleted' : `leftover: A ${statusText(clean)}${cleanB ? `, B ${statusText(cleanB)}` : ''}`,
      })
      if (removed) {
        evidence.leftoverIds = evidence.leftoverIds.filter(value => value !== id)
      }
    }
    await endSessions()
  }
}

/** Save before the first request and after each provider; retain earlier evidence on interruption. */
export async function runProviderSequence(
  report: ProbeReport,
  providers: { firebase: () => Promise<Evidence>; appwrite: () => Promise<Evidence> },
  save: (report: ProbeReport) => Promise<void>,
): Promise<ProbeReport> {
  await save(report)
  try {
    report.firebase = await providers.firebase()
    report.state = 'firebase-complete'
    report.checkpointAt = new Date().toISOString()
    await save(report)
    report.appwrite = await providers.appwrite()
    report.state = 'complete'
    report.checkpointAt = new Date().toISOString()
    await save(report)
  } catch {
    report.interruptedProvider = report.firebase ? 'appwrite' : 'firebase'
    report.state = 'interrupted'
    report.checkpointAt = new Date().toISOString()
    await save(report)
  }
  return report
}

function printCleanup(report: ProbeReport): void {
  for (const provider of [report.firebase, report.appwrite]) {
    if (!provider) {
      continue
    }
    const statuses = [...new Set(provider.cleanup.map(item => item.status))]
    console.log(`${provider.provider} fixture cleanup: ${statuses.join(', ') || 'none recorded'}`)
    if (provider.leftoverIds.length > 0) {
      console.log(`${provider.provider} retained fixture IDs: ${provider.leftoverIds.join(', ')}`)
    }
  }
}

export function authSummaryLines(report: ProbeReport): string[] {
  const lines: string[] = []
  for (const provider of [report.firebase, report.appwrite]) {
    if (!provider) {
      continue
    }
    for (const item of provider.observations) {
      if (!item.case.startsWith('auth-') || item.verdict === 'PASS') {
        continue
      }
      const category = item.authCategory?.replaceAll('_', ' ') ?? 'unclassified auth failure'
      const safeCode = item.code ?? item.type
      lines.push(`${provider.provider} ${item.case}: ${item.actual}; ${category}${safeCode ? ` (${safeCode})` : ''}`)
    }
  }
  if (lines.length > 0) {
    lines.push('Use two existing accounts for each provider. Firebase and Appwrite accounts are separate.')
  }
  return lines
}

function printAuthSummary(report: ProbeReport): void {
  for (const line of authSummaryLines(report)) {
    console.log(line)
  }
}

export async function main(args: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Tests: bun test --cwd "Apps/Hosted CRUD" src\nRun probe: bun run "Apps/Hosted CRUD/scripts/hostile-probe.ts"\nPrompts for existing A/B accounts for each provider. Makes only randomized fixture rows in the fixed projects; Firebase tombstones remain for manual cleanup.',
    )
    return 0
  }
  if (args.length !== 0) {
    console.error('Use --help for usage.')
    return 2
  }
  if (
    connections.firebase.projectId !== firebaseProject || connections.appwrite.projectId !== appwriteProject
    || connections.appwrite.endpoint !== appwriteEndpoint || connections.appwrite.databaseId !== 'tao_notes'
    || connections.appwrite.tableId !== 'notes' || connections.appwrite.platform !== 'dev.tao.hostedcrudspike'
  ) {
    console.error('Public connection allowlist mismatch.')
    return 2
  }
  const prompt = async (provider: string): Promise<Accounts> => {
    const aEmail = await HCI.askText({ message: `${provider} account A email` })
    const aPassword = (await HCI.askSecret({ message: `${provider} account A password` })).value
    const bEmail = await HCI.askText({ message: `${provider} account B email` })
    const bPassword = (await HCI.askSecret({ message: `${provider} account B password` })).value
    return { a: { email: aEmail.trim(), password: aPassword }, b: { email: bEmail.trim(), password: bPassword } }
  }
  let path: string | undefined
  let saved = false
  let report: ProbeReport | undefined
  try {
    // Collect both providers' credentials before any remote request. Cancellation creates no fixtures.
    const firebaseAccounts = await prompt('Firebase')
    const appwriteAccounts = await prompt('Appwrite')
    const scriptPath = FS.fileUrlToPath(import.meta.url)
    const testPath = FS.fileUrlToPath(new URL('../src/acceptance/hostile-probe.test.ts', import.meta.url).href)
    const head = await CLI.run('git', { args: ['rev-parse', 'HEAD'] })
    const dirty = await CLI.run('git', {
      args: [
        'status',
        '--porcelain',
        '--',
        'Apps/Hosted CRUD/scripts/hostile-probe.ts',
        'Apps/Hosted CRUD/src/acceptance/hostile-probe.test.ts',
      ],
    })
    const now = new Date().toISOString()
    report = {
      schema: 1,
      startedAt: now,
      checkpointAt: now,
      state: 'prepared',
      source: {
        head: head.exitCode === 0 ? head.stdout.trim() : 'unavailable',
        dirty: dirty.exitCode === 0 ? dirty.stdout.trim() !== '' : 'unknown',
        scriptSha256: Platform.sha256Hex(await FS.readText(scriptPath)),
        testSha256: Platform.sha256Hex(await FS.readText(testPath)),
      },
      projects: { firebase: firebaseProject, appwrite: appwriteProject },
    }
    path = `.artifacts/hosted-provider/hostile-probe-${crypto.randomUUID()}.json`
    await runProviderSequence(report, {
      firebase: () => runFirebase(fetch, firebaseAccounts),
      appwrite: () => runAppwrite(fetch, appwriteAccounts),
    }, async current => {
      await FS.writeJson(path!, current, { mode: 0o600 })
      saved = true
    })
    console.log(`Redacted evidence: ${path}`)
    console.log(`Probe state: ${report.state}`)
    printAuthSummary(report)
    printCleanup(report)
    return report.state === 'complete'
        && [report.firebase, report.appwrite].every(provider =>
          provider && provider.observations.every(item => item.verdict === 'PASS')
        )
      ? 0
      : 1
  } catch {
    if (saved && path) {
      console.log(`Last saved evidence: ${path}`)
    }
    if (report) {
      printAuthSummary(report)
      printCleanup(report)
    }
    console.error(
      saved
        ? 'Probe interrupted. Check the last saved evidence and fixture cleanup status.'
        : 'Probe stopped before provider requests or the first evidence write; no provider data was changed.',
    )
    return 1
  }
}

if (import.meta.main) {
  process.exitCode = await main()
}
