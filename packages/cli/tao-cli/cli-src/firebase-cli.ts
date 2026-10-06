import { CLI, Errors, FS, HCI, Platform, Text } from '@shared'
import type { Writable } from 'node:stream'

type FirebaseResult = { exitCode: number | null; stdout: string; stderr: string }
export type FirebaseRunner = (args: readonly string[], cwd: string, interactive: boolean) => Promise<FirebaseResult>

export async function firebaseJson(
  run: FirebaseRunner,
  cwd: string,
  args: readonly string[],
  action: string,
): Promise<unknown> {
  let result: FirebaseResult
  try {
    result = await run([...args, '--json'], cwd, false)
  } catch {
    Errors.throwHostEnvironment(
      'Firebase CLI could not ' + action + '. Check local sign-in and project access before retrying.',
    )
  }
  let response: unknown
  try {
    response = JSON.parse(result.stdout)
  } catch {
    Errors.throwHostEnvironment('Firebase CLI could not ' + action + '; it returned no JSON result.')
  }
  if (!isRecord(response)) {
    Errors.throwHostEnvironment('Firebase CLI could not ' + action + '; it returned an unexpected result.')
  }
  if (result.exitCode !== 0 || response['status'] !== 'success') {
    const error = response['error']
    const raw = typeof error === 'string' ? error : isRecord(error) ? error['message'] : undefined
    const status = typeof raw === 'string' ? /HTTP Error: (\d{3})\b/u.exec(raw)?.[1] : undefined
    Errors.throwHostEnvironment(
      'Firebase CLI could not ' + action
        + (status ? '; HTTP Error: ' + status : '')
        + '. Check the selected account, project permissions, and local Firebase CLI sign-in.',
    )
  }
  return response['result']
}
/** Server management never accepts endpoint redirection or emulator routing. */
export function assertFirebaseManagementEnvironment(): void {
  const overrides = [
    'FIRESTORE_EMULATOR_HOST',
    'FIRESTORE_URL',
    'FIREBASE_EMULATOR_HUB',
    'FIREBASE_API_URL',
    'FIREBASE_RESOURCEMANAGER_URL',
    'FIREBASE_IAM_URL',
    'FIREBASE_SERVICE_USAGE_URL',
    'CLOUD_APIKEYS_URL',
    'FIREBASE_FIREDATA_URL',
    'FIREBASE_AUTH_URL',
    'FIREBASE_AUTHPROXY_URL',
    'FIREBASE_TOKEN_URL',
    'FIREBASE_GOOGLE_URL',
    'FIREBASE_CLIENT_ID',
    'FIREBASE_CLIENT_SECRET',
  ]
  const override = overrides.find(name => Object.hasOwn(Platform.runtimeProcess.env, name))
  if (override) {
    Errors.throwUserInput(
      'Unset ' + override
        + ' before Firebase server management. Endpoint overrides and emulator routing are not supported; no cloud calls were made.',
    )
  }
}

/** Explicit config roots isolate the official CLI from ancestor aliases and active-project defaults. */
export async function firebaseManagementJson(
  run: FirebaseRunner,
  cwd: string,
  args: readonly string[],
  action: string,
  project: string,
): Promise<unknown> {
  assertFirebaseManagementEnvironment()
  const artifacts = FS.resolvePath('.artifacts', cwd)
  if (await FS.isSymbolicLink(artifacts) || (await FS.exists(artifacts) && !await FS.isDirectory(artifacts))) {
    Errors.throwUserInput('Firebase management needs a regular local .artifacts directory; no cloud calls were made.')
  }
  await FS.mkdir(artifacts)
  const work = await FS.mkTmpDir(FS.resolvePath('firebase-management-', artifacts))
  try {
    const config = FS.resolvePath('firebase.json', work)
    await FS.writeJson(config, {})
    await FS.writeJson(FS.resolvePath('.firebaserc', work), { projects: {} })
    const scoped = args.includes('--project') ? args : [...args, '--project', project]
    return await firebaseJson(run, work, [...scoped, '--config', config], action)
  } finally {
    await FS.remove(work)
  }
}

export async function runFirebaseCli(
  args: readonly string[],
  cwd: string,
  interactive: boolean,
  output?: Writable,
): Promise<FirebaseResult> {
  const binary = FS.fileUrlToPath(import.meta.resolve('firebase-tools/lib/bin/firebase.js'))
  return CLI.run('node', {
    args: [binary, ...args],
    cwd,
    stdio: interactive ? 'inherit' : 'pipe',
    ...(args[0] === 'projects:create' ? { onOutput: firebaseCreationProgress(output) } : {}),
  })
}
/** Forward only the official CLI's fixed creation stage markers, keeping provider responses private. */
export function firebaseCreationProgress(output?: Writable): (stream: 'stderr' | 'stdout', chunk: Buffer) => void {
  let pending = ''
  const seen = new Set<string>()
  const phases: Record<string, string> = {
    'Creating Google Cloud Platform project': 'Creating the Google Cloud project…',
    'Adding Firebase resources to Google Cloud Platform project':
      'Adding Firebase resources to the Google Cloud project…',
  }
  return (stream, chunk) => {
    if (stream !== 'stderr') {
      return
    }
    pending += chunk.toString('utf8')
    const lines = pending.split(/\r?\n/u)
    pending = lines.pop()!.slice(-512)
    for (const raw of lines) {
      const line = Text.stripAnsi(raw).trim()
      const text = line.startsWith('- ') ? line.slice(2) : undefined
      const message = text ? phases[text] : undefined
      if (message && !seen.has(message)) {
        seen.add(message)
        HCI.writeLine(message, { output })
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
