import { startStudioProcessTree, type StudioProcessTree } from '@expo-host/dev-loop/StudioProcessTree'
import { CLI, Errors, FS, ProcessTree } from '@shared'
import type { Platform } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { StudioNative } from '../studio-tooling-src/StudioNative'

Describe('Studio native bounded lifecycle', () => {
  Test('wires the release timeout into the production Electrobun build invocation', async () => {
    const calls: unknown[] = []

    await StudioNative.testing.runElectrobunReleaseBuild(
      '/tools/hutch',
      '/workspace/release',
      'stable',
      undefined,
      async (hutchPath, args, projectRoot, options) => {
        calls.push({ args, failureKind: options.failureKind, hutchPath, projectRoot, timeoutMs: options.timeoutMs })
      },
    )

    Expect(calls).toEqual([{
      args: ['electrobun', 'build', '--env=stable'],
      failureKind: 'electrobun-build-timeout',
      hutchPath: '/tools/hutch',
      projectRoot: '/workspace/release',
      timeoutMs: 30 * 60_000,
    }])
  })

  Test('reports each preparation phase start and elapsed completion', async () => {
    const lines: string[] = []
    let now = 100

    await StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/native', {
      log: line => lines.push(line),
      now: () => now += 7,
      runner: async (command, spec) => commandResult(command, spec, 0),
    })

    Expect(lines).toEqual([
      'hutch install: started',
      'hutch install: completed in 7ms',
      'electrobun prepare: started',
      'electrobun prepare: completed in 7ms',
    ])
  })

  Test('bounds a hung Hutch install and stops its owned process tree', async () => {
    const fake = fakeProcessTree()

    const error = await rejectedError(StudioNative.testing.prepareElectrobun(
      '/tools/hutch',
      '/workspace/native',
      { installTimeoutMs: 5, log: () => {}, startCommand: () => fake.command },
    ))

    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(error.message).toContain('Hutch install timed out after 5ms (elapsed')
    Expect(error.message).toContain('in /workspace/native')
    Expect(error.details?.['failureKind']).toBe('hutch-install-timeout')
    Expect(fake.events).toEqual(['kill SIGTERM', 'close-output', 'dispose'])
  })

  Test('retains bounded Hutch output in a timeout diagnostic', async () => {
    const fake = fakeProcessTree()
    let stdio: unknown
    let settleOnExit: boolean | undefined

    const error = await rejectedError(StudioNative.testing.prepareElectrobun(
      '/tools/hutch',
      '/workspace/native',
      {
        installTimeoutMs: 5,
        log: () => {},
        startCommand: (_command, spec) => {
          if (spec === undefined) {
            return Errors.throwUnexpected('Expected: bounded Hutch startup supplies a command specification.')
          }
          stdio = spec.stdio
          settleOnExit = spec.settleOnExit
          spec.onOutput?.('stderr', Buffer.from('signing identity unavailable\n'))
          return fake.command
        },
      },
    ))

    Expect(stdio).toEqual(['ignore', 'pipe', 'pipe'])
    Expect(settleOnExit).toBe(true)
    Expect(error.message).toContain('Relevant output:\nsigning identity unavailable')
    Expect(error.details?.['output']).toBe('signing identity unavailable\n')
  })

  Test('releases the native-host lease when startup fails after acquisition', async () => {
    const events: string[] = []
    const removed: Platform.ProcessSignal[] = []

    await Expect(StudioNative.start({
      previewUrl: 'http://127.0.0.1:8081',
      studioUrl: 'http://127.0.0.1:55101',
    }, {
      nativeHost: {
        acquire: async () => ({
          owner: {} as never,
          release: async () => {
            events.push('lease.release')
          },
        }),
      },
      onProcessSignal: (signal, _listener) => () => removed.push(signal),
      resolveHutch: async () => '/tools/hutch',
      startWithLease: async () => Errors.throwHostEnvironment('startup failed after lease acquisition'),
    })).rejects.toThrow('startup failed after lease acquisition')

    Expect(events).toEqual(['lease.release'])
    Expect(removed).toEqual(['SIGHUP', 'SIGINT', 'SIGTERM'])
  })

  Test('bounds hung Electrobun preparation after install completed', async () => {
    const install = fakeProcessTree({ closed: true })
    const prepare = fakeProcessTree()
    const commands = [install.command, prepare.command]

    const error = await rejectedError(StudioNative.testing.prepareElectrobun(
      '/tools/hutch',
      '/workspace/native',
      {
        log: () => {},
        prepareTimeoutMs: 5,
        startCommand: () => commands.shift()!,
      },
    ))

    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(error.details?.['failureKind']).toBe('electrobun-prepare-timeout')
    Expect(prepare.events).toEqual(['kill SIGTERM', 'close-output', 'dispose'])
  })

  Test('releases command resources after success and a subprocess error', async () => {
    const successfulInstall = fakeProcessTree({ closed: true })
    const successfulPrepare = fakeProcessTree({ closed: true })
    await StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/success', {
      log: () => {},
      startCommand: commands([successfulInstall.command, successfulPrepare.command]),
    })

    Expect(successfulInstall.events).toEqual(['close-output', 'dispose'])
    Expect(successfulPrepare.events).toEqual(['close-output', 'dispose'])

    const failedInstall = fakeProcessTree({ closed: true, exitCode: 7 })
    await Expect(StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/failure', {
      log: () => {},
      startCommand: () => failedInstall.command,
    })).rejects.toThrow('Command failed: /tools/hutch install')
    Expect(failedInstall.events).toEqual(['close-output', 'dispose'])
  })

  Test('retires a finite Hutch phase descendant after its launcher exits', async () => {
    const install = fakeExitedProcessTreeWithDescendant()
    const prepare = fakeProcessTree({ closed: true })

    await StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/descendant', {
      log: () => {},
      startCommand: commands([install.command, prepare.command]),
    })

    Expect(install.events).toEqual(['close-output', 'dispose', 'kill SIGTERM'])
    Expect(install.command.isRunning()).toBe(false)
  })

  Test('an interrupted preparation cleans up and the same project root reruns', async () => {
    const handlers = new Map<Platform.ProcessSignal, () => void>()
    const removed: Platform.ProcessSignal[] = []
    const interruption = StudioNative.testing.createNativeInterruption(undefined, (signal, listener) => {
      handlers.set(signal, listener)
      return () => removed.push(signal)
    })
    const first = fakeProcessTree()
    const firstRun = StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/same-run', {
      installTimeoutMs: 1_000,
      log: () => {},
      signal: interruption.signal,
      startCommand: () => first.command,
    })
    await settle()

    handlers.get('SIGTERM')?.()
    const error = await rejectedError(firstRun)
    interruption.close()

    Expect(error.details?.['failureKind']).toBe('user-interruption')
    Expect(first.events).toEqual(['kill SIGTERM', 'close-output', 'dispose'])
    Expect(removed).toEqual(['SIGHUP', 'SIGINT', 'SIGTERM'])

    const rerunCalls: string[] = []
    await StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/same-run', {
      log: () => {},
      runner: async (command, spec) => {
        rerunCalls.push(spec.args?.join(' ') ?? '')
        return commandResult(command, spec, 0)
      },
    })
    Expect(rerunCalls).toEqual(['install', 'electrobun prepare'])
  })

  Test('preparation cancellation reaches a ready descendant in the detached process group', async () => {
    const root = await mkTestDir('tao-hutch-process-tree-')
    const descendantPath = FS.resolvePath('descendant.pid', root)
    const cancellation = new AbortController()
    let descendant: ReturnType<typeof ProcessTree.descendants>[number] | undefined
    const run = StudioNative.testing.prepareElectrobun('/tools/hutch', root, {
      log: () => {},
      signal: cancellation.signal,
      startCommand: () =>
        startStudioProcessTree('/bin/sh', {
          args: ['-c', 'sleep 60 & child=$!; echo "$child" > "$1"; wait', 'hutch-child', descendantPath],
        }),
    })
    try {
      await until(async () => await FS.isFile(descendantPath), {
        description: 'the Hutch descendant pid',
      })
      const descendantPid = Number((await FS.readText(descendantPath)).trim())
      descendant = ProcessTree.identities([descendantPid]).get(descendantPid)
      Expect(descendant).toBeDefined()
      cancellation.abort()
      const error = await rejectedError(run)
      Expect(error.details?.['failureKind']).toBe('user-interruption')
      await until(() => !processIsRunning(descendantPid), {
        description: 'the complete Hutch process group to stop',
      })
    } finally {
      cancellation.abort()
      // Retain identity before cancellation so a failed proof cleans up only its own descendant.
      if (descendant !== undefined) {
        ProcessTree.signalTracked([descendant], 'SIGKILL')
      }
      await run.catch(() => undefined)
      await FS.remove(root)
    }
  })
})

function fakeProcessTree(options: { closed?: boolean; exitCode?: number } = {}): {
  command: StudioProcessTree
  events: string[]
} {
  const events: string[] = []
  const close = Deferred<CLI.CommandCloseResult>()
  let running = options.closed !== true
  if (options.closed === true) {
    close.resolve({ exitCode: options.exitCode ?? 0, signal: null })
  }
  const command: StudioProcessTree = {
    async closeOutput() {
      events.push('close-output')
    },
    dispose() {
      events.push('dispose')
    },
    get exitCode() {
      return running ? null : options.exitCode ?? 0
    },
    isRunning: () => running,
    kill(signal = 'SIGTERM') {
      events.push(`kill ${signal}`)
      if (running) {
        running = false
        close.resolve({ exitCode: null, signal })
      }
      return true
    },
    onceClose() {},
    onceError() {},
    get signalCode() {
      return running ? null : 'SIGTERM' as const
    },
    waitForClose: () => close.promise,
  }
  return { command, events }
}

function commands(values: StudioProcessTree[]): () => StudioProcessTree {
  return () => values.shift()!
}

function fakeExitedProcessTreeWithDescendant(): { command: StudioProcessTree; events: string[] } {
  const events: string[] = []
  let descendantRunning = true
  const command: StudioProcessTree = {
    async closeOutput() {
      events.push('close-output')
    },
    dispose() {
      events.push('dispose')
    },
    exitCode: 0,
    isRunning: () => descendantRunning,
    kill(signal = 'SIGTERM') {
      events.push(`kill ${signal}`)
      descendantRunning = false
      return true
    },
    onceClose() {},
    onceError() {},
    signalCode: null,
    waitForClose: async () => ({ exitCode: 0, signal: null }),
  }
  return { command, events }
}

function commandResult(command: string, spec: CLI.CommandSpec, exitCode: number): CLI.CommandResult {
  return {
    args: [...(spec.args ?? [])],
    command,
    cwd: spec.cwd,
    exitCode,
    signal: null,
    stderr: '',
    stdout: '',
  }
}

function processIsRunning(pid: number): boolean {
  return ProcessTree.identities([pid]).has(pid)
}

async function rejectedError(promise: Promise<unknown>): Promise<Errors.TaoError> {
  try {
    await promise
  } catch (error) {
    if (Errors.isTaoError(error)) {
      return error
    }
    throw error
  }
  Errors.throwUnexpected('Expected the native lifecycle promise to reject.')
}
