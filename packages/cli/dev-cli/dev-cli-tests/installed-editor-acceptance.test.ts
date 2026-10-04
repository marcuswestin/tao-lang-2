import { CLI, Errors, FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { editorExecutable, launchProbe, withEditorProfile } from '../dev-cli-src/release/InstalledEditorAcceptance'

const cliPath = Platform.hostPlatform === 'darwin'
  ? '/fake/Visual Studio Code.app/Contents/Resources/app/bin/code'
  : Platform.hostPlatform === 'win32'
  ? 'C:\\fake\\Code\\bin\\code.cmd'
  : '/fake/code/bin/code'
const nativePath = Platform.hostPlatform === 'darwin'
  ? '/fake/Visual Studio Code.app/Contents/MacOS/Code'
  : Platform.hostPlatform === 'win32'
  ? 'C:\\fake\\Code\\Code.exe'
  : '/fake/code/code'

function fixture(mode: 'no-start' | 'started-failure' | 'exit-no-marker' | 'success') {
  let now = 0
  let killed = false
  let killAt = -1
  let startedCommand = ''
  let startedArgs: string[] = []
  let close: ((exitCode: number | null, signal: Platform.ProcessSignal | null) => void) | undefined
  let result: { exitCode: number | null; signal: Platform.ProcessSignal | null } | undefined
  const phase = FS.resolvePath('progress/0-started.json', '/fake/probe')
  const marker = FS.resolvePath('probe-passed.json', '/fake/probe')
  const child: CLI.StartedCommand = {
    args: [],
    command: nativePath,
    error: mode === 'started-failure' ? Errors.asError('spawn failed') : undefined,
    exitCode: null,
    signalCode: null,
    closeOutput: async () => {},
    dispose: () => {},
    endStdin: () => {},
    kill: () => {
      killed = true
      killAt = now
      result = { exitCode: null, signal: 'SIGTERM' }
      close?.(result.exitCode, result.signal)
      return true
    },
    onceClose: listener => {
      close = listener
    },
    onceError: () => {},
    waitForClose: async () => result ?? { exitCode: null, signal: 'SIGTERM' },
    writeStdin: () => false,
  }
  const seams: NonNullable<Parameters<typeof launchProbe>[1]> = {
    commandPath: async () => cliPath,
    realPath: async () => cliPath,
    isFile: async path =>
      path === cliPath || path === nativePath
      || (mode !== 'no-start' && path === phase)
      || (mode === 'success' && path === marker),
    start: (command, spec) => {
      startedCommand = command
      startedArgs = [...(spec?.args ?? [])]
      return child
    },
    sleep: async () => {
      now += 60_000
      if (mode !== 'no-start' && result === undefined) {
        result = { exitCode: mode === 'started-failure' ? 1 : 0, signal: null }
        close?.(result.exitCode, result.signal)
      }
    },
    nowMs: () => now,
    writeLine: () => {},
  }
  const options = {
    codeCli: cliPath,
    profileArgs: ['--user-data-dir', '/fake/user', '--extensions-dir', '/fake/extensions'],
    probe: '/fake/probe-extension',
    probeBundle: '/fake/probe-test.cjs',
    workspace: '/fake/workspace',
    root: '/fake/probe',
    env: {},
  }
  return {
    seams,
    options,
    command: () => startedCommand,
    args: () => startedArgs,
    killed: () => killed,
    killAt: () => killAt,
  }
}

Describe('Installed editor probe launch', () => {
  Test('resolves the native application executable behind the shell CLI', async () => {
    const { seams } = fixture('success')
    Expect(await editorExecutable(cliPath, seams)).toBe(nativePath)
  })

  Test('starts the native executable without a CLI wait flag and requires the success marker', async () => {
    const test = fixture('success')
    Expect(await launchProbe(test.options, test.seams)).toBe(nativePath)
    Expect(test.command()).toBe(nativePath)
    Expect(test.args()).toContain('--extensionTestsPath')
    Expect(test.args()).toContain('--disable-updates')
    Expect(test.args()).toContain('--disable-workspace-trust')
    Expect(test.args().slice(test.args().indexOf('--log'), test.args().indexOf('--log') + 2)).toEqual([
      '--log',
      'trace',
    ])
    Expect(test.args()).not.toContain('--wait')
  })

  Test('stops an editor that never starts the probe within the startup bound', async () => {
    const test = fixture('no-start')
    await Expect(launchProbe(test.options, test.seams)).rejects.toThrow('did not start within 120s')
    Expect(test.killed()).toBe(true)
    Expect(test.killAt()).toBe(120_000)
  })

  Test('reports a started probe that exits with failure', async () => {
    const test = fixture('started-failure')
    await Expect(launchProbe(test.options, test.seams)).rejects.toThrow('spawn failed')
  })

  Test('rejects a clean process exit without the probe success marker', async () => {
    const test = fixture('exit-no-marker')
    await Expect(launchProbe(test.options, test.seams)).rejects.toThrow('without a passing result')
  })

  Test('archives and removes only its short owned profile after a successful action', async () => {
    const events: string[] = []
    const user = '/tmp/tao-ide-owned'
    const root = '/fake/probe'
    const seams: NonNullable<Parameters<typeof withEditorProfile>[2]> = {
      mkTmpDir: async prefix => {
        Expect(prefix).toBe(Platform.hostPlatform === 'win32' ? 'tao-ide-' : '/tmp/tao-ide-')
        events.push('created')
        return user
      },
      isDirectory: async path => {
        Expect(path).toBe(FS.resolvePath('logs', user))
        return true
      },
      writeJson: async (_path, content) => {
        events.push(`metadata:${(content as { status: string }).status}`)
      },
      copyDirectory: async (from, to) => {
        Expect(from).toBe(FS.resolvePath('logs', user))
        Expect(to).toBe(FS.resolvePath('user-logs', root))
        events.push('copied')
      },
      remove: async path => {
        Expect(path).toBe(user)
        events.push('removed')
      },
    }
    Expect(
      await withEditorProfile(root, async path => {
        Expect(path).toBe(user)
        events.push('action')
        return 'accepted'
      }, seams),
    ).toBe('accepted')
    Expect(events).toEqual(['created', 'metadata:active', 'action', 'copied', 'removed', 'metadata:removed'])
  })

  Test('archives and removes its profile when setup or launch fails', async () => {
    const events: string[] = []
    const seams: NonNullable<Parameters<typeof withEditorProfile>[2]> = {
      mkTmpDir: async () => '/tmp/tao-ide-owned',
      isDirectory: async () => true,
      writeJson: async (_path, content) => {
        events.push(`metadata:${(content as { status: string }).status}`)
      },
      copyDirectory: async () => {
        events.push('copied')
      },
      remove: async () => {
        events.push('removed')
      },
    }
    await Expect(withEditorProfile('/fake/probe', async () => {
      events.push('launch-failed')
      Errors.throwHostEnvironment('launch broke')
    }, seams)).rejects.toThrow('launch broke')
    Expect(events).toEqual(['metadata:active', 'launch-failed', 'copied', 'removed', 'metadata:removed'])
  })

  Test('records archive failure and still removes its owned profile', async () => {
    const events: string[] = []
    const seams: NonNullable<Parameters<typeof withEditorProfile>[2]> = {
      mkTmpDir: async () => '/tmp/tao-ide-owned',
      isDirectory: async () => true,
      writeJson: async (_path, content) => {
        events.push(`metadata:${(content as { status: string }).status}`)
      },
      copyDirectory: async () => {
        events.push('copy-failed')
        Errors.throwHostEnvironment('archive unavailable')
      },
      remove: async () => {
        events.push('removed')
      },
    }
    let failure: unknown
    try {
      await withEditorProfile('/fake/probe', async () => {
        events.push('setup-failed')
        Errors.throwHostEnvironment('setup broke')
      }, seams)
    } catch (error) {
      failure = error
    }
    Expect(Errors.asError(failure).message).toContain('setup broke')
    Expect(Errors.asError(failure).message).toContain('archive unavailable')
    Expect(events).toEqual(['metadata:active', 'setup-failed', 'copy-failed', 'removed', 'metadata:removed'])
  })
})
