import { Errors, FS, Platform, Repo } from '@shared'
import type { DevLoopConnection } from '@shared/DevLoopControl'
import type { TrackedProcess } from '@shared/ProcessTree'
import type { AgentAppDevDevice } from '../simulators/AgentAppDev'

export type DevLoopReceipt = {
  version: 1
  session: string
  checkout: string
  args: readonly string[]
  selection?: { appName: string; appPath: string; projectRoot: string }
  generation: string
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'cleanup-failed' | 'interrupted'
  createdAt: string
  updatedAt: string
  controller?: TrackedProcess
  controllerDisposed?: boolean
  children: TrackedProcess[]
  devices?: AgentAppDevDevice[]
  provenance?: 'complete' | 'uncertain'
  url?: string
  targets?: readonly { target: string; dispatched: boolean }[]
  message?: string
  logPath?: string
  warnings?: readonly string[]
  failures?: readonly string[]
  cleanupOutcome?: 'pending' | 'proved' | 'retained' | 'unknown'
}

export function devLoopDirectory(session: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(session)) {
    Errors.throwUserInput('A dev-loop session must be a UUID.')
  }
  return Repo.resolvePath(`.artifacts/dev-loops/${session}`)
}

export async function readDevLoopReceipt(session: string): Promise<DevLoopReceipt> {
  const value = await FS.readJson<DevLoopReceipt>(FS.resolvePath('receipt.json', devLoopDirectory(session)))
  if (value.version !== 1 || value.session !== session || value.checkout !== await FS.realPath(Repo.getRoot())) {
    Errors.throwUserInput('The dev-loop receipt does not belong to this checkout.')
  }
  return value
}

export async function writeDevLoopReceipt(receipt: DevLoopReceipt): Promise<void> {
  receipt.logPath ??= `.artifacts/dev-loops/${receipt.session}/loop.log`
  receipt.warnings ??= []
  receipt.failures ??= []
  receipt.cleanupOutcome ??= 'unknown'
  const directory = devLoopDirectory(receipt.session)
  const temporary = FS.resolvePath(`receipt-${Platform.randomUUID()}.tmp`, directory)
  await FS.writeJson(temporary, receipt)
  await FS.move(temporary, FS.resolvePath('receipt.json', directory))
}

export async function writeDevLoopConnection(connection: DevLoopConnection): Promise<string> {
  const directory = FS.resolvePath('active-control', devLoopDirectory(connection.session))
  await FS.mkdir(directory)
  await FS.chmod(directory, 0o700)
  const path = FS.resolvePath('credentials.json', directory)
  const temporary = FS.resolvePath(`credentials-${Platform.randomUUID()}.tmp`, directory)
  await FS.writeJson(temporary, connection, { mode: 0o600 })
  await FS.chmod(temporary, 0o600)
  await FS.move(temporary, path)
  return path
}

export async function readDevLoopConnection(session: string): Promise<DevLoopConnection> {
  const directory = FS.resolvePath('active-control', devLoopDirectory(session))
  const path = FS.resolvePath('credentials.json', directory)
  if (await FS.fileMode(directory) !== 0o700 || await FS.fileMode(path) !== 0o600) {
    Errors.throwHostEnvironment('Managed dev-loop credentials must be private.')
  }
  const connection = await FS.readJson<DevLoopConnection>(path)
  if (connection.session !== session) {
    Errors.throwHostEnvironment('Managed dev-loop connection belongs to another session.')
  }
  return connection
}
