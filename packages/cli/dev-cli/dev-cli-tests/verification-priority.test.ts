import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

type PriorityProbe = {
  before: number
  atGate: number
  gateChild: number
  gateStatus: string
  repeated: number
  priorityCalls: number
  refused: boolean
  jobs: number
}

async function probe(lane: string): Promise<PriorityProbe> {
  const args = [FS.resolvePath('fixtures/verification-priority.ts', import.meta.dir), lane]
  const result = await CLI.run(Platform.runtimeProcess.execPath, {
    args,
    processPolicy: 'test',
  })
  Expect({ exitCode: result.exitCode, error: result.error }).toEqual({ exitCode: 0, error: undefined })
  const line = result.stdout.split('\n').find(line => line.startsWith('PRIORITY '))
  Expect(line).toBeDefined()
  const snapshot = JSON.parse(line!.slice('PRIORITY '.length)) as PriorityProbe
  if (snapshot.refused) {
    Expect(result.stderr).toContain('Could not lower command scheduling priority. Continuing at inherited priority.')
  } else {
    Expect(result.stderr).toBe('')
  }
  return snapshot
}

Describe('verification scheduling priority', () => {
  Test('full verification lowers only its own process and its gate children without changing jobs', async () => {
    const parentPriority = Platform.processPriority()
    for (const lane of ['default', 'verify', 'verify-full', 'verify-full-sandbox']) {
      const result = await probe(lane)
      Expect(result.priorityCalls).toBe(1)
      Expect(result.atGate).toBe(result.refused ? result.before : Math.max(result.before, 10))
      Expect(result.gateStatus).toBe('passed')
      Expect(result.gateChild).toBe(result.atGate)
      Expect(result.repeated).toBe(result.atGate)
      Expect(result.jobs).toBe(3)
    }
    Expect(Platform.processPriority()).toBe(parentPriority)
  })

  Test('reports a priority refusal and still runs the gates', async () => {
    const result = await probe('denied')
    Expect(result.refused).toBe(true)
    Expect(result.atGate).toBe(result.before)
    Expect(result.gateStatus).toBe('passed')
    Expect(result.gateChild).toBe(result.before)
    Expect(result.repeated).toBe(result.before)
    Expect(result.priorityCalls).toBe(1)
  })

  Test('leaves narrower and other gate commands at their inherited priority', async () => {
    for (const lane of ['verify-changed', 'check', 'test-all', 'custom']) {
      const result = await probe(lane)
      Expect(result.priorityCalls).toBe(0)
      Expect(result.atGate).toBe(result.before)
      Expect(result.gateStatus).toBe('passed')
      Expect(result.gateChild).toBe(result.before)
    }
  })
})
