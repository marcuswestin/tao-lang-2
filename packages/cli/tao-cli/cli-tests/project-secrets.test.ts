import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { createAgeCipher } from 'tao-cli-kit/age-cipher'
import { formatStore, parseStore, withSecret } from 'tao-cli-kit/secrets'
import {
  grantProjectSecrets,
  initProjectSecrets,
  listProjectSecrets,
  projectSecretIfStored,
  type ProjectSecretsEnvironment,
  readProjectSecret,
  removeProjectSecret,
  setProjectSecret,
} from '../cli-src/project-secrets-command'

async function fixture(): Promise<string> {
  const root = await mkTestDir('project-secrets')
  await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
  return root
}

async function machine(root: string, label: string, value = 'disposable-token'): Promise<{
  environment: ProjectSecretsEnvironment
  recipient: string
}> {
  const generated = await CLI.run('age-keygen', {})
  if (generated.exitCode !== 0) {
    Errors.throwHostEnvironment(`age-keygen failed in test: ${generated.stderr}`)
  }
  const recipient = /^# public key: (age1\S+)$/m.exec(generated.stdout)?.[1]
  if (recipient === undefined) {
    Errors.throwUnexpected('Expected: age-keygen output contains a public recipient.')
  }
  const path = FS.resolvePath(`${label}.identity`, root)
  await FS.writeText(path, generated.stdout, { mode: 0o600 })
  return {
    recipient,
    environment: {
      cipher: createAgeCipher(path, 'test setup'),
      identityRecipient: async () => recipient,
      now: () => new Date('2026-09-28T12:00:00Z'),
      promptSecret: async () => value,
    },
  }
}

Describe('Tao project secrets', () => {
  Test('initializes inside the nearest project and round-trips exact values without committing plaintext', async () => {
    const root = await fixture()
    const nested = FS.resolvePath('Feature', root)
    await FS.mkdir(nested)
    const owner = await machine(root, 'owner', '  line one\nline two \n')
    const path = await initProjectSecrets(nested, owner.environment)
    Expect(path).toBe(FS.resolvePath('secrets/secrets.jsonc', root))
    await setProjectSecret('SERVICE_TOKEN', nested, owner.environment)
    Expect(await readProjectSecret('SERVICE_TOKEN', nested, owner.environment)).toBe('  line one\nline two \n')
    Expect(Object.keys(await listProjectSecrets(nested))).toEqual(['SERVICE_TOKEN'])
    const committed = await FS.readText(path)
    Expect(committed).not.toContain('line one')
    Expect(committed).not.toContain('AGE-SECRET-KEY')
    Expect(committed).toContain(owner.recipient)
  })

  Test('a second machine reads nothing until an enrolled member explicitly grants its recipient', async () => {
    const root = await fixture()
    const owner = await machine(root, 'owner')
    const colleague = await machine(root, 'colleague')
    await initProjectSecrets(root, owner.environment)
    await setProjectSecret('SERVICE_TOKEN', root, owner.environment)
    await Expect(readProjectSecret('SERVICE_TOKEN', root, colleague.environment)).rejects.toThrow(
      'This machine cannot unlock the project secrets.',
    )
    Expect(await grantProjectSecrets(colleague.recipient, root, owner.environment)).toBe(true)
    Expect(await readProjectSecret('SERVICE_TOKEN', root, colleague.environment)).toBe('disposable-token')
    Expect(await grantProjectSecrets(colleague.recipient, root, owner.environment)).toBe(false)
  })

  Test('independent concurrent additions preserve both names, and removal leaves no current value', async () => {
    const root = await fixture()
    const owner = await machine(root, 'owner')
    await initProjectSecrets(root, owner.environment)
    await Promise.all([
      setProjectSecret('FIRST_TOKEN', root, { ...owner.environment, promptSecret: async () => 'first' }),
      setProjectSecret('SECOND_TOKEN', root, { ...owner.environment, promptSecret: async () => 'second' }),
    ])
    Expect(await readProjectSecret('FIRST_TOKEN', root, owner.environment)).toBe('first')
    Expect(await readProjectSecret('SECOND_TOKEN', root, owner.environment)).toBe('second')
    await removeProjectSecret('FIRST_TOKEN', root, owner.environment)
    Expect(Object.keys(await listProjectSecrets(root))).toEqual(['SECOND_TOKEN'])
    await Expect(readProjectSecret('FIRST_TOKEN', root, owner.environment)).rejects.toThrow(
      'No project secret named FIRST_TOKEN',
    )
  })

  Test('provider lookup is absent without a store and rejects ciphertext from another store key', async () => {
    const root = await fixture()
    const owner = await machine(root, 'owner')
    Expect(await projectSecretIfStored('SERVICE_TOKEN', root, owner.environment)).toBeUndefined()
    const path = await initProjectSecrets(root, owner.environment)
    await setProjectSecret('SERVICE_TOKEN', root, owner.environment)
    const current = parseStore(await FS.readText(path))
    const otherKey = await owner.environment.cipher.generateKey()
    const wrongArmor = await owner.environment.cipher.encrypt('wrong', [otherKey.recipient])
    await FS.writeText(
      path,
      formatStore(withSecret(current, 'SERVICE_TOKEN', wrongArmor, {
        now: new Date('2026-09-28T12:01:00Z'),
      })),
    )
    await Expect(readProjectSecret('SERVICE_TOKEN', root, owner.environment)).rejects.toThrow(
      'could not be decrypted with this project',
    )
  })
})
