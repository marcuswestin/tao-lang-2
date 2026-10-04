import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import type { AgentAndroidOperations } from '../simulators/AgentAndroidEmulator'
import type { AgentAppDevDevice } from '../simulators/AgentAppDev'
import { AndroidRecovery } from '../simulators/AndroidRecovery'
import { readDevLoopReceipt } from './DevLoopStore'
import { ManagedLoopAcceptanceEvidence } from './ManagedLoopAcceptanceEvidence'
import type { ManagedLoopFixture } from './ManagedLoopAcceptanceFixture'

type AndroidDisposalPlan = {
  artifactRoot: string
  baselineResources?: readonly string[]
} & ({ session: string; fixture: ManagedLoopFixture } | { targetProof: string })

export type ManagedAndroidTargetShutdown = {
  invocation: string
  checkout: string
  device: AgentAppDevDevice
  capture: ReturnType<typeof AndroidRecovery.capture>
  creationGeneration?: string
}

export type ManagedAndroidQuarantinePlan = {
  version: 1
  invocation: string
  artifactRoot: string
  checkout: string
  parent: TrackedProcess
  baselineResources: readonly string[]
}

/** The child accepts a directory, never caller-selected launch arguments or resource names. */
export async function readManagedAndroidQuarantinePlan(
  root: string,
  operations = { identities: ProcessTree.identities, processTable: ProcessTree.processTable },
): Promise<ManagedAndroidQuarantinePlan> {
  const plan = await FS.readJson<ManagedAndroidQuarantinePlan>(FS.resolvePath('private-plan.json', root))
  requireUuid(plan.invocation)
  const invocationRoot = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${plan.invocation}`)
  const self = operations.processTable().find(process => process.pid === Platform.runtimeProcess.pid)
  if (
    plan.version !== 1 || plan.artifactRoot !== invocationRoot
    || root !== FS.resolvePath('android-quarantine', invocationRoot)
    || await FS.realPath(root) !== root || plan.checkout !== await FS.realPath(Repo.getRoot())
    || self?.ppid !== plan.parent.pid
    || !operations.identities([plan.parent.pid]).has(plan.parent.pid)
    || !ProcessTree.sameProcess(operations.identities([plan.parent.pid]).get(plan.parent.pid), plan.parent)
    || !Array.isArray(plan.baselineResources) || plan.baselineResources.some(name => typeof name !== 'string')
  ) {
    Errors.throwHostEnvironment(
      'The private Android quarantine plan lacks its captured parent and checkout provenance.',
    )
  }
  return plan
}

export function managedLoopAndroidPrefix(invocation: string): string {
  requireUuid(invocation)
  return `Tao_Managed_Acceptance_${invocation.replaceAll('-', '')}_`
}

type AndroidAsset = {
  avdName: string
  path: string
  owner: string
  purpose: string
  cleanupCondition: string
  state: 'intent' | 'created' | 'removed' | 'retained'
  creation?: { invocation: string; checkout: string; resource: MachineResourceOwner }
  deletion?: {
    state: 'intent' | 'spawned' | 'closed'
    resource: MachineResourceOwner
    resources?: MachineResourceOwner[]
    child?: TrackedProcess
    processGroupPid?: number
  }
}

/** Fixed private operations keep even dead ordinary peer leases outside every mutator. */
export function managedLoopAndroidOperations<Operations extends AgentAndroidOperations>(options: {
  invocation: string
  eventRoot: string
  baselineResources: readonly string[]
  operations: Operations
  record: (event: unknown) => Promise<void>
  borrowedIos?: string
}): Operations & { observeAndroidDevice: (device: AgentAppDevDevice) => Promise<void> } {
  const prefix = managedLoopAndroidPrefix(options.invocation)
  const pool = `tao-agent-android-pool:${prefix}`
  if (options.borrowedIos !== undefined) {
    requireUuid(options.borrowedIos)
  }
  const iosPool = `tao-agent-simulator-pool:${prefix}`
  const translated = (name: string): string =>
    options.borrowedIos !== undefined && name === 'tao-agent-simulator-pool' ? iosPool : name
  const baseline = new Set(options.baselineResources)
  const chosenSerials = new Set<string>()
  const assets: AndroidAsset[] = []
  const existingAvds = new Set<string>()
  const acquiredAvds = new Map<string, MachineResourceOwner>()
  let emulator: CLI.StartedCommand | undefined
  let emulatorCapture: ReturnType<typeof AndroidRecovery.capture> | undefined
  const assetPath = FS.resolvePath('android-assets.json', options.eventRoot)
  const privateAvd = (name: string): boolean => [1, 2, 3, 4].some(slot => name === `${prefix}${slot}`)
  const refuseBaseline = (name: string): void => {
    if (baseline.has(name)) {
      Errors.throwHostEnvironment(`The private Android fixture refuses preserved baseline resource '${name}'.`)
    }
  }
  const guard = (name: string): void => {
    refuseBaseline(name)
    if (
      name !== pool && !(name.startsWith('android-avd:') && privateAvd(name.slice('android-avd:'.length)))
      && !chosenSerials.has(name)
      && !(options.borrowedIos !== undefined && (name === iosPool || name === `ios-simulator:${options.borrowedIos}`))
    ) {
      Errors.throwHostEnvironment(`The private Android fixture refuses unrelated resource '${name}'.`)
    }
  }
  const admitExisting = async (name: string): Promise<void> => {
    if (!name.startsWith('android-avd:') || !existingAvds.has(name.slice('android-avd:'.length))) {
      return
    }
    const avdName = name.slice('android-avd:'.length)
    const journal = await FS.isFile(assetPath) ? await FS.readJson<AndroidAsset[]>(assetPath) : []
    const asset = journal.find(entry => entry.avdName === avdName)
    if (
      asset?.state !== 'created' || asset.owner !== options.eventRoot
      || asset.creation?.invocation !== options.invocation
      || asset.creation.checkout !== await FS.realPath(Repo.getRoot()) || asset.creation.resource.name !== name
      || asset.creation.resource.repositoryRoot !== Repo.getRoot()
      || !await FS.isFile(FS.resolvePath('android-shutdown.json', options.eventRoot))
    ) {
      Errors.throwHostEnvironment(
        'The private Android fixture refuses an existing AVD without its exact creation journal.',
      )
    }
    const proof = await FS.readJson<ManagedAndroidTargetShutdown>(
      FS.resolvePath('android-shutdown.json', options.eventRoot),
    )
    if (
      proof.device.avdName !== avdName || proof.creationGeneration !== asset.creation.resource.id
      || !await androidTargetClosed(proof, options.invocation, {
        identities: options.operations.processTree?.identities ?? ProcessTree.identities,
        groupAlive: options.operations.processTree?.isGroupAlive ?? ProcessTree.isGroupAlive,
        readOwner: options.operations.readResourceOwner ?? MachineResources.readOwner,
      })
    ) {
      Errors.throwHostEnvironment(
        'The private Android fixture refuses existing AVD reuse without exact prior target closure.',
      )
    }
  }
  const portsUnused = async (port: number): Promise<boolean> => {
    const result = await options.operations.run('lsof', {
      args: ['-nP', `-iTCP:${port}-${port + 1}`, '-sTCP:LISTEN', '-Fp'],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    if (result.error !== undefined || ![0, 1].includes(result.exitCode ?? -1) || result.stderr.trim() !== '') {
      Errors.throwHostEnvironment('Private Android console-pair kernel inspection is unavailable.')
    }
    return result.exitCode === 1 && result.stdout.trim() === ''
  }
  return {
    ...options.operations,
    avdPrefix: prefix,
    acquireResource: async request => {
      refuseBaseline(request.name)
      const name = translated(request.name)
      guard(name)
      await admitExisting(name)
      const lease = await options.operations.acquireResource({ ...request, name })
      if (name.startsWith('android-avd:')) {
        acquiredAvds.set(name, lease.owner)
      }
      return lease
    },
    tryAcquireResource: async request => {
      refuseBaseline(request.name)
      const name = translated(request.name)
      guard(name)
      try {
        await admitExisting(name)
      } catch (error) {
        if (!(error instanceof Errors.HostEnvironmentError)) {
          throw error
        }
        // A sibling private worker can list this invocation's still-unpublished AVD.
        // Skip that slot before registry contact so selection can try a fresh slot.
        await options.record({ event: 'private-existing-avd-refused', name, reason: Errors.formatForUser(error) })
        return undefined
      }
      const lease = await options.operations.tryAcquireResource({ ...request, name })
      if (lease !== undefined && name.startsWith('android-avd:')) {
        acquiredAvds.set(name, lease.owner)
      }
      return lease
    },
    launchReservation: async avdName => {
      if (!privateAvd(avdName)) {
        Errors.throwHostEnvironment('Private Android launch reservation requires its invocation-owned AVD.')
      }
      for (let port = 5580; port <= 5680; port += 2) {
        const name = `android-emulator:emulator-${port}`
        // Preserve baseline identities without asking the ordinary registry to judge liveness.
        if (baseline.has(name) || !await portsUnused(port)) {
          continue
        }
        refuseBaseline(name)
        const lease = await options.operations.tryAcquireResource({
          name,
          command: `private managed-loop Android console pair ${port}-${port + 1}`,
          repositoryRoot: Repo.getRoot(),
        })
        if (lease === undefined) {
          continue
        }
        let transferred = false
        try {
          if (!await portsUnused(port)) {
            continue
          }
          chosenSerials.add(name)
          await options.record({
            event: 'private-console-reserved',
            avdName,
            consolePort: port,
            serial: `emulator-${port}`,
            resource: lease.owner,
          })
          // AgentAndroid takes sole responsibility for this lease before durable launch intent.
          transferred = true
          return { consolePort: port, serialLease: lease }
        } finally {
          if (!transferred) {
            await lease.release()
          }
        }
      }
      Errors.throwHostEnvironment('No baseline-independent private Android console pair is available.')
    },
    start: (command, spec) => {
      const child = options.operations.start(command, spec)
      if (command === 'emulator') {
        emulator = child
      }
      return child
    },
    observeAndroidDevice: async device => {
      if (device.platform !== 'android' || !device.owned || emulator === undefined) {
        return
      }
      if (device.state === 'booted') {
        emulatorCapture = AndroidRecovery.capture(emulator, options.operations)
      }
      if (device.state !== 'released' || emulatorCapture === undefined || emulatorCapture.uncertain) {
        return
      }
      const journal = await FS.readJson<AndroidAsset[]>(assetPath)
      const asset = journal.find(entry => entry.avdName === device.avdName)
      if (asset?.creation === undefined || asset.owner !== options.eventRoot) {
        return
      }
      const proof: ManagedAndroidTargetShutdown = {
        invocation: options.invocation,
        checkout: await FS.realPath(Repo.getRoot()),
        device,
        capture: emulatorCapture,
        creationGeneration: asset.creation.resource.id,
      }
      await ManagedLoopAcceptanceEvidence.write(options.eventRoot, 'android-shutdown', proof)
    },
    run: async (command, spec = {}) => {
      const args = [...spec.args ?? []]
      if (command === 'emulator' && args[0] === '-list-avds') {
        const result = await options.operations.run(command, spec)
        if (result.error === undefined && result.exitCode === 0) {
          existingAvds.clear()
          for (const name of result.stdout.split(/\r?\n/u).map(name => name.trim())) {
            existingAvds.add(name)
          }
        }
        return result
      }
      if (command !== 'avdmanager' || args[0] !== 'create') {
        return await options.operations.run(command, spec)
      }
      const avdName = args[args.indexOf('--name') + 1] ?? ''
      if (!privateAvd(avdName)) {
        Errors.throwHostEnvironment('The private Android fixture refuses creation outside its invocation prefix.')
      }
      const asset: AndroidAsset = {
        avdName,
        path: FS.resolvePath(
          `${avdName}.avd`,
          Platform.runtimeProcess.env['ANDROID_AVD_HOME'] ?? FS.resolvePath(
            'avd',
            Platform.runtimeProcess.env['ANDROID_USER_HOME'] ?? FS.resolvePath('.android', FS.homeDir()),
          ),
        ),
        owner: options.eventRoot,
        purpose: 'Invocation-owned managed-loop Android AVD.',
        cleanupCondition: 'Delete only after proved loop/target shutdown and a fresh exclusive AVD generation.',
        state: 'intent',
        creation: {
          invocation: options.invocation,
          checkout: await FS.realPath(Repo.getRoot()),
          resource: acquiredAvds.get(`android-avd:${avdName}`)
            ?? Errors.throwHostEnvironment('Private Android creation requires its invocation-acquired AVD generation.'),
        },
      }
      if (assets.length === 0 && await FS.isFile(assetPath)) {
        assets.push(...await FS.readJson<AndroidAsset[]>(assetPath))
      }
      const previous = assets.findIndex(entry => entry.avdName === avdName)
      if (previous >= 0) {
        assets.splice(previous, 1)
      }
      assets.push(asset)
      await FS.writeJson(assetPath, assets, { mode: 0o600 })
      const result = await options.operations.run(command, spec)
      asset.state = result.error === undefined && result.exitCode === 0 ? 'created' : 'retained'
      await FS.writeJson(assetPath, assets, { mode: 0o600 })
      return result
    },
  }
}

async function androidTargetClosed(
  proof: ManagedAndroidTargetShutdown,
  invocation: string,
  operations: {
    identities: typeof ProcessTree.identities
    groupAlive: typeof ProcessTree.isGroupAlive
    readOwner: typeof MachineResources.readOwner
  },
): Promise<boolean> {
  const prefix = managedLoopAndroidPrefix(invocation)
  const kernel = operations.identities(proof.capture.processes.map(process => process.pid))
  let stopped = proof.invocation === invocation
    && proof.checkout === await FS.realPath(Repo.getRoot())
    && proof.device.platform === 'android' && proof.device.owned && proof.device.state === 'released'
    && [1, 2, 3, 4].some(slot => proof.device.avdName === `${prefix}${slot}`)
    && /^emulator-(?:558[02468]|559[02468]|56[0-7][02468]|5680)$/u.test(proof.device.id)
    && proof.device.generation !== undefined && proof.device.resources?.length === 2
    && proof.device.resources.every(owner => owner.id === proof.device.generation)
    && proof.device.resources.some(owner => owner.name === `android-avd:${proof.device.avdName}`)
    && proof.device.resources.some(owner => owner.name === `android-emulator:${proof.device.id}`)
    && !proof.capture.uncertain && proof.capture.rootPid !== undefined && proof.capture.processes.length > 0
    && proof.capture.processes.some(process => process.pid === proof.capture.rootPid)
    && !proof.capture.processes.some(process => ProcessTree.sameProcess(kernel.get(process.pid), process))
    && !operations.groupAlive(proof.capture.rootPid)
  for (const owner of proof.device.resources ?? []) {
    if (await operations.readOwner({ name: owner.name }) !== undefined) {
      stopped = false
    }
  }
  return stopped
}

/** AVD assets outlive service processes; dispose only under a new exact exclusive generation. */
export async function cleanupManagedLoopAndroidAssets(
  plan: AndroidDisposalPlan,
  eventRoot: string,
  overrides: Partial<{
    receipt: typeof readDevLoopReceipt
    identities: typeof ProcessTree.identities
    run: typeof CLI.run
    start: typeof CLI.start
    groupAlive: typeof ProcessTree.isGroupAlive
    readOwner: typeof MachineResources.readOwner
    tryAcquire: typeof MachineResources.tryAcquire
    retain: typeof MachineResources.retain
    recover: typeof MachineResources.recoverRetained
    withCurrentOwners: typeof MachineResources.withCurrentOwners
    writeAssets: (path: string, assets: readonly AndroidAsset[]) => Promise<void>
    observationClock: { now: () => number; sleep: (ms: number) => Promise<void> }
  }> = {},
): Promise<void> {
  const operations = {
    receipt: readDevLoopReceipt,
    identities: ProcessTree.identities,
    run: CLI.run,
    start: CLI.start,
    groupAlive: ProcessTree.isGroupAlive,
    readOwner: MachineResources.readOwner,
    tryAcquire: MachineResources.tryAcquire,
    retain: MachineResources.retain,
    recover: MachineResources.recoverRetained,
    withCurrentOwners: MachineResources.withCurrentOwners,
    writeAssets: (path: string, assets: readonly AndroidAsset[]) => FS.writeJson(path, assets, { mode: 0o600 }),
    observationClock: { now: Time.nowMs, sleep: Time.sleep },
    ...overrides,
  }
  const path = FS.resolvePath('android-assets.json', eventRoot)
  if (!await FS.isFile(path)) {
    return
  }
  const assets = await FS.readJson<AndroidAsset[]>(path)
  const prefix = managedLoopAndroidPrefix(FS.basename(plan.artifactRoot))
  let stopped = false
  let targetAvd: string | undefined
  let devices: readonly AgentAppDevDevice[] = []
  let closedProcesses: readonly TrackedProcess[] = []
  let closedGroups: readonly number[] = []
  let shutdownSnapshot = ''
  const readShutdown = async (): Promise<string> =>
    JSON.stringify('session' in plan ? await operations.receipt(plan.session) : await FS.readJson(plan.targetProof))
  if ('session' in plan) {
    const receipt = await operations.receipt(plan.session)
    const processes = [
      ...receipt.children,
      ...receipt.processGroups ?? [],
      ...receipt.controller === undefined ? [] : [receipt.controller],
    ]
    const kernel = operations.identities(processes.map(process => process.pid))
    closedProcesses = processes
    closedGroups = (receipt.processGroups ?? []).map(group => group.pid)
    shutdownSnapshot = JSON.stringify(receipt)
    devices = receipt.devices ?? []
    stopped = receipt.state === 'stopped' && receipt.cleanupOutcome === 'proved'
      && receipt.selection?.appPath === plan.fixture.appPath && receipt.selection.projectRoot === plan.fixture.root
      && !devices.some(device => device.owned && device.state !== 'released')
      && !processes.some(process => ProcessTree.sameProcess(kernel.get(process.pid), process))
      && !(receipt.processGroups ?? []).some(group => operations.groupAlive(group.pid))
  } else {
    if (plan.targetProof !== FS.resolvePath('android-shutdown.json', eventRoot)) {
      Errors.throwHostEnvironment('Private Android disposal requires its fixed durable shutdown proof.')
    }
    const proof = await FS.readJson<ManagedAndroidTargetShutdown>(plan.targetProof)
    closedProcesses = proof.capture.processes
    closedGroups = proof.capture.rootPid === undefined ? [] : [proof.capture.rootPid]
    shutdownSnapshot = JSON.stringify(proof)
    targetAvd = proof.device.avdName
    devices = [proof.device]
    stopped = await androidTargetClosed(proof, FS.basename(plan.artifactRoot), operations)
  }
  let failed = false
  for (const asset of assets) {
    if (asset.state === 'removed') {
      continue
    }
    const name = `android-avd:${asset.avdName}`
    let lease: Awaited<ReturnType<typeof MachineResources.tryAcquire>> = undefined
    let serialLease: Awaited<ReturnType<typeof MachineResources.tryAcquire>> = undefined
    let retained: MachineResourceOwner | undefined
    let pair: MachineResourceOwner[] = []
    try {
      if (
        !stopped || targetAvd !== undefined && asset.avdName !== targetAvd
        || ![1, 2, 3, 4].some(slot => asset.avdName === `${prefix}${slot}`)
        || asset.owner !== eventRoot || plan.baselineResources?.includes(name)
        || await operations.readOwner({ name }) !== undefined
      ) {
        Errors.throwHostEnvironment('Private Android AVD disposal lacks proved shutdown and exclusive provenance.')
      }
      lease = await operations.tryAcquire({
        name,
        command: 'private managed-loop Android asset cleanup',
        repositoryRoot: Repo.getRoot(),
      })
      if (lease === undefined) {
        Errors.throwHostEnvironment('Private Android AVD disposal could not acquire a fresh exclusive generation.')
      }
      const device = devices.find(device =>
        device.platform === 'android' && device.owned && device.avdName === asset.avdName
      )
      const serialName = `android-emulator:${device?.id}`
      if (
        device?.state !== 'released' || device.generation === undefined
        || !/^emulator-(?:558[02468]|559[02468]|56[0-7][02468]|5680)$/u.test(device.id)
        || device.resources?.length !== 2 || device.resources.some(owner => owner.id !== device.generation)
        || !device.resources.some(owner => owner.name === name)
        || !device.resources.some(owner => owner.name === serialName)
        || plan.baselineResources?.includes(serialName)
        || await operations.readOwner({ name: serialName }) !== undefined
      ) {
        Errors.throwHostEnvironment('Private Android disposal lacks its released recorded serial pair.')
      }
      serialLease = await operations.tryAcquire({
        name: serialName,
        command: 'private managed-loop Android serial cleanup',
        repositoryRoot: Repo.getRoot(),
      })
      if (serialLease === undefined) {
        Errors.throwHostEnvironment('Private Android disposal could not reserve its exact released serial.')
      }
      pair = [lease.owner, serialLease.owner]
      if (pair.some(owner => owner.id === device.generation)) {
        Errors.throwHostEnvironment('Private Android cleanup requires fresh exclusive pair generations.')
      }
      const port = Number(device.id.slice('emulator-'.length))
      const clock = operations.observationClock
      const deadline = clock.now() + 5_000
      const remaining = (): number => {
        const budget = Math.floor(deadline - clock.now())
        if (budget <= 0) {
          Errors.throwHostEnvironment('Private Android exact serial absence was not proved within five seconds.')
        }
        return budget
      }
      const assertClosed = (): void => {
        const current = operations.identities(closedProcesses.map(process => process.pid))
        if (
          closedProcesses.some(process => ProcessTree.sameProcess(current.get(process.pid), process))
          || closedGroups.some(group => operations.groupAlive(group))
        ) {
          Errors.throwHostEnvironment('Private Android cleanup lost its captured kernel/group closure proof.')
        }
      }
      const inspect = async (expected: readonly MachineResourceOwner[]): Promise<void> => {
        assertClosed()
        if (await readShutdown() !== shutdownSnapshot) {
          Errors.throwHostEnvironment('Private Android durable shutdown proof changed during serial observation.')
        }
        for (const owner of expected) {
          if ((await operations.readOwner({ name: owner.name }))?.id !== owner.id) {
            Errors.throwHostEnvironment('Private Android cleanup pair generation changed during serial observation.')
          }
        }
        const listeners = await operations.run('lsof', {
          args: ['-nP', `-iTCP:${port}-${port + 1}`, '-sTCP:LISTEN', '-Fp'],
          processPolicy: 'test',
          timeoutMs: remaining(),
        })
        if (
          listeners.error !== undefined || ![0, 1].includes(listeners.exitCode ?? -1)
          || listeners.stdout.trim() !== ''
          || listeners.stderr.trim() !== ''
        ) {
          Errors.throwHostEnvironment('Private Android cleanup console pair inspection failed or found a listener.')
        }
        assertClosed()
        for (const owner of expected) {
          if ((await operations.readOwner({ name: owner.name }))?.id !== owner.id) {
            Errors.throwHostEnvironment('Private Android cleanup pair generation changed after listener inspection.')
          }
        }
        if (await readShutdown() !== shutdownSnapshot) {
          Errors.throwHostEnvironment('Private Android durable shutdown proof changed after listener inspection.')
        }
        remaining()
      }
      let samples = 0
      const observe = async (expected: readonly MachineResourceOwner[]): Promise<boolean> => {
        await inspect(expected)
        const listedDevices = await operations.run('adb', {
          args: ['devices'],
          processPolicy: 'test',
          timeoutMs: remaining(),
        })
        samples++
        if (listedDevices.error !== undefined || listedDevices.exitCode !== 0) {
          Errors.throwHostEnvironment('Private Android exact serial inventory inspection failed.')
        }
        const absent = !listedDevices.stdout.split(/\r?\n/u).some(line => line.startsWith(`${device.id}\t`))
        await inspect(expected)
        return absent
      }
      while (!await observe(pair)) {
        await clock.sleep(Math.min(100, remaining()))
      }
      await ManagedLoopAcceptanceEvidence.write(eventRoot, `serial-absence-${asset.avdName}`, {
        samples,
        serial: device.id,
        pair,
      })
      const launch: { child?: CLI.StartedCommand; identity?: TrackedProcess } = {}
      const capture = { stdout: '', stderr: '' }
      asset.state = 'retained'
      asset.deletion = { state: 'intent', resource: lease.owner, resources: pair }
      await operations.writeAssets(path, assets)
      retained = await operations.retain({
        owners: pair,
        processes: [],
        quarantined: true,
        reason: `Owned AVD deletion intent has an unknown child until durable publication; see ${eventRoot}.`,
      })
      asset.deletion.resource = retained
      pair = [retained, { ...retained, name: serialName }]
      asset.deletion.resources = pair
      await operations.writeAssets(path, assets)
      let commandFailure: unknown
      try {
        try {
          if (!await observe(pair)) {
            Errors.throwHostEnvironment('Private Android exact serial reappeared before deletion admission.')
          }
          await operations.withCurrentOwners({ owners: pair }, () => {
            assertClosed()
            // Assign inside the lock so even a failing lock finalizer cannot lose the started child.
            launch.child = operations.start('avdmanager', {
              args: ['delete', 'avd', '--name', asset.avdName],
              detached: true,
              processPolicy: 'test',
              timeoutMs: 30_000,
              stdio: 'pipe',
              onOutput: (stream, chunk) => {
                capture[stream] += chunk.toString('utf8')
              },
            })
            if (launch.child.pid !== undefined) {
              launch.identity = operations.identities([launch.child.pid]).get(launch.child.pid)
            }
            return launch.child
          })
        } finally {
          // The pre-spawn quarantine survives a crash or publication failure in this gap.
          if (launch.child !== undefined) {
            if (launch.identity === undefined || launch.child.pid === undefined) {
              Errors.throwHostEnvironment('Owned AVD deletion did not capture a publishable kernel child identity.')
            }
            asset.deletion = {
              state: 'spawned',
              resource: retained,
              resources: pair,
              child: launch.identity,
              processGroupPid: launch.child.pid,
            }
            await operations.writeAssets(path, assets)
            retained = await operations.retain({
              owners: pair,
              processes: [launch.identity],
              processGroupPid: launch.child.pid,
              quarantined: true,
              reason: `Owned AVD deletion child is pending exact group/asset closure proof; see ${eventRoot}.`,
            })
            asset.deletion.resource = retained
            pair = [retained, { ...retained, name: serialName }]
            asset.deletion.resources = pair
            await operations.writeAssets(path, assets)
          }
        }
        const child = launch.child
        if (child === undefined) {
          Errors.throwUnexpected('Expected the exclusively started owned AVD cleanup child.')
        }
        const closed = await child.waitForClose()
        if (
          closed.exitCode !== 0 || child.error !== undefined
          || child.pid !== undefined && operations.groupAlive(child.pid)
        ) {
          Errors.throwHostEnvironment(
            'Private Android AVD cleanup command or its process group did not close successfully.',
          )
        }
      } catch (error) {
        commandFailure = error
        throw error
      } finally {
        const child = launch.child
        if (child !== undefined) {
          const cleanupErrors: unknown[] = []
          const attempt = async (work: () => unknown | Promise<unknown>): Promise<void> => {
            try {
              await work()
            } catch (error) {
              cleanupErrors.push(error)
            }
          }
          await attempt(() => child.waitForClose())
          await attempt(() => child.closeOutput())
          await attempt(() => child.dispose())
          await attempt(() =>
            ManagedLoopAcceptanceEvidence.write(eventRoot, `asset-command-${asset.avdName}`, {
              argv: ['avdmanager', 'delete', 'avd', '--name', asset.avdName],
              resources: pair,
              exitCode: child.exitCode,
              signal: child.signalCode,
              identity: launch.identity === undefined
                ? undefined
                : { ...launch.identity, command: 'owned AVD asset cleanup' },
              ...capture,
              cleanupErrors: cleanupErrors.map(error => Errors.formatForUser(error)),
            })
          )
          if (commandFailure === undefined && cleanupErrors.length > 0) {
            throw cleanupErrors[0]
          }
        }
      }
      const listed = await operations.run('emulator', {
        args: ['-list-avds'],
        processPolicy: 'test',
        timeoutMs: 30_000,
      })
      if (
        listed.error !== undefined || listed.exitCode !== 0
        || listed.stdout.split(/\r?\n/u).some(line => line.trim() === asset.avdName)
      ) {
        Errors.throwHostEnvironment('Private Android AVD asset deletion was not proved.')
      }
      asset.state = 'removed'
      asset.deletion!.state = 'closed'
      await operations.recover({
        name,
        generation: retained.id,
        shutdown: async current => {
          if (
            current.id !== retained!.id || launch.identity === undefined || launch.child?.pid === undefined
            || current.retention?.resourceNames.length !== 2
            || pair.some(owner => !current.retention!.resourceNames.includes(owner.name))
            || ProcessTree.sameProcess(
              operations.identities([launch.identity.pid]).get(launch.identity.pid),
              launch.identity,
            )
            || operations.groupAlive(launch.child.pid)
          ) {
            return false
          }
          for (const owner of pair) {
            if ((await operations.readOwner({ name: owner.name }))?.id !== owner.id) {
              return false
            }
          }
          const absent = await operations.run('emulator', {
            args: ['-list-avds'],
            processPolicy: 'test',
            timeoutMs: 30_000,
          })
          return absent.error === undefined && absent.exitCode === 0
            && !absent.stdout.split(/\r?\n/u).some(line => line.trim() === asset.avdName)
        },
      })
      lease = undefined
      serialLease = undefined
      retained = undefined
    } catch (error) {
      asset.state = 'retained'
      failed = true
      if (lease !== undefined && retained === undefined) {
        try {
          const originalPair = serialLease === undefined ? [lease.owner] : [lease.owner, serialLease.owner]
          const stillOwned: MachineResourceOwner[] = []
          for (const owner of originalPair) {
            if ((await operations.readOwner({ name: owner.name }))?.id === owner.id) {
              stillOwned.push(owner)
            }
          }
          if (stillOwned.length === 0) {
            Errors.throwHostEnvironment('Private Android cleanup no longer owns any generation to retain.')
          }
          retained = await operations.retain({
            owners: stillOwned,
            processes: [],
            quarantined: true,
            reason: `Private Android AVD asset cleanup remains unproved; see ${eventRoot}.`,
          })
          pair = stillOwned.map(owner => ({ ...retained!, name: owner.name }))
        } catch (retentionError) {
          await ManagedLoopAcceptanceEvidence.write(eventRoot, `asset-fence-failure-${asset.avdName}`, {
            error: Errors.formatForUser(retentionError),
            owner: lease.owner,
            resources: serialLease === undefined ? [lease.owner] : [lease.owner, serialLease.owner],
          }).catch(() => {})
        }
      }
      await ManagedLoopAcceptanceEvidence.write(eventRoot, `asset-failure-${asset.avdName}`, {
        error: Errors.formatForUser(error),
        asset,
        resources: pair,
      }).catch(() => {})
    }
    await operations.writeAssets(path, assets).catch(() => {
      failed = true
    })
  }
  if (failed) {
    Errors.throwHostEnvironment(`Private Android assets remain retained; see ${path}.`)
  }
}

function requireUuid(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value)) {
    Errors.throwUserInput('The private Android fixture requires an invocation UUID.')
  }
}
