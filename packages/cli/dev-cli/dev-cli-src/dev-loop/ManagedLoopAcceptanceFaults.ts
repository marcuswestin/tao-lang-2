import { lineDevLoopReporter } from '@expo-host/dev-loop/DevLoopOutput'
import { type DevLoopOperations, runDevLoop } from '@expo-host/dev-loop/expo-dev-loop'
import type { FixedIosLaunchCapture } from '@expo-host/dev-loop/expo-runner/fixedIosLaunchCommand'
import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, HCI, Platform, ProjectDevSession, Repo, Time } from '@shared'
import { connectDevLoopWorker, devLoopRequest } from '@shared/DevLoopControl'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { MachineLanes } from '@verification/MachineLanes'
import { runManagedMobileFixture } from '../../../../testing/e2e-testing/native/ManagedMobileFixture'
import { TaoAppModules } from '../../../tao-cli/AppModules'
import { type AgentAppDevDevice, type AgentAppDevOperations, runAgentAppDev } from '../simulators/AgentAppDev'
import { AndroidOwnershipCapture } from '../simulators/AndroidOwnershipCapture'
import { type ManagedLoopOwnershipCheckpoint, runDevLoopController } from './DevLoopController'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopReceipt,
} from './DevLoopStore'
import {
  cleanupManagedLoopAndroidAssets,
  managedLoopAndroidOperations,
  managedLoopAndroidPrefix,
} from './ManagedLoopAcceptanceAndroidTarget'
export { managedLoopAndroidPrefix } from './ManagedLoopAcceptanceAndroidTarget'
import { ManagedLoopAcceptanceEvidence } from './ManagedLoopAcceptanceEvidence'
import type { ManagedLoopFixture } from './ManagedLoopAcceptanceFixture'
import {
  cleanupManagedIosFixtureAssets,
  createManagedIosFixture,
  type ManagedIosAsset,
  type ManagedIosRuntimeOperations,
} from './ManagedLoopAcceptanceIosRuntime'

const scenarios = [
  'metro-failure',
  'dispatch-failure',
  'pause-compile',
  'pause-metro',
  'pause-dispatch',
  'pause-restart',
  'delayed-cleanup',
  'cleanup-failure',
  'authenticated-controls',
  'android-owned-normal',
  'android-owned-parallel',
  'android-owned-visible',
  'ios-owned-normal',
  'ios-owned-parallel',
  'ios-owned-visible',
  'ios-owned-stop-boot',
  'ios-owned-stop-install',
  'ios-owned-stop-openurl',
  'combined-owned-normal',
  'combined-web-failure',
  'mobile-android-driver-failure',
  'mobile-ios-driver-failure',
  'mobile-android-delayed-action',
  'mobile-ios-delayed-action',
  'mobile-android-deletion-failure',
  'mobile-ios-deletion-failure',
] as const
export type ManagedLoopFaultScenario = typeof scenarios[number]
const nativeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export type ManagedIosNativeStopObservation = {
  version: 1
  invocation: string
  scope: string
  session: string
  loopGeneration: string
  stage: 'boot' | 'install' | 'openurl'
  id: string
  actionGeneration: string
  holder: TrackedProcess
  bootstrap?: TrackedProcess
  owners: readonly MachineResourceOwner[]
  worker: TrackedProcess
  native: TrackedProcess
  supervisor?: TrackedProcess
  group: number
  processes: readonly TrackedProcess[]
}

export function managedIosNativeStopStage(scenario: ManagedLoopFaultScenario) {
  return scenario === 'ios-owned-stop-boot'
    ? 'boot'
    : scenario === 'ios-owned-stop-install'
    ? 'install'
    : scenario === 'ios-owned-stop-openurl'
    ? 'openurl'
    : undefined
}

/** Preserve the canonical owned-device environment before starting the fixed private worker. */
export function startManagedIosNativeFaultWorker(options: {
  invocation: string
  scope: string
  asset?: ManagedIosAsset
  spec: CLI.CommandSpec
  credentials: string
  shouldStop: () => boolean
}, start: typeof CLI.start = CLI.start): CLI.StartedCommand {
  requireUuid(options.invocation)
  requireUuid(options.scope)
  const { asset, spec } = options
  if (
    options.shouldStop() || asset?.state !== 'prepared' || !asset.id
    || asset.invocation !== options.invocation || asset.scope !== options.scope
    || spec.env?.['TAO_AGENT_SIMULATOR_QUIET'] !== '1'
    || spec.env?.['TAO_AGENT_SIMULATOR_UDID'] !== asset.id
    || spec.env?.['TAO_DEV_LOOP_WORKER_CREDENTIALS'] !== options.credentials
  ) {
    Errors.throwHostEnvironment('Private native openurl worker lacks its exact prepared managed target.')
  }
  return start(Platform.runtimeProcess.execPath, {
    ...spec,
    args: [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'),
      options.invocation,
      options.scope,
      'worker',
    ],
  })
}

/** Synchronous public-stop entry checks kernels; registry snapshots and cleanup are separate proofs. */
export function inspectManagedIosNativeStopObservation(
  observation: ManagedIosNativeStopObservation,
  context: { invocation: string; scope: string; stage: string; receipt: DevLoopReceipt; asset: ManagedIosAsset },
  tree: Pick<typeof ProcessTree, 'identities' | 'sameProcess' | 'processGroupOf' | 'groupMembers' | 'descendants'> =
    ProcessTree,
): { proved: boolean; reason?: string; native?: TrackedProcess } {
  try {
    const { asset, receipt } = context
    const action = asset.actions.at(-1)
    const device = receipt.devices?.find(device => device.platform === 'ios')
    if (
      observation.version !== 1 || observation.invocation !== context.invocation || observation.scope !== context.scope
      || observation.session !== receipt.session || observation.loopGeneration !== receipt.generation
      || observation.stage !== context.stage || !nativeUuid.test(observation.actionGeneration)
      || asset.version !== 2 || asset.invocation !== context.invocation || asset.scope !== context.scope
      || !nativeUuid.test(observation.id) || observation.id !== asset.id || device?.id !== asset.id || !device.owned
      || !Array.isArray(observation.processes) || !Array.isArray(observation.owners) || observation.owners.length === 0
      || !observation.owners.every(owner =>
        [asset.creation, ...asset.resources ?? []].some(expected =>
          expected !== undefined && expected.name === owner.name && expected.id === owner.id
          && expected.pid === owner.pid
        )
      )
      || !device.resources?.every(owner =>
        observation.owners.some(expected => expected.name === owner.name && expected.id === owner.id)
      )
      || observation.holder.pid !== asset.holder.pid || !tree.sameProcess(observation.holder, asset.holder)
      || (observation.stage !== 'boot' && (!asset.bootstrap || !observation.bootstrap
        || observation.bootstrap.pid !== asset.bootstrap.pid
        || !tree.sameProcess(observation.bootstrap, asset.bootstrap)))
      || (observation.stage === 'openurl'
        ? asset.state !== 'prepared'
        : action?.generation !== observation.actionGeneration || action.stage !== observation.stage
          || action.state !== 'captured' || action.barrier?.released !== true)
    ) {
      return { proved: false, reason: 'Native stop observation has stale target, action, loop or owner snapshots.' }
    }
    if (observation.stage !== 'openurl') {
      const barrier = action?.barrier
      if (
        !barrier || barrier.generation !== observation.actionGeneration || barrier.group !== observation.group
        || observation.worker.pid !== barrier.worker.pid || !tree.sameProcess(observation.worker, barrier.worker)
        || !observation.supervisor || observation.supervisor.pid !== barrier.supervisor.pid
        || !tree.sameProcess(observation.supervisor, barrier.supervisor)
        || !barrier.processes.some(process =>
          process.pid === observation.native.pid && tree.sameProcess(process, observation.native)
        )
      ) {
        return { proved: false, reason: 'Native stop observation differs from its durable original command capture.' }
      }
    }
    const anchors = [
      observation.holder,
      observation.worker,
      observation.native,
      ...observation.bootstrap ? [observation.bootstrap] : [],
      ...observation.supervisor ? [observation.supervisor] : [],
    ]
    const before = tree.identities(anchors.map(process => process.pid))
    if (
      !anchors.every(process =>
        before.get(process.pid)?.pid === process.pid && tree.sameProcess(before.get(process.pid), process)
      )
      || before.get(observation.native.pid)?.command !== 'simctl'
      || ![observation.worker, observation.native, ...observation.supervisor ? [observation.supervisor] : []].every(
        process => tree.processGroupOf(process.pid) === observation.group,
      )
      || !observation.processes.some(process =>
        process.pid === observation.native.pid && tree.sameProcess(process, observation.native)
      )
    ) {
      return { proved: false, reason: 'Native simctl or its original kernel/group anchors are absent or changed.' }
    }
    if (observation.native.pid !== observation.worker.pid) {
      const descendants = tree.descendants(observation.worker.pid)
      const after = tree.identities([observation.worker.pid, observation.native.pid])
      if (
        !tree.sameProcess(after.get(observation.worker.pid), observation.worker)
        || after.get(observation.native.pid)?.command !== 'simctl'
        || !tree.sameProcess(after.get(observation.native.pid), observation.native)
        || !descendants.some(process =>
          process.pid === observation.native.pid && tree.sameProcess(process, observation.native)
        )
      ) {
        return { proved: false, reason: 'Native descendant ancestry crossed an unproved original worker exit.' }
      }
    }
    const members = tree.groupMembers(observation.group)
    if (
      !members.some(process => process.pid === observation.native.pid && tree.sameProcess(process, observation.native))
      || observation.supervisor
        && members.some(process =>
          !observation.processes.some(expected => expected.pid === process.pid && tree.sameProcess(process, expected))
        )
    ) {
      return { proved: false, reason: 'Native group membership is unproved.' }
    }
    const final = tree.identities(anchors.map(process => process.pid))
    if (
      !anchors.every(process =>
        final.get(process.pid)?.pid === process.pid && tree.sameProcess(final.get(process.pid), process)
      )
      || final.get(observation.native.pid)?.command !== 'simctl'
    ) {
      return { proved: false, reason: 'Native command exited or changed during the stop-entry observation.' }
    }
    return { proved: true, native: final.get(observation.native.pid) }
  } catch (error) {
    return { proved: false, reason: `Native stop inspection is inconclusive: ${Errors.formatForUser(error)}` }
  }
}

async function publishNativeStopObservation(
  eventRoot: string,
  observation: ManagedIosNativeStopObservation,
  record: (event: unknown) => Promise<void>,
) {
  const temporary = FS.resolvePath(`ios-native-execution-${Platform.randomUUID()}.tmp`, eventRoot)
  try {
    await FS.writeJson(temporary, observation, { mode: 0o600 })
    await FS.move(temporary, FS.resolvePath('ios-native-execution.json', eventRoot))
  } finally {
    await FS.remove(temporary)
  }
  await record({ event: 'ios-native-executing', ...observation })
}

/** Observation refusal and journal failure must never prevent the controller from latching stop. */
export function createManagedIosNativeStopEntry(options: {
  invocation: string
  scope: string
  stage: 'boot' | 'install' | 'openurl'
  eventRoot: string
  receipt: DevLoopReceipt
  record: (event: unknown) => Promise<void>
}, overrides: Partial<{
  readText: typeof FS.readTextSync
  tree: NonNullable<Parameters<typeof inspectManagedIosNativeStopObservation>[2]>
}> = {}) {
  const readText = overrides.readText ?? FS.readTextSync
  let publication = Promise.resolve()
  return {
    onStop: () => {
      let observation: ManagedIosNativeStopObservation | undefined
      let inspected: ReturnType<typeof inspectManagedIosNativeStopObservation>
      try {
        observation = JSON.parse(
          readText(FS.resolvePath('ios-native-execution.json', options.eventRoot)),
        ) as ManagedIosNativeStopObservation
        const asset = JSON.parse(
          readText(FS.resolvePath(`ios-${options.scope}/asset.json`, options.eventRoot)),
        ) as ManagedIosAsset
        inspected = inspectManagedIosNativeStopObservation(observation, { ...options, asset }, overrides.tree)
      } catch (error) {
        inspected = {
          proved: false,
          reason: `Native observation unavailable at stop entry: ${Errors.formatForUser(error)}`,
        }
      }
      try {
        publication = options.record({
          event: 'ios-native-stop-entry',
          stage: options.stage,
          session: options.receipt.session,
          generation: options.receipt.generation,
          observation,
          ...inspected,
        })
      } catch (error) {
        publication = Promise.reject(error)
      }
      void publication.catch(() => {})
    },
    flush: async () => await publication,
  }
}

/** Uses the existing lower launch observer; a released ACK alone never publishes native execution. */
export async function observeManagedIosNativeOpenurl(options: {
  capture: FixedIosLaunchCapture
  invocation: string
  scope: string
  session: string
  eventRoot: string
  generation: () => string | undefined
  shouldStop: () => boolean
  asset: () => Promise<ManagedIosAsset>
  receipt: () => Promise<DevLoopReceipt>
  record: (event: unknown) => Promise<void>
}, operations: {
  tree: NonNullable<Parameters<typeof inspectManagedIosNativeStopObservation>[2]>
  readOwner: typeof MachineResources.readOwner
} = { tree: ProcessTree, readOwner: MachineResources.readOwner }) {
  const { capture } = options
  if (capture.stage !== 'openurl' || capture.phase !== 'released') {
    return
  }
  const actionGeneration = Platform.randomUUID()
  const generation = options.generation()
  const group = operations.tree.processGroupOf(capture.root.pid)
  if (!generation || group === undefined) {
    return
  }
  await Time.pollUntil(async () => {
    if (
      options.shouldStop() || capture.command.error !== undefined || capture.command.exitCode !== null
      || capture.command.signalCode !== null || options.generation() !== generation
    ) {
      return true
    }
    const before = operations.tree.identities([capture.root.pid]).get(capture.root.pid)
    if (!before || before.pid !== capture.root.pid || !operations.tree.sameProcess(before, capture.root)) {
      return true
    }
    const descendants = operations.tree.descendants(capture.root.pid)
    const processes = [capture.root, ...descendants]
    const current = operations.tree.identities(processes.map(process => process.pid))
    if (!operations.tree.sameProcess(current.get(capture.root.pid), capture.root)) {
      return true
    }
    const native = processes.map(process => current.get(process.pid)).find(process =>
      process?.command === 'simctl'
      && processes.some(expected => expected.pid === process.pid && operations.tree.sameProcess(process, expected))
    )
    if (!native) {
      return undefined
    }
    const asset = await options.asset()
    const receipt = await options.receipt()
    const owners = asset.resources ?? []
    for (const owner of owners) {
      const actual = await operations.readOwner({ name: owner.name })
      if (actual?.id !== owner.id || actual.pid !== owner.pid) {
        Errors.throwHostEnvironment('Native openurl observation lost its current target resource generation.')
      }
    }
    const observation: ManagedIosNativeStopObservation = {
      version: 1,
      invocation: options.invocation,
      scope: options.scope,
      session: options.session,
      loopGeneration: generation,
      stage: 'openurl',
      id: asset.id ?? '',
      actionGeneration,
      holder: asset.holder,
      bootstrap: asset.bootstrap,
      owners,
      worker: capture.root,
      native,
      group,
      processes,
    }
    const inspected = inspectManagedIosNativeStopObservation(observation, {
      invocation: options.invocation,
      scope: options.scope,
      stage: 'openurl',
      receipt,
      asset,
    }, operations.tree)
    if (
      !inspected.proved || options.shouldStop() || options.generation() !== generation
      || capture.command.exitCode !== null || capture.command.signalCode !== null
    ) {
      return true
    }
    await publishNativeStopObservation(options.eventRoot, observation, options.record)
    return true
  }, { intervalMs: 25, timeoutMs: 30_000 })
}

/** Observers see only complete ordered snapshots, even when startup and cancellation overlap. */
export function createManagedLoopFaultRecorder(
  eventRoot: string,
  role: 'worker' | 'controller',
  operations: { write: typeof FS.writeJson; move: typeof FS.move } = { write: FS.writeJson, move: FS.move },
): (event: unknown) => Promise<void> {
  const events: unknown[] = []
  let publication = Promise.resolve()
  return event => {
    events.push(ManagedLoopAcceptanceEvidence.sanitize(event))
    const snapshot = structuredClone(events)
    publication = publication.then(async () => {
      const temporary = FS.resolvePath(`${role}-events-${Platform.randomUUID()}.tmp`, eventRoot)
      try {
        await operations.write(temporary, snapshot, { mode: 0o600 })
        await operations.move(temporary, FS.resolvePath(`${role}-events.json`, eventRoot))
      } finally {
        await FS.remove(temporary)
      }
    })
    return publication
  }
}

type AndroidCheckpoint = ManagedLoopOwnershipCheckpoint & {
  invocation: string
  scope: string
  event: 'ownership-checkpoint'
}

/** Fixed finite admission: durable generations are read first, then live comparison and signalling are synchronous. */
export async function admitManagedAndroidAbruptDeath(options: {
  invocation: string
  scope: string
  session: string
  eventRoot: string
  signal: (controller: TrackedProcess) => void
}, seams: {
  receipt?: typeof readDevLoopReceipt
  readOwner?: typeof MachineResources.readOwner
  readReceiptSync?: (session: string) => DevLoopReceipt
  withCurrentOwners?: typeof MachineResources.withCurrentOwners
  readEvents?: (path: string) => Promise<unknown[]>
  tree?: Pick<typeof ProcessTree, 'identities' | 'descendants' | 'processGroupOf' | 'groupMembers' | 'isGroupAlive'> & {
    processIsAlive?: (pid: number) => boolean
  }
} = {}): Promise<void> {
  requireUuid(options.invocation)
  requireUuid(options.scope)
  requireUuid(options.session)
  if (
    options.eventRoot
      !== Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${options.invocation}/faults/${options.scope}`)
  ) {
    Errors.throwHostEnvironment('Android death admission requires its fixed invocation-owned checkpoint directory.')
  }
  const events = await (seams.readEvents ?? (async path => await FS.isFile(path) ? await FS.readJson(path) : []))(
    FS.resolvePath('controller-events.json', options.eventRoot),
  )
  const checkpoint = events.findLast(event =>
    event !== null && typeof event === 'object'
    && (event as Partial<AndroidCheckpoint>).event === 'ownership-checkpoint'
  ) as AndroidCheckpoint | undefined
  const readReceipt = seams.receipt ?? readDevLoopReceipt
  const durable = await readReceipt(options.session)
  if (
    checkpoint?.version !== 1 || checkpoint.invocation !== options.invocation || checkpoint.scope !== options.scope
    || checkpoint.session !== options.session || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 1
    || durable === undefined || durable.generation !== checkpoint.loopGeneration || durable.state !== 'ready'
    || durable.ownershipRefusal || durable.provenance !== 'complete'
    || durable.mobileDriverCleanup === 'opening' || durable.mobileDriverCleanup === 'retained'
    || !ProcessTree.sameProcess(durable.controller, checkpoint.controller)
    || JSON.stringify(durable.devices ?? []) !== JSON.stringify(checkpoint.devices)
    || JSON.stringify(durable.children) !== JSON.stringify(checkpoint.children)
    || JSON.stringify(durable.processGroups ?? []) !== JSON.stringify(checkpoint.processGroups)
  ) {
    Errors.throwHostEnvironment(
      'Android controller death requires a fresh durable ownership checkpoint and proved driver cleanup.',
    )
  }
  const device = checkpoint.devices.find(value => value.platform === 'android')
  if (
    device?.owned !== true || device.state !== 'booted' || !device.generation || !device.avdName
    || device.resources?.length !== 2
    || !device.resources.some(owner => owner.name === `android-avd:${device.avdName}`)
    || !device.resources.some(owner => owner.name === `android-emulator:${device.id}`)
    || device.resources.some(owner => owner.id !== device.generation || owner.retention?.quarantined !== false)
  ) {
    Errors.throwHostEnvironment('Android controller death requires both exact owned physical resource generations.')
  }
  const resources = device.resources
  for (const expected of resources) {
    const owner = await (seams.readOwner ?? MachineResources.readOwner)({ name: expected.name })
    if (
      owner?.id !== expected.id || owner.pid !== expected.pid || owner.processStartedAt !== expected.processStartedAt
      || owner.repositoryRoot !== expected.repositoryRoot
      || JSON.stringify(owner.retention) !== JSON.stringify(expected.retention)
    ) {
      Errors.throwHostEnvironment('Android physical ownership changed after its durable checkpoint.')
    }
  }
  await (seams.withCurrentOwners ?? MachineResources.withCurrentOwners)({ owners: resources }, () => {
    const latest = (seams.readReceiptSync ?? (session =>
      JSON.parse(FS.readTextSync(FS.resolvePath('receipt.json', devLoopDirectory(session)))) as DevLoopReceipt))(
        options.session,
      )
    if (JSON.stringify(latest) !== JSON.stringify(durable)) {
      Errors.throwHostEnvironment('Android loop publication changed during controller death admission.')
    }
    const tree = seams.tree ?? ProcessTree
    if (
      !ProcessTree.sameProcess(
        tree.identities([checkpoint.controller.pid]).get(checkpoint.controller.pid),
        checkpoint.controller,
      )
    ) {
      Errors.throwHostEnvironment('Android controller death lost its original controller anchor.')
    }
    for (const owner of resources) {
      AndroidOwnershipCapture.verify({
        processes: owner.retention!.processes,
        rootPid: owner.retention!.processGroupPid,
        uncertain: owner.retention!.quarantined,
      }, tree)
    }
    const identities = tree.identities(checkpoint.children.map(process =>
      process.pid
    ))
    for (const expected of checkpoint.children) {
      const current = identities.get(expected.pid)
      if (
        current !== undefined && !ProcessTree.sameProcess(current, expected)
        || current === undefined && (seams.tree?.processIsAlive ?? Platform.processIsAlive)(expected.pid)
        || current !== undefined
          && !checkpoint.processGroups.some(group => tree.processGroupOf(current.pid) === group.pid)
      ) {
        Errors.throwHostEnvironment('Android controller death cannot recheck a captured child identity or group.')
      }
    }
    for (const root of checkpoint.processGroups) {
      const live = identities.get(root.pid)
      if (!ProcessTree.sameProcess(live, root)) {
        if (live !== undefined || tree.isGroupAlive(root.pid)) {
          Errors.throwHostEnvironment('Android controller death has a lost or reused captured group anchor.')
        }
        continue
      }
      const members = tree.groupMembers(root.pid)
      const expected = checkpoint.children.filter(process =>
        ProcessTree.sameProcess(identities.get(process.pid), process) && tree.processGroupOf(process.pid) === root.pid
      )
      if (
        tree.processGroupOf(root.pid) !== root.pid || members.length !== expected.length
        || members.some(member => !expected.some(process => ProcessTree.sameProcess(member, process)))
        || tree.descendants(root.pid).some(member =>
          !expected.some(process => ProcessTree.sameProcess(member, process))
        )
        || !ProcessTree.sameProcess(tree.identities([root.pid]).get(root.pid), root)
      ) {
        Errors.throwHostEnvironment('Android controller death has unexplained live process membership.')
      }
    }
    if (
      !ProcessTree.sameProcess(
        tree.identities([checkpoint.controller.pid]).get(checkpoint.controller.pid),
        checkpoint.controller,
      )
    ) {
      Errors.throwHostEnvironment('Android controller death lost its controller immediately before injection.')
    }
    const controllerMembers = tree.groupMembers(checkpoint.controller.pid)
    if (
      tree.processGroupOf(checkpoint.controller.pid) !== checkpoint.controller.pid
      || controllerMembers.length !== 1 || !ProcessTree.sameProcess(controllerMembers[0], checkpoint.controller)
      || tree.descendants(checkpoint.controller.pid).some(process =>
        !checkpoint.children.some(expected => ProcessTree.sameProcess(process, expected))
      )
    ) {
      Errors.throwHostEnvironment('Android controller death has unexplained controller ancestry or group membership.')
    }
    if (
      !ProcessTree.sameProcess(
        tree.identities([checkpoint.controller.pid]).get(checkpoint.controller.pid),
        checkpoint.controller,
      )
    ) {
      Errors.throwHostEnvironment('Android controller death changed its controller after the final live comparison.')
    }
    options.signal(checkpoint.controller)
  })
}
type Plan = {
  version: 1
  id: string
  scenario: ManagedLoopFaultScenario
  session: string
  artifactRoot: string
  fixture: ManagedLoopFixture
  checkout: string
  owner: TrackedProcess
  /** Captured internally before this owned child exists; never accepted from public arguments. */
  baselineResources?: readonly string[]
  borrowedIos?: string
}

/** Admission recognizes the producer's live owned state, never a generic retained target. */
export async function assertManagedLoopBorrowedIosAdmission(
  options: { artifactRoot: string; id: string; owner: TrackedProcess },
  operations: {
    run: typeof CLI.run
    identities: typeof ProcessTree.identities
    evidenceKind?: 'source regression'
  } = { run: CLI.run, identities: ProcessTree.identities },
): Promise<void> {
  requireUuid(options.id)
  const invocation = FS.basename(options.artifactRoot)
  requireUuid(invocation)
  if (options.artifactRoot !== Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`)) {
    Errors.throwHostEnvironment('Combined borrowed iOS admission requires its exact invocation artifact root.')
  }
  const root = FS.resolvePath('borrowed-ios', options.artifactRoot)
  const assertOwner = () => {
    if (!ProcessTree.sameProcess(operations.identities([options.owner.pid]).get(options.owner.pid), options.owner)) {
      Errors.throwHostEnvironment('Combined borrowed iOS admission lost its live invocation owner.')
    }
  }
  assertOwner()
  for (
    const path of [
      root,
      ...['receipt.json', 'sentinel-identity.json', 'external-directories.json'].map(name =>
        FS.resolvePath(name, root)
      ),
    ]
  ) {
    if (await FS.realPath(path) !== path || await FS.fileMode(path) !== (path === root ? 0o700 : 0o600)) {
      Errors.throwHostEnvironment('Combined borrowed iOS producer evidence must remain private within its exact root.')
    }
  }
  const sentinel = await FS.readJson<
    {
      target: string
      id?: string
      artifacts: string
      cleanup: string
      preserved: boolean
      disposition: string
      processes: TrackedProcess[]
      unresolved: unknown[]
      detail?: string
    }
  >(FS.resolvePath('receipt.json', root))
  const identity = await FS.readJson<{ id: string; process: TrackedProcess }>(
    FS.resolvePath('sentinel-identity.json', root),
  )
  const directories = await FS.readJson<{ path: string; owner: string; purpose: string; state: string }[]>(
    FS.resolvePath('external-directories.json', root),
  )
  if (
    sentinel.target !== 'ios' || sentinel.id !== options.id || sentinel.artifacts !== root
    || sentinel.cleanup !== 'retained' || sentinel.preserved !== false || sentinel.detail !== undefined
    || sentinel.disposition !== (operations.evidenceKind ?? 'real-host failure')
    || !Array.isArray(sentinel.unresolved) || sentinel.unresolved.length !== 0
    || !Array.isArray(sentinel.processes) || sentinel.processes.length !== 1
    || identity.id !== options.id || !ProcessTree.sameProcess(sentinel.processes[0], identity.process)
    || directories.length !== 1 || directories[0]?.owner !== root || directories[0].state !== 'active'
    || directories[0].purpose !== 'invocation-owned borrowed iOS sentinel'
    || directories[0].path !== FS.resolvePath(`Library/Developer/CoreSimulator/Devices/${options.id}`, FS.homeDir())
  ) {
    Errors.throwHostEnvironment(
      'Combined targets require the exact live invocation-created borrowed iOS producer state.',
    )
  }
  const probe = async (args: string[]): Promise<string> => {
    assertOwner()
    const result = await operations.run('xcrun', { args, processPolicy: 'test', timeoutMs: 30_000 })
    assertOwner()
    if (result.error !== undefined || result.exitCode !== 0) {
      Errors.throwHostEnvironment('Combined borrowed iOS live target inspection could not be proved.')
    }
    return result.stdout
  }
  const listed = JSON.parse(await probe(['simctl', 'list', 'devices', '--json', 'available'])) as {
    devices?: Record<string, { udid: string; state: string }[]>
  }
  if (
    !Object.entries(listed.devices ?? {}).some(([runtime, devices]) =>
      runtime.includes('.iOS-') && devices.some(device => device.udid === options.id && device.state === 'Booted')
    )
  ) {
    Errors.throwHostEnvironment('Combined borrowed iOS sentinel is no longer booted.')
  }
  const pid = Number((await probe(['simctl', 'spawn', options.id, 'launchctl', 'managerpid'])).trim())
  const current = operations.identities([pid]).get(pid)
  if (
    pid !== identity.process.pid || current === undefined || !/launchd_sim/iu.test(current.command)
    || !ProcessTree.sameProcess(current, identity.process)
  ) {
    Errors.throwHostEnvironment('Combined borrowed iOS sentinel lost its captured bootstrap kernel identity.')
  }
  assertOwner()
}

function mobileTarget(scenario: ManagedLoopFaultScenario): 'android' | 'ios' | undefined {
  if (
    scenario.startsWith('mobile-android-') || scenario.startsWith('android-owned-') || scenario.startsWith('combined-')
  ) {
    return 'android'
  }
  if (scenario.startsWith('mobile-ios-') || scenario.startsWith('ios-owned-')) {
    return 'ios'
  }
  return undefined
}

export function managedLoopFaultArgs(
  fixture: ManagedLoopFixture,
  scenario: ManagedLoopFaultScenario,
  borrowedIos?: string,
): string[] {
  if (scenario.startsWith('combined-')) {
    requireUuid(borrowedIos ?? '')
    return [fixture.root, '--app', 'DataMVPApp', '--web', '--ios', '--android', '--simulator', borrowedIos!]
  }
  return [
    fixture.root,
    '--app',
    'DataMVPApp',
    ...(scenario === 'dispatch-failure' ? ['--web'] : []),
    ...(mobileTarget(scenario) === undefined ? [] : [`--${mobileTarget(scenario)}`]),
    ...(scenario === 'android-owned-visible' ? ['--show-emulator'] : []),
    ...(scenario === 'ios-owned-visible' ? ['--show-simulator'] : []),
  ]
}

/** Resolve the same fixed defaults as app-dev before applying the private target admission adapter. */
export function createManagedLoopFaultWorker(options: {
  invocation: string
  id: string
  session: string
  scenario: ManagedLoopFaultScenario
  eventRoot: string
  baselineResources?: readonly string[]
  borrowedIos?: string
  fixture?: ManagedLoopFixture
  record: (event: unknown) => Promise<void>
  loopGeneration?: () => string
}, overrides: Partial<{
  runAppDev: typeof runAgentAppDev
  liveOperations: () => AgentAppDevOperations
  iosRuntime: Partial<ManagedIosRuntimeOperations>
}> = {}): typeof runAgentAppDev {
  for (const id of [options.invocation, options.id, options.session]) {
    requireUuid(id)
  }
  const expectedRoot = Repo.resolvePath(
    `.artifacts/host-acceptance/managed-loops/${options.invocation}/faults/${options.id}`,
  )
  if (options.eventRoot !== expectedRoot) {
    Errors.throwHostEnvironment('The private managed worker event root is outside its fixed invocation.')
  }
  const canonicalOperations = (): AgentAppDevOperations => ({
    acquireResource: MachineLanes.acquireResource,
    tryAcquireResource: MachineLanes.tryAcquireResource,
    onSignal: Platform.onProcessSignal,
    run: CLI.run,
    start: CLI.start,
    write: HCI.writeLine,
    writeError: HCI.writeErrorLine,
  })
  return async (args, operations = (overrides.liveOperations ?? canonicalOperations)(), managed) => {
    if (
      managed === undefined || operations === undefined
      || managed.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']
        !== FS.resolvePath('active-control/credentials.json', devLoopDirectory(options.session))
    ) {
      Errors.throwUnexpected('Expected the private managed fault worker context.')
    }
    const target = mobileTarget(options.scenario)
    const nativeStage = managedIosNativeStopStage(options.scenario)
    if (target !== undefined) {
      if (options.baselineResources === undefined) {
        Errors.throwHostEnvironment('The private mobile managed worker requires its captured baseline resources.')
      }
      const ios = target === 'ios'
        ? await createManagedIosFixture({
          invocation: options.invocation,
          scope: options.id,
          artifactRoot: options.eventRoot,
          baselineResources: options.baselineResources,
          shouldStop: managed.shouldStop,
          onChild: managed.onChild,
          onCleanupChild: managed.onCleanupChild,
        }, {
          ...overrides.iosRuntime,
          ...(nativeStage === 'boot' || nativeStage === 'install'
            ? {
              onNativeExecution: async (
                execution: Parameters<NonNullable<ManagedIosRuntimeOperations['onNativeExecution']>>[0],
                child: CLI.StartedCommand,
              ) => {
                if (execution.stage !== nativeStage || managed.shouldStop()) {
                  return
                }
                const generation = options.loopGeneration?.()
                if (!generation || child.error !== undefined || child.exitCode !== null || child.signalCode !== null) {
                  return
                }
                await publishNativeStopObservation(options.eventRoot, {
                  ...execution,
                  version: 1,
                  session: options.session,
                  loopGeneration: generation,
                  actionGeneration: execution.generation,
                }, options.record)
              },
            }
            : {}),
        })
        : undefined
      const android = target === 'android'
        ? managedLoopAndroidOperations({
          invocation: options.invocation,
          eventRoot: options.eventRoot,
          baselineResources: options.baselineResources!,
          operations,
          record: options.record,
          borrowedIos: options.borrowedIos,
        })
        : undefined
      const guarded: AgentAppDevOperations = android ?? {
        ...operations,
        privateIos: ios!.selection,
        prepareOwnedIosRuntime: ios!.prepare,
        run: ios!.run,
        acquireResource: async options => {
          ios!.allowResource(options.name)
          return await operations.acquireResource(options)
        },
        tryAcquireResource: async options => {
          ios!.allowResource(options.name)
          return await operations.tryAcquireResource(options)
        },
      }
      if (nativeStage === 'openurl') {
        const canonicalStart = guarded.start
        guarded.start = (command, spec = {}) => {
          if (command !== Repo.resolvePath('tao')) {
            return canonicalStart(command, spec)
          }
          return startManagedIosNativeFaultWorker({
            invocation: options.invocation,
            scope: options.id,
            asset: ios?.asset,
            spec,
            credentials: FS.resolvePath('active-control/credentials.json', devLoopDirectory(options.session)),
            shouldStop: managed.shouldStop,
          }, canonicalStart)
        }
      }
      if (options.scenario.startsWith('combined-')) {
        requireUuid(options.borrowedIos ?? '')
        if (
          options.fixture === undefined
          || JSON.stringify(args)
            !== JSON.stringify(managedLoopFaultArgs(options.fixture, options.scenario, options.borrowedIos))
        ) {
          Errors.throwHostEnvironment(
            'The combined helper requires its exact minted source and borrowed iOS selection.',
          )
        }
        const devices = new Map<string, AgentAppDevDevice>()
        const combinedOperations: AgentAppDevOperations = {
          ...guarded,
          start: (command, spec = {}) => {
            if (command !== Repo.resolvePath('tao')) {
              return guarded.start(command, spec)
            }
            if (managed.shouldStop()) {
              throw Errors.abortError('The combined owned worker was cancelled before dispatch.')
            }
            const ios = devices.get('ios')
            const android = devices.get('android')
            if (
              ios === undefined || ios.id !== options.borrowedIos || ios.owned || ios.state !== 'booted'
              || android?.owned !== true || android.state !== 'booted'
              || !android.avdName?.startsWith(managedLoopAndroidPrefix(options.invocation))
              || !android.resources?.some(resource => resource.name === `android-emulator:${android.id}`)
              || spec.env?.['TAO_DEV_LOOP_WORKER_CREDENTIALS'] !== managed.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']
            ) {
              Errors.throwHostEnvironment(
                'Combined dispatch requires both current invocation-owned mobile reservations before its fixed worker.',
              )
            }
            return guarded.start(Platform.runtimeProcess.execPath, {
              ...spec,
              args: [
                Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'),
                options.invocation,
                options.id,
                'worker',
              ],
            })
          },
        }
        return await (overrides.runAppDev ?? runAgentAppDev)(args, combinedOperations, {
          ...managed,
          onDevice: async device => {
            await managed.onDevice?.(device)
            await android?.observeAndroidDevice(device)
            devices.set(device.platform, structuredClone(device))
          },
        })
      }
      return await (overrides.runAppDev ?? runAgentAppDev)(
        args,
        guarded,
        ios === undefined
          ? {
            ...managed,
            onDevice: async device => {
              await managed.onDevice?.(device)
              await android?.observeAndroidDevice(device)
            },
          }
          : {
            ...managed,
            onDevice: async device => {
              await managed.onDevice?.(device)
              await ios.observeDevice(device)
            },
          },
      )
    }
    const child = operations.start(Platform.runtimeProcess.execPath, {
      args: [
        Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'),
        options.invocation,
        options.id,
        'worker',
      ],
      cwd: Repo.getRoot(),
      detached: true,
      processPolicy: 'server',
      stdio: 'pipe',
      env: managed.childEnv,
      onOutput: managed.onOutput,
    })
    try {
      await managed.onChild(child)
      const result = await child.waitForClose()
      return result.exitCode ?? 1
    } finally {
      try {
        // Match the canonical app-dev boundary on every worker outcome, including startup failure.
        await managed.beforeTargetCleanup?.()
      } finally {
        try {
          await child.closeOutput()
        } finally {
          child.dispose()
        }
      }
    }
  }
}

/** A fixed invocation-owned child exposes named managed-loop fixtures, never a script/endpoint/PID. */
export async function startManagedLoopFault(options: {
  artifactRoot: string
  fixture: ManagedLoopFixture
  scenario: ManagedLoopFaultScenario
  borrowedIos?: string
}): Promise<{
  session: string
  eventRoot: string
  launcher?: TrackedProcess
  initialGeneration: string
  rollback: () => Promise<{ proved: boolean }>
  collect: () => Promise<void>
  probeAuthentication: () => Promise<{ missing: number; wrong: number; stale: string }>
}> {
  const invocation = FS.basename(options.artifactRoot)
  requireUuid(invocation)
  const id = Platform.randomUUID()
  const owner = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
  if (owner === undefined) {
    Errors.throwHostEnvironment('The finite fault launcher could not capture its kernel identity.')
  }
  const session = Platform.randomUUID()
  const planRoot = FS.resolvePath(`faults/${id}`, options.artifactRoot)
  await FS.mkdir(planRoot)
  await FS.chmod(planRoot, 0o700)
  const checkout = await FS.realPath(Repo.getRoot())
  const plan: Plan = {
    version: 1,
    id,
    session,
    scenario: options.scenario,
    artifactRoot: options.artifactRoot,
    fixture: options.fixture,
    checkout,
    owner,
    ...(options.borrowedIos === undefined ? {} : { borrowedIos: options.borrowedIos }),
    ...(mobileTarget(options.scenario) !== undefined
      ? {
        baselineResources: (await ManagedLoopAcceptanceEvidence.inventory()).resources.map(resource => resource.name),
      }
      : {}),
  }
  await FS.writeJson(FS.resolvePath('plan.json', planRoot), plan, { mode: 0o600 })
  const stamp = new Date().toISOString()
  const initialGeneration = Platform.randomUUID()
  await writeDevLoopReceipt({
    version: 1,
    session,
    checkout,
    generation: initialGeneration,
    state: 'starting',
    args: managedLoopFaultArgs(options.fixture, options.scenario, options.borrowedIos),
    selection: { projectRoot: options.fixture.root, appPath: options.fixture.appPath, appName: 'DataMVPApp' },
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    warnings: [],
    failures: [],
    cleanupOutcome: 'pending',
  })
  const { child, collectCapture } = startManagedLoopPrivateController(invocation, id)
  let launcher: TrackedProcess | undefined
  try {
    launcher = child.pid === undefined ? undefined : ProcessTree.identities([child.pid]).get(child.pid)
  } catch { /* Return the minted handle for conservative rollback even if kernel capture is unavailable. */ }
  return {
    session,
    eventRoot: planRoot,
    launcher,
    initialGeneration,
    rollback: () => rollbackManagedLoopFault({ session, fixture: options.fixture, launcher }),
    probeAuthentication: () => probeManagedLoopFaultAuthentication(plan),
    collect: async () => {
      const capture = await collectCapture()
      await ManagedLoopAcceptanceEvidence.write(planRoot, 'capture', {
        scenario: options.scenario,
        session,
        argv: ['fixed finite managed-loop child', invocation, id, 'controller'],
        ...capture,
      })
      if (mobileTarget(plan.scenario) === 'android') {
        await cleanupManagedLoopAndroidAssets(plan, planRoot)
      } else if (mobileTarget(plan.scenario) === 'ios') {
        const closed = await readDevLoopReceipt(plan.session)
        await cleanupManagedIosFixtureAssets({
          root: FS.resolvePath(`ios-${plan.id}`, planRoot),
          receipt: closed,
          baselineResources: plan.baselineResources ?? [],
        })
      }
    },
  }
}

/** Capture can end without claiming the retained private controller has exited. */
export function startManagedLoopPrivateController(invocation: string, id: string, start = CLI.start) {
  const capture = { stdout: '', stderr: '' }
  const child = start(Platform.runtimeProcess.execPath, {
    args: [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'),
      invocation,
      id,
      'controller',
    ],
    cwd: Repo.getRoot(),
    lifetime: { outlivesParent: 'The acceptance controller under test must outlive the launcher that probes it.' },
    processPolicy: 'server',
    stdio: 'pipe',
    unref: true,
    onOutput: (stream, chunk) => {
      capture[stream] = (capture[stream] + chunk.toString('utf8')).slice(-524_288)
    },
    env: { TAO_DEV_LOOP_WORKER_CREDENTIALS: '', TAO_DEV_LOOP_SELECTION_ONLY: '', TAO_DEV_LOOP_CONTROLLER_SESSION: '' },
  })
  return {
    child,
    collectCapture: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let outputCollectionClosed = false
      try {
        await Promise.race([
          child.closeOutput(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Errors.HostEnvironmentError('Private helper output collection cutoff.')),
              5_000,
            )
          }),
        ])
        outputCollectionClosed = true
      } catch {
        /* The cutoff closes pipe handles independently of uncertain child cleanup. */
      } finally {
        clearTimeout(timer)
        child.dispose()
      }
      const helperExited = child.exitCode !== null || child.signalCode !== null
      return {
        exitCode: child.exitCode,
        signal: child.signalCode,
        helperExited,
        cutoff: !helperExited,
        outputCollectionClosed,
        ...capture,
      }
    },
  }
}

/** An unvalidated handle can stop only its captured launcher, never processes copied from a receipt. */
export async function rollbackManagedLoopFault(
  owned: { session: string; fixture: ManagedLoopFixture; launcher?: TrackedProcess },
  overrides: Partial<{
    receipt: typeof readDevLoopReceipt
    identities: typeof ProcessTree.identities
    run: typeof CLI.run
    signal: typeof ManagedLoopAcceptanceEvidence.signalOwned
  }> = {},
): Promise<{ proved: boolean }> {
  const operations = {
    receipt: readDevLoopReceipt,
    identities: ProcessTree.identities,
    run: CLI.run,
    signal: ManagedLoopAcceptanceEvidence.signalOwned,
    ...overrides,
  }
  requireUuid(owned.session)
  const launcher = owned.launcher
  if (launcher === undefined) {
    return { proved: false }
  }
  let current: Awaited<ReturnType<typeof readDevLoopReceipt>> | undefined
  try {
    current = await operations.receipt(owned.session)
  } catch { /* Unknown receipt grants no public control. */ }
  const matches = current?.session === owned.session
    && current.selection?.projectRoot === owned.fixture.root && current.selection.appPath === owned.fixture.appPath
    && current.selection.appName === 'DataMVPApp' && current.checkout === await FS.realPath(Repo.getRoot())
    && ProcessTree.sameProcess(current.controller, launcher)
  if (!matches) {
    if (ProcessTree.sameProcess(operations.identities([launcher.pid]).get(launcher.pid), launcher)) {
      operations.signal(launcher, [launcher], 'SIGINT')
    }
    return { proved: false }
  }
  if (!ProcessTree.sameProcess(operations.identities([launcher.pid]).get(launcher.pid), launcher)) {
    return { proved: false }
  }
  const generation = current!.generation
  const result = await operations.run(Repo.resolvePath('dev'), {
    args: ['dev-loop', 'stop', '--session', owned.session, '--json'],
    cwd: Repo.getRoot(),
    processPolicy: 'test',
    timeoutMs: 180_000,
    stdio: 'pipe',
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    return { proved: false }
  }
  const closed = await operations.receipt(owned.session)
  // No identity from an uncertain receipt is adopted or signaled.
  const processes = [...current!.children, ...current!.processGroups ?? [], launcher]
  return {
    proved: closed.session === owned.session && closed.generation === generation
      && closed.selection?.projectRoot === owned.fixture.root && closed.selection.appPath === owned.fixture.appPath
      && closed.state === 'stopped' && closed.cleanupOutcome === 'proved'
      && !closed.devices?.some(device => device.state !== 'released')
      && !processes.some(process =>
        ProcessTree.sameProcess(operations.identities([process.pid]).get(process.pid), process)
      ),
  }
}

/** Source tests exercise the same phase gate used by the real child, without a host-pass claim. */
export function managedLoopFaultOperations(
  scenario: ManagedLoopFaultScenario,
  record: (event: unknown) => Promise<void>,
  stopRequested: () => boolean,
): DevLoopOperations {
  let compilations = 0
  return {
    beforePhase: async (phase, shouldStop) => {
      await record({ event: 'phase', phase, scenario })
      if (phase === 'compile') {
        compilations++
      }
      if (
        (scenario === 'metro-failure' && phase === 'metro') || (scenario === 'dispatch-failure' && phase === 'dispatch')
      ) {
        Errors.throwHostEnvironment(`Intentionally injected ${scenario} at the real ${phase} operations boundary.`)
      }
      if (scenario === `pause-${phase}` || (scenario === 'pause-restart' && phase === 'compile' && compilations > 1)) {
        const stopped = await Time.pollUntil(() => shouldStop() || stopRequested() ? true : undefined, {
          intervalMs: 25,
          timeoutMs: 60_000,
        })
        if (stopped !== true) {
          Errors.throwHostEnvironment(`The proof-owned ${phase} pause did not receive bounded public cancellation.`)
        }
        await record({ event: 'pause-cancelled', phase })
      }
    },
    afterCleanup: async () => {
      await record({ event: 'services-closed', scenario })
      if (scenario === 'delayed-cleanup') {
        await Time.sleep(1_000)
        await record({ event: 'delayed-cleanup-completed' })
      }
      if (scenario === 'cleanup-failure') {
        Errors.throwHostEnvironment(
          'Intentionally injected cleanup-inspection failure after independent real service shutdown.',
        )
      }
    },
  }
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
    Errors.throwUserInput('The fixed finite fault child requires invocation UUID identities.')
  }
}

async function runChild(): Promise<void> {
  const [invocation, id, role, ...extra] = Platform.runtimeProcess.argv.slice(2)
  requireUuid(invocation ?? '')
  requireUuid(id ?? '')
  if (extra.length > 0 || (role !== 'controller' && role !== 'worker')) {
    Errors.throwUserInput('The fixed finite fault child accepts only controller or worker.')
  }
  const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`)
  const planRoot = FS.resolvePath(`faults/${id}`, root)
  if (
    await FS.fileMode(root) !== 0o700 || await FS.fileMode(planRoot) !== 0o700
    || await FS.fileMode(FS.resolvePath('plan.json', planRoot)) !== 0o600
  ) {
    Errors.throwHostEnvironment('The fixed finite fault plan must be private.')
  }
  const plan = await FS.readJson<Plan>(FS.resolvePath('plan.json', planRoot))
  if (
    plan.version !== 1 || plan.id !== id || plan.artifactRoot !== root
    || plan.checkout !== await FS.realPath(Repo.getRoot())
    || !scenarios.includes(plan.scenario)
    || mobileTarget(plan.scenario) !== undefined && (!Array.isArray(plan.baselineResources)
        || !plan.baselineResources.every(name => typeof name === 'string'))
    || !ProcessTree.sameProcess(ProcessTree.identities([plan.owner.pid]).get(plan.owner.pid), plan.owner)
    || await FS.filesIdentity([['Data MVP.tao', plan.fixture.appPath]]) !== plan.fixture.sourceIdentity
  ) {
    Errors.throwHostEnvironment('The finite fault plan no longer belongs to a live invocation/source identity.')
  }
  const receipt = await readDevLoopReceipt(plan.session)
  const directories = await FS.readJson<{ path: string; owner: string; state: string }[]>(
    FS.resolvePath('external-directories.json', root),
  )
  if (
    !directories.some(directory =>
      directory.path === plan.fixture.root && directory.owner === root && directory.state === 'active'
    )
  ) {
    Errors.throwHostEnvironment('The private helper requires a live invocation-created source projection ledger.')
  }
  if (receipt.selection?.projectRoot !== plan.fixture.root || receipt.selection.appPath !== plan.fixture.appPath) {
    Errors.throwHostEnvironment('The finite fault session does not belong to the invocation-owned source projection.')
  }
  if (plan.scenario.startsWith('combined-')) {
    requireUuid(plan.borrowedIos ?? '')
    await assertManagedLoopBorrowedIosAdmission({ artifactRoot: root, id: plan.borrowedIos!, owner: plan.owner })
    if (
      JSON.stringify(receipt.args)
        !== JSON.stringify(managedLoopFaultArgs(plan.fixture, plan.scenario, plan.borrowedIos))
    ) {
      Errors.throwHostEnvironment('Combined targets require the live invocation-created borrowed iOS sentinel.')
    }
  }
  const record = createManagedLoopFaultRecorder(planRoot, role)
  if (role === 'controller') {
    let inputSequences = 0
    const nativeStage = managedIosNativeStopStage(plan.scenario)
    const nativeStop = nativeStage && createManagedIosNativeStopEntry({
      invocation: invocation!,
      scope: plan.id,
      stage: nativeStage,
      receipt,
      eventRoot: planRoot,
      record,
    })
    const controller = await runDevLoopController(receipt, {
      onOwnershipCheckpoint: async checkpoint => {
        if (checkpoint.devices.some(device => device.platform === 'android' && device.owned)) {
          await record({ ...checkpoint, event: 'ownership-checkpoint', invocation, scope: plan.id })
        }
      },
      onStop: nativeStop ? nativeStop.onStop : undefined,
      runAppDev: createManagedLoopFaultWorker({
        invocation: invocation!,
        id: id!,
        session: plan.session,
        scenario: plan.scenario,
        eventRoot: planRoot,
        baselineResources: plan.baselineResources,
        borrowedIos: plan.borrowedIos,
        fixture: plan.fixture,
        record,
        loopGeneration: () => receipt.generation,
      }),
      mobileFixture: async options =>
        await runManagedMobileFixture({
          ...options,
          beforeFixtureAction: async (phase, grant) => {
            if (phase === 'input') {
              inputSequences++
            }
            await record({ event: 'mobile-action', phase, sequence: inputSequences, scenario: plan.scenario })
            if (inputSequences === 1 && phase === 'input' && plan.scenario.endsWith('-driver-failure')) {
              Errors.throwHostEnvironment(
                'Intentionally injected managed driver action failure after real session/identity attachment.',
              )
            }
            if (inputSequences === 1 && phase === 'input' && plan.scenario.endsWith('-delayed-action')) {
              const revoked = await Time.pollUntil(() => grant.signal.aborted ? true : undefined, {
                intervalMs: 25,
                timeoutMs: 60_000,
              })
              if (revoked !== true) {
                Errors.throwHostEnvironment(
                  'The proof-owned delayed driver action was not cancelled within its finite budget.',
                )
              }
              await record({ event: 'mobile-action-cancelled', scenario: plan.scenario })
              throw Errors.abortError('The proof-owned managed driver action was cancelled.')
            }
          },
          beforeDriverDeletion: async () => {
            if (inputSequences === 1 && plan.scenario.endsWith('-deletion-failure')) {
              await record({ event: 'mobile-delete-refused', scenario: plan.scenario })
              Errors.throwHostEnvironment('Intentionally injected managed driver remote deletion refusal.')
            }
          },
        }),
    })
    await controller.waitForDisposal()
    if (nativeStop) {
      await nativeStop.flush()
    }
    return
  }
  const credentials = Platform.runtimeProcess.env['TAO_DEV_LOOP_WORKER_CREDENTIALS']
  delete Platform.runtimeProcess.env['TAO_DEV_LOOP_WORKER_CREDENTIALS']
  if (credentials !== FS.resolvePath('active-control/credentials.json', devLoopDirectory(plan.session))) {
    Errors.throwHostEnvironment('The finite worker credential path is outside its invocation-owned session.')
  }
  const control = await connectDevLoopWorker(credentials)
  const observedControl = {
    ...control,
    bind: (actions: Parameters<typeof control.bind>[0]) =>
      control.bind({
        reload: async () => {
          await record({ event: 'action-start', action: 'reload', ...control.identity?.() })
          await actions.reload()
          await record({ event: 'action-end', action: 'reload', ...control.identity?.() })
        },
        restart: async () => {
          await record({ event: 'action-start', action: 'restart', ...control.identity?.() })
          await actions.restart()
          await record({ event: 'action-end', action: 'restart', ...control.identity?.() })
        },
        stop: async () => {
          await record({ event: 'action-start', action: 'stop', ...control.identity?.() })
          await actions.stop()
          await record({ event: 'action-end', action: 'stop', ...control.identity?.() })
        },
      }),
  }
  let lease: Awaited<ReturnType<typeof ProjectDevSession.acquire>> | undefined
  try {
    lease = await ProjectDevSession.acquire(plan.fixture.root, 'cli')
    await TaoAppModules.ensureProject(plan.fixture.root)
    let outcome
    const faultOperations = managedLoopFaultOperations(plan.scenario, record, () => control.stopRequested?.() === true)
    if (plan.scenario === 'ios-owned-stop-openurl') {
      faultOperations.targetOperations = {
        iosLaunch: {
          onCommand: async capture => {
            await observeManagedIosNativeOpenurl({
              capture,
              invocation: invocation!,
              scope: plan.id,
              session: plan.session,
              eventRoot: planRoot,
              generation: () => control.identity?.().generation,
              shouldStop: () => control.stopRequested?.() === true,
              asset: async () =>
                await FS.readJson<ManagedIosAsset>(FS.resolvePath(`ios-${plan.id}/asset.json`, planRoot)),
              receipt: async () => await readDevLoopReceipt(plan.session),
              record,
            })
          },
        },
      }
    }
    if (plan.scenario.startsWith('combined-')) {
      faultOperations.afterDispatch = async (targets, shouldStop) => {
        if (shouldStop()) {
          return
        }
        await record({ event: 'combined-dispatch', targets })
      }
      if (plan.scenario === 'combined-web-failure') {
        faultOperations.targetOperations = {
          startChrome: async () => {
            const current = await readDevLoopReceipt(plan.session)
            const ios = current.devices?.find(device => device.platform === 'ios')
            const android = current.devices?.find(device => device.platform === 'android')
            if (
              control.stopRequested?.() || current.generation !== receipt.generation
              || ios === undefined || ios.id !== plan.borrowedIos || ios.owned || ios.state !== 'booted'
              || android?.owned !== true || android.state !== 'booted'
              || !android.avdName?.startsWith(managedLoopAndroidPrefix(invocation!))
            ) {
              Errors.throwHostEnvironment('The combined Chrome refusal requires its live exact mobile reservations.')
            }
            await record({ event: 'combined-web-refused', devices: [ios, android] })
            Errors.throwHostEnvironment(
              'Intentionally injected combined Chrome refusal after real mobile reservation and Metro readiness.',
            )
          },
        }
      }
    }
    do {
      outcome = await runDevLoop(
        { ...receipt.selection!, appId: 'data-mvp' },
        lineDevLoopReporter(),
        plan.scenario.startsWith('combined-')
          ? ['web', 'ios', 'android']
          : plan.scenario === 'ios-owned-stop-openurl'
          ? ['ios']
          : plan.scenario === 'dispatch-failure'
          ? ['web']
          : [],
        undefined,
        observedControl,
        faultOperations,
      )
    } while (outcome.kind === 'restart' && !control.stopRequested?.())
    await record({ event: 'worker-outcome', outcome })
    if (outcome.kind === 'exit' && outcome.exitCode !== 0) {
      Platform.runtimeProcess.setExitCode(outcome.exitCode)
    }
  } finally {
    await lease?.release()
    await control.close()
  }
}

/** Auth probes stay inside the invocation, use canonical private connection validation and emit only statuses. */
async function probeManagedLoopFaultAuthentication(
  plan: Plan,
): Promise<{ missing: number; wrong: number; stale: string }> {
  const receipt = await readDevLoopReceipt(plan.session)
  if (
    receipt.state !== 'ready' || receipt.selection?.projectRoot !== plan.fixture.root
    || receipt.selection.appPath !== plan.fixture.appPath
    || !ProcessTree.sameProcess(ProcessTree.identities([plan.owner.pid]).get(plan.owner.pid), plan.owner)
  ) {
    Errors.throwHostEnvironment('Authentication probes require the current invocation-owned ready fault session.')
  }
  const connection = await readDevLoopConnection(plan.session)
  const missing = await fetch(`${connection.origin}/status`, {
    signal: Object.assign(AbortSignal.timeout(30_000), { onabort: () => {} }),
  })
  const wrong = await fetch(`${connection.origin}/status`, {
    headers: { authorization: 'Bearer deliberate-wrong-proof-capability' },
    signal: Object.assign(AbortSignal.timeout(30_000), { onabort: () => {} }),
  })
  await missing.text()
  await wrong.text()
  let stale = ''
  try {
    await devLoopRequest(connection, '/worker/event', {
      generation: Platform.randomUUID(),
      event: { type: 'ready', url: 'http://127.0.0.1:1', targets: [] },
    })
  } catch (error) {
    stale = Errors.formatForUser(error)
  }
  if (missing.status !== 401 || wrong.status !== 401 || stale !== 'Stale generation') {
    Errors.throwHostEnvironment('The proof-owned controller accepted a missing/wrong capability or stale worker event.')
  }
  return { missing: missing.status, wrong: wrong.status, stale }
}

if (import.meta.main) {
  await runChild().catch(error => {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.setExitCode(1)
  })
}
