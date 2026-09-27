// The secret store: what is committed, what is generated, and what neither may do to the other.
//
// `age` owns the cryptography and has its own tests; what these check is the part this repository wrote —
// the shape of the committed file, the metadata it keeps across a replacement, the rule that the generated
// file is the only one this command may write, and how many times a read uses the machine's identity. That
// last one runs real `age`, with a software identity standing in for the Secure Enclave and counting its uses,
// because each use of the real one is a fingerprint prompt.
import { Errors, FS, HCI, SecretsFile } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { prepareSecretBatch, SecretsCommand } from '../dev-cli-src/secrets/SecretsCommand'
import {
  type Cipher,
  formatStore,
  isStoreKeyArmor,
  parseStore,
  renderEnvFile,
  requireSecretName,
  type SecretStore,
  withSecret,
} from '../dev-cli-src/secrets/SecretStore'

const ARMOR = '-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24ub3JnL3Yx\n-----END AGE ENCRYPTED FILE-----'

function store(secrets: SecretStore['secrets'] = {}): SecretStore {
  return { recipients: ['age1se1qgg72x2qfk9wg3wh0qg9u0v7l5dkq4jx3ktl'], secrets }
}

Describe('Secret store', () => {
  Test('a written store reads back as what was written', () => {
    const original = withSecret(store(), 'ANTHROPIC_API_KEY', ARMOR, {
      note: 'Studio agent chat',
      now: new Date('2026-09-04T10:00:00Z'),
    })

    const round = parseStore(formatStore(original))

    Expect(round.recipients).toEqual(original.recipients)
    Expect(round.secrets['ANTHROPIC_API_KEY']?.value).toEqual(ARMOR.split('\n'))
    Expect(round.secrets['ANTHROPIC_API_KEY']?.addedAt).toBe('2026-09-04T10:00:00.000Z')
    Expect(round.secrets['ANTHROPIC_API_KEY']?.note).toBe('Studio agent chat')
  })

  Test('the committed file shows keys, dates and notes without decrypting anything', () => {
    const text = formatStore(withSecret(store(), 'ANTHROPIC_API_KEY', ARMOR, {
      note: 'Studio agent chat',
      now: new Date('2026-09-04T10:00:00Z'),
    }))

    Expect(text.includes('"ANTHROPIC_API_KEY"')).toBe(true)
    Expect(text.includes('"note": "Studio agent chat"')).toBe(true)
    Expect(text.includes('"addedAt": "2026-09-04T10:00:00.000Z"')).toBe(true)
    // The armor is one array entry per line, so replacing a secret is a line diff rather than one long blob.
    Expect(text.includes('"-----BEGIN AGE ENCRYPTED FILE-----"')).toBe(true)
    // And the value itself never appears, which is the entire point of committing this file.
    Expect(text.includes('sk-')).toBe(false)
  })

  Test('replacing a secret keeps when it was first added and records when it changed', () => {
    const first = withSecret(store(), 'TOKEN', ARMOR, { now: new Date('2026-01-01T00:00:00Z') })

    const second = withSecret(first, 'TOKEN', `${ARMOR}\nextra`, { now: new Date('2026-06-01T00:00:00Z') })

    Expect(second.secrets['TOKEN']?.addedAt).toBe('2026-01-01T00:00:00.000Z')
    Expect(second.secrets['TOKEN']?.updatedAt).toBe('2026-06-01T00:00:00.000Z')
  })

  Test('replacing a secret keeps the note nobody restated', () => {
    const first = withSecret(store(), 'TOKEN', ARMOR, { note: 'why this exists', now: new Date('2026-01-01Z') })

    const second = withSecret(first, 'TOKEN', ARMOR, { now: new Date('2026-06-01Z') })

    Expect(second.secrets['TOKEN']?.note).toBe('why this exists')
  })

  Test('two secrets added in two worktrees do not collide', () => {
    // Values are encrypted one at a time and the file is written in key order, so separate additions touch
    // separate lines. A whole-file scheme would put a changed authentication tag on both sides instead.
    const left = formatStore(withSecret(store(), 'ALPHA', ARMOR, { now: new Date('2026-01-01Z') }))
    const right = formatStore(withSecret(store(), 'BETA', ARMOR, { now: new Date('2026-01-01Z') }))

    const changedInLeft = left.split('\n').filter(line => !right.includes(line.trim()) && line.trim() !== '')
    Expect(changedInLeft.every(line => line.includes('ALPHA') || line.includes('}'))).toBe(true)
  })

  Test('a store with no secrets yet is still a file worth reading', () => {
    // This is what `just secrets setup` commits before anything is added, so it should not look broken.
    const text = formatStore(store())

    Expect(text.includes('"secrets": {}')).toBe(true)
    Expect(parseStore(text).secrets).toEqual({})
  })

  Test('a store that is not valid JSONC is refused rather than silently emptied', () => {
    Expect(() => parseStore('{ "secrets": ')).toThrow()
    // Losing a secret to a parse slip would be discovered only when something stopped working.
    Expect(() => parseStore('{ "secrets": { "A": { "value": "not an array" } } }')).toThrow()
  })

  Test('comments are part of the format, not something that breaks reading it', () => {
    const parsed = parseStore(`// a note to whoever opens this
{ "recipients": ["age1abc"], "secrets": {} }`)

    Expect(parsed.recipients).toEqual(['age1abc'])
  })

  Test('a secret is named as the environment variable it becomes', () => {
    Expect(requireSecretName('ANTHROPIC_API_KEY')).toBe('ANTHROPIC_API_KEY')
    Expect(() => requireSecretName('anthropic-api-key')).toThrow()
    Expect(() => requireSecretName('2FA')).toThrow()
  })

  Test('the store key is kept across a write, and a store key missing a part is refused', () => {
    const storeKey = { recipient: 'age1store', wrappedFor: ['age1se1machine'], wrappedKey: ARMOR.split('\n') }
    const written = formatStore(withSecret({ ...store(), storeKey }, 'TOKEN', ARMOR, { now: new Date('2026-01-01Z') }))

    Expect(parseStore(written).storeKey).toEqual(storeKey)
    Expect(written.indexOf('"storeKey"')).toBeLessThan(written.indexOf('"secrets"'))
    Expect(() => parseStore('{ "storeKey": { "recipient": "age1store", "wrappedFor": [] } }')).toThrow('storeKey')
  })
})

Describe('Generated environment file', () => {
  Test('says it is generated, and where to put what is not', () => {
    const text = renderEnvFile(new Map([['TOKEN', 'abc']]), { generatedAt: new Date('2026-09-04T10:00:00Z') })

    Expect(text.includes('Do not edit.')).toBe(true)
    // The rule that keeps hand-entered values safe: this file is replaced wholesale, the other one is not.
    Expect(text.includes('.env.local')).toBe(true)
    Expect(text.includes('# tao-secret-format: json-v1')).toBe(true)
    Expect(text.includes('TOKEN="abc"')).toBe(true)
  })

  Test('a value keeps its exact bytes through quoting', () => {
    const awkward = "has 'quotes' and spaces #and-a-hash"

    const text = renderEnvFile(new Map([['TOKEN', awkward]]), { generatedAt: new Date() })

    Expect(text.includes(`TOKEN="has 'quotes' and spaces #and-a-hash"`)).toBe(true)
  })

  Test('multiline and surrounding whitespace survive the generated-file round trip exactly', () => {
    const exact = '  first line\nsecond line\n'
    const written = renderEnvFile(new Map([['TOKEN', exact]]), { generatedAt: new Date() })

    Expect(SecretsFile.parseEnvFile(written)['TOKEN']).toBe(exact)
  })
})

Describe('Pasted secret hygiene', () => {
  Test('says what is around a value, so the question names what was found', () => {
    // A copied credential usually carries a trailing newline; some secrets genuinely end in a space. The
    // difference cannot be guessed, so it is described and asked about rather than trimmed silently.
    Expect(HCI.describeSurroundingWhitespace('sk-abc\n')).toBe('1 character of trailing whitespace')
    Expect(HCI.describeSurroundingWhitespace('  sk-abc')).toBe('2 characters of leading whitespace')
    Expect(HCI.describeSurroundingWhitespace(' sk-abc \n')).toBe(
      '1 character of leading whitespace and 2 characters of trailing whitespace',
    )
  })

  Test('a clean value raises no question at all', () => {
    Expect(HCI.describeSurroundingWhitespace('sk-abc')).toBe(undefined)
    // Nothing but whitespace is refused later as empty; there is no trim to offer here.
    Expect(HCI.describeSurroundingWhitespace('   ')).toBe(undefined)
  })
})

Describe('Reading the decrypted file back', () => {
  Test('a value survives the round trip it was written for', () => {
    // What renderEnvFile writes is what this reads; a secret that changed in between would authenticate
    // against nothing and the failure would name neither end.
    const awkward = "has 'quotes' and spaces #and-a-hash"
    const written = renderEnvFile(new Map([['TOKEN', awkward]]), { generatedAt: new Date() })

    Expect(SecretsFile.parseEnvFile(written)['TOKEN']).toBe(awkward)
  })

  Test('comments and blank lines are not secrets', () => {
    const values = SecretsFile.parseEnvFile(`# Generated by just secrets\n\nTOKEN='abc'\n`)

    Expect(values).toEqual({ TOKEN: 'abc' })
  })

  Test('a hand-written line is read as written, quoted or not', () => {
    const values = SecretsFile.parseEnvFile(`PLAIN=value\nDOUBLE="quoted value"\n`)

    Expect(values['PLAIN']).toBe('value')
    Expect(values['DOUBLE']).toBe('quoted value')
  })
})

/** sshField is one length-prefixed field of the SSH public key wire format. */
function sshField(bytes: Uint8Array): Uint8Array {
  const field = new Uint8Array(4 + bytes.length)
  new DataView(field.buffer).setUint32(0, bytes.length)
  field.set(bytes, 4)
  return field
}

/**
 * machine stands in for one Mac's Secure Enclave identity with a real age identity: an ssh-ed25519 key, whose
 * header stanza is not X25519, just as a Secure Enclave recipient's is not. It counts every use of the
 * identity, each of which is a fingerprint prompt on a real machine.
 */
async function machine() {
  const generated = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pair = 'privateKey' in generated ? generated : Errors.throwUnexpected('Expected: an Ed25519 key pair.')
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  const identity = FS.resolvePath('identity', await mkTestDir('secrets-machine', { location: 'host' }))
  await FS.writeText(identity, `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`, { mode: 0o600 })
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const wire = Buffer.concat([sshField(new TextEncoder().encode('ssh-ed25519')), sshField(publicKey)])
  const real = SecretsCommand.testing.ageCipher(identity)
  const counter = { uses: 0 }
  const cipher: Cipher = {
    ...real,
    decrypt: async armor => {
      counter.uses++
      return await real.decrypt(armor)
    },
  }
  return { cipher, counter, recipient: `ssh-ed25519 ${wire.toString('base64')}` }
}

/** memory keeps a store the way the file does, by writing it out and reading it back, and counts writes. */
function memory(initial: SecretStore) {
  const state = { current: initial, writes: 0 }
  return {
    state,
    read: async () => state.current,
    write: async (next: SecretStore) => {
      state.writes++
      state.current = parseStore(formatStore(next))
    },
  }
}

function access(identity: { cipher: Cipher }, store: ReturnType<typeof memory>) {
  return { cipher: identity.cipher, now: () => new Date('2026-09-27T00:00:00Z'), read: store.read, write: store.write }
}

/** legacy builds a store the way it was before the store key: every value encrypted straight to the machine. */
async function legacy(identity: { cipher: Cipher; recipient: string }, values: Record<string, string>) {
  let built: SecretStore = { recipients: [identity.recipient], secrets: {} }
  for (const [name, value] of Object.entries(values)) {
    const armor = await identity.cipher.encrypt(value, [identity.recipient])
    built = withSecret(built, name, armor, { note: `why ${name}`, now: new Date('2026-01-01T00:00:00Z') })
  }
  return built
}

Describe('Store key', () => {
  Test('adding secrets never uses the machine identity, and the store key is made once', async () => {
    const mac = await machine()
    const store = memory({ recipients: [mac.recipient], secrets: {} })

    await (await prepareSecretBatch(access(mac, store))).save({ ALPHA: 'alpha' })
    const first = store.state.current.storeKey
    await (await prepareSecretBatch(access(mac, store))).save({ BETA: 'beta' })

    Expect(mac.counter.uses).toBe(0)
    Expect(first?.wrappedFor).toEqual([mac.recipient])
    Expect(store.state.current.storeKey).toEqual(first)
    Expect(formatStore(store.state.current)).not.toContain('AGE-SECRET-KEY')
    const opened = await SecretsCommand.testing.openSecrets(access(mac, store))
    Expect([...opened.values]).toEqual([['ALPHA', 'alpha'], ['BETA', 'beta']])
    Expect(mac.counter.uses).toBe(1)
  })

  Test('one read uses the machine identity once however many secrets it holds, and keeps their bytes', async () => {
    const mac = await machine()
    const store = memory({ recipients: [mac.recipient], secrets: {} })
    const exact = { ALPHA: 'alpha', BETA: '  first line\nsecond line\n', GAMMA: 'ünïcødé', DELTA: 'delta ' }
    await (await prepareSecretBatch(access(mac, store))).save(exact)

    const opened = await SecretsCommand.testing.openSecrets(access(mac, store))

    Expect(Object.fromEntries(opened.values)).toEqual(exact)
    Expect(mac.counter.uses).toBe(1)
    Expect(store.state.writes).toBe(1)
  })

  Test('values from before the store key cost one use each, once, and then move onto it', async () => {
    const mac = await machine()
    const store = memory(await legacy(mac, { ALPHA: 'alpha', BETA: 'beta', GAMMA: 'gamma' }))

    const migrating = await SecretsCommand.testing.openSecrets(access(mac, store))

    Expect(Object.fromEntries(migrating.values)).toEqual({ ALPHA: 'alpha', BETA: 'beta', GAMMA: 'gamma' })
    Expect(mac.counter.uses).toBe(3)
    Expect(migrating.moved).toBe(3)
    Expect(store.state.writes).toBe(1)
    Expect(store.state.current.storeKey?.wrappedFor).toEqual([mac.recipient])
    // Moving a value is not replacing it: its dates and note are the ones it had.
    Expect(store.state.current.secrets['BETA']).toMatchObject({ addedAt: '2026-01-01T00:00:00.000Z', note: 'why BETA' })
    Expect(store.state.current.secrets['BETA']?.updatedAt).toBe(undefined)

    mac.counter.uses = 0
    const after = await SecretsCommand.testing.openSecrets(access(mac, store))

    Expect(Object.fromEntries(after.values)).toEqual({ ALPHA: 'alpha', BETA: 'beta', GAMMA: 'gamma' })
    Expect(mac.counter.uses).toBe(1)
    Expect(store.state.writes).toBe(1)
  })

  Test('one older value merged into a keyed store costs one more use, once', async () => {
    const mac = await machine()
    const store = memory({ recipients: [mac.recipient], secrets: {} })
    await (await prepareSecretBatch(access(mac, store))).save({ ALPHA: 'alpha' })
    // What an older checkout's `add` leaves behind when its branch merges.
    const old = await mac.cipher.encrypt('beta', [mac.recipient])
    store.state.current = withSecret(store.state.current, 'BETA', old, { now: new Date('2026-01-01Z') })

    await SecretsCommand.testing.openSecrets(access(mac, store))
    Expect(mac.counter.uses).toBe(2)
    mac.counter.uses = 0
    const after = await SecretsCommand.testing.openSecrets(access(mac, store))

    Expect(Object.fromEntries(after.values)).toEqual({ ALPHA: 'alpha', BETA: 'beta' })
    Expect(mac.counter.uses).toBe(1)
  })

  Test('a machine recorded after the wrap is granted the key by the next read on one that has it', async () => {
    const first = await machine()
    const second = await machine()
    const store = memory({ recipients: [first.recipient], secrets: {} })
    await (await prepareSecretBatch(access(first, store))).save({ ALPHA: 'alpha' })
    // What `just secrets setup` on the second machine records, and all it records.
    store.state.current = { ...store.state.current, recipients: [first.recipient, second.recipient] }

    await Expect(SecretsCommand.testing.openSecrets(access(second, store))).rejects.toThrow(
      'Could not unwrap the store key',
    )
    second.counter.uses = 0
    const granting = await SecretsCommand.testing.openSecrets(access(first, store))

    Expect(granting.granted).toBe(1)
    Expect(first.counter.uses).toBe(1)
    Expect(store.state.current.storeKey?.wrappedFor).toEqual([first.recipient, second.recipient])
    const opened = await SecretsCommand.testing.openSecrets(access(second, store))
    Expect(Object.fromEntries(opened.values)).toEqual({ ALPHA: 'alpha' })
    Expect(second.counter.uses).toBe(1)
  })

  Test('a batch that loses the race to make the store key encrypts to the one that won', async () => {
    const mac = await machine()
    const store = memory({ recipients: [mac.recipient], secrets: {} })
    const winner = await prepareSecretBatch(access(mac, store))
    const loser = await prepareSecretBatch(access(mac, store))

    await winner.save({ ALPHA: 'alpha' })
    const key = store.state.current.storeKey
    await loser.save({ BETA: 'beta' })

    Expect(store.state.current.storeKey).toEqual(key)
    const opened = await SecretsCommand.testing.openSecrets(access(mac, store))
    Expect(Object.fromEntries(opened.values)).toEqual({ ALPHA: 'alpha', BETA: 'beta' })
    Expect(mac.counter.uses).toBe(1)
  })

  Test('a store that changes during the read keeps the change', async () => {
    const mac = await machine()
    const other = await machine()
    const original = await legacy(mac, { ALPHA: 'alpha' })
    const added = await mac.cipher.encrypt('gamma', [mac.recipient])
    const changes = {
      // An older checkout added a value: the migration still lands, around it.
      value: withSecret(original, 'GAMMA', added, { now: new Date('2026-01-01Z') }),
      // Another machine was recorded: the migration waits for the next read.
      recipient: { ...original, recipients: [mac.recipient, other.recipient] },
    }
    for (const [change, underneath] of Object.entries(changes)) {
      const store = memory(original)
      let reads = 0
      const opened = await SecretsCommand.testing.openSecrets({
        ...access(mac, store),
        read: async () => ++reads === 1 ? original : underneath,
      })

      Expect(opened.values.get('ALPHA')).toBe('alpha')
      Expect(opened.unsaved).toBe(change === 'recipient')
      if (change === 'value') {
        Expect(store.state.current.secrets['GAMMA']?.value).toEqual(added.trimEnd().split('\n'))
        Expect(isStoreKeyArmor(store.state.current.secrets['ALPHA']!.value.join('\n'))).toBe(true)
      } else {
        Expect(store.state.writes).toBe(0)
      }
    }
  })

  Test('the plaintext store key reaches no error message', async () => {
    const mac = await machine()
    const key = await mac.cipher.generateKey()
    const elsewhere = await mac.cipher.encrypt('value', [mac.recipient])

    const failure = await mac.cipher.decryptWithKey(elsewhere, key.secretKey).catch((error: unknown) => error)

    Expect(String(failure)).toContain('store key')
    Expect(String(failure)).not.toContain(key.secretKey)
  })
})
