import { CLI, FS, HCI } from '@shared'
import { Describe, Expect, mkTestDir, MockModule, Test, testOverrideSlot, withCapturedOutput } from '@shared/test'
import { createAgeCipher } from '../cli-kit-src/secrets/AgeCipher'

const originalCLI = { ...CLI }
const runCommand = testOverrideSlot({
  read: () => CLI.run,
  write: value => {
    MockModule(new URL('../../../shared/shared-src/CLI.ts', import.meta.url).pathname, () => ({
      ...originalCLI,
      run: value,
    }))
  },
})

Describe('Secret store unlock guidance', () => {
  Test('explains native authorization before machine decryption without changing value output', async () => {
    const root = await mkTestDir('age-guidance')
    const identity = FS.resolvePath('identity', root)
    await FS.writeText(identity, 'disposable test identity')
    const calls: Array<{ command: string; spec: CLI.CommandSpec }> = []
    const plaintext = '{"token":"disposable-private-value"}\n'
    const captured = await withCapturedOutput(async () => {
      const restore = runCommand.install(async (command, spec = {}) => {
        calls.push({ command, spec })
        HCI.writeStderr('machine decrypt started\n')
        return {
          command,
          args: [...spec.args ?? []],
          cwd: spec.cwd,
          error: undefined,
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: plaintext,
        }
      })
      try {
        const result = await createAgeCipher(identity, 'test setup').decrypt('disposable armor')
        HCI.write(result)
        return result
      } finally {
        restore()
      }
    })

    Expect(captured.result).toBe(plaintext)
    Expect(captured.stdout).toBe(plaintext)
    Expect(captured.stderr).toBe(
      'Unlocking the secret store with this machine’s identity. On macOS, a Secure Enclave identity may ask for Touch ID or login authorization in a native dialog.\nmachine decrypt started\n',
    )
    Expect(captured.stderr).not.toContain('disposable-private-value')
    Expect(captured.stderr).not.toContain('disposable armor')
    Expect(calls).toEqual([{
      command: 'age',
      spec: { args: ['--decrypt', '--identity', identity], stdin: 'disposable armor' },
    }])
  })

  Test('a missing identity is refused before announcing an unlock or invoking age', async () => {
    const root = await mkTestDir('age-missing-identity')
    const calls: string[] = []
    const captured = await withCapturedOutput(async () => {
      const restore = runCommand.install(async command => {
        calls.push(command)
        return {
          command,
          args: [],
          cwd: undefined,
          error: undefined,
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: '',
        }
      })
      try {
        await Expect(createAgeCipher(FS.resolvePath('absent', root), 'test setup').decrypt('armor'))
          .rejects.toThrow('No secrets identity')
      } finally {
        restore()
      }
    })
    Expect(calls).toEqual([])
    Expect(captured.stdout).toBe('')
    Expect(captured.stderr).toBe('')
  })

  Test('store-key decryption stays silent and supplies the key only through stdin', async () => {
    const calls: Array<{ command: string; spec: CLI.CommandSpec }> = []
    const captured = await withCapturedOutput(async () => {
      const restore = runCommand.install(async (command, spec = {}) => {
        calls.push({ command, spec })
        return {
          command,
          args: [...spec.args ?? []],
          cwd: spec.cwd,
          error: undefined,
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: 'disposable-value',
        }
      })
      try {
        return await createAgeCipher('unused', 'test setup').decryptWithKey('armor', 'disposable-store-key')
      } finally {
        restore()
      }
    })
    Expect(captured.result).toBe('disposable-value')
    Expect(captured.stdout).toBe('')
    Expect(captured.stderr).toBe('')
    Expect(calls.length).toBe(1)
    Expect(calls[0]?.command).toBe('age')
    Expect(calls[0]?.spec.stdin).toBe('disposable-store-key')
    Expect(calls[0]?.spec.args?.slice(0, 3)).toEqual(['--decrypt', '--identity', '-'])
    Expect(calls[0]?.spec.args?.join(' ')).not.toContain('disposable-store-key')
  })
})
