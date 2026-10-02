import { MachineResourceBusyError, MachineResourceFenceError, MachineResources } from '@host-control'
import { Errors, FS, type TrackedProcess } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { AndroidRecovery, type AndroidRecoveryOperations } from '../dev-cli-src/simulators/AndroidRecovery'

Test('Android recovery stops captured survivors and releases both fences after proven shutdown', async () => {
  const root = await mkTestDir('tao-android-recovery-')
  try {
    const name = 'Tao_Agent_Pixel_1'
    const avd = await MachineResources.acquire({
      command: 'AVD',
      name: `android-avd:${name}`,
      registryRoot: root,
      repositoryRoot: root,
    })
    const serial = await MachineResources.acquire({
      command: 'serial',
      name: 'android-emulator:emulator-5556',
      registryRoot: root,
      repositoryRoot: root,
    })
    const process: TrackedProcess = { command: 'qemu', pid: 2 ** 29, startedAt: 'captured-kernel-start' }
    const identities = new Map([[process.pid, process]])
    const signals: string[] = []
    let groupAlive = true
    const retained = await MachineResources.retain({
      owners: [avd.owner, serial.owner],
      processes: [process],
      processGroupPid: process.pid,
      quarantined: false,
      reason: 'survived',
      registryRoot: root,
    })
    const operations: AndroidRecoveryOperations = {
      registryRoot: root,
      // budget-ok: immediate synthetic process transitions, no host shutdown latency.
      shutdownTimeoutMs: 10,
      processTree: {
        descendants: () => [],
        identities: () => identities,
        processGroupOf: pid => pid,
        isGroupAlive: () => groupAlive,
        signalTracked: (tracked, signal) => {
          for (const expected of tracked) {
            if (identities.get(expected.pid)?.startedAt === expected.startedAt) {
              signals.push(signal)
              if (signal === 'SIGKILL') {
                identities.delete(expected.pid)
                groupAlive = false
              }
            }
          }
        },
      },
    }
    await Expect(AndroidRecovery.recover(name, avd.generation, operations)).rejects.toBeInstanceOf(
      MachineResourceFenceError,
    )
    Expect(signals).toEqual([])
    await AndroidRecovery.recover(name, retained.id, operations)
    Expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    for (const resourceName of [avd.owner.name, serial.owner.name]) {
      const next = await MachineResources.acquire({
        command: 'next',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
        waitTimeoutMs: 0,
      })
      await next.release()
    }
  } finally {
    await FS.remove(root)
  }
})

Test('Android recovery never signals a reused PID and refuses quarantine or an unknown live group', async () => {
  for (const mode of ['reused-pid', 'quarantine', 'unknown-group']) {
    const root = await mkTestDir('tao-android-recovery-identity-')
    try {
      const name = 'Tao_Agent_Pixel_1'
      const lease = await MachineResources.acquire({
        command: 'AVD',
        name: `android-avd:${name}`,
        registryRoot: root,
        repositoryRoot: root,
      })
      const process: TrackedProcess = { command: 'emulator', pid: 2 ** 29, startedAt: 'old-start' }
      const retained = await MachineResources.retain({
        owners: [lease.owner],
        processes: [process],
        processGroupPid: process.pid,
        quarantined: mode === 'quarantine',
        reason: 'unproved',
        registryRoot: root,
      })
      const delivered: number[] = []
      const current = { ...process, startedAt: 'new-start' }
      const operations: AndroidRecoveryOperations = {
        registryRoot: root,
        // budget-ok: synthetic unknown-group timeout, with no real emulator or host shutdown.
        shutdownTimeoutMs: 10,
        processTree: {
          descendants: () => [],
          identities: () => new Map([[current.pid, current]]),
          isGroupAlive: () => mode === 'unknown-group',
          processGroupOf: pid => pid,
          signalTracked: tracked => {
            delivered.push(
              ...tracked.filter(expected => expected.startedAt === current.startedAt).map(expected => expected.pid),
            )
          },
        },
      }
      const recovery = AndroidRecovery.recover(name, retained.id, operations)
      if (mode === 'reused-pid') {
        await recovery
      } else {
        await Expect(recovery).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
        await Expect(MachineResources.acquire({
          command: 'contender',
          name: lease.owner.name,
          registryRoot: root,
          repositoryRoot: root,
          waitTimeoutMs: 0,
        })).rejects.toBeInstanceOf(MachineResourceBusyError)
      }
      Expect(delivered).toEqual([])
    } finally {
      await FS.remove(root)
    }
  }
})
