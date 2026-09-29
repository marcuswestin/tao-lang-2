import { Errors } from '@shared'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { type Cipher, type SecretStore } from 'tao-cli-kit/secrets'
import { runSetupClerk } from '../dev-cli-src/clerk/SetupClerkCommand'
import { prepareSecretBatch } from '../dev-cli-src/secrets/SecretsCommand'

const publishableKey = 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk'

async function fixture() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), use: 'sig' }
  const events: string[] = []
  const output: string[] = []
  const saved: Record<string, string>[] = []
  const inputs = [publishableKey, 'sk_test_private']
  const environment: NonNullable<Parameters<typeof runSetupClerk>[1]> = {
    interactive: () => true,
    write: text => {
      output.push(text)
    },
    waitKey: async () => {
      events.push('key')
      return true
    },
    confirm: async () => {
      events.push('confirm')
      return true
    },
    secret: async () => {
      events.push('secret')
      return inputs.shift()!
    },
    open: async url => {
      events.push(`open:${url}`)
      return true
    },
    fetchJson: async url => {
      events.push(`fetch:${url}`)
      return { keys: [jwk] }
    },
    prepare: async () => ({
      existingNames: [],
      save: async values => {
        events.push('save')
        saved.push({ ...values })
      },
    }),
  }
  return { environment, events, output, saved, inputs, jwk }
}

Describe('Clerk setup wizard', () => {
  Test('opens pages only after keypress and completion, verifies keys and saves a PEM', async () => {
    const f = await fixture()
    await runSetupClerk({}, f.environment)
    Expect(f.events).toEqual([
      'key',
      'open:https://dashboard.clerk.com/',
      'confirm',
      'key',
      'open:https://dashboard.clerk.com/~/user-authentication/user-and-authentication',
      'confirm',
      'key',
      'open:https://dashboard.clerk.com/~/api-keys',
      'confirm',
      'secret',
      'secret',
      'fetch:https://api.clerk.com/v1/jwks',
      'fetch:https://example.clerk.accounts.dev/.well-known/jwks.json',
      'confirm',
      'save',
    ])
    Expect(f.saved[0]?.['CLERK_SECRET_KEY']).toBe('sk_test_private')
    const pem = f.saved[0]!['CLERK_JWT_KEY']!
    const imported = await crypto.subtle.importKey(
      'spki',
      Buffer.from(pem.replace(/-----[^\n]+-----|\s/g, ''), 'base64'),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    )
    Expect((await crypto.subtle.exportKey('jwk', imported)).n).toBe(f.jwk.n)
    Expect(f.output.join('\n')).not.toContain('sk_test_private')
  })

  Test('instructions do not inspect the store, interact or access the network', async () => {
    const f = await fixture()
    f.environment.prepare = async () => Errors.throwUnexpected('Must not inspect store')
    f.environment.interactive = () => false
    await runSetupClerk({ instructions: true }, f.environment)
    Expect(f.events).toEqual([])
    Expect(f.output.join('\n')).toContain('https://dashboard.clerk.com/~/api-keys')
  })

  Test('existing credentials can be left untouched without decrypting or prompting for keys', async () => {
    const f = await fixture()
    f.environment.prepare = async () => ({
      existingNames: ['CLERK_SECRET_KEY'],
      save: async () => Errors.throwUnexpected('Must not save'),
    })
    f.environment.confirm = async () => false
    await runSetupClerk({}, f.environment)
    Expect(f.events).toEqual([])
    Expect(f.output.join('\n')).toContain('not decrypted or verified')
  })

  Test('canceling before opening a page leaves credentials untouched', async () => {
    const f = await fixture()
    f.environment.waitKey = async () => false
    await runSetupClerk({}, f.environment)
    Expect(f.events).toEqual([])
    Expect(f.saved).toEqual([])
  })

  Test('production credentials are refused before network access', async () => {
    const f = await fixture()
    f.inputs.splice(0, 2, 'pk_live_invalid', 'sk_live_invalid')
    await Expect(runSetupClerk({}, f.environment)).rejects.toThrow('development instance keys')
    Expect(f.events.some(event => event.startsWith('fetch:'))).toBe(false)
    Expect(f.saved).toEqual([])
  })

  Test('mismatched, ambiguous and failing JWKS requests cannot save or expose upstream errors', async () => {
    for (const mode of ['mismatch', 'ambiguous', 'failure']) {
      const f = await fixture()
      f.environment.fetchJson = async url => {
        if (mode === 'failure') {
          Errors.throwHostEnvironment('sk_test_private')
        }
        if (mode === 'ambiguous') {
          return { keys: [f.jwk, f.jwk] }
        }
        return { keys: [{ ...f.jwk, n: url.includes('api.clerk.com') ? 'different' : f.jwk.n }] }
      }
      await Expect(runSetupClerk({}, f.environment)).rejects.toThrow('Could not verify matching Clerk development keys')
      Expect(f.saved).toEqual([])
      Expect(f.output.join('\n')).not.toContain('sk_test_private')
    }
  })

  Test('declining the final save does not persist validated credentials', async () => {
    const f = await fixture()
    let confirmations = 0
    f.environment.confirm = async () => ++confirmations < 4
    await runSetupClerk({}, f.environment)
    Expect(f.saved).toEqual([])
  })
})

/**
 * A cipher that decrypts nothing but the wrapped store key, so a batch that decrypted a value fails; each store
 * key it makes is numbered, and `stored` is a store whose key it can unwrap.
 */
function encryptOnly(encrypt: (value: string) => Promise<string>): Cipher {
  let keys = 0
  return {
    decrypt: async armor =>
      armor === 'wrapped-store-secret-0' ? 'store-secret-0' : Errors.throwUnexpected('No decryption'),
    decryptWithKey: async () => Errors.throwUnexpected('No decryption'),
    encrypt,
    generateKey: async () => {
      keys++
      return { recipient: `store-recipient-${keys}`, secretKey: `store-secret-${keys}` }
    },
    recipientOfKey: async secretKey => secretKey.replace('secret', 'recipient'),
  }
}

const stored: SecretStore = {
  recipients: ['recipient'],
  storeKey: { recipient: 'store-recipient-0', wrappedFor: ['recipient'], wrappedKey: ['wrapped-store-secret-0'] },
  secrets: {},
}

Describe('Encrypted setup batch', () => {
  Test('overlapping saves preserve both unrelated encrypted additions', async () => {
    let current = stored
    const writing = Deferred()
    const release = Deferred()
    const secondEncrypted = Deferred()
    let writes = 0
    const environment = {
      read: async () => current,
      write: async (value: SecretStore) => {
        if (++writes === 1) {
          writing.resolve()
          await release.promise
        }
        current = value
      },
      now: () => new Date('2026-01-01'),
      cipher: encryptOnly(async value => {
        if (value === 'second') {
          secondEncrypted.resolve()
        }
        return `armor:${value}`
      }),
    }
    const first = await prepareSecretBatch(environment)
    const second = await prepareSecretBatch(environment)
    const savingFirst = first.save({ FIRST: 'first' })
    await writing.promise
    const savingSecond = second.save({ SECOND: 'second' })
    await secondEncrypted.promise
    await settle()
    release.resolve()
    await Promise.all([savingFirst, savingSecond])
    Expect(current.secrets['FIRST']?.value).toEqual(['armor:first'])
    Expect(current.secrets['SECOND']?.value).toEqual(['armor:second'])
    // Both batches unlocked the recorded store key and encrypted to it; neither made another.
    Expect(current.storeKey).toEqual(stored.storeKey)
  })
  Test('encrypts everything before one write and preserves unrelated entries', async () => {
    const original: SecretStore = {
      recipients: ['recipient'],
      secrets: { OTHER: { value: ['old armor'], addedAt: 'old' } },
    }
    const written: SecretStore[] = []
    const batch = await prepareSecretBatch({
      read: async () => original,
      write: async value => {
        written.push(value)
      },
      now: () => new Date('2026-01-01'),
      cipher: encryptOnly(async value => `armor:${value}`),
    })
    await batch.save({ FIRST: 'first', SECOND: 'second' })
    Expect(written).toHaveLength(1)
    Expect(written[0]?.secrets['OTHER']).toEqual({ value: ['old armor'], addedAt: 'old' })
    Expect(written[0]?.secrets['SECOND']?.value).toEqual(['armor:second'])
  })

  Test('encryption failure and concurrent edits leave the store untouched', async () => {
    for (const mode of ['encryption', 'concurrent']) {
      let reads = 0
      const written: SecretStore[] = []
      const batch = await prepareSecretBatch({
        read: async () => ({ recipients: ++reads > 1 && mode === 'concurrent' ? ['new'] : ['old'], secrets: {} }),
        write: async value => {
          written.push(value)
        },
        now: () => new Date('2026-01-01'),
        cipher: encryptOnly(async value => {
          if (mode === 'encryption' && value === 'second') {
            Errors.throwHostEnvironment('Encryption failed')
          }
          return 'armor'
        }),
      })
      await Expect(batch.save({ FIRST: 'first', SECOND: 'second' })).rejects.toThrow()
      Expect(written).toEqual([])
    }
  })
})
