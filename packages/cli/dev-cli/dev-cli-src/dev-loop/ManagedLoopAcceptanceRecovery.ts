import {
  type ManagedLoopAcceptanceRecoveryRequest,
  parseManagedLoopAcceptanceRecoveryArgs,
} from '@agent-cli/agent-config/ManagedLoopAcceptanceRecoveryArgs'
import { type MachineResourceLease, type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, HCI, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'

type Resources = Pick<
  typeof MachineResources,
  'readOwner' | 'readRetainedLineage' | 'acquire' | 'withCurrentOwners' | 'recoverRetained'
>
export type ManagedLoopAcceptanceRecoverySourceOperations = {
  checkout: string
  avdHome: string
  resources: Resources
  tree: typeof ProcessTree
  runSync: typeof CLI.mustRunSync
  start: typeof CLI.start
  processIsAlive: typeof Platform.processIsAlive
}
type Capsule = {
  invocation: string
  checkout: string
  artifacts: string
  digest: string
  avdName: string
  serial: string
  consolePort: number
  generation: string
  recordedGeneration: string
  root: TrackedProcess
  processes: TrackedProcess[]
  avdPath: string
  iniPath: string
}
type RecoveryReceipt = {
  version: 1
  invocation: string
  digest: string
  generation: string
  phase: 'unproved' | 'captured' | 'closed' | 'deleting' | 'deleted' | 'released'
  disposition: 'source regression' | 'real-host pass' | 'retained'
  avdOwner?: MachineResourceOwner
  detail?: string
}
type Observation = { processes: TrackedProcess[]; listeners: number[]; stopped: boolean }
const recoveryCommand = 'owned Android borrowing recovery'

/** Finite recovery of the recorded console-only borrowing sentinel; caller selectors are never authority. */
export async function runManagedLoopAcceptanceRecovery(request: ManagedLoopAcceptanceRecoveryRequest): Promise<number> {
  const checkout = Repo.getRoot()
  const androidHome = Platform.runtimeProcess.env['ANDROID_USER_HOME'] ?? FS.resolvePath('.android', FS.homeDir())
  const receipt = await recover(request, {
    checkout,
    avdHome: Platform.runtimeProcess.env['ANDROID_AVD_HOME'] ?? FS.resolvePath('avd', androidHome),
    resources: MachineResources,
    tree: ProcessTree,
    runSync: CLI.mustRunSync,
    start: CLI.start,
    processIsAlive: Platform.processIsAlive,
  }, false)
  HCI.writeLine(JSON.stringify(receipt))
  return receipt.disposition === 'real-host pass' ? 0 : 1
}

export async function runManagedLoopAcceptanceRecoverySourceRegression(
  request: ManagedLoopAcceptanceRecoveryRequest,
  operations: ManagedLoopAcceptanceRecoverySourceOperations,
): Promise<RecoveryReceipt> {
  return await recover(request, operations, true)
}

async function recover(
  request: ManagedLoopAcceptanceRecoveryRequest,
  operations: ManagedLoopAcceptanceRecoverySourceOperations,
  source: boolean,
): Promise<RecoveryReceipt> {
  // Revalidate even direct callers before deriving paths or allocating a fence.
  const { invocation } = parseManagedLoopAcceptanceRecoveryArgs(['--invocation', request.invocation])
  const root = FS.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`, operations.checkout)
  await safeEntry(operations.checkout, root, 'directory')
  const receiptPath = FS.resolvePath('recovery-receipt.json', root)
  let capsule: Capsule
  try {
    capsule = await readCapsule(invocation, operations)
  } catch (error) {
    const refusal: RecoveryReceipt = {
      version: 1,
      invocation,
      digest: '',
      generation: '',
      phase: 'unproved',
      disposition: 'retained',
      detail: Errors.formatForUser(error),
    }
    const refusalPath = FS.resolvePath('recovery-refusal.json', root)
    if (await FS.exists(refusalPath)) {
      await safeEntry(operations.checkout, refusalPath, 'file')
    }
    const staged = FS.resolvePath(`.recovery-${Platform.randomUUID()}.json`, root)
    await FS.writeJson(staged, refusal, { mode: 0o600 })
    await FS.moveFileWithinBoundary(staged, refusalPath, operations.checkout)
    return refusal
  }
  let receipt: RecoveryReceipt = {
    version: 1,
    invocation,
    digest: capsule.digest,
    generation: '',
    phase: 'unproved',
    disposition: 'retained',
  }
  let previous: RecoveryReceipt | undefined
  let lease: MachineResourceLease | undefined
  let expected: MachineResourceOwner | undefined
  let capturedWitness = false
  const save = async () => {
    await safeEntry(operations.checkout, root, 'directory')
    if (await FS.exists(receiptPath)) {
      await safeEntry(operations.checkout, receiptPath, 'file')
    }
    const staged = FS.resolvePath(`.recovery-${Platform.randomUUID()}.json`, root)
    await FS.writeJson(staged, receipt, { mode: 0o600 })
    await FS.moveFileWithinBoundary(staged, receiptPath, operations.checkout)
  }
  const assertRecorded = async () => {
    if ((await readCapsule(invocation, operations)).digest !== capsule.digest) {
      Errors.throwHostEnvironment('The recorded borrowing capsule changed; recovery remains retained.')
    }
  }
  const owners = () => [expected!, ...(lease === undefined ? [] : [lease.owner])]
  const observe = () => observeKernel(capsule, operations, previous !== undefined || capturedWitness)
  const admitted = async <T>(
    action: (observation: Observation) => T & (T extends PromiseLike<unknown> ? never : unknown),
  ) => {
    await assertRecorded()
    return await operations.resources.withCurrentOwners({ owners: owners() }, () => action(observe()))
  }
  try {
    if (await FS.exists(receiptPath)) {
      await safeEntry(operations.checkout, receiptPath, 'file')
      const value = await FS.readJson<RecoveryReceipt>(receiptPath)
      if (
        value.version !== 1 || value.invocation !== invocation || value.digest !== capsule.digest
        || !['unproved', 'captured', 'closed', 'deleting', 'deleted', 'released'].includes(value.phase)
        || typeof value.generation !== 'string' || value.phase !== 'unproved' && value.generation.length === 0
        || !['retained', 'real-host pass', 'source regression'].includes(value.disposition)
      ) {
        Errors.throwHostEnvironment('The recovery phase receipt is inconsistent with the recorded borrowing capsule.')
      }
      previous = value.phase === 'unproved' ? undefined : value
    }
    if (
      (!await FS.exists(capsule.avdPath) || !await FS.exists(capsule.iniPath))
      && previous?.phase !== 'deleting' && previous?.phase !== 'deleted' && previous?.phase !== 'released'
    ) {
      Errors.throwHostEnvironment('The recorded AVD files disappeared without a recorded deletion admission.')
    }
    if (
      (previous?.phase === 'deleted' || previous?.phase === 'released')
      && (await FS.exists(capsule.avdPath) || await FS.exists(capsule.iniPath))
    ) {
      Errors.throwHostEnvironment('Previously deleted borrowing assets reappeared; recovery will not adopt them.')
    }
    const lineage = await operations.resources.readRetainedLineage({
      name: `android-console-port:${capsule.consolePort}`,
      generation: capsule.generation,
    })
    if (lineage === undefined || lineage.length === 0) {
      Errors.throwHostEnvironment('The original borrowing console generation has no complete retained lineage.')
    }
    for (const owner of lineage) {
      requireConsoleOwner(owner, capsule)
    }
    if (!lineage.some(owner => owner.id === capsule.recordedGeneration)) {
      Errors.throwHostEnvironment('The borrowing receipt console generation is absent from its retained lineage.')
    }
    expected = lineage[lineage.length - 1]!
    receipt.generation = expected.id
    if (previous !== undefined && previous.generation !== expected.id) {
      Errors.throwHostEnvironment('The borrowing console generation changed since the recorded recovery phase.')
    }
    // Absence cannot mint authority. The first attempt must still witness its captured root.
    await admitted(observation => {
      if (previous === undefined && observation.processes.length === 0) {
        Errors.throwHostEnvironment(
          'No live captured ancestry or prior admitted recovery phase proves shutdown authority.',
        )
      }
      if (previous !== undefined && previous.phase !== 'captured') {
        requireStopped(observation)
      }
      return undefined
    })
    receipt.phase = 'captured'
    const avdResource = `android-avd:${capsule.avdName}`
    const existing = await operations.resources.readOwner({ name: avdResource })
    if (existing !== undefined) {
      Errors.throwHostEnvironment('The invocation AVD still has a fence; recovery will preserve its exact generation.')
    }
    lease = await operations.resources.acquire({
      name: avdResource,
      command: recoveryCommand,
      repositoryRoot: capsule.checkout,
      waitTimeoutMs: 0,
      processIdentity: async () => ({ evidence: 'unknown' }),
    })
    receipt.avdOwner = lease.owner
    await admitted(() => undefined)
    if (previous !== undefined) {
      receipt.phase = previous.phase
    }
    await save()
    capturedWitness = true
    await admitted(() => undefined)
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      if (await admitted(observation => observation.stopped)) {
        break
      }
      await admitted(observation => {
        if (!observation.stopped) {
          // The group was inspected for exclusions; only the original captured kernels are signalled.
          operations.tree.signalTracked(observation.processes, signal)
        }
        return undefined
      })
      const stopped = await Time.pollUntil(
        async () => await admitted(observation => observation.stopped) ? true : undefined,
        { intervalMs: 100, timeoutMs: 30_000 },
      )
      if (stopped === true) {
        break
      }
    }
    if (!await admitted(observation => observation.stopped)) {
      Errors.throwHostEnvironment(
        'Captured borrowing kernels, group, or both listeners remain alive; recovery is retained.',
      )
    }
    receipt.phase = 'closed'
    await save()
    await admitted(observation => requireStopped(observation))
    await safeAssetPaths(capsule, operations.avdHome)
    const avdExists = await FS.exists(capsule.avdPath)
    const iniExists = await FS.exists(capsule.iniPath)
    if (
      (!avdExists || !iniExists) && previous?.phase !== 'deleting' && previous?.phase !== 'deleted'
      && previous?.phase !== 'released'
    ) {
      Errors.throwHostEnvironment('The recorded AVD files disappeared without a recorded deletion admission.')
    }
    if (avdExists || iniExists) {
      receipt.phase = 'deleting'
      await save()
      await safeAssetPaths(capsule, operations.avdHome)
      const child = await admitted(observation => {
        requireStopped(observation)
        return operations.start('avdmanager', {
          args: ['delete', 'avd', '--name', capsule.avdName],
          processPolicy: 'test',
          timeoutMs: 30_000,
          stdio: 'pipe',
        })
      })
      try {
        const result = await child.waitForClose()
        await admitted(observation => requireStopped(observation))
        if (child.error !== undefined || result.exitCode !== 0) {
          Errors.throwHostEnvironment('The fixed invocation AVD deletion failed; retained custody remains.')
        }
      } finally {
        await child.closeOutput()
        child.dispose()
      }
    }
    await safeAssetPaths(capsule, operations.avdHome)
    if (await FS.exists(capsule.avdPath) || await FS.exists(capsule.iniPath)) {
      Errors.throwHostEnvironment('Invocation AVD deletion remains unproved; retained custody remains.')
    }
    await admitted(observation => requireStopped(observation))
    receipt.phase = 'deleted'
    await save()
    await assertRecorded()
    await operations.resources.recoverRetained({
      name: expected.name,
      generation: expected.id,
      shutdown: async owner => {
        if (!sameOwner(owner, expected!)) {
          Errors.throwHostEnvironment('The borrowing console generation changed before retained release.')
        }
        return await admitted(observation => observation.stopped)
      },
    })
    receipt.phase = 'released'
    receipt.disposition = source ? 'source regression' : 'real-host pass'
    await save()
  } catch (error) {
    receipt.disposition = 'retained'
    receipt.detail = Errors.formatForUser(error)
    if (receipt.phase === 'captured') {
      // A refused inspection cannot become authority merely because its kernels disappear later.
      receipt.phase = 'unproved'
    }
    // Invalid original files are never rewritten. A separate receipt records only this attempted phase.
    await save()
  } finally {
    await lease?.release()
  }
  return receipt
}

async function readCapsule(
  invocation: string,
  operations: ManagedLoopAcceptanceRecoverySourceOperations,
): Promise<Capsule> {
  const checkout = FS.resolvePath(operations.checkout)
  if (await FS.realPath(checkout) !== checkout) {
    Errors.throwHostEnvironment('Borrowing recovery requires its exact original checkout without symlink indirection.')
  }
  const root = FS.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`, checkout)
  const artifacts = FS.resolvePath('borrowed-android', root)
  const paths = [
    'invocation.json',
    'borrowed-android/receipt.json',
    'borrowed-android/sentinel-identity.json',
    'borrowed-android/external-directories.json',
  ].map(path => FS.resolvePath(path, root))
  const texts: string[] = []
  for (const path of paths) {
    await safeEntry(checkout, path, 'file')
    texts.push(await FS.readText(path))
    await safeEntry(checkout, path, 'file')
  }
  const [invocationRecord, receipt, identity, external] = texts.map(text => JSON.parse(text))
  const processes: TrackedProcess[] = identity?.processes
  const capturedRoot = Array.isArray(processes) ? processes[0] : undefined
  const recordedConsole = Array.isArray(receipt?.unresolved)
    ? receipt.unresolved.filter((item: { name?: unknown }) =>
      item?.name === `android-console-port:${identity?.consolePort}`
    )
    : []
  const validProcesses = Array.isArray(processes) && processes.length > 0 && processes.every(validProcess)
    && new Set(processes.map(process => process.pid)).size === processes.length
  if (
    invocationRecord?.request?.case !== 'android-lifecycle'
    || Object.keys(invocationRecord.request).length !== 1 || !validProcess(invocationRecord.owner)
    || !/^[0-9a-f]{40}$/u.test(invocationRecord.sourceCommit ?? '')
    || typeof invocationRecord.dirtyPaths !== 'string'
    || receipt?.target !== 'android' || receipt.cleanup !== 'retained' || receipt.artifacts !== artifacts
    || receipt.disposition !== 'real-host failure' || typeof receipt.preserved !== 'boolean'
    || !Array.isArray(receipt.unresolved) || !validProcesses || !capturedRoot
    || !sameProcesses(receipt.processes, processes)
    || !/^Tao_Borrow_[0-9a-f]{32}$/u.test(identity.avdName ?? '')
    || !Number.isSafeInteger(identity.consolePort) || identity.consolePort < 5580 || identity.consolePort > 5680
    || identity.consolePort % 2 !== 0 || identity.serial !== `emulator-${identity.consolePort}`
    || receipt.id !== identity.serial
    || !new RegExp(`^${capturedRoot.pid}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'u').test(
      identity.generation ?? '',
    )
    || recordedConsole.length !== 1 || typeof recordedConsole[0].generation !== 'string'
  ) {
    Errors.throwHostEnvironment(
      'The recorded Android borrowing invocation, receipt, and captured identity are inconsistent.',
    )
  }
  const avdPath = FS.resolvePath(`${identity.avdName}.avd`, operations.avdHome)
  const iniPath = FS.resolvePath(`${identity.avdName}.ini`, operations.avdHome)
  if (
    !Array.isArray(external) || external.length !== 1 || external[0]?.path !== avdPath
    || external[0].companionFile !== iniPath || external[0].owner !== artifacts
    || external[0].purpose !== 'invocation-owned borrowed Android sentinel' || external[0].state !== 'active'
    || external[0].cleanupCondition
      !== 'Delete only after captured child close, descendant/group/listener disappearance and borrower fence release.'
  ) {
    Errors.throwHostEnvironment(
      'The recorded borrowing external paths do not belong to this invocation and configured AVD home.',
    )
  }
  const capsule: Capsule = {
    invocation,
    checkout,
    artifacts,
    digest: Platform.sha256Hex(texts),
    avdName: identity.avdName,
    serial: identity.serial,
    consolePort: identity.consolePort,
    generation: identity.generation,
    recordedGeneration: recordedConsole[0].generation,
    root: capturedRoot,
    processes,
    avdPath,
    iniPath,
  }
  await safeAssetPaths(capsule, operations.avdHome)
  return capsule
}

function requireConsoleOwner(owner: MachineResourceOwner, capsule: Capsule): void {
  if (owner.retention?.ownershipRefusal !== undefined) {
    Errors.throwHostEnvironment(
      'The borrowing console has permanent ownership refusal; recovery cannot grant new authority.',
    )
  }
  if (
    owner.repositoryRoot !== capsule.checkout || owner.name !== `android-console-port:${capsule.consolePort}`
    || owner.pid !== capsule.root.pid || owner.processStartedAt !== capsule.root.startedAt
    || owner.retention?.processGroupPid !== capsule.root.pid
    || !sameProcesses(owner.retention.processes, capsule.processes)
    || owner.retention.resourceNames.length !== 1 || owner.retention.resourceNames[0] !== owner.name
  ) {
    Errors.throwHostEnvironment(
      'The retained console lineage does not match the original captured kernel and fence manifest.',
    )
  }
}

/** Group membership excludes strangers; it never expands the captured ancestry. Every read is synchronous. */
function observeKernel(
  capsule: Capsule,
  operations: ManagedLoopAcceptanceRecoverySourceOperations,
  mayBeClosed: boolean,
): Observation {
  const { tree } = operations
  const current = tree.identities(capsule.processes.map(process => process.pid))
  const processes = capsule.processes.filter(expected => {
    const actual = current.get(expected.pid)
    if (actual !== undefined && !tree.sameProcess(actual, expected)) {
      Errors.throwHostEnvironment('A captured borrowing PID was reused; refusing all destructive recovery.')
    }
    if (actual === undefined && operations.processIsAlive(expected.pid)) {
      Errors.throwHostEnvironment('A captured borrowing kernel is unreadable; recovery remains retained.')
    }
    return actual !== undefined
  })
  const rootAlive = processes.some(process => process.pid === capsule.root.pid)
  if (!rootAlive && !mayBeClosed) {
    Errors.throwHostEnvironment(
      'The original captured root ancestry is unavailable; absence grants no recovery authority.',
    )
  }
  if (rootAlive) {
    const descendants = tree.descendants(capsule.root.pid)
    if (
      descendants.some(actual =>
        !capsule.processes.some(expected => expected.pid === actual.pid && tree.sameProcess(actual, expected))
      )
    ) {
      Errors.throwHostEnvironment('The borrowing root has unknown descendants; recovery will not signal them.')
    }
    if (!tree.sameProcess(tree.identities([capsule.root.pid]).get(capsule.root.pid), capsule.root)) {
      Errors.throwHostEnvironment('The borrowing root changed during ancestry inspection.')
    }
  }
  const members = tree.groupMembers(capsule.root.pid)
  if (
    members.some(actual =>
      !capsule.processes.some(expected => expected.pid === actual.pid && tree.sameProcess(actual, expected))
    )
  ) {
    Errors.throwHostEnvironment(
      'The borrowing group contains an unknown kernel; group membership cannot grant ownership.',
    )
  }
  for (const process of processes) {
    if (
      tree.processGroupOf(process.pid) !== capsule.root.pid
      || !members.some(member => member.pid === process.pid && tree.sameProcess(member, process))
    ) {
      Errors.throwHostEnvironment('Captured borrowing group membership is incomplete or unreadable.')
    }
  }
  if (tree.isGroupAlive(capsule.root.pid) !== (members.length > 0)) {
    Errors.throwHostEnvironment('The borrowing process group cannot be read completely.')
  }
  let result: Pick<CLI.CommandResult, 'stdout' | 'stderr' | 'exitCode' | 'error'>
  try {
    result = operations.runSync('lsof', {
      args: ['-nP', `-iTCP:${capsule.consolePort}-${capsule.consolePort + 1}`, '-sTCP:LISTEN', '-t', '+w'],
    })
  } catch (error) {
    if (!(error instanceof Errors.CommandExecutionError)) {
      throw error
    }
    result = error.result
  }
  if (
    result.error !== undefined || result.stderr.trim() !== '' || ![0, 1].includes(result.exitCode ?? -1)
    || result.exitCode === 1 && result.stdout.trim() !== ''
  ) {
    Errors.throwHostEnvironment('Both borrowing listeners cannot be read completely; recovery remains retained.')
  }
  const lines = result.stdout.trim() === '' ? [] : result.stdout.trim().split(/\r?\n/u)
  if (
    lines.some(line => !/^[1-9][0-9]*$/u.test(line) || !Number.isSafeInteger(Number(line)))
    || result.exitCode === 0 && lines.length === 0
  ) {
    Errors.throwHostEnvironment('Borrowing listener inspection returned malformed ownership evidence.')
  }
  const listeners = [...new Set(lines.map(line => Number(line)))]
  const listeningIdentities = tree.identities(listeners)
  if (
    listeners.some(pid =>
      !capsule.processes.some(expected =>
        expected.pid === pid
        && tree.sameProcess(listeningIdentities.get(pid), expected)
      )
    )
  ) {
    Errors.throwHostEnvironment('A borrowing listener lacks original captured kernel ownership.')
  }
  const after = tree.identities(capsule.processes.map(process => process.pid))
  if (
    processes.some(process => !tree.sameProcess(after.get(process.pid), process))
    || capsule.processes.some(process => after.has(process.pid) && !tree.sameProcess(after.get(process.pid), process))
  ) {
    Errors.throwHostEnvironment('Captured borrowing kernels changed during recovery inspection.')
  }
  return { processes, listeners, stopped: processes.length === 0 && members.length === 0 && listeners.length === 0 }
}

function requireStopped(observation: Observation): undefined {
  if (!observation.stopped) {
    Errors.throwHostEnvironment(
      'Captured kernel closure, readable empty group, and both absent listeners are required.',
    )
  }
  return undefined
}

function validProcess(value: unknown): value is TrackedProcess {
  const process = value as TrackedProcess | undefined
  return process !== undefined && process !== null && Number.isSafeInteger(process.pid) && process.pid > 1
    && typeof process.startedAt === 'string' && process.startedAt.length > 0 && typeof process.command === 'string'
}
function sameProcesses(a: unknown, b: readonly TrackedProcess[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every(validProcess)
    && a.every(actual => b.some(expected => expected.pid === actual.pid && expected.startedAt === actual.startedAt))
}
function sameOwner(a: MachineResourceOwner, b: MachineResourceOwner): boolean {
  return a.id === b.id && a.name === b.name && a.pid === b.pid && a.processStartedAt === b.processStartedAt
    && a.repositoryRoot === b.repositoryRoot
}

async function safeEntry(boundary: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  const relative = FS.relativePath(boundary, path)
  if (relative === '..' || relative.startsWith('../') || FS.isAbsolute(relative)) {
    Errors.throwHostEnvironment('Borrowing recovery evidence escaped its fixed checkout boundary.')
  }
  let current = FS.resolvePath(boundary)
  for (const component of ['', ...relative.split('/').filter(Boolean)]) {
    current = FS.resolvePath(component, current)
    const metadata = await FS.entryMetadata(current)
    if (metadata.kind !== (current === path ? kind : 'directory')) {
      Errors.throwHostEnvironment('Borrowing recovery evidence contains a symlink or unexpected filesystem entry.')
    }
  }
}

async function safeAssetPaths(capsule: Capsule, avdHome: string): Promise<void> {
  await safeEntry('/', FS.resolvePath(avdHome), 'directory')
  for (const [path, kind] of [[capsule.avdPath, 'directory'], [capsule.iniPath, 'file']] as const) {
    const metadata = await FS.entryMetadata(path).catch(error => {
      if ((error as { code?: string }).code === 'ENOENT') {
        return undefined
      }
      throw error
    })
    if (metadata !== undefined) {
      await safeEntry(FS.resolvePath(avdHome), path, kind)
    }
  }
}
