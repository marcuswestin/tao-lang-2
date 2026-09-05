import { StudioDeviceTrust, type TaoStudioDeviceIdentity } from '@runtime/TR-studio-device-trust'
import { Errors, FS, Json } from '@shared'
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
 */
export class StudioDeviceTrustStore {
  readonly #devices: StudioTrustedDevice[]
  readonly #devicesPath: string
  readonly #identity: TaoStudioDeviceIdentity
  #pending: Promise<void> = Promise.resolve()

  private constructor(identity: TaoStudioDeviceIdentity, devices: StudioTrustedDevice[], devicesPath: string) {
    this.#identity = identity
    this.#devices = devices
    this.#devicesPath = devicesPath
  }

  /** open loads or creates the identity and device list under `root`. */
  static async open(root: string): Promise<StudioDeviceTrustStore> {
    const identityPath = FS.resolvePath(identityFileName, root)
    const devicesPath = FS.resolvePath(trustedDevicesFileName, root)
    const existing = await readIdentity(identityPath)
    const identity = existing ?? StudioDeviceTrust.generateIdentity()
    if (existing === undefined) {
      await writeAtomically(identityPath, { ...identity, version: storeVersion } satisfies IdentityFile)
    }
    return new StudioDeviceTrustStore(identity, await readDevices(devicesPath), devicesPath)
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
    await this.#save()
  }

  /** revoke forgets a device; it resolves `false` when the key was not trusted. */
  async revoke(devicePublicKey: string): Promise<boolean> {
    const index = this.#devices.findIndex(device => device.devicePublicKey === devicePublicKey)
    if (index < 0) {
      return false
    }
    this.#devices.splice(index, 1)
    await this.#save()
    return true
  }

  /** touch records when a trusted device last completed a handshake. */
  async touch(devicePublicKey: string, lastSeenAt: string): Promise<boolean> {
    const index = this.#devices.findIndex(device => device.devicePublicKey === devicePublicKey)
    if (index < 0) {
      return false
    }
    this.#devices[index] = { ...this.#devices[index]!, lastSeenAt }
    await this.#save()
    return true
  }

  /** flush resolves once every queued write has landed. */
  flush(): Promise<void> {
    return this.#pending
  }

  #save(): Promise<void> {
    const snapshot: TrustedDevicesFile = { devices: this.trusted(), version: storeVersion }
    const write = async () => await writeAtomically(this.#devicesPath, snapshot)
    const saving = this.#pending.then(write, write)
    this.#pending = saving
    return saving
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
