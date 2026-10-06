/** Opt-in, credential-local Firestore rules probe for the authored Firebase Notes app. */
import { ASTUtils } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Errors, FS, HCI, Platform } from '@shared'
import { readHostedProviderInputs } from './hosted-provider-inputs'

type Json = Record<string, unknown>
type Fetcher = typeof fetch
type Credential = { email: string; password: string }
export type Credentials = { a: Credential; b: Credential }
export type ProbePlan = { projectId: string; apiKey: string; storageKey: string; schemaSha256: string }
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'FINDING'
type Observation = {
  case: string
  verdict: Verdict
  status: number
  errorStatus?: string
  errorCode?: string
  errorReason?: string
}
export type ProbeEvidence = {
  startedAt: string
  state: 'prepared' | 'running' | 'complete' | 'interrupted'
  projectId: string
  storageKey: string
  fixtureIds: string[]
  attempts: { id: string; case: string; owner: 'A' | 'B' }[]
  observations: Observation[]
  cleanup: { id: string; status: string }[]
}
type Reply = {
  status: number
  body?: Json
  /** A recognized provider status used for verdicts; never copied to evidence without redaction. */
  providerStatus?: string
  errorStatus?: string
  errorCode?: string
  errorReason?: string
  transport?: true
}
type Identity = { uid: string; token: string }
const appName = 'FirebaseNotes'
const timeoutMs = 30_000
const providerStatuses = new Set(['PERMISSION_DENIED', 'NOT_FOUND', 'INVALID_ARGUMENT', 'UNAUTHENTICATED'])
const providerReasons = new Set(['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'USER_DISABLED'])
const safeProviderCode = (candidate: unknown, allowed: Set<string>, protectedValues: readonly string[]) =>
  typeof candidate === 'string' && allowed.has(candidate)
    && !protectedValues.some(secret => {
      const normalized = secret.toUpperCase()
      return normalized && (normalized.includes(candidate) || candidate.includes(normalized))
    })
    ? candidate
    : undefined
const documentId = () => `tao-hostile-${crypto.randomUUID()}`
const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined
const value = (field: unknown): unknown => {
  const typed = object(field)
  return typed?.['stringValue'] ?? typed?.['booleanValue'] ?? typed?.['integerValue'] ?? typed?.['doubleValue']
}
const success = (reply: Reply) => !reply.transport && reply.status >= 200 && reply.status < 300

/** Resolve the store and schema through Tao's validated app binding, not source-text matching. */
export async function compiledProbeShape(appPath: string): Promise<{ storageKey: string; schemaSha256: string }> {
  const { definition } = await readHostedProviderInputs(appPath, appName, 'firebase')
  const item = definition.entities['Item']
  if (
    !definition.entities['Account'] || !item
    || JSON.stringify(Object.keys(item.fields).sort()) !== JSON.stringify(['CreatedAt', 'Done', 'Notes', 'Title'])
    || item.fields['Title']?.kind !== 'text' || item.fields['Notes']?.kind !== 'text'
    || item.fields['Done']?.kind !== 'boolean' || item.fields['CreatedAt']?.kind !== 'time'
  ) {
    Errors.throwUserInput('Compiled Firebase Notes schema changed; review the probe before running it.')
  }
  const workspace = await Workspace.open(FS.dirname(appPath))
  const parsed = await workspace.parse(appPath)
  const app = AST.appValueDeclarationsInFile(parsed.entry.ast).find(candidate => candidate.name === appName)
  if (!app) {
    Errors.throwUserInput('Compiled Firebase Notes app was not found.')
  }
  const keys = ASTUtils.appBoundDatasources(app).flatMap(binding => {
    const source = binding.value ?? binding.declaration?.value
    if (!source || AST.isAppView(source)) {
      return []
    }
    const resolved = ASTUtils.resolveDatasourceValue(source, binding.patches)
    return resolved.typeNames.includes('Firebase') ? [resolved.configuration.get('StorageKey')] : []
  })
  if (keys.length !== 1 || !keys[0] || keys[0].includes('/')) {
    Errors.throwUserInput('Firebase Notes must have one compiled Firebase StorageKey path segment.')
  }
  return { storageKey: keys[0], schemaSha256: Platform.sha256Hex(JSON.stringify(definition)) }
}

export function publicProbePlan(connection: unknown, shape: { storageKey: string; schemaSha256: string }): ProbePlan {
  const firebase = object(object(connection)?.['firebase'])
  const projectId = firebase?.['projectId']
  const apiKey = firebase?.['apiKey']
  if (
    typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)
    || typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{8,}$/u.test(apiKey)
    || !shape.storageKey || shape.storageKey.includes('/')
    || ['endpoint', 'baseUrl', 'authEndpoint', 'firestoreEndpoint'].some(key => firebase?.[key] !== undefined)
  ) {
    Errors.throwUserInput('The local public Firebase connection or compiled store key is incomplete.')
  }
  return { projectId, apiKey, ...shape }
}

async function request(
  fetcher: Fetcher,
  url: string,
  method: string,
  token?: string,
  body?: Json,
  protectedValues: readonly string[] = [],
): Promise<Reply> {
  try {
    const response = await fetcher(
      url,
      {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      } as Parameters<Fetcher>[1],
    )
    if (response.redirected || response.url && response.url !== url) {
      return { status: 0, transport: true }
    }
    let parsed: Json | undefined
    try {
      parsed = object(await response.json())
    } catch { /* A malformed response is not authorization proof. */ }
    const error = object(parsed?.['error'])
    const responseToken = typeof parsed?.['idToken'] === 'string' ? parsed['idToken'] : undefined
    const secrets = [
      ...protectedValues,
      ...(token ? [token] : []),
      ...(responseToken ? [responseToken] : []),
    ]
    const providerStatus = typeof error?.['status'] === 'string' && providerStatuses.has(error['status'])
      ? error['status']
      : undefined
    const errorStatus = safeProviderCode(providerStatus, providerStatuses, secrets)
    const errorCode = error?.['code']
    const reason = typeof error?.['message'] === 'string'
      ? /^([A-Z][A-Z0-9_]{2,79})(?::|$)/u.exec(error['message'])?.[1]
      : undefined
    const errorReason = safeProviderCode(reason, providerReasons, secrets)
    return {
      status: response.status,
      body: parsed,
      ...(providerStatus ? { providerStatus } : {}),
      ...(errorStatus ? { errorStatus } : {}),
      ...(typeof errorCode === 'number' && errorCode === response.status ? { errorCode: String(errorCode) } : {}),
      ...(errorReason ? { errorReason } : {}),
    }
  } catch {
    // Fetch failures may contain URLs, tokens, or credentials. Never retain their text.
    return { status: 0, transport: true }
  }
}

export function denied(reply: Reply): Verdict {
  if (success(reply)) {
    return 'FINDING'
  }
  return reply.status === 403 && (reply.providerStatus ?? reply.errorStatus) === 'PERMISSION_DENIED'
    ? 'PASS'
    : 'INCONCLUSIVE'
}

function observed(name: string, reply: Reply, verdict: Verdict): Observation {
  return {
    case: name,
    verdict,
    status: reply.status,
    ...(reply.errorStatus ? { errorStatus: reply.errorStatus } : {}),
    ...(reply.errorCode ? { errorCode: reply.errorCode } : {}),
    ...(reply.errorReason ? { errorReason: reply.errorReason } : {}),
  }
}

function fields(title: string, deleted: boolean, extra: Json = {}): Json {
  return {
    Title: { stringValue: title },
    Notes: { stringValue: 'randomized authorization fixture' },
    Done: { booleanValue: false },
    CreatedAt: { integerValue: String(Date.now()) },
    _deleted: { booleanValue: deleted },
    ...extra,
  }
}

function write(name: string, title: string, deleted: boolean, exists: boolean, extra?: Json, transform = true): Json {
  return {
    writes: [{
      update: { name, fields: fields(title, deleted, extra) },
      currentDocument: { exists },
      ...(transform ? { updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }] } : {}),
    }],
  }
}

function matches(reply: Reply, name: string, title: string, deleted: boolean): boolean {
  const row = object(reply.body?.['fields'])
  return success(reply) && reply.body?.['name'] === name && value(row?.['Title']) === title
    && value(row?.['_deleted']) === deleted && typeof value(row?.['CreatedAt']) === 'string'
}

/** The save callback persists redacted progress before requests and after each result. */
export async function runFirebaseProbe(
  fetcher: Fetcher,
  credentials: Credentials,
  plan: ProbePlan,
  save: (evidence: ProbeEvidence) => Promise<void>,
): Promise<ProbeEvidence> {
  const protectedValues = [
    credentials.a.email,
    credentials.a.password,
    credentials.b.email,
    credentials.b.password,
    plan.apiKey,
  ]
  const evidence: ProbeEvidence = {
    startedAt: new Date().toISOString(),
    state: 'prepared',
    projectId: plan.projectId,
    storageKey: plan.storageKey,
    fixtureIds: [documentId(), documentId(), documentId(), documentId(), documentId(), documentId(), documentId()],
    attempts: [],
    observations: [],
    cleanup: [],
  }
  const [aId, bId, foreignId, ownerId, metadataId, schemaId, deletionId] = evidence.fixtureIds as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  await save(evidence)
  const record = async (name: string, reply: Reply, verdict: Verdict) => {
    evidence.observations.push(observed(name, reply, verdict))
    await save(evidence)
  }
  const auth = async (account: Credential, label: string): Promise<Identity | undefined> => {
    const reply = await request(
      fetcher,
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(plan.apiKey)}`,
      'POST',
      undefined,
      { email: account.email, password: account.password, returnSecureToken: true },
      protectedValues,
    )
    const uid = reply.body?.['localId']
    const token = reply.body?.['idToken']
    const valid = success(reply) && typeof uid === 'string' && uid !== '' && !uid.includes('/')
      && typeof token === 'string' && token.length > 0
    if (valid) {
      protectedValues.push(token as string)
    }
    await record(`auth-${label}`, reply, valid ? 'PASS' : 'INCONCLUSIVE')
    return valid ? { uid: uid as string, token: token as string } : undefined
  }
  let a: Identity | undefined
  let b: Identity | undefined
  const cleanupCandidates: { id: string; name: string; owner: Identity }[] = []
  try {
    if (credentials.a.email.trim().toLowerCase() === credentials.b.email.trim().toLowerCase()) {
      Errors.throwUserInput('Use two distinct existing Firebase accounts.')
    }
    evidence.state = 'running'
    await save(evidence)
    a = await auth(credentials.a, 'A')
    b = await auth(credentials.b, 'B')
    if (!a || !b || a.uid === b.uid) {
      evidence.observations.push({ case: 'distinct-uid', verdict: 'INCONCLUSIVE', status: 0 })
      return evidence
    }
    evidence.observations.push({ case: 'distinct-uid', verdict: 'PASS', status: 0 })
    await save(evidence)
    const base = `https://firestore.googleapis.com/v1/projects/${plan.projectId}/databases/(default)/documents`
    const entity = (owner: string) =>
      `/users/${encodeURIComponent(owner)}/stores/s_${encodeURIComponent(plan.storageKey)}/Item`
    const name = (owner: string, id: string) =>
      `projects/${plan.projectId}/databases/(default)/documents${entity(owner)}/${encodeURIComponent(id)}`
    const call = (who: Identity, path: string, method = 'GET', body?: Json) =>
      request(fetcher, `${base}${path}`, method, who.token, body, protectedValues)
    const commit = (who: Identity, body: Json) => call(who, ':commit', 'POST', body)
    const attemptCreate = async (
      actor: Identity,
      owner: Identity,
      ownerLabel: 'A' | 'B',
      id: string,
      path: string,
      label: string,
      body: Json,
    ) => {
      // Persist the attempted random ID before the request: the server may commit and lose its response.
      evidence.attempts.push({ id, case: label, owner: ownerLabel })
      await save(evidence)
      const candidate = { id, name: path, owner }
      cleanupCandidates.push(candidate)
      const reply = await commit(actor, body)
      // A structured rules denial is definitive; all other failures remain cleanup candidates.
      if (reply.status === 403 && reply.providerStatus === 'PERMISSION_DENIED') {
        cleanupCandidates.splice(cleanupCandidates.indexOf(candidate), 1)
      }
      return reply
    }
    const get = (who: Identity, owner: string, id: string) => call(who, `${entity(owner)}/${encodeURIComponent(id)}`)
    const list = (who: Identity, owner: string) => call(who, `${entity(owner)}?pageSize=100`)
    const ownA = name(a.uid, aId)
    const ownB = name(b.uid, bId)
    for (const [label, who, id, path] of [['A', a, aId, ownA], ['B', b, bId, ownB]] as const) {
      const reply = await attemptCreate(
        who,
        who,
        label,
        id,
        path,
        `own-create-${label}`,
        write(path, `fixture-${label}`, false, false),
      )
      await record(
        `own-create-${label}`,
        reply,
        success(reply) && Array.isArray(reply.body?.['writeResults']) ? 'PASS' : 'INCONCLUSIVE',
      )
      const read = await get(who, who.uid, id)
      await record(`own-get-${label}`, read, matches(read, path, `fixture-${label}`, false) ? 'PASS' : 'INCONCLUSIVE')
      const listed = await list(who, who.uid)
      const rows = Array.isArray(listed.body?.['documents']) ? listed.body['documents'] : []
      await record(
        `own-list-${label}`,
        listed,
        success(listed) && rows.some(row => object(row)?.['name'] === path) ? 'PASS' : 'INCONCLUSIVE',
      )
    }
    const updated = await commit(a, write(ownA, 'fixture-A-updated', false, true))
    const updatedRead = await get(a, a.uid, aId)
    await record('own-update-A', updated, success(updated) ? 'PASS' : 'INCONCLUSIVE')
    await record(
      'own-update-read-A',
      updatedRead,
      matches(updatedRead, ownA, 'fixture-A-updated', false) ? 'PASS' : 'INCONCLUSIVE',
    )
    const tombstoned = await commit(b, write(ownB, 'fixture-B', true, true))
    const tombstoneRead = await get(b, b.uid, bId)
    await record('own-tombstone-B', tombstoned, success(tombstoned) ? 'PASS' : 'INCONCLUSIVE')
    await record(
      'own-tombstone-read-B',
      tombstoneRead,
      matches(tombstoneRead, ownB, 'fixture-B', true) ? 'PASS' : 'INCONCLUSIVE',
    )
    if (evidence.observations.some(item => item.case.startsWith('own-') && item.verdict !== 'PASS')) {
      evidence.observations.push({ case: 'hostile-gate', verdict: 'INCONCLUSIVE', status: 0 })
      return evidence
    }
    const foreignGet = await get(b, a.uid, aId)
    await record('foreign-get', foreignGet, denied(foreignGet))
    const foreignList = await list(b, a.uid)
    await record('foreign-list', foreignList, denied(foreignList))
    const foreignPath = name(a.uid, foreignId)
    const foreignCreate = await attemptCreate(
      b,
      a,
      'A',
      foreignId,
      foreignPath,
      'foreign-create',
      write(foreignPath, 'foreign-create', false, false),
    )
    await record('foreign-create', foreignCreate, denied(foreignCreate))
    for (
      const [label, body] of [
        ['foreign-update', write(ownA, 'foreign-update', false, true)],
        ['foreign-tombstone', write(ownA, 'foreign-tombstone', true, true)],
        ['foreign-hard-delete', { writes: [{ delete: ownA, currentDocument: { exists: true } }] }],
      ] as const
    ) {
      const reply = await commit(b, body)
      await record(label, reply, denied(reply))
    }
    for (
      const [label, id, extra, transform] of [
        ['forged-owner', ownerId, { Owner: { stringValue: b.uid } }, true],
        ['forged-metadata', metadataId, { serverTimestamp: { timestampValue: '2000-01-01T00:00:00Z' } }, false],
        ['invalid-schema', schemaId, { Done: { stringValue: 'not-a-boolean' } }, true],
        ['forged-deletion', deletionId, { _deleted: { booleanValue: true } }, true],
      ] as const
    ) {
      const path = name(a.uid, id)
      const reply = await attemptCreate(a, a, 'A', id, path, label, write(path, label, false, false, extra, transform))
      await record(label, reply, denied(reply))
    }
    const after = await get(a, a.uid, aId)
    await record('owner-row-unchanged', after, matches(after, ownA, 'fixture-A-updated', false) ? 'PASS' : 'FINDING')
    return evidence
  } catch {
    evidence.state = 'interrupted'
    await save(evidence)
    return evidence
  } finally {
    if (a && b) {
      const base = `https://firestore.googleapis.com/v1/projects/${plan.projectId}/databases/(default)/documents:commit`
      for (const fixture of cleanupCandidates) {
        const result = await request(
          fetcher,
          base,
          'POST',
          fixture.owner.token,
          write(fixture.name, 'probe-cleanup', true, true),
          protectedValues,
        )
        evidence.cleanup.push({
          id: fixture.id,
          status: success(result) ? 'tombstone retained' : `not cleaned: HTTP ${result.status}`,
        })
        await save(evidence)
      }
    }
    if (evidence.state !== 'interrupted') {
      evidence.state = 'complete'
    }
    await save(evidence)
  }
}

export function probeSourceProvenance(
  entrypointSource: string,
  implementationSource: string,
  appSource: string,
  schemaSha256: string,
) {
  return {
    scriptSha256: Platform.sha256Hex(entrypointSource),
    implementationSha256: Platform.sha256Hex(implementationSource),
    appSha256: Platform.sha256Hex(appSource),
    schemaSha256,
  }
}

export async function main(scriptUrl: string, args: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    HCI.writeLine('From the Tao repository: bun run "Apps/Hosted Firebase/scripts/hostile-probe.ts"')
    HCI.writeLine(
      'Prompts for two existing accounts. Only randomized Item fixtures are written; cleanup tombstones remain.',
    )
    return 0
  }
  if (args.length !== 0) {
    HCI.writeErrorLine('This probe accepts no credentials, endpoints, or project IDs as arguments. Use --help.')
    return 2
  }
  const root = FS.fileUrlToPath(new URL('..', scriptUrl).href)
  const appPath = FS.resolvePath('App.tao', root)
  const scriptPath = FS.fileUrlToPath(scriptUrl)
  let evidencePath: string | undefined
  try {
    const shape = await compiledProbeShape(appPath)
    const publicConnection = await FS.readJson(FS.resolvePath('.tao/local/connections.json', root))
    const plan = publicProbePlan(publicConnection, shape)
    HCI.writeLine(`Firebase target: ${plan.projectId}; store: ${plan.storageKey}; entity: Item.`)
    const confirm = await HCI.askText({ message: 'Type the exact Firebase project ID to continue' })
    if (confirm.trim() !== plan.projectId) {
      HCI.writeErrorLine('Project ID did not match; no request was sent.')
      return 2
    }
    const credentials: Credentials = {
      a: {
        email: (await HCI.askText({ message: 'Existing account A email' })).trim(),
        password: (await HCI.askSecret({ message: 'Existing account A password' })).value,
      },
      b: {
        email: (await HCI.askText({ message: 'Existing account B email' })).trim(),
        password: (await HCI.askSecret({ message: 'Existing account B password' })).value,
      },
    }
    const source = probeSourceProvenance(
      await FS.readText(scriptPath),
      await FS.readText(FS.fileUrlToPath(import.meta.url)),
      await FS.readText(appPath),
      plan.schemaSha256,
    )
    evidencePath = FS.resolvePath(`.artifacts/hostile-probe-${crypto.randomUUID()}.json`, root)
    const save = async (evidence: ProbeEvidence) =>
      FS.writeJson(evidencePath!, { schema: 1, source, ...evidence }, { mode: 0o600 })
    const evidence = await runFirebaseProbe(fetch, credentials, plan, save)
    HCI.writeLine(`Redacted evidence: ${evidencePath}`)
    HCI.writeLine(
      `Probe state: ${evidence.state}; findings: ${
        evidence.observations.filter(x => x.verdict === 'FINDING').length
      }; inconclusive: ${evidence.observations.filter(x => x.verdict === 'INCONCLUSIVE').length}.`,
    )
    HCI.writeLine(`Cleanup: ${evidence.cleanup.map(x => x.status).join(', ') || 'no fixtures created'}.`)
    return evidence.state === 'complete' && evidence.observations.every(x => x.verdict === 'PASS')
        && evidence.cleanup.every(x => x.status === 'tombstone retained')
      ? 0
      : 1
  } catch {
    HCI.writeErrorLine(
      evidencePath
        ? `Probe stopped. Inspect redacted evidence at ${evidencePath}; cleanup may be incomplete.`
        : 'Probe stopped before requests. No provider data was changed.',
    )
    return 1
  }
}
