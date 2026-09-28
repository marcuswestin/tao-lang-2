import { CLI, Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { GateCatalog } from '@verification/GateCatalog'
import { MachineLanes } from '@verification/MachineLanes'
import { StudioSmoke } from '../studio-tooling-src/StudioSmoke'

Describe('Studio smoke port leases', () => {
  Test('releases standalone gui when port setup fails before the child starts', async () => {
    const registryRoot = await mkTestDir('tao-studio-native-gui-setup-')
    try {
      await Expect(StudioSmoke.run({
        files: ['unused.test.ts'],
        native: true,
        portsAvailable: async () => Errors.throwHostEnvironment('port probe interrupted'),
        registryRoot,
        runId: 'native-gui-setup-test',
        shardIndex: 5,
      })).rejects.toThrow('port probe interrupted')
      const after = await MachineLanes.tryAcquireResource({ name: GateCatalog.GUI_RESOURCE, registryRoot })
      Expect(after).toBeDefined()
      await after?.release()
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('standalone native smoke holds gui before its child starts and releases it after exit', async () => {
    const root = await mkTestDir('tao-studio-native-gui-')
    const registryRoot = FS.resolvePath('registry', root)
    const readyPath = FS.resolvePath('ready', root)
    const releasePath = FS.resolvePath('release', root)
    const testPath = FS.resolvePath('gui-child.test.ts', root)
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const testSupportPath = Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts')
    const runId = 'native-gui-lease-test'
    await FS.writeText(
      testPath,
      `
      import { FS, Time } from ${JSON.stringify(sharedPath)}
      import { Test } from ${JSON.stringify(testSupportPath)}
      Test('waits until the parent releases it', async () => {
        await FS.writeText(${JSON.stringify(readyPath)}, '')
        while (!await FS.exists(${JSON.stringify(releasePath)})) await Time.sleep(5)
      })
    `,
    )
    const pending = StudioSmoke.run({
      files: [testPath],
      native: true,
      portsAvailable: async () => true,
      registryRoot,
      runId,
      shardIndex: 5,
      workerIndex: 3,
    })
    try {
      await until(async () => await FS.exists(readyPath), { description: 'standalone native smoke child to start' })
      Expect(await MachineLanes.tryAcquireResource({ name: GateCatalog.GUI_RESOURCE, registryRoot })).toBeUndefined()
      await FS.writeText(releasePath, '')
      Expect(await pending).toBe(0)
      const after = await MachineLanes.tryAcquireResource({ name: GateCatalog.GUI_RESOURCE, registryRoot })
      Expect(after).toBeDefined()
      await after?.release()
    } finally {
      await FS.writeText(releasePath, '').catch(() => {})
      await pending.catch(() => undefined)
      await FS.remove(StudioSmoke.resources({ runId, shardIndex: 5, workerIndex: 3 }).artifactRoot)
      await FS.remove(root)
    }
  })

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
    const modulePath = Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src/StudioSmoke.ts')
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
