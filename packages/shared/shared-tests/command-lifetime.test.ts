import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

Describe('command lifetime', () => {
  async function probe(mode: string) {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [FS.resolvePath('fixtures/command-lifetime.ts', import.meta.dir), mode],
      processPolicy: 'test',
    })
    Expect(result.exitCode).toBe(0)
    Expect(result.stderr).toBe('')
    return JSON.parse(result.stdout)
  }

  Test('joins exit with closed pipes when aggregate close is missing, then releases the child', async () => {
    Expect(await probe('close')).toEqual({
      pipesClosed: true,
      controlCollected: true,
      exitDelivered: true,
      pendingAfterExit: true,
      pendingBeforeAggregate: false,
      retainedAfterExit: true,
      outputPreserved: true,
      pendingBeforeDelivery: true,
      released: true,
    })
  })

  Test('keeps auxiliary descriptors on the native aggregate close contract', async () => {
    const result = await probe('aux')
    Expect(result.pendingBeforeAggregate).toBe(true)
    Expect(result.outputPreserved).toBe(true)
    Expect(result.released).toBe(true)
  })

  Test('releases a disposed child whose close notification is no longer observed', async () => {
    Expect(await probe('dispose')).toEqual({
      pipesClosed: false,
      controlCollected: true,
      exitDelivered: false,
      pendingAfterExit: true,
      pendingBeforeAggregate: true,
      retainedAfterExit: false,
      outputPreserved: false,
      pendingBeforeDelivery: true,
      released: true,
    })
  })
})
