import { CLI, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { startAppiumServer } from '../appium-driver-src/AppiumServer'

Describe('Appium server ownership', () => {
  Test('holds its isolated port through readiness and collects owned-process logs', async () => {
    const events: string[] = []
    const process = fakeProcess(events)
    const server = await startAppiumServer({
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47231,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      start: (_command, spec) => {
        spec?.onOutput?.('stderr', Buffer.from('Appium ready\n'))
        return process
      },
    })

    Expect(server.url).toBe('http://127.0.0.1:47231')
    Expect(server.logs()).toContain('Appium ready')
    Expect(events).toEqual([])
    await server.close()
    Expect(events).toEqual(['kill:SIGTERM', 'wait', 'close-output', 'dispose', 'release-port'])
    await server.close()
    Expect(events).toEqual(['kill:SIGTERM', 'wait', 'close-output', 'dispose', 'release-port'])
  })

  Test('stops the started process and returns the port when readiness fails', async () => {
    const events: string[] = []
    const process = fakeProcess(events)
    process.error = new Errors.HostEnvironmentError('appium executable is unavailable')

    await Expect(startAppiumServer({
      fetch: async () => new Response('{}', { status: 500 }),
      reservations: {
        reserve: async () => ({
          port: 47232,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      start: () => process,
    })).rejects.toThrow('Could not start Appium: appium executable is unavailable')
    Expect(events).toEqual(['kill:SIGTERM', 'wait', 'close-output', 'dispose', 'release-port'])
  })

  Test('escalates a nonresponsive owned process before releasing its port', async () => {
    const events: string[] = []
    const process = fakeProcess(events)
    let waits = 0
    process.waitForClose = async () => {
      waits += 1
      events.push(`wait:${waits}`)
      if (waits === 1) {
        return await new Promise(() => {})
      }
      return { exitCode: 0, signal: 'SIGKILL' }
    }
    const server = await startAppiumServer({
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47233,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      shutdownTimeoutMs: 1,
      start: () => process,
    })
    await server.close()
    Expect(events).toEqual([
      'kill:SIGTERM',
      'wait:1',
      'kill:SIGKILL',
      'wait:2',
      'close-output',
      'dispose',
      'release-port',
    ])
  })
})

function fakeProcess(events: string[]): ReturnType<typeof CLI.start> & { error?: Error } {
  return {
    args: [],
    closeOutput: async () => {
      events.push('close-output')
    },
    command: 'appium',
    dispose: () => {
      events.push('dispose')
    },
    endStdin: () => {},
    error: undefined,
    exitCode: null,
    kill: signal => {
      events.push(`kill:${signal ?? 'SIGTERM'}`)
      return true
    },
    onceClose: () => {},
    onceError: () => {},
    signalCode: null,
    waitForClose: async () => {
      events.push('wait')
      return { exitCode: 0, signal: null }
    },
    writeStdin: () => false,
  }
}
