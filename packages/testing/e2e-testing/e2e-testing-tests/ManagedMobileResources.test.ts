import { MachineResources } from '@host-control'
import { FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { managedMobileResources } from '../native/ManagedMobileResources'

Test(
  'managed driver and server ports remain durable through session deletion, server failure, and holder death',
  async () => {
    const root = await mkTestDir('tao-managed-driver-ports-')
    let holderAlive = true
    const inspect = async () =>
      holderAlive ? { evidence: 'alive' as const, startedAt: 'holder' } : { evidence: 'gone' as const }
    const operations = {
      tryAcquire: (options: Parameters<typeof MachineResources.tryAcquire>[0]) =>
        MachineResources.tryAcquire({ ...options, registryRoot: root, processIdentity: inspect }),
      retain: (options: Parameters<typeof MachineResources.retain>[0]) =>
        MachineResources.retain({ ...options, registryRoot: root }),
      readOwner: (options: Parameters<typeof MachineResources.readOwner>[0]) =>
        MachineResources.readOwner({ ...options, registryRoot: root }),
      recoverRetained: (options: Parameters<typeof MachineResources.recoverRetained>[0]) =>
        MachineResources.recoverRetained({ ...options, registryRoot: root }),
    }
    try {
      const resources = managedMobileResources(operations)
      const wda = await resources.leases.acquire('appium-wda-port-8100')
      const server = await resources.serverReservations('managed-fixture').reserve()
      const names = (await MachineResources.listOwners({ registryRoot: root })).map(owner => owner.name)
      Expect(names.length).toBe(2)
      for (const name of names) {
        Expect((await operations.readOwner({ name }))?.retention?.quarantined).toBe(true)
      }
      await wda.release()
      await server.release()
      await Expect(resources.releaseAfterCleanup(true, false)).rejects.toThrow('unproved')
      holderAlive = false
      for (const name of names) {
        Expect(await operations.tryAcquire({ name, command: 'competing driver', repositoryRoot: root })).toBeUndefined()
      }
      Expect((await MachineResources.listOwners({ registryRoot: root })).length).toBe(2)
      await resources.releaseAfterCleanup(true, true)
      Expect(await MachineResources.listOwners({ registryRoot: root })).toEqual([])
    } finally {
      await FS.remove(root)
    }
  },
)
