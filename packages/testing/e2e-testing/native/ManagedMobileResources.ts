import type { AppiumPortReservations } from '@appium-driver'
import { type MachineResourceOwner, MachineResources } from '@host-control'
import { Errors, Platform, Repo } from '@shared'
import type { AppiumLeaseManager } from './appium/AppiumXcuiTestController'

/** Driver ports survive holder death and are released only after both driver and server cleanup. */
export function managedMobileResources(
  operations: Pick<typeof MachineResources, 'tryAcquire' | 'retain' | 'readOwner' | 'recoverRetained'> =
    MachineResources,
) {
  const retained: MachineResourceOwner[] = []
  let cleanupProved = false
  const leases: AppiumLeaseManager = {
    acquire: async name =>
      await leases.tryAcquire(name)
        ?? Errors.throwHostEnvironment(`Managed driver resource '${name}' is already held.`),
    tryAcquire: async name => {
      if (cleanupProved) {
        Errors.throwHostEnvironment('Managed driver resources were already closed.')
      }
      const lease = await operations.tryAcquire({
        name,
        command: 'Managed mobile driver',
        repositoryRoot: Repo.getRoot(),
      })
      if (lease === undefined) {
        return undefined
      }
      const owner = await operations.retain({
        owners: [lease.owner],
        processes: [],
        quarantined: true,
        reason: 'Managed mobile driver and owned server cleanup must both be proved before this port is released.',
      })
      retained.push(owner)
      return {
        generation: owner.id,
        assertCurrent: async generation => {
          const current = await operations.readOwner({ name })
          if (generation !== owner.id || current?.id !== owner.id) {
            Errors.throwHostEnvironment(`Managed driver resource '${name}' changed ownership.`)
          }
        },
        // A controller session close cannot prove that its server descendants released ports.
        release: async () => {},
      }
    },
  }
  return {
    leases,
    serverReservations: (runId: string): AppiumPortReservations => ({
      reserve: async () => {
        const offset = Number.parseInt(Platform.sha256Hex(runId).slice(0, 4), 16) % 1_000
        for (let step = 0; step < 1_000; step++) {
          const port = 4723 + (offset + step) % 1_000
          const lease = await leases.tryAcquire(`appium-server-port-${port}`)
          if (lease !== undefined) {
            return { port, release: lease.release }
          }
        }
        return Errors.throwHostEnvironment('No managed Appium server port could be reserved.')
      },
    }),
    releaseAfterCleanup: async (driverClosed: boolean, serverClosed: boolean) => {
      if (!driverClosed || !serverClosed) {
        Errors.throwHostEnvironment('Managed driver/server cleanup is unproved; durable port fences remain retained.')
      }
      cleanupProved = true
      for (const owner of retained) {
        await operations.recoverRetained({ name: owner.name, generation: owner.id, shutdown: async () => true })
      }
    },
  }
}
