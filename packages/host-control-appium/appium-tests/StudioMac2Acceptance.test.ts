import { HostControlError, type HostRevision } from '@host-control'
import { Expect, Test } from '@shared/test'
import type { Mac2DesktopLease, Mac2DesktopLeases } from '../appium-src/AppiumMac2HostController'
import type { AppiumServer, StartAppiumServerOptions } from '../appium-src/AppiumServer'
import { createStudioMac2AcceptanceFactory } from '../appium-src/StudioMac2Acceptance'

const revision: HostRevision = { build: 'studio-build', source: 'studio-source' }

Test(
  'Studio Mac2 acceptance closes the driver before its server and artifacts, and retries an ambiguous remote delete',
  async () => {
    const events: string[] = []
    const leases = new FakeDesktopLeases(events)
    let deleteFails = true
    let receivedServerOptions: StartAppiumServerOptions | undefined
    const factory = createStudioMac2AcceptanceFactory({
      cleanupArtifacts: async () => {
        events.push('artifacts:cleanup')
      },
      desktopLeases: leases,
      driverHome: '/opt/tao/appium-mac2',
      resolveTarget: _target => ({ using: 'accessibility id', value: 'studio-window' }),
      server: {
        fetch: async (input, init) => {
          const path = new URL(input).pathname
          if (path === '/session' && init?.method === 'POST') {
            events.push('remote:create')
            return response({ sessionId: 'mac2-studio-session' })
          }
          if (path === '/session/mac2-studio-session' && init?.method === 'DELETE') {
            events.push('remote:delete')
            return deleteFails
              ? new Response(JSON.stringify({ value: { message: 'remote delete timed out' } }), { status: 500 })
              : response(null)
          }
          return response({})
        },
        reservations: {
          reserve: async () => ({
            port: 47239,
            release: async () => {
              events.push('port:release')
            },
          }),
        },
      },
      startServer: async options => {
        receivedServerOptions = options
        events.push('server:start')
        return fakeServer(events)
      },
    })

    const controller = await factory({ appId: 'dev.tao.studio' })
    const session = await controller.openSession({
      artifactRoot: '/artifacts',
      mode: 'acceptance',
      revision,
      target: 'studio',
    })
    Expect(receivedServerOptions?.environment?.['APPIUM_HOME']).toBe('/opt/tao/appium-mac2')

    await Expect(controller.close()).rejects.toThrow('retaining the desktop-input lease')
    Expect(leases.lease.releaseCalls).toBe(0)
    Expect(events).toEqual(['server:start', 'remote:create', 'remote:delete'])

    deleteFails = false
    await controller.close()
    Expect(leases.lease.releaseCalls).toBe(1)
    Expect(events).toEqual([
      'server:start',
      'remote:create',
      'remote:delete',
      'remote:delete',
      'lease:release',
      'server:close',
      'artifacts:cleanup',
    ])
    await session.close(session.descriptor().lease)
    Expect(leases.lease.releaseCalls).toBe(1)
  },
)

Test('Studio Mac2 acceptance does not clean artifacts when its owned server has not closed', async () => {
  const events: string[] = []
  const leases = new FakeDesktopLeases(events)
  let serverCloseFailures = 1
  const controller = await createStudioMac2AcceptanceFactory({
    cleanupArtifacts: async () => {
      events.push('artifacts:cleanup')
    },
    desktopLeases: leases,
    resolveTarget: _target => ({ using: 'accessibility id', value: 'studio-window' }),
    server: {
      fetch: async (input, init) => {
        const path = new URL(input).pathname
        if (path === '/session' && init?.method === 'POST') {
          events.push('remote:create')
          return response({ sessionId: 'mac2-studio-session' })
        }
        if (path === '/session/mac2-studio-session' && init?.method === 'DELETE') {
          events.push('remote:delete')
        }
        return response(null)
      },
      reservations: {
        reserve: async () => ({
          port: 47240,
          release: async () => {
            events.push('port:release')
          },
        }),
      },
    },
    startServer: async () => ({
      close: async () => {
        events.push('server:close')
        if (serverCloseFailures > 0) {
          serverCloseFailures -= 1
          throw new HostControlError('host', 'Appium server shutdown timed out.')
        }
      },
      logs: () => '',
      url: 'http://127.0.0.1:47240',
    }),
  })({ appId: 'dev.tao.studio' })
  await controller.openSession({ artifactRoot: '/artifacts', mode: 'acceptance', revision, target: 'studio' })

  await Expect(controller.close()).rejects.toThrow('Appium server shutdown timed out')
  Expect(events).toEqual(['remote:create', 'remote:delete', 'lease:release', 'server:close'])

  await controller.close()
  Expect(events).toEqual([
    'remote:create',
    'remote:delete',
    'lease:release',
    'server:close',
    'server:close',
    'artifacts:cleanup',
  ])
})

function fakeServer(events: string[]): AppiumServer {
  return {
    close: async () => {
      events.push('server:close')
    },
    logs: () => '',
    url: 'http://127.0.0.1:47239',
  }
}

function response(value: unknown): Response {
  return new Response(JSON.stringify({ value }), { status: 200 })
}

class FakeDesktopLeases implements Mac2DesktopLeases {
  readonly lease: FakeDesktopLease
  #held = false

  constructor(events: string[]) {
    this.lease = new FakeDesktopLease(events)
  }

  async acquire(): Promise<Mac2DesktopLease> {
    if (this.#held) {
      throw new HostControlError('busy', 'The fake desktop lease is already held.')
    }
    this.#held = true
    return this.lease
  }
}

class FakeDesktopLease implements Mac2DesktopLease {
  readonly generation = 'mac2-desktop-lease'
  releaseCalls = 0
  readonly #events: string[]

  constructor(events: string[]) {
    this.#events = events
  }

  async assertCurrent(generation: string): Promise<void> {
    if (generation !== this.generation) {
      throw new HostControlError('staleLease', 'The fake desktop lease generation is stale.')
    }
  }

  async release(): Promise<void> {
    this.releaseCalls += 1
    this.#events.push('lease:release')
  }
}
