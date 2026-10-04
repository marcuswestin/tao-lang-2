import { type MachineResourceOwner } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time } from '@shared'
import { MachineLanes } from '@verification/MachineLanes'
import { reserveAndroidEmulator } from '../simulators/AgentAndroidEmulator'
import { AndroidRecovery } from '../simulators/AndroidRecovery'
import { managedLoopAndroidOperations, readManagedAndroidQuarantinePlan } from './ManagedLoopAcceptanceAndroidTarget'
import { ManagedLoopAcceptanceEvidence } from './ManagedLoopAcceptanceEvidence'
import type { ManagedLoopTargetFaultQuarantineProof } from './ManagedLoopTargetFaults'

/** Fixed helper. It creates its own target; its only argument is the caller-owned artifact directory. */
async function main(): Promise<void> {
  const args = Platform.runtimeProcess.argv.slice(2)
  const root = args[0]
  if (
    args.length !== 1 || root === undefined || !FS.resolvePath(root).startsWith(`${Repo.resolvePath('.artifacts')}/`)
  ) {
    Errors.throwUserInput('The quarantine helper requires one invocation artifact directory inside this checkout.')
  }
  const plan = await readManagedAndroidQuarantinePlan(root)
  let avdName: string | undefined
  let generation: string | undefined
  let resources: MachineResourceOwner[] = []
  const guarded = managedLoopAndroidOperations({
    invocation: plan.invocation,
    eventRoot: root,
    baselineResources: plan.baselineResources,
    operations: {
      acquireResource: MachineLanes.acquireResource,
      tryAcquireResource: MachineLanes.tryAcquireResource,
      run: CLI.run,
      start: CLI.start,
      write: () => {},
      writeError: () => {},
    },
    record: event => ManagedLoopAcceptanceEvidence.write(root, 'private-allocation', event),
  })
  await reserveAndroidEmulator(
    {
      ...guarded,
      onSpawnedBeforeCapture: async started => {
        const holder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
        const capture = await Time.pollUntil(() => {
          const captured = AndroidRecovery.capture(started, {})
          return !captured.uncertain && captured.processes.length > 0 ? captured : undefined
        }, { intervalMs: 25, timeoutMs: 30_000 })
        if (capture === undefined || holder === undefined || avdName === undefined || generation === undefined) {
          Errors.throwHostEnvironment('The quarantine helper cannot independently prove its newly spawned child.')
        }
        const proof: ManagedLoopTargetFaultQuarantineProof = {
          avdName,
          generation,
          holder: { ...holder, command: 'owned quarantine holder' },
          resources,
          capture: {
            ...capture,
            processes: capture.processes.map(process => ({ ...process, command: 'invocation-owned emulator child' })),
          },
        }
        await ManagedLoopAcceptanceEvidence.write(root, 'spawn-gap-proof', proof)
        // This awaited seam intentionally never publishes capture. The invocation owner kills
        // this holder after reading the durable independent child proof and current intent.
        await Time.sleep(240_000)
        Errors.throwHostEnvironment('The finite quarantine gap expired before its holder fault.')
      },
    },
    undefined,
    false,
    async device => {
      avdName = device.avdName
      generation = device.generation
      resources = [...device.resources ?? []]
      await ManagedLoopAcceptanceEvidence.write(root, 'launch-intent', device)
      if (avdName !== undefined) {
        await ManagedLoopAcceptanceEvidence.write(root, 'external-directories', [{
          path: FS.resolvePath(`.android/avd/${avdName}.avd`, FS.homeDir()),
          companionFile: FS.resolvePath(`.android/avd/${avdName}.ini`, FS.homeDir()),
          owner: 'this invocation',
          purpose: 'dedicated abrupt-holder quarantine fault',
          cleanup: 'retain until independent investigation proves complete shutdown and exact generation recovery',
        }])
      }
    },
  )
}

await main()
