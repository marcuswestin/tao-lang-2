import type { MachineResourceOwner } from '@host-control'
import { Errors, FS, Platform, Repo } from '@shared'
import type { DevLoopConnection, DevLoopTargetReceipt } from '@shared/DevLoopControl'
import type { TrackedProcess } from '@shared/ProcessTree'
import type { AgentAppDevDevice } from '../simulators/AgentAppDev'

export type DevLoopReceipt = {
  version: 1
  session: string
  checkout: string
  args: readonly string[]
  selection?: { appName: string; appPath: string; projectRoot: string }
  generation: string
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'cleanup-failed' | 'interrupted'
  createdAt: string
  updatedAt: string
  controller?: TrackedProcess
  controllerDisposed?: boolean
  children: TrackedProcess[]
  processGroups?: TrackedProcess[]
  devices?: AgentAppDevDevice[]
  provenance?: 'complete' | 'uncertain'
  /** An explicit retained-ownership refusal survives later successful process capture or exit. */
  ownershipRefusal?: {
    version: 1
    generation: string
    reason: string
    /** Restrictive session evidence does not imply that the physical pair write succeeded. */
    physicalPublicationUnproved?: string
    terminal?: { exitCode: number | null; signal: string | null }
  }
  /** Only new complete inspections of known identities may make a closure timeout retryable. */
  recoveryAudit?: { version: 1; generation: string; controller: TrackedProcess; outcome: 'known-closure-pending' }
  url?: string
  targets?: readonly DevLoopTargetReceipt[]
  message?: string
  logPath?: string
  warnings?: readonly string[]
  failures?: readonly string[]
  cleanupOutcome?: 'pending' | 'proved' | 'retained' | 'unknown'
  mobileDriverCleanup?: 'opening' | 'proved' | 'retained'
  mobileDriverProcesses?: TrackedProcess[]
}

export function devLoopDirectory(session: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(session)) {
    Errors.throwUserInput('A dev-loop session must be a UUID.')
  }
  return Repo.resolvePath(`.artifacts/dev-loops/${session}`)
}

export async function readDevLoopReceipt(session: string): Promise<DevLoopReceipt> {
  const value = await FS.readJson<DevLoopReceipt>(FS.resolvePath('receipt.json', devLoopDirectory(session)))
  if (value.version !== 1 || value.session !== session || value.checkout !== await FS.realPath(Repo.getRoot())) {
    Errors.throwUserInput('The dev-loop receipt does not belong to this checkout.')
  }
  preserveOwnershipRefusal(value)
  validateRecoveryAudit(value)
  return value
}

function preserveOwnershipRefusal(receipt: DevLoopReceipt): void {
  if (receipt.ownershipRefusal === undefined) {
    return
  }
  const publicationUnproved = receipt.ownershipRefusal.physicalPublicationUnproved
  if (
    publicationUnproved !== undefined
    && (typeof publicationUnproved !== 'string' || publicationUnproved.length === 0
      || publicationUnproved.length > 1_024)
  ) {
    Errors.throwHostEnvironment('The dev-loop physical refusal publication diagnostic is invalid.')
  }
  receipt.provenance = 'uncertain'
  receipt.cleanupOutcome = 'retained'
  if (receipt.state === 'stopped') {
    receipt.state = 'cleanup-failed'
  }
  receipt.message ??= receipt.ownershipRefusal.reason
  if (!receipt.failures?.includes(receipt.ownershipRefusal.reason)) {
    receipt.failures = [...receipt.failures ?? [], receipt.ownershipRefusal.reason]
  }
}

export async function writeDevLoopReceipt(receipt: DevLoopReceipt): Promise<void> {
  validateRecoveryAudit(receipt)
  receipt.logPath ??= `.artifacts/dev-loops/${receipt.session}/loop.log`
  receipt.warnings ??= []
  receipt.failures ??= []
  receipt.cleanupOutcome ??= 'unknown'
  const directory = devLoopDirectory(receipt.session)
  const path = FS.resolvePath('receipt.json', directory)
  if (await FS.exists(path)) {
    const previous = await FS.readJson<DevLoopReceipt>(path)
    if (previous.session === receipt.session && previous.checkout === receipt.checkout && previous.ownershipRefusal) {
      const terminal = receipt.ownershipRefusal?.generation === previous.ownershipRefusal.generation
          && receipt.ownershipRefusal.reason === previous.ownershipRefusal.reason
        ? receipt.ownershipRefusal.terminal
        : undefined
      const publicationUnproved = receipt.ownershipRefusal?.generation === previous.ownershipRefusal.generation
          && receipt.ownershipRefusal.reason === previous.ownershipRefusal.reason
        ? receipt.ownershipRefusal.physicalPublicationUnproved
        : undefined
      receipt.ownershipRefusal = { ...structuredClone(previous.ownershipRefusal), ...terminal ? { terminal } : {} }
      if (previous.ownershipRefusal.physicalPublicationUnproved === undefined && publicationUnproved !== undefined) {
        receipt.ownershipRefusal.physicalPublicationUnproved = publicationUnproved
      }
    }
  }
  preserveOwnershipRefusal(receipt)
  const temporary = FS.resolvePath(`receipt-${Platform.randomUUID()}.tmp`, directory)
  await FS.writeJson(temporary, receipt)
  await FS.move(temporary, path)
}

function validRecordedProcess(value: unknown): value is TrackedProcess {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const process = value as Partial<TrackedProcess>
  return Number.isSafeInteger(process.pid) && process.pid! > 1 && typeof process.command === 'string'
    && typeof process.startedAt === 'string' && process.startedAt.length > 0 && process.startedAt.length <= 256
}

function validateRecoveryAudit(receipt: DevLoopReceipt): void {
  const audit = receipt.recoveryAudit
  if (audit === undefined) {
    return
  }
  if (
    audit === null || audit.version !== 1 || audit.outcome !== 'known-closure-pending'
    || audit.generation !== receipt.generation || !validRecordedProcess(audit.controller)
    || !validRecordedProcess(receipt.controller) || audit.controller.pid !== receipt.controller.pid
    || audit.controller.startedAt !== receipt.controller.startedAt
  ) {
    Errors.throwHostEnvironment('The managed recovery audit does not match its original generation and controller.')
  }
}

export type ManagedAndroidCustodyEvidence =
  | { kind: 'none' }
  | { kind: 'known'; receipt: DevLoopReceipt }
  | { kind: 'refused' | 'ambiguous'; reason: string }

/** Fixed read-only legacy protection; receipt text and AVD naming never grant recovery authority. */
export async function readManagedAndroidRecoveryCustody(
  owner: MachineResourceOwner,
): Promise<ManagedAndroidCustodyEvidence> {
  const checkout = await FS.realPath(Repo.getRoot())
  if (owner.repositoryRoot !== checkout) {
    return { kind: 'ambiguous', reason: 'Android physical ownership does not prove this canonical checkout.' }
  }
  const root = FS.resolvePath('.artifacts/dev-loops', checkout)
  let entries: string[]
  try {
    entries = await FS.listDir(root)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { kind: 'none' }
    }
    return { kind: 'ambiguous', reason: 'Managed Android receipt inventory is unreadable.' }
  }
  const sessions = entries.filter(entry =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(entry)
  )
  if (sessions.length > 512) {
    return { kind: 'ambiguous', reason: 'Managed Android receipt inventory exceeds its bounded inspection limit.' }
  }
  const records: DevLoopReceipt[] = []
  for (const session of sessions) {
    const directory = FS.resolvePath(session, root)
    const path = FS.resolvePath('receipt.json', directory)
    let record: DevLoopReceipt
    try {
      if (await FS.realPath(directory) !== directory || await FS.byteSize(path) > 256 * 1_024) {
        return { kind: 'ambiguous', reason: 'Managed Android receipt storage custody is unproved.' }
      }
      record = await FS.readJson<DevLoopReceipt>(path)
      if (
        record === null || typeof record !== 'object' || record.devices !== undefined && !Array.isArray(record.devices)
      ) {
        return { kind: 'ambiguous', reason: 'Managed Android receipt structure is unreadable.' }
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        continue
      }
      return { kind: 'ambiguous', reason: 'Managed Android receipt inspection failed.' }
    }
    if (record.session !== session) {
      return { kind: 'ambiguous', reason: 'Managed Android receipt session storage does not match its identity.' }
    }
    records.push(record)
  }
  return classifyManagedAndroidRecoveryCustody(owner, records, checkout)
}

/** Pure classification permits source fixtures without reading or mutating machine custody. */
export function classifyManagedAndroidRecoveryCustody(
  owner: MachineResourceOwner,
  records: readonly DevLoopReceipt[],
  checkout: string,
): ManagedAndroidCustodyEvidence {
  if (owner.repositoryRoot !== checkout) {
    return { kind: 'ambiguous', reason: 'Android physical ownership does not prove this canonical checkout.' }
  }
  let known: DevLoopReceipt | undefined
  for (const record of records) {
    if (record.devices !== undefined && !Array.isArray(record.devices)) {
      return { kind: 'ambiguous', reason: 'Managed Android device custody is unreadable.' }
    }
    const candidates = (record.devices ?? []).filter(device =>
      device !== null && typeof device === 'object'
      && device.platform === 'android' && `android-avd:${device.avdName}` === owner.name
    )
    if (candidates.length === 0) {
      continue
    }
    const device = candidates[0]!
    const serial = `android-emulator:${device.id}`
    const names = [owner.name, serial]
    // Only obsolete claims with complete structured closure evidence may be ignored.
    // An unresolved or malformed prior generation still prevents successor adoption.
    if (
      candidates.length === 1 && device.generation !== owner.id
      && completedAndroidCustody(record, device, names, checkout)
    ) {
      continue
    }
    const captured = owner.retention?.processes.find(process => process.pid === owner.retention?.processGroupPid)
    if (
      candidates.length !== 1 || record.version !== 1
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(record.session)
      || record.checkout !== checkout || owner.repositoryRoot !== checkout || typeof record.generation !== 'string'
      || record.generation.length === 0 || !validRecordedProcess(record.controller)
      || !validRecordedProcess(device.holder)
      || record.controller.pid !== device.holder.pid || record.controller.startedAt !== device.holder.startedAt
      || device.owned !== true || device.generation !== owner.id || !Array.isArray(device.resources)
      || device.resources.length !== 2
      || !/^emulator-\d+$/u.test(device.id)
      || !device.resources.every(resource =>
        resource !== null && typeof resource === 'object' && names.includes(resource.name) && resource.id === owner.id
        && resource.pid === owner.pid && resource.processStartedAt === owner.processStartedAt
        && resource.repositoryRoot === checkout
      )
      || new Set(device.resources.map(resource => resource.name)).size !== 2
      || owner.retention?.resourceNames.length !== 2 || !owner.retention.resourceNames.every(name =>
        names.includes(name)
      )
      || captured === undefined || captured.pid !== owner.pid || captured.startedAt !== owner.processStartedAt
      || !Array.isArray(record.children) || !record.children.some(process =>
        validRecordedProcess(process)
        && process.pid === captured.pid && process.startedAt === captured.startedAt
      )
      || !Array.isArray(record.processGroups) || !record.processGroups.some(process =>
        validRecordedProcess(process)
        && process.pid === captured.pid && process.startedAt === captured.startedAt
      )
    ) {
      return {
        kind: 'ambiguous',
        reason: 'Matching managed Android custody has changed or incomplete physical ownership.',
      }
    }
    try {
      validateRecoveryAudit(record)
    } catch {
      return { kind: 'ambiguous', reason: 'Matching managed Android recovery audit is invalid.' }
    }
    if (record.ownershipRefusal !== undefined || record.provenance !== 'complete') {
      return { kind: 'refused', reason: 'Matching managed Android receipt retains unknown ownership.' }
    }
    if (record.mobileDriverCleanup !== undefined && record.mobileDriverCleanup !== 'proved') {
      return { kind: 'refused', reason: 'Matching managed Android mobile driver cleanup remains unproved.' }
    }
    if (
      (record.state === 'failed' || record.state === 'cleanup-failed' || record.cleanupOutcome === 'retained')
      && record.recoveryAudit === undefined
    ) {
      return {
        kind: 'refused',
        reason: 'Unresolved legacy managed Android receipt lacks a known-closure recovery audit.',
      }
    }
    if (known !== undefined) {
      return { kind: 'ambiguous', reason: 'More than one managed Android receipt claims the exact physical ownership.' }
    }
    known = record
  }
  return known === undefined ? { kind: 'none' } : { kind: 'known', receipt: known }
}

function completedAndroidCustody(
  record: DevLoopReceipt,
  device: AgentAppDevDevice,
  names: readonly string[],
  checkout: string,
): boolean {
  if (
    record.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(record.session)
    || record.checkout !== checkout || typeof record.generation !== 'string' || record.generation.length === 0
    || record.state !== 'stopped' || record.cleanupOutcome !== 'proved' || record.provenance !== 'complete'
    || record.ownershipRefusal !== undefined || record.recoveryAudit !== undefined
    || record.mobileDriverCleanup !== undefined && record.mobileDriverCleanup !== 'proved'
    || !validRecordedProcess(record.controller) || !validRecordedProcess(device.holder)
    || record.controller.pid !== device.holder.pid || record.controller.startedAt !== device.holder.startedAt
    || device.owned !== true || device.state !== 'released' || typeof device.generation !== 'string'
    || device.generation.length === 0 || !/^emulator-\d+$/u.test(device.id)
    || !Array.isArray(device.resources) || device.resources.length !== 2
    || !device.resources.every(resource =>
      resource !== null && typeof resource === 'object'
      && names.includes(resource.name) && resource.id === device.generation && Number.isSafeInteger(resource.pid)
      && resource.pid > 1 && typeof resource.processStartedAt === 'string' && resource.processStartedAt.length > 0
      && resource.repositoryRoot === checkout && typeof resource.command === 'string'
      && typeof resource.startedAt === 'string'
      && (resource.retention === undefined || resource.retention !== null && typeof resource.retention === 'object'
          && resource.retention.ownershipRefusal === undefined && resource.retention.quarantined === false
          && typeof resource.retention.reason === 'string' && Array.isArray(resource.retention.resourceNames)
          && resource.retention.resourceNames.length === 2 && resource.retention.resourceNames.every((name: unknown) =>
            typeof name === 'string' && names.includes(name)
          )
          && Array.isArray(resource.retention.processes) && resource.retention.processes.every(validRecordedProcess)
          && (resource.retention.processGroupPid === undefined || resource.retention.processGroupPid === resource.pid))
    )
    || new Set(device.resources.map(resource => resource.name)).size !== 2
  ) {
    return false
  }
  const physical = device.resources[0]!
  return device.resources.every(resource =>
    resource.pid === physical.pid && resource.processStartedAt === physical.processStartedAt
  )
    && Array.isArray(record.children) && record.children.some(process =>
      validRecordedProcess(process)
      && process.pid === physical.pid && process.startedAt === physical.processStartedAt
    )
    && Array.isArray(record.processGroups) && record.processGroups.some(process =>
      validRecordedProcess(process)
      && process.pid === physical.pid && process.startedAt === physical.processStartedAt
    )
}

export async function writeDevLoopConnection(connection: DevLoopConnection): Promise<string> {
  const directory = FS.resolvePath('active-control', devLoopDirectory(connection.session))
  await FS.mkdir(directory)
  await FS.chmod(directory, 0o700)
  const path = FS.resolvePath('credentials.json', directory)
  const temporary = FS.resolvePath(`credentials-${Platform.randomUUID()}.tmp`, directory)
  await FS.writeJson(temporary, connection, { mode: 0o600 })
  await FS.chmod(temporary, 0o600)
  await FS.move(temporary, path)
  return path
}

export async function readDevLoopConnection(session: string): Promise<DevLoopConnection> {
  const directory = FS.resolvePath('active-control', devLoopDirectory(session))
  const path = FS.resolvePath('credentials.json', directory)
  if (await FS.fileMode(directory) !== 0o700 || await FS.fileMode(path) !== 0o600) {
    Errors.throwHostEnvironment('Managed dev-loop credentials must be private.')
  }
  const connection = await FS.readJson<DevLoopConnection>(path)
  if (connection.session !== session) {
    Errors.throwHostEnvironment('Managed dev-loop connection belongs to another session.')
  }
  return connection
}
