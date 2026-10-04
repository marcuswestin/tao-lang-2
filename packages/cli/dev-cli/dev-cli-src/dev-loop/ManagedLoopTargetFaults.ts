import { type MachineResourceLease, type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Switch, Time, type TrackedProcess } from '@shared'
import { MachineLanes } from '@verification/MachineLanes'
import { type AgentAndroidOperations, reserveAndroidEmulator } from '../simulators/AgentAndroidEmulator'
import { type AgentAppDevDevice, appDevReservation } from '../simulators/AgentAppDev'
import { AndroidRecovery } from '../simulators/AndroidRecovery'
import {
  cleanupManagedLoopAndroidAssets,
  type ManagedAndroidQuarantinePlan,
  type ManagedAndroidTargetShutdown,
  managedLoopAndroidOperations,
  managedLoopAndroidPrefix,
} from './ManagedLoopAcceptanceAndroidTarget'
import { ManagedLoopAcceptanceEvidence, type ManagedLoopInventory } from './ManagedLoopAcceptanceEvidence'
import { createManagedIosFixture, type ManagedIosRuntimeOperations } from './ManagedLoopAcceptanceIosRuntime'

export type ManagedLoopTargetFaultCase =
  | 'android-escalation'
  | 'android-quarantine'
  | 'android-recovery'
  | 'ios-recovery'
export type ManagedLoopTargetFaultQuarantineProof = {
  avdName: string
  generation: string
  holder: TrackedProcess
  resources: MachineResourceOwner[]
  capture: ReturnType<typeof AndroidRecovery.capture>
}
type QuarantineProof = ManagedLoopTargetFaultQuarantineProof
type FaultEvent = {
  action: string
  injected?: boolean
  signal?: Platform.ProcessSignal
  processes?: TrackedProcess[]
  generation?: string
}
export type ManagedLoopTargetFaultEvidence = {
  case: ManagedLoopTargetFaultCase
  disposition: 'real-host pass' | 'real-host failure' | 'source regression'
  events: FaultEvent[]
  artifacts: string
  unresolved: { name: string; generation: string }[]
  createdTargets?: { platform: 'ios'; id: string; externalPath: string; cleanup: 'retained' | 'complete' }[]
  quarantineCleanupInspectionFailure?: {
    rootPid?: number
    stage: 'identities' | 'liveness' | 'group'
    observations: number
    diagnostic: string
    causes: { code?: string; errno?: string | number; syscall?: string }[]
  }
  detail?: string
}

/** This seam is only for source regressions; its output can never claim real-host acceptance. */
export type ManagedLoopTargetFaultSourceOperations = {
  android: AgentAndroidOperations
  resources: {
    [Name in 'acquire' | 'readOwner' | 'listOwners' | 'retain' | 'recoverRetained' | 'withCurrentOwners']:
      (typeof MachineResources)[Name]
  }
  run: typeof CLI.run
  start: typeof CLI.start
  inventory: () => Promise<ManagedLoopInventory>
  processTree: typeof ProcessTree
  iosRuntime?: Partial<ManagedIosRuntimeOperations>
  quarantineCleanupClock?: { now: () => number; sleep: (ms: number) => Promise<void> }
  quarantineCleanupProcessIsAlive?: (pid: number) => boolean
}
const liveOperations: ManagedLoopTargetFaultSourceOperations = {
  android: {
    acquireResource: MachineLanes.acquireResource,
    tryAcquireResource: MachineLanes.tryAcquireResource,
    run: CLI.run,
    start: CLI.start,
    write: () => {},
    writeError: () => {},
  },
  resources: MachineResources,
  run: CLI.run,
  start: CLI.start,
  inventory: ManagedLoopAcceptanceEvidence.inventory,
  processTree: ProcessTree,
  quarantineCleanupProcessIsAlive: Platform.processIsAlive,
}

/** Closed host surface: every target is created or reserved by this invocation. */
export async function runManagedLoopTargetFault(
  caseName: ManagedLoopTargetFaultCase,
  artifactRoot: string,
): Promise<ManagedLoopTargetFaultEvidence> {
  return await runFault(caseName, artifactRoot, liveOperations, false)
}

export async function runManagedLoopTargetFaultSourceRegression(
  caseName: ManagedLoopTargetFaultCase,
  artifactRoot: string,
  operations: ManagedLoopTargetFaultSourceOperations,
): Promise<ManagedLoopTargetFaultEvidence> {
  return await runFault(caseName, artifactRoot, operations, true)
}

async function runFault(
  caseName: ManagedLoopTargetFaultCase,
  artifactRoot: string,
  operations: ManagedLoopTargetFaultSourceOperations,
  sourceRegression: boolean,
): Promise<ManagedLoopTargetFaultEvidence> {
  if (!['android-escalation', 'android-quarantine', 'android-recovery', 'ios-recovery'].includes(caseName)) {
    Errors.throwUserInput('Target-fault acceptance requires one fixed target-fault case.')
  }
  if (
    !sourceRegression && caseName.startsWith('android-')
    && artifactRoot !== Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${FS.basename(artifactRoot)}`)
  ) {
    Errors.throwUserInput('Android target-fault acceptance requires its fixed invocation artifact root.')
  }
  const root = FS.resolvePath(caseName, artifactRoot)
  await FS.mkdir(root)
  await FS.chmod(root, 0o700)
  const evidence: ManagedLoopTargetFaultEvidence = {
    case: caseName,
    disposition: sourceRegression ? 'source regression' : 'real-host failure',
    events: [],
    artifacts: root,
    unresolved: [],
  }
  const record = async (event: FaultEvent): Promise<void> => {
    evidence.events.push(event)
    await ManagedLoopAcceptanceEvidence.write(root, 'receipt', evidence)
  }
  let before: ManagedLoopInventory | undefined
  let ownedNames: string[] = []
  try {
    before = await operations.inventory()
    await ManagedLoopAcceptanceEvidence.write(root, 'before', before)
    const holder = operations.processTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
    if (holder === undefined) {
      Errors.throwHostEnvironment('The target-fault holder kernel identity is unavailable; refusing allocation.')
    }
    await record({ action: 'holder captured before allocation', processes: [holder] })
    ownedNames = await Switch<ManagedLoopTargetFaultCase, Promise<string[]>>(caseName, {
      'android-escalation': () => androidFault(false),
      'android-recovery': () => androidFault(true),
      'android-quarantine': () => quarantine(),
      'ios-recovery': () => iosRecovery(),
    })
    const after = await operations.inventory()
    await ManagedLoopAcceptanceEvidence.write(root, 'after', after)
    const preservation = ManagedLoopAcceptanceEvidence.preserved(before, after)
    if (preservation.length > 0) {
      Errors.throwHostEnvironment(preservation.join(' '))
    }
    evidence.unresolved = []
    for (const name of ownedNames) {
      const owner = await operations.resources.readOwner({ name })
      if (owner !== undefined) {
        evidence.unresolved.push({ name, generation: owner.id })
      }
    }
    if (evidence.unresolved.length > 0 && caseName !== 'android-quarantine') {
      Errors.throwHostEnvironment('Invocation-owned target fences remain unresolved.')
    }
    if (!sourceRegression) {
      evidence.disposition = 'real-host pass'
    }
  } catch (error) {
    evidence.detail = Errors.formatForUser(error)
    if (!sourceRegression) {
      evidence.disposition = 'real-host failure'
    }
  } finally {
    // Failure also records a preservation inventory; never turn failed cleanup into a pass.
    const inspectionFailure = (error: unknown): undefined => {
      evidence.detail = Errors.formatForUser(error)
      if (!sourceRegression) {
        evidence.disposition = 'real-host failure'
      }
      return undefined
    }
    const after = await operations.inventory().catch(inspectionFailure)
    if (after !== undefined) {
      await ManagedLoopAcceptanceEvidence.write(root, 'final-inventory', after)
      if (before !== undefined) {
        const preservation = ManagedLoopAcceptanceEvidence.preserved(before, after)
        await ManagedLoopAcceptanceEvidence.write(root, 'peer-preservation', preservation)
        if (preservation.length > 0) {
          evidence.detail = preservation.join(' ')
          if (!sourceRegression) {
            evidence.disposition = 'real-host failure'
          }
        }
      }
    }
    const owners = await operations.resources.listOwners().catch(inspectionFailure)
    const recordedNames = new Set([...ownedNames, ...evidence.unresolved.map(owner => owner.name)])
    if (owners !== undefined) {
      evidence.unresolved = owners.filter(owner => recordedNames.has(owner.name)).map(owner => ({
        name: owner.name,
        generation: owner.id,
      }))
    }
    await ManagedLoopAcceptanceEvidence.write(root, 'receipt', evidence)
  }
  return evidence

  async function androidFault(recovery: boolean): Promise<string[]> {
    let started: CLI.StartedCommand | undefined
    let deviceName: string | undefined
    let ownedSerial: string | undefined
    let withholding = false
    let release: (() => Promise<void>) | undefined
    let ownedCapture: ReturnType<typeof AndroidRecovery.capture> | undefined
    let initialGeneration: string | undefined
    let lastDevice: AgentAppDevDevice | undefined
    let failed = false
    const injected: FaultEvent[] = []
    const signals: Platform.ProcessSignal[] = []
    const tree = operations.android.processTree ?? operations.processTree
    const guarded = managedLoopAndroidOperations({
      invocation: FS.basename(artifactRoot),
      eventRoot: root,
      baselineResources: before!.resources.map(resource => resource.name),
      operations: operations.android,
      record: event => ManagedLoopAcceptanceEvidence.write(root, 'private-allocation', event),
    })
    const policy: AgentAndroidOperations = {
      ...guarded,
      // Host fault waits are bounded; the production recovery default is unchanged.
      shutdownTimeoutMs: 2_000,
      start: (command, spec) => {
        if (command !== 'emulator') {
          Errors.throwUnexpected('The Android target fault may spawn only its reserved emulator.')
        }
        started = guarded.start(command, spec)
        return {
          get args() {
            return started!.args
          },
          get command() {
            return started!.command
          },
          get cwd() {
            return started!.cwd
          },
          get error() {
            return started!.error
          },
          get exitCode() {
            return started!.exitCode
          },
          get pid() {
            return started!.pid
          },
          get signalCode() {
            return started!.signalCode
          },
          closeOutput: () => started!.closeOutput(),
          dispose: () => started!.dispose(),
          endStdin: () => started!.endStdin(),
          onceClose: listener => started!.onceClose(listener),
          onceError: listener => started!.onceError(listener),
          waitForClose: () => started!.waitForClose(),
          writeStdin: chunk => started!.writeStdin(chunk),
          kill: signal => {
            if (withholding) {
              injected.push({ action: 'owned child shutdown deliberately withheld', injected: true, signal })
              return false
            }
            return started!.kill(signal)
          },
        }
      },
      run: async (command, spec) => {
        const args = spec?.args ?? []
        if (
          command === 'adb' && args.length === 4 && args[0] === '-s' && args[1] === ownedSerial && args[2] === 'emu'
          && args[3] === 'kill'
        ) {
          if (!recovery) {
            if (ownedCapture === undefined || ownedCapture.uncertain || ownedCapture.processes.length === 0) {
              Errors.throwHostEnvironment('Owned ADB shutdown lacks its independent captured child proof.')
            }
            await record({
              action: 'proved owned ADB serial reached shutdown; captured child tree will be suspended to require KILL',
              signal: 'SIGSTOP',
              processes: safeProcesses(ownedCapture.processes),
            })
            const current = tree.identities(ownedCapture.processes.map(process => process.pid))
            if (ownedCapture.processes.some(process => !ProcessTree.sameProcess(current.get(process.pid), process))) {
              Errors.throwHostEnvironment('The captured Android child changed before proved ADB shutdown suspension.')
            }
            tree.signalTracked(ownedCapture.processes, 'SIGSTOP')
          }
          injected.push({ action: 'owned adb emu kill deliberately rejected', injected: true })
          Errors.throwHostEnvironment('Acceptance deliberately rejected only the owned ADB shutdown.')
        }
        return await guarded.run(command, spec)
      },
      processTree: {
        ...tree,
        signalTracked: (processes, signal) => {
          assertOwned(processes)
          if (withholding) {
            injected.push({ action: 'owned tracked shutdown deliberately withheld', injected: true, signal })
            return
          }
          signals.push(signal)
          evidence.events.push({
            action: 'genuine tracked signal requested',
            signal,
            processes: safeProcesses(processes),
          })
          tree.signalTracked(processes, signal)
        },
      },
    }
    try {
      const reservation = await reserveAndroidEmulator(policy, undefined, false, async device => {
        lastDevice = device
        await ManagedLoopAcceptanceEvidence.write(root, 'android-device', device)
        deviceName = device.avdName
        evidence.unresolved = (device.resources ?? []).map(owner => ({ name: owner.name, generation: owner.id }))
        if (device.state === 'booted') {
          initialGeneration = device.generation
        }
        await record({ action: `owned Android ${device.state}`, generation: device.generation })
      })
      release = reservation.release
      deviceName = reservation.avdName
      ownedSerial = reservation.serial
      ownedNames = reservation.resources().map(owner => owner.name)
      if (!reservation.autoStarted || started === undefined) {
        Errors.throwUnexpected('Target faults require an emulator started by this invocation.')
      }
      ownedCapture = AndroidRecovery.capture(started, { processTree: tree })
      if (ownedCapture.uncertain || ownedCapture.processes.length === 0) {
        Errors.throwHostEnvironment('Independent emulator child identity capture is incomplete; refusing the fault.')
      }
      await record({
        action: 'owned child tree captured before fault',
        processes: safeProcesses(ownedCapture.processes),
      })
      if (recovery) {
        withholding = true
        await record({ action: 'only owned shutdown will be withheld', injected: true })
      }
      let stopFailed = false
      try {
        await release()
      } catch (error) {
        stopFailed = true
        await record({ action: `Owned Android release failed: ${Errors.formatForUser(error)}` })
      }
      for (const event of injected) {
        await record(event)
      }
      withholding = false
      if (!recovery) {
        if (
          stopFailed || !signals.includes('SIGTERM') || !signals.includes('SIGKILL')
          || !injected.some(event => event.action === 'owned adb emu kill deliberately rejected')
        ) {
          Errors.throwHostEnvironment(
            'The real owned TERM/KILL escalation and rejected ADB request were not all observed.',
          )
        }
      } else {
        const owner = await operations.resources.readOwner({ name: `android-avd:${deviceName}` })
        if (
          !stopFailed || owner?.retention === undefined || owner.retention.quarantined || owner.id === initialGeneration
        ) {
          Errors.throwHostEnvironment('Failed owned shutdown did not publish a rotated recoverable generation.')
        }
        await record({ action: 'rotated retained generation observed', generation: owner.id })
        let staleRefused = false
        try {
          await AndroidRecovery.recover(deviceName, initialGeneration!, {
            ...policy,
            recoverResources: operations.resources.recoverRetained,
          })
        } catch {
          staleRefused = true
        }
        if (!staleRefused || (await operations.resources.readOwner({ name: owner.name }))?.id !== owner.id) {
          Errors.throwHostEnvironment('The original Android generation failed to fence the rotated retained target.')
        }
        await record({ action: 'stale Android generation refused before shutdown', generation: initialGeneration })
        let rejected = false
        try {
          await AndroidRecovery.recover(deviceName, owner.id, {
            ...policy,
            recoverResources: options =>
              operations.resources.recoverRetained({ ...options, shutdown: async () => false }),
          })
        } catch {
          rejected = true
        }
        if (!rejected || (await operations.resources.readOwner({ name: owner.name }))?.id !== owner.id) {
          Errors.throwHostEnvironment('Injected recovery refusal failed to preserve the exact retained generation.')
        }
        await record({
          action: 'owned recovery shutdown proof deliberately withheld; fence preserved',
          injected: true,
          generation: owner.id,
        })
        await AndroidRecovery.recover(deviceName, owner.id, {
          ...policy,
          recoverResources: operations.resources.recoverRetained,
        })
        lastDevice = {
          ...lastDevice!,
          state: 'released',
          generation: owner.id,
          resources: owner.retention.resourceNames.map(name => ({ ...owner, name })),
        }
        await ManagedLoopAcceptanceEvidence.write(root, 'android-device', lastDevice)
        await record({ action: 'genuine recovery completed with exact generation', generation: owner.id })
      }
      return ownedNames
    } catch (error) {
      failed = true
      throw error
    } finally {
      const cleanupErrors: unknown[] = []
      const attempt = async (action: () => void | Promise<void>): Promise<void> => {
        try {
          await action()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      withholding = false
      await attempt(async () => {
        if (started !== undefined && ownedCapture !== undefined && lastDevice?.state !== 'released') {
          // Emergency cleanup uses only independently captured children, never an unknown quarantine.
          tree.signalTracked(ownedCapture.processes, 'SIGCONT')
          const owner = deviceName === undefined
            ? undefined
            : await operations.resources.readOwner({ name: `android-avd:${deviceName}` })
          if (owner?.retention !== undefined && !owner.retention.quarantined && owner.retention.processes.length > 0) {
            await AndroidRecovery.recover(deviceName!, owner.id, {
              ...policy,
              recoverResources: operations.resources.recoverRetained,
            })
            lastDevice = {
              ...lastDevice!,
              state: 'released',
              generation: owner.id,
              resources: owner.retention.resourceNames.map(name => ({ ...owner, name })),
            }
            await ManagedLoopAcceptanceEvidence.write(root, 'android-device', lastDevice)
          } else if (owner?.retention === undefined) {
            await release?.()
          }
        }
      })
      if (ownedCapture !== undefined && lastDevice?.state === 'released') {
        await attempt(collectAndroidAssets)
      }
      for (const error of cleanupErrors) {
        evidence.events.push({ action: `Owned Android fault cleanup failed: ${Errors.formatForUser(error)}` })
      }
      if (!failed && cleanupErrors.length > 0) {
        throw cleanupErrors[0]
      }
    }

    async function collectAndroidAssets(): Promise<void> {
      const shutdown: ManagedAndroidTargetShutdown = {
        invocation: FS.basename(artifactRoot),
        checkout: await FS.realPath(Repo.getRoot()),
        device: lastDevice!,
        capture: ownedCapture!,
      }
      await ManagedLoopAcceptanceEvidence.write(root, 'android-shutdown', shutdown)
      await cleanupManagedLoopAndroidAssets(
        {
          artifactRoot,
          baselineResources: before!.resources.map(resource => resource.name),
          targetProof: FS.resolvePath('android-shutdown.json', root),
        },
        root,
        {
          identities: tree.identities,
          groupAlive: tree.isGroupAlive,
          run: guarded.run,
          start: operations.start,
          readOwner: operations.resources.readOwner,
          tryAcquire: async request => {
            const lease = await guarded.tryAcquireResource(request)
            if (lease === undefined) {
              return undefined
            }
            return {
              ...lease,
              generation: lease.owner.id,
              assertCurrent: async generation => {
                if (generation !== lease.owner.id) {
                  Errors.throwHostEnvironment('Private Android deletion generation changed before admission.')
                }
                await operations.resources.withCurrentOwners({ owners: [lease.owner] }, () => {})
              },
            }
          },
          retain: operations.resources.retain,
          recover: operations.resources.recoverRetained,
          withCurrentOwners: operations.resources.withCurrentOwners,
        },
      )
      await record({ action: 'owned Android cleanup proved' })
    }

    function assertOwned(processes: readonly TrackedProcess[]): void {
      if (ownedCapture === undefined) {
        // Startup failure cleanup remains under the reservation's own genuine proof policy.
        return
      }
      if (
        processes.some(process =>
          !ownedCapture!.processes.some(expected =>
            expected.pid === process.pid && expected.startedAt === process.startedAt
          )
        )
      ) {
        Errors.throwHostEnvironment('The fault wrapper refused an uncaptured Android descendant.')
      }
    }
  }

  async function quarantine(): Promise<string[]> {
    const proofPath = FS.resolvePath('spawn-gap-proof.json', root)
    const parent = operations.processTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
    if (parent === undefined) {
      Errors.throwHostEnvironment('The private quarantine parent kernel identity is unavailable.')
    }
    const privatePlan: ManagedAndroidQuarantinePlan = {
      version: 1,
      invocation: FS.basename(artifactRoot),
      artifactRoot,
      checkout: await FS.realPath(Repo.getRoot()),
      parent,
      baselineResources: before!.resources.map(resource => resource.name),
    }
    await ManagedLoopAcceptanceEvidence.write(root, 'private-plan', privatePlan)
    const helper = operations.start(Platform.runtimeProcess.execPath, {
      args: [
        Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopTargetFaultsQuarantineChild.ts'),
        root,
      ],
      detached: true,
      processPolicy: 'server',
      stdio: 'pipe',
      unref: true,
    })
    let proof: QuarantineProof | undefined
    let validatedCleanupCapture: QuarantineProof['capture'] | undefined
    let helperIdentity: TrackedProcess | undefined
    let failed = false
    try {
      helperIdentity = await Time.pollUntil(
        () => helper.pid === undefined ? undefined : operations.processTree.identities([helper.pid]).get(helper.pid),
        {
          intervalMs: 25,
          timeoutMs: 30_000,
        },
      )
      if (helperIdentity === undefined) {
        Errors.throwHostEnvironment('The owned quarantine helper identity could not be captured.')
      }
      await record({
        action: 'owned quarantine helper captured',
        processes: [{ ...helperIdentity, command: 'owned quarantine holder' }],
      })
      proof = await Time.pollUntil(async () => {
        if (!await FS.exists(proofPath)) {
          return undefined
        }
        return await FS.readJson<QuarantineProof>(proofPath)
      }, {
        intervalMs: 50,
        timeoutMs: 180_000,
        stop: () => helper.error !== undefined || helper.exitCode !== null || helper.signalCode !== null,
      })
      if (
        proof === undefined || proof.capture.uncertain || proof.capture.processes.length === 0
        || proof.capture.rootPid === undefined
      ) {
        Errors.throwHostEnvironment('The exact spawn gap did not produce independent owned child proof.')
      }
      if (proof.holder.pid !== helperIdentity.pid || proof.holder.startedAt !== helperIdentity.startedAt) {
        Errors.throwHostEnvironment('The gap proof does not belong to the invocation-created helper.')
      }
      const prefix = managedLoopAndroidPrefix(privatePlan.invocation)
      if (
        ![1, 2, 3, 4].some(slot => proof!.avdName === `${prefix}${slot}`)
        || proof.resources.length !== 2
        || proof.resources.some(owner =>
          owner.id !== proof!.generation || privatePlan.baselineResources.includes(owner.name)
        )
        || !proof.resources.some(owner => owner.name === `android-avd:${proof!.avdName}`)
        || !proof.resources.some(owner =>
          /^android-emulator:emulator-(?:558[02468]|559[02468]|56[0-7][02468]|5680)$/u.test(owner.name)
        )
      ) {
        Errors.throwHostEnvironment('The quarantine proof does not name its private AVD and reserved console pair.')
      }
      const name = `android-avd:${proof.avdName}`
      const intent = await operations.resources.readOwner({ name })
      if (
        intent?.id !== proof.generation || intent.retention?.quarantined !== true
        || intent.retention.processes.length !== 0
      ) {
        Errors.throwHostEnvironment('The exact spawn gap failed to preserve an empty quarantined launch intent.')
      }
      for (const resource of proof.resources) {
        const current = await operations.resources.readOwner({ name: resource.name })
        if (
          current?.id !== intent.id || current.retention?.quarantined !== true
          || current.retention.processes.length !== 0
          || current.retention.resourceNames.length !== 2
          || proof.resources.some(expected => !current.retention!.resourceNames.includes(expected.name))
        ) {
          Errors.throwHostEnvironment(
            'The private quarantine AVD and serial intents must share the exact retained generation.',
          )
        }
      }
      const liveRoot = operations.processTree.identities([proof.capture.rootPid]).get(proof.capture.rootPid)
      const rootIdentity = proof.capture.processes.find(process => process.pid === proof!.capture.rootPid)
      const provenance = operations.processTree.descendants(helperIdentity.pid)
      if (
        rootIdentity === undefined || !operations.processTree.sameProcess(liveRoot, rootIdentity)
        || !provenance.some(process =>
          process.pid === rootIdentity.pid && operations.processTree.sameProcess(process, rootIdentity)
        )
        || proof.capture.processes.some(expected =>
          !provenance.some(process =>
            process.pid === expected.pid && operations.processTree.sameProcess(process, expected)
          )
        )
      ) {
        Errors.throwHostEnvironment('The independent quarantine child identity changed before the abrupt fault.')
      }
      validatedCleanupCapture = structuredClone(proof.capture)
      ownedNames = proof.resources.map(owner => owner.name)
      await record({
        action: 'spawn gap independently proved before abrupt holder fault',
        processes: safeProcesses(proof.capture.processes),
        generation: intent.id,
      })
      if (
        !operations.processTree.sameProcess(
          operations.processTree.identities([helperIdentity.pid]).get(helperIdentity.pid),
          helperIdentity,
        )
      ) {
        Errors.throwHostEnvironment('The quarantine holder kernel identity changed before the abrupt fault.')
      }
      operations.processTree.signalTracked([helperIdentity], 'SIGKILL')
      await helper.waitForClose()
      await record({ action: 'genuine abrupt owned holder kill completed', signal: 'SIGKILL', generation: intent.id })
      let refused = false
      const recoverySignals: Platform.ProcessSignal[] = []
      try {
        await AndroidRecovery.recover(proof.avdName, intent.id, {
          recoverResources: operations.resources.recoverRetained,
          processTree: {
            ...operations.processTree,
            signalTracked: (processes, signal) => {
              recoverySignals.push(signal)
              operations.processTree.signalTracked(processes, signal)
            },
          },
        })
      } catch {
        refused = true
      }
      if (
        !refused || recoverySignals.length !== 0 || (await operations.resources.readOwner({ name }))?.id !== intent.id
      ) {
        Errors.throwHostEnvironment(
          'Unknown launch-intent quarantine recovery did not refuse without signals and preserve its exact fence.',
        )
      }
      await record({
        action: 'unknown quarantine recovery refused without signals; intent retained',
        generation: intent.id,
      })
      await stopProofOwnedChild(validatedCleanupCapture)
      await record({
        action: 'independently captured child stopped; unknown launch intent remains fenced',
        generation: intent.id,
      })
      return ownedNames
    } catch (error) {
      failed = true
      throw error
    } finally {
      const cleanupErrors: unknown[] = []
      const attempt = async (action: () => void | Promise<void>): Promise<void> => {
        try {
          await action()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      // Reporting authority is independent of cleanup authority. A failed proof still leaves
      // a durable launch intent, but that intent must never authorize child signals.
      await attempt(async () => {
        if (helperIdentity !== undefined) {
          const intentPath = FS.resolvePath('launch-intent.json', root)
          const launchIntent = await FS.isFile(intentPath)
            ? await FS.readJson<AgentAppDevDevice>(intentPath).catch(() => undefined)
            : undefined
          const names = launchIntent?.resources?.map(owner => owner.name) ?? []
          const validIntent = launchIntent?.platform === 'android' && launchIntent.owned
            && launchIntent.state === 'reserved' && launchIntent.generation !== undefined
            && operations.processTree.sameProcess(launchIntent.holder, helperIdentity)
            && [1, 2, 3, 4].some(slot =>
              launchIntent.avdName === `${managedLoopAndroidPrefix(privatePlan.invocation)}${slot}`
            )
            && /^emulator-(?:558[02468]|559[02468]|56[0-7][02468]|5680)$/u.test(launchIntent.id)
            && names.length === 2 && names.includes(`android-avd:${launchIntent.avdName}`)
            && names.includes(`android-emulator:${launchIntent.id}`)
            && launchIntent.resources!.every(owner =>
              owner.id === launchIntent.generation && !privatePlan.baselineResources.includes(owner.name)
            )
          const retainedIntents = (await operations.resources.listOwners().catch(error => {
            evidence.detail = Errors.formatForUser(error)
            return []
          })).filter(owner =>
            validIntent && names.includes(owner.name) && owner.id === launchIntent!.generation
            && owner.pid === helperIdentity!.pid && owner.repositoryRoot === privatePlan.checkout
            && (owner.processStartedAt === undefined || owner.processStartedAt === helperIdentity!.startedAt)
            && owner.retention?.quarantined === true && owner.retention.processes.length === 0
            && owner.retention.resourceNames.length === 2 && names.every(name =>
              owner.retention!.resourceNames.includes(name)
            )
            && owner.retention.reason.includes('launch intent; child identity is not yet captured.')
          )
          ownedNames = [...new Set([...ownedNames, ...retainedIntents.map(owner => owner.name)])]
          evidence.unresolved = retainedIntents.map(owner => ({ name: owner.name, generation: owner.id }))
        }
      })
      await attempt(async () => {
        if (
          helperIdentity !== undefined
          && operations.processTree.sameProcess(
            operations.processTree.identities([helperIdentity.pid]).get(helperIdentity.pid),
            helperIdentity,
          )
        ) {
          operations.processTree.signalTracked([helperIdentity], 'SIGKILL')
          await helper.waitForClose()
        }
      })
      if (validatedCleanupCapture !== undefined) {
        await attempt(() => stopProofOwnedChild(validatedCleanupCapture!))
      }
      await attempt(() => helper.closeOutput())
      await attempt(() => helper.dispose())
      for (const error of cleanupErrors) {
        evidence.events.push({ action: `Quarantine helper cleanup failed: ${Errors.formatForUser(error)}` })
      }
      if (!failed && cleanupErrors.length > 0) {
        throw cleanupErrors[0]
      }
    }

    async function stopProofOwnedChild(capture: QuarantineProof['capture']): Promise<void> {
      // Never resolve the registry's unknown quarantine from this separate proof.
      let lastInspectionFailure: unknown
      let failureStage: 'identities' | 'liveness' | 'group' = 'identities'
      let failedObservations = 0
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        operations.processTree.signalTracked(capture.processes, signal)
        const stopped = await Time.pollUntil(() => {
          let stage: 'identities' | 'liveness' | 'group' = 'identities'
          try {
            const current = operations.processTree.identities(capture.processes.map(process => process.pid))
            for (const process of capture.processes) {
              const identity = current.get(process.pid)
              if (operations.processTree.sameProcess(identity, process)) {
                return undefined
              }
              if (identity === undefined) {
                stage = 'liveness'
                if ((operations.quarantineCleanupProcessIsAlive ?? Platform.processIsAlive)(process.pid)) {
                  return undefined
                }
              }
            }
            stage = 'group'
            return capture.rootPid === undefined || !operations.processTree.isGroupAlive(capture.rootPid)
              ? true
              : undefined
          } catch (error) {
            // A denied or failed observation proves nothing. Retry within this phase's original
            // deadline; only later successful identity, liveness and group inspection can prove closure.
            lastInspectionFailure = error
            failureStage = stage
            failedObservations++
            return undefined
          }
        }, {
          intervalMs: 100,
          timeoutMs: 30_000,
          ...(sourceRegression ? operations.quarantineCleanupClock : undefined),
        })
        if (stopped) {
          return
        }
      }
      if (failedObservations > 0) {
        const causes: NonNullable<ManagedLoopTargetFaultEvidence['quarantineCleanupInspectionFailure']>['causes'] = []
        let cause = lastInspectionFailure
        for (let depth = 0; depth < 4 && typeof cause === 'object' && cause !== null; depth++) {
          const entry = cause as { code?: unknown; errno?: unknown; syscall?: unknown; cause?: unknown }
          causes.push({
            ...(typeof entry.code === 'string' ? { code: entry.code.slice(0, 128) } : {}),
            ...(typeof entry.errno === 'string'
              ? { errno: entry.errno.slice(0, 128) }
              : typeof entry.errno === 'number' && Number.isFinite(entry.errno)
              ? { errno: entry.errno }
              : {}),
            ...(typeof entry.syscall === 'string' ? { syscall: entry.syscall.slice(0, 128) } : {}),
          })
          cause = entry.cause
        }
        evidence.quarantineCleanupInspectionFailure ??= {
          rootPid: capture.rootPid,
          stage: failureStage,
          observations: failedObservations,
          diagnostic: Errors.formatForLog(lastInspectionFailure).slice(0, 4096),
          causes,
        }
      }
      Errors.throwHostEnvironment(
        'Independent quarantine child cleanup remains unproved; its launch-intent fence is retained.',
        { cause: lastInspectionFailure },
      )
    }
  }

  async function iosRecovery(): Promise<string[]> {
    const helper = await createManagedIosFixture({
      invocation: FS.basename(artifactRoot),
      scope: Platform.randomUUID(),
      artifactRoot: root,
      baselineResources: before!.resources.map(resource => resource.name),
      shouldStop: () => false,
      externalLedger: false,
    }, {
      run: operations.run,
      start: operations.start,
      tree: operations.processTree,
      resources: operations.resources,
      ...operations.iosRuntime,
    })
    type Device = { name: string; udid: string; state?: string; deviceTypeIdentifier?: string; runtime: string }
    const list = async (): Promise<Device[]> => {
      const result = await operations.run('xcrun', {
        args: ['simctl', 'list', 'devices', '--json', 'available'],
        timeoutMs: 30_000,
        processPolicy: 'test',
      })
      requireSuccess(result, 'Could not inspect the iOS simulator inventory.')
      const parsed = JSON.parse(result.stdout) as { devices?: Record<string, Omit<Device, 'runtime'>[]> }
      return Object.entries(parsed.devices ?? {}).filter(([runtime]) => runtime.includes('.iOS-')).flatMap((
        [runtime, devices],
      ) => devices.map(device => ({ ...device, runtime })))
    }
    const beforeDevices = await list()
    await ManagedLoopAcceptanceEvidence.write(
      root,
      'ios-before',
      beforeDevices.map(({ udid, state }) => ({ udid, state })),
    )
    const template = beforeDevices.find(device =>
      device.deviceTypeIdentifier !== undefined && device.name.includes('iPhone')
    )
    if (template?.deviceTypeIdentifier === undefined) {
      Errors.throwHostEnvironment('No available iOS iPhone runtime can create the invocation-owned fault target.')
    }
    const intent = {
      name: `${helper.selection.namePrefix}1`,
      type: template.deviceTypeIdentifier,
      runtime: template.runtime,
    }
    try {
      await helper.selection.beforeCreate(intent)
    } finally {
      if (helper.asset.creation !== undefined) {
        ownedNames = [helper.asset.creation.name]
      }
    }
    const created = await helper.run('xcrun', {
      args: [
        'simctl',
        'create',
        intent.name,
        template.deviceTypeIdentifier,
        template.runtime,
      ],
      timeoutMs: 30_000,
      processPolicy: 'test',
    })
    requireSuccess(created, 'Could not create the invocation-owned iOS fault target.')
    const udid = created.stdout.trim()
    await helper.selection.afterCreate({ ...intent, id: udid })
    if (!/^[0-9a-f-]{36}$/iu.test(udid) || beforeDevices.some(device => device.udid === udid)) {
      Errors.throwHostEnvironment('The created iOS target did not report a fresh UDID; refusing target control.')
    }
    const name = `ios-simulator:${udid}`
    ownedNames = [name, helper.asset.creation!.name]
    const externalPath = FS.resolvePath(`Library/Developer/CoreSimulator/Devices/${udid}`, FS.homeDir())
    evidence.createdTargets = [{ platform: 'ios', id: udid, externalPath, cleanup: 'retained' }]
    let lease: MachineResourceLease | undefined
    let retained: MachineResourceOwner | undefined
    let removed = false
    let preparationUncertain = false
    const publish = async (owner: MachineResourceOwner) =>
      helper.observeDevice({
        platform: 'ios',
        id: udid,
        owned: true,
        state: 'booted',
        resources: [owner],
        holder: helper.asset.holder,
      })
    try {
      await ManagedLoopAcceptanceEvidence.write(root, 'external-directories', [{
        path: externalPath,
        owner: 'this invocation',
        purpose: 'fixed iOS recovery fault',
        cleanup: 'delete only after verified shutdown and exact generation recovery',
      }])
      lease = await acquireCreatedTarget()
      retained = await operations.resources.retain({
        owners: [lease.owner],
        processes: [],
        quarantined: true,
        reason: 'Invocation-created iOS target requires verified shutdown.',
      })
      evidence.unresolved = [{ name, generation: retained.id }]
      await record({ action: 'fresh iOS target launch intent retained', generation: retained.id })
      await publish(retained)
      await assertCurrent(retained)
      const boot = await helper.run('xcrun', {
        args: ['simctl', 'boot', udid],
        timeoutMs: 60_000,
        processPolicy: 'test',
      })
      await assertCurrent(retained)
      requireSuccess(boot, 'Could not boot the invocation-owned iOS target.')
      if (!(await list()).some(device => device.udid === udid && device.state === 'Booted')) {
        Errors.throwHostEnvironment('The invocation-owned iOS target did not report Booted.')
      }
      try {
        await helper.prepare({
          device: {
            platform: 'ios',
            id: udid,
            owned: true,
            state: 'booted',
            resources: [retained],
            holder: helper.asset.holder,
          },
          reservation: appDevReservation('ios', udid, [retained], operations.resources.readOwner),
          shouldStop: () => false,
        })
      } catch (error) {
        preparationUncertain = error instanceof Errors.HostEnvironmentError
          && error.details?.['retainsTargetLease'] === true
        throw error
      }
      let refused = false
      try {
        await operations.resources.recoverRetained({ name, generation: retained.id, shutdown: async () => false })
      } catch {
        refused = true
      }
      if (!refused || (await operations.resources.readOwner({ name }))?.id !== retained.id) {
        Errors.throwHostEnvironment('Injected owned iOS shutdown refusal did not retain its exact fence.')
      }
      await record({
        action: 'owned iOS shutdown deliberately withheld; exact fence retained',
        injected: true,
        generation: retained.id,
      })
      const previous = retained
      retained = await operations.resources.retain({
        owners: [retained],
        processes: [],
        quarantined: true,
        reason: 'Owned iOS recovery fault rotated generation.',
      })
      await publish(retained)
      if (retained.id === previous.id) {
        Errors.throwHostEnvironment('The owned iOS retained generation did not rotate.')
      }
      let staleRefused = false
      try {
        await operations.resources.recoverRetained({ name, generation: previous.id, shutdown: async () => true })
      } catch {
        staleRefused = true
      }
      if (!staleRefused || (await operations.resources.readOwner({ name }))?.id !== retained.id) {
        Errors.throwHostEnvironment('The stale iOS generation was not fenced before shutdown.')
      }
      await record({ action: 'stale iOS generation refused', generation: previous.id })
      await cleanup()
      await record({
        action: 'owned iOS shutdown, exact generation recovery and deletion proved',
        generation: retained.id,
      })
      return [name, helper.asset.creation!.name]
    } finally {
      if (!removed) {
        await cleanup().catch(error => {
          evidence.detail = Errors.formatForUser(error)
        })
      }
    }

    async function cleanup(): Promise<void> {
      if (preparationUncertain) {
        Errors.throwHostEnvironment('Private iOS fault preparation remains uncertain; resources retained.')
      }
      if (lease === undefined) {
        // Creation itself proves provenance. Acquire the created UDID before cleanup;
        // a competing owner means retain the directory, never borrow its authority.
        lease = await acquireCreatedTarget()
      }
      const expected = retained ?? lease.owner
      await publish(expected)
      const destructiveCleanup = async (): Promise<boolean> => {
        await assertCurrent(expected)
        const state = (await list()).find(device => device.udid === udid)?.state
        await assertCurrent(expected)
        if (state !== 'Shutdown') {
          await assertCurrent(expected)
          const result = await helper.run('xcrun', {
            args: ['simctl', 'shutdown', udid],
            timeoutMs: 30_000,
            processPolicy: 'test',
          })
          await assertCurrent(expected)
          requireSuccess(result, 'Could not shut down the invocation-owned iOS fault target.')
        }
        if (!(await list()).some(device => device.udid === udid && device.state === 'Shutdown')) {
          return false
        }
        await assertCurrent(expected)
        const deleted = await helper.run('xcrun', {
          args: ['simctl', 'delete', udid],
          timeoutMs: 30_000,
          processPolicy: 'test',
        })
        await assertCurrent(expected)
        requireSuccess(deleted, 'Could not delete the shutdown invocation-owned iOS fault target.')
        if ((await list()).some(device => device.udid === udid)) {
          Errors.throwHostEnvironment('The deleted invocation-owned iOS fault target remains in inventory.')
        }
        await assertCurrent(expected)
        return true
      }
      if (retained !== undefined) {
        if (!await destructiveCleanup()) {
          Errors.throwHostEnvironment('Private iOS shutdown remains unproved.')
        }
        await helper.finishProducerDeletion([expected])
        await operations.resources.recoverRetained({ name, generation: expected.id, shutdown: async () => true })
      } else {
        if (!await destructiveCleanup()) {
          Errors.throwHostEnvironment(
            'The created iOS target shutdown remains unproved; its original lease is retained.',
          )
        }
        await helper.finishProducerDeletion([expected])
        await lease.release()
      }
      removed = true
      evidence.createdTargets![0]!.cleanup = 'complete'
      for (const peer of beforeDevices) {
        if (!(await list()).some(device => device.udid === peer.udid && device.state === peer.state)) {
          Errors.throwHostEnvironment('An existing iOS simulator changed during the owned fault case.')
        }
      }
      await ManagedLoopAcceptanceEvidence.write(root, 'external-directories', [])
    }

    async function acquireCreatedTarget(): Promise<MachineResourceLease> {
      return await operations.resources.acquire({
        command: 'owned target-fault iOS recovery',
        name,
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
    }

    async function assertCurrent(expected: MachineResourceOwner): Promise<void> {
      const current = await operations.resources.readOwner({ name })
      if (
        current?.id !== expected.id || current.pid !== expected.pid
        || current.repositoryRoot !== expected.repositoryRoot || current.processStartedAt !== expected.processStartedAt
      ) {
        Errors.throwHostEnvironment(
          'The invocation-created iOS target ownership generation changed; refusing destructive continuation.',
        )
      }
    }
  }
}

function safeProcesses(processes: readonly TrackedProcess[]): TrackedProcess[] {
  return processes.map(process => ({ ...process, command: 'invocation-owned emulator child' }))
}

function requireSuccess(result: CLI.CommandResult, message: string): void {
  if (result.exitCode !== 0 || result.error !== undefined) {
    Errors.throwHostEnvironment(message)
  }
}
