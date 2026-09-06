import { StudioDeviceTrust, type TaoStudioDeviceIdentity } from '@runtime/TR-studio-device-trust'
import { Errors, FS, Json } from '@shared'
// `@shared/FS` has no exclusive-create helper, and creating the identity is the one place that needs
// one: two Studio processes starting together must not each believe they wrote the installation key.
import * as nodeFs from 'node:fs/promises'
import type { StudioTrustedDevice } from './StudioDeviceStatus'

const identityFileName = 'studio-identity.json'
const trustedDevicesFileName = 'trusted-devices.json'
const storeVersion = 1

type IdentityFile = TaoStudioDeviceIdentity & { version: typeof storeVersion }

type TrustedDevicesFile = { devices: readonly StudioTrustedDevice[]; version: typeof storeVersion }

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
  #pending: Promise<void> = Promise.resolve()
  /** Writes still queued; only the last one to land replaces the in-memory list with the merged file. */
  #queued = 0

  private constructor(identity: TaoStudioDeviceIdentity, devices: StudioTrustedDevice[], devicesPath: string) {
    this.#identity = identity
    this.#devices = devices
    this.#devicesPath = devicesPath
  }

  /** open loads or creates the identity and device list under `root`. */
  static async open(root: string): Promise<StudioDeviceTrustStore> {
    const identityPath = FS.resolvePath(identityFileName, root)
    const devicesPath = FS.resolvePath(trustedDevicesFileName, root)
    return new StudioDeviceTrustStore(await openIdentity(identityPath), await readDevices(devicesPath), devicesPath)
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
    const index = this.#devices.findIndex(device => device.devicePublicKey === record.devicePublicKey)
    if (index >= 0) {
      this.#devices[index] = stored
    } else {
      this.#devices.push(stored)
    }
    await this.#save(record.devicePublicKey, stored)
  }

  /** revoke forgets a device; it resolves `false` when the key was not trusted. */
  async revoke(devicePublicKey: string): Promise<boolean> {
    const index = this.#devices.findIndex(device => device.devicePublicKey === devicePublicKey)
    if (index < 0) {
      return false
    }
    this.#devices.splice(index, 1)
    await this.#save(devicePublicKey, undefined)
    return true
  }

  /** touch records when a trusted device last completed a handshake. */
  async touch(devicePublicKey: string, lastSeenAt: string): Promise<boolean> {
    const index = this.#devices.findIndex(device => device.devicePublicKey === devicePublicKey)
    if (index < 0) {
      return false
    }
    const touched = { ...this.#devices[index]!, lastSeenAt }
    this.#devices[index] = touched
    await this.#save(devicePublicKey, touched)
    return true
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
  #save(devicePublicKey: string, record: StudioTrustedDevice | undefined): Promise<void> {
    this.#queued += 1
    const write = async () => {
      const merged: StudioTrustedDevice[] = []
      // Disk order first, so a record this process only renamed keeps its place in the list.
      for (const device of await readDevices(this.#devicesPath)) {
        if (device.devicePublicKey !== devicePublicKey) {
          merged.push(device)
        } else if (record !== undefined) {
          merged.push(record)
        }
      }
      if (record !== undefined && !merged.some(device => device.devicePublicKey === devicePublicKey)) {
        merged.push(record)
      }
      try {
        await writeAtomically(
          this.#devicesPath,
          { devices: merged, version: storeVersion } satisfies TrustedDevicesFile,
        )
      } finally {
        this.#queued -= 1
      }
      // Only the last write in the queue adopts the merged list: an earlier one would drop the
      // records the still-queued mutations are holding optimistically in memory.
      if (this.#queued === 0) {
        this.#devices.splice(0, this.#devices.length, ...merged)
      }
    }
    const saving = this.#pending.then(write, write)
    this.#pending = saving
    return saving
  }
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
