import { FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'

type Receipt = {
  emulatorPid?: number
  emulatorStartedAt?: string
  ownerPid: number
  ownerStartedAt?: string
  runId: string
  startedAtMs: number
  status: 'starting' | 'booted' | 'failed' | 'timed-out'
  version: 1
}

type Dependencies = {
  identityOf: (pid: number) => TrackedProcess | undefined
  isAlive: (pid: number) => boolean
  now: () => number
  ownerPid: number
  randomUUID: () => string
}

export type EmulatorLog = { path: string; receipt: Receipt; root: string }

const defaultDependencies: Dependencies = {
  identityOf: pid => ProcessTree.identities([pid]).get(pid),
  isAlive: Platform.processIsAlive,
  now: () => Date.now(),
  ownerPid: Platform.runtimeProcess.pid,
  randomUUID: Platform.randomUUID,
}
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_DEAD_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_DEAD_LOGS = 2
const MAX_DEAD_BYTES = 16 * 1024 * 1024

function store(): string {
  return Repo.resolvePath('.artifacts/android-emulator-logs')
}

/** A receipt is published before the log path is used, so interrupted allocation remains owned. */
async function begin(root = store(), dependencies = defaultDependencies): Promise<EmulatorLog> {
  const owner = dependencies.identityOf(dependencies.ownerPid)
  const receipt: Receipt = {
    ownerPid: dependencies.ownerPid,
    ...(owner === undefined ? {} : { ownerStartedAt: owner.startedAt }),
    runId: dependencies.randomUUID(),
    startedAtMs: dependencies.now(),
    status: 'starting',
    version: 1,
  }
  await publishReceipt(root, receipt)
  return { path: FS.resolvePath(`${receipt.runId}.log`, root), receipt, root }
}

async function finish(log: EmulatorLog, status: 'booted' | 'failed' | 'timed-out'): Promise<void> {
  const value: unknown = await FS.readJson(receiptPath(log)).catch(() => undefined)
  const current = validReceipt(value, log.receipt.runId) ?? log.receipt
  await publishReceipt(log.root, { ...current, status })
}

/** The detached child, not the short-lived command owner, keeps a live log protected. */
async function recordChild(
  log: EmulatorLog,
  pid: number | undefined,
  dependencies = defaultDependencies,
): Promise<void> {
  if (pid !== undefined) {
    const child = dependencies.identityOf(pid)
    await publishReceipt(log.root, {
      ...log.receipt,
      emulatorPid: pid,
      ...(child === undefined ? {} : { emulatorStartedAt: child.startedAt }),
    })
  }
}

/** Keep live writers and the two newest dead logs for diagnosis; retire older owned output. */
async function prune(
  mayHaveUnrecordedEmulator = false,
  root = store(),
  dependencies = defaultDependencies,
): Promise<void> {
  if (!await FS.isDirectory(root) || await FS.isSymbolicLink(root)) {
    return
  }
  const receiptsRoot = FS.resolvePath('receipts', root)
  if (!await FS.isDirectory(receiptsRoot) || await FS.isSymbolicLink(receiptsRoot)) {
    return
  }
  const dead: { logPath: string; receiptPath: string; startedAtMs: number; status: Receipt['status'] }[] = []
  for (const name of await FS.listDir(receiptsRoot)) {
    if (!name.endsWith('.json') || !RUN_ID.test(name.slice(0, -5))) {
      continue
    }
    const receiptPath = FS.resolvePath(name, receiptsRoot)
    if (await FS.isSymbolicLink(receiptPath)) {
      continue
    }
    const runId = name.slice(0, -5)
    const receipt = validReceipt(await FS.readJson(receiptPath).catch(() => undefined), runId)
    if (receipt === undefined) {
      continue
    }
    const logPath = FS.resolvePath(`${runId}.log`, root)
    if (await FS.isSymbolicLink(logPath)) {
      continue
    }
    if (
      receipt.emulatorPid !== undefined
      && processIsStillOwned(receipt.emulatorPid, receipt.emulatorStartedAt, dependencies)
    ) {
      continue
    }
    if (
      receipt.emulatorPid === undefined
      && (processIsStillOwned(receipt.ownerPid, receipt.ownerStartedAt, dependencies)
        || mayHaveUnrecordedEmulator)
    ) {
      continue
    }
    dead.push({ logPath, receiptPath, startedAtMs: receipt.startedAtMs, status: receipt.status })
  }
  dead.sort((left, right) => right.startedAtMs - left.startedAtMs)
  let retained = 0
  let retainedBytes = 0
  for (const run of dead) {
    const sizeBytes = await FS.byteSize(run.logPath).catch(() => 0)
    if (
      run.status !== 'booted'
      && dependencies.now() - run.startedAtMs <= MAX_DEAD_AGE_MS
      && retained < MAX_DEAD_LOGS
      && retainedBytes + sizeBytes <= MAX_DEAD_BYTES
    ) {
      retained += 1
      retainedBytes += sizeBytes
      continue
    }
    await FS.remove(run.logPath)
    await FS.remove(run.receiptPath)
  }
}

function receiptPath(log: EmulatorLog): string {
  return FS.resolvePath(`receipts/${log.receipt.runId}.json`, log.root)
}

function processIsStillOwned(pid: number, startedAt: string | undefined, dependencies: Dependencies): boolean {
  const current = dependencies.identityOf(pid)
  if (current !== undefined) {
    return startedAt === undefined || current.startedAt === startedAt
  }
  // An unavailable identity is uncertain. Preserve an apparently live process's log.
  return dependencies.isAlive(pid)
}

async function publishReceipt(root: string, receipt: Receipt): Promise<void> {
  const path = FS.resolvePath(`receipts/${receipt.runId}.json`, root)
  const staged = `${path}.${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(staged, receipt)
    await FS.move(staged, path)
  } finally {
    await FS.remove(staged)
  }
}

function validReceipt(value: unknown, runId: string): Receipt | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const receipt = value as Record<string, unknown>
  return receipt['version'] === 1
      && receipt['runId'] === runId
      && typeof receipt['ownerPid'] === 'number'
      && (receipt['ownerStartedAt'] === undefined || typeof receipt['ownerStartedAt'] === 'string')
      && typeof receipt['startedAtMs'] === 'number'
      && Number.isFinite(receipt['startedAtMs'])
      && (receipt['status'] === 'starting' || receipt['status'] === 'booted'
        || receipt['status'] === 'failed' || receipt['status'] === 'timed-out')
      && (receipt['emulatorPid'] === undefined || typeof receipt['emulatorPid'] === 'number')
      && (receipt['emulatorStartedAt'] === undefined || typeof receipt['emulatorStartedAt'] === 'string')
    ? value as Receipt
    : undefined
}

export const EmulatorLogs = { begin, finish, prune, recordChild }
