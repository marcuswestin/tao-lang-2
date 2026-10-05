import { EXPO_SDK_VERSION } from '@expo-host/dev-loop/expo-runner/expo-config'
import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import type {
  AgentAppDevDevice,
  AgentAppDevReservation,
  ManagedChildCapture,
  ManagedCleanupChild,
} from '../simulators/AgentAppDev'
import type { DevLoopReceipt } from './DevLoopStore'
import {
  type ManagedIosCommandEvidence,
  type ManagedIosCommandIntent,
  type ManagedIosNativeExecution,
  runManagedIosCommandBarrier,
} from './ManagedIosCommandBarrier'

type PrivateIosCreate = { name: string; type: string; runtime: string }
export type PrivateIosSelection = {
  namePrefix: string
  /** Exact minted journal plus proved shutdown; never adopt a matching name. */
  reuse?: () => Promise<(PrivateIosCreate & { id: string }) | undefined>
  beforeCreate: (device: PrivateIosCreate) => Promise<void>
  afterCreate: (device: PrivateIosCreate & { id: string }) => Promise<void>
}
export type PrivateIosPreparation = {
  device: AgentAppDevDevice
  reservation: AgentAppDevReservation
  shouldStop: () => boolean
  onChild?: (child: CLI.StartedCommand, capture?: ManagedChildCapture) => Promise<void>
  onCleanupChild?: ManagedCleanupChild
}
type Artifact = {
  sdk: string
  publisher: 'installed Expo SDK metadata'
  url: string
  clientVersion: string
  appPath: string
  executable: string
  bundleId: string
  digest: string
}
type Action = {
  stage: string
  state: 'intent' | 'captured' | 'closed' | 'retained'
  child?: TrackedProcess
  group?: number
  processes?: TrackedProcess[]
  notStarted?: true
  capture?: {
    disposition:
      | 'stable'
      | 'root-absent-before-walk'
      | 'root-exited-known-walk'
      | 'root-replaced'
      | 'root-unreadable'
      | 'root-exited-unstable-walk'
      | 'descendant-replaced'
    rootBefore: TrackedProcess | null
    rootAfter: TrackedProcess | null
    rootPidAlive: boolean
    priorProcesses: TrackedProcess[]
    observedProcesses: TrackedProcess[]
  }
  captureInspectionFailure?: string
  generation?: string
  barrier?: ManagedIosCommandEvidence
}
export type ManagedIosAsset = {
  version: 2
  invocation: string
  scope: string
  root: string
  name: string
  holder: TrackedProcess
  state: 'intent' | 'minted' | 'prepared' | 'released' | 'retained' | 'deleted'
  type?: string
  runtime?: string
  id?: string
  bootstrap?: TrackedProcess
  creation?: MachineResourceOwner
  resources?: readonly MachineResourceOwner[]
  actions: Action[]
  artifact?: Artifact
  deletion?: MachineResourceOwner
}
export type ManagedIosRuntimeOperations = {
  run: typeof CLI.run
  start: typeof CLI.start
  tree: typeof ProcessTree
  resources: Pick<typeof MachineResources, 'acquire' | 'readOwner' | 'retain' | 'recoverRetained' | 'withCurrentOwners'>
  onSignal: typeof Platform.onProcessSignal
  processIsAlive: typeof Platform.processIsAlive
  save: (path: string, value: unknown) => Promise<void>
  budgetMs: number
  /** Private acceptance only: after native simctl kernel observation, never execution ACK. */
  onNativeExecution?: (
    execution: ManagedIosNativeExecution & {
      invocation: string
      scope: string
      holder: TrackedProcess
      bootstrap?: TrackedProcess
      owners: readonly MachineResourceOwner[]
    },
    child: CLI.StartedCommand,
  ) => Promise<void>
}
const live: ManagedIosRuntimeOperations = {
  run: CLI.run,
  start: CLI.start,
  tree: ProcessTree,
  resources: MachineResources,
  onSignal: Platform.onProcessSignal,
  processIsAlive: Platform.processIsAlive,
  save: async (path, value) => {
    const temporary = `${path}.${Platform.randomUUID()}.tmp`
    try {
      await FS.writeText(temporary, JSON.stringify(value))
      await FS.chmod(temporary, 0o600)
      await FS.move(temporary, path)
    } finally {
      if (await FS.exists(temporary)) {
        await FS.remove(temporary)
      }
    }
  },
  budgetMs: 300_000,
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
function fail(message: string): never {
  return Errors.throwHostEnvironment(message)
}
function uncertain(message: string, cause?: unknown): never {
  return Errors.throwHostEnvironment(message, { cause, details: { retainsTargetLease: true } })
}
function originalIosKernelClosed(
  expected: TrackedProcess,
  operations: Pick<ManagedIosRuntimeOperations, 'tree' | 'processIsAlive'>,
): boolean {
  try {
    const current = operations.tree.identities([expected.pid]).get(expected.pid)
    return current === undefined
      ? !operations.processIsAlive(expected.pid)
      : !operations.tree.sameProcess(current, expected)
  } catch (error) {
    uncertain('Private iOS kernel closure inspection failed; ownership remains retained.', error)
  }
}
function safeIosExecutableBasename(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && FS.basename(value) === value
    && !/[/\\\0]/u.test(value)
}
async function checkedIosExecutable(appPath: string, name: string): Promise<string> {
  if (!safeIosExecutableBasename(name)) {
    fail('Private iOS SDK executable is not a safe literal basename.')
  }
  const app = await FS.realPath(appPath)
  const executable = FS.resolvePath(name, app)
  if (
    !executable.startsWith(`${app}/`) || await FS.isSymbolicLink(executable)
    || await FS.realPath(executable) !== executable
  ) {
    fail('Private iOS SDK executable path escapes its bundle or is a symbolic link.')
  }
  return executable
}

/** Only a minted receipt and exact current fences authorize fixture runtime installation. */
export async function createManagedIosFixture(options: {
  invocation: string
  scope: string
  artifactRoot: string
  baselineResources: readonly string[]
  shouldStop: () => boolean
  /** Publish each fixed finite child through the existing managed ownership boundary. */
  onChild?: (child: CLI.StartedCommand, capture?: ManagedChildCapture) => Promise<void>
  onCleanupChild?: ManagedCleanupChild
  /** Borrowing producer already owns the single external CoreSimulator ledger record. */
  externalLedger?: boolean
}, overrides: Partial<ManagedIosRuntimeOperations> = {}) {
  if (!uuid.test(options.invocation) || !uuid.test(options.scope)) {
    fail('Private iOS fixtures require minted UUIDs.')
  }
  const operations = { ...live, ...overrides }
  const root = FS.resolvePath(`ios-${options.scope}`, options.artifactRoot)
  const namePrefix = `Tao Managed ${options.invocation}_${options.scope}_`
  const name = `${namePrefix}1`
  const path = FS.resolvePath('asset.json', root)
  const baseline = new Set(options.baselineResources)
  const holder = operations.tree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
  if (holder === undefined) {
    fail('Private iOS fixture lacks its invocation kernel holder.')
  }
  await FS.mkdir(root)
  await FS.chmod(root, 0o700)
  const asset: ManagedIosAsset = {
    version: 2,
    invocation: options.invocation,
    scope: options.scope,
    root,
    name,
    holder,
    state: 'intent',
    actions: [],
  }
  const save = () => operations.save(path, asset)
  let publishChild = options.onChild
  let publishCleanupChild = options.onCleanupChild
  const assertHolder = () => {
    if (!operations.tree.sameProcess(operations.tree.identities([holder.pid]).get(holder.pid), holder)) {
      uncertain('Private iOS fixture holder lost its kernel identity.')
    }
  }
  const list = async () => {
    assertHolder()
    const result = await operations.run('xcrun', {
      args: ['simctl', 'list', 'devices', '--json', 'available'],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    assertHolder()
    if (result.exitCode !== 0 || result.error !== undefined) {
      fail('Private iOS fixture discovery failed.')
    }
    const parsed = JSON.parse(result.stdout) as {
      devices?: Record<string, { udid: string; name: string; state: string; deviceTypeIdentifier?: string }[]>
    }
    return Object.entries(parsed.devices ?? {}).flatMap(([runtime, devices]) =>
      devices.map(device => ({ ...device, runtime }))
    )
  }
  const originalDevices = await list()
  const baselineIds = new Set(originalDevices.map(device => device.udid))
  let reusable = false
  if (await FS.exists(path)) {
    const previous = JSON.parse(await FS.readText(path)) as ManagedIosAsset
    if (
      previous.version !== 2 || previous.invocation !== options.invocation || previous.scope !== options.scope
      || previous.root !== root || previous.name !== name || previous.state !== 'released'
      || !previous.id || !uuid.test(previous.id) || !operations.tree.sameProcess(previous.holder, holder)
      || !previous.creation || !previous.actions.every(action =>
        action.state === 'closed'
        && (action.notStarted || action.barrier?.drainProved === true
            && action.group !== undefined
            && !operations.tree.isGroupAlive(action.group)
            && !(action.processes ?? []).some(process =>
              operations.tree.sameProcess(operations.tree.identities([process.pid]).get(process.pid), process)
            ))
      )
      || previous.bootstrap !== undefined && !originalIosKernelClosed(previous.bootstrap, operations)
      || baseline.has(`ios-simulator:${previous.id}`)
      || await operations.resources.readOwner({ name: `ios-simulator:${previous.id}` }) !== undefined
    ) {
      uncertain('Private iOS restart refuses an unproved or foreign minted journal.')
    }
    const created = originalDevices.find(device => device.udid === previous.id)
    if (
      !created || created.state !== 'Shutdown' || created.name !== name || created.runtime !== previous.runtime
      || created.deviceTypeIdentifier !== previous.type
    ) {
      uncertain('Private iOS restart lacks exact minted shutdown target proof.')
    }
    Object.assign(asset, previous)
    baselineIds.delete(previous.id)
    reusable = true
  }
  const assertMinted = async (booted = false) => {
    assertHolder()
    if (asset.id === undefined || asset.state === 'intent' || asset.state === 'deleted') {
      uncertain('Private iOS target has no durably minted UDID; a name alone cannot authorize control.')
    }
    const saved = JSON.parse(await FS.readText(path)) as ManagedIosAsset
    if (
      saved.id !== asset.id || saved.name !== name || saved.scope !== options.scope
      || saved.invocation !== options.invocation || !operations.tree.sameProcess(saved.holder, holder)
    ) {
      uncertain('Private iOS target minted ledger no longer matches this invocation.')
    }
    const device = (await list()).find(device => device.udid === asset.id)
    if (
      !device || device.name !== name || device.runtime !== asset.runtime || device.deviceTypeIdentifier !== asset.type
      || baselineIds.has(device.udid) || booted && device.state !== 'Booted'
    ) {
      uncertain('Private iOS target provenance or booted state changed.')
    }
    if (
      booted && asset.bootstrap !== undefined
      && !operations.tree.sameProcess(
        operations.tree.identities([asset.bootstrap.pid]).get(asset.bootstrap.pid),
        asset.bootstrap,
      )
    ) {
      uncertain('Private iOS target bootstrap kernel identity changed.')
    }
  }
  const assertOwners = async (owners: readonly MachineResourceOwner[]) => {
    assertHolder()
    for (const expected of owners) {
      if (baseline.has(expected.name)) {
        fail('Private iOS target refuses a preserved baseline resource.')
      }
      const current = await operations.resources.readOwner({ name: expected.name })
      if (
        !current || current.id !== expected.id || current.pid !== expected.pid
        || current.processStartedAt !== expected.processStartedAt || current.repositoryRoot !== expected.repositoryRoot
      ) {
        uncertain('Private iOS target reservation generation changed.')
      }
    }
    assertHolder()
  }
  const finite = async (
    stage: string,
    command: string,
    spec: CLI.CommandSpec,
    owners: readonly MachineResourceOwner[],
    shouldStop = options.shouldStop,
    requireBootstrap = false,
  ): Promise<CLI.CommandResult> => {
    {
      if (
        stage === 'download' && (
          command !== Platform.runtimeProcess.execPath || spec.args?.length !== 3
          || spec.args[0]
            !== Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime.ts')
          || spec.args[1] !== 'download' || spec.args[2] !== FS.resolvePath('download-plan.json', root)
          || spec.env?.['TAO_DEV_LOOP_WORKER_CREDENTIALS'] !== ''
          || spec.env?.['TMPDIR'] !== `${FS.resolvePath('tmp', root)}/`
          || spec.env?.['__UNSAFE_EXPO_HOME_DIRECTORY'] !== FS.resolvePath('expo-home', root)
        )
      ) {
        uncertain('Private iOS fixed downloader refuses an unreviewed command class.')
      }
      if (stage !== 'download' && (command !== 'xcrun' || spec.args?.[0] !== 'simctl' || spec.args[1] !== stage)) {
        uncertain('Private iOS fixed native barrier refuses an unreviewed command class.')
      }
      const args = spec.args!
      const intent: ManagedIosCommandIntent = stage === 'download'
        ? { stage: 'download' }
        : stage === 'create'
        ? { stage, name: args[2]!, type: args[3]!, runtime: args[4]! }
        : stage === 'install'
        ? { stage, id: args[2]!, appPath: args[3]! }
        : ['boot', 'bootstatus', 'shutdown', 'delete'].includes(stage)
        ? { stage: stage as 'boot' | 'bootstatus' | 'shutdown' | 'delete', id: args[2]! }
        : uncertain('Private iOS native operation has no reviewed fixed barrier contract.')
      if (
        (stage === 'create' && (args.length !== 5 || intent.stage !== 'create'
          || intent.name !== asset.name || intent.type !== asset.type || intent.runtime !== asset.runtime))
        || (stage !== 'create' && stage !== 'download'
          && (intent.stage === 'create' || intent.stage === 'download' || intent.id !== asset.id
            || args.length !== (stage === 'install' || stage === 'bootstatus' ? 4 : 3)))
        || (intent.stage === 'install' && intent.appPath !== asset.artifact?.appPath)
        || (stage === 'bootstatus' && args[3] !== '-b')
      ) {
        uncertain('Private iOS native barrier intent does not match its exact minted asset and command shape.')
      }
      const action: Action = { stage, state: 'intent', generation: Platform.randomUUID() }
      asset.actions.push(action)
      let cancelled = false
      const signals = (['SIGTERM', 'SIGINT', 'SIGHUP'] as const).map(signal =>
        operations.onSignal(signal, () => {
          cancelled = true
        })
      )
      try {
        await save()
        await assertOwners(owners)
        const result = await runManagedIosCommandBarrier({
          plan: {
            version: 1,
            generation: action.generation!,
            invocation: options.invocation,
            scope: options.scope,
            root,
            budgetMs: operations.budgetMs,
            intent,
          },
          start: operations.start,
          tree: operations.tree,
          processIsAlive: operations.processIsAlive,
          save: operations.save,
          shouldStop: () => shouldStop() || cancelled,
          onChild: stage === 'shutdown' && publishCleanupChild !== undefined
            ? async (child, capture) => {
              if (capture === undefined || asset.id === undefined) {
                uncertain('Private iOS shutdown lacks its exact child capture and minted target.')
              }
              const resources = Object.freeze(structuredClone(owners).map(owner => Object.freeze(owner)))
              await publishCleanupChild!(
                child,
                capture,
                Object.freeze({
                  platform: 'ios',
                  id: asset.id,
                  resources,
                  assertCurrent: () => assertOwners(resources),
                }),
              )
            }
            : publishChild,
          onNativeExecution: operations.onNativeExecution === undefined ? undefined : async (execution, child) => {
            assertHolder()
            await assertOwners(owners)
            if (
              execution.id !== asset.id || execution.generation !== action.generation
              || asset.actions.at(-1) !== action || shouldStop() || cancelled
            ) {
              uncertain('Private iOS native execution observation lost its minted target/action generation.')
            }
            await operations.onNativeExecution?.({
              ...execution,
              invocation: asset.invocation,
              scope: asset.scope,
              holder,
              bootstrap: asset.bootstrap,
              owners: structuredClone(owners),
            }, child)
          },
          publish: async evidence => {
            action.child = evidence.supervisor
            action.group = evidence.group
            action.processes = evidence.processes
            action.barrier = evidence
            action.state = 'captured'
            await save()
          },
          admit: async release => {
            const saved = await FS.readJson<ManagedIosAsset>(path)
            if (
              saved.version !== 2 || saved.invocation !== asset.invocation || saved.scope !== asset.scope
              || saved.actions.at(-1)?.generation !== action.generation
              || saved.actions.at(-1)?.barrier?.generation !== action.generation
            ) {
              uncertain('Private iOS barrier durable action generation changed before execution.')
            }
            await operations.resources.withCurrentOwners({ owners }, () => {
              assertHolder()
              if (
                shouldStop() || cancelled || asset.actions.at(-1) !== action
                || action.barrier?.generation !== action.generation
              ) {
                uncertain('Private iOS barrier action or cancellation changed at physical admission.')
              }
              if (
                (stage === 'download' || stage === 'install' || requireBootstrap) && (!asset.bootstrap
                  || !operations.tree.sameProcess(
                    operations.tree.identities([asset.bootstrap.pid]).get(asset.bootstrap.pid),
                    asset.bootstrap,
                  ))
              ) {
                uncertain('Private iOS bootstrap changed before barrier physical admission.')
              }
              release()
            })
          },
        })
        action.state = 'closed'
        await operations.save(FS.resolvePath(`${stage}-output.json`, root), {
          stdout: result.stdout,
          stderr: result.stderr,
        })
        await save()
        if (result.exitCode !== 0 || result.signal !== null) {
          fail(`Private iOS ${stage} command failed after proven process drain; its owned output remains in ${root}.`)
        }
        await assertOwners(owners)
        return result
      } catch (error) {
        if (action.barrier?.drainProved !== true || action.state !== 'closed') {
          action.captureInspectionFailure ??= Errors.formatForUser(error)
          action.state = 'retained'
          asset.state = 'retained'
          await save().catch(() => {})
          uncertain(`Private iOS native barrier retained: ${Errors.formatForUser(error)}`, error)
        }
        throw error
      } finally {
        signals.forEach(remove => remove())
      }
    }
  }
  const selection: PrivateIosSelection = {
    namePrefix,
    reuse: async () => {
      if (!reusable) {
        return undefined
      }
      await assertMinted()
      await assertOwners([asset.creation!])
      if (
        !(await list()).some(device => device.udid === asset.id && device.state === 'Shutdown')
        || await operations.resources.readOwner({ name: `ios-simulator:${asset.id}` }) !== undefined
      ) {
        uncertain('Private iOS restart lost exclusive minted shutdown admission.')
      }
      asset.state = 'minted'
      asset.resources = undefined
      asset.bootstrap = undefined
      await save()
      reusable = false
      return { name, type: asset.type!, runtime: asset.runtime!, id: asset.id! }
    },
    beforeCreate: async device => {
      if (
        device.name !== name || (await list()).some(peer => peer.name.startsWith(namePrefix))
        || baseline.has(`ios-create:${namePrefix}`) || baseline.has(`tao-agent-simulator-pool:${namePrefix}`)
      ) {
        fail('Private iOS creation refuses a preexisting name; name alone cannot establish ownership.')
      }
      asset.type = device.type
      asset.runtime = device.runtime
      const lease = await operations.resources.acquire({
        name: `ios-create:${namePrefix}`,
        command: 'private iOS creation intent',
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
      try {
        asset.creation = await operations.resources.retain({
          owners: [lease.owner],
          processes: [],
          quarantined: true,
          reason: `Private simulator creation has an unknown UDID/child until publication; see ${root}.`,
        })
        await save()
      } catch (error) {
        if (asset.creation === undefined) {
          await lease.release().catch(() => {})
        }
        throw error
      }
    },
    afterCreate: async device => {
      if (
        !uuid.test(device.id) || baselineIds.has(device.id) || baseline.has(`ios-simulator:${device.id}`)
        || device.name !== name || asset.type !== device.type || asset.runtime !== device.runtime
      ) {
        uncertain('Private iOS creation did not return a fresh invocation-owned UDID.')
      }
      asset.id = device.id
      asset.state = 'minted'
      try {
        await save()
      } catch {
        uncertain('Private iOS created UDID publication failed; creation remains quarantined.')
      }
      await assertMinted()
      if (options.externalLedger !== false) {
        await operations.save(FS.resolvePath('external.json', root), [{
          path: FS.resolvePath(`Library/Developer/CoreSimulator/Devices/${asset.id}`, FS.homeDir()),
          owner: root,
          purpose: 'invocation-owned private iOS fixture',
          state: 'active',
          cleanupCondition: 'Remove only after exact loop/command/target shutdown and fresh exclusive deletion proof.',
        }])
      }
    },
  }
  const observeDevice = async (device: AgentAppDevDevice) => {
    if (device.platform !== 'ios') {
      return
    }
    if (device.id === asset.id && device.state === 'released') {
      asset.state = 'released'
      await save()
      return
    }
    if (
      device.id !== asset.id || !device.owned || !device.resources?.length || device.holder === undefined
      || !operations.tree.sameProcess(device.holder, holder)
    ) {
      uncertain('Private iOS reservation publication does not match its minted target/holder.')
    }
    asset.resources = structuredClone(device.resources)
    await save()
  }
  const run: typeof CLI.run = async (command, spec = {}) => {
    const args = [...spec.args ?? []]
    if (
      command !== 'xcrun' || args[0] !== 'simctl'
      || !['create', 'boot', 'bootstatus', 'shutdown', 'delete'].includes(args[1] ?? '')
    ) {
      assertHolder()
      const result = await operations.run(command, spec)
      assertHolder()
      return result
    }
    if (args[1] === 'create') {
      if (
        JSON.stringify(args) !== JSON.stringify(['simctl', 'create', name, asset.type, asset.runtime])
        || !asset.creation
      ) {
        uncertain('Private iOS creation command is outside its durable exact intent.')
      }
      return await finite('create', command, spec, [asset.creation])
    }
    await assertMinted()
    if (
      args.length !== (args[1] === 'bootstatus' ? 4 : 3) || (args[1] === 'bootstatus' && args[3] !== '-b')
      || args[2] !== asset.id || !asset.resources?.length
    ) {
      uncertain('Private iOS mutation refuses an unminted or foreign target.')
    }
    const requireBootstrap = args[1] === 'shutdown'
    if (
      args[1] === 'shutdown' && (await list()).some(device => device.udid === asset.id && device.state === 'Booted')
    ) {
      const probe = await operations.run('xcrun', {
        args: ['simctl', 'spawn', asset.id!, 'launchctl', 'managerpid'],
        processPolicy: 'test',
        timeoutMs: 30_000,
      })
      const current = operations.tree.identities([Number(probe.stdout.trim())]).get(Number(probe.stdout.trim()))
      if (
        probe.exitCode !== 0 || probe.error || !asset.bootstrap
        || !operations.tree.sameProcess(current, asset.bootstrap)
      ) {
        uncertain('Private iOS shutdown refuses a replacement bootstrap kernel identity.')
      }
    }
    if (args[1] === 'delete' && !asset.creation) {
      uncertain('Private iOS deletion lacks its captured creation fence.')
    }
    const owners = args[1] === 'delete' ? [...asset.resources, asset.creation!] : asset.resources
    const result = await finite(
      args[1]!,
      command,
      spec,
      owners,
      args[1] === 'boot' || args[1] === 'bootstatus' ? options.shouldStop : () => false,
      requireBootstrap,
    )
    if (args[1] === 'boot') {
      asset.bootstrap = await Time.pollUntil(async () => {
        await assertOwners(asset.resources!)
        const probe = await operations.run('xcrun', {
          args: ['simctl', 'spawn', asset.id!, 'launchctl', 'managerpid'],
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
        await assertOwners(asset.resources!)
        const identity = operations.tree.identities([Number(probe.stdout.trim())]).get(Number(probe.stdout.trim()))
        return probe.exitCode === 0 && !probe.error && identity !== undefined && /launchd_sim/iu.test(identity.command)
          ? identity
          : undefined
      }, { intervalMs: 100, timeoutMs: Math.min(60_000, operations.budgetMs) })
      if (!asset.bootstrap) {
        uncertain('Private iOS boot has unknown bootstrap ownership; target fences remain retained.')
      }
      await save()
    }
    if (args[1] === 'shutdown' && asset.bootstrap !== undefined) {
      try {
        if (
          !await Time.pollUntil(() => originalIosKernelClosed(asset.bootstrap!, operations) ? true : undefined, {
            intervalMs: 100,
            timeoutMs: Math.min(10_000, operations.budgetMs),
          })
        ) {
          uncertain('Private iOS shutdown has an unresolved bootstrap kernel process; target fences remain retained.')
        }
      } catch (error) {
        asset.state = 'retained'
        await save().catch(() => {})
        throw error
      }
    }
    return result
  }
  const prepare = async ({ device, reservation, shouldStop, onChild, onCleanupChild }: PrivateIosPreparation) => {
    publishChild = onChild ?? publishChild
    publishCleanupChild = onCleanupChild ?? publishCleanupChild
    await observeDevice(device)
    await reservation.assertCurrent()
    const capturedBootstrap = asset.bootstrap
    const observedBootstrap = await Time.pollUntil(async () => {
      if (shouldStop()) {
        throw Errors.abortError('Private iOS preparation cancelled before bootstrap readiness.')
      }
      await assertMinted()
      await reservation.assertCurrent()
      if (!(await list()).some(device => device.udid === asset.id && device.state === 'Booted')) {
        return undefined
      }
      const bootstrap = await operations.run('xcrun', {
        args: ['simctl', 'spawn', asset.id!, 'launchctl', 'managerpid'],
        processPolicy: 'test',
        timeoutMs: 30_000,
      })
      assertHolder()
      const pid = Number(bootstrap.stdout.trim())
      const observed = bootstrap.exitCode === 0 && bootstrap.error === undefined
        ? operations.tree.identities([pid]).get(pid)
        : undefined
      if (capturedBootstrap !== undefined && !operations.tree.sameProcess(observed, capturedBootstrap)) {
        uncertain('Private iOS preparation refuses a replacement bootstrap kernel identity.')
      }
      return observed
    }, { intervalMs: 100, timeoutMs: 60_000 })
    if (!observedBootstrap || !/launchd_sim/iu.test(observedBootstrap.command)) {
      uncertain('Private iOS bootstrap kernel identity is unavailable.')
    }
    asset.bootstrap = capturedBootstrap ?? observedBootstrap
    await save()
    await FS.mkdir(FS.resolvePath('tmp', root))
    await FS.mkdir(FS.resolvePath('expo-home', root))
    await operations.save(FS.resolvePath('download-plan.json', root), {
      root,
      invocation: options.invocation,
      scope: options.scope,
      sdk: EXPO_SDK_VERSION,
    })
    const downloaded = await finite(
      'download',
      Platform.runtimeProcess.execPath,
      {
        args: [
          Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime.ts'),
          'download',
          FS.resolvePath('download-plan.json', root),
        ],
        env: {
          ...Platform.runtimeProcess.env,
          TAO_DEV_LOOP_WORKER_CREDENTIALS: '',
          __UNSAFE_EXPO_HOME_DIRECTORY: FS.resolvePath('expo-home', root),
          TMPDIR: `${FS.resolvePath('tmp', root)}/`,
        },
      },
      reservation.resources,
      shouldStop,
    )
    await reservation.assertCurrent()
    await assertMinted(true)
    const artifact = JSON.parse(await FS.readText(FS.resolvePath('download.json', root))) as Artifact
    const publication = downloaded.stdout.split(/\r?\n/u).filter(line => line.startsWith('TAO_PRIVATE_IOS_ARTIFACT '))
    if (
      publication.length !== 1 || publication[0]!.slice('TAO_PRIVATE_IOS_ARTIFACT '.length) !== JSON.stringify(artifact)
    ) {
      fail('Private iOS SDK artifact no longer matches its captured fixed downloader publication.')
    }
    const url = new URL(artifact.url)
    const expectedHome = `${await FS.realPath(FS.resolvePath('expo-home', root))}/`
    const app = await FS.realPath(artifact.appPath)
    if (
      artifact.sdk !== EXPO_SDK_VERSION || artifact.publisher !== 'installed Expo SDK metadata'
      || artifact.bundleId !== 'host.exp.Exponent' || !artifact.clientVersion || url.protocol !== 'https:'
      || url.username || url.password || !app.startsWith(expectedHome)
      || !safeIosExecutableBasename(artifact.executable)
    ) {
      fail('Private iOS SDK artifact does not match its fixed publisher/SDK/bundle provenance.')
    }
    if (
      Platform.sha256Hex(await FS.readFile(await checkedIosExecutable(app, artifact.executable))) !== artifact.digest
    ) {
      fail('Private iOS SDK artifact changed after verified download.')
    }
    for (
      const [field, expected] of [['CFBundleIdentifier', artifact.bundleId], [
        'CFBundleShortVersionString',
        artifact.clientVersion,
      ]]
    ) {
      const read = await operations.run('plutil', {
        args: ['-extract', field!, 'raw', FS.resolvePath('Info.plist', app)],
        processPolicy: 'test',
        timeoutMs: 30_000,
      })
      if (read.error || read.exitCode !== 0 || read.stdout.trim() !== expected) {
        fail('Private iOS artifact bundle metadata changed after download.')
      }
    }
    asset.artifact = artifact
    await save()
    await assertMinted(true)
    await reservation.assertCurrent()
    await finite('install', 'xcrun', { args: ['simctl', 'install', asset.id!, app] }, reservation.resources, shouldStop)
    await assertMinted(true)
    await reservation.assertCurrent()
    if (shouldStop()) {
      throw Errors.abortError('Private iOS preparation cancelled after install.')
    }
    const installed = await operations.run('xcrun', {
      args: ['simctl', 'get_app_container', asset.id!, 'host.exp.Exponent', 'app'],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    if (installed.exitCode !== 0 || installed.error || !installed.stdout.trim()) {
      fail('Private iOS runtime installation was not observed.')
    }
    const version = await operations.run('plutil', {
      args: ['-extract', 'CFBundleShortVersionString', 'raw', FS.resolvePath('Info.plist', installed.stdout.trim())],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    if (version.exitCode !== 0 || version.error || version.stdout.trim() !== artifact.clientVersion) {
      fail('Private iOS installed runtime does not match the requested SDK metadata client version.')
    }
    await assertMinted(true)
    await reservation.assertCurrent()
    asset.state = 'prepared'
    await save()
  }
  const allowResource = (name: string) => {
    if (
      baseline.has(name)
      || !(name === `tao-agent-simulator-pool:${namePrefix}`
        || asset.id !== undefined && name === `ios-simulator:${asset.id}`)
    ) {
      fail('Private iOS fixture refuses a baseline, foreign or unminted resource before acquisition.')
    }
  }
  const finishProducerDeletion = async (resources: readonly MachineResourceOwner[]) => {
    await assertOwners(resources)
    if (
      asset.id === undefined || (await list()).some(device => device.udid === asset.id)
      || asset.bootstrap !== undefined && !originalIosKernelClosed(asset.bootstrap, operations)
      || asset.actions.some(action =>
        action.state !== 'closed'
        || !action.notStarted && (action.barrier?.drainProved !== true
            || action.group === undefined || operations.tree.isGroupAlive(action.group))
      )
    ) {
      uncertain('Private iOS producer deletion lacks target/command/kernel closure proof.')
    }
    await assertOwners(resources)
    if (asset.creation) {
      await operations.resources.recoverRetained({
        name: asset.creation.name,
        generation: asset.creation.id,
        shutdown: async () => true,
      })
    }
    asset.state = 'deleted'
    await save()
    if (options.externalLedger !== false) {
      await operations.save(FS.resolvePath('external.json', root), [])
    }
  }
  return {
    selection,
    run,
    observeDevice,
    prepare,
    asset,
    root,
    assertMinted,
    assertOwners,
    finite,
    save,
    allowResource,
    finishProducerDeletion,
  }
}

/** A stopped controller releases service fences; its private CoreSimulator asset needs separate proof. */
export async function cleanupManagedIosFixtureAssets(options: {
  root: string
  receipt: DevLoopReceipt
  baselineResources: readonly string[]
}, overrides: Partial<ManagedIosRuntimeOperations> = {}): Promise<void> {
  const operations = { ...live, ...overrides }
  const path = FS.resolvePath('asset.json', options.root)
  if (!await FS.isFile(path)) {
    return
  }
  const asset = JSON.parse(await FS.readText(path)) as ManagedIosAsset
  const expectedName = `Tao Managed ${asset.invocation}_${asset.scope}_1`
  if (asset.state === 'deleted') {
    return
  }
  if (
    asset.version !== 2 || !uuid.test(asset.invocation) || !uuid.test(asset.scope) || !uuid.test(asset.id ?? '')
    || FS.basename(options.root) !== `ios-${asset.scope}`
    || asset.root !== options.root || asset.name !== expectedName || asset.state !== 'released'
    || options.receipt.state !== 'stopped' || options.receipt.cleanupOutcome !== 'proved'
    || !options.receipt.devices?.some(device =>
      device.platform === 'ios' && device.id === asset.id && device.owned && device.state === 'released'
    )
    || !operations.tree.sameProcess(options.receipt.controller, asset.holder)
    || operations.tree.sameProcess(operations.tree.identities([asset.holder.pid]).get(asset.holder.pid), asset.holder)
    || options.baselineResources.includes(`ios-simulator:${asset.id}`)
    || asset.actions.some(action =>
      action.state !== 'closed'
      || !action.notStarted
        && (action.barrier?.drainProved !== true || action.group === undefined
          || operations.tree.isGroupAlive(action.group)
          || action.processes?.some(process =>
            operations.tree.sameProcess(operations.tree.identities([process.pid]).get(process.pid), process)
          ))
    )
  ) {
    uncertain('Private iOS asset cleanup lacks exact stopped controller/command/minted-target proof.')
  }
  if (
    !asset.creation || asset.creation.name !== `ios-create:Tao Managed ${asset.invocation}_${asset.scope}_`
    || asset.creation.pid !== asset.holder.pid
    || asset.creation.processStartedAt !== undefined && asset.creation.processStartedAt !== asset.holder.startedAt
    || asset.creation.repositoryRoot !== options.receipt.checkout
    || options.baselineResources.includes(asset.creation.name)
  ) {
    uncertain('Private iOS creation fence no longer belongs to the exact captured controller.')
  }
  const creation = await operations.resources.readOwner({ name: asset.creation.name })
  if (
    !creation || creation.id !== asset.creation.id || creation.pid !== asset.creation.pid
    || creation.processStartedAt !== asset.creation.processStartedAt
    || creation.repositoryRoot !== asset.creation.repositoryRoot
  ) {
    uncertain('Private iOS creation generation changed before asset cleanup.')
  }
  if (
    asset.bootstrap !== undefined && !originalIosKernelClosed(asset.bootstrap, operations)
  ) {
    uncertain('Private iOS asset remains live after controller cleanup.')
  }
  const list = async () => {
    const result = await operations.run('xcrun', {
      args: ['simctl', 'list', 'devices', '--json', 'available'],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    if (result.exitCode !== 0 || result.error) {
      fail('Private iOS deletion discovery failed.')
    }
    const parsed = JSON.parse(result.stdout) as {
      devices?: Record<string, { udid: string; name: string; state: string }[]>
    }
    return Object.values(parsed.devices ?? {}).flat()
  }
  const device = (await list()).find(device => device.udid === asset.id)
  if (!device || device.name !== expectedName || device.state !== 'Shutdown') {
    uncertain('Private iOS deletion target is not the exact shutdown minted asset.')
  }
  if (await operations.resources.readOwner({ name: `ios-simulator:${asset.id}` })) {
    uncertain('Private iOS deletion refuses an occupied device fence.')
  }
  const lease = await operations.resources.acquire({
    name: `ios-simulator:${asset.id}`,
    command: 'private iOS asset deletion',
    repositoryRoot: Repo.getRoot(),
    waitTimeoutMs: 0,
  })
  asset.deletion = await operations.resources.retain({
    owners: [lease.owner],
    processes: [],
    quarantined: true,
    reason: `Private iOS deletion intent has an unknown child until publication; see ${asset.root}.`,
  })
  const action: Action = { stage: 'delete', state: 'intent', generation: Platform.randomUUID() }
  asset.actions.push(action)
  const save = () => operations.save(path, asset)
  await save()
  const holder = operations.tree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
  let failure: unknown
  try {
    const result = await runManagedIosCommandBarrier({
      plan: {
        version: 1,
        generation: action.generation!,
        invocation: asset.invocation,
        scope: asset.scope,
        root: asset.root,
        budgetMs: Math.min(30_000, operations.budgetMs),
        intent: { stage: 'delete', id: asset.id! },
      },
      start: operations.start,
      tree: operations.tree,
      processIsAlive: operations.processIsAlive,
      save: operations.save,
      shouldStop: () => false,
      publish: async evidence => {
        action.child = evidence.supervisor
        action.group = evidence.group
        action.processes = evidence.processes
        action.barrier = evidence
        action.state = 'captured'
        await save()
      },
      admit: async release => {
        const saved = await FS.readJson<ManagedIosAsset>(path)
        if (
          saved.version !== 2 || saved.invocation !== asset.invocation || saved.scope !== asset.scope
          || saved.actions.at(-1)?.generation !== action.generation
          || saved.actions.at(-1)?.barrier?.generation !== action.generation
        ) {
          uncertain('Private iOS collector durable command generation changed.')
        }
        await operations.resources.withCurrentOwners({ owners: [asset.deletion!, asset.creation!] }, () => {
          if (
            !holder || !operations.tree.sameProcess(operations.tree.identities([holder.pid]).get(holder.pid), holder)
            || action.barrier?.generation !== action.generation || asset.actions.at(-1) !== action
          ) {
            uncertain('Private iOS deletion collector lost its exact holder or action generation.')
          }
          release()
        })
      },
    })
    if (result.exitCode !== 0 || result.signal !== null) {
      uncertain('Private iOS native deletion failed after proven command drain; target remains retained.')
    }
    if ((await list()).some(device => device.udid === asset.id)) {
      uncertain('Private iOS deletion did not remove its exact asset.')
    }
    action.state = 'closed'
    await save()
  } catch (error) {
    failure = error
  }
  if (failure !== undefined) {
    asset.state = 'retained'
    action.state = 'retained'
    await save().catch(() => {})
    uncertain(`Private iOS deletion retained: ${Errors.formatForUser(failure)}`)
  }
  await operations.resources.recoverRetained({
    name: asset.deletion.name,
    generation: asset.deletion.id,
    shutdown: async () => true,
  })
  if (asset.creation) {
    await operations.resources.recoverRetained({
      name: asset.creation.name,
      generation: asset.creation.id,
      shutdown: async () => true,
    })
  }
  await lease.release()
  asset.state = 'deleted'
  await save()
  await operations.save(FS.resolvePath('external.json', asset.root), [])
}

/** Fixed child entry: resolves the installed toolchain, never caller-provided URLs or SDKs. */
type InstalledIosSdkDownloader = {
  getExpoGoVersionEntryAsync: (sdk: string) => Promise<{ iosClientUrl: string; iosClientVersion: string }>
  downloadExpoGoAsync: (platform: 'ios', options: { sdkVersion: string; url: string }) => Promise<string>
}
type IosSdkLoaderOperations = {
  resolvePackageDirectory: typeof FS.resolvePackageDirectory
  importDownloader: (url: string) => Promise<InstalledIosSdkDownloader>
}
async function loadInstalledIosSdkDownloader(operations: IosSdkLoaderOperations): Promise<InstalledIosSdkDownloader> {
  const expo = await operations.resolvePackageDirectory('expo', Repo.resolvePath('packages/apps/expo-host'))
  if (expo === undefined) {
    fail('Private iOS SDK downloader requires the installed Expo toolchain.')
  }
  const cli = await operations.resolvePackageDirectory('@expo/cli', expo)
  if (cli === undefined) {
    fail('Private iOS SDK downloader requires the CLI installed under its Expo toolchain.')
  }
  return await operations.importDownloader(FS.fileUrl(FS.resolvePath('build/src/utils/downloadExpoGoAsync.js', cli)))
}
/** Exercise the fixed installed-toolchain loader without downloading or installing a runtime. */
export async function loadManagedIosSdkDownloaderForSourceRegression(
  operations: IosSdkLoaderOperations,
): Promise<InstalledIosSdkDownloader> {
  return await loadInstalledIosSdkDownloader(operations)
}

async function download(planPath: string): Promise<void> {
  const plan = JSON.parse(await FS.readText(planPath)) as {
    root: string
    invocation: string
    scope: string
    sdk: string
  }
  if (
    !uuid.test(plan.invocation) || !uuid.test(plan.scope) || plan.sdk !== EXPO_SDK_VERSION
    || planPath !== FS.resolvePath('download-plan.json', plan.root)
    || !plan.root.startsWith(`${Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${plan.invocation}`)}/`)
    || FS.basename(plan.root) !== `ios-${plan.scope}`
    || Platform.runtimeProcess.env['__UNSAFE_EXPO_HOME_DIRECTORY'] !== FS.resolvePath('expo-home', plan.root)
    || Platform.runtimeProcess.env['TMPDIR'] !== `${FS.resolvePath('tmp', plan.root)}/`
    || Platform.runtimeProcess.env['TAO_DEV_LOOP_WORKER_CREDENTIALS']
    || await FS.realPath(plan.root) !== plan.root || await FS.fileMode(plan.root) !== 0o700
    || await FS.realPath(planPath) !== planPath || await FS.fileMode(planPath) !== 0o600
  ) {
    fail('Private iOS downloader refused a noncanonical invocation plan/environment.')
  }
  const helper = await loadInstalledIosSdkDownloader({
    resolvePackageDirectory: FS.resolvePackageDirectory,
    importDownloader: async url => await import(url) as InstalledIosSdkDownloader,
  })
  const metadata = await helper.getExpoGoVersionEntryAsync(EXPO_SDK_VERSION)
  const url = new URL(metadata.iosClientUrl)
  if (url.protocol !== 'https:' || url.username || url.password || !metadata.iosClientVersion) {
    fail('SDK metadata lacks authenticated HTTPS iOS client provenance.')
  }
  const appPath = await helper.downloadExpoGoAsync('ios', { sdkVersion: EXPO_SDK_VERSION, url: url.href })
  const field = async (key: string) => {
    const value = await CLI.run('plutil', {
      args: ['-extract', key, 'raw', FS.resolvePath('Info.plist', appPath)],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    if (value.exitCode !== 0 || value.error) {
      fail('Downloaded iOS SDK artifact has no readable bundle metadata.')
    }
    return value.stdout.trim()
  }
  const bundleId = await field('CFBundleIdentifier')
  const clientVersion = await field('CFBundleShortVersionString')
  const executable = await field('CFBundleExecutable')
  if (
    bundleId !== 'host.exp.Exponent' || clientVersion !== metadata.iosClientVersion
    || !safeIosExecutableBasename(executable)
  ) {
    fail('Downloaded iOS runtime does not match its SDK publisher metadata.')
  }
  const artifact: Artifact = {
    sdk: EXPO_SDK_VERSION,
    publisher: 'installed Expo SDK metadata',
    url: url.href,
    clientVersion,
    appPath,
    executable,
    bundleId,
    digest: Platform.sha256Hex(await FS.readFile(await checkedIosExecutable(appPath, executable))),
  }
  await live.save(FS.resolvePath('download.json', plan.root), artifact)
  Platform.runtimeProcess.stdout.write(`TAO_PRIVATE_IOS_ARTIFACT ${JSON.stringify(artifact)}\n`)
}
if (import.meta.main) {
  const args = Platform.runtimeProcess.argv.slice(2)
  if (args.length !== 2 || args[0] !== 'download') {
    fail('Private iOS runtime helper accepts only its fixed download child.')
  }
  await download(args[1]!)
}
