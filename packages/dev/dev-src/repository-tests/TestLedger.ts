import { Errors, FS, Json, Repo, Time } from '@shared'
import { createHash, randomUUID } from 'node:crypto'
import { MachineLanes, type MachineResourceLease } from './MachineLanes'

/** TestOutcome is the result a native test reporter recorded for one test. */
export type TestOutcome = 'failed' | 'passed' | 'skipped'

/** TestObservation is the runner-neutral fact ingested from Bun, Jest, or the Tao Apps suite. */
export type TestObservation = {
  durationMs?: number
  file: string
  name: string
  outcome: TestOutcome
  suite: string
}

/** TestLedgerRecord is the latest durable state for one named test. */
export type TestLedgerRecord = TestObservation & {
  fileIdentity: string
  id: string
  lastFailedAt?: string
  lastPassedAt?: string
  lastRunAt: string
}

/** TestLedgerStore is deliberately versioned because `.artifacts` may survive many branch changes. */
export type TestLedgerStore = {
  lastFullRunStartedAt?: string
  tests: Record<string, TestLedgerRecord>
  version: 1
}

/** TestHistoryEvent is one chronological outcome used to identify outcome reversals. */
export type TestHistoryEvent = TestLedgerRecord & { recordedAt: string; version: 1 }

export type RecordTestRunOptions = {
  /** True only for a complete, unfiltered, non-interrupted `just test` invocation. */
  fullRun: boolean
  observations: readonly TestObservation[]
  /** Synthetic files whose observations cover only part of their durable inventory. */
  partialFiles?: readonly string[]
  repositoryRoot?: string
  startedAt: number
}

export type TestFile = {
  /** Repository-relative file, or `Apps` for the synthetic Tao Apps unit. */
  file: string
  suite: string
}

export type RetrySelection = {
  files: readonly TestFile[]
  greenTestCount: number
  lastFullRunStartedAt?: string
}

export type Flake = {
  /** Failures at the end of the window with nothing but failures after them. */
  consecutiveFailures: number
  file: string
  /** The file identity every counted reversal was observed at; the latest event's. */
  fileIdentity: string
  id: string
  name: string
  /** How many events of this test the window held, so thin evidence is visible as thin. */
  observed: number
  reversals: number
  suite: string
}

/** ToleratedFlake is a flake the thresholds below say may stop failing a lane, and why. */
export type ToleratedFlake = Flake & {
  /** One line naming what demoted this test, for the run summary that must say so out loud. */
  evidence: string
}

/**
 * How much evidence it takes before a test's failure stops failing a lane, and what takes it back.
 *
 * The window is the last `FLAKE_WINDOW_EVENTS` recorded outcomes of that test, which is also what
 * history compaction retains per test: the window is exactly the evidence that survives, rather
 * than a second number that can disagree with it.
 *
 * Two reversals, not one. One reversal is `passed` then `failed` — which is precisely what a real
 * regression looks like before anyone fixes it, and tolerating it would hide the regression this
 * whole mechanism exists not to hide. Two reversals means the test has gone pass → fail → pass (or
 * fail → pass → fail) with no change to its own file: it has already contradicted itself, which is
 * what non-determinism is and what a broken test never does.
 *
 * Tolerance is then withdrawn as soon as the test stops flipping and starts simply failing.
 * `FLAKE_MAX_CONSECUTIVE_FAILURES` trailing failures in the window plus the failure being judged
 * now is three consecutive failures, and no flake history however long survives that.
 *
 * Every count is at one file identity. `reversals` is only incremented between adjacent events that
 * agree on `fileIdentity`, and `tolerated` additionally requires that identity to be what the file
 * hashes to now — so editing a flaky test drops its reputation with it, and the next run judges the
 * new file on its own outcomes.
 *
 * The three numbers live with the other durable-state constants below.
 */

const LEDGER_PATH = '.artifacts/testing/ledger.json'
const HISTORY_PATH = '.artifacts/testing/history.jsonl'
const HISTORY_MAX_BYTES = 4_000_000
const HISTORY_TARGET_BYTES = 3_000_000
const HISTORY_EVENTS_PER_TEST = 20
const HISTORY_MIN_EVENTS_PER_TEST = 2
/** The three flake-tolerance thresholds; `ToleratedFlake` above says why each is what it is. */
const FLAKE_WINDOW_EVENTS = HISTORY_EVENTS_PER_TEST
const FLAKE_MIN_REVERSALS = 2
const FLAKE_MAX_CONSECUTIVE_FAILURES = 2
const LEDGER_LOCK_TIMEOUT_MS = 30_000
const VERSION = 1 as const

function empty(): TestLedgerStore {
  return { tests: {}, version: VERSION }
}

function ledgerPath(repositoryRoot: string): string {
  return FS.resolvePath(LEDGER_PATH, repositoryRoot)
}

function historyPath(repositoryRoot: string): string {
  return FS.resolvePath(HISTORY_PATH, repositoryRoot)
}

/** load treats missing, corrupt, and older stores as a cold checkout rather than blocking testing. */
async function load(repositoryRoot = Repo.getRoot()): Promise<TestLedgerStore> {
  try {
    const value = await FS.readJson<unknown>(ledgerPath(repositoryRoot))
    return isLedgerStore(value) ? value : empty()
  } catch {
    return empty()
  }
}

/** recordRun merges native reporter observations and appends their immutable history events. */
async function recordRun(options: RecordTestRunOptions): Promise<TestLedgerStore> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const lease = await acquireLedgerLease(repositoryRoot)
  try {
    return await recordRunUnlocked(options, repositoryRoot)
  } finally {
    await lease.release()
  }
}

async function recordRunUnlocked(
  options: RecordTestRunOptions,
  repositoryRoot: string,
): Promise<TestLedgerStore> {
  const store = await load(repositoryRoot)
  const previousTests = { ...store.tests }
  const recordedAt = new Date().toISOString()
  const identities = await identitiesFor(options.observations.map(observation => observation.file), repositoryRoot)
  const events: TestHistoryEvent[] = []

  // A native report is the complete current inventory for every file it names. Remove records for
  // tests deleted or renamed in that file before adding its current observations; otherwise one
  // deleted failure would make `test-retry` select the file forever.
  const partialFiles = new Set(options.partialFiles ?? [])
  const observedFiles = new Set(
    options.observations
      .filter(observation => !partialFiles.has(observation.file))
      .map(observation => `${observation.suite}\0${observation.file}`),
  )
  for (const [id, record] of Object.entries(store.tests)) {
    if (observedFiles.has(`${record.suite}\0${record.file}`)) {
      delete store.tests[id]
    }
  }

  for (const observation of options.observations) {
    const id = testId(observation)
    const previous = previousTests[id]
    const record: TestLedgerRecord = {
      ...observation,
      durationMs: rollingDuration(previous?.durationMs, observation.durationMs),
      fileIdentity: identities.get(observation.file) ?? missingIdentity(observation.file),
      id,
      lastFailedAt: observation.outcome === 'failed' ? recordedAt : previous?.lastFailedAt,
      lastPassedAt: observation.outcome === 'passed' ? recordedAt : previous?.lastPassedAt,
      lastRunAt: recordedAt,
    }
    store.tests[id] = record
    events.push({ ...record, recordedAt, version: VERSION })
  }

  if (options.fullRun) {
    store.lastFullRunStartedAt = new Date(options.startedAt).toISOString()
  }
  await writeStore(store, repositoryRoot)
  await appendHistory(events, repositoryRoot)
  return store
}

async function acquireLedgerLease(repositoryRoot: string): Promise<MachineResourceLease> {
  const registryRoot = FS.resolvePath('.artifacts/testing/transaction-lock', repositoryRoot)
  const lease = await Time.pollUntil(
    () => MachineLanes.tryAcquireResource({ name: 'test-ledger', registryRoot }),
    { intervalMs: 25, timeoutMs: LEDGER_LOCK_TIMEOUT_MS },
  )
  if (lease !== undefined) {
    return lease
  }
  Errors.throwHostEnvironment('Timed out waiting for another test command to finish updating the ledger.')
}

/** selectRetryFiles selects whole files while settlement remains a per-test fact. */
async function selectRetryFiles(
  files: readonly TestFile[],
  repositoryRoot = Repo.getRoot(),
  store?: TestLedgerStore,
): Promise<RetrySelection> {
  const ledger = store ?? await load(repositoryRoot)
  const identities = await identitiesFor(files.map(file => file.file), repositoryRoot)
  const selected: TestFile[] = []
  let greenTestCount = 0

  for (const file of files) {
    const records = Object.values(ledger.tests).filter(record =>
      record.suite === file.suite && record.file === file.file
    )
    const currentIdentity = identities.get(file.file) ?? missingIdentity(file.file)
    if (
      records.length === 0
      || records.some(record =>
        record.fileIdentity !== currentIdentity || !isSettled(record, ledger.lastFullRunStartedAt)
      )
    ) {
      selected.push(file)
    } else {
      greenTestCount += records.length
    }
  }
  return { files: selected, greenTestCount, lastFullRunStartedAt: ledger.lastFullRunStartedAt }
}

/** flakes reports pass/fail reversals where the test file itself did not change. */
async function flakes(repositoryRoot = Repo.getRoot(), limit = 20): Promise<Flake[]> {
  const events = await readHistory(repositoryRoot)
  const byTest = new Map<string, TestHistoryEvent[]>()
  for (const event of events) {
    const entries = byTest.get(event.id) ?? []
    entries.push(event)
    byTest.set(event.id, entries)
  }
  return [...byTest.entries()]
    .map(([id, entries]) => flakeOf(id, entries.slice(-FLAKE_WINDOW_EVENTS)))
    .filter(flake => flake.reversals > 0)
    .sort((left, right) => right.reversals - left.reversals || left.id.localeCompare(right.id))
    .slice(0, positiveLimit(limit))
}

/** flakeOf measures one test's window: how often it contradicted itself, and how it ends. */
function flakeOf(id: string, window: readonly TestHistoryEvent[]): Flake {
  let reversals = 0
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1]!
    const current = window[index]!
    if (
      previous.fileIdentity === current.fileIdentity
      && previous.outcome !== 'skipped'
      && current.outcome !== 'skipped'
      && previous.outcome !== current.outcome
    ) {
      reversals += 1
    }
  }
  let consecutiveFailures = 0
  for (let index = window.length - 1; index >= 0 && window[index]!.outcome === 'failed'; index -= 1) {
    consecutiveFailures += 1
  }
  const latest = window.at(-1)!
  return {
    consecutiveFailures,
    file: latest.file,
    fileIdentity: latest.fileIdentity,
    id,
    name: latest.name,
    observed: window.length,
    reversals,
    suite: latest.suite,
  }
}

/**
 * tolerated names the tests the recorded history says are non-deterministic rather than broken, so
 * a lane may decline to fail on them. It is deliberately a ledger question and not a runner one:
 * the only thing that earns tolerance is what this checkout has actually observed.
 */
async function tolerated(repositoryRoot = Repo.getRoot()): Promise<ToleratedFlake[]> {
  const candidates = (await flakes(repositoryRoot, Number.MAX_SAFE_INTEGER))
    .filter(flake =>
      flake.reversals >= FLAKE_MIN_REVERSALS && flake.consecutiveFailures < FLAKE_MAX_CONSECUTIVE_FAILURES
    )
  if (candidates.length === 0) {
    return []
  }
  // The evidence is about a file's bytes. If the file has changed since, the new file has no
  // reputation and its failures are judged on their own.
  const identities = await identitiesFor(candidates.map(candidate => candidate.file), repositoryRoot)
  return candidates
    .filter(candidate => identities.get(candidate.file) === candidate.fileIdentity)
    .map(candidate => ({ ...candidate, evidence: describeFlake(candidate) }))
}

/** describeFlake is the one line a run summary prints beside a test it declined to fail on. */
function describeFlake(flake: Flake): string {
  return `${flake.reversals} outcome reversal${flake.reversals === 1 ? '' : 's'} in the last `
    + `${flake.observed} recorded run${flake.observed === 1 ? '' : 's'} with no change to ${flake.file}`
}

/** slowest reports the current rolling duration rather than one potentially noisy sample. */
async function slowest(repositoryRoot = Repo.getRoot(), limit = 20): Promise<TestLedgerRecord[]> {
  return Object.values((await load(repositoryRoot)).tests)
    .filter(record => record.durationMs !== undefined)
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0) || left.id.localeCompare(right.id))
    .slice(0, positiveLimit(limit))
}

function isSettled(record: TestLedgerRecord, fullRunStartedAt: string | undefined): boolean {
  if (fullRunStartedAt === undefined || record.lastPassedAt === undefined) {
    return false
  }
  const passedAt = Date.parse(record.lastPassedAt)
  return passedAt >= Date.parse(fullRunStartedAt)
    && passedAt > (record.lastFailedAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(record.lastFailedAt))
}

function testId(observation: Pick<TestObservation, 'file' | 'name' | 'suite'>): string {
  return `${observation.suite}::${observation.file}::${observation.name}`
}

function rollingDuration(previous: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) {
    return previous
  }
  return previous === undefined ? next : Math.round((previous * 3 + next) / 4 * 100) / 100
}

async function identitiesFor(files: readonly string[], repositoryRoot: string): Promise<Map<string, string>> {
  const identities = new Map<string, string>()
  await Promise.all([...new Set(files)].map(async file => {
    if (file === 'Apps') {
      const taoFiles = (await Repo.filesUnder(FS.resolvePath('Apps', repositoryRoot), { extensions: ['.tao'] })).sort()
      const contents = await Promise.all(
        taoFiles.map(async path => `${FS.relativePath(repositoryRoot, path)}\0${await FS.readText(path)}`),
      )
      identities.set(file, contentIdentity(contents.join('\0')))
      return
    }
    const path = FS.resolvePath(file, repositoryRoot)
    try {
      identities.set(file, contentIdentity(await FS.readText(path)))
    } catch {
      identities.set(file, missingIdentity(file))
    }
  }))
  return identities
}

function contentIdentity(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function missingIdentity(file: string): string {
  return `missing:${file}`
}

async function writeStore(store: TestLedgerStore, repositoryRoot: string): Promise<void> {
  const path = ledgerPath(repositoryRoot)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await FS.writeJson(temporaryPath, store)
  try {
    await FS.move(temporaryPath, path)
  } catch (error) {
    await FS.remove(temporaryPath).catch(() => {})
    throw error
  }
}

async function appendHistory(events: readonly TestHistoryEvent[], repositoryRoot: string): Promise<void> {
  if (events.length === 0) {
    return
  }
  const handle = await FS.openAppend(historyPath(repositoryRoot))
  try {
    await handle.writeFile(events.map(event => `${JSON.stringify(event)}\n`).join(''))
  } finally {
    await handle.close()
  }
  await compactHistoryIfNeeded(repositoryRoot)
}

async function readHistory(repositoryRoot: string): Promise<TestHistoryEvent[]> {
  try {
    return parseHistory(await FS.readText(historyPath(repositoryRoot)))
  } catch {
    return []
  }
}

async function compactHistoryIfNeeded(repositoryRoot: string): Promise<void> {
  const path = historyPath(repositoryRoot)
  let source: Uint8Array
  try {
    source = await FS.readFile(path)
  } catch {
    return
  }
  if (source.byteLength <= HISTORY_MAX_BYTES) {
    return
  }
  const events = parseHistory(new TextDecoder().decode(source))
  const retainedPerTest = new Map<string, number>()
  const candidateIndexes: number[] = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    const retained = retainedPerTest.get(event.id) ?? 0
    if (retained >= HISTORY_EVENTS_PER_TEST) {
      continue
    }
    retainedPerTest.set(event.id, retained + 1)
    candidateIndexes.push(index)
  }
  const byTest = new Map<string, number[]>()
  for (const index of candidateIndexes) {
    const indexes = byTest.get(events[index]!.id) ?? []
    indexes.push(index)
    byTest.set(events[index]!.id, indexes)
  }
  const retainedIndexes = new Set<number>()
  for (const indexes of byTest.values()) {
    for (const index of indexes.slice(0, HISTORY_MIN_EVENTS_PER_TEST)) {
      retainedIndexes.add(index)
    }
  }
  let retainedBytes = [...retainedIndexes].reduce(
    (sum, index) => sum + encodedHistoryEventSize(events[index]!),
    0,
  )
  for (const index of candidateIndexes) {
    if (retainedIndexes.has(index)) {
      continue
    }
    const line = `${JSON.stringify(events[index]!)}\n`
    const bytes = new TextEncoder().encode(line).byteLength
    if (retainedBytes + bytes <= HISTORY_TARGET_BYTES) {
      retainedIndexes.add(index)
      retainedBytes += bytes
    }
  }
  const retainedLines = [...retainedIndexes]
    .sort((left, right) => left - right)
    .map(index => `${JSON.stringify(events[index]!)}\n`)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await FS.writeText(temporaryPath, retainedLines.join(''))
  try {
    await FS.move(temporaryPath, path)
  } catch (error) {
    await FS.remove(temporaryPath).catch(() => {})
    throw error
  }
}

function encodedHistoryEventSize(event: TestHistoryEvent): number {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`).byteLength
}

function parseHistory(source: string): TestHistoryEvent[] {
  return source
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        const value = JSON.parse(line) as unknown
        return isHistoryEvent(value) ? [value] : []
      } catch {
        return []
      }
    })
}

function positiveLimit(limit: number): number {
  return Number.isInteger(limit) && limit > 0 ? limit : 20
}

function isLedgerStore(value: unknown): value is TestLedgerStore {
  if (!Json.isRecord(value) || value['version'] !== VERSION || !Json.isRecord(value['tests'])) {
    return false
  }
  if (value['lastFullRunStartedAt'] !== undefined && !isTimestamp(value['lastFullRunStartedAt'])) {
    return false
  }
  return Object.entries(value['tests']).every(([id, record]) => isLedgerRecord(record) && record.id === id)
}

function isLedgerRecord(value: unknown): value is TestLedgerRecord {
  if (!Json.isRecord(value)) {
    return false
  }
  return typeof value['id'] === 'string'
    && typeof value['suite'] === 'string'
    && typeof value['file'] === 'string'
    && typeof value['name'] === 'string'
    && typeof value['fileIdentity'] === 'string'
    && (value['outcome'] === 'failed' || value['outcome'] === 'passed' || value['outcome'] === 'skipped')
    && (value['durationMs'] === undefined
      || typeof value['durationMs'] === 'number' && Number.isFinite(value['durationMs']) && value['durationMs'] >= 0)
    && isTimestamp(value['lastRunAt'])
    && (value['lastFailedAt'] === undefined || isTimestamp(value['lastFailedAt']))
    && (value['lastPassedAt'] === undefined || isTimestamp(value['lastPassedAt']))
}

function isHistoryEvent(value: unknown): value is TestHistoryEvent {
  return Json.isRecord(value)
    && value['version'] === VERSION
    && isTimestamp(value['recordedAt'])
    && isLedgerRecord(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/** TestLedger owns durable per-test state, retry selection, and history-backed reports. */
export const TestLedger = {
  FLAKE_MAX_CONSECUTIVE_FAILURES,
  FLAKE_MIN_REVERSALS,
  FLAKE_WINDOW_EVENTS,
  HISTORY_PATH,
  LEDGER_PATH,
  VERSION,
  empty,
  flakes,
  load,
  recordRun,
  selectRetryFiles,
  slowest,
  testId,
  tolerated,
} as const
