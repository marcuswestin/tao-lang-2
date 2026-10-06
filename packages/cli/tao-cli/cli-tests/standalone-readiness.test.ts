import { CLI, Time } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { waitForStandaloneReadiness } from '../cli-src/standalone-readiness'

const CHILD_TIMEOUT_MS = 30_000

Describe('standalone acceptance readiness', () => {
  Test('reports a successful exit that happened before startup completed', async () => {
    await withChild('/bin/sh', ['-c', 'printf "stopped before startup\\n"; exit 0'], async (child, output) => {
      await child.waitForClose()
      await Expect(waitForStandaloneReadiness(child, () => false, output, 'probe', CHILD_TIMEOUT_MS))
        .rejects.toThrow('probe failed to start (exit 0):\nstopped before startup')
    })
  })
  Test('reports a child exit even when it printed the ready marker first', async () => {
    await withChild('/bin/sh', ['-c', 'printf "ready marker\\n"; exit 19'], async (child, output) => {
      await child.waitForClose()
      await Expect(
        waitForStandaloneReadiness(child, () => output().includes('ready marker'), output, 'probe', CHILD_TIMEOUT_MS),
      )
        .rejects.toThrow('probe failed to start (exit 19)')
      Expect(output()).toContain('ready marker')
    })
  })

  Test('reports a spawn error promptly', async () => {
    await withChild('/definitely-not-a-tao-command', [], async (child, output) => {
      await Expect(waitForStandaloneReadiness(child, () => false, output, 'probe', CHILD_TIMEOUT_MS))
        .rejects.toThrow(/spawn error/)
    })
  })

  Test('reports a signal even when the child printed the ready marker first', async () => {
    await withChild('/bin/sh', ['-c', 'printf "ready marker\\n"; exec sleep 30'], async (child, output) => {
      await Time.pollUntil(() => output().includes('ready marker') || child.error, {
        intervalMs: 25,
        timeoutMs: CHILD_TIMEOUT_MS,
      })
      child.kill('SIGTERM')
      await child.waitForClose()
      await Expect(
        waitForStandaloneReadiness(child, () => output().includes('ready marker'), output, 'probe', CHILD_TIMEOUT_MS),
      )
        .rejects.toThrow('probe failed to start (signal SIGTERM)')
    })
  })

  Test('resolves when readiness arrives while the child remains healthy', async () => {
    await withChild('/bin/sh', ['-c', 'printf "ready marker\\n"; exec sleep 30'], async (child, output) => {
      await waitForStandaloneReadiness(
        child,
        () => output().includes('ready marker'),
        output,
        'probe',
        CHILD_TIMEOUT_MS,
      )
      Expect(output()).toContain('ready marker')
    })
  })

  Test('times out a live child without a port and preserves its diagnostic', async () => {
    await withChild(
      '/bin/sh',
      ['-c', 'printf "server started without a port\\n"; exec sleep 30'],
      async (child, output) => {
        await Time.pollUntil(() => output().length > 0, { intervalMs: 25, timeoutMs: CHILD_TIMEOUT_MS })
        let elapsed = 0
        // budget-ok: fake time advances synchronously; the live child is stopped in finally.
        await Expect(waitForStandaloneReadiness(child, () => false, output, 'server port', 1_000, {
          intervalMs: 100,
          now: () => elapsed,
          sleep: async duration => {
            elapsed += duration
          },
        })).rejects.toThrow('server port did not become ready within 1000 ms:\nserver started without a port')
      },
    )
  })
})

async function withChild(
  command: string,
  args: string[],
  run: (child: CLI.StartedCommand, output: () => string) => Promise<void>,
): Promise<void> {
  let captured = ''
  const child = CLI.start(command, {
    args,
    processPolicy: 'test',
    timeoutPolicy: 'bounded',
    timeoutMs: CHILD_TIMEOUT_MS,
    onOutput: (_stream, chunk) => {
      captured += String(chunk)
    },
    stdio: 'pipe',
  })
  try {
    await run(child, () => captured)
  } finally {
    child.kill('SIGTERM')
    await child.waitForClose()
    await child.closeOutput()
    child.dispose()
  }
}
