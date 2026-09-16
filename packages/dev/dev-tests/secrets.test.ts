// The secret store: what is committed, what is generated, and what neither may do to the other.
//
// `age` is not exercised here. It owns the cryptography and has its own tests; what these check is the part
// this repository wrote — the shape of the committed file, the metadata it keeps across a replacement, and
// the rule that the generated file is the only one this command may write.
import { HCI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { SecretsCommand } from '../dev-src/secrets/SecretsCommand'
import { parseEnvFile } from '../dev-src/secrets/SecretsFile'
import {
  formatStore,
  parseStore,
  renderEnvFile,
  requireSecretName,
  type SecretStore,
  withSecret,
} from '../dev-src/secrets/SecretStore'

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
})

Describe('Generated environment file', () => {
  Test('decryption preserves trailing and multiline plaintext exactly', async () => {
    const exact = '  first line\nsecond line\n'
    const values = await SecretsCommand.testing.decryptedValues(
      withSecret(store(), 'TOKEN', ARMOR, { now: new Date() }),
      { decrypt: async () => exact, encrypt: async plaintext => plaintext },
    )

    Expect(values.get('TOKEN')).toBe(exact)
  })

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

    Expect(parseEnvFile(written)['TOKEN']).toBe(exact)
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

    Expect(parseEnvFile(written)['TOKEN']).toBe(awkward)
  })

  Test('comments and blank lines are not secrets', () => {
    const values = parseEnvFile(`# Generated by just secrets\n\nTOKEN='abc'\n`)

    Expect(values).toEqual({ TOKEN: 'abc' })
  })

  Test('a hand-written line is read as written, quoted or not', () => {
    const values = parseEnvFile(`PLAIN=value\nDOUBLE="quoted value"\n`)

    Expect(values['PLAIN']).toBe('value')
    Expect(values['DOUBLE']).toBe('quoted value')
  })
})
