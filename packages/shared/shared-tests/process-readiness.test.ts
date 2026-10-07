import { CLI, Errors, Time, waitForProcessReadiness } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

const CHILD_TIMEOUT_MS = 30_000

Describe('child process readiness', () => {
  Test('aborts a pending probe when its child fails, without starting a second probe', async () => {
    const child = { exitCode: null as number | null, signalCode: null }
    let probes = 0
    let aborted = 0
    await Expect(waitForProcessReadiness(
      child,
      signal => {
        probes++
        child.exitCode = 17
        return new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted++
            reject(Errors.abortError('Readiness probe aborted'))
          }, { once: true })
        })
      },
      () => 'original child diagnostic',
      'pending probe',
      CHILD_TIMEOUT_MS,
      {
        sleep: async () => {},
      },
    )).rejects.toThrow('pending probe failed to start (exit 17):\noriginal child diagnostic')
    Expect(probes).toBe(1)
    Expect(aborted).toBe(1)
  })

  Test('aborts an unfinished probe at its deadline and contains late rejection', async () => {
    let elapsed = 0
    let observedSignal: AbortSignal | undefined
    let rejectProbe: ((reason: unknown) => void) | undefined
    // budget-ok: fake time proves the deadline; there is no real child or network request.
    await Expect(waitForProcessReadiness(
      undefined,
      signal => {
        observedSignal = signal
        return new Promise<boolean>((_resolve, reject) => rejectProbe = reject)
      },
      () => 'waiting on target',
      'browser target',
      1_000,
      {
        now: () => elapsed,
        sleep: async duration => {
          elapsed += duration
        },
      },
    )).rejects.toThrow('browser target did not become ready within 1000 ms:\nwaiting on target')
    Expect(observedSignal?.aborted).toBe(true)
    rejectProbe?.(Errors.abortError('Late probe rejection'))
    await Promise.resolve()
  })

  Test('retains the first and recent diagnostics within a bounded failure report', async () => {
    const child = { exitCode: 7, signalCode: null }
    await Expect(
      waitForProcessReadiness(
        child,
        () => false,
        () => `original cause\n${'middle\n'.repeat(5_000)}recent failure`,
        'probe',
        CHILD_TIMEOUT_MS,
      ),
    )
      .rejects.toThrow(/original cause[\s\S]*startup output omitted[\s\S]*recent failure/u)
  })

  Test('reports a successful exit that happened before startup completed', async () => {
    await withChild('/bin/sh', ['-c', 'printf "stopped before startup\\n"; exit 0'], async (child, output) => {
      await child.waitForClose()
      await Expect(waitForProcessReadiness(child, () => false, output, 'probe', CHILD_TIMEOUT_MS))
        .rejects.toThrow('probe failed to start (exit 0):\nstopped before startup')
    })
  })
  Test('reports a child exit even when it printed the ready marker first', async () => {
    await withChild('/bin/sh', ['-c', 'printf "ready marker\\n"; exit 19'], async (child, output) => {
      await child.waitForClose()
      await Expect(
        waitForProcessReadiness(child, () => output().includes('ready marker'), output, 'probe', CHILD_TIMEOUT_MS),
      )
        .rejects.toThrow('probe failed to start (exit 19)')
      Expect(output()).toContain('ready marker')
    })
  })

  Test('reports a spawn error promptly', async () => {
    await withChild('/definitely-not-a-tao-command', [], async (child, output) => {
      await Expect(waitForProcessReadiness(child, () => false, output, 'probe', CHILD_TIMEOUT_MS))
        .rejects.toThrow(/spawn error/)
    })
  })

  Test('reports child failure while an asynchronous readiness probe stays pending', async () => {
    await withChild(
      '/bin/sh',
      ['-c', 'read reply; printf "original startup error\\n"; exit 23'],
      async (child, output) => {
        await Expect(waitForProcessReadiness(
          child,
          () => {
            child.endStdin()
            return new Promise<boolean>(() => {})
          },
          output,
          'pending HTTP probe',
          CHILD_TIMEOUT_MS,
        ))
          .rejects.toThrow('pending HTTP probe failed to start (exit 23):\noriginal startup error')
        Expect(child.exitCode).toBe(23)
      },
      'pipe',
    )
  })

  Test('keeps the deadline active while an asynchronous readiness probe stays pending', async () => {
    await withChild('/bin/sh', ['-c', 'printf "waiting for response\\n"; exec sleep 30'], async (child, output) => {
      await Time.pollUntil(() => output().length > 0, { intervalMs: 25, timeoutMs: CHILD_TIMEOUT_MS })
      let elapsed = 0
      // budget-ok: fake time proves the deadline without waiting for a network request.
      await Expect(
        waitForProcessReadiness(child, () => new Promise<boolean>(() => {}), output, 'HTTP response', 1_000, {
          intervalMs: 100,
          now: () => elapsed,
          sleep: async duration => {
            elapsed += duration
          },
        }),
      ).rejects.toThrow('HTTP response did not become ready within 1000 ms:\nwaiting for response')
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
        waitForProcessReadiness(child, () => output().includes('ready marker'), output, 'probe', CHILD_TIMEOUT_MS),
      )
        .rejects.toThrow('probe failed to start (signal SIGTERM)')
    })
  })

  Test('resolves when readiness arrives while the child remains healthy', async () => {
    await withChild('/bin/sh', ['-c', 'printf "ready marker\\n"; exec sleep 30'], async (child, output) => {
      await waitForProcessReadiness(
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
        await Expect(waitForProcessReadiness(child, () => false, output, 'server port', 1_000, {
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
  stdin: 'pipe' | 'ignore' = 'ignore',
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
    stdio: [stdin, 'pipe', 'pipe'],
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
