import { Errors } from './core/shared-core'
import * as FS from './FS'
import * as Platform from './Platform'
import { ProjectLocal } from './ProjectLocal'

type DevSessionSurface = 'cli' | 'studio'
type DevSessionRecord = {
  version: 1
  id: string
  owner: DevSessionSurface
  pid: number
  processStartedAt?: string
  startedAt: string
  finishedAt?: string
  status: 'active' | 'completed' | 'interrupted'
}

type ActiveOwner = Pick<DevSessionRecord, 'id' | 'owner' | 'pid' | 'processStartedAt' | 'version'>

/** ProjectDevSession keeps the one live owner and its history in the project, across processes. */
export const ProjectDevSession = { acquire }

async function acquire(projectRoot: string, surface: DevSessionSurface): Promise<{
  record: DevSessionRecord
  release: () => Promise<void>
}> {
  const root = await FS.realPath(projectRoot)
  const sessionsRoot = ProjectLocal.localResolve('sessions', root)
  const activePath = FS.resolvePath('owner.json', sessionsRoot)
  await ProjectLocal.prepare(root)
  await FS.mkdir(sessionsRoot)
  const ownIdentity = processStartedAt(Platform.runtimeProcess.pid)
  const record: DevSessionRecord = {
    version: 1,
    id: Platform.randomUUID(),
    owner: surface,
    pid: Platform.runtimeProcess.pid,
    ...(ownIdentity === undefined ? {} : { processStartedAt: ownIdentity }),
    startedAt: new Date().toISOString(),
    status: 'active',
  }

  await FS.withFileMutationLock(activePath, root, async () => {
    const current = await readOwner(activePath)
    if (current !== undefined) {
      if (ownerIsLive(current)) {
        Errors.throwUserInput(
          `Tao project ${root} is already owned by ${current.owner} session ${current.id} (PID ${current.pid}). Stop that session before opening another.`,
        )
      }
      await finishRecord(sessionsRoot, current.id, 'interrupted')
    }
    await FS.writeJson(recordPath(sessionsRoot, record.id), record)
    await FS.writeJson(activePath, ownerOf(record))
  }, { lockDirectory: ProjectLocal.cacheResolve('locks', root) })

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
    version: 1,
    id: record.id,
    owner: record.owner,
    pid: record.pid,
    ...(record.processStartedAt === undefined ? {} : { processStartedAt: record.processStartedAt }),
  }
}

async function readOwner(path: string): Promise<ActiveOwner | undefined> {
  if (!await FS.isFile(path)) {
    return undefined
  }
  const value: unknown = await FS.readJson(path)
  if (
    typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
    || !('id' in value) || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
    || !('owner' in value) || (value.owner !== 'cli' && value.owner !== 'studio')
    || !('pid' in value) || typeof value.pid !== 'number' || !Number.isInteger(value.pid)
    || value.pid <= 0
    || ('processStartedAt' in value && typeof value.processStartedAt !== 'string')
  ) {
    Errors.throwHostEnvironment(`Invalid Tao dev-session owner record at ${path}.`)
  }
  return value as ActiveOwner
}

function ownerIsLive(owner: ActiveOwner): boolean {
  if (!Platform.processIsAlive(owner.pid)) {
    return false
  }
  const actualStart = processStartedAt(owner.pid)
  return owner.processStartedAt === undefined || actualStart === undefined || owner.processStartedAt === actualStart
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
