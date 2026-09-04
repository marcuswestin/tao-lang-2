import { Describe, Expect, Test } from '@shared/test'
import { classifyCapability } from '../dev-src/doctor/AgentCapabilities'

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
})
