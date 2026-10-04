import { CLI, Errors, FS, Platform, Time, type TrackedProcess } from '@shared'

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
  /** Retained targets require explicit, identity-fenced recovery, even after their owner exits. */
  retention?: {
    processes: TrackedProcess[]
    processGroupPid?: number
    quarantined: boolean
    reason: string
    resourceNames: string[]
    /** Permanent capture uncertainty is distinct from a provisional launch quarantine. */
    ownershipRefusal?: {
      version: 1
      reason: string
      managed?: {
        session: string
        generation: string
        physicalGeneration: string
        checkout: string
        controller: TrackedProcess
      }
    }
  }
}

type RetainResourcesOptions = {
  owners: readonly MachineResourceOwner[]
  processes: readonly TrackedProcess[]
  processGroupPid?: number
  quarantined: boolean
  reason: string
  ownershipRefusal?: NonNullable<MachineResourceOwner['retention']>['ownershipRefusal']
  registryRoot?: string
}

const synchronousAdmissions = new Set<string>()

function assertNoAdmissionReentry(root: string): void {
  if (synchronousAdmissions.has(FS.resolvePath(root))) {
    Errors.throwUnexpected('A synchronous machine-resource admission cannot reenter its registry.')
  }
}

/** Validate an exact snapshot and perform one synchronous host admission under the registry mutex. */
async function withCurrentOwners<T>(
  options: { owners: readonly MachineResourceOwner[]; registryRoot?: string },
  syncAction: () => T & (T extends PromiseLike<unknown> ? never : unknown),
): Promise<T> {
  const root = options.registryRoot ?? registryRoot()
  assertNoAdmissionReentry(root)
  const snapshot = structuredClone(options.owners)
  if (snapshot.length === 0 || new Set(snapshot.map(owner => owner.name)).size !== snapshot.length) {
    Errors.throwUnexpected('Machine-resource admission requires a nonempty, duplicate-free owner snapshot.')
  }
  return await withRegistryLock(root, async () => {
    for (const expected of snapshot) {
      if (!sameOwner(await readResourceOwner(root, expected.name), expected)) {
        throw new MachineResourceFenceError(expected.name, expected.id)
      }
    }
    const key = FS.resolvePath(root)
    synchronousAdmissions.add(key)
    try {
      const value = syncAction()
      if (
        value !== null && (typeof value === 'object' || typeof value === 'function')
        && 'then' in value && typeof value.then === 'function'
      ) {
        Errors.throwUnexpected('Machine-resource admission action must be synchronous.')
      }
      return value
    } finally {
      synchronousAdmissions.delete(key)
    }
  })
}

type RecoverResourcesOptions = {
  generation: string
  name: string
  registryRoot?: string
  /** Return true only after proving that every captured process and descendant has stopped. */
  shutdown: (owner: MachineResourceOwner) => Promise<boolean>
}

type RetentionRecord = {
  originalOwners: MachineResourceOwner[]
  retainedOwner: MachineResourceOwner
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
  /** Cancels queued acquisition without stopping the current target owner. */
  signal?: AbortSignal
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
  assertNoAdmissionReentry(options.registryRoot ?? registryRoot())
  const waitTimeoutMs = Math.max(0, options.waitTimeoutMs ?? RESOURCE_WAIT_TIMEOUT_MS)
  const deadline = Time.nowMs() + waitTimeoutMs
  while (true) {
    throwIfAcquisitionAborted(options.signal)
    const outcome = await claim(options, options.signal)
    if (options.signal?.aborted === true) {
      await outcome.lease?.release()
      throwIfAcquisitionAborted(options.signal)
    }
    if (outcome.lease !== undefined) {
      return outcome.lease
    }
    if (Time.nowMs() >= deadline) {
      throw new MachineResourceBusyError(outcome.owner)
    }
    await waitForAcquisitionPoll(Math.min(RESOURCE_POLL_MS, Math.max(1, deadline - Time.nowMs())), options.signal)
  }
}

function throwIfAcquisitionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw Errors.abortError('Machine resource acquisition was cancelled.')
  }
}

async function waitForAcquisitionPoll(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    await Time.sleep(milliseconds)
    return
  }
  throwIfAcquisitionAborted(signal)
  await new Promise<void>((resolve, reject) => {
    function finish() {
      signal!.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      signal!.removeEventListener('abort', abort)
      reject(Errors.abortError('Machine resource acquisition was cancelled.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
    }
    void Time.sleep(milliseconds).then(finish, reject)
  })
}

/** tryAcquire atomically claims one named host target across all worktrees. */
async function tryAcquire(options: ResourceOptions): Promise<MachineResourceLease | undefined> {
  assertNoAdmissionReentry(options.registryRoot ?? registryRoot())
  return (await claim(options)).lease
}

async function claim(
  options: ResourceOptions,
  signal?: AbortSignal,
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
    const acquired = await withRegistryLock(
      root,
      async () => {
        const existing = await readResourceOwner(root, options.name)
        if (existing !== undefined && await resourceOwnerIsLive(existing, processIdentity)) {
          existingOwner = existing
          return false
        }
        await FS.remove(path).catch(() => {})
        await atomicWriteJson(path, owner)
        return true
      },
      options.lockTimeoutMs,
      signal,
    )
    if (!acquired) {
      return { owner: existingOwner ?? owner }
    }
  } catch (error) {
    throwIfAcquisitionAborted(signal)
    Errors.throwHostEnvironment(`Cannot coordinate machine resource '${options.name}'.`, { cause: error })
  }

  let released = false
  let releasing: Promise<void> | undefined
  const lease: MachineResourceLease = {
    generation,
    owner,
    assertCurrent: async suppliedGeneration => {
      if (suppliedGeneration !== generation) {
        throw new MachineResourceFenceError(owner.name, suppliedGeneration)
      }
      await withRegistryLock(root, async () => {
        const current = await readResourceOwner(root, options.name)
        if (current?.id !== generation) {
          throw new MachineResourceFenceError(owner.name, suppliedGeneration)
        }
      }, options.lockTimeoutMs)
    },
    release: () => {
      if (released) {
        return Promise.resolve()
      }
      // Early release and a caller's final cleanup must join the same filesystem work.
      // Otherwise one can return while the other still uses a disposable registry.
      return releasing ??= withRegistryLock(root, async () => {
        const existing = await readResourceOwner(root, options.name)
        if (existing?.id === generation) {
          await FS.remove(path)
        }
      }, options.lockTimeoutMs).then(() => {
        released = true
      }).catch(error => {
        releasing = undefined
        throw error
      })
    },
  }
  return { lease, owner }
}

/** ownerIsLive reports whether a recorded owner still runs as the process that took its lease. */
async function ownerIsLive(owner: MachineResourceOwner): Promise<boolean> {
  return await resourceOwnerIsLive(owner, inspectProcessIdentity)
}

/** readOwner resolves an atomic retained handoff for registry diagnostics as well as acquisition. */
async function readOwner(
  options: Pick<ResourceOptions, 'name' | 'registryRoot'>,
): Promise<MachineResourceOwner | undefined> {
  const root = options.registryRoot ?? registryRoot()
  assertNoAdmissionReentry(root)
  return await readResourceOwner(root, options.name)
}

/** Read the complete retained-generation chain without granting new cleanup authority. */
async function readRetainedLineage(
  options: Pick<ResourceOptions, 'name' | 'registryRoot'> & { generation: string },
): Promise<MachineResourceOwner[] | undefined> {
  const root = options.registryRoot ?? registryRoot()
  assertNoAdmissionReentry(root)
  const records = await retentionRecords(root)
  const starts = records.filter(({ record }) =>
    record.retainedOwner.id === options.generation
    && record.retainedOwner.retention!.resourceNames.includes(options.name)
  )
  if (starts.length !== 1) {
    return undefined
  }
  const forName = (record: RetentionRecord): MachineResourceOwner => {
    const original = record.originalOwners.find(owner => owner.name === options.name)
    if (original === undefined || !record.retainedOwner.retention!.resourceNames.includes(options.name)) {
      Errors.throwHostEnvironment('Retained resource lineage has an inconsistent fence manifest.')
    }
    return { ...record.retainedOwner, name: options.name, command: original.command }
  }
  const owners = [forName(starts[0]!.record)]
  const seen = new Set([owners[0]!.id])
  for (;;) {
    const last = owners[owners.length - 1]!
    const next = records.filter(({ record }) => record.originalOwners.some(owner => sameOwner(last, owner)))
    if (next.length === 0) {
      return sameOwner(await readResourceOwner(root, options.name), last) ? owners : undefined
    }
    if (next.length !== 1 || seen.has(next[0]!.record.retainedOwner.id)) {
      Errors.throwHostEnvironment('Retained resource lineage is ambiguous or cyclic; cleanup authority is unavailable.')
    }
    const successor = forName(next[0]!.record)
    owners.push(successor)
    seen.add(successor.id)
  }
}

/** listOwners includes retained fences even if an interrupted recovery removed an original lease file. */
async function listOwners(options: { registryRoot?: string } = {}): Promise<MachineResourceOwner[]> {
  const root = options.registryRoot ?? registryRoot()
  assertNoAdmissionReentry(root)
  // Diagnostics do not create mutex files. Mutations recheck the snapshot under the registry lock.
  return await (async () => {
    const names = new Set<string>()
    const files = await FS.listDir(root).catch(error => {
      if (errorCode(error) === 'ENOENT') {
        return []
      }
      throw error
    })
    for (const file of files) {
      if (file.startsWith('resource-') && file.endsWith('.lease')) {
        const owner = normalizeResourceRecord(await readRecord<unknown>(FS.resolvePath(file, root)))
        if (owner !== undefined) {
          names.add(owner.name)
        }
      }
    }
    for (const { record } of await retentionRecords(root)) {
      for (const owner of record.originalOwners) {
        names.add(owner.name)
      }
    }
    const owners: MachineResourceOwner[] = []
    for (const name of names) {
      const owner = await readResourceOwner(root, name)
      if (owner !== undefined) {
        owners.push(owner)
      }
    }
    return owners
  })()
}

/** retain atomically transfers all target fences to a surviving process and rotates their generation. */
async function retain(options: RetainResourcesOptions): Promise<MachineResourceOwner> {
  const root = options.registryRoot ?? registryRoot()
  assertNoAdmissionReentry(root)
  const first = options.owners[0]
  if (first === undefined) {
    Errors.throwUnexpected('Expected at least one resource to retain.')
  }
  return await withRegistryLock(root, async () => {
    const currentOwners: MachineResourceOwner[] = []
    for (const expected of options.owners) {
      const current = await readResourceOwner(root, expected.name)
      if (!sameOwner(current, expected)) {
        throw new MachineResourceFenceError(expected.name, expected.id)
      }
      currentOwners.push(current!)
      if (current!.retention?.resourceNames.some(name => !options.owners.some(owner => owner.name === name))) {
        Errors.throwHostEnvironment('Retained resource rotation requires its complete existing fence manifest.')
      }
    }
    const previousRefusal = currentOwners.find(owner => owner.retention?.ownershipRefusal)?.retention?.ownershipRefusal
    if (
      currentOwners.some(owner =>
        owner.retention?.ownershipRefusal !== undefined
        && JSON.stringify(owner.retention.ownershipRefusal) !== JSON.stringify(previousRefusal)
      )
    ) {
      Errors.throwHostEnvironment('Retained resource manifests have conflicting permanent ownership refusal custody.')
    }
    const ownershipRefusal = structuredClone(previousRefusal ?? options.ownershipRefusal)
    if (!validOwnershipRefusal(ownershipRefusal)) {
      Errors.throwHostEnvironment('Permanent machine-resource ownership refusal metadata is invalid.')
    }
    const survivor = options.processes[0]
    const generation = `${survivor?.pid ?? first.pid}-${Platform.randomUUID()}`
    const retention = {
      processes: [...options.processes],
      processGroupPid: options.processGroupPid,
      quarantined: options.quarantined || survivor === undefined,
      reason: options.reason,
      resourceNames: options.owners.map(owner => owner.name),
      ...(ownershipRefusal === undefined ? {} : { ownershipRefusal }),
    }
    const retainedOwner: MachineResourceOwner = {
      ...first,
      id: generation,
      pid: survivor?.pid ?? first.pid,
      processStartedAt: survivor?.startedAt,
      retention,
    }
    // One atomic manifest publishes the handoff for every fence. A crash cannot leave one
    // fence following the old parent PID while the other follows the surviving emulator.
    await atomicWriteJson(
      retentionPath(root, generation),
      {
        originalOwners: [...options.owners],
        retainedOwner,
      } satisfies RetentionRecord,
    )
    return retainedOwner
  })
}

/** recoverRetained never removes a fence based on lease age, owner death, or ADB absence. */
async function recoverRetained(options: RecoverResourcesOptions): Promise<void> {
  const root = options.registryRoot ?? registryRoot()
  const snapshot = await withRegistryLock(root, async () => {
    const owner = await readResourceOwner(root, options.name)
    if (owner?.id !== options.generation || owner.name !== options.name || owner.retention === undefined) {
      throw new MachineResourceFenceError(options.name, options.generation)
    }
    if (owner.retention.ownershipRefusal !== undefined) {
      Errors.throwHostEnvironment(
        `Machine resource '${options.name}' has permanent ownership refusal: ${owner.retention.ownershipRefusal.reason}`,
      )
    }
    return owner
  })
  if (!await options.shutdown(snapshot)) {
    Errors.throwHostEnvironment(`Machine resource '${options.name}' shutdown is unproved; its fences remain retained.`)
  }
  await withRegistryLock(root, async () => {
    const owners: MachineResourceOwner[] = []
    for (const name of snapshot.retention!.resourceNames) {
      const current = await readResourceOwner(root, name)
      if (!sameOwner(current, { ...snapshot, name })) {
        throw new MachineResourceFenceError(name, options.generation)
      }
      owners.push(current!)
    }
    for (const owner of owners) {
      await FS.remove(resourcePath(root, owner.name))
    }
    const names = new Set(snapshot.retention!.resourceNames)
    for (const { path, record } of await retentionRecords(root)) {
      if (record.retainedOwner.retention!.resourceNames.every(name => names.has(name))) {
        await FS.remove(path)
      }
    }
  })
}

function sameOwner(current: MachineResourceOwner | undefined, expected: MachineResourceOwner): boolean {
  return current?.id === expected.id && current.pid === expected.pid
    && current.name === expected.name && current.repositoryRoot === expected.repositoryRoot
    && current.processStartedAt === expected.processStartedAt
}

function retentionPath(root: string, generation: string): string {
  return FS.resolvePath(`${generation.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}.json`, FS.resolvePath('.retentions', root))
}

async function readResourceOwner(root: string, name: string): Promise<MachineResourceOwner | undefined> {
  let current = normalizeResourceRecord(await readRecord<unknown>(resourcePath(root, name)))
  const pending = await retentionRecords(root)
  // Follow rotated generations, independent of directory enumeration order.
  for (let round = 0; round < pending.length; round++) {
    let advanced = false
    for (const entry of pending) {
      const expected = entry.record.originalOwners.find(owner => owner.name === name)
      if (expected !== undefined && (current === undefined || sameOwner(current, expected))) {
        current = { ...entry.record.retainedOwner, command: expected.command, name }
        advanced = true
      }
    }
    if (!advanced) {
      break
    }
  }
  return current
}

async function retentionRecords(root: string): Promise<{ path: string; record: RetentionRecord }[]> {
  const directory = FS.resolvePath('.retentions', root)
  const files = await FS.listDir(directory).catch(error => {
    if (errorCode(error) === 'ENOENT') {
      return []
    }
    throw error
  })
  const records: { path: string; record: RetentionRecord }[] = []
  for (const file of files.filter(file => file.endsWith('.json'))) {
    const path = FS.resolvePath(file, directory)
    const record = await FS.readJson<RetentionRecord>(path).catch(error => {
      if (errorCode(error) === 'ENOENT') {
        return undefined
      }
      Errors.throwHostEnvironment(
        `Cannot read retained machine resource identities in '${file}'; targets remain fenced.`,
        { cause: error },
      )
    })
    // A read-only diagnostic can race a successful recovery after listing the directory.
    if (record === undefined) {
      continue
    }
    if (
      record === null || !Array.isArray(record.originalOwners)
      || record.originalOwners.length === 0
      || !record.originalOwners.every(owner => normalizeResourceRecord(owner) !== undefined)
      || normalizeResourceRecord(record.retainedOwner)?.retention === undefined
    ) {
      Errors.throwHostEnvironment(
        `Cannot read retained machine resource identities in '${file}'; targets remain fenced.`,
      )
    }
    records.push({ path, record })
  }
  return records
}

async function withRegistryLock<T>(
  root: string,
  work: () => Promise<T>,
  timeoutMs = MUTEX_ACQUIRE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  assertNoAdmissionReentry(root)
  throwIfAcquisitionAborted(signal)
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

  try {
    while (true) {
      throwIfAcquisitionAborted(signal)
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
        await waitForAcquisitionPoll(LOCK_POLL_MS, signal)
      }
    }

    throwIfAcquisitionAborted(signal)
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

function validOwnershipRefusal(value: NonNullable<MachineResourceOwner['retention']>['ownershipRefusal']): boolean {
  if (value === undefined) {
    return true
  }
  if (
    value === null || typeof value !== 'object' || value.version !== 1 || typeof value.reason !== 'string'
    || value.reason.length === 0 || value.reason.length > 1_024
  ) {
    return false
  }
  const managed = value.managed
  return managed === undefined || managed !== null && typeof managed === 'object'
      && typeof managed.session === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(managed.session)
      && typeof managed.generation === 'string' && managed.generation.length > 0 && managed.generation.length <= 128
      && typeof managed.physicalGeneration === 'string' && managed.physicalGeneration.length > 0
      && managed.physicalGeneration.length <= 128
      && typeof managed.checkout === 'string' && managed.checkout.length > 0 && managed.checkout.length <= 4_096
      && managed.controller !== null && typeof managed.controller === 'object'
      && Number.isSafeInteger(managed.controller.pid) && managed.controller.pid > 1
      && typeof managed.controller.startedAt === 'string' && managed.controller.startedAt.length > 0
      && managed.controller.startedAt.length <= 256 && typeof managed.controller.command === 'string'
}

function normalizeResourceRecord(value: unknown): MachineResourceOwner | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Partial<MachineResourceOwner>
  const retention = record.retention
  const retentionValid = retention === undefined || (
    typeof retention === 'object' && retention !== null
    && typeof retention.reason === 'string'
    && typeof retention.quarantined === 'boolean'
    && validOwnershipRefusal(retention.ownershipRefusal)
    && Array.isArray(retention.resourceNames) && retention.resourceNames.length > 0
    && retention.resourceNames.every(name => typeof name === 'string')
    && retention.resourceNames.includes(record.name!)
    && Array.isArray(retention.processes)
    && retention.processes.every(process =>
      typeof process === 'object' && process !== null
      && Number.isSafeInteger(process.pid) && process.pid > 1
      && typeof process.startedAt === 'string' && process.startedAt.length > 0
      && typeof process.command === 'string'
    )
    && (retention.processGroupPid === undefined
      || (Number.isSafeInteger(retention.processGroupPid) && retention.processGroupPid > 1))
  )
  const valid = typeof record.id === 'string'
    && typeof record.name === 'string'
    && Number.isInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.startedAt === 'string'
    && Number.isFinite(Date.parse(record.startedAt))
    && (record.processStartedAt === undefined || typeof record.processStartedAt === 'string')
    && (record.command === undefined || typeof record.command === 'string')
    && (record.repositoryRoot === undefined || typeof record.repositoryRoot === 'string')
    && retentionValid
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
    ...(record.retention === undefined ? {} : { retention: record.retention }),
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
  if (owner.retention !== undefined) {
    return true
  }
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
  listOwners,
  ownerIsLive,
  readOwner,
  readRetainedLineage,
  recoverRetained,
  retain,
  registryRoot,
  tryAcquire,
  withCurrentOwners,
} as const
