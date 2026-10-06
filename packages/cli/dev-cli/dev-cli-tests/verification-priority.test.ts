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

const mockPriorityBoundary = Platform.runtimeProcess.env['CI'] === 'true'

async function probe(lane: string, ci: string | undefined): Promise<PriorityProbe> {
  const args = [
    FS.resolvePath('fixtures/verification-priority.ts', import.meta.dir),
    lane,
    ...(mockPriorityBoundary ? ['simulate-os-priority'] : []),
  ]
  const result = await CLI.run(Platform.runtimeProcess.execPath, {
    args,
    env: { CI: ci },
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
  Test('local full verification requests lower priority without changing jobs', async () => {
    const parentPriority = Platform.processPriority()
    for (const lane of ['default', 'verify', 'verify-full', 'verify-full-sandbox', 'verify-full-ci']) {
      const result = await probe(lane, undefined)
      Expect(result.priorityCalls).toBe(1)
      Expect(result.atGate).toBe(result.refused ? result.before : Math.max(result.before, 10))
      Expect(result.gateStatus).toBe('passed')
      Expect(result.gateChild).toBe(mockPriorityBoundary ? result.before : result.atGate)
      Expect(result.repeated).toBe(result.atGate)
      Expect(result.jobs).toBe(3)
    }
    Expect(Platform.processPriority()).toBe(parentPriority)
  })

  Test('reports a priority refusal and still runs the gates', async () => {
    const result = await probe('denied', 'false')
    Expect(result.refused).toBe(true)
    Expect(result.atGate).toBe(result.before)
    Expect(result.gateStatus).toBe('passed')
    Expect(result.gateChild).toBe(result.before)
    Expect(result.repeated).toBe(result.before)
    Expect(result.priorityCalls).toBe(1)
  })

  Test('CI keeps full verification and its real child at inherited priority', async () => {
    for (const lane of ['default', 'verify', 'verify-full', 'verify-full-sandbox', 'verify-full-ci']) {
      const result = await probe(lane, 'true')
      Expect(result.priorityCalls).toBe(0)
      Expect(result.atGate).toBe(result.before)
      Expect(result.gateStatus).toBe('passed')
      Expect(result.gateChild).toBe(result.before)
      Expect(result.repeated).toBe(result.before)
      Expect(result.jobs).toBe(3)
    }
  })

  Test('CI=false retains the local priority policy', async () => {
    const result = await probe('verify-full', 'false')
    Expect(result.priorityCalls).toBe(1)
    Expect(result.atGate).toBe(result.refused ? result.before : Math.max(result.before, 10))
    Expect(result.gateStatus).toBe('passed')
    Expect(result.gateChild).toBe(mockPriorityBoundary ? result.before : result.atGate)
    Expect(result.repeated).toBe(result.atGate)
  })

  Test('leaves narrower and other gate commands at their inherited priority', async () => {
    for (const lane of ['verify-changed', 'check', 'test-all', 'custom']) {
      const result = await probe(lane, 'false')
      Expect(result.priorityCalls).toBe(0)
      Expect(result.atGate).toBe(result.before)
      Expect(result.gateStatus).toBe('passed')
      Expect(result.gateChild).toBe(result.before)
    }
  })
})
