import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

async function probe(priority: number, refused = false) {
  const result = await CLI.mustRun(Platform.runtimeProcess.execPath, {
    args: [
      FS.resolvePath('fixtures/process-priority.ts', import.meta.dir),
      String(priority),
      refused ? 'refused' : 'allowed',
    ],
    processPolicy: 'test',
  })
  return JSON.parse(result.stdout)
}

Describe('process scheduling priority', () => {
  Test('lowers priority once and keeps repeated calls idempotent', async () => {
    Expect(await probe(0)).toEqual({ priority: 10, writes: [10] })
  })

  Test('never raises an already lower priority', async () => {
    Expect(await probe(15)).toEqual({ priority: 15, writes: [] })
  })

  Test('classifies an OS refusal as a host failure', async () => {
    Expect(await probe(0, true)).toEqual({
      failure: 'Could not lower command scheduling priority.',
      priority: 0,
      writes: [10],
    })
  })
})
