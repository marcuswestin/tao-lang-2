import { FS, Platform, Repo } from '@shared'
import { hostArtifactDate } from './environment/HostArtifactClock'

/** A run owns its UUID directory until it finishes or its process is demonstrably gone. */
type RunReceipt = {
  finishedAt?: string
  mode: string
  pid: number
  runId: string
  sizeBytes?: number
  startedAt: string
  status: 'running' | 'passed' | 'failed'
  version: 1
}

type ArtifactDependencies = {
  isAlive: (pid: number) => boolean
  now: () => Date
  pid: number
}

type RetainedRun = { path: string; receipt: RunReceipt; sizeBytes: number; timeMs: number }

const defaultDependencies: ArtifactDependencies = {
  isAlive: Platform.processIsAlive,
  now: hostArtifactDate,
  pid: Platform.runtimeProcess.pid,
}
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECEIPT_FILE = 'run.json'
const RECEIPT_DIRECTORY = 'receipts'
const STALE_RUNNING_GRACE_MS = 6 * 60 * 60 * 1_000
const MAX_FINISHED_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_RECEIPT_AGE_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_RETAINED_BYTES = 4 * 1024 * 1024 * 1024
const MAX_FAILURES = 2
const MAX_SUCCESSES = 1
const MAX_OUTPUTS = 2

function artifactStore(): string {
  return Repo.resolvePath('.artifacts/host-testing')
}

/** begin records ownership before creating the run directory, so interrupted setup is reclaimable. */
async function begin(
  runId: string,
  mode: string,
  root = artifactStore(),
  dependencies = defaultDependencies,
): Promise<void> {
  const receipt: RunReceipt = {
    mode,
    pid: dependencies.pid,
    runId,
    startedAt: dependencies.now().toISOString(),
    status: 'running',
    version: 1,
  }
  await publishReceipt(root, receipt)
}

/** finish records the result; a compact receipt outlives any bulky artifacts retention removes. */
async function finish(
  runId: string,
  status: 'passed' | 'failed',
  root = artifactStore(),
  dependencies = defaultDependencies,
): Promise<void> {
  const receipt = await readReceipt(FS.resolvePath(runId, root), runId)
  if (receipt === undefined) {
    return
  }
  const runRoot = FS.resolvePath(runId, root)
  if (status === 'passed' && !isRequestedOutput(receipt.mode)) {
    await compactRunBuilds(runRoot, false)
  }
  const sizeBytes = await runSize(runRoot)
  await publishReceipt(root, { ...receipt, finishedAt: dependencies.now().toISOString(), sizeBytes, status })
}

/** prepare and export deliberately return an inspectable generated artifact. */
function isRequestedOutput(mode: string): boolean {
  return mode === 'prepare' || mode === 'export'
}

/** Generated projects and driver builds are disposable; failure screenshots and traces are not. */
async function compactRunBuilds(runRoot: string, preserveFailureEvidence: boolean): Promise<void> {
  for (const name of await FS.listDir(runRoot)) {
    const generated = name.startsWith('host-') || name.startsWith('web-') || name === 'appium-home'
    const path = FS.resolvePath(name, runRoot)
    if ((generated || (!preserveFailureEvidence && name === 'results')) && await FS.isDirectory(path)) {
      await FS.remove(path)
    }
  }
  // Only the driver's Xcode build output is disposable inside appium; logs, screenshots, and
  // session receipts are siblings. Never traverse a substituted parent symlink during cleanup.
  const appiumRoot = FS.resolvePath('appium', runRoot)
  if (!await FS.isSymbolicLink(appiumRoot)) {
    await FS.remove(FS.resolvePath('xcode', appiumRoot))
  }
}

async function publishReceipt(root: string, receipt: RunReceipt): Promise<void> {
  for (
    const path of [
      FS.resolvePath(`${RECEIPT_DIRECTORY}/${receipt.runId}.json`, root),
      FS.resolvePath(`${receipt.runId}/${RECEIPT_FILE}`, root),
    ]
  ) {
    const staged = `${path}.${Platform.randomUUID()}.tmp`
    try {
      await FS.writeJson(staged, receipt)
      await FS.move(staged, path)
    } finally {
      await FS.remove(staged)
    }
  }
}

/** prune runs on every normal invocation and completion; it never crosses this checkout's store. */
async function prune(root = artifactStore(), dependencies = defaultDependencies): Promise<void> {
  if (!await FS.isDirectory(root)) {
    return
  }
  const now = dependencies.now().getTime()
  const eligible: RetainedRun[] = []
  for (const name of await FS.listDir(root)) {
    if (!RUN_ID.test(name)) {
      continue
    }
    const path = FS.resolvePath(name, root)
    if (await FS.isSymbolicLink(path) || !await FS.isDirectory(path)) {
      continue
    }
    // Old unmarked roots lack a trustworthy owner. Preserve them for owner-reviewed migration.
    const receipt = await readReceipt(path, name)
    if (receipt === undefined) {
      continue
    }
    const startedMs = Date.parse(receipt.startedAt)
    const finishedMs = receipt.finishedAt === undefined ? undefined : Date.parse(receipt.finishedAt)
    if (!Number.isFinite(startedMs) || (finishedMs !== undefined && !Number.isFinite(finishedMs))) {
      continue
    }
    if (receipt.status === 'running') {
      if (dependencies.isAlive(receipt.pid) || now - startedMs < STALE_RUNNING_GRACE_MS) {
        continue
      }
    }
    const sizeBytes = receipt.sizeBytes ?? await runSize(path)
    eligible.push({ path, receipt, sizeBytes, timeMs: finishedMs ?? startedMs })
  }
  // Failure evidence gets first claim on the finite budget; each class retains its newest runs.
  eligible.sort((left, right) =>
    Number(right.receipt.status !== 'passed') - Number(left.receipt.status !== 'passed')
    || right.timeMs - left.timeMs
  )
  let bytes = 0
  let failures = 0
  let successes = 0
  let outputs = 0
  for (const run of eligible) {
    const failed = run.receipt.status !== 'passed'
    const output = isRequestedOutput(run.receipt.mode)
    const withinCount = failed ? failures < MAX_FAILURES : output ? outputs < MAX_OUTPUTS : successes < MAX_SUCCESSES
    const withinAge = now - run.timeMs <= MAX_FINISHED_AGE_MS
    if (failed && withinCount && withinAge && bytes + run.sizeBytes > MAX_RETAINED_BYTES) {
      // A native build can exceed the entire store budget by itself. Reclaim its generated
      // inputs first so the failed journey's screenshot and proof are still available.
      await compactRunBuilds(run.path, true)
      run.sizeBytes = await runSize(run.path)
      run.receipt = { ...run.receipt, sizeBytes: run.sizeBytes }
      await publishReceipt(root, run.receipt)
    }
    const withinBudget = bytes + run.sizeBytes <= MAX_RETAINED_BYTES
    if (withinCount && withinBudget && withinAge) {
      bytes += run.sizeBytes
      if (failed) {
        failures += 1
      } else if (output) {
        outputs += 1
      } else {
        successes += 1
      }
      continue
    }
    await FS.remove(run.path)
  }
  const receiptsRoot = FS.resolvePath(RECEIPT_DIRECTORY, root)
  if (!await FS.isDirectory(receiptsRoot)) {
    return
  }
  for (const name of await FS.listDir(receiptsRoot)) {
    if (!RUN_ID.test(name.replace(/\.json$/, '')) || !name.endsWith('.json')) {
      continue
    }
    const path = FS.resolvePath(name, receiptsRoot)
    if (await FS.isSymbolicLink(path)) {
      continue
    }
    if (now - await FS.modifiedTimeMs(path) > MAX_RECEIPT_AGE_MS) {
      await FS.remove(path)
    }
  }
}

async function readReceipt(path: string, runId: string): Promise<RunReceipt | undefined> {
  // The sidecar is published first. A killed process can leave a run root before its local copy.
  for (
    const receiptPath of [
      FS.resolvePath(`${RECEIPT_DIRECTORY}/${runId}.json`, FS.dirname(path)),
      FS.resolvePath(RECEIPT_FILE, path),
    ]
  ) {
    const value: unknown = await FS.readJson(receiptPath).catch(() => undefined)
    const receipt = validReceipt(value, runId)
    if (receipt !== undefined) {
      return receipt
    }
  }
  return undefined
}

function validReceipt(value: unknown, runId: string): RunReceipt | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  return record['version'] === 1
      && record['runId'] === runId
      && typeof record['mode'] === 'string'
      && typeof record['pid'] === 'number'
      && typeof record['startedAt'] === 'string'
      && (record['sizeBytes'] === undefined || (typeof record['sizeBytes'] === 'number' && record['sizeBytes'] >= 0))
      && (record['finishedAt'] === undefined || typeof record['finishedAt'] === 'string')
      && (record['status'] === 'running' || record['status'] === 'passed' || record['status'] === 'failed')
    ? value as RunReceipt
    : undefined
}

async function runSize(root: string): Promise<number> {
  let bytes = 0
  for await (const path of FS.walk(root, { includeHidden: true })) {
    if (!await FS.isSymbolicLink(path)) {
      bytes += await FS.byteSize(path).catch(() => 0)
    }
  }
  return bytes
}

export const HostTestingArtifacts = { begin, finish, prune }
