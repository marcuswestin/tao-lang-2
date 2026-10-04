import { startMobileAppiumServer } from '@appium-driver'
import { Errors } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { runManagedMobileFixture } from '../native/ManagedMobileFixture'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

const stages = [
  ['prepare-clean', true],
  ['discovery-clean', true],
  ['discovery-unknown', false],
  ['server-config-clean', true],
  ['server-start-unknown', false],
  ['server-ready-clean', true],
  ['server-stop-unknown', false],
  ['controller-construct-clean', true],
  ['session-create-unknown', false],
  ['driver-close-unknown', false],
  ['physical-fence-lost', false],
] as const

for (const [stage, proved] of stages) {
  Test(
    `managed ${stage} startup publishes cleanup only after owned closure and preserves uncertain fences`,
    async () => {
      const root = await mkTestDir('managed-mobile-startup-')
      const events: string[] = []
      let portHeld = false
      let physicalOwner = true
      let controllers = 0
      let remoteCreations = 0
      const grant = createManagedMobileGrant({
        identity: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'loop',
          target: { platform: 'ios', id: 'OWNED' },
          resources: [],
          runtime: {
            session: 'session',
            checkout: '/checkout',
            loopGeneration: 'loop',
            projectRoot: '/app',
            appName: 'DataMVPApp',
            sourceRevision: 'source',
            compiledRevision: 'compiled',
            nonce: 'nonce',
            kind: 'companion',
            appId: 'runtime.app',
            devUrl: 'http://127.0.0.1:8081',
          },
        },
        assertLoopCurrent: async () => {},
        assertOwnerCurrent: async () => {
          if (!physicalOwner) {
            Errors.throwHostEnvironment('physical fence lost')
          }
        },
      })
      const resources = {
        leases: {
          acquire: async () => Errors.throwUnexpected('Physical target reacquisition is forbidden.'),
          tryAcquire: async () => Errors.throwUnexpected('This startup test cannot create a driver.'),
        },
        serverReservations: () => ({
          reserve: async () => {
            portHeld = true
            events.push('port-held')
            return {
              port: 47238,
              release: async () => {
                events.push('deferred-port-release')
              },
            }
          },
        }),
        releaseAfterCleanup: async (driverClosed: boolean, serverClosed: boolean) => {
          Expect(driverClosed).toBe(true)
          Expect(serverClosed).toBe(true)
          portHeld = false
          events.push('resources-released')
        },
      }
      const failure = () => new Errors.HostEnvironmentError(`planned ${stage}`)
      const pending = runManagedMobileFixture({
        grant,
        artifactRoot: root,
        onDriverProcess: async () => {},
        onCleanup: async value => {
          events.push(`cleanup:${value}`)
        },
      }, {
        resources: () => resources,
        startServer: async options =>
          await startMobileAppiumServer(options, {
            ensureDriver: async (_driver, _environment, lifecycle) => {
              if (stage === 'prepare-clean') {
                throw failure()
              }
              lifecycle!.onStartAttempt?.()
              events.push('discovery-attempted')
              if (stage === 'discovery-unknown') {
                throw failure()
              }
              lifecycle!.onOwnedCleanup?.()
              events.push('discovery-closed')
              if (stage === 'discovery-clean') {
                throw failure()
              }
            },
            startServer: async serverOptions => {
              const reservation = await serverOptions.reservations.reserve()
              if (stage === 'server-config-clean') {
                throw failure()
              }
              serverOptions.onStartAttempt?.()
              events.push('server-attempted')
              if (stage === 'server-start-unknown') {
                throw failure()
              }
              if (stage === 'server-ready-clean' || stage === 'server-stop-unknown') {
                const closed = stage === 'server-ready-clean'
                if (closed) {
                  events.push('server-closed')
                  await reservation.release()
                }
                serverOptions.onStartupCleanup?.(closed)
                throw failure()
              }
              return {
                url: 'http://127.0.0.1:47238',
                logs: () => '',
                close: async () => {
                  events.push('server-closed')
                  await reservation.release()
                },
              }
            },
          }),
        controller: () => {
          controllers++
          if (stage === 'physical-fence-lost') {
            physicalOwner = false
          }
          if (stage === 'controller-construct-clean' || stage === 'physical-fence-lost') {
            throw failure()
          }
          return {
            openSession: async () => {
              remoteCreations++
              if (stage === 'session-create-unknown') {
                Errors.throwHostEnvironment('unknown creation', { details: { retainsTargetLease: true } })
              }
              throw failure()
            },
            close: async () => {
              events.push('driver-close')
              if (stage === 'driver-close-unknown') {
                throw failure()
              }
            },
          }
        },
      })
      await Expect(pending).rejects.toThrow(proved ? `planned ${stage}` : 'cleanup is unproved')
      Expect(events.at(-1)).toBe(`cleanup:${proved}`)
      Expect(events.includes('resources-released')).toBe(proved)
      Expect(portHeld).toBe(stage.startsWith('discovery') || stage === 'prepare-clean' ? false : !proved)
      Expect(grant.signal.aborted).toBe(true)
      const serverReturned = [
        'controller-construct-clean',
        'physical-fence-lost',
        'session-create-unknown',
        'driver-close-unknown',
      ].some(value => value === stage)
      Expect(controllers).toBe(serverReturned ? 1 : 0)
      Expect(remoteCreations).toBe(stage === 'session-create-unknown' || stage === 'driver-close-unknown' ? 1 : 0)
      if (proved) {
        Expect(events.indexOf('resources-released') < events.indexOf('cleanup:true')).toBe(true)
      }
      if (serverReturned) {
        Expect(events.includes('server-closed')).toBe(true)
      }
    },
  )
}
