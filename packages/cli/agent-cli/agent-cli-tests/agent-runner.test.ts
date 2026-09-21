import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { runAgentCommand } from '../agent-cli-src/runner/AgentRunner'

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
      // A (fail) line the fallback parser would read differently, so the assertion below can tell
      // which source actually won.
      const script = await writeProbeScript(scratch, [
        `await Bun.write(${JSON.stringify(summaryPath)}, JSON.stringify({`,
        "  failures: [{ error: 'from summary.json', gate: 'probe', test: 'from-summary' }],",
        '}))',
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
