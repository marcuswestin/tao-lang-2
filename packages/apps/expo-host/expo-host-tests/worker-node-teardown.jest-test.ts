import { jest } from '@jest/globals'
import { CLI, FS, Platform, ProcessTree, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { WorkerTesting } from '../expo-host-src/testing/test-compiler/Worker'

Describe('Node compiler worker teardown', () => {
  Test('reports an unavailable inspector instead of treating it as an empty process tree', () => {
    const spawn = jest.spyOn(Platform, 'spawnSync').mockReturnValue({
      output: [],
      pid: 0,
      signal: null,
      status: 1,
      stderr: Buffer.from('inspection denied'),
      stdout: Buffer.alloc(0),
    })
    try {
      Expect(() => ProcessTree.identities([Platform.runtimeProcess.pid])).toThrow(
        'Could not read macOS process identities',
      )
    } finally {
      spawn.mockRestore()
    }
  })

  Test('stops a stubborn worker and its escaped descendant while leaving a sibling alive', async () => {
    Expect(Platform.runtimeBunVersion).toBeUndefined()
    const root = await mkTestDir('tao-node-worker-teardown-')
    const executable = FS.resolvePath('worker.cjs', root)
    await CLI.mustRun('bun', {
      args: [
        'build',
        Repo.resolvePath('packages/apps/expo-host/expo-host-tests/fixtures/stubborn-worker.ts'),
        '--target=node',
        '--format=cjs',
        '--outfile',
        executable,
      ],
      processPolicy: 'test',
    })
    let output = ''
    const worker = CLI.start(Platform.runtimeProcess.execPath, {
      args: [executable],
      onOutput: (stream, chunk) => {
        if (stream === 'stdout') {
          output += chunk.toString()
        }
      },
      processPolicy: 'test',
      stdio: 'pipe',
    })
    const sibling = CLI.start(Platform.runtimeProcess.execPath, {
      args: ['-e', 'setInterval(() => {}, 1000)'],
      processPolicy: 'server',
      stdio: 'ignore',
    })
    let descendant: number | undefined
    try {
      descendant = await until(() => /^\d+\n$/.test(output) ? Number(output.trim()) : undefined, {
        description: 'the worker descendant to install its TERM handler',
      })

      await WorkerTesting.stopCommand(worker, {
        forceTimeoutMs: 30_000,
        gracefulTimeoutMs: 1,
        terminateTimeoutMs: 1,
      })

      await until(() => {
        const current = ProcessTree.identities([worker.pid!, descendant!])
        return !current.has(worker.pid!) && !current.has(descendant!)
      }, { description: 'the worker and escaped descendant to be reaped' })
      Expect(worker.signalCode).toBe('SIGKILL')
      const survivor = ProcessTree.identities([sibling.pid!]).get(sibling.pid!)
      Expect(survivor).toBeDefined()
      Expect(survivor!.command.length).toBeGreaterThan(0)
      Expect(survivor!.command).not.toContain('\0')
      // A stale snapshot must not turn the sibling into collateral damage.
      ProcessTree.signalTracked([{ ...survivor!, startedAt: 'stale-start-identity' }], 'SIGKILL')
      Expect(ProcessTree.identities([sibling.pid!]).get(sibling.pid!)).toEqual(survivor)
      Expect(sibling.exitCode).toBeNull()
      Expect(sibling.signalCode).toBeNull()
    } finally {
      // Independent cleanup also works when the intentionally tested inspection path throws.
      for (const pid of [descendant, worker.pid, sibling.pid]) {
        if (pid !== undefined) {
          Platform.spawnSync('/bin/kill', { args: ['-KILL', '--', String(pid)], stdio: 'ignore' })
        }
      }
      worker.dispose()
      sibling.dispose()
    }
  })
})
