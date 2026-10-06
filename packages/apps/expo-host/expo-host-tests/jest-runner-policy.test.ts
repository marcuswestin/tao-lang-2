import { CLI, FS, Platform, Repo, Time } from '@shared'
import { Describe, Expect, Test, until } from '@shared/test'

const host = Repo.resolvePath('packages/apps/expo-host')
const args = [
  `${host}/node_modules/jest/bin/jest.js`,
  '--config',
  `${host}/expo-host-tests/fixtures/jest-runner-policy/jest.config.cjs`,
  '--runInBand',
  '--no-cache',
]

type Progress = { phase: string; kind: string; name: string; status?: string }

function progress(stderr: string): Progress[] {
  return stderr.split('\n').filter(line => line.startsWith('[tao-jest] '))
    .map(line => JSON.parse(line.slice('[tao-jest] '.length)) as Progress)
}

async function runProbe(unlimited: string | undefined, environment = 'node', fail = 'false') {
  let liveOutput = ''
  let completed = false
  let sawStartBeforeCompletion = false
  const result = await CLI.run('node', {
    args,
    cwd: Repo.getRoot(),
    env: {
      ...Platform.runtimeProcess.env,
      TAO_VERIFY_NO_TIMEOUTS: unlimited,
      TAO_VERIFY_LIVE_PROGRESS: 'true',
      TAO_JEST_PROBE_ENVIRONMENT: environment,
      TAO_JEST_PROBE_FAIL: fail,
      TAO_JEST_PROBE_PENDING: 'false',
    },
    onOutput: (_stream, chunk) => {
      liveOutput += chunk.toString()
      if (!completed && liveOutput.includes('"phase":"START"')) {
        sawStartBeforeCompletion = true
      }
    },
    processPolicy: 'test',
    timeoutPolicy: 'bounded',
    timeoutMs: 30_000,
  })
  completed = true
  await FS.writeText(
    Repo.resolvePath(`.artifacts/jest-policy-probe/${unlimited}-${environment}-${fail}.log`),
    result.stderr,
  )
  return { ...result, events: progress(result.stderr), sawStartBeforeCompletion }
}

Describe('Jest verification execution policy', () => {
  Test('ordinary and false opt-in executions retain both test and hook deadlines', async () => {
    for (const unlimited of [undefined, 'false', '1']) {
      const result = await runProbe(unlimited)
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Exceeded timeout of 1 ms for a test')
      Expect(result.stderr).toContain('Exceeded timeout of 1 ms for a hook')
      Expect(result.events.some(event => event.phase === 'END' && event.status === 'failed')).toBe(true)
    }
  })

  Test('explicit opt-in removes every Circus deadline while preserving Node and jsdom timers', async () => {
    for (const environment of ['node', 'jsdom']) {
      const result = await runProbe('true', environment)
      Expect(result.exitCode).toBe(0)
      Expect(result.sawStartBeforeCompletion).toBe(true)
      const testEnds = result.events.filter(event => event.kind === 'test' && event.phase === 'END')
      Expect(testEnds.filter(event => event.status === 'passed')).toHaveLength(6)
      Expect(testEnds.find(event => event.name === 'skipped probe')?.status).toBe('skipped')
      Expect(testEnds.find(event => event.name === 'future probe')?.status).toBe('todo')
      const concurrentEvents = result.events.filter(event => event.name === 'explicit concurrent budget')
      Expect(concurrentEvents.map(event => event.phase)).toEqual(['START', 'BODY_END', 'END'])
      Expect(concurrentEvents.map(event => event.status)).toEqual([undefined, 'completed', 'passed'])
      Expect(result.events.findIndex(event =>
        event.name === 'explicit concurrent budget'
        && event.phase === 'START'
      )).toBeLessThan(result.events.findIndex(event =>
        event.kind === 'hook'
        && event.phase === 'END' && event.name === 'beforeAll explicit hook budgets'
      ))
      for (const type of ['beforeAll', 'beforeEach', 'afterEach', 'afterAll']) {
        Expect(result.events.some(event =>
          event.kind === 'hook' && event.phase === 'START'
          && event.name.startsWith(type)
        )).toBe(true)
        Expect(result.events.some(event =>
          event.kind === 'hook' && event.phase === 'END'
          && event.status === 'passed' && event.name.startsWith(type)
        )).toBe(true)
      }
    }
  })

  Test('unlimited execution continues reporting ordinary assertion failures', async () => {
    const result = await runProbe('true', 'node', 'true')
    Expect(result.exitCode).toBe(1)
    Expect(
      result.events.find(event =>
        event.kind === 'test' && event.phase === 'END'
        && event.name === 'explicit promise budget'
      )?.status,
    ).toBe('failed')
    Expect(result.stderr).not.toContain('Exceeded timeout')
  })

  Test('a pending unlimited test remains live until explicitly cancelled', async () => {
    let output = ''
    let closed = false
    const child = CLI.start('node', {
      args,
      cwd: Repo.getRoot(),
      env: {
        ...Platform.runtimeProcess.env,
        TAO_VERIFY_NO_TIMEOUTS: 'true',
        TAO_JEST_PROBE_ENVIRONMENT: 'node',
        TAO_JEST_PROBE_PENDING: 'true',
      },
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
    })
    child.onceClose(() => {
      closed = true
    })
    try {
      await until(() => output.includes('PROBE_PENDING') || closed)
      Expect(output).toContain('PROBE_PENDING')
      // This deliberate observation window detects a missing keepalive causing early process exit.
      await Time.sleep(100)
      Expect(closed).toBe(false)
      Expect(child.exitCode).toBe(null)
      Expect(progress(output).some(event => event.phase === 'START' && event.name === 'pending work stays alive'))
        .toBe(true)
      Expect(progress(output).some(event => event.phase === 'END' && event.kind === 'test')).toBe(false)
    } finally {
      child.kill('SIGTERM')
      await child.waitForClose()
      await child.closeOutput()
      child.dispose()
    }
  })
})
