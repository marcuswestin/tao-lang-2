import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type CapabilityProbe,
  classifyCapability,
  readAgentCapabilities,
  unavailableLandingCapabilities,
} from '../dev-cli-src/doctor/AgentCapabilities'

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

  Test('recognizes a failed CoreSimulator daemon as a host outage, not a sandbox denial', () => {
    const simulatorProbe = {
      ...probe,
      name: 'CoreSimulator service',
      remediation: 'Restart macOS.',
    }
    const result = classifyCapability(simulatorProbe, {
      exitCode: 1,
      stderr:
        'CoreSimulatorService connection became invalid. simdiskimaged crashed or is not responding: Operation not permitted',
      stdout: '',
    })

    Expect(result).toMatchObject({ remediation: 'Restart macOS.', status: 'unavailable' })
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

  Test('lets successful host probes override an inherited sandbox marker for landing', async () => {
    const report = await readAgentCapabilities({
      env: { CODEX_SANDBOX: 'seatbelt' },
      runProbe: availableProbe,
    })

    Expect(report.sandboxDetected).toBe(true)
    Expect(unavailableLandingCapabilities(report, 'darwin')).toEqual([])
  })

  Test('names only unavailable capabilities required by landing', async () => {
    const report = await readAgentCapabilities({
      env: {},
      runProbe: async candidate =>
        candidate.name === 'CoreSimulator service'
          ? { exitCode: 1, stderr: 'service unavailable', stdout: '' }
          : availableProbe(candidate),
    })

    Expect(unavailableLandingCapabilities(report, 'darwin').map(check => check.name)).toEqual(['CoreSimulator service'])
  })

  Test('requires the simulator and native launcher for landing only on macOS', async () => {
    const report = await readAgentCapabilities({
      env: {},
      runProbe: async candidate =>
        candidate.name === 'CoreSimulator service' || candidate.command === 'hutch'
          ? { exitCode: 127, stderr: `${candidate.command}: command not found`, stdout: '' }
          : candidate.command === 'watchman'
          ? { exitCode: 1, stderr: 'unable to talk to your watchman', stdout: '' }
          : availableProbe(candidate),
    })

    Expect(unavailableLandingCapabilities(report, 'linux').map(check => check.name)).toEqual(['Watchman socket'])
    Expect(unavailableLandingCapabilities(report, 'darwin').map(check => check.name).sort()).toEqual([
      'CoreSimulator service',
      'Hutch native launcher',
      'Watchman socket',
    ])
  })

  Test('classifies every declared probe from its own result', async () => {
    const probed: Array<{ args: readonly string[]; command: string; display: string }> = []
    const report = await readAgentCapabilities({
      env: {},
      runProbe: async candidate => {
        probed.push(candidate)
        return candidate.command === 'docker'
          ? { exitCode: 1, stderr: 'Cannot connect to the Docker daemon: operation not permitted', stdout: '' }
          : availableProbe(candidate)
      },
    })

    Expect(report.version).toBe(1)
    Expect(probed.map(candidate => candidate.command)).toContain('docker')
    Expect(probed.find(candidate => candidate.command === 'ps')).toMatchObject({
      args: ['-axo', 'pid=,ppid=,lstart=,command='],
      command: 'ps',
      display: 'ps -axo pid=,ppid=,lstart=,command=',
    })
    Expect(probed.find(candidate => candidate.command === 'hutch')).toMatchObject({
      args: ['--version'],
      command: 'hutch',
      display: 'hutch --version',
    })
    Expect(report.checks.length).toBe(probed.length)
    Expect(report.checks.find(check => check.name === 'Docker daemon')?.status).toBe('denied')
    Expect(report.checks.filter(check => check.status === 'available').length).toBe(report.checks.length - 1)
  })

  Test('reports a probe that cannot spawn without abandoning the other checks', async () => {
    const report = await readAgentCapabilities({
      env: {},
      runProbe: async candidate => {
        if (candidate.command === 'ps') {
          Errors.throwHostEnvironment('posix_spawn denied by sandbox')
        }
        return availableProbe(candidate)
      },
    })

    Expect(report.checks.find(check => check.name === 'process table')).toMatchObject({
      detail: 'posix_spawn denied by sandbox',
      status: 'denied',
    })
    Expect(report.checks.filter(check => check.status === 'available').length).toBe(report.checks.length - 1)
  })

  Test('blocks landing when the native launcher is missing even though the other required probes pass', async () => {
    const report = await readAgentCapabilities({
      runProbe: async candidate =>
        candidate.command === 'hutch'
          ? { exitCode: 127, stderr: 'hutch: command not found', stdout: '' }
          : availableProbe(candidate),
    })

    Expect(unavailableLandingCapabilities(report, 'darwin')).toMatchObject([{
      command: 'hutch --version',
      detail: 'hutch: command not found',
      name: 'Hutch native launcher',
      status: 'unavailable',
    }])
  })

  Test('rejects unsupported or unidentified Hutch versions despite a successful exit', async () => {
    for (
      const [stdout, detail] of [
        ['Hutch 0.24.2', 'Expected version 0.24.3; found 0.24.2'],
        ['Hutch 0.24.30', 'Expected version 0.24.3; found 0.24.30'],
        ['Hutch 0.24.3-beta.1', 'Expected version 0.24.3; found 0.24.3-beta.1'],
        ['ok', 'Expected version 0.24.3; no version reported'],
      ] as const
    ) {
      const report = await readAgentCapabilities({
        runProbe: async candidate =>
          candidate.command === 'hutch'
            ? { exitCode: 0, stderr: '', stdout }
            : availableProbe(candidate),
      })

      Expect(unavailableLandingCapabilities(report, 'darwin')).toMatchObject([{
        detail,
        name: 'Hutch native launcher',
        status: 'unavailable',
      }])
    }
  })

  Test('accepts the pinned Hutch launcher from PATH without running installation commands', async () => {
    const probed: CapabilityProbe[] = []
    const report = await readAgentCapabilities({
      runProbe: async candidate => {
        probed.push(candidate)
        return availableProbe(candidate)
      },
    })

    Expect(report.checks.find(check => check.name === 'Hutch native launcher')).toMatchObject({ status: 'available' })
    Expect(unavailableLandingCapabilities(report, 'darwin')).toEqual([])
    Expect(probed.filter(candidate => candidate.command === 'hutch').map(candidate => candidate.args))
      .toEqual([['--version']])
  })
})

async function availableProbe(
  candidate: CapabilityProbe,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return { exitCode: 0, stderr: '', stdout: candidate.command === 'hutch' ? 'Hutch 0.24.3' : 'ok' }
}
