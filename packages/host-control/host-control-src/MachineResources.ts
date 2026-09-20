import { CLI, Errors, FS, Platform, Time } from '@shared'

/** MachineResourceLease prevents another process from mutating one named host target. */
export type MachineResourceLease = {
  /** The unique acquisition identity every mutating operation must present. */
  readonly generation: string
  /** The identity written to the machine-wide registry for diagnostics and safe release. */
  readonly owner: MachineResourceOwner
  /** Fails when the supplied generation no longer owns the target. */
  assertCurrent: (generation: string) => Promise<void>
  release: () => Promise<void>
}

/** MachineResourceOwner identifies the worktree operation holding one named host resource. */
export type MachineResourceOwner = {
  command: string
  /** Unique lease generation; kept as `id` for compatibility with existing registry readers. */
  id: string
  name: string
  pid: number
  /** OS process start identity, when the host can report it, protects against PID reuse. */
  processStartedAt?: string
  repositoryRoot: string
  /** Lease acquisition time, used only for diagnostics and never as proof that an owner is stale. */
  startedAt: string
}

export type ProcessIdentity = {
  evidence: 'alive' | 'gone' | 'unknown'
  startedAt?: string
}

export type ResourceOptions = {
  /** Command or lane shown to a second worktree when this resource is busy. */
  command?: string
  /** Injected by tests. */
  lockTimeoutMs?: number
  /** Retained for source compatibility. Age never proves that a lease is stale. */
  maxAgeMs?: number
  name: string
  /** Injected by tests. */
  processIdentity?: (pid: number) => Promise<ProcessIdentity>
  registryRoot?: string
  repositoryRoot?: string
}

export type AcquireResourceOptions = ResourceOptions & {
  command: string
  repositoryRoot: string
  /** Maximum bounded wait before reporting the current owner. */
  waitTimeoutMs?: number
}

type MutexRecord = {
  pid: number
  startedAt: string
}

class RegistryLockTimeoutError extends Errors.HostEnvironmentError {}

/** MachineResourceBusyError distinguishes target ownership from CPU-lane contention. */
export class MachineResourceBusyError extends Errors.HostEnvironmentError {
  readonly failureKind = 'native-host-busy'
  readonly owner: MachineResourceOwner

  constructor(owner: MachineResourceOwner) {
    super(
      `Machine resource '${owner.name}' is busy: ${owner.command} in ${owner.repositoryRoot} `
        + `(PID ${owner.pid}), held since ${owner.startedAt}. Wait for that session to finish or stop it, then retry.`,
      { details: { failureKind: 'native-host-busy', owner } },
    )
    this.owner = owner
  }
}

export class MachineResourceFenceError extends Errors.HostEnvironmentError {
  readonly failureKind = 'host-target-fenced'

  constructor(name: string, generation: string) {
    super(`Machine resource '${name}' lease generation '${generation}' is no longer current.`, {
      details: { failureKind: 'host-target-fenced', generation, name },
    })
  }
}

const REGISTRY_DIRECTORY = 'tao/machine-lanes'
const LOCK_POLL_MS = 25
const MUTEX_ACQUIRE_TIMEOUT_MS = 30_000
const RESOURCE_WAIT_TIMEOUT_MS = 10_000
const RESOURCE_POLL_MS = 100
const MUTEX_LINK = '.mutex'

/** registryRoot resolves the machine-wide directory shared by every worktree. */
function registryRoot(): string {
  const cacheHome = Platform.runtimeProcess.env['XDG_CACHE_HOME']
  const base = cacheHome !== undefined && cacheHome.length > 0 ? cacheHome : FS.resolvePath('.cache', FS.homeDir())
  return FS.resolvePath(REGISTRY_DIRECTORY, base)
}

/** acquire waits briefly for a named target, then reports the exact owning worktree and command. */
async function acquire(options: AcquireResourceOptions): Promise<MachineResourceLease> {
  const waitTimeoutMs = Math.max(0, options.waitTimeoutMs ?? RESOURCE_WAIT_TIMEOUT_MS)
  const deadline = Time.nowMs() + waitTimeoutMs
  while (true) {
    const outcome = await claim(options)
    if (outcome.lease !== undefined) {
      return outcome.lease
    }
    if (Time.nowMs() >= deadline) {
      throw new MachineResourceBusyError(outcome.owner)
    }
    await Time.sleep(Math.min(RESOURCE_POLL_MS, Math.max(1, deadline - Time.nowMs())))
  }
}

/** tryAcquire atomically claims one named host target across all worktrees. */
async function tryAcquire(options: ResourceOptions): Promise<MachineResourceLease | undefined> {
  return (await claim(options)).lease
}

async function claim(
  options: ResourceOptions,
): Promise<{ lease?: MachineResourceLease; owner: MachineResourceOwner }> {
  const root = options.registryRoot ?? registryRoot()
  const generation = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const path = resourcePath(root, options.name)
  const processIdentity = options.processIdentity ?? inspectProcessIdentity
  const owner: MachineResourceOwner = {
    command: options.command ?? options.name,
    id: generation,
    name: options.name,
    pid: Platform.runtimeProcess.pid,
    processStartedAt: (await ownProcessIdentity(processIdentity)).startedAt,
    repositoryRoot: options.repositoryRoot ?? Platform.runtimeProcess.cwd(),
    startedAt: new Date().toISOString(),
  }
  let existingOwner: MachineResourceOwner | undefined
  try {
    const acquired = await withRegistryLock(root, async () => {
      const existing = normalizeResourceRecord(await readRecord<unknown>(path))
      if (existing !== undefined && await resourceOwnerIsLive(existing, processIdentity)) {
        existingOwner = existing
        return false
      }
      await FS.remove(path).catch(() => {})
      await atomicWriteJson(path, owner)
      return true
    }, options.lockTimeoutMs)
    if (!acquired) {
      return { owner: existingOwner ?? owner }
    }
  } catch (error) {
    Errors.throwHostEnvironment(`Cannot coordinate machine resource '${options.name}'.`, { cause: error })
  }

  let released = false
  const lease: MachineResourceLease = {
    generation,
    owner,
    assertCurrent: async suppliedGeneration => {
      if (suppliedGeneration !== generation) {
        throw new MachineResourceFenceError(owner.name, suppliedGeneration)
      }
      await withRegistryLock(root, async () => {
        const current = normalizeResourceRecord(await readRecord<unknown>(path))
        if (current?.id !== generation) {
          throw new MachineResourceFenceError(owner.name, suppliedGeneration)
        }
      }, options.lockTimeoutMs)
    },
    release: async () => {
      if (released) {
        return
      }
      await withRegistryLock(root, async () => {
        const existing = normalizeResourceRecord(await readRecord<unknown>(path))
        if (existing?.id === generation) {
          await FS.remove(path)
        }
      }, options.lockTimeoutMs)
      released = true
    },
  }
  return { lease, owner }
}

/** ownerIsLive reports whether a recorded owner still runs as the process that took its lease. */
async function ownerIsLive(owner: MachineResourceOwner): Promise<boolean> {
  return await resourceOwnerIsLive(owner, inspectProcessIdentity)
}

async function withRegistryLock<T>(
  root: string,
  work: () => Promise<T>,
  timeoutMs = MUTEX_ACQUIRE_TIMEOUT_MS,
): Promise<T> {
  await FS.mkdir(root)
  const ownerRoot = FS.resolvePath('.mutex-contenders', root)
  const ownerPath = FS.resolvePath(`${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`, ownerRoot)
  const linkPath = FS.resolvePath(MUTEX_LINK, root)
  await atomicWriteJson(
    ownerPath,
    {
      pid: Platform.runtimeProcess.pid,
      startedAt: new Date().toISOString(),
    } satisfies MutexRecord,
  )
  const deadline = Time.nowMs() + Math.max(0, timeoutMs)

  while (true) {
    try {
      await FS.symlink(FS.relativePath(root, ownerPath), linkPath)
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        await FS.remove(ownerPath).catch(() => {})
        throw error
      }
      const existing = await readRecord<MutexRecord>(linkPath)
      if (existing === undefined || mutexIsStale(existing)) {
        const staleTarget = await mutexTarget(linkPath)
        if (staleTarget !== undefined) {
          await reclaimStaleMutex(root, linkPath, staleTarget)
        }
        continue
      }
      if (Time.nowMs() >= deadline) {
        await FS.remove(ownerPath).catch(() => {})
        throw new RegistryLockTimeoutError('Timed out waiting for the machine-lane registry lock.')
      }
      await Time.sleep(LOCK_POLL_MS)
    }
  }

  try {
    return await work()
  } finally {
    const resolved = await FS.realPath(linkPath).catch(() => undefined)
    if (resolved === await FS.realPath(ownerPath).catch(() => ownerPath)) {
      await FS.remove(linkPath).catch(() => {})
    }
    await FS.remove(ownerPath).catch(() => {})
  }
}

async function reclaimStaleMutex(root: string, linkPath: string, staleTarget: string): Promise<void> {
  const targetKey = FS.basename(staleTarget).replaceAll(/[^a-zA-Z0-9._-]/g, '_')
  const claimPrefix = `.mutex-reclaim-${targetKey}-`
  const claimPath = FS.resolvePath(
    `${claimPrefix}${
      String(Date.now()).padStart(16, '0')
    }-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`,
    root,
  )
  await atomicWriteJson(
    claimPath,
    {
      pid: Platform.runtimeProcess.pid,
      startedAt: new Date().toISOString(),
    } satisfies MutexRecord,
  )
  try {
    await Time.sleep(LOCK_POLL_MS)
    const claims: string[] = []
    for (const entry of await FS.listDir(root)) {
      if (!entry.startsWith(claimPrefix)) {
        continue
      }
      const path = FS.resolvePath(entry, root)
      const claimRecord = await readRecord<MutexRecord>(path)
      if (claimRecord === undefined || mutexIsStale(claimRecord)) {
        await FS.remove(path).catch(() => {})
        continue
      }
      claims.push(path)
    }
    if (claims.toSorted()[0] !== claimPath) {
      return
    }
    if (await mutexTarget(linkPath) === staleTarget) {
      await FS.remove(linkPath)
    }
  } finally {
    await FS.remove(claimPath).catch(() => {})
  }
}

async function mutexTarget(linkPath: string): Promise<string | undefined> {
  const result = await CLI.run('/usr/bin/readlink', { args: [linkPath], stdio: 'pipe' })
  const target = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && target.length > 0
    ? FS.resolvePath(target, FS.dirname(linkPath))
    : undefined
}

function mutexIsStale(record: MutexRecord): boolean {
  return !Platform.processIsAlive(record.pid) || !Number.isFinite(Date.parse(record.startedAt))
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporary, value)
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

async function readRecord<T>(path: string): Promise<T | undefined> {
  try {
    return await FS.readJson<T>(path)
  } catch {
    return undefined
  }
}

function normalizeResourceRecord(value: unknown): MachineResourceOwner | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Partial<MachineResourceOwner>
  const valid = typeof record.id === 'string'
    && typeof record.name === 'string'
    && Number.isInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.startedAt === 'string'
    && Number.isFinite(Date.parse(record.startedAt))
    && (record.processStartedAt === undefined || typeof record.processStartedAt === 'string')
    && (record.command === undefined || typeof record.command === 'string')
    && (record.repositoryRoot === undefined || typeof record.repositoryRoot === 'string')
  if (!valid) {
    return undefined
  }
  return {
    command: record.command ?? record.name!,
    id: record.id!,
    name: record.name!,
    pid: record.pid!,
    processStartedAt: record.processStartedAt,
    repositoryRoot: record.repositoryRoot ?? '<unknown worktree>',
    startedAt: record.startedAt!,
  }
}

let ownIdentity: { pid: number; identity: Promise<ProcessIdentity> } | undefined

function ownProcessIdentity(inspect: (pid: number) => Promise<ProcessIdentity>): Promise<ProcessIdentity> {
  const pid = Platform.runtimeProcess.pid
  if (inspect !== inspectProcessIdentity) {
    return inspect(pid)
  }
  if (ownIdentity === undefined || ownIdentity.pid !== pid) {
    ownIdentity = { identity: inspect(pid), pid }
  }
  return ownIdentity.identity
}

async function resourceOwnerIsLive(
  owner: MachineResourceOwner,
  inspect: (pid: number) => Promise<ProcessIdentity>,
): Promise<boolean> {
  const identity = await inspect(owner.pid)
  if (identity.evidence === 'gone') {
    return false
  }
  if (
    identity.evidence === 'alive'
    && owner.processStartedAt !== undefined
    && identity.startedAt !== undefined
    && owner.processStartedAt !== identity.startedAt
  ) {
    return false
  }
  return true
}

async function inspectProcessIdentity(pid: number): Promise<ProcessIdentity> {
  try {
    const result = await CLI.run('ps', {
      args: ['-o', 'lstart=', '-p', String(pid)],
      env: { LC_ALL: 'C', TZ: 'UTC' },
      stdio: 'pipe',
    })
    const startedAt = result.stdout.trim()
    if (result.error === undefined && result.exitCode === 0 && startedAt.length > 0) {
      return { evidence: 'alive', startedAt }
    }
    if (result.error === undefined && !Platform.processIsAlive(pid)) {
      return { evidence: 'gone' }
    }
  } catch {
    // Fall through to the weaker kernel probe. Uncertain identity remains owned.
  }
  return Platform.processIsAlive(pid) ? { evidence: 'unknown' } : { evidence: 'gone' }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

function resourcePath(root: string, name: string): string {
  return FS.resolvePath(`resource-${name.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}.lease`, root)
}

export const MachineResources = {
  acquire,
  ownerIsLive,
  registryRoot,
  tryAcquire,
} as const
