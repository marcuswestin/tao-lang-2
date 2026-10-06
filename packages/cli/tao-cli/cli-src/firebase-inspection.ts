import { CLI, Errors, FS } from '@shared'
import ACCOUNTS_BRIDGE from './firebase-accounts-bridge.cjs.txt'
import INSPECTION_BRIDGE from './firebase-inspection-bridge.cjs.txt'

/** Public state only; credentials remain inside the official CLI's isolated Node process. */
export type FirebaseInspection = {
  database?: { name: string; type: string; databaseEdition?: string; locationId: string }
  auth: { emailPasswordEnabled: boolean; emailPasswordRequired?: boolean; preserved: unknown }
  rules?: { releaseName: string; rulesetName: string; source: string }
}

export type FirebaseInspector = (request: {
  projectId: string
  account: string
  cwd: string
}) => Promise<FirebaseInspection>

/** A public API classification, never a raw provider error or response. */
export type FirebaseInspectionFailure = {
  stage: 'account' | 'databases' | 'auth-config' | 'auth-providers' | 'rules-release' | 'rules-source'
  status: number | null
  code: string
}

const FAILURE_STAGES = ['account', 'databases', 'auth-config', 'auth-providers', 'rules-release', 'rules-source']
const FAILURE_CODES = [
  'CONFIGURATION_NOT_FOUND',
  'SERVICE_DISABLED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'INVALID_ARGUMENT',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'INTERNAL',
  'UNKNOWN',
  'ACCOUNT_MISMATCH',
  'INVALID_RESPONSE',
  'CONSUMER_INVALID',
  'PROJECT_NOT_FOUND',
  'IAM_PERMISSION_DENIED',
]

/** Read the inspection boundary's sanitized diagnostic for bounded creation retries. */
export function firebaseInspectionFailure(error: unknown): FirebaseInspectionFailure | undefined {
  return error instanceof Errors.HostEnvironmentError ? publicFailure(error.details?.['firebaseInspection']) : undefined
}

type BridgeRunner = (
  script: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>

const runBridge: BridgeRunner = (script, args, cwd) =>
  CLI.run('node', { args: ['-e', script, ...args], cwd, stdio: 'pipe' })

/** List only public emails; the official login:list JSON includes credential objects. */
export async function listFirebaseAccounts(
  cwd: string,
  runner: BridgeRunner = runBridge,
): Promise<{ user: { email: string } }[]> {
  const authPath = FS.fileUrlToPath(import.meta.resolve('firebase-tools/lib/auth.js'))
  const result = await runner(
    ACCOUNTS_BRIDGE,
    [authPath],
    cwd,
  )
  if (result.exitCode !== 0) {
    Errors.throwHostEnvironment('Firebase CLI could not inspect local sign-in. Retry after signing in locally.')
  }
  try {
    const value: unknown = JSON.parse(result.stdout)
    if (
      Array.isArray(value)
      && value.every(account =>
        record(account) && record(account['user']) && typeof account['user']['email'] === 'string'
      )
    ) {
      return value as { user: { email: string } }[]
    }
  } catch {
    // Report only a public diagnostic, never the CLI process output.
  }
  Errors.throwHostEnvironment('Firebase CLI returned an invalid local account list.')
}

/** Inspect using the installed official CLI's authentication and authenticated API client. */
export async function inspectFirebase(
  request: Parameters<FirebaseInspector>[0],
  runner: BridgeRunner = runBridge,
): Promise<FirebaseInspection> {
  const authPath = FS.fileUrlToPath(import.meta.resolve('firebase-tools/lib/auth.js'))
  const vendorRoot = FS.dirname(authPath)
  const result = await runner(INSPECTION_BRIDGE, [vendorRoot, request.projectId, request.account], request.cwd)
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch {
    Errors.throwHostEnvironment('Firebase inspection returned no public state; setup could not be verified.')
  }
  if (result.exitCode !== 0) {
    const details = record(value) ? publicFailure(value['failure']) : undefined
    if (details) {
      Errors.throwHostEnvironment(
        `Firebase inspection failed at ${details.stage} (${
          details.status === null ? 'no HTTP status' : `HTTP ${details.status}`
        }, ${details.code}). Check local sign-in and project access before resuming setup.`,
        { details: { firebaseInspection: details } },
      )
    }
    Errors.throwHostEnvironment(
      'Firebase inspection failed without a public API classification; setup could not be verified.',
    )
  }
  if (!record(value) || !record(value['auth']) || typeof value['auth']['emailPasswordEnabled'] !== 'boolean') {
    Errors.throwHostEnvironment('Firebase inspection returned invalid public state; setup could not be verified.')
  }
  if (
    value['auth']['preserved'] !== null
    && (typeof value['auth']['preserved'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['auth']['preserved']))
  ) {
    Errors.throwHostEnvironment('Firebase inspection returned an invalid retained-settings fingerprint.')
  }
  if (
    value['auth']['emailPasswordRequired'] !== undefined && typeof value['auth']['emailPasswordRequired'] !== 'boolean'
  ) {
    Errors.throwHostEnvironment('Firebase inspection returned an invalid email sign-in mode.')
  }
  const database = value['database']
  const rules = value['rules']
  if (
    database !== undefined
    && (!record(database) || database['name'] !== `projects/${request.projectId}/databases/(default)`
      || typeof database['type'] !== 'string' || typeof database['locationId'] !== 'string'
      || (database['databaseEdition'] !== undefined && typeof database['databaseEdition'] !== 'string'))
  ) {
    Errors.throwHostEnvironment('Firebase inspection returned invalid default database metadata.')
  }
  if (
    rules !== undefined
    && (!record(rules) || rules['releaseName'] !== `projects/${request.projectId}/releases/cloud.firestore`
      || typeof rules['rulesetName'] !== 'string'
      || !rules['rulesetName'].startsWith(`projects/${request.projectId}/rulesets/`)
      || typeof rules['source'] !== 'string')
  ) {
    Errors.throwHostEnvironment('Firebase inspection returned invalid deployed rules metadata.')
  }
  return value as FirebaseInspection
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function publicFailure(value: unknown): FirebaseInspectionFailure | undefined {
  if (
    !record(value) || typeof value['stage'] !== 'string' || !FAILURE_STAGES.includes(value['stage'])
    || typeof value['code'] !== 'string' || !FAILURE_CODES.includes(value['code'])
    || (value['status'] !== null
      && (typeof value['status'] !== 'number' || !Number.isInteger(value['status']) || value['status'] < 100
        || value['status'] > 599))
  ) {
    return undefined
  }
  return {
    stage: value['stage'] as FirebaseInspectionFailure['stage'],
    status: value['status'] as number | null,
    code: value['code'],
  }
}

// Keep the pinned firebase-tools internals behind this process boundary. Never serialize an account,
// token, raw Identity Toolkit config, or provider secret, including on the error path.
