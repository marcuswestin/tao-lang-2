import { CLI, Errors, Platform, ProcessTree } from '@shared'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { mobileAppiumEnvironment, startMobileAppiumServer } from '../appium-driver-src/AppiumMobileServer'
import { startAppiumServer } from '../appium-driver-src/AppiumServer'

const serverRoot = { command: 'appium', pid: 987, startedAt: 'server-start' }

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
          identities: pids => new Map(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot]] : []),
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
          identities: pids => new Map(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot]] : []),
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
      Expect(events).toEqual([])
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

  Test('kills a captured descendant after the direct Appium process exits on TERM', async () => {
    const events: string[] = []
    const child = { command: 'xcodebuild', pid: 2_147_480_001, startedAt: 'child-start' }
    let alive = true
    const server = await startAppiumServer({
      detached: true,
      shutdownTimeoutMs: 10,
      start: () => ({ ...fakeProcess(events), pid: 987 }),
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47240,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      processTree: {
        descendants: () => [child],
        identities: pids =>
          new Map([
            ...(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot] as const] : []),
            ...(pids.includes(child.pid) && alive ? [[child.pid, child] as const] : []),
          ]),
        processGroupOf: () => child.pid,
        signalTracked: (_children, signal) => {
          events.push(`child:${signal}`)
          if (signal === 'SIGKILL') {
            alive = false
          }
        },
        groupMembers: group => group === child.pid && alive ? [child] : [],
        isGroupAlive: group => group === child.pid && alive,
      },
    })
    await server.close()
    Expect(events).toEqual([
      'child:SIGTERM',
      'kill:SIGTERM',
      'wait',
      'child:SIGKILL',
      'wait',
      'close-output',
      'dispose',
      'release-port',
    ])
  })

  for (const outcome of ['transient', 'persistent'] as const) {
    Test(
      `post-TERM ${outcome} unreadable descendant ${
        outcome === 'transient' ? 'closes' : 'retains its port'
      } without another signal`,
      async () => {
        const events: string[] = []
        const child = { command: 'xcodebuild', pid: 2_147_480_006, startedAt: 'child-start' }
        let phase: 'live' | 'unreadable' | 'gone' = 'live'
        let unreadableProbes = 0
        const server = await startAppiumServer({
          detached: true,
          shutdownTimeoutMs: outcome === 'transient' ? 150 : 15,
          start: () => ({ ...fakeProcess(events), pid: serverRoot.pid }),
          fetch: async () => new Response('{}', { status: 200 }),
          reservations: {
            reserve: async () => ({
              port: 47245,
              release: async () => {
                events.push('release-port')
              },
            }),
          },
          processIsAlive: pid => {
            if (pid !== child.pid) {
              return false
            }
            unreadableProbes++
            if (outcome === 'transient' && unreadableProbes === 1) {
              phase = 'gone'
            }
            return outcome === 'persistent' || unreadableProbes === 1
          },
          processTree: {
            descendants: () => [child],
            identities: pids =>
              new Map([
                ...(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot] as const] : []),
                ...(pids.includes(child.pid) && phase === 'live' ? [[child.pid, child] as const] : []),
              ]),
            processGroupOf: () => child.pid,
            signalTracked: (_children, signal) => {
              events.push(`child:${signal}`)
              if (signal === 'SIGTERM') {
                phase = 'unreadable'
              }
            },
            groupMembers: group => group === child.pid && phase === 'live' ? [child] : [],
            isGroupAlive: group => group === child.pid && phase === 'live',
          },
        })
        if (outcome === 'transient') {
          await server.close()
          Expect(unreadableProbes).toBeGreaterThanOrEqual(2)
          Expect(events.at(-1)).toBe('release-port')
        } else {
          await Expect(server.close()).rejects.toThrow('descendant identity is unreadable')
          Expect(unreadableProbes).toBeGreaterThanOrEqual(2)
          Expect(events.includes('release-port')).toBe(false)
        }
        Expect(events.includes('child:SIGTERM')).toBe(true)
        Expect(events.includes('child:SIGKILL')).toBe(false)
        Expect(events.includes('kill:SIGKILL')).toBe(false)
      },
    )
  }

  Test('retry retains the first descendant capture after the direct process exits', async () => {
    const events: string[] = []
    const child = { command: 'DTServiceHub', pid: 2_147_480_002, startedAt: 'child-start' }
    let alive = true
    let captures = 0
    let allowKill = false
    const server = await startAppiumServer({
      detached: true,
      shutdownTimeoutMs: 5,
      start: () => ({ ...fakeProcess(events), pid: 987 }),
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47241,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      processTree: {
        descendants: () => {
          captures++
          return captures === 1 ? [child] : []
        },
        identities: pids =>
          new Map([
            ...(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot] as const] : []),
            ...(pids.includes(child.pid) && alive ? [[child.pid, child] as const] : []),
          ]),
        processGroupOf: () => child.pid,
        signalTracked: (_children, signal) => {
          events.push(`child:${signal}`)
          if (signal === 'SIGKILL' && allowKill) {
            alive = false
          }
        },
        groupMembers: group => group === child.pid && alive ? [child] : [],
        isGroupAlive: group => group === child.pid && alive,
      },
    })
    await Expect(server.close()).rejects.toThrow('retaining its port reservation')
    Expect(events.includes('release-port')).toBe(false)
    allowKill = true
    await server.close()
    Expect(captures).toBe(1)
    Expect(events.includes('child:SIGKILL')).toBe(true)
    Expect(events.at(-1)).toBe('release-port')
  })

  Test('changed captured descendant identity retains the port without escalation', async () => {
    const events: string[] = []
    const child = { command: 'xcodebuild', pid: 2_147_480_003, startedAt: 'original' }
    let changed = false
    const server = await startAppiumServer({
      detached: true,
      shutdownTimeoutMs: 5,
      start: () => ({ ...fakeProcess(events), pid: 987 }),
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47242,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      processTree: {
        descendants: () => [child],
        identities: pids =>
          new Map([
            ...(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot] as const] : []),
            ...(pids.includes(child.pid)
              ? [[child.pid, { ...child, startedAt: changed ? 'reused' : 'original' }] as const]
              : []),
          ]),
        processGroupOf: () => child.pid,
        signalTracked: () => {
          changed = true
        },
        groupMembers: group => group === child.pid ? [child] : [],
        isGroupAlive: () => true,
      },
    })
    await Expect(server.close()).rejects.toThrow('different kernel identity')
    Expect(events.includes('release-port')).toBe(false)
    Expect(events.includes('kill:SIGKILL')).toBe(false)
  })

  for (const rootState of ['gone', 'reused'] as const) {
    Test(`refuses first descendant capture when the spawned Appium root is ${rootState}`, async () => {
      const events: string[] = []
      let rootChanged = false
      let captures = 0
      const server = await startAppiumServer({
        detached: true,
        start: () => ({ ...fakeProcess(events), pid: serverRoot.pid }),
        fetch: async () => new Response('{}', { status: 200 }),
        reservations: {
          reserve: async () => ({
            port: 47243,
            release: async () => {
              events.push('release-port')
            },
          }),
        },
        processTree: {
          descendants: () => {
            captures++
            return [{ command: 'foreign', pid: 2_147_480_004, startedAt: 'foreign' }]
          },
          identities: pids =>
            new Map(
              pids.includes(serverRoot.pid) && (!rootChanged || rootState === 'reused')
                ? [[serverRoot.pid, { ...serverRoot, startedAt: rootChanged ? 'reused-start' : serverRoot.startedAt }]]
                : [],
            ),
          processGroupOf: () => serverRoot.pid,
          signalTracked: () => {
            events.push('signal-child')
          },
          groupMembers: () => [],
          isGroupAlive: () => false,
        },
      })
      rootChanged = true
      await Expect(server.close()).rejects.toThrow('identity changed before descendant capture')
      Expect(captures).toBe(0)
      Expect(events).toEqual([])
    })
  }

  Test('retains the port when a captured child exits before its separate group is identified', async () => {
    const events: string[] = []
    const exitedChild = { command: 'xcodebuild', pid: 2_147_480_005, startedAt: 'exited-child' }
    const server = await startAppiumServer({
      detached: true,
      start: () => ({ ...fakeProcess(events), pid: serverRoot.pid }),
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47244,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      processTree: {
        descendants: () => [exitedChild],
        identities: pids => new Map(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot]] : []),
        processGroupOf: () => undefined,
        signalTracked: () => {
          events.push('signal-child')
        },
        groupMembers: () => [],
        isGroupAlive: () => false,
      },
    })
    await Expect(server.close()).rejects.toThrow('descendant group identity is unproved')
    Expect(events).toEqual([])
  })

  Test('refuses an unreadable child at first capture before signalling anything', async () => {
    const events: string[] = []
    const child = { command: 'xcodebuild', pid: 2_147_480_007, startedAt: 'child-start' }
    const server = await startAppiumServer({
      detached: true,
      start: () => ({ ...fakeProcess(events), pid: serverRoot.pid }),
      fetch: async () => new Response('{}', { status: 200 }),
      reservations: {
        reserve: async () => ({
          port: 47246,
          release: async () => {
            events.push('release-port')
          },
        }),
      },
      processIsAlive: pid => pid === child.pid,
      processTree: {
        descendants: () => [child],
        identities: pids => new Map(pids.includes(serverRoot.pid) ? [[serverRoot.pid, serverRoot]] : []),
        processGroupOf: () => child.pid,
        signalTracked: () => {
          events.push('signal-child')
        },
        groupMembers: () => [],
        isGroupAlive: () => false,
      },
    })
    await Expect(server.close()).rejects.toThrow('descendant identity is unreadable during capture')
    Expect(events).toEqual([])
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
