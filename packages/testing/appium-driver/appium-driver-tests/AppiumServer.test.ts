import { CLI, Errors, Platform, ProcessTree } from '@shared'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { mobileAppiumEnvironment, startMobileAppiumServer } from '../appium-driver-src/AppiumMobileServer'
import { startAppiumServer } from '../appium-driver-src/AppiumServer'

Describe('Appium server ownership', () => {
  for (const closure of ['proved', 'denied'] as const) {
    Test(`failed server startup reports ${closure} owned cleanup after its kernel group probe`, async () => {
      const events: string[] = []
      const cleanup: boolean[] = []
      await Expect(startAppiumServer({
        detached: true,
        start: () => ({ ...fakeProcess(events), pid: 987 }),
        onStarted: async () => {
          Errors.throwHostEnvironment('planned startup failure')
        },
        onStartupCleanup: proved => {
          cleanup.push(proved)
        },
        reservations: {
          reserve: async () => ({
            port: 47239,
            release: async () => {
              events.push('release-port')
            },
          }),
        },
        processTree: {
          descendants: () => [],
          identities: () => new Map(),
          processGroupOf: () => 987,
          signalTracked: () => {},
          groupMembers: () => [],
          isGroupAlive: group =>
            ProcessTree.isGroupAlive(
              group,
              () => closure === 'denied' ? Errors.throwHostEnvironment('kernel probe denied') : false,
              { platform: 'darwin' },
            ),
        },
      })).rejects.toThrow(closure === 'proved' ? 'planned startup failure' : 'owned server could not be stopped')
      Expect(cleanup).toEqual([closure === 'proved'])
      Expect(events.includes('release-port')).toBe(closure === 'proved')
    })
  }
  for (const evidence of ['denied-probe', 'unreadable-members'] as const) {
    Test(`server cleanup retains every port after ${evidence} group absence evidence`, async () => {
      const events: string[] = []
      const server = await startAppiumServer({
        detached: true,
        start: () => ({ ...fakeProcess(events), pid: 987 }),
        reservations: {
          reserve: async () => ({
            port: 47237,
            release: async () => {
              events.push('release-port')
            },
          }),
        },
        fetch: async () => new Response('{}', { status: 200 }),
        processTree: {
          descendants: () => [],
          identities: () => new Map(),
          processGroupOf: () => 987,
          signalTracked: () => {},
          groupMembers: () =>
            evidence === 'unreadable-members' ? Errors.throwHostEnvironment('unreadable members') : [],
          isGroupAlive: group =>
            ProcessTree.isGroupAlive(group, () => Errors.throwHostEnvironment('kernel probe denied'), {
              platform: 'darwin',
            }),
        },
      })
      await Expect(server.close()).rejects.toThrow(
        evidence === 'denied-probe' ? 'kernel probe denied' : 'unreadable members',
      )
      Expect(events).toEqual(['kill:SIGTERM', 'wait', 'close-output'])
    })
  }
  Test('startup cancellation interrupts a hung publication callback and still stops its owned server', async () => {
    const events: string[] = []
    const abort = new AbortController()
    const publication = Deferred<void>()
    const pending = startAppiumServer({
      signal: abort.signal,
      startupTimeoutMs: 10,
      reservations: {
        reserve: async () => ({
          port: 47235,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      start: () => fakeProcess(events),
      onStarted: async () => {
        abort.abort()
        await publication.promise
      },
      fetch: async () => Errors.throwUnexpected('Cancellation must prevent readiness polling.'),
    })
    try {
      await Expect(pending).rejects.toThrow('finite budget')
      Expect(events).toEqual(['kill:SIGTERM', 'wait', 'close-output', 'dispose', 'release-port'])
    } finally {
      publication.resolve()
    }
  })

  Test('unclosed process output exhausts cleanup budget and keeps the server port reserved', async () => {
    const events: string[] = []
    const output = Deferred<void>()
    const process = { ...fakeProcess(events), closeOutput: () => output.promise }
    const server = await startAppiumServer({
      shutdownTimeoutMs: 10,
      reservations: {
        reserve: async () => ({
          port: 47236,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      start: () => process,
      fetch: async () => new Response('{}', { status: 200 }),
    })
    try {
      await Expect(server.close()).rejects.toThrow('finite budget')
      Expect(events).toEqual(['kill:SIGTERM', 'wait'])
    } finally {
      output.resolve()
      await server.close()
    }
  })
  Test(
    'forwards scoped Xcode and filtered credentials through mobile driver discovery and server startup',
    async () => {
      const original = Platform.runtimeProcess.env['DEVELOPER_DIR']
      const input = {
        DEVELOPER_DIR: '/Applications/Xcode-beta.app/Contents/Developer',
        CLERK_SECRET_KEY: 'sentinel-secret-key',
        APPIUM_HOME: '/unowned-home',
      }
      const calls: string[] = []
      const environments: Record<string, string | undefined>[] = []
      await startMobileAppiumServer({
        artifactRoot: '/owned-artifacts',
        driver: 'xcuitest',
        environment: input,
        runId: 'scoped-run',
        quiet: true,
      }, {
        ensureDriver: async (driver, environment) => {
          Expect(driver).toBe('xcuitest')
          calls.push('discover-driver')
          environments.push(environment)
        },
        startServer: async options => {
          calls.push('start-server')
          environments.push(options.environment!)
          Expect(options.quiet).toBe(true)
          return { close: async () => {}, logs: () => '', url: 'http://127.0.0.1:4723' }
        },
      })
      Expect(calls).toEqual(['discover-driver', 'start-server'])
      for (const environment of environments) {
        Expect(environment['DEVELOPER_DIR']).toBe('/Applications/Xcode-beta.app/Contents/Developer')
        Expect(environment['APPIUM_HOME']).toBe('/owned-artifacts/appium-home')
        Expect(Object.hasOwn(environment, 'CLERK_SECRET_KEY')).toBe(true)
        Expect(environment['CLERK_SECRET_KEY']).toBeUndefined()
      }
      Expect(input.CLERK_SECRET_KEY).toBe('sentinel-secret-key')
      Expect(input.APPIUM_HOME).toBe('/unowned-home')
      Expect(Platform.runtimeProcess.env['DEVELOPER_DIR']).toBe(original)
    },
  )
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

  Test('mobile children explicitly clear inherited Clerk credentials and preserve other environment values', () => {
    const environment = mobileAppiumEnvironment('/owned-artifacts', {
      CLERK_SECRET_KEY: 'sentinel-secret-key',
      CLERK_TESTING_TOKEN: 'sentinel-testing-token',
      PATH: '/toolchain/bin',
      APPIUM_HOME: '/global-appium-home',
    })

    Expect(environment).toEqual({
      CLERK_SECRET_KEY: undefined,
      CLERK_TESTING_TOKEN: undefined,
      PATH: '/toolchain/bin',
      APPIUM_HOME: '/owned-artifacts/appium-home',
    })
    // Omission would let Platform restore the inherited credential during its environment merge.
    Expect(Object.hasOwn(environment, 'CLERK_SECRET_KEY')).toBe(true)
    Expect(Object.hasOwn(environment, 'CLERK_TESTING_TOKEN')).toBe(true)
  })

  Test('quiet sessions discard sensitive driver output while retaining process and port ownership', async () => {
    const events: string[] = []
    const process = fakeProcess(events)
    let startedSpec: CLI.CommandSpec | undefined
    const server = await startAppiumServer({
      fetch: async () => new Response('{}', { status: 200 }),
      quiet: true,
      reservations: {
        reserve: async () => ({
          port: 47234,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      start: (_command, spec) => {
        startedSpec = spec
        spec?.onOutput?.('stdout', Buffer.from('sentinel-secret-password'))
        spec?.onOutput?.('stderr', Buffer.from('sentinel-secret-token'))
        return process
      },
    })

    Expect(startedSpec?.stdio).toBe('ignore')
    Expect(startedSpec?.prefixedOutput).toBeUndefined()
    Expect(startedSpec?.onOutput).toBeUndefined()
    Expect(server.logs()).toBe('')
    Expect(events).toEqual([])
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
