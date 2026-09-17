import { StudioDeviceTrust, type TaoStudioDeviceIdentity } from '@runtime/TR-studio-device-trust'
import { CLI, Errors, FS, HCI, Json, Platform, Time } from '@shared'
// `@shared/FS` has no exclusive-create helper, and creating the identity is the one place that needs
// one: two Studio processes starting together must not each believe they wrote the installation key.
import * as nodeFs from 'node:fs/promises'
import type { StudioTrustedDevice } from './StudioDeviceStatus'

const identityFileName = 'studio-identity.json'
const trustedDevicesFileName = 'trusted-devices.json'
const storeVersion = 1

type IdentityFile = TaoStudioDeviceIdentity & { version: typeof storeVersion }

type TrustedDevicesFile = { devices: readonly StudioTrustedDevice[]; version: typeof storeVersion }

type LockOwner = { pid: number; processStartedAt?: string; token: string }

type ProcessIdentity =
  | { evidence: 'alive'; startedAt?: string }
  | { evidence: 'gone' }
  | { evidence: 'unknown' }

type FileIdentity = { dev: number; ino: number; mtimeMs: number; size: number; type: 'directory' | 'file' | 'other' }
type FileClaimObservation = { identity: FileIdentity; owner?: LockOwner }
type LegacyLockObservation = FileClaimObservation

const legacyLockDirectoryName = '.studio-device-trust.lock'
const lockFileName = '.studio-device-trust-v2.lock'
const lockPollMs = 20
const lockTimeoutMs = 10_000
const incompleteLockGraceMs = 2_000
let currentProcessIdentity: Promise<ProcessIdentity> | undefined

/**
 * StudioDeviceTrustStore keeps one Studio installation's Ed25519 identity and the devices a person
 * confirmed, as JSON under the Studio user state root. Malformed files are ignored rather than fatal:
 * a broken identity regenerates and a broken device list starts empty, because trust is only ever
 * re-established by comparing codes on two screens. Writes are serialized and land atomically.
 *
 * The state root is shared by every Studio process on the machine, so neither file is this process's
 * to own. The identity is created with an exclusive open and the loser of that race adopts the
 * winner's key rather than overwriting it — two identities under one root would mean a phone paired
 * with one Studio being unrecognized by the other. The device list is re-read inside each write and
 * merged by `devicePublicKey`: this process is authoritative only for the keys its own operation
 * touched, so a device another Studio paired survives, and one another Studio revoked is not
 * resurrected by this process's stale copy.
 */
export class StudioDeviceTrustStore {
  readonly #devices: StudioTrustedDevice[]
  readonly #devicesPath: string
  readonly #identity: TaoStudioDeviceIdentity
  readonly #lockPath: string
  #pending: Promise<void> = Promise.resolve()

  private constructor(
    identity: TaoStudioDeviceIdentity,
    devices: StudioTrustedDevice[],
    devicesPath: string,
    lockPath: string,
  ) {
    this.#identity = identity
    this.#devices = devices
    this.#devicesPath = devicesPath
    this.#lockPath = lockPath
  }

  /** open loads or creates the identity and device list under `root`. */
  static async open(root: string): Promise<StudioDeviceTrustStore> {
    const identityPath = FS.resolvePath(identityFileName, root)
    const devicesPath = FS.resolvePath(trustedDevicesFileName, root)
    const lockPath = FS.resolvePath(lockFileName, root)
    try {
      return await withStoreLock(
        lockPath,
        async () =>
          new StudioDeviceTrustStore(
            await openIdentity(identityPath),
            await readDevices(devicesPath),
            devicesPath,
            lockPath,
          ),
      )
    } catch (error) {
      if (Errors.isTaoError(error)) {
        throw error
      }
      Errors.throwHostEnvironment(
        `Tao Studio could not access its device trust store at ${FS.displayPath(root)}.`,
        { cause: error, details: { root } },
      )
    }
  }

  identity(): TaoStudioDeviceIdentity {
    return this.#identity
  }

  publicKey(): string {
    return this.#identity.publicKey
  }

  fingerprint(): string {
    return StudioDeviceTrust.fingerprint(this.#identity.publicKey)
  }

  trusted(): readonly StudioTrustedDevice[] {
    return this.#devices.map(device => ({ ...device, device: { ...device.device } }))
  }

  isTrusted(devicePublicKey: string): boolean {
    return this.#devices.some(device => device.devicePublicKey === devicePublicKey)
  }

  /** refresh adopts decisions made by another Studio process before an authentication decision. */
  async refresh(): Promise<void> {
    await this.#queue(async () => {
      await withStoreLock(this.#lockPath, async () => {
        this.#replace(await readDevices(this.#devicesPath))
      })
    })
  }

  /** trust records a device, replacing any record already held for its key, and persists the list. */
  async trust(record: StudioTrustedDevice): Promise<void> {
    if (!StudioDeviceTrust.validPublicKey(record.devicePublicKey)) {
      Errors.throwUserInput('A trusted device needs a valid public key.')
    }
    const stored: StudioTrustedDevice = {
      ...record,
      device: { ...record.device },
      fingerprint: StudioDeviceTrust.fingerprint(record.devicePublicKey),
    }
    await this.#save(record.devicePublicKey, stored)
  }

  /** revoke forgets a device; it resolves `false` when the key was not trusted. */
  async revoke(devicePublicKey: string): Promise<boolean> {
    return await this.#save(devicePublicKey, undefined)
  }

  /** touch records when a trusted device last completed a handshake. */
  async touch(devicePublicKey: string, lastSeenAt: string): Promise<boolean> {
    return await this.#queue(async () =>
      await withStoreLock(this.#lockPath, async () => {
        const devices = await readDevices(this.#devicesPath)
        const index = devices.findIndex(device => device.devicePublicKey === devicePublicKey)
        if (index < 0) {
          this.#replace(devices)
          return false
        }
        devices[index] = { ...devices[index]!, lastSeenAt }
        await writeDevices(this.#devicesPath, devices)
        this.#replace(devices)
        return true
      })
    )
  }

  /** flush resolves once every queued write has landed. */
  flush(): Promise<void> {
    return this.#pending
  }

  /**
   * Persists one decision, merged with whatever is on disk when the write runs. This process is
   * authoritative for `devicePublicKey` alone — `record` is the entry it decided on, `undefined` a
   * revocation — and every other key is taken from the file, so a device a second Studio paired
   * survives and one it revoked is not resurrected. The decision is captured here rather than read
   * back from the list at write time, because writes are queued and an earlier merge may already
   * have replaced the list this one would have read.
   */
  #save(devicePublicKey: string, record: StudioTrustedDevice | undefined): Promise<boolean> {
    return this.#queue(async () =>
      await withStoreLock(this.#lockPath, async () => {
        const current = await readDevices(this.#devicesPath)
        const existed = current.some(device => device.devicePublicKey === devicePublicKey)
        const merged = current.filter(device => device.devicePublicKey !== devicePublicKey)
        if (record !== undefined) {
          const priorIndex = current.findIndex(device => device.devicePublicKey === devicePublicKey)
          if (priorIndex < 0) {
            merged.push(record)
          } else {
            merged.splice(priorIndex, 0, record)
          }
        }
        await writeDevices(this.#devicesPath, merged)
        this.#replace(merged)
        return record === undefined ? existed : true
      })
    )
  }

  #queue<T>(work: () => Promise<T>): Promise<T> {
    const run = async () => {
      return await work()
    }
    const result = this.#pending.then(run, run)
    this.#pending = result.then(() => undefined, () => undefined)
    return result
  }

  #replace(devices: readonly StudioTrustedDevice[]): void {
    this.#devices.splice(0, this.#devices.length, ...devices)
  }
}

async function writeDevices(path: string, devices: readonly StudioTrustedDevice[]): Promise<void> {
  await writeAtomically(path, { devices, version: storeVersion } satisfies TrustedDevicesFile)
}

/**
 * Loads the installation identity, creating it only if nobody else has. The create is an exclusive
 * open: when a second Studio process wins that race this one adopts the key it wrote, because two
 * identities under one state root would make every device paired with the loser unrecognizable. A
 * file that exists but does not parse is not a race — it is the corruption case — and is replaced.
 */
async function openIdentity(path: string): Promise<TaoStudioDeviceIdentity> {
  const existing = await readIdentity(path)
  if (existing !== undefined) {
    return existing
  }
  const identity = StudioDeviceTrust.generateIdentity()
  const file: IdentityFile = { ...identity, version: storeVersion }
  await FS.mkdir(FS.dirname(path))
  try {
    const handle = await nodeFs.open(path, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    return identity
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') {
      throw error
    }
    const adopted = await readIdentity(path)
    if (adopted !== undefined) {
      return adopted
    }
    await writeAtomically(path, file)
    return identity
  }
}

async function readIdentity(path: string): Promise<TaoStudioDeviceIdentity | undefined> {
  try {
    if (!await FS.isFile(path)) {
      return undefined
    }
    const value = await FS.readJson(path)
    if (
      !Json.isRecord(value)
      || value['version'] !== storeVersion
      || typeof value['publicKey'] !== 'string'
      || typeof value['secretKey'] !== 'string'
      || !StudioDeviceTrust.validPublicKey(value['publicKey'])
    ) {
      return undefined
    }
    const identity: TaoStudioDeviceIdentity = { publicKey: value['publicKey'], secretKey: value['secretKey'] }
    return StudioDeviceTrust.publicKeyOf(identity) === identity.publicKey ? identity : undefined
  } catch {
    return undefined
  }
}

async function readDevices(path: string): Promise<StudioTrustedDevice[]> {
  try {
    if (!await FS.isFile(path)) {
      return []
    }
    const value = await FS.readJson(path)
    if (!Json.isRecord(value) || value['version'] !== storeVersion || !Array.isArray(value['devices'])) {
      return []
    }
    const devices: StudioTrustedDevice[] = []
    for (const candidate of value['devices']) {
      const device = parseTrustedDevice(candidate)
      if (device !== undefined && !devices.some(known => known.devicePublicKey === device.devicePublicKey)) {
        devices.push(device)
      }
    }
    return devices
  } catch {
    return []
  }
}

/**
 * Serializes identity and trust decisions across Studio processes. The mutex is one exclusively
 * created file, not a directory: managed macOS hosts may allow file unlink/rename while denying
 * directory removal inside a checkout. A file rename remains the stale-ownership transition, so
 * only one contender can retire an abandoned lock without touching a replacement lock.
 */
async function withStoreLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  await FS.mkdir(FS.dirname(lockPath))
  const token = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const ownIdentity = await (currentProcessIdentity ??= inspectProcessIdentity(Platform.runtimeProcess.pid))
  const owner: LockOwner = {
    pid: Platform.runtimeProcess.pid,
    ...(ownIdentity.evidence === 'alive' && ownIdentity.startedAt !== undefined
      ? { processStartedAt: ownIdentity.startedAt }
      : {}),
    token,
  }
  const deadline = Time.nowMs() + lockTimeoutMs
  while (true) {
    if (await publishOwnerFileClaim(lockPath, owner)) {
      break
    }
    const observation = await observeFileClaim(lockPath)
    if (observation === undefined) {
      // No lock file but a failed claim means a reclaim guard is present, or the lock just changed.
      await assertReclaimGuardIsNotStale(lockPath)
      if (Time.nowMs() >= deadline) {
        Errors.throwHostEnvironment('Timed out waiting for another Tao Studio process to update device trust.')
      }
      await Time.sleep(lockPollMs)
      continue
    }
    const observedOwner = observation.owner
    const age = await lockAgeMs(lockPath)
    if (observedOwner !== undefined && await lockOwnerIsLive(observedOwner)) {
      if (Time.nowMs() >= deadline) {
        Errors.throwHostEnvironment('Timed out waiting for another Tao Studio process to update device trust.')
      }
      await Time.sleep(lockPollMs)
      continue
    }
    // Atomic publication means production never exposes an ownerless live claim. The grace period
    // remains for a file left by an older build or an interrupted external write.
    if (observedOwner === undefined && age < incompleteLockGraceMs) {
      await Time.sleep(lockPollMs)
      continue
    }
    if (Time.nowMs() >= deadline) {
      Errors.throwHostEnvironment('Timed out reclaiming an abandoned Tao Studio device-trust lock.')
    }
    await reclaimFileClaim(lockPath, observation, owner)
  }

  let releaseLegacyBarrier: (() => Promise<void>) | undefined
  let primaryError: unknown
  try {
    releaseLegacyBarrier = await acquireLegacyBarrier(
      FS.resolvePath(legacyLockDirectoryName, FS.dirname(lockPath)),
      owner,
      deadline,
    )
    return await work()
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    let cleanupError: unknown
    try {
      await releaseLegacyBarrier?.()
    } catch (error) {
      cleanupError = error
    }
    const observedOwner = await readLockOwner(lockPath)
    if (observedOwner?.token === token) {
      try {
        await nodeFs.unlink(lockPath)
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (cleanupError !== undefined) {
      if (primaryError === undefined) {
        throw cleanupError
      }
      HCI.logProcessError(
        'studio-device',
        `Device trust cleanup also failed: ${Errors.formatForLog(cleanupError)}`,
      )
    }
  }
}

/** Publishes a complete owner in one namespace operation; observers never see a live empty claim. */
async function publishOwnerFileClaim(
  lockPath: string,
  owner: LockOwner,
  beforePublish: (candidatePath: string) => Promise<void> = async () => {},
): Promise<boolean> {
  if (await FS.exists(reclaimGuardPath(lockPath))) {
    return false
  }
  return await publishOwnerFileClaimRaw(lockPath, owner, beforePublish)
}

async function publishOwnerFileClaimRaw(
  lockPath: string,
  owner: LockOwner,
  beforePublish: (candidatePath: string) => Promise<void> = async () => {},
): Promise<boolean> {
  const candidatePath = `${lockPath}.candidate-${owner.token}-${Platform.randomUUID()}`
  const handle = await nodeFs.open(candidatePath, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    await beforePublish(candidatePath)
    try {
      await nodeFs.link(candidatePath, lockPath)
      return true
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        return false
      }
      throw error
    }
  } finally {
    await nodeFs.unlink(candidatePath).catch(() => {})
  }
}

async function reclaimFileClaim(
  lockPath: string,
  observation: FileClaimObservation,
  claimant: LockOwner,
  afterGuard: () => Promise<void> = async () => {},
): Promise<void> {
  const guardPath = reclaimGuardPath(lockPath)
  if (!await publishOwnerFileClaimRaw(guardPath, claimant)) {
    await assertReclaimGuardIsNotStale(lockPath)
    await Time.sleep(lockPollMs)
    return
  }
  let primaryError: unknown
  try {
    await afterGuard()
    const current = await observeFileClaim(lockPath)
    if (current === undefined || !sameFileClaim(current, observation)) {
      return
    }
    if (current.identity.type !== 'file') {
      Errors.throwHostEnvironment(
        `The device-trust lock at ${FS.displayPath(lockPath)} is not a regular file. `
          + 'Close Tao Studio, move that path aside, and retry.',
      )
    }
    const tombstone = `${lockPath}.reclaim-${claimant.token}-${Platform.randomUUID()}`
    await nodeFs.rename(lockPath, tombstone)
    const moved = await fileIdentity(tombstone)
    if (moved === undefined || !sameFileIdentity(moved, observation.identity)) {
      await restoreAfterChangedClaim(tombstone, lockPath, moved)
      Errors.throwHostEnvironment('The Tao Studio device-trust lock changed while stale ownership was reclaimed.')
    }
    await nodeFs.unlink(tombstone)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      const guardOwner = await readLockOwner(guardPath)
      if (guardOwner?.token === claimant.token) {
        await nodeFs.unlink(guardPath)
      }
    } catch (cleanupError) {
      if (primaryError === undefined) {
        throw cleanupError
      }
      HCI.logProcessError(
        'studio-device',
        `Device-trust reclaim cleanup also failed: ${Errors.formatForLog(cleanupError)}`,
      )
    }
  }
}

function reclaimGuardPath(lockPath: string): string {
  return `${lockPath}.reclaim-guard`
}

/**
 * A guard is published atomically with its owner, so a guard whose owner has stopped is abandoned.
 * It blocks every new claim, so it must fail loudly rather than leave `open` polling forever. A guard
 * that vanished between the failed claim and this read is simply retried.
 */
async function assertReclaimGuardIsNotStale(lockPath: string): Promise<void> {
  const guardPath = reclaimGuardPath(lockPath)
  const guardOwner = await readLockOwner(guardPath)
  if (guardOwner === undefined || await lockOwnerIsLive(guardOwner)) {
    return
  }
  Errors.throwHostEnvironment(
    `The device-trust reclaim guard at ${FS.displayPath(guardPath)} is stale. `
      + 'Close Tao Studio, remove that one file, and retry.',
  )
}

async function observeFileClaim(path: string): Promise<FileClaimObservation | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await fileIdentity(path)
    if (before === undefined) {
      return undefined
    }
    const owner = await readLockOwner(path)
    const after = await fileIdentity(path)
    if (after !== undefined && sameFileIdentity(before, after)) {
      return { identity: after, ...(owner === undefined ? {} : { owner }) }
    }
  }
  return undefined
}

async function fileIdentity(path: string): Promise<FileIdentity | undefined> {
  try {
    const stat = await nodeFs.lstat(path)
    return {
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return sameNodeIdentity(left, right)
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size
}

function sameNodeIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.type === right.type
}

function sameFileClaim(left: FileClaimObservation, right: FileClaimObservation): boolean {
  return sameFileIdentity(left.identity, right.identity)
    && left.owner?.token === right.owner?.token
    && left.owner?.pid === right.owner?.pid
    && left.owner?.processStartedAt === right.owner?.processStartedAt
}

async function restoreMovedNode(
  tombstone: string,
  lockPath: string,
  identity: FileIdentity | undefined,
): Promise<void> {
  try {
    if (identity?.type === 'other') {
      const target = await nodeFs.readlink(tombstone)
      await nodeFs.symlink(target, lockPath, 'dir')
    } else {
      await nodeFs.link(tombstone, lockPath)
    }
    await nodeFs.unlink(tombstone)
  } catch (error) {
    Errors.throwHostEnvironment(
      `Tao Studio could not safely restore a concurrently changed device-trust lock at ${FS.displayPath(lockPath)}.`,
      { cause: error },
    )
  }
}

async function restoreAfterChangedClaim(
  tombstone: string,
  lockPath: string,
  identity: FileIdentity | undefined,
): Promise<void> {
  try {
    await restoreMovedNode(tombstone, lockPath, identity)
  } catch (cleanupError) {
    HCI.logProcessError(
      'studio-device',
      `Changed device-trust claim cleanup also failed: ${Errors.formatForLog(cleanupError)}`,
    )
  }
}

/**
 * Blocks a still-running directory-lock build while this file-lock build owns the store. A symlink
 * to a complete owner directory is compatible with the old reader and can be removed as a file on
 * managed hosts. A protected stale legacy directory is itself a barrier to old builds; after its
 * recorded owner is proven dead, leaving it in place is safer than weakening exclusion.
 */
async function acquireLegacyBarrier(
  legacyPath: string,
  owner: LockOwner,
  deadline: number,
): Promise<() => Promise<void>> {
  const ownerRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-trust-legacy-owner-', FS.tmpdir()))
  let installed = false
  try {
    await FS.writeJson(FS.resolvePath('owner.json', ownerRoot), owner, { mode: 0o600 })
    while (true) {
      try {
        await nodeFs.symlink(ownerRoot, legacyPath, 'dir')
        installed = true
        return async () => {
          let cleanupError: unknown
          try {
            if (await nodeFs.readlink(legacyPath) === ownerRoot) {
              await nodeFs.unlink(legacyPath)
            }
          } catch (error) {
            if (!['EINVAL', 'ENOENT'].includes(errorCode(error) ?? '')) {
              cleanupError = error
            }
          }
          try {
            await FS.remove(ownerRoot)
          } catch (error) {
            cleanupError ??= error
          }
          if (cleanupError !== undefined) {
            throw cleanupError
          }
        }
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          throw error
        }
      }

      const observation = await observeLegacyLock(legacyPath)
      if (observation === undefined) {
        continue
      }
      const observedOwner = observation.owner
      const age = await lockAgeMs(legacyPath)
      if (observedOwner !== undefined && await lockOwnerIsLive(observedOwner)) {
        if (Time.nowMs() >= deadline) {
          Errors.throwHostEnvironment('Timed out waiting for an older Tao Studio process to update device trust.')
        }
        await Time.sleep(lockPollMs)
        continue
      }
      if (observedOwner === undefined && age < incompleteLockGraceMs) {
        await Time.sleep(lockPollMs)
        continue
      }
      if (observedOwner === undefined) {
        Errors.throwHostEnvironment(
          `The legacy Tao Studio device-trust lock at ${FS.displayPath(legacyPath)} has no valid owner. `
            + 'Close Tao Studio, move that one lock path aside from an ordinary Terminal, and retry.',
        )
      }

      if (observation.identity.type === 'other') {
        await retireLegacyLinkIfUnchanged(legacyPath, observation, owner.token)
        continue
      }
      if (observation.identity.type !== 'directory') {
        Errors.throwHostEnvironment(
          `The legacy Tao Studio device-trust lock at ${FS.displayPath(legacyPath)} is not a recoverable directory. `
            + 'Close Tao Studio, move that one lock path aside, and retry.',
        )
      }
      // An older build can already have observed this owner as stale and be paused immediately
      // before recursively renaming the directory. Replacing only owner.json cannot revoke that
      // in-flight decision, so proceeding would make both builds believe they own the store. The
      // safe managed-host response is bounded repair rather than an unsafe file-only takeover.
      Errors.throwHostEnvironment(
        `The legacy Tao Studio device-trust lock at ${FS.displayPath(legacyPath)} belongs to a stopped process, `
          + 'but it cannot be reclaimed safely across Studio versions. Close Tao Studio, move that one lock '
          + 'path aside from an ordinary Terminal, and retry.',
      )
    }
  } catch (error) {
    if (!installed) {
      await FS.remove(ownerRoot).catch(() => {})
    }
    throw error
  }
}

async function observeLegacyLock(path: string): Promise<LegacyLockObservation | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await fileIdentity(path)
    if (before === undefined) {
      return undefined
    }
    const ownerPath = FS.resolvePath('owner.json', path)
    const ownerBytes = await FS.readFile(ownerPath).catch(() => undefined)
    const owner = ownerBytes === undefined ? undefined : parseLockOwnerBytes(ownerBytes)
    const after = await fileIdentity(path)
    if (after !== undefined && sameFileIdentity(before, after)) {
      return { identity: after, ...(owner === undefined ? {} : { owner }) }
    }
  }
  return undefined
}

async function retireLegacyLinkIfUnchanged(
  legacyPath: string,
  observation: LegacyLockObservation,
  token: string,
  afterObservation: () => Promise<void> = async () => {},
): Promise<void> {
  await afterObservation()
  const current = await observeLegacyLock(legacyPath)
  if (current === undefined || !sameFileClaim(current, observation)) {
    return
  }
  const tombstone = `${legacyPath}.reclaim-${token}-${Platform.randomUUID()}`
  await nodeFs.rename(legacyPath, tombstone)
  const moved = await fileIdentity(tombstone)
  if (moved === undefined || !sameFileIdentity(moved, observation.identity)) {
    await restoreAfterChangedClaim(tombstone, legacyPath, moved)
    Errors.throwHostEnvironment('The legacy Tao Studio device-trust barrier changed while it was reclaimed.')
  }
  await nodeFs.unlink(tombstone)
}

/** Narrow seams for concurrency mutation tests; production uses the same functions without hooks. */
export const StudioDeviceTrustStoreTesting = {
  lockOwnerIsLive,
  observeFileClaim,
  observeLegacyLock,
  publishOwnerFileClaim,
  reclaimFileClaim,
  retireLegacyLinkIfUnchanged,
}

async function readLockOwner(path: string): Promise<LockOwner | undefined> {
  try {
    return parseLockOwnerBytes(await nodeFs.readFile(path))
  } catch {
    return undefined
  }
}

function parseLockOwnerBytes(bytes: Uint8Array): LockOwner | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
    return Json.isRecord(value)
        && Number.isInteger(value['pid'])
        && (value['pid'] as number) > 0
        && (value['processStartedAt'] === undefined || typeof value['processStartedAt'] === 'string')
        && typeof value['token'] === 'string'
      ? {
        pid: value['pid'] as number,
        ...(value['processStartedAt'] === undefined ? {} : { processStartedAt: value['processStartedAt'] as string }),
        token: value['token'],
      }
      : undefined
  } catch {
    return undefined
  }
}

async function lockOwnerIsLive(
  owner: LockOwner,
  inspect: (pid: number) => Promise<ProcessIdentity> = inspectProcessIdentity,
): Promise<boolean> {
  const identity = await inspect(owner.pid)
  if (identity.evidence === 'gone') {
    return false
  }
  return !(
    identity.evidence === 'alive'
    && owner.processStartedAt !== undefined
    && identity.startedAt !== undefined
    && owner.processStartedAt !== identity.startedAt
  )
}

async function inspectProcessIdentity(pid: number): Promise<ProcessIdentity> {
  try {
    // `lstart` follows locale and time zone; pin both so every process compares the same spelling.
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
    // An unreadable process table is uncertainty, never permission to steal another process's lock.
  }
  return Platform.processIsAlive(pid) ? { evidence: 'unknown' } : { evidence: 'gone' }
}

async function lockAgeMs(path: string): Promise<number> {
  try {
    // Filesystem mtimes are Unix-epoch timestamps. `Time.nowMs()` is deliberately monotonic and
    // process-relative, so comparing it with `mtimeMs` clamps every real lock age to zero and makes
    // an ownerless lock unreclaimable forever.
    return Math.max(0, Date.now() - (await nodeFs.stat(path)).mtimeMs)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function parseTrustedDevice(value: unknown): StudioTrustedDevice | undefined {
  if (
    !Json.isRecord(value)
    || typeof value['devicePublicKey'] !== 'string'
    || !StudioDeviceTrust.validPublicKey(value['devicePublicKey'])
    || typeof value['pairedAt'] !== 'string'
    || Number.isNaN(Date.parse(value['pairedAt']))
    || (value['lastSeenAt'] !== undefined && typeof value['lastSeenAt'] !== 'string')
  ) {
    return undefined
  }
  const device = value['device']
  if (
    !Json.isRecord(device)
    || typeof device['name'] !== 'string'
    || device['name'].trim() === ''
    || typeof device['model'] !== 'string'
    || typeof device['os'] !== 'string'
    || (device['appVersion'] !== undefined && typeof device['appVersion'] !== 'string')
  ) {
    return undefined
  }
  return {
    device: {
      ...(device['appVersion'] === undefined ? {} : { appVersion: device['appVersion'] }),
      model: device['model'],
      name: device['name'],
      os: device['os'],
    },
    devicePublicKey: value['devicePublicKey'],
    fingerprint: StudioDeviceTrust.fingerprint(value['devicePublicKey']),
    ...(value['lastSeenAt'] === undefined ? {} : { lastSeenAt: value['lastSeenAt'] }),
    pairedAt: value['pairedAt'],
  }
}

/** writeAtomically lands a complete file or none: a reader never sees a partial JSON document. */
async function writeAtomically(path: string, content: unknown): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
  try {
    // A fresh temporary file takes the owner-only mode and the rename preserves it.
    await FS.writeJson(temporaryPath, content, { mode: 0o600 })
    await FS.move(temporaryPath, path)
  } finally {
    await FS.remove(temporaryPath)
  }
}
