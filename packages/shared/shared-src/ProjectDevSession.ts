import { Errors } from './core/shared-core'
import * as FS from './FS'
import * as Platform from './Platform'
import { ProcessTree, type TrackedProcess } from './ProcessTree'
import { ProjectLocal } from './ProjectLocal'

type DevSessionSurface = 'cli' | 'studio'
type DevSessionRecord = {
  version: 1 | 2
  id: string
  owner: DevSessionSurface
  pid: number
  processStartedAt?: string
  ownerIdentity?: TrackedProcess
  parentIdentity?: TrackedProcess
  foregroundInteractive?: boolean
  startedAt: string
  finishedAt?: string
  status: 'active' | 'completed' | 'interrupted'
}

type ActiveOwner = Pick<
  DevSessionRecord,
  'id' | 'owner' | 'pid' | 'processStartedAt' | 'version' | 'ownerIdentity' | 'parentIdentity' | 'foregroundInteractive'
>
type AcquireOptions = {
  foregroundInteractive?: boolean
  confirmOrphan?: (owner: ActiveOwner) => Promise<boolean>
  onOrphanCleanup?: (phase: 'stopping' | 'stopped' | 'failed', owner: ActiveOwner) => void
}
const ORPHAN_STOP_TIMEOUT_MS = 30_000
const ORPHAN_STOP_POLL_MS = 50

/** ProjectDevSession keeps the one live owner and its history in the project, across processes. */
export const ProjectDevSession = { acquire }

async function acquire(projectRoot: string, surface: DevSessionSurface, options: AcquireOptions = {}): Promise<{
  record: DevSessionRecord
  release: () => Promise<void>
}> {
  const root = await FS.realPath(projectRoot)
  const sessionsRoot = ProjectLocal.localResolve('sessions', root)
  const activePath = FS.resolvePath('owner.json', sessionsRoot)
  await ProjectLocal.prepare(root)
  await FS.mkdir(sessionsRoot)
  let ownerIdentity: TrackedProcess | undefined
  let parentIdentity: TrackedProcess | undefined
  try {
    const pid = Platform.runtimeProcess.pid
    const ppid = Platform.runtimeProcess.ppid
    const identities = ProcessTree.identities([pid, ppid])
    ownerIdentity = identities.get(pid)
    parentIdentity = identities.get(ppid)
  } catch {
    // A v1 record remains safe: live owners stay unknown until exact identities can be proven.
  }
  const record: DevSessionRecord = {
    version: ownerIdentity !== undefined && parentIdentity !== undefined ? 2 : 1,
    id: Platform.randomUUID(),
    owner: surface,
    pid: Platform.runtimeProcess.pid,
    ...(ownerIdentity === undefined || parentIdentity === undefined
      ? { processStartedAt: processStartedAt(Platform.runtimeProcess.pid) }
      : { ownerIdentity, parentIdentity }),
    foregroundInteractive: options.foregroundInteractive === true,
    startedAt: new Date().toISOString(),
    status: 'active',
  }

  let orphan: ActiveOwner | undefined
  await FS.withFileMutationLock(activePath, root, async () => {
    const current = await readOwner(activePath)
    if (current !== undefined) {
      const state = ownerState(current)
      if (state === 'live' || state === 'unknown' || state === 'orphan') {
        if (state === 'orphan') {
          orphan = current
          return
        }
        Errors.throwUserInput(
          `Tao project ${root} is already owned by ${current.owner} session ${current.id} (PID ${current.pid}). Stop that session before opening another.`,
        )
      }
      await finishRecord(sessionsRoot, current.id, 'interrupted')
    }
    await writeNewOwner(sessionsRoot, activePath, record)
  }, { lockDirectory: ProjectLocal.cacheResolve('locks', root) })

  if (orphan !== undefined) {
    const confirmedOrphan = orphan
    if (
      !options.foregroundInteractive || options.confirmOrphan === undefined
      || !await options.confirmOrphan(confirmedOrphan)
    ) {
      refuseOwner(root, confirmedOrphan)
    }
    options.onOrphanCleanup?.('stopping', confirmedOrphan)
    await FS.withFileMutationLock(activePath, root, async () => {
      const current = await readOwner(activePath)
      if (current?.id !== confirmedOrphan.id || ownerState(current) !== 'orphan') {
        refuseOwner(root, current ?? confirmedOrphan)
      }
      ProcessTree.signalTracked([confirmedOrphan.ownerIdentity!], 'SIGTERM')
    }, { lockDirectory: ProjectLocal.cacheResolve('locks', root) })
    const stopped = await waitForOwnerExit(confirmedOrphan.ownerIdentity!, ORPHAN_STOP_TIMEOUT_MS)
    if (!stopped) {
      options.onOrphanCleanup?.('failed', confirmedOrphan)
      refuseOwner(root, confirmedOrphan)
    }
    options.onOrphanCleanup?.('stopped', confirmedOrphan)
    await FS.withFileMutationLock(activePath, root, async () => {
      const current = await readOwner(activePath)
      if (current === undefined) {
        await finishRecord(sessionsRoot, confirmedOrphan.id, 'interrupted')
        await writeNewOwner(sessionsRoot, activePath, record)
        return
      }
      if (current.id !== confirmedOrphan.id || ownerState(current) !== 'stale') {
        refuseOwner(root, current)
      }
      await finishRecord(sessionsRoot, confirmedOrphan.id, 'interrupted')
      await writeNewOwner(sessionsRoot, activePath, record)
    }, { lockDirectory: ProjectLocal.cacheResolve('locks', root) })
  }

  let releasing: Promise<void> | undefined
  return {
    record,
    release: () => {
      releasing ??= FS.withFileMutationLock(activePath, root, async () => {
        const current = await readOwner(activePath)
        if (current?.id !== record.id) {
          return
        }
        await finishRecord(sessionsRoot, record.id, 'completed')
        await FS.remove(activePath)
      }, { lockDirectory: ProjectLocal.cacheResolve('locks', root) })
      return releasing
    },
  }
}

function ownerOf(record: DevSessionRecord): ActiveOwner {
  return {
    version: record.version,
    id: record.id,
    owner: record.owner,
    pid: record.pid,
    ...(record.processStartedAt === undefined ? {} : { processStartedAt: record.processStartedAt }),
    ...(record.ownerIdentity === undefined ? {} : { ownerIdentity: record.ownerIdentity }),
    ...(record.parentIdentity === undefined ? {} : { parentIdentity: record.parentIdentity }),
    ...(record.foregroundInteractive === undefined ? {} : { foregroundInteractive: record.foregroundInteractive }),
  }
}

async function readOwner(path: string): Promise<ActiveOwner | undefined> {
  if (!await FS.isFile(path)) {
    return undefined
  }
  const value: unknown = await FS.readJson(path)
  if (
    typeof value !== 'object' || value === null || !('version' in value) || (value.version !== 1 && value.version !== 2)
    || !('id' in value) || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
    || !('owner' in value) || (value.owner !== 'cli' && value.owner !== 'studio')
    || !('pid' in value) || typeof value.pid !== 'number' || !Number.isInteger(value.pid)
    || value.pid <= 0
    || ('processStartedAt' in value && typeof value.processStartedAt !== 'string')
    || (value.version === 2 && (
      !('ownerIdentity' in value) || !isTrackedProcess(value.ownerIdentity)
      || value.ownerIdentity.pid !== value.pid
      || !('parentIdentity' in value) || !isTrackedProcess(value.parentIdentity)
      || !('foregroundInteractive' in value) || typeof value.foregroundInteractive !== 'boolean'
    ))
  ) {
    Errors.throwHostEnvironment(`Invalid Tao dev-session owner record at ${path}.`)
  }
  return value as ActiveOwner
}

type OwnerState = 'live' | 'orphan' | 'stale' | 'unknown'

function ownerState(owner: ActiveOwner): OwnerState {
  if (owner.version === 1) {
    // A rounded v1 start time can prove a reused PID, but a match cannot authorize orphan cleanup.
    if (!Platform.processIsAlive(owner.pid)) {
      return 'stale'
    }
    if (owner.processStartedAt !== undefined) {
      const actualStart = processStartedAt(owner.pid)
      if (actualStart !== undefined && actualStart !== owner.processStartedAt) {
        return 'stale'
      }
    }
    return 'unknown'
  }
  if (owner.ownerIdentity === undefined || owner.parentIdentity === undefined) {
    return 'unknown'
  }
  let current: Map<number, TrackedProcess>
  try {
    current = ProcessTree.identities([owner.ownerIdentity.pid, owner.parentIdentity.pid])
  } catch {
    return 'unknown'
  }
  const currentOwner = current.get(owner.ownerIdentity.pid)
  if (currentOwner === undefined) {
    return Platform.processIsAlive(owner.ownerIdentity.pid) ? 'unknown' : 'stale'
  }
  if (!ProcessTree.sameProcess(currentOwner, owner.ownerIdentity)) {
    return 'stale'
  }
  if (owner.owner !== 'cli' || !owner.foregroundInteractive) {
    return 'live'
  }
  const parent = current.get(owner.parentIdentity.pid)
  if (parent === undefined) {
    return Platform.processIsAlive(owner.parentIdentity.pid) ? 'unknown' : 'orphan'
  }
  if (ProcessTree.sameProcess(parent, owner.parentIdentity)) {
    return 'live'
  }
  return 'orphan'
}

function isTrackedProcess(value: unknown): value is TrackedProcess {
  return typeof value === 'object' && value !== null
    && 'pid' in value && typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0
    && 'startedAt' in value && typeof value.startedAt === 'string' && value.startedAt !== ''
    && 'command' in value && typeof value.command === 'string'
}

async function writeNewOwner(sessionsRoot: string, activePath: string, record: DevSessionRecord): Promise<void> {
  await FS.writeJson(recordPath(sessionsRoot, record.id), record)
  await FS.writeJson(activePath, ownerOf(record))
}

function refuseOwner(root: string, owner: ActiveOwner): never {
  Errors.throwUserInput(
    `Tao project ${root} is already owned by ${owner.owner} session ${owner.id} (PID ${owner.pid}). Stop that session before opening another.`,
  )
}

async function waitForOwnerExit(owner: TrackedProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    try {
      const current = ProcessTree.identities([owner.pid]).get(owner.pid)
      if (!ProcessTree.sameProcess(current, owner)) {
        return true
      }
    } catch {
      return false
    }
    await new Promise<void>(resolve => setTimeout(resolve, ORPHAN_STOP_POLL_MS))
  }
  return false
}

function processStartedAt(pid: number): string | undefined {
  const result = Platform.spawnSync('ps', {
    args: ['-o', 'lstart=', '-p', String(pid)],
    env: { ...Platform.runtimeProcess.env, LC_ALL: 'C', TZ: 'UTC' },
  })
  const value = result.stdout?.toString().trim() ?? ''
  return result.status === 0 && value !== '' ? value : undefined
}

async function finishRecord(root: string, id: string, status: 'completed' | 'interrupted'): Promise<void> {
  const path = recordPath(root, id)
  if (!await FS.isFile(path)) {
    return
  }
  const record = await FS.readJson<DevSessionRecord>(path)
  if (record.status !== 'active') {
    return
  }
  await FS.writeJson(path, { ...record, finishedAt: new Date().toISOString(), status })
}

function recordPath(root: string, id: string): string {
  return FS.resolvePath(`${id}.json`, root)
}
