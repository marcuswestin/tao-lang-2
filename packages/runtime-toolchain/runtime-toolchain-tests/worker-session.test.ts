import type { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { WorkerSession, WorkerTesting } from '../runtime-toolchain-src/testing/test-compiler/Worker'

type FakeCommand = {
  command: CLI.StartedCommand
  events: string[]
}

Describe('test compiler worker session', () => {
  Test('allows the worker to stop gracefully after stdin ends', async () => {
    const fake = fakeCommand()

    await WorkerTesting.stopCommand(fake.command, {
      waitForClose: async () => ({ exitCode: 0, signal: null }),
    })

    Expect(fake.events).toEqual(['end-stdin', 'close-output', 'dispose'])
  })

  Test('forces a worker closed when graceful and terminated shutdown do not finish', async () => {
    const fake = fakeCommand()
    const closeResults = [undefined, undefined, { exitCode: null, signal: 'SIGKILL' as const }]

    await WorkerTesting.stopCommand(fake.command, {
      waitForClose: async () => closeResults.shift(),
    })

    Expect(fake.events).toEqual([
      'end-stdin',
      'kill SIGTERM',
      'kill SIGKILL',
      'close-output',
      'dispose',
    ])
  })

  Test('releases child-process resources when close never arrives', async () => {
    const fake = fakeCommand()

    await WorkerTesting.stopCommand(fake.command, {
      waitForClose: async () => undefined,
    })

    Expect(fake.events).toEqual([
      'end-stdin',
      'kill SIGTERM',
      'kill SIGKILL',
      'close-output',
      'dispose',
    ])
  })

  Test('does not restart after the session is stopped', async () => {
    const session = new WorkerSession()

    await session.stop()

    await Expect(session.validateTestFile('/unused.test.tao')).rejects.toThrow(
      'Test compiler worker session is stopped.',
    )
  })
})

function fakeCommand(): FakeCommand {
  const events: string[] = []
  return {
    command: {
      args: [],
      closeOutput: async () => {
        events.push('close-output')
      },
      command: 'fake-worker',
      dispose: () => events.push('dispose'),
      endStdin: () => events.push('end-stdin'),
      exitCode: null,
      kill: signal => {
        events.push(`kill ${signal ?? 'SIGTERM'}`)
        return true
      },
      onceClose() {},
      onceError() {},
      signalCode: null,
      waitForClose: async () => await new Promise<CLI.CommandCloseResult>(() => {}),
      writeStdin: () => true,
    },
    events,
  }
}
