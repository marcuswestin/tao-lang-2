import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StudioSmoke } from '../dev-src/studio/StudioSmoke'

Describe('Studio smoke port leases', () => {
  Test('holds an explicit port block across worktrees until the complete smoke run releases it', async () => {
    const registryRoot = await mkTestDir('tao-studio-port-leases-')
    const options = {
      portsAvailable: async () => true,
      registryRoot,
      runId: 'lease-test',
      shardIndex: 3,
      workerIndex: 7,
    }
    try {
      const first = await StudioSmoke.reserveResources(options)

      await Expect(StudioSmoke.reserveResources(options)).rejects.toThrow('already reserved by another worktree')

      await first.release()
      const afterRelease = await StudioSmoke.reserveResources(options)
      Expect(afterRelease.allocation).toEqual(first.allocation)
      await afterRelease.release()
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('walks past a leased preferred shard when allocation is automatic', async () => {
    const registryRoot = await mkTestDir('tao-studio-port-leases-')
    const common = { portsAvailable: async () => true, registryRoot, runId: 'lease-test', workerIndex: 2 }
    try {
      const preferredShard = StudioSmoke.defaultShardIndex()
      const first = await StudioSmoke.reserveResources({ ...common, shardIndex: preferredShard })
      const second = await StudioSmoke.reserveResources(common)

      Expect(second.allocation.shardIndex).not.toBe(preferredShard)

      await second.release()
      await first.release()
    } finally {
      await FS.remove(registryRoot)
    }
  })
})
