import { CLI, Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
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

  Test('releases the block when its port probe throws', async () => {
    const registryRoot = await mkTestDir('tao-studio-port-leases-')
    const options = { registryRoot, runId: 'lease-test', shardIndex: 4, workerIndex: 1 }
    try {
      await Expect(StudioSmoke.reserveResources({
        ...options,
        portsAvailable: async () => {
          Errors.throwHostEnvironment('bind probe unavailable')
        },
      })).rejects.toThrow('bind probe unavailable')

      const recovered = await StudioSmoke.reserveResources({ ...options, portsAvailable: async () => true })
      await recovered.release()
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('keeps the same block exclusive across process boundaries', async () => {
    const root = await mkTestDir('tao-studio-port-process-')
    const registryRoot = FS.resolvePath('registry', root)
    const releasePath = FS.resolvePath('release', root)
    const modulePath = Repo.resolvePath('packages/dev/dev-src/studio/StudioSmoke.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const script = `
      import { Errors, FS, Time } from ${JSON.stringify(sharedPath)}
      import { StudioSmoke } from ${JSON.stringify(modulePath)}
      const root = process.env['TAO_STUDIO_LEASE_TEST_ROOT']
      if (!root) Errors.throwUnexpected('Missing Studio lease fixture root.')
      const reservation = await StudioSmoke.reserveResources({
        portsAvailable: async () => true,
        registryRoot: FS.resolvePath('registry', root),
        runId: 'process-test',
        shardIndex: 6,
        workerIndex: 2,
      })
      await FS.writeText(FS.resolvePath('ready', root), '')
      while (!await FS.exists(FS.resolvePath('release', root))) await Time.sleep(5)
      await reservation.release()
    `
    const child = CLI.run('bun', {
      args: ['-e', script],
      env: { TAO_STUDIO_LEASE_TEST_ROOT: root },
      stdio: 'pipe',
    })
    try {
      await until(async () => await FS.exists(FS.resolvePath('ready', root)), {
        description: 'child process to reserve the Studio port block',
      })
      await Expect(StudioSmoke.reserveResources({
        portsAvailable: async () => true,
        registryRoot,
        runId: 'process-test',
        shardIndex: 6,
        workerIndex: 2,
      })).rejects.toThrow('already reserved by another worktree')
      await FS.writeText(releasePath, '')
      Expect((await child).exitCode).toBe(0)
    } finally {
      await FS.writeText(releasePath, '').catch(() => {})
      await child.catch(() => undefined)
      await FS.remove(root)
    }
  })
})
