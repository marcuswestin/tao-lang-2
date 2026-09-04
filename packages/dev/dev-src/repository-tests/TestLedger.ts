import { FS, Repo } from '@shared'
import { createHash, randomUUID } from 'node:crypto'

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

/** TestHistoryEvent is one append-only outcome used to identify outcome reversals. */
export type TestHistoryEvent = TestLedgerRecord & { recordedAt: string; version: 1 }

export type RecordTestRunOptions = {
  /** True only for a complete, unfiltered, non-interrupted `just test` invocation. */
  fullRun: boolean
  observations: readonly TestObservation[]
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
  file: string
  id: string
  name: string
  reversals: number
  suite: string
}

const LEDGER_PATH = '.artifacts/testing/ledger.json'
const HISTORY_PATH = '.artifacts/testing/history.jsonl'
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
    const value = await FS.readJson<Partial<TestLedgerStore>>(ledgerPath(repositoryRoot))
    if (value.version !== VERSION || value.tests === undefined || typeof value.tests !== 'object') {
      return empty()
    }
    return { lastFullRunStartedAt: value.lastFullRunStartedAt, tests: value.tests, version: VERSION }
  } catch {
    return empty()
  }
}

/** recordRun merges native reporter observations and appends their immutable history events. */
async function recordRun(options: RecordTestRunOptions): Promise<TestLedgerStore> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const store = await load(repositoryRoot)
  const previousTests = { ...store.tests }
  const recordedAt = new Date().toISOString()
  const identities = await identitiesFor(options.observations.map(observation => observation.file), repositoryRoot)
  const events: TestHistoryEvent[] = []

  // A native report is the complete current inventory for every file it names. Remove records for
  // tests deleted or renamed in that file before adding its current observations; otherwise one
  // deleted failure would make `test-retry` select the file forever.
  const observedFiles = new Set(options.observations.map(observation => `${observation.suite}\0${observation.file}`))
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
    .map(([id, entries]) => {
      let reversals = 0
      for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1]!
        const current = entries[index]!
        if (
          previous.fileIdentity === current.fileIdentity
          && previous.outcome !== 'skipped'
          && current.outcome !== 'skipped'
          && previous.outcome !== current.outcome
        ) {
          reversals += 1
        }
      }
      const latest = entries.at(-1)!
      return { file: latest.file, id, name: latest.name, reversals, suite: latest.suite }
    })
    .filter(flake => flake.reversals > 0)
    .sort((left, right) => right.reversals - left.reversals || left.id.localeCompare(right.id))
    .slice(0, positiveLimit(limit))
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
  return record.lastPassedAt >= fullRunStartedAt && record.lastPassedAt > (record.lastFailedAt ?? '')
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
}

async function readHistory(repositoryRoot: string): Promise<TestHistoryEvent[]> {
  try {
    return (await FS.readText(historyPath(repositoryRoot)))
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          const value = JSON.parse(line) as Partial<TestHistoryEvent>
          return value.version === VERSION && typeof value.id === 'string' ? [value as TestHistoryEvent] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

function positiveLimit(limit: number): number {
  return Number.isInteger(limit) && limit > 0 ? limit : 20
}

/** TestLedger owns durable per-test state, retry selection, and history-backed reports. */
export const TestLedger = {
  HISTORY_PATH,
  LEDGER_PATH,
  VERSION,
  empty,
  flakes,
  isSettled,
  load,
  recordRun,
  selectRetryFiles,
  slowest,
  testId,
} as const
