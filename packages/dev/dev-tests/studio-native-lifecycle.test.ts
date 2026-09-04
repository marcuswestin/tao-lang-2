import { CLI, Errors, FS } from '@shared'
import type { Platform } from '@shared'
import { Deferred, Describe, Expect, settle, Test, until } from '@shared/test'
import { StudioNative } from '../dev-src/studio/StudioNative'
import { startStudioProcessTree, type StudioProcessTree } from '../dev-src/studio/StudioProcessTree'

Describe('Studio native bounded lifecycle', () => {
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

  Test('timeout cancellation reaches a descendant in the detached process group', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-hutch-process-tree-', FS.tmpdir()))
    const descendantPath = FS.resolvePath('descendant.pid', root)
    try {
      const run = StudioNative.testing.prepareElectrobun('/tools/hutch', root, {
        installTimeoutMs: 200,
        log: () => {},
        startCommand: () =>
          startStudioProcessTree('/bin/sh', {
            args: ['-c', `sleep 60 & child=$!; echo "$child" > "${descendantPath}"; wait`],
          }),
      })
      await until(async () => await FS.isFile(descendantPath), {
        description: 'the Hutch descendant pid',
        timeoutMs: 1_000,
      })
      const descendantPid = Number((await FS.readText(descendantPath)).trim())

      await Expect(run).rejects.toThrow('timed out after 200ms')
      await until(async () => !await processIsRunning(descendantPid), {
        description: 'the complete Hutch process group to stop',
        timeoutMs: 1_000,
      })
      Expect(await processIsRunning(descendantPid)).toBe(false)
    } finally {
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

async function processIsRunning(pid: number): Promise<boolean> {
  const result = await CLI.run('/bin/kill', { args: ['-0', String(pid)] })
  return result.exitCode === 0
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
