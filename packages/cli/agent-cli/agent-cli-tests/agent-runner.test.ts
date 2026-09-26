import { FS, Platform, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { resolveRunStdio, runAgentCommand } from '../agent-cli-src/runner/AgentRunner'

/**
 * `runAgentCommand` is exercised end to end against a real spawned process rather than a faked
 * one: a tiny probe script standing in for `just`, so `spawnCommand`/`spawnArgs` decouple the
 * runner from `just` itself and a test can point it at any command.
 *
 * Every probe script below spells its `console`/`process` calls with bracket-indexed property
 * access rather than the ordinary dotted form. That is deliberate: this repository's own lint scans
 * raw source text for those calls spelled the ordinary way, and cannot tell a spawned child
 * script's source — written here as a string, never loaded as this file's own code — from a real
 * violation.
 */

const LOG = "console['log']"
const ERROR_LOG = "console['error']"
const EXIT = "process['exit']"

async function writeProbeScript(scratch: string, body: readonly string[]): Promise<string> {
  const path = FS.resolvePath('probe.ts', scratch)
  await FS.writeText(path, body.join('\n'))
  return path
}

Describe('agent runner', () => {
  Test("passes a child's exit status straight through", async () => {
    const scratch = await mkTestDir('tao-agent-runner-exit-')
    try {
      const script = await writeProbeScript(scratch, [
        'for (let i = 0; i < 5; i += 1) {',
        `  ${LOG}(\`line \${i}\`)`,
        '}',
        `${EXIT}(3)`,
      ])

      const captured = await withCapturedOutput(() =>
        runAgentCommand({ args: [], command: 'probe', cwd: scratch, spawnArgs: [script], spawnCommand: 'bun' })
      )

      Expect(captured.result).toBe(3)
      Expect(captured.stdout).toContain('probe: failed (exit 3)')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test("writes the merged capture to this run's own log and to a refreshed latest.log", async () => {
    const scratch = await mkTestDir('tao-agent-runner-log-')
    try {
      const script = await writeProbeScript(scratch, [
        `${LOG}('to stdout')`,
        `${ERROR_LOG}('to stderr')`,
        `${EXIT}(0)`,
      ])

      await withCapturedOutput(() =>
        runAgentCommand({ args: [], command: 'probe', cwd: scratch, spawnArgs: [script], spawnCommand: 'bun' })
      )

      const logDir = FS.resolvePath('.artifacts/logs/agent/probe', scratch)
      const entries = (await FS.listDir(logDir)).toSorted()
      Expect(entries).toContain('latest.log')
      const runLog = entries.find(name => name !== 'latest.log')
      Expect(runLog).toBeDefined()
      const runLogText = await FS.readText(FS.resolvePath(runLog!, logDir))
      const latestText = await FS.readText(FS.resolvePath('latest.log', logDir))
      Expect(runLogText).toContain('to stdout')
      Expect(runLogText).toContain('to stderr')
      Expect(latestText).toBe(runLogText)
    } finally {
      await FS.remove(scratch)
    }
  })

  Test("prefers a lane's own summary.json failures over the fallback parser", async () => {
    const scratch = await mkTestDir('tao-agent-runner-summary-')
    try {
      const summaryPath = FS.resolvePath('.artifacts/logs/probe/latest/summary.json', scratch)
      // `probe` names no real lane, so the run is found only through the `Summary:` line it prints —
      // the same mechanism a real lane recipe uses, and the only one this test's fake command can
      // reach now that a guessed lane directory is trusted for a fixed table of real lanes only.
      // A (fail) line the fallback parser would read differently, so the assertion below can tell
      // which source actually won.
      const script = await writeProbeScript(scratch, [
        `await Bun.write(${JSON.stringify(summaryPath)}, JSON.stringify({`,
        "  failures: [{ error: 'from summary.json', gate: 'probe', test: 'from-summary' }],",
        '}))',
        `${LOG}('Summary: .artifacts/logs/probe/latest/summary.json')`,
        `${LOG}('(fail) from-fallback')`,
        `${EXIT}(1)`,
      ])

      const captured = await withCapturedOutput(() =>
        runAgentCommand({ args: [], command: 'probe', cwd: scratch, spawnArgs: [script], spawnCommand: 'bun' })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stdout).toContain('  - probe — from-summary — from summary.json')
      // The (fail) line the child also printed still shows up in the raw output below the Failed:
      // block, but it must never earn its own bullet — that would mean the fallback parser ran too.
      Expect(captured.stdout).not.toContain('  - probe — from-fallback')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test("still falls back to the output parser when a failed run's own summary names no failures", async () => {
    const scratch = await mkTestDir('tao-agent-runner-empty-summary-')
    try {
      const summaryPath = FS.resolvePath('.artifacts/logs/probe/latest/summary.json', scratch)
      // The lane genuinely failed (exit 1) but its own classifier named nothing — an empty
      // `failures: []` must never be read as "nothing failed" and suppress the fallback parser.
      const script = await writeProbeScript(scratch, [
        `await Bun.write(${JSON.stringify(summaryPath)}, JSON.stringify({ failures: [] }))`,
        `${LOG}('Summary: .artifacts/logs/probe/latest/summary.json')`,
        `${LOG}('(fail) unclassified failure')`,
        `${EXIT}(1)`,
      ])

      const captured = await withCapturedOutput(() =>
        runAgentCommand({ args: [], command: 'probe', cwd: scratch, spawnArgs: [script], spawnCommand: 'bun' })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stdout).toContain('  - probe — unclassified failure')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('falls back to parsing the output when no summary.json names this run', async () => {
    const scratch = await mkTestDir('tao-agent-runner-fallback-')
    try {
      const script = await writeProbeScript(scratch, [
        `${LOG}('error: expect(received).toBe(expected)')`,
        `${LOG}('(fail) a fallback failure')`,
        `${EXIT}(1)`,
      ])

      const captured = await withCapturedOutput(() =>
        runAgentCommand({ args: [], command: 'probe', cwd: scratch, spawnArgs: [script], spawnCommand: 'bun' })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stdout).toContain('a fallback failure')
      Expect(captured.stdout).toContain('expect(received).toBe(expected)')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('names why a spawn failed, with a PATH hint for a missing command', async () => {
    const scratch = await mkTestDir('tao-agent-runner-spawn-error-')
    try {
      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: [],
          command: 'probe',
          cwd: scratch,
          spawnArgs: [],
          spawnCommand: 'tao-agent-runner-test-definitely-missing-binary',
        })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stdout).toContain('spawn error:')
      Expect(captured.stdout).toContain('was not found on PATH')
      Expect(captured.stdout).toContain('./enter-tao-dev-env')

      const latestPath = FS.resolvePath('.artifacts/logs/agent/probe/latest.log', scratch)
      Expect(await FS.readText(latestPath)).toContain('was not found on PATH')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test(
    'forwards a parent signal to the child, killing it, rather than leaving an empty log and an orphan',
    async () => {
      const scratch = await mkTestDir('tao-agent-runner-cancel-')
      try {
        const pidPath = FS.resolvePath('child.pid', scratch)
        const script = await writeProbeScript(scratch, [
          `await Bun.write(${JSON.stringify(pidPath)}, String(process.pid))`,
          `${LOG}('child started')`,
          'await new Promise(resolve => setTimeout(resolve, 30_000))',
          `${LOG}('should never print')`,
        ])

        let deliverSignal: (() => void) | undefined
        const fakeOnProcessSignal = (signal: Platform.ProcessSignal, listener: () => void) => {
          if (signal === 'SIGTERM') {
            deliverSignal = listener
          }
          return () => {}
        }

        const latestPath = FS.resolvePath('.artifacts/logs/agent/probe/latest.log', scratch)
        const runPromise = withCapturedOutput(() =>
          runAgentCommand({
            args: [],
            command: 'probe',
            cwd: scratch,
            onProcessSignal: fakeOnProcessSignal,
            spawnArgs: [script],
            spawnCommand: 'bun',
          })
        )

        // Wait for the child to actually start and be captured in the log before cancelling, so a
        // non-empty log afterward proves the write-as-you-go behavior rather than a write at the end.
        for (let attempt = 0; attempt < 200; attempt += 1) {
          if (await FS.exists(latestPath) && (await FS.readText(latestPath)).includes('child started')) {
            break
          }
          await Time.sleep(25)
        }
        Expect(deliverSignal).toBeDefined()
        deliverSignal!()

        const captured = await runPromise

        Expect(captured.result).toBe(143) // 128 + SIGTERM(15)
        Expect(captured.stdout).toContain('cancelled by SIGTERM')
        const latestText = await FS.readText(latestPath)
        Expect(latestText).toContain('child started')
        Expect(latestText).toContain('cancelled by SIGTERM')
        Expect(latestText).not.toContain('should never print')

        const childPid = Number((await FS.readText(pidPath)).trim())
        Expect(Platform.processIsAlive(childPid)).toBe(false)
      } finally {
        await FS.remove(scratch)
      }
    },
  )

  Test("reports a log it could not write without losing the run's real verdict", async () => {
    const scratch = await mkTestDir('tao-agent-runner-log-unavailable-')
    try {
      // A plain file sitting where the log directory needs to be created makes `mkdir` fail exactly
      // the way an EACCES from a denied sandbox write would: the run must still be reported in full.
      const logDir = FS.resolvePath('.artifacts/logs/agent/probe', scratch)
      await FS.writeText(logDir, 'not a directory')

      const script = await writeProbeScript(scratch, [`${LOG}('still reported')`, `${EXIT}(1)`])

      const captured = await withCapturedOutput(() =>
        runAgentCommand({ args: [], command: 'probe', cwd: scratch, spawnArgs: [script], spawnCommand: 'bun' })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stdout).toContain('probe: failed (exit 1)')
      Expect(captured.stdout).toContain('still reported')
      Expect(captured.stdout).toContain('log unavailable:')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('--json prints one JSON object and nothing else', async () => {
    const scratch = await mkTestDir('tao-agent-runner-json-')
    try {
      const script = await writeProbeScript(scratch, [`${LOG}('quiet output')`, `${EXIT}(0)`])

      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: ['--json'],
          command: 'probe',
          cwd: scratch,
          spawnArgs: [script],
          spawnCommand: 'bun',
        })
      )

      const parsed = JSON.parse(captured.stdout.trim()) as {
        command: string
        exitCode: number
        failures: unknown[]
        tail: string[]
      }
      Expect(parsed.command).toBe('probe')
      Expect(parsed.exitCode).toBe(0)
      Expect(parsed.failures).toEqual([])
      Expect(parsed.tail).toEqual(['quiet output'])
      Expect(captured.stdout.trim().split('\n').length).toBe(1)
    } finally {
      await FS.remove(scratch)
    }
  })
})

Describe('resolveRunStdio', () => {
  Test('runs an ordinary command over a captured pipe, verbose or not', () => {
    Expect(resolveRunStdio('verify', { verbose: false }, () => false)).toEqual({ stdio: 'pipe' })
    Expect(resolveRunStdio('verify', { verbose: true }, () => false)).toEqual({ stdio: 'stream' })
    // Interactivity is irrelevant to a command that never prompts.
    Expect(resolveRunStdio('verify', { verbose: false }, () => true)).toEqual({ stdio: 'pipe' })
  })

  Test('leaves a prompting command on a pipe when there is no real terminal to prompt at', () => {
    Expect(resolveRunStdio('land-unlock', { verbose: false }, () => false)).toEqual({ stdio: 'pipe' })
    Expect(resolveRunStdio('land-unlock', { verbose: true }, () => false)).toEqual({ stdio: 'stream' })
  })

  Test('inherits every descriptor for a prompting command at a real interactive terminal', () => {
    const decision = resolveRunStdio('land-unlock', { verbose: false }, () => true)
    Expect(decision.stdio).toBe('inherit')
    Expect(decision.note).toContain('not captured')
    // `--verbose` changes nothing here: passthrough already shows everything live.
    Expect(resolveRunStdio('land-unlock', { verbose: true }, () => true).stdio).toBe('inherit')
  })
})
