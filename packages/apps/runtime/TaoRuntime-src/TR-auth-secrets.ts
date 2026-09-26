import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
import { NativeModules } from './TR-native-modules'
import { StudioDeviceTrust } from './TR-studio-device-trust'

/** AuthSecrets encrypts account checkpoints with a provider-owned key and bound account/resource. */
export const AuthSecrets = {
  Seal(keyHex: string, plaintext: string, associatedData: string): string {
    const key = accountKey(keyHex)
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
      NativeModules.required('Encrypted account data', 'react-native-get-random-values')
    }
    const nonce = globalThis.crypto.getRandomValues(new Uint8Array(24))
    try {
      const box = xchacha20poly1305(key, nonce, new TextEncoder().encode(associatedData))
        .encrypt(new TextEncoder().encode(plaintext))
      return JSON.stringify({
        version: 1,
        nonce: StudioDeviceTrust.base64Encode(nonce),
        box: StudioDeviceTrust.base64Encode(box),
      })
    } finally {
      key.fill(0)
    }
  },
  Open(keyHex: string, ciphertext: string, associatedData: string): string {
    const key = accountKey(keyHex)
    try {
      const envelope = JSON.parse(ciphertext) as { version?: unknown; nonce?: unknown; box?: unknown }
      RuntimeAssert.input(
        envelope.version === 1 && typeof envelope.nonce === 'string' && typeof envelope.box === 'string',
        'The encrypted account checkpoint has an unsupported format.',
      )
      const clear = xchacha20poly1305(
        key,
        StudioDeviceTrust.base64Decode(envelope.nonce),
        new TextEncoder().encode(associatedData),
      )
        .decrypt(StudioDeviceTrust.base64Decode(envelope.box))
      try {
        return new TextDecoder().decode(clear)
      } finally {
        clear.fill(0)
      }
    } catch {
      throw new UserInputError('The encrypted account checkpoint could not be opened for this account.')
    } finally {
      key.fill(0)
    }
  },
} as const

function accountKey(keyHex: string): Uint8Array {
  RuntimeAssert.input(/^[a-f0-9]{64}$/i.test(keyHex), 'The account encryption key must contain 32 bytes.')
  return Uint8Array.from(keyHex.match(/../g)!, byte => Number.parseInt(byte, 16))
}
