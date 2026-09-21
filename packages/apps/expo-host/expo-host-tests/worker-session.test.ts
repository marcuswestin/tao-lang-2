import { type CLI, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Protocol } from '../expo-host-src/testing/test-compiler/Protocol'
import { WorkerSession, WorkerTesting } from '../expo-host-src/testing/test-compiler/Worker'

type FakeCommand = {
  command: CLI.StartedCommand
  events: string[]
}

Describe('test compiler worker session', () => {
  Test('round-trips Tao error categories without exposing raw worker failures', () => {
    const failures = [
      new Errors.UserInputError('Fix the test input.'),
      new Errors.UnexpectedBehaviorError('Compiler invariant failed.'),
      new Errors.HostEnvironmentError('Compiler host unavailable.'),
    ]

    const restored = failures.map(error => Protocol.errorFromFailure(Protocol.failureFromError(error)))
    Expect(restored[0]).toBeInstanceOf(Errors.UserInputError)
    Expect(restored[1]).toBeInstanceOf(Errors.UnexpectedBehaviorError)
    Expect(restored[2]).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(restored.map(Errors.messageOf)).toEqual(failures.map(Errors.messageOf))

    const unknown = Protocol.errorFromFailure(Protocol.failureFromError({ message: 'secret compiler stack' }))
    Expect(unknown).toBeInstanceOf(Errors.UnexpectedBehaviorError)
    Expect(Errors.messageOf(unknown)).toBe('Something went wrong while compiling Tao tests.')
  })

  Test('bounds and sanitizes categorized worker messages and fatal stderr', () => {
    const failure = Protocol.failureFromError(
      new Errors.UserInputError(`bad\u001b[31m\u0000${'x'.repeat(2_000)}`),
    )
    Expect(failure.message.includes('\u001b')).toBe(false)
    Expect(failure.message.includes('\u0000')).toBe(false)
    Expect(failure.message.length).toBe(800)

    const close = WorkerTesting.formatWorkerClose(
      { exitCode: 1, signal: null },
      `old-secret\u001b[31m${'y'.repeat(2_500)}\u0000tail`,
    )
    Expect(close).toStartWith('Test compiler worker exited with 1.\n…')
    Expect(close.includes('old-secret')).toBe(false)
    Expect(close.includes('\u001b')).toBe(false)
    Expect(close.includes('\u0000')).toBe(false)
    Expect(close).toEndWith('tail')
  })

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
