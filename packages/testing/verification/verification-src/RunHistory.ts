import { MachineResources } from '@host-control'
import { FS } from '@shared'
import type { ContentionReport } from './MachineLanes'

/**
 * The machine-wide record of how long verification and landing took, kept beside the landing lock
 * and the lane registry rather than in any one checkout.
 *
 * A run's own `summary.json` lives in its worktree's `.artifacts/`, and a reclaimed worktree takes
 * that directory with it. That left the primary checkout's landings as the only durable timing
 * record on the machine, so "how long does a full verification take" had no answer for any run an
 * agent made in its own worktree. Everything here is appended under the registry root, which every
 * worktree shares and none of them owns.
 *
 * Three append-only files, one line per entry:
 *   - `runs.jsonl`: every broad or diff-scoped verification lane, passed or failed, with its reason.
 *   - `landings.jsonl`: every landing transaction, with its phases and its outcome.
 *   - `lanes-<day>.jsonl`: every registered lane's start and end, of any width, which is what lets a
 *     run say exactly which other lanes overlapped it. These are pruned after `LANE_LOG_DAYS`.
 *
 * Recording is telemetry and must never fail the work it describes, so every writer here swallows
 * its own errors and reports only whether it wrote.
 */

/** LaneInterval is one registered lane's lifetime, as the lane log records it. */
export type LaneInterval = {
  endedAt?: string
  id: string
  lane: string
  /**
   * The lane id this one was started under, when a lane registered from inside another lane's node.
   * Such a lane is the outer run's own work, not a neighbour, so overlap never counts it.
   */
  parentLaneId?: string
  pid: number
  repositoryRoot: string
  startedAt: string
}

/**
 * OverlapReport says which other Tao lanes ran at any moment of a run.
 *
 * This is the precise half of what `ContentionReport` approximates. `contended` also trips on load
 * alone, and a broad lane raises the load past that bar by itself, so it cannot say whether anything
 * else ran. `solo` can, for everything that registers a lane: a lane that started and ended between
 * two load samples is still in the lane log. Work that registers no lane — a bare `bun test`, a dev
 * server, a simulator — is invisible here; `loadAverageAtStart` is the only trace of it.
 */
export type OverlapReport = {
  /** False when the registry could not be read, which makes `solo` unknown rather than true. */
  known: boolean
  lanes: readonly LaneInterval[]
  /** The one-minute load average when this lane registered: other work's, not this run's. */
  loadAverageAtStart: number
  solo: boolean
}

/** RunRecord is one verification run, passed or failed, as `runs.jsonl` records it. */
export type RunRecord = {
  contention?: ContentionReport
  elapsedMs: number
  endedAt: string
  /** The first failing node and the first line worth reading from it. */
  failure?: { gate: string; line: string }
  failedGates?: readonly string[]
  gates: { failed: number; passed: number; skipped: number }
  interrupted: boolean
  kind: 'run'
  lane: string
  /** True when this run was a landing's own verification. */
  landing: boolean
  logRoot: string
  overlap?: OverlapReport
  repositoryRoot: string
  /** The critical path, and the time the schedule actually took. */
  schedule?: { makespanMs: number; serialFloorMs: number }
  startedAt: string
  status: 'failed' | 'passed'
}

/** LandingRecord is one landing transaction, as `landings.jsonl` records it. */
export type LandingRecord = {
  branch: string
  elapsedMs: number
  endedAt: string
  kind: 'landing'
  phases?: readonly { endedAt?: string; name: string; startedAt: string }[]
  reason?: string
  repositoryRoot: string
  startedAt: string
  status: 'failed' | 'passed'
}

const HISTORY_DIRECTORY = 'history'
const RUNS_FILE = 'runs.jsonl'
const LANDINGS_FILE = 'landings.jsonl'
const LANE_LOG_PREFIX = 'lanes-'
const LANE_LOG_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_FAILURE_LINE = 300
const MAX_FAILED_GATES = 20

function historyRoot(registryRoot: string): string {
  return FS.resolvePath(HISTORY_DIRECTORY, registryRoot)
}

function laneLogName(day: string): string {
  return `${LANE_LOG_PREFIX}${day}.jsonl`
}

function dayOf(timestamp: string | number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

async function appendLine(path: string, entry: unknown): Promise<boolean> {
  try {
    const file = await FS.openAppend(path)
    try {
      // One write per line: an append of a few hundred bytes lands whole beside other writers.
      await file.write(`${JSON.stringify(entry)}\n`)
    } finally {
      await file.close()
    }
    return true
  } catch {
    return false
  }
}

async function readLines<T>(path: string): Promise<T[]> {
  const text = await FS.readText(path).catch(() => '')
  const entries: T[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }
    try {
      entries.push(JSON.parse(line) as T)
    } catch {
      // A torn line from a crashed writer costs that one entry, not the file.
    }
  }
  return entries
}

/** recordLaneInterval logs a lane's lifetime when it ends, and prunes lane logs past their window. */
async function recordLaneInterval(registryRoot: string, interval: LaneInterval): Promise<boolean> {
  const endedAt = interval.endedAt ?? new Date().toISOString()
  const root = historyRoot(registryRoot)
  const wrote = await appendLine(FS.resolvePath(laneLogName(dayOf(endedAt)), root), { ...interval, endedAt })
  await pruneLaneLogs(root, Date.parse(endedAt)).catch(() => {})
  return wrote
}

async function pruneLaneLogs(root: string, nowMs: number): Promise<void> {
  const oldest = dayOf(nowMs - LANE_LOG_DAYS * DAY_MS)
  for (const entry of await FS.listDir(root)) {
    if (entry.startsWith(LANE_LOG_PREFIX) && entry.slice(LANE_LOG_PREFIX.length, -'.jsonl'.length) < oldest) {
      await FS.remove(FS.resolvePath(entry, root))
    }
  }
}

/**
 * overlap finds every other lane whose lifetime intersected `own`'s: lanes that ended (from the lane
 * log), lanes still running, and lanes the run saw while sampling, which covers one that crashed
 * before it could log its end.
 */
async function overlap(options: {
  live: readonly LaneInterval[]
  loadAverageAtStart: number
  own: { endedAt: string; id: string; startedAt: string }
  registryRoot: string
  seen: readonly LaneInterval[]
}): Promise<OverlapReport> {
  const { own } = options
  const startMs = Date.parse(own.startedAt)
  const endMs = Date.parse(own.endedAt)
  let known = true
  const logged: LaneInterval[] = []
  const root = historyRoot(options.registryRoot)
  for (let day = dayOf(startMs); day <= dayOf(endMs); day = dayOf(Date.parse(day) + DAY_MS)) {
    const path = FS.resolvePath(laneLogName(day), root)
    if (!(await FS.exists(path))) {
      continue
    }
    try {
      logged.push(...await readLines<LaneInterval>(path))
    } catch {
      known = false
    }
  }
  const byId = new Map<string, LaneInterval>()
  for (const candidate of [...options.seen, ...options.live, ...logged]) {
    if (candidate.id === own.id || candidate.parentLaneId === own.id) {
      continue
    }
    const candidateStart = Date.parse(candidate.startedAt)
    const candidateEnd = candidate.endedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(candidate.endedAt)
    if (!(candidateStart < endMs && candidateEnd > startMs)) {
      continue
    }
    // The logged entry carries the end time, so it replaces a sampled or live sighting of the lane.
    const existing = byId.get(candidate.id)
    if (existing === undefined || (existing.endedAt === undefined && candidate.endedAt !== undefined)) {
      byId.set(candidate.id, candidate)
    }
  }
  const lanes = [...byId.values()].toSorted((left, right) => left.startedAt.localeCompare(right.startedAt))
  return {
    known,
    lanes,
    loadAverageAtStart: Math.round(options.loadAverageAtStart * 10) / 10,
    solo: known && lanes.length === 0,
  }
}

/** unknownOverlap is the honest report for a lane that could not use the registry. */
function unknownOverlap(loadAverageAtStart: number): OverlapReport {
  return { known: false, lanes: [], loadAverageAtStart: Math.round(loadAverageAtStart * 10) / 10, solo: false }
}

/** firstLine picks the line of a failure's output a reader would act on, trimmed to one line. */
function firstLine(output: string): string {
  const lines = output.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const line = lines.find(candidate => /error|fail|expected|refus/i.test(candidate)) ?? lines[0] ?? ''
  return line.length > MAX_FAILURE_LINE ? `${line.slice(0, MAX_FAILURE_LINE - 1)}…` : line
}

/** runRecord condenses a finished lane's summary into the line `runs.jsonl` keeps. */
function runRecord(options: {
  contention?: ContentionReport
  elapsedMs: number
  firstFailure?: { name: string; output: string }
  gates: readonly { name: string; status: 'failed' | 'passed' | 'skipped' }[]
  interrupted: boolean
  lane: string
  landing: boolean
  logRoot: string
  overlap?: OverlapReport
  repositoryRoot: string
  schedule?: { makespanMs: number; serialFloorMs: number }
  startedAtMs: number
  status: 'failed' | 'passed'
}): RunRecord {
  const failed = options.gates.filter(gate => gate.status === 'failed').map(gate => gate.name)
  return {
    ...(options.contention === undefined ? {} : { contention: options.contention }),
    elapsedMs: Math.round(options.elapsedMs),
    endedAt: new Date(options.startedAtMs + options.elapsedMs).toISOString(),
    ...(options.firstFailure === undefined
      ? {}
      : { failure: { gate: options.firstFailure.name, line: firstLine(options.firstFailure.output) } }),
    ...(failed.length === 0 ? {} : { failedGates: failed.slice(0, MAX_FAILED_GATES) }),
    gates: {
      failed: failed.length,
      passed: options.gates.filter(gate => gate.status === 'passed').length,
      skipped: options.gates.filter(gate => gate.status === 'skipped').length,
    },
    interrupted: options.interrupted,
    kind: 'run',
    lane: options.lane,
    landing: options.landing,
    logRoot: options.logRoot,
    ...(options.overlap === undefined ? {} : { overlap: options.overlap }),
    repositoryRoot: options.repositoryRoot,
    ...(options.schedule === undefined
      ? {}
      : { schedule: { makespanMs: options.schedule.makespanMs, serialFloorMs: options.schedule.serialFloorMs } }),
    startedAt: new Date(options.startedAtMs).toISOString(),
    status: options.status,
  }
}

/** recordRun appends one verification run to the machine-wide history. */
async function recordRun(record: RunRecord, registryRoot = MachineResources.registryRoot()): Promise<boolean> {
  return await appendLine(FS.resolvePath(RUNS_FILE, historyRoot(registryRoot)), record)
}

/** recordLanding appends one landing transaction to the machine-wide history. */
async function recordLanding(record: LandingRecord, registryRoot = MachineResources.registryRoot()): Promise<boolean> {
  return await appendLine(FS.resolvePath(LANDINGS_FILE, historyRoot(registryRoot)), record)
}

/** readRuns returns every recorded verification run, oldest first. */
async function readRuns(registryRoot = MachineResources.registryRoot()): Promise<RunRecord[]> {
  return await readLines<RunRecord>(FS.resolvePath(RUNS_FILE, historyRoot(registryRoot)))
}

/** readLandings returns every recorded landing, oldest first. */
async function readLandings(registryRoot = MachineResources.registryRoot()): Promise<LandingRecord[]> {
  return await readLines<LandingRecord>(FS.resolvePath(LANDINGS_FILE, historyRoot(registryRoot)))
}

/** RunHistory owns the machine-wide verification and landing history every worktree appends to. */
export const RunHistory = {
  overlap,
  readLandings,
  readRuns,
  recordLaneInterval,
  recordLanding,
  recordRun,
  runRecord,
  unknownOverlap,
} as const
