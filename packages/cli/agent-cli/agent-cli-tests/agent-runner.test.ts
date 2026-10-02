import { FS, Platform, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, until, withCapturedOutput } from '@shared/test'
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
const STUDIO_WARNING = 'Native Studio tests open Electrobun windows. Native keyboard or Mac2 checks may take focus; '
  + 'external accessibility checks require macOS automation/accessibility consent.'

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
      const summaryPath = FS.resolvePath('.artifacts/logs/probe/run-1/summary.json', scratch)
      // The run is found through the immutable `Summary:` path it prints, just like a real lane.
      // A (fail) line the fallback parser would read differently, so the assertion below can tell
      // which source actually won.
      const script = await writeProbeScript(scratch, [
        `await Bun.write(${JSON.stringify(summaryPath)}, JSON.stringify({`,
        "  failures: [{ error: 'from summary.json', gate: 'probe', test: 'from-summary' }],",
        '}))',
        `${LOG}('Summary: .artifacts/logs/probe/run-1/summary.json')`,
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

  Test('reports only its own result while another command publishes a failing test summary', async () => {
    const scratch = await mkTestDir('tao-agent-runner-concurrent-summary-')
    try {
      for (const exitCode of [1, 0]) {
        const ready = FS.resolvePath(`ready-${exitCode}`, scratch)
        const release = FS.resolvePath(`release-${exitCode}`, scratch)
        const script = await writeProbeScript(scratch, [
          `await Bun.write(${JSON.stringify(ready)}, 'ready')`,
          `while (!await Bun.file(${JSON.stringify(release)}).exists()) {`,
          '  await new Promise(resolve => setImmediate(resolve))',
          '}',
          ...(exitCode === 0 ? [] : [
            `${LOG}('error: current command failure')`,
            `${LOG}('(fail) current command assertion')`,
          ]),
          `${EXIT}(${exitCode})`,
        ])
        const captured = await withCapturedOutput(async () => {
          const running = runAgentCommand({
            args: ['--json'],
            command: 'test-host',
            cwd: scratch,
            spawnArgs: [script],
            spawnCommand: 'bun',
          })
          try {
            await until(() => FS.exists(ready), { description: 'the reported command to start' })
            // This writer is independent of the running command. Its recent timestamp cannot
            // establish that the host command ran this unrelated compiler assertion.
            await FS.writeJson(FS.resolvePath('.artifacts/logs/dev-test/latest/summary.json', scratch), {
              failures: [{ gate: 'compiler', test: 'foreign test assertion' }],
            })
          } finally {
            await FS.writeText(release, 'continue')
          }
          return await running
        })
        Expect(captured.result).toBe(exitCode)
        const report = JSON.parse(captured.stdout) as { exitCode: number; failures: Array<{ test?: string }> }
        Expect(report.exitCode).toBe(exitCode)
        Expect(report.failures.map(failure => failure.test)).toEqual(
          exitCode === 0 ? [] : ['current command assertion'],
        )
      }
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

  Test('retains and deduplicates structured summary warnings without classifying child prose', async () => {
    const scratch = await mkTestDir('tao-agent-runner-warnings-summary-')
    try {
      await FS.writeJson(FS.resolvePath('summary.json', scratch), {
        gates: [],
        status: 'passed',
        version: 2,
        warnings: ['The selected child opens a visible window.', 'The selected child opens a visible window.'],
      })
      const script = await writeProbeScript(scratch, [
        `${LOG}('WARNING: arbitrary child prose')`,
        `${LOG}('Summary: summary.json')`,
        'for (let i = 0; i < 30; i += 1) {',
        `  ${LOG}(\`child line \${i}\`)`,
        '}',
        `${EXIT}(0)`,
      ])
      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: ['--json', '--max-lines', '1'],
          command: 'probe',
          cwd: scratch,
          spawnArgs: [script],
          spawnCommand: 'bun',
        })
      )

      const report = JSON.parse(captured.stdout) as { exitCode: number; tail: string[]; warnings: string[] }
      Expect(report.exitCode).toBe(0)
      Expect(report.warnings).toEqual(['The selected child opens a visible window.'])
      Expect(report.tail).toEqual(['child line 29'])
      Expect(captured.stdout.trim().split('\n').length).toBe(1)
      Expect(captured.stderr).toBe('')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('warns before a declared visible command starts, preserving one JSON object on stdout', async () => {
    const scratch = await mkTestDir('tao-agent-runner-warnings-start-')
    try {
      await FS.writeJson(FS.resolvePath('summary.json', scratch), {
        failures: [],
        warnings: [STUDIO_WARNING, 'A nested selected check may take focus.'],
      })
      const script = await writeProbeScript(scratch, [
        `${LOG}('child started')`,
        `${LOG}('Summary: summary.json')`,
        `${EXIT}(0)`,
      ])
      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: ['--show-studio', '--json', '--verbose'],
          command: 'verify-full',
          cwd: scratch,
          spawnArgs: [script],
          spawnCommand: 'bun',
        })
      )

      Expect(captured.result).toBe(0)
      Expect(captured.stderr).toBe(`WARNING: ${STUDIO_WARNING}\n`)
      Expect(captured.stdout.trim().split('\n').length).toBe(1)
      const report = JSON.parse(captured.stdout) as { warnings: string[] }
      Expect(report.warnings).toEqual([STUDIO_WARNING, 'A nested selected check may take focus.'])
      const log = await FS.readText(FS.resolvePath('.artifacts/logs/agent/verify-full/latest.log', scratch))
      Expect(log.startsWith(`WARNING: ${STUDIO_WARNING}\nchild started\n`)).toBe(true)
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('refuses visible host-control checks before spawning while reporting and logging the refusal', async () => {
    const scratch = await mkTestDir('tao-agent-runner-visible-refusal-')
    try {
      const marker = FS.resolvePath('spawned', scratch)
      const script = await writeProbeScript(scratch, [`await Bun.write(${JSON.stringify(marker)}, 'spawned')`])
      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: ['--json'],
          command: 'studio-host-control-smoke',
          cwd: scratch,
          spawnArgs: [script],
          spawnCommand: 'bun',
        })
      )

      Expect(captured.result).toBe(1)
      Expect(await FS.exists(marker)).toBe(false)
      const report = JSON.parse(captured.stdout) as { exitCode: number; tail: string[]; warnings: string[] }
      Expect(report.exitCode).toBe(1)
      Expect(report.tail.join('\n')).toContain('then pass --show-studio. No selected native checks were run.')
      Expect(report.warnings).toEqual([])
      const log = await FS.readText(
        FS.resolvePath('.artifacts/logs/agent/studio-host-control-smoke/latest.log', scratch),
      )
      Expect(log).toContain('then pass --show-studio. No selected native checks were run.')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('allows quiet full verification without visible Studio consent or warnings', async () => {
    const scratch = await mkTestDir('tao-agent-runner-quiet-verify-')
    try {
      const script = await writeProbeScript(scratch, [`${LOG}('quiet child ran')`, `${EXIT}(0)`])
      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: ['--json'],
          command: 'verify-full',
          cwd: scratch,
          spawnArgs: [script],
          spawnCommand: 'bun',
        })
      )

      Expect(captured.result).toBe(0)
      const report = JSON.parse(captured.stdout) as { exitCode: number; tail: string[]; warnings: string[] }
      Expect(report.exitCode).toBe(0)
      Expect(report.tail).toEqual(['quiet child ran'])
      Expect(report.warnings).toEqual([])
      Expect(captured.stderr).toBe('')
    } finally {
      await FS.remove(scratch)
    }
  })

  Test('keeps visible-command warnings ahead of streamed output and in the final successful report', async () => {
    const scratch = await mkTestDir('tao-agent-runner-warnings-verbose-')
    try {
      const script = await writeProbeScript(scratch, [`${LOG}('child started')`, `${EXIT}(0)`])
      const captured = await withCapturedOutput(() =>
        runAgentCommand({
          args: ['--show-studio', '--verbose'],
          command: 'verify-full',
          cwd: scratch,
          spawnArgs: [script],
          spawnCommand: 'bun',
        })
      )

      Expect(captured.result).toBe(0)
      const warning = `WARNING: ${STUDIO_WARNING}`
      Expect(captured.stdout.indexOf(warning)).toBeLessThan(captured.stdout.indexOf('child started'))
      Expect(captured.stdout.slice(captured.stdout.indexOf('REPORT:'))).toContain(warning)
      Expect(captured.stderr).toBe('')
    } finally {
      await FS.remove(scratch)
    }
  })
})

Describe('resolveRunStdio', () => {
  Test('offers shell setup only with a visible, answerable terminal', () => {
    for (const command of ['setup', 'shell-setup']) {
      Expect(resolveRunStdio(command, { verbose: false }, () => true).stdio).toBe('inherit')
      Expect(resolveRunStdio(command, { verbose: false }, () => false).stdio).toBe('pipe')
      Expect(resolveRunStdio(command, { verbose: true }, () => false).stdio).toBe('stream')
      Expect(resolveRunStdio(command, { verbose: false, json: true }, () => true).stdio).toBe('pipe')
    }
  })
  Test('Clerk setup keeps secret prompts on the terminal and out of captured logs', () => {
    Expect(resolveRunStdio('setup-clerk', { verbose: false }, () => true).stdio).toBe('inherit')
    Expect(resolveRunStdio('setup-clerk', { verbose: true }, () => true).stdio).toBe('inherit')
    Expect(resolveRunStdio('setup-clerk', { verbose: false }, () => false).stdio).toBe('pipe')
  })
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
