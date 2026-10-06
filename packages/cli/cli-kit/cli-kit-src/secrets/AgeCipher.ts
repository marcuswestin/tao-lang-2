import { CLI, Errors, FS, HCI } from '@shared'
import type { Cipher } from './SecretStore'

function failureOf(result: CLI.CommandResult): string {
  return result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown'}`
}

/**
 * age owns the cryptography. The machine identity is used only to unwrap the store key. `notices` receives the
 * unlock notice, process stderr by default; a test that runs beside others passes its own stream, because
 * process stderr is what a concurrently running test captures.
 */
export function createAgeCipher(identityPath: string, setupCommand: string, notices: HCI.OutputOptions = {}): Cipher {
  return {
    decrypt: async armor => {
      if (!await FS.exists(identityPath)) {
        Errors.throwHostEnvironment(
          `No secrets identity at ${FS.displayPath(identityPath)}. Run \`${setupCommand}\` once on this machine.`,
        )
      }
      HCI.writeStderr(
        'Unlocking the secret store with this machine’s identity. On macOS, a Secure Enclave identity may ask for Touch ID or login authorization in a native dialog.\n',
        notices,
      )
      const result = await CLI.run('age', { args: ['--decrypt', '--identity', identityPath], stdin: armor })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(`age could not decrypt the store key: ${failureOf(result)}`)
      }
      return result.stdout
    },
    // The key reaches age on stdin, never in argv or a plaintext file. Only ciphertext uses a temp file.
    decryptWithKey: async (armor, secretKey) => {
      const directory = await FS.mkTmpDir('tao-secrets-')
      try {
        const input = FS.resolvePath('value.age', directory)
        await FS.writeText(input, armor, { mode: 0o600 })
        const result = await CLI.run('age', { args: ['--decrypt', '--identity', '-', input], stdin: secretKey })
        if (result.exitCode !== 0) {
          Errors.throwHostEnvironment(
            `age could not decrypt a secret with the store key: ${
              failureOf(result).replaceAll(secretKey, '<store key>')
            }`,
          )
        }
        return result.stdout
      } finally {
        await FS.remove(directory)
      }
    },
    generateKey: async () => {
      const result = await CLI.run('age-keygen', {})
      const recipient = /^#\s*public key:\s*(age1\S+)\s*$/m.exec(result.stdout)?.[1]
      const secretKey = /^AGE-SECRET-KEY-1\S+$/m.exec(result.stdout)?.[0]
      if (result.exitCode !== 0 || recipient === undefined || secretKey === undefined) {
        Errors.throwHostEnvironment(`age-keygen could not create the store key: ${failureOf(result)}`)
      }
      return { recipient, secretKey }
    },
    recipientOfKey: async secretKey => {
      const result = await CLI.run('age-keygen', { args: ['-y'], stdin: secretKey })
      const recipient = result.stdout.trim()
      if (result.exitCode !== 0 || !recipient.startsWith('age1')) {
        Errors.throwHostEnvironment(
          `age-keygen could not read the store key's recipient: ${
            failureOf(result).replaceAll(secretKey, '<store key>')
          }`,
        )
      }
      return recipient
    },
    encrypt: async (plaintext, recipients) => {
      if (recipients.length === 0) {
        Errors.throwUserInput('The secret store has no recipients.')
      }
      const result = await CLI.run('age', {
        args: ['--armor', ...recipients.flatMap(recipient => ['--recipient', recipient])],
        stdin: plaintext,
      })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(
          `age could not encrypt a secret: ${failureOf(result).replaceAll(plaintext, '<secret>')}`,
        )
      }
      return result.stdout
    },
  }
}
