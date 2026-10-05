import { installDevLoopStopSignals } from '@expo-host/dev-loop/StopSignals'
import {
  startStudioProcessTree,
  stopStudioProcessTree,
  type StudioProcessTree,
} from '@expo-host/dev-loop/StudioProcessTree'
import { Errors, FS, Platform, ProcessTree, Repo, ResourceInventory, Text } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until, withCapturedOutput } from '@shared/test'

const sharedModule = Repo.resolvePath('packages/shared/shared-src/shared.ts')

Describe('development-loop shutdown', () => {
  Test('an immediate executable preserves its exit code and both output tails after admission', async () => {
    const root = await mkTestDir('loop-immediate-exit-')
    const marker = FS.resolvePath('executed', root)
    const output = { stdout: '', stderr: '' }
    let captured: ReturnType<typeof ProcessTree.identities> | undefined
    const tree = await startStudioProcessTree(Platform.runtimeProcess.execPath, {
      args: [
        '-e',
        `
        import { FS, HCI, Platform } from ${JSON.stringify(sharedModule)};
        await FS.writeText(${JSON.stringify(marker)}, 'executed');
        HCI.writeLine('out'); HCI.writeErrorLine('err'); Platform.runtimeProcess.exit(63);
      `,
      ],
      cwd: root,
      resourceIndexRoot: FS.resolvePath('index', root),
      beforeLaunchPublication: async process => {
        captured = new Map([[process.pid, process]])
        Expect(await FS.isFile(marker)).toBe(false)
      },
      onOutput: (stream, chunk) => {
        output[stream] += chunk.toString()
      },
    })
    try {
      Expect(await tree.waitForClose()).toEqual({ exitCode: 63, signal: null })
      Expect(await FS.readText(marker)).toBe('executed')
      Expect(Text.stripAnsi(output.stderr).trim()).toBe('err')
      Expect(Text.stripAnsi(output.stdout).trim()).toBe('out')
      Expect(captured?.size).toBe(1)
    } finally {
      tree.dispose()
      await FS.remove(root)
    }
  })

  Test('root exit before descendant capture refuses cleanup even when its original group is empty', async () => {
    const root = await mkTestDir('loop-exited-ancestry-')
    const indexRoot = FS.resolvePath('index', root)
    const exit = FS.resolvePath('exit', root)
    const tree = await startStudioProcessTree(Platform.runtimeProcess.execPath, {
      args: [
        '-e',
        `import { FS, Platform, Time } from ${JSON.stringify(sharedModule)};
        while (!await FS.isFile(${JSON.stringify(exit)})) await Time.sleep(5);
        Platform.runtimeProcess.exit(0);`,
      ],
      cwd: root,
      resourceIndexRoot: indexRoot,
    })
    try {
      await FS.writeText(exit, 'exit')
      await tree.waitForClose()
      await Expect(stopStudioProcessTree(tree)).rejects.toThrow('Descendant cleanup remains uncertain')
      Expect((await FS.listDir(indexRoot)).length).toBe(1)
    } finally {
      tree.dispose()
      await FS.remove(root)
    }
  })
  Test('an unrecordable launch refuses allocation before the executable can run', async () => {
    const root = await mkTestDir('loop-refused-allocation-')
    const blocked = FS.resolvePath('index-file', root)
    try {
      await FS.writeText(blocked, 'not a directory')
      await Expect(startStudioProcessTree('/executable-that-must-not-run', { cwd: root, resourceIndexRoot: blocked }))
        .rejects.toThrow()
      Expect(await FS.readText(blocked)).toBe('not a directory')
    } finally {
      await FS.remove(root)
    }
  })

  Test('publication failure refuses readiness and rolls back only the captured spawn', async () => {
    const root = await mkTestDir('loop-publication-failure-')
    const indexRoot = FS.resolvePath('index', root)
    let captured: ReturnType<typeof ProcessTree.identities> | undefined
    try {
      await withCapturedOutput(async () => {
        await Expect(
          startStudioProcessTree(Platform.runtimeProcess.execPath, {
            args: ['-e', 'setInterval(() => {}, 1000)'],
            cwd: root,
            resourceIndexRoot: indexRoot,
            beforeLaunchPublication: process => {
              captured = new Map([[process.pid, process]])
              Errors.throwHostEnvironment('controlled publication failure')
            },
          }),
        ).rejects.toThrow('launch refused')
      })
      Expect(captured?.size).toBe(1)
      await until(() =>
        [...captured!.values()].every(process => {
          const current = ProcessTree.identities([process.pid]).get(process.pid)
          return current === undefined
            ? !Platform.processIsAlive(process.pid)
            : !ProcessTree.sameProcess(current, process)
        }), { description: 'refused launch rollback' })
      const report = await ResourceInventory.inspect({
        checkout: root,
        mode: 'startup',
        indexRoot,
        machineRegistryRoot: FS.resolvePath('machine', root),
      })
      Expect(report.entries.map(entry => entry.classification)).toEqual(['unverified'])
    } finally {
      if (captured !== undefined) {
        ProcessTree.signalTracked([...captured.values()], 'SIGKILL')
      }
      await FS.remove(root)
    }
  })

  Test('snapshot persistence failure does not signal the process or report successful cleanup', async () => {
    const root = await mkTestDir('loop-snapshot-failure-')
    const indexRoot = FS.resolvePath('index', root)
    let failSnapshot = true
    let captured: ReturnType<typeof ProcessTree.identities> | undefined
    const tree = await startStudioProcessTree(Platform.runtimeProcess.execPath, {
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      resourceIndexRoot: indexRoot,
      beforeShutdownSnapshot: process => {
        captured = new Map([[process.pid, process]])
        if (failSnapshot) {
          Errors.throwHostEnvironment('controlled snapshot failure')
        }
      },
    })
    try {
      const output = await withCapturedOutput(() => tree.kill('SIGTERM'))
      Expect(output.result).toBe(false)
      Expect(tree.isRunning()).toBe(true)
      Expect(() => tree.assertCleanup!()).toThrow('Descendant cleanup remains uncertain')
    } finally {
      failSnapshot = false
      if (captured !== undefined) {
        ProcessTree.signalTracked([...captured.values()], 'SIGKILL')
      }
      await tree.waitForClose()
      tree.dispose()
      await FS.remove(root)
    }
  })
  Test('shutdown captures an escaped descendant and preserves an unrelated identical launch', async () => {
    const root = await mkTestDir('loop-escaped-descendant-')
    const indexRoot = FS.resolvePath('index', root)
    const ready = FS.resolvePath('escaped.pid', root)
    const other = await startStudioProcessTree(Platform.runtimeProcess.execPath, {
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      resourceIndexRoot: indexRoot,
    })
    const tree = await startStudioProcessTree(Platform.runtimeProcess.execPath, {
      args: [
        '-e',
        `
        import { FS, Platform, Time } from ${JSON.stringify(sharedModule)};
        const escaped = Platform.spawn(Platform.runtimeProcess.execPath,
          { args: ['-e', 'setInterval(() => {}, 1000)'], detached: true, stdio: 'ignore' });
        await FS.writeText(${JSON.stringify(ready)}, String(escaped.pid));
        while (true) await Time.sleep(1000);
      `,
      ],
      cwd: root,
      resourceIndexRoot: indexRoot,
    })
    let escaped: ReturnType<typeof ProcessTree.identities> | undefined
    try {
      await until(() => FS.isFile(ready), { description: 'owned escaped descendant ready' })
      const pid = Number(await FS.readText(ready))
      escaped = ProcessTree.identities([pid])
      Expect(escaped.has(pid)).toBe(true)
      Expect(ProcessTree.processGroupOf(pid)).toBe(pid)
      await stopStudioProcessTree(tree)
      Expect(ProcessTree.sameProcess(ProcessTree.identities([pid]).get(pid), escaped.get(pid)!)).toBe(false)
      Expect(other.isRunning()).toBe(true)
      await stopStudioProcessTree(other)
      Expect(await FS.listDir(indexRoot)).toEqual([])
    } finally {
      if (escaped !== undefined) {
        ProcessTree.signalTracked([...escaped.values()], 'SIGKILL')
      }
      const cleanup = await Promise.allSettled([stopStudioProcessTree(tree), stopStudioProcessTree(other)])
      for (const result of cleanup) {
        if (result.status === 'rejected') {
          throw result.reason
        }
      }
      await FS.remove(root)
    }
  })
  Test('a detached launch is discoverable after owner death and retires only after group shutdown', async () => {
    const root = await mkTestDir('loop-resource-provenance-')
    const indexRoot = FS.resolvePath('index', root)
    const child = await startStudioProcessTree(Platform.runtimeProcess.execPath, {
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      resourceIndexRoot: indexRoot,
    })
    const inspect = () =>
      ResourceInventory.inspect({
        checkout: root,
        mode: 'startup',
        indexRoot,
        machineRegistryRoot: FS.resolvePath('machine', root),
        inspectIdentities: pids => {
          const identities = ProcessTree.identities(pids)
          identities.delete(Platform.runtimeProcess.pid)
          return identities
        },
        inspectProcessAlive: pid => pid !== Platform.runtimeProcess.pid && Platform.processIsAlive(pid),
      })
    try {
      const orphaned = await inspect()
      Expect(orphaned.entries.filter(entry => entry.kind === 'process').map(entry => entry.classification))
        .toEqual(['stranded'])
      await stopStudioProcessTree(child)
      Expect((await inspect()).entries.filter(entry => entry.kind === 'process')).toEqual([])
      Expect(await FS.listDir(indexRoot)).toEqual([])
    } finally {
      if (child.isRunning()) {
        await stopStudioProcessTree(child)
      }
      await FS.remove(root)
    }
  })
  Test('hangup starts cleanup and repeated terminal signals drain that same cleanup', async () => {
    const callbacks = new Map<Platform.ProcessSignal, () => void>()
    const released: string[] = []
    const pending = Deferred()
    const exits: number[] = []
    const failures: unknown[] = []
    const remove = installDevLoopStopSignals(
      async code => {
        exits.push(code)
        await pending.promise
      },
      error => failures.push(error),
      (signal, callback) => {
        callbacks.set(signal, callback)
        return () => {
          released.push(signal)
        }
      },
    )
    callbacks.get('SIGHUP')!()
    await Promise.resolve()
    callbacks.get('SIGTERM')!()
    callbacks.get('SIGINT')!()
    await Promise.resolve()
    Expect(exits).toEqual([129])
    Expect(released).toEqual([])
    pending.resolve()
    await pending.promise
    remove()
    Expect(released).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP'])
    Expect(failures).toEqual([])
  })

  Test('cleanup failure is reported once without a second teardown', async () => {
    const callbacks: (() => void)[] = []
    const reported = Deferred<unknown>()
    const failure = new Errors.HostEnvironmentError('owned shutdown failed')
    let calls = 0
    const remove = installDevLoopStopSignals(
      async () => {
        calls += 1
        throw failure
      },
      error => reported.resolve(error),
      (_signal, callback) => {
        callbacks.push(callback)
        return () => {}
      },
    )
    callbacks[0]!()
    Expect(await reported.promise).toBe(failure)
    callbacks[1]!()
    await Promise.resolve()
    Expect(calls).toBe(1)
    remove()
  })

  Test('a root exit does not suppress escalation for a surviving process group', async () => {
    const signals: string[] = []
    let running = true
    let disposed = 0
    const tree = {
      kill(signal: string) {
        signals.push(signal)
        if (signal === 'SIGKILL') {
          running = false
        }
        return true
      },
      isRunning: () => running,
      closeOutput: async () => {},
      waitForClose: async () => ({ exitCode: 0, signal: null }),
      dispose: () => {
        disposed += 1
      },
    } as StudioProcessTree
    await stopStudioProcessTree(tree, {
      // budget-ok: injected sleep resolves immediately; this is a deterministic escalation threshold.
      timeoutMs: 25,
      sleep: async () => {},
    })
    Expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    Expect(disposed).toBe(1)
  })

  Test('failed group shutdown retains ownership and terminates the bounded wait', async () => {
    const signals: string[] = []
    let disposed = false
    const tree = {
      kill(signal: string) {
        signals.push(signal)
        return true
      },
      isRunning: () => true,
      dispose: () => {
        disposed = true
      },
    } as StudioProcessTree
    await Expect(stopStudioProcessTree(tree, {
      // budget-ok: injected sleep resolves immediately; this is a deterministic refusal threshold.
      timeoutMs: 25,
      sleep: async () => {},
      waitForClose: async () => {},
    })).rejects.toThrow('Process-group cleanup is incomplete')
    Expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    Expect(disposed).toBe(false)
  })
})
