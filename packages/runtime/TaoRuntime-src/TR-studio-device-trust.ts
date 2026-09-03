/**
 * Trust primitives for tao-studio-device-v1, shared by the Studio gateway and the device host.
 * Every operation composes audited `@noble` primitives; nothing here is a new construction. The
 * threat model and key schedule are in `Docs/Roadmap/Tao Studio companion app/Slice 1 - Device
 * protocol and trust.md`. Bytes cross the wire as base64 strings and this module owns that codec
 * because Hermes has no `Buffer`.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { TaoStudioDeviceProtocol, type TaoStudioDeviceSealedFrame } from './TR-studio-device-protocol'

export type TaoStudioDeviceRole = 'device' | 'studio'

/** A long-term Ed25519 identity for one Studio installation or one device. */
export type TaoStudioDeviceIdentity = {
  publicKey: string
  secretKey: string
}

export type TaoStudioDeviceEphemeral = {
  publicKey: string
  secretKey: Uint8Array
}

export type TaoStudioDeviceTranscriptInput = {
  deviceEphemeralPublicKey: string
  deviceNonce: string
  devicePublicKey: string
  sessionId: string
  studioEphemeralPublicKey: string
  studioNonce: string
  studioPublicKey: string
}

/** Direction-bound keys plus the short authentication code both screens compare. */
export type TaoStudioDeviceSessionKeys = {
  code: string
  receiveKey: Uint8Array
  sendKey: Uint8Array
}

export type TaoStudioDeviceTrustFailure = 'bad-frame' | 'bad-key' | 'replayed-frame' | 'unsealed'

export class StudioDeviceTrustError extends Error {
  constructor(readonly code: TaoStudioDeviceTrustFailure, message: string) {
    super(message)
    this.name = 'StudioDeviceTrustError'
  }
}

const keyBytes = 32
const nonceBytes = 16
const frameNonceBytes = 24
const codeDigits = 6
const labels = {
  device: 'device',
  deviceToStudio: 'device-to-studio',
  sas: 'sas',
  studio: 'studio',
  studioToDevice: 'studio-to-device',
} as const

export const StudioDeviceTrust = {
  base64Decode,
  base64Encode,
  /** Splits a six-digit code as "123 456" for display; the wire and comparison keep the digits. */
  formatCode(code: string): string {
    return code.length === codeDigits ? `${code.slice(0, 3)} ${code.slice(3)}` : code
  },
  /** A stable, human-comparable digest of a public key: 16 hex characters in groups of four. */
  fingerprint(publicKey: string): string {
    const digest = sha256(decodeKey(publicKey, 'public key'))
    const hex = Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')
    return hex.match(/.{4}/g)?.join(' ') ?? hex
  },
  generateEphemeral(): TaoStudioDeviceEphemeral {
    const secretKey = x25519.utils.randomSecretKey()
    return { publicKey: base64Encode(x25519.getPublicKey(secretKey)), secretKey }
  },
  generateIdentity(): TaoStudioDeviceIdentity {
    const secretKey = ed25519.utils.randomSecretKey()
    return { publicKey: base64Encode(ed25519.getPublicKey(secretKey)), secretKey: base64Encode(secretKey) }
  },
  generateNonce(): string {
    return base64Encode(randomBytes(nonceBytes))
  },
  /** Derives the direction keys and short code for one side of a completed handshake. */
  deriveSession(
    role: TaoStudioDeviceRole,
    ephemeralSecretKey: Uint8Array,
    peerEphemeralPublicKey: string,
    transcript: Uint8Array,
  ): TaoStudioDeviceSessionKeys {
    const shared = x25519.getSharedSecret(ephemeralSecretKey, decodeKey(peerEphemeralPublicKey, 'ephemeral key'))
    const derive = (label: string): Uint8Array =>
      hkdf(sha256, shared, transcript, utf8(`${TaoStudioDeviceProtocol.name} ${label}`), keyBytes)
    const deviceToStudio = derive(labels.deviceToStudio)
    const studioToDevice = derive(labels.studioToDevice)
    const sas = derive(labels.sas)
    const number = ((sas[0]! << 24) >>> 0) + (sas[1]! << 16) + (sas[2]! << 8) + sas[3]!
    return {
      code: String(number % 1_000_000).padStart(codeDigits, '0'),
      receiveKey: role === 'studio' ? deviceToStudio : studioToDevice,
      sendKey: role === 'studio' ? studioToDevice : deviceToStudio,
    }
  },
  /** Opens one sealed frame; the sequence must be exactly the next one expected. */
  open(keys: TaoStudioDeviceSessionKeys, expectedSeq: number, frame: TaoStudioDeviceSealedFrame): unknown {
    if (frame.seq !== expectedSeq) {
      throw new StudioDeviceTrustError(
        'replayed-frame',
        `Expected sealed frame ${expectedSeq} but received ${frame.seq}.`,
      )
    }
    let plaintext: Uint8Array
    try {
      plaintext = xchacha20poly1305(keys.receiveKey, base64Decode(frame.nonce), frameAad(frame.seq))
        .decrypt(base64Decode(frame.box))
    } catch {
      throw new StudioDeviceTrustError('unsealed', `Sealed frame ${frame.seq} failed authentication.`)
    }
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
    } catch {
      throw new StudioDeviceTrustError('bad-frame', `Sealed frame ${frame.seq} did not carry JSON.`)
    }
  },
  /**
   * A short, deterministic, one-way token for a value that must reach a device but never carry it
   * back out — Studio's scenario and cell identifiers embed the project's absolute source path. The
   * same input always yields the same token, so a device echoing one back is still matchable against
   * the current manifest; there is no way back from the token to the value it was made from.
   */
  opaqueId(value: string): string {
    const digest = sha256(utf8(value))
    return Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')
  },
  publicKeyOf(identity: TaoStudioDeviceIdentity): string {
    return base64Encode(ed25519.getPublicKey(decodeKey(identity.secretKey, 'secret key')))
  },
  seal(keys: TaoStudioDeviceSessionKeys, seq: number, message: unknown): TaoStudioDeviceSealedFrame {
    const nonce = randomBytes(frameNonceBytes)
    const box = xchacha20poly1305(keys.sendKey, nonce, frameAad(seq)).encrypt(utf8(JSON.stringify(message)))
    return { box: base64Encode(box), nonce: base64Encode(nonce), seq, type: 'sealed' }
  },
  sign(role: TaoStudioDeviceRole, transcript: Uint8Array, identity: TaoStudioDeviceIdentity): string {
    return base64Encode(ed25519.sign(signedBytes(role, transcript), decodeKey(identity.secretKey, 'secret key')))
  },
  /** The SHA-256 of every handshake field, each length-prefixed so no two inputs share bytes. */
  transcript(input: TaoStudioDeviceTranscriptInput): Uint8Array {
    const fields = [
      utf8(TaoStudioDeviceProtocol.name),
      utf8(input.sessionId),
      base64Decode(input.devicePublicKey),
      base64Decode(input.deviceEphemeralPublicKey),
      base64Decode(input.deviceNonce),
      base64Decode(input.studioPublicKey),
      base64Decode(input.studioEphemeralPublicKey),
      base64Decode(input.studioNonce),
    ]
    const total = fields.reduce((sum, field) => sum + 4 + field.length, 0)
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const field of fields) {
      bytes[offset] = (field.length >>> 24) & 0xff
      bytes[offset + 1] = (field.length >>> 16) & 0xff
      bytes[offset + 2] = (field.length >>> 8) & 0xff
      bytes[offset + 3] = field.length & 0xff
      bytes.set(field, offset + 4)
      offset += 4 + field.length
    }
    return sha256(bytes)
  },
  validNonce(value: string): boolean {
    try {
      return base64Decode(value).length === nonceBytes
    } catch {
      return false
    }
  },
  validPublicKey(value: string): boolean {
    try {
      return base64Decode(value).length === keyBytes
    } catch {
      return false
    }
  },
  verify(role: TaoStudioDeviceRole, transcript: Uint8Array, signature: string, publicKey: string): boolean {
    try {
      return ed25519.verify(base64Decode(signature), signedBytes(role, transcript), decodeKey(publicKey, 'public key'))
    } catch {
      return false
    }
  },
} as const

function signedBytes(role: TaoStudioDeviceRole, transcript: Uint8Array): Uint8Array {
  const label = utf8(role === 'studio' ? labels.studio : labels.device)
  const bytes = new Uint8Array(transcript.length + label.length)
  bytes.set(transcript, 0)
  bytes.set(label, transcript.length)
  return bytes
}

function frameAad(seq: number): Uint8Array {
  return utf8(`${TaoStudioDeviceProtocol.name}:${seq}`)
}

function decodeKey(value: string, what: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = base64Decode(value)
  } catch {
    throw new StudioDeviceTrustError('bad-key', `The ${what} is not valid base64.`)
  }
  if (bytes.length !== keyBytes) {
    throw new StudioDeviceTrustError('bad-key', `The ${what} must be ${keyBytes} bytes, not ${bytes.length}.`)
  }
  return bytes
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const base64Lookup = new Map(Array.from(base64Alphabet, (char, index) => [char, index] as const))

function base64Encode(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    output += base64Alphabet[(triple >>> 18) & 63]! + base64Alphabet[(triple >>> 12) & 63]!
    output += b === undefined ? '=' : base64Alphabet[(triple >>> 6) & 63]!
    output += c === undefined ? '=' : base64Alphabet[triple & 63]!
  }
  return output
}

function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) {
    throw new StudioDeviceTrustError('bad-frame', 'Expected base64 text.')
  }
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let offset = 0
  for (const char of clean) {
    buffer = (buffer << 6) | base64Lookup.get(char)!
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[offset++] = (buffer >>> bits) & 0xff
    }
  }
  return bytes
}
