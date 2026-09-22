import type { TaoStudioDeviceDescription } from '@runtime/TR-studio-device-protocol'

/** One trusted device as the gateway remembers it. */
export type StudioTrustedDevice = {
  device: TaoStudioDeviceDescription
  devicePublicKey: string
  fingerprint: string
  lastSeenAt?: string
  pairedAt: string
}

export type StudioDeviceConnectionState =
  | 'connected'
  | 'handshaking'
  | 'pairing'

/** The live connection the workbench shows: no paths, no keys beyond the public fingerprint. */
export type StudioDeviceConnection = {
  /** The compile revision the device last acknowledged as applied. */
  appliedRevision?: number
  cellId?: string
  device: TaoStudioDeviceDescription
  fingerprint: string
  lastError?: string
  lastReport?: { level: 'error' | 'info'; message: string }
  remoteAddress?: string
  scenarioLabel?: string
  state: StudioDeviceConnectionState
  transport: 'lan'
}

export type StudioDevicePairingStatus = {
  expiresAt?: string
  open: boolean
  /** The device currently waiting for a person to compare codes and confirm. */
  pending?: {
    code: string
    device: TaoStudioDeviceDescription
    devicePublicKey: string
    fingerprint: string
  }
}

/**
 * What a device last asked Studio to select, carried on the status snapshot rather than as its own
 * event so it reaches the workbench over the subscription that already exists.
 *
 * `sequence` is what makes a snapshot usable for something that is really an event: the same status
 * is re-sent whenever anything else about the connection changes, and re-opening the editor on every
 * one of those would fight the person's cursor. The workbench acts only when the sequence advances.
 */
export type StudioDeviceSourceSelection = {
  end: number
  ownerName?: string
  sequence: number
  sourcePath: string
  /** The version the device rendered; the workbench refuses to select a range measured against older text. */
  sourceVersion: string
  start: number
}

export type StudioDeviceLog = {
  deviceName: string
  level: 'debug' | 'error' | 'info' | 'warn'
  message: string
  sequence: number
  timestamp: number
}

/** StudioDeviceStatus is the snapshot the workbench renders and the `device-state` event carries. */
export type StudioDeviceStatus = {
  connection?: StudioDeviceConnection
  /** Recent trusted device lines, bounded by the gateway and scoped to this Studio session. */
  logs?: readonly StudioDeviceLog[]
  gateway: {
    /** The gateway listens on every interface; these are the candidate hosts a phone may reach. */
    hosts: readonly string[]
    port: number
    studioFingerprint: string
  }
  pairing: StudioDevicePairingStatus
  /** The render a device tapped, for the workbench to open and select in the editor. */
  selection?: StudioDeviceSourceSelection
  sessionId: string
  trusted: readonly StudioTrustedDevice[]
}

export type StudioDeviceStateEvent = {
  channel: 'tao-studio'
  protocolVersion: 1
  status: StudioDeviceStatus
  type: 'device-state'
}
