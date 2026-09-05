import { Describe, Expect, Test } from '@shared/test'
import { classifyCapability, readAgentCapabilities } from '../dev-src/doctor/AgentCapabilities'

const probe = {
  args: ['-p', '42'],
  command: '/bin/ps',
  display: 'ps -p 42',
  name: 'process table',
  remediation: 'Run the approved shape.',
}

Describe('agent capabilities', () => {
  Test('reports a successful host probe as available', () => {
    Expect(classifyCapability(probe, { exitCode: 0, stderr: '', stdout: '42 node' })).toEqual({
      command: 'ps -p 42',
      detail: 'available',
      name: 'process table',
      status: 'available',
    })
  })

  Test('keeps a sandbox denial distinct from unavailable tooling', () => {
    const denied = classifyCapability(probe, {
      exitCode: 71,
      stderr: 'sandbox-exec: Operation not permitted',
      stdout: '',
    })
    const unavailable = classifyCapability(probe, {
      exitCode: 127,
      stderr: 'command not found',
      stdout: '',
    })

    Expect(denied.status).toBe('denied')
    Expect(unavailable.status).toBe('unavailable')
    Expect(denied.remediation).toBe('Run the approved shape.')
  })

  Test('accepts probe-specific informational exit codes', () => {
    Expect(
      classifyCapability({ ...probe, successfulExitCodes: [0, 1] }, {
        exitCode: 1,
        stderr: '',
        stdout: '',
      }).status,
    ).toBe('available')
  })

  Test('detects a sandbox only from a variable a sandboxed command sets', async () => {
    const sandboxed = await readAgentCapabilities({
      env: { CODEX_SANDBOX: 'seatbelt', PATH: '/usr/bin' },
      runProbe: availableProbe,
    })
    const unsandboxed = await readAgentCapabilities({
      // Claude Code exports this in every session, sandboxed or not, so it must not be a signal.
      env: { CLAUDE_CODE_TMPDIR: '/private/tmp/claude-501/session', PATH: '/usr/bin' },
      runProbe: availableProbe,
    })

    Expect(sandboxed.sandboxDetected).toBe(true)
    Expect(unsandboxed.sandboxDetected).toBe(false)
    Expect(await readAgentCapabilities({ env: { SANDBOX_RUNTIME: '1' }, runProbe: availableProbe }))
      .toMatchObject({ sandboxDetected: true })
    Expect(await readAgentCapabilities({ env: { SANDBOX_RUNTIME: '' }, runProbe: availableProbe }))
      .toMatchObject({ sandboxDetected: false })
  })

  Test('classifies every declared probe from its own result', async () => {
    const probed: string[] = []
    const report = await readAgentCapabilities({
      env: {},
      runProbe: async candidate => {
        probed.push(candidate.command)
        return candidate.command === 'docker'
          ? { exitCode: 1, stderr: 'Cannot connect to the Docker daemon: operation not permitted', stdout: '' }
          : { exitCode: 0, stderr: '', stdout: 'ok' }
      },
    })

    Expect(report.version).toBe(1)
    Expect(probed).toContain('docker')
    Expect(report.checks.length).toBe(probed.length)
    Expect(report.checks.find(check => check.name === 'Docker daemon')?.status).toBe('denied')
    Expect(report.checks.filter(check => check.status === 'available').length).toBe(report.checks.length - 1)
  })
})

async function availableProbe(): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return { exitCode: 0, stderr: '', stdout: 'ok' }
}
