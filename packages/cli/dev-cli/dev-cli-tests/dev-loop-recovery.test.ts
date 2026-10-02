import { FS, Platform, Repo } from '@shared'
import type { TrackedProcess } from '@shared/ProcessTree'
import { Expect, Test } from '@shared/test'
import { disposeDeadDevLoopConnection, recoverDevLoopProcesses } from '../dev-cli-src/dev-loop/DevLoopRecovery'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'

function receipt(provenance: 'complete' | 'uncertain'): DevLoopReceipt {
  const stamp = new Date().toISOString()
  return {
    version: 1,
    session: Platform.randomUUID(),
    checkout: '.',
    args: [],
    generation: Platform.randomUUID(),
    state: 'interrupted',
    createdAt: stamp,
    updatedAt: stamp,
    children: [{ command: 'owned', pid: 123, startedAt: 'original' }],
    provenance,
  }
}

Test('explicit recovery stops proven owned identities and leaves a reused PID untouched', async () => {
  const record = receipt('complete')
  record.children.push({ command: 'reused', pid: 234, startedAt: 'old' })
  const live = new Map<number, TrackedProcess>([[123, record.children[0]!], [234, {
    command: 'stranger',
    pid: 234,
    startedAt: 'new',
  }]])
  const signalled: number[] = []
  const recovered = await recoverDevLoopProcesses(record, {
    identities: () => live,
    descendants: pid => {
      Expect(pid).toBe(123)
      return []
    },
    signal: processes => {
      for (const process of processes) {
        if (live.get(process.pid)?.startedAt === process.startedAt) {
          signalled.push(process.pid)
          live.delete(process.pid)
        }
      }
    },
    now: () => 0,
    sleep: async () => {},
  })
  Expect(recovered.state).toBe('stopped')
  Expect(signalled).toEqual([123])
  Expect(live.get(234)?.command).toBe('stranger')
})

for (const ownership of ['matching', 'legacy', 'mismatched'] as const) {
  Test(
    `dead terminal private cleanup ${
      ownership === 'matching' ? 'removes proved' : 'retains unproved'
    } ${ownership} credentials`,
    async () => {
      const record = receipt('complete')
      record.checkout = FS.realPathSync(Repo.getRoot())
      record.state = 'stopped'
      record.controller = { pid: 123, startedAt: 'old-controller', command: 'owned controller' }
      await writeDevLoopReceipt(record)
      await writeDevLoopConnection({
        session: record.session,
        origin: 'http://127.0.0.1:1',
        token: Platform.randomUUID(),
        ...(ownership === 'legacy'
          ? {}
          : {
            generation: ownership === 'matching' ? record.generation : Platform.randomUUID(),
            controller: record.controller,
          }),
      })
      const directory = devLoopDirectory(record.session)
      try {
        const disposed = await FS.withFileMutationLock(
          FS.resolvePath('recovery.lock', directory),
          directory,
          () =>
            disposeDeadDevLoopConnection(
              record,
              () => new Map([[123, { pid: 123, startedAt: 'unrelated newer process', command: 'stranger' }]]),
            ),
        )
        Expect(disposed.state).toBe(ownership === 'matching' ? 'stopped' : 'cleanup-failed')
        Expect(disposed.cleanupOutcome).toBe(ownership === 'matching' ? 'proved' : 'retained')
        Expect(disposed.controllerDisposed).toBe(ownership === 'matching' ? true : undefined)
        Expect(await FS.exists(FS.resolvePath('active-control', directory))).toBe(ownership !== 'matching')
      } finally {
        await FS.remove(directory)
      }
    },
  )
}

Test('recovery preserves uncertainty and device fences after recorded processes are gone', async () => {
  const record = receipt('uncertain')
  record.devices = [{
    platform: 'ios',
    id: 'OWNED-UDID',
    owned: true,
    state: 'retained',
    generation: 'device-generation',
  }]
  const recovered = await recoverDevLoopProcesses(record, {
    identities: () => new Map(),
    descendants: () => [],
    signal: () => {},
    sleep: async () => {},
    now: () => 0,
  })
  Expect(recovered.state).toBe('cleanup-failed')
  Expect(recovered.devices).toEqual(record.devices)
  Expect(recovered.children).toEqual(record.children)
  Expect(recovered.message).toContain('unproved')
})
