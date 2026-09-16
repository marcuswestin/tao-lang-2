import { StudioDeviceTrust, type TaoStudioDeviceIdentity } from '@runtime/TR-studio-device-trust'
import { Errors, FS, Json, Platform, Time } from '@shared'
// `@shared/FS` has no exclusive-create helper, and creating the identity is the one place that needs
// one: two Studio processes starting together must not each believe they wrote the installation key.
import * as nodeFs from 'node:fs/promises'
import type { StudioTrustedDevice } from './StudioDeviceStatus'

const identityFileName = 'studio-identity.json'
const trustedDevicesFileName = 'trusted-devices.json'
const storeVersion = 1

type IdentityFile = TaoStudioDeviceIdentity & { version: typeof storeVersion }

type TrustedDevicesFile = { devices: readonly StudioTrustedDevice[]; version: typeof storeVersion }

type LockOwner = { pid: number; token: string }

const lockDirectoryName = '.studio-device-trust.lock'
const lockPollMs = 20
const lockTimeoutMs = 10_000
const incompleteLockGraceMs = 2_000

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
    const lockPath = FS.resolvePath(lockDirectoryName, root)
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
 * Serializes identity and trust decisions across Studio processes. A directory rename is the stale
 * ownership transition: only one contender can move the old directory, and it removes that private
 * tombstone rather than a replacement lock a new owner may already have created.
 */
async function withStoreLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  await FS.mkdir(FS.dirname(lockPath))
  const token = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const ownerPath = FS.resolvePath('owner.json', lockPath)
  const deadline = Time.nowMs() + lockTimeoutMs
  while (true) {
    try {
      await nodeFs.mkdir(lockPath)
      await nodeFs.writeFile(
        ownerPath,
        `${JSON.stringify({ pid: Platform.runtimeProcess.pid, token } satisfies LockOwner)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error
      }
      const owner = await readLockOwner(ownerPath)
      const age = await lockAgeMs(lockPath)
      if (owner !== undefined && Platform.processIsAlive(owner.pid)) {
        if (Time.nowMs() >= deadline) {
          Errors.throwHostEnvironment('Timed out waiting for another Tao Studio process to update device trust.')
        }
        await Time.sleep(lockPollMs)
        continue
      }
      // A creator may have made the directory but not yet written owner.json. Give that tiny window
      // a grace period; after it, a missing owner is a crashed acquisition and can be reclaimed.
      if (owner === undefined && age < incompleteLockGraceMs) {
        await Time.sleep(lockPollMs)
        continue
      }
      const tombstone = `${lockPath}.reclaim-${token}-${Platform.randomUUID()}`
      try {
        await nodeFs.rename(lockPath, tombstone)
        await nodeFs.rm(tombstone, { force: true, recursive: true })
      } catch (reclaimError) {
        const code = errorCode(reclaimError)
        if (code !== 'ENOENT' && code !== 'EEXIST') {
          throw reclaimError
        }
      }
    }
  }
  try {
    return await work()
  } finally {
    const owner = await readLockOwner(ownerPath)
    if (owner?.token === token) {
      await nodeFs.rm(lockPath, { force: true, recursive: true })
    }
  }
}

async function readLockOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const value: unknown = JSON.parse(await nodeFs.readFile(path, 'utf8'))
    return Json.isRecord(value)
        && Number.isInteger(value['pid'])
        && (value['pid'] as number) > 0
        && typeof value['token'] === 'string'
      ? { pid: value['pid'] as number, token: value['token'] }
      : undefined
  } catch {
    return undefined
  }
}

async function lockAgeMs(path: string): Promise<number> {
  try {
    return Math.max(0, Time.nowMs() - (await nodeFs.stat(path)).mtimeMs)
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
