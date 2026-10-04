import { CLI, Errors, FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until, withCapturedOutput } from '@shared/test'
import { runNamedHostServer } from '../agent-cli-src/cli/NamedHostServer'

function serverHarness(
  identity: TrackedProcess | undefined = { command: 'owned-server', pid: 4321, startedAt: 'start-1' },
) {
  const completion = Deferred<CLI.CommandCloseResult>()
  const output = Deferred<void>()
  const handlers = new Map<Platform.ProcessSignal, () => void>()
  const signals: Platform.ProcessSignal[] = []
  const removed: Platform.ProcessSignal[] = []
  const specs: CLI.CommandSpec[] = []
  let current: TrackedProcess | undefined = identity
  let disposed = false
  const child: CLI.StartedCommand = {
    args: [],
    command: 'owned-server',
    closeOutput: async () => await output.promise,
    dispose: () => {
      disposed = true
    },
    endStdin: () => {},
    exitCode: null,
    kill: signal => {
      signals.push(signal!)
      return true
    },
    onceClose: () => {},
    onceError: () => {},
    pid: 4321,
    signalCode: null,
    waitForClose: () => completion.promise,
    writeStdin: () => false,
  }
  const lifecycle = {
    identities: () => new Map(current === undefined ? [] : [[4321, current]]),
    onProcessSignal: (signal: Platform.ProcessSignal, listener: () => void) => {
      handlers.set(signal, listener)
      return () => {
        handlers.delete(signal)
        removed.push(signal)
      }
    },
    start: (_command: string, spec: CLI.CommandSpec = {}) => {
      Expect(handlers.size).toBe(3)
      specs.push(spec)
      return child
    },
  }
  return {
    child,
    completion,
    handlers,
    lifecycle,
    output,
    removed,
    signals,
    specs,
    get disposed() {
      return disposed
    },
    setIdentity: (identity: TrackedProcess | undefined) => {
      current = identity
    },
  }
}

Describe('named host server signal drain', () => {
  Test('defers a signal received before allocation until the child identity is captured', async () => {
    const harness = serverHarness()
    const running = runNamedHostServer('owned-server', {}, {
      ...harness.lifecycle,
      onProcessSignal: (signal, listener) => {
        const remove = harness.lifecycle.onProcessSignal(signal, listener)
        if (signal === 'SIGINT') {
          listener()
        }
        return remove
      },
    })
    Expect(harness.signals).toEqual(['SIGINT'])
    harness.completion.resolve({ exitCode: 0, signal: null })
    harness.output.resolve()
    await running
  })
  Test('forwards the first signal once and retains guards through child and output cleanup', async () => {
    const harness = serverHarness()
    let finished = false
    const running = runNamedHostServer('owned-server', { args: ['fixed'], processPolicy: 'tool' }, harness.lifecycle)
      .then(result => {
        finished = true
        return result
      })
    harness.handlers.get('SIGINT')!()
    harness.handlers.get('SIGINT')!()
    harness.handlers.get('SIGTERM')!()
    Expect(harness.signals).toEqual(['SIGINT'])
    Expect(harness.specs).toEqual([{ args: ['fixed'], processPolicy: 'server' }])
    Expect(finished).toBe(false)
    Expect(harness.removed).toEqual([])
    harness.completion.resolve({ exitCode: 0, signal: null })
    await Promise.resolve()
    harness.handlers.get('SIGHUP')!()
    Expect(harness.signals).toEqual(['SIGINT'])
    Expect(harness.removed).toEqual([])
    harness.output.resolve()
    Expect(await running).toMatchObject({ exitCode: 0, signal: null })
    Expect(harness.removed).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP'])
    Expect(harness.disposed).toBe(true)
  })

  for (const identity of [undefined, { command: 'replacement', pid: 4321, startedAt: 'start-2' }]) {
    Test(`does not signal a ${identity === undefined ? 'missing' : 'reused'} child identity`, async () => {
      const harness = serverHarness()
      const running = runNamedHostServer('owned-server', {}, harness.lifecycle)
      harness.setIdentity(identity)
      harness.handlers.get('SIGTERM')!()
      Expect(harness.signals).toEqual([])
      harness.completion.resolve({ exitCode: 7, signal: null })
      harness.output.resolve()
      Expect(await running).toMatchObject({ exitCode: 7 })
    })
  }

  Test('never adopts a child whose identity was absent at startup', async () => {
    const harness = serverHarness()
    harness.setIdentity(undefined)
    const running = runNamedHostServer('owned-server', {}, harness.lifecycle)
    harness.setIdentity({ command: 'late-server', pid: 4321, startedAt: 'late-start' })
    harness.handlers.get('SIGINT')!()
    Expect(harness.signals).toEqual([])
    harness.completion.resolve({ exitCode: 0, signal: null })
    harness.output.resolve()
    await running
  })

  Test('removes every guard if starting the child throws', async () => {
    const harness = serverHarness()
    await Expect(runNamedHostServer('owned-server', {}, {
      ...harness.lifecycle,
      start: () => Errors.throwHostEnvironment('Server startup failed.'),
    })).rejects.toThrow('Server startup failed.')
    Expect(harness.handlers.size).toBe(0)
    Expect(harness.removed).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP'])
  })

  Test('continues waiting without signalling when process inspection is unavailable', async () => {
    const harness = serverHarness()
    await withCapturedOutput(async () => {
      const running = runNamedHostServer('owned-server', {}, {
        ...harness.lifecycle,
        identities: () => Errors.throwHostEnvironment('Process inspection unavailable.'),
      })
      harness.handlers.get('SIGINT')!()
      Expect(harness.signals).toEqual([])
      Expect(harness.removed).toEqual([])
      harness.completion.resolve({ exitCode: 0, signal: null })
      harness.output.resolve()
      await running
    })
  })

  Test('the actual named dispatcher stays alive after SIGINT until its server child has drained', async () => {
    const root = await mkTestDir('named-host-dispatch-drain-')
    const ready = FS.resolvePath('ready', root)
    const draining = FS.resolvePath('draining', root)
    const release = FS.resolvePath('release', root)
    const done = FS.resolvePath('done', root)
    const source = FS.resolvePath('permissions.jsonc', root)
    const script = FS.resolvePath('server.ts', root)
    await FS.writeText(source, '{"agentHostCommands":["studio-manual-checks"]}')
    await FS.writeText(
      script,
      `
import { FS, Platform, Time } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))}
let started = false
const finished = new Promise<void>(resolve => {
  Platform.onProcessSignal('SIGINT', () => {
    if (started) return
    started = true
    void (async () => {
      await FS.writeText(${JSON.stringify(draining)}, 'started')
      while (!await FS.exists(${JSON.stringify(release)})) await Time.sleep(10)
      await FS.writeText(${JSON.stringify(done)}, 'finished')
      resolve()
    })()
  })
})
await FS.writeText(${JSON.stringify(ready)}, String(Platform.runtimeProcess.pid))
await finished
Platform.runtimeProcess.setExitCode(0)
`,
    )
    const dev = FS.resolvePath('dev', root)
    await FS.writeText(dev, `#!/bin/sh\nexec ${Platform.runtimeProcess.execPath} ${script}\n`)
    await FS.chmod(dev, 0o755)
    const dispatcher = CLI.start(Platform.runtimeProcess.execPath, {
      args: [
        Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts'),
        source,
        'studio-manual-checks',
      ],
      cwd: root,
      processPolicy: 'server',
      stdio: 'pipe',
    })
    let childIdentity: TrackedProcess | undefined
    try {
      await until(async () => await FS.exists(ready), { description: 'named server child ready' })
      const childPid = Number(await FS.readText(ready))
      childIdentity = ProcessTree.identities([childPid]).get(childPid)
      Expect(childIdentity).toBeDefined()
      dispatcher.kill('SIGINT')
      await until(async () => {
        if (dispatcher.exitCode !== null || dispatcher.signalCode !== null) {
          Errors.throwHostEnvironment('The named dispatcher exited before its child drained.')
        }
        return await FS.exists(draining)
      }, { description: 'named server child draining' })
      dispatcher.kill('SIGTERM')
      Expect(Platform.processIsAlive(dispatcher.pid!)).toBe(true)
      Expect(await FS.exists(done)).toBe(false)
      await FS.writeText(release, 'release')
      Expect(await dispatcher.waitForClose()).toEqual({ exitCode: 0, signal: null })
      Expect(await FS.readText(done)).toBe('finished')
    } finally {
      await FS.writeText(release, 'release')
      if (childIdentity !== undefined) {
        const owned = childIdentity
        ProcessTree.signalTracked([owned], 'SIGINT')
        await until(() => !ProcessTree.sameProcess(ProcessTree.identities([owned.pid]).get(owned.pid), owned), {
          description: 'owned named server child stopped',
        })
      }
      await dispatcher.waitForClose()
      dispatcher.dispose()
      await FS.remove(root)
    }
  })

  Test('waits for a real child already draining a terminal signal without escalating repeated signals', async () => {
    const root = await mkTestDir('named-host-server-drain-')
    const ready = FS.resolvePath('ready', root)
    const draining = FS.resolvePath('draining', root)
    const release = FS.resolvePath('release', root)
    const counts = FS.resolvePath('signals.json', root)
    const resultPath = FS.resolvePath('result.json', root)
    const script = FS.resolvePath('server.ts', root)
    await FS.writeText(
      script,
      `
import { FS, Platform, Time } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))}
let draining = false
let signals = 0
const finished = new Promise<void>(resolve => {
  Platform.onProcessSignal('SIGINT', () => {
    signals++
    void FS.writeJson(${JSON.stringify(counts)}, { signals })
    if (draining) return
    draining = true
    void (async () => {
      await FS.writeText(${JSON.stringify(draining)}, 'started')
      while (!await FS.exists(${JSON.stringify(release)})) await Time.sleep(10)
      await FS.writeJson(${JSON.stringify(resultPath)}, { signals })
      resolve()
    })()
  })
})
await FS.writeText(${JSON.stringify(ready)}, 'ready')
await finished
Platform.runtimeProcess.setExitCode(0)
`,
    )
    const handlers = new Map<Platform.ProcessSignal, () => void>()
    let child: CLI.StartedCommand | undefined
    let finished = false
    const running = runNamedHostServer(Platform.runtimeProcess.execPath, { args: [script], stdio: 'pipe' }, {
      onProcessSignal: (signal, listener) => {
        handlers.set(signal, listener)
        return () => {
          handlers.delete(signal)
        }
      },
      start: (command, spec) => {
        child = CLI.start(command, spec)
        return child
      },
    }).then(result => {
      finished = true
      return result
    })
    try {
      await until(async () => await FS.exists(ready), { description: 'server child ready' })
      child!.kill('SIGINT')
      await until(async () => await FS.exists(draining), { description: 'server child draining its terminal signal' })
      handlers.get('SIGINT')!()
      handlers.get('SIGTERM')!()
      handlers.get('SIGINT')!()
      await until(
        async () => {
          if (finished) {
            Errors.throwHostEnvironment('The owned child exited before its drain was released.')
          }
          if (!await FS.exists(counts)) {
            return false
          }
          const signals = (await FS.readJson<{ signals: number }>(counts)).signals
          if (signals > 2) {
            Errors.throwHostEnvironment('The wrapper forwarded more than one termination signal.')
          }
          return signals === 2
        },
        {
          description: 'child received the terminal and one forwarded signal',
        },
      )
      Expect(finished).toBe(false)
      Expect(handlers.size).toBe(3)
      Expect(Platform.processIsAlive(child!.pid!)).toBe(true)
      await FS.writeText(release, 'release')
      Expect(await running).toMatchObject({ exitCode: 0, signal: null })
      Expect(await FS.readJson(resultPath)).toEqual({ signals: 2 })
      Expect(handlers.size).toBe(0)
    } finally {
      await FS.writeText(release, 'release')
      child?.kill('SIGINT')
      await running
      await FS.remove(root)
    }
  })
})
