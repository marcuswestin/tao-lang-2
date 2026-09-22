import { Deferred, Expect, Test, until } from '@shared/test'
import { StudioPhoneSaveGate } from '../studio-src/client/app/StudioPhoneSaveGate'
import type { StudioDeviceConnection } from '../studio-src/device/StudioDeviceStatus'
import type { StudioDraftSyncResult } from '../studio-src/StudioDraftSync'

function compiled(revision: number): StudioDraftSyncResult {
  return {
    compile: {
      causes: ['studio-write'],
      changes: [{ path: 'Garden.tao' }],
      compileRevision: revision,
      diagnostics: [],
      message: `Compiled revision ${revision}.`,
      status: 'compiled',
    },
    diagnostics: [],
    file: { content: `revision ${revision}`, path: 'Garden.tao', sourceVersion: `source-${revision}` },
    saved: true,
  }
}

Test('Studio holds a later Save until the paired phone acknowledges the prior revision', async () => {
  const sleeps: Array<ReturnType<typeof Deferred<void>>> = []
  const writes: number[] = []
  const waiting: number[] = []
  let appliedRevision = 0
  const gate = new StudioPhoneSaveGate({
    now: () => 0,
    onWaiting: revision => waiting.push(revision),
    sleep: () => {
      const wait = Deferred<void>()
      sleeps.push(wait)
      return wait.promise
    },
    status: async () => ({
      connection: { appliedRevision, state: 'connected' } as StudioDeviceConnection,
    }),
  })
  const write = async (revision: number) => {
    writes.push(revision)
    return compiled(revision)
  }

  await gate.run(() => write(1))
  const second = gate.run(() => write(2))
  await until(() => sleeps.length === 1, { description: 'phone acknowledgement wait', intervalMs: 0 })
  Expect(writes).toEqual([1])
  Expect(waiting).toEqual([1])
  appliedRevision = 1
  sleeps[0]!.resolve()
  await second
  Expect(writes).toEqual([1, 2])
  appliedRevision = 2
  await until(() => sleeps.length === 2, { description: 'second phone acknowledgement wait', intervalMs: 0 })
  sleeps[1]!.resolve()
})

Test('Studio releases a queued Save after phone disconnect timeout and marks the revision unsynced', async () => {
  const writes: number[] = []
  const unsynced: number[] = []
  let clock = 0
  let connected = true
  const waits: Array<ReturnType<typeof Deferred<void>>> = []
  const gate = new StudioPhoneSaveGate({
    now: () => clock,
    onUnsynced: revision => unsynced.push(revision),
    pollMs: 5,
    sleep: async ms => {
      const wait = Deferred<void>()
      waits.push(wait)
      await wait.promise
      clock += ms
    },
    status: async () =>
      connected
        ? { connection: { appliedRevision: 0, state: 'connected' } as StudioDeviceConnection }
        : { connection: undefined },
    timeoutMs: 10,
  })

  await gate.run(async () => {
    writes.push(1)
    return compiled(1)
  })
  const second = gate.run(async () => {
    writes.push(2)
    return compiled(2)
  })
  connected = false
  await until(() => waits.length === 1, { description: 'first disconnected phone wait', intervalMs: 0 })
  Expect(writes).toEqual([1])
  waits[0]!.resolve()
  await until(() => waits.length === 2, { description: 'second disconnected phone wait', intervalMs: 0 })
  Expect(writes).toEqual([1])
  waits[1]!.resolve()
  await until(() => waits.length === 3, { description: 'phone disconnect timeout', intervalMs: 0 })
  Expect(writes).toEqual([1])
  waits[2]!.resolve()
  await second
  Expect(writes).toEqual([1, 2])
  Expect(unsynced).toEqual([1])
})

Test('closing an editor session cancels its queued Save without waiting for a connected phone', async () => {
  const writes: number[] = []
  const waiting = Deferred<void>()
  const gate = new StudioPhoneSaveGate({
    sleep: () => waiting.promise,
    status: async () => ({
      connection: { appliedRevision: 0, state: 'connected' } as StudioDeviceConnection,
    }),
  })
  await gate.run(async () => {
    writes.push(1)
    return compiled(1)
  })
  const second = gate.run(async () => {
    writes.push(2)
    return compiled(2)
  })

  gate.close()

  await Expect(second).rejects.toThrow('closed before this Save could run')
  Expect(writes).toEqual([1])
})

Test('closing after a Save reached the server preserves its successful result', async () => {
  const statusCalled = Deferred<void>()
  const status = Deferred<{ connection?: StudioDeviceConnection }>()
  const gate = new StudioPhoneSaveGate({
    status: async () => {
      statusCalled.resolve()
      return await status.promise
    },
  })
  const saved = gate.run(async () => compiled(1))
  await statusCalled.promise
  gate.close()
  status.resolve({ connection: { appliedRevision: 0, state: 'connected' } as StudioDeviceConnection })

  Expect((await saved).saved).toBe(true)
})
