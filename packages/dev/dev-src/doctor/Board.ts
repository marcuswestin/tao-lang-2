import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { GreenTree } from '../repository-tests/GreenTree'
import { type LaneRecord, type MachineResourceOwner, MachineLanes } from '../repository-tests/MachineLanes'

/**
 * `board` answers the question no other command answers: who else is touching this machine right
 * now, and is a slow run mine or somebody else's? It is strictly read-only — it must never prune a
 * lane record, touch `.artifacts/` content, or run a verification lane — so an agent can reach for
 * it as often as `git status` without changing anything it reports on. `./agent doctor` is the
 * precedent for reading `MachineLanes` without pruning it; this module follows the same rule and
 * extends the picture across every worktree, not just the one asking.
 */

const MAIN_BRANCH = 'main'
const MERGE_ARTIFACT_ROOT = '.artifacts/merge'
/** Fields a finalize state file's shape might use for its one-line summary; the format is another
 * agent's concurrent work, so this list is a best-effort guess and a miss just prints "recorded". */
const FINALIZE_SUMMARY_FIELDS = ['state', 'phase', 'status', 'summary', 'message'] as const
const RESOURCE_LEASE_SUFFIX = '.lease'

export type BoardDependencies = {
  /** Injected by tests so a verdict does not depend on this machine's actual load at test time. */
  cpuCount?: () => number
  loadAverage?: () => number
  registryRoot?: string
  run?: typeof CLI.run
}

/** BoardWorktreeStatus distinguishes a fully-read worktree from one this run could not inspect. */
export type BoardWorktreeStatus = 'ok' | 'unreadable'

/** BoardVerificationSummary names the most recently recorded verification lane for a worktree. */
export type BoardVerificationSummary = {
  at: string
  lane: string
  logRoot: string
  /** Whether that record's tree hash still matches the worktree's current content. */
  treeMatchesCurrent?: boolean
}

/** BoardFinalizeSummary reports a `.artifacts/merge/<branch>.state.json` a concurrent `finalize`
 * command may have written, without depending on its exact shape. */
export type BoardFinalizeSummary =
  | { present: false }
  | { present: true; readable: false }
  | { present: true; readable: true; summary: string }

/** BoardWorktree is one row of `git worktree list`, enriched with what an agent needs to know
 * before treating that checkout's slowness or state as a surprise. */
export type BoardWorktree = {
  aheadOfMain?: number
  behindMain?: number
  branch?: string
  clean?: boolean
  error?: string
  finalize: BoardFinalizeSummary
  head: string
  mergeMessagePresent: boolean
  path: string
  status: BoardWorktreeStatus
  verification?: BoardVerificationSummary
}

/** BoardResourceLease is one named host resource (such as a landing lease) from the machine-wide
 * registry, alongside whether the process that holds it is still alive. */
export type BoardResourceLease = {
  live: boolean
  owner: MachineResourceOwner
}

/** BoardMachine is what no single checkout can see on its own: the shared lane registry and load. */
export type BoardMachine = {
  cpuCount: number
  lanes: readonly LaneRecord[]
  loadAverage: number
  registryAvailable: boolean
  resources: readonly BoardResourceLease[]
}

/** BoardReport is the versioned `--json` shape of `board`. */
export type BoardReport = {
  machine: BoardMachine
  verdict: string
  version: 1
  worktrees: readonly BoardWorktree[]
}

type WorktreeRecord = {
  branch?: string
  detached: boolean
  head: string
  path: string
}

/** board gathers the whole-machine status report. It never mutates the registry, an `.artifacts`
 * tree, or any worktree it inspects, and never runs a verification lane. */
export async function board(dependencies: BoardDependencies = {}): Promise<BoardReport> {
  const run = dependencies.run ?? CLI.run
  const worktrees = await listWorktrees(run)
  const [rows, machine] = await Promise.all([
    Promise.all(worktrees.map(worktree => readBoardWorktree(worktree, run))),
    readBoardMachine(dependencies.registryRoot, dependencies.cpuCount, dependencies.loadAverage),
  ])
  const thisRoot = await canonicalPath(Repo.getRoot())
  return { machine, verdict: computeVerdict(machine, thisRoot), version: 1, worktrees: rows }
}

/** formatBoardReport renders the report as the screen `board` prints without `--json`. */
export function formatBoardReport(report: BoardReport): string {
  const sections = [
    report.verdict,
    '',
    'Worktrees:',
    report.worktrees.length === 0 ? '  (none found)' : report.worktrees.map(formatWorktreeRow).join('\n'),
    '',
    formatMachineSection(report.machine),
  ]
  return sections.join('\n')
}

function formatWorktreeRow(worktree: BoardWorktree): string {
  const header = `${worktree.status === 'ok' ? 'OK  ' : 'BAD '}${worktree.path}`
  if (worktree.status === 'unreadable') {
    return `${header}\n  unreadable: ${worktree.error ?? 'unknown error'}`
  }
  const branch = worktree.branch ?? '(detached HEAD)'
  const cleanliness = worktree.clean === undefined ? 'clean unknown' : worktree.clean ? 'clean' : 'dirty'
  const relativeToMain = worktree.aheadOfMain === undefined || worktree.behindMain === undefined
    ? 'ahead/behind main unknown'
    : `ahead ${worktree.aheadOfMain} behind ${worktree.behindMain} of main`
  const mergeMessage = worktree.mergeMessagePresent ? 'merge message: present' : 'merge message: absent'
  const finalize = formatFinalizeSummary(worktree.finalize)
  const verification = worktree.verification === undefined
    ? 'verification: none recorded'
    : `verification: ${worktree.verification.lane} at ${worktree.verification.at}`
      + (worktree.verification.treeMatchesCurrent === undefined
        ? ' (current tree unknown)'
        : worktree.verification.treeMatchesCurrent
        ? ' (matches current tree)'
        : ' (tree has changed since)')
  return [
    header,
    `  branch ${branch}  head ${worktree.head}  ${cleanliness}  ${relativeToMain}`,
    `  ${mergeMessage}  ${finalize}`,
    `  ${verification}`,
  ].join('\n')
}

function formatFinalizeSummary(finalize: BoardFinalizeSummary): string {
  if (!finalize.present) {
    return 'finalize: not recorded'
  }
  if (!finalize.readable) {
    return 'finalize: recorded but unreadable'
  }
  return `finalize: ${finalize.summary}`
}

function formatMachineSection(machine: BoardMachine): string {
  const lines = [`Machine: load ${machine.loadAverage.toFixed(1)} on ${machine.cpuCount} CPUs`]
  if (!machine.registryAvailable) {
    lines.push('  the machine-lane registry could not be inspected')
    return lines.join('\n')
  }
  if (machine.lanes.length === 0) {
    lines.push('  no Tao lane is registered')
  }
  for (const lane of machine.lanes) {
    lines.push(`  lane ${lane.lane} in ${lane.repositoryRoot} (pid ${lane.pid}, ${lane.slots}/${lane.maxSlots} slots, since ${lane.startedAt})`)
  }
  if (machine.resources.length === 0) {
    lines.push('  no named resource lease is held')
  }
  for (const resource of machine.resources) {
    const liveness = resource.live ? '' : ' (stale)'
    lines.push(
      `  resource ${resource.owner.name} held by ${resource.owner.command} in ${resource.owner.repositoryRoot} `
        + `(pid ${resource.owner.pid}, since ${resource.owner.startedAt})${liveness}`,
    )
  }
  return lines.join('\n')
}

/**
 * computeVerdict is the one line an agent needs before it treats a slow lane as a regression: is
 * the machine busy, and is that this checkout's own doing, somebody else's, or unregistered work
 * (an Xcode build, another repository entirely) that no lane or lease describes.
 */
function computeVerdict(machine: BoardMachine, thisRoot: string): string {
  const load = `load ${machine.loadAverage.toFixed(1)} on ${machine.cpuCount} CPUs`
  if (!machine.registryAvailable) {
    return `unknown: the machine-lane registry could not be read (${load})`
  }
  const liveResources = machine.resources.filter(resource => resource.live)
  const laneOthers = machine.lanes.filter(lane => lane.repositoryRoot !== thisRoot)
  const laneMine = machine.lanes.filter(lane => lane.repositoryRoot === thisRoot)
  const resourceOthers = liveResources.filter(resource => resource.owner.repositoryRoot !== thisRoot)
  const resourceMine = liveResources.filter(resource => resource.owner.repositoryRoot === thisRoot)
  const othersCount = laneOthers.length + resourceOthers.length
  const mineCount = laneMine.length + resourceMine.length
  const loadHigh = machine.loadAverage > machine.cpuCount * MachineLanes.CONTENDED_LOAD_RATIO

  if (othersCount === 0 && !loadHigh) {
    return mineCount === 0
      ? `quiet: no other Tao work is registered (${load})`
      : `quiet: only this checkout is registered, ${mineCount} item${mineCount === 1 ? '' : 's'} (${load})`
  }

  const heldResources = [...resourceOthers, ...resourceMine]
  const parts = [
    laneOthers.length > 0 ? `${laneOthers.length} lane${laneOthers.length === 1 ? '' : 's'} elsewhere` : undefined,
    laneMine.length > 0 ? `${laneMine.length} lane${laneMine.length === 1 ? '' : 's'} in this checkout` : undefined,
    heldResources.length > 0
      ? `resource lease${heldResources.length === 1 ? '' : 's'} held (${
        heldResources.map(resource => resource.owner.name).join(', ')
      })`
      : undefined,
  ].filter((part): part is string => part !== undefined)

  const attribution = othersCount > 0
    ? 'busy, and not only from this checkout'
    : mineCount > 0
    ? 'busy, and it is this checkout'
    : 'busy, but no Tao lane or lease is registered'

  return `${attribution}${parts.length > 0 ? `: ${parts.join('; ')}` : ''}; ${load}`
}

/** listWorktrees discovers every worktree of this repository, prunable records excluded because a
 * read-only report leaves cleanup to an explicit `git worktree prune`. */
async function listWorktrees(run: typeof CLI.run): Promise<WorktreeRecord[]> {
  const result = await run('git', {
    args: ['worktree', 'list', '--porcelain'],
    cwd: Repo.getRoot(),
    stdio: 'pipe',
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment('Could not list this repository\'s worktrees.', { details: { stderr: result.stderr } })
  }
  return parseWorktreePorcelain(result.stdout)
}

/** parseWorktreePorcelain reads `git worktree list --porcelain` without depending on the
 * human-formatted column output, mirroring the shape `git worktree list` itself defines. */
export function parseWorktreePorcelain(source: string): WorktreeRecord[] {
  return source.trim().split(/\n\n+/u).filter(Boolean).flatMap(block => {
    const fields = new Map(
      block.split('\n').map(line => {
        const separator = line.indexOf(' ')
        return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
      }),
    )
    if (fields.has('prunable') || fields.has('bare')) {
      return []
    }
    const path = fields.get('worktree')
    const head = fields.get('HEAD')
    if (path === undefined || head === undefined) {
      return []
    }
    return [{
      branch: fields.get('branch')?.replace(/^refs\/heads\//u, ''),
      detached: fields.has('detached'),
      head,
      path: FS.resolvePath(path),
    }]
  })
}

/** readBoardWorktree gathers one worktree's row. Every failure short of "the path itself could not
 * be read at all" degrades a field rather than the whole row, per the hard requirement that a
 * missing, unreadable, or mid-rebase worktree is reported as such and never crashes `board`. */
async function readBoardWorktree(worktree: WorktreeRecord, run: typeof CLI.run): Promise<BoardWorktree> {
  if (!await FS.isDirectory(worktree.path)) {
    return {
      branch: worktree.branch,
      error: `${worktree.path} no longer exists`,
      finalize: { present: false },
      head: shortHead(worktree.head),
      mergeMessagePresent: false,
      path: worktree.path,
      status: 'unreadable',
    }
  }
  const [clean, aheadBehind, mergeMessagePresent, finalize, verification] = await Promise.all([
    readClean(worktree.path, run),
    readAheadBehind(worktree.path, run),
    readMergeMessagePresent(worktree.path, worktree.branch),
    readFinalizeSummary(worktree.path, worktree.branch),
    readVerificationSummary(worktree.path, run),
  ])
  return {
    aheadOfMain: aheadBehind?.ahead,
    behindMain: aheadBehind?.behind,
    branch: worktree.branch,
    clean,
    finalize,
    head: shortHead(worktree.head),
    mergeMessagePresent,
    path: worktree.path,
    status: 'ok',
    verification,
  }
}

function shortHead(head: string): string {
  return head.slice(0, 10)
}

async function readClean(path: string, run: typeof CLI.run): Promise<boolean | undefined> {
  const result = await run('git', { args: ['status', '--porcelain'], cwd: path, stdio: 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  return result.stdout.trim().length === 0
}

/** readAheadBehind reports commits ahead of and behind `main`. Left of `...` is `main`, so the left
 * count is commits behind and the right count is commits ahead of it. */
async function readAheadBehind(
  path: string,
  run: typeof CLI.run,
): Promise<{ ahead: number; behind: number } | undefined> {
  const result = await run('git', {
    args: ['rev-list', '--left-right', '--count', `${MAIN_BRANCH}...HEAD`],
    cwd: path,
    stdio: 'pipe',
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  const [behind, ahead] = result.stdout.trim().split(/\s+/u).map(Number)
  return Number.isFinite(behind) && Number.isFinite(ahead) ? { ahead: ahead!, behind: behind! } : undefined
}

async function readMergeMessagePresent(path: string, branch: string | undefined): Promise<boolean> {
  if (branch === undefined) {
    return false
  }
  return await FS.isFile(FS.resolvePath(`${MERGE_ARTIFACT_ROOT}/${branch}.msg`, path)).catch(() => false)
}

/** readFinalizeSummary reads a concurrently-developed `finalize` command's state file. Its exact
 * shape belongs to that command, so a missing file and an unparseable one are both ordinary. */
async function readFinalizeSummary(path: string, branch: string | undefined): Promise<BoardFinalizeSummary> {
  if (branch === undefined) {
    return { present: false }
  }
  const statePath = FS.resolvePath(`${MERGE_ARTIFACT_ROOT}/${branch}.state.json`, path)
  if (!await FS.isFile(statePath).catch(() => false)) {
    return { present: false }
  }
  try {
    const state = await FS.readJson<unknown>(statePath)
    return { present: true, readable: true, summary: summarizeFinalizeState(state) }
  } catch {
    return { present: true, readable: false }
  }
}

function summarizeFinalizeState(state: unknown): string {
  if (typeof state !== 'object' || state === null) {
    return 'recorded'
  }
  const record = state as Record<string, unknown>
  for (const field of FINALIZE_SUMMARY_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.length > 0) {
      return `${field} ${value}`
    }
  }
  return 'recorded'
}

/** readVerificationSummary names the most recently recorded green-tree lane and whether it still
 * matches the worktree's current content. A store this run cannot read or hash is reported as "no
 * recorded lane" rather than failing the whole worktree row. */
async function readVerificationSummary(
  path: string,
  run: typeof CLI.run,
): Promise<BoardVerificationSummary | undefined> {
  const storePath = FS.resolvePath(GreenTree.STORE_PATH, path)
  if (!await FS.isFile(storePath).catch(() => false)) {
    return undefined
  }
  let store: { lanes?: Record<string, { at: string; logRoot: string; treeHash: string }> }
  try {
    store = await FS.readJson(storePath)
  } catch {
    return undefined
  }
  const lanes = store.lanes ?? {}
  const mostRecent = Object.entries(lanes).toSorted(
    ([, left], [, right]) => Date.parse(right.at) - Date.parse(left.at),
  )[0]
  if (mostRecent === undefined) {
    return undefined
  }
  const [lane, record] = mostRecent
  const treeMatchesCurrent = await GreenTree.hashTree(path, run)
    .then(hash => hash === record.treeHash)
    .catch(() => undefined)
  return { at: record.at, lane, logRoot: record.logRoot, treeMatchesCurrent }
}

/**
 * readBoardMachine reads the shared lane and resource-lease registry without pruning either. Every
 * repository root recorded there is canonicalized, the same way `readDoctorFacts` does, so a
 * symlinked worktree path compares equal to the one `Repo.getRoot()` resolves to for this run.
 */
async function readBoardMachine(
  registryRoot?: string,
  cpuCount: () => number = Platform.cpuCount,
  loadAverage: () => number = Platform.loadAverage,
): Promise<BoardMachine> {
  const root = registryRoot ?? MachineLanes.registryRoot()
  const inspection = await MachineLanes.inspectLanes(root, { prune: false })
  const [lanes, resources] = await Promise.all([
    Promise.all(inspection.lanes.map(async lane => ({ ...lane, repositoryRoot: await canonicalPath(lane.repositoryRoot) }))),
    readResourceLeases(root),
  ])
  return {
    cpuCount: cpuCount(),
    lanes,
    loadAverage: loadAverage(),
    registryAvailable: inspection.available,
    resources,
  }
}

/**
 * readResourceLeases reads named host-resource leases (such as a landing lease held during
 * merge-with-main) directly from the registry directory. `MachineLanes` does not export a lister
 * for these, only acquire/release, so this reads the same directory its lane registrations live in
 * and validates each `*.lease` file's shape defensively: a lease this run cannot parse, or a
 * resource-lease mechanism that does not exist yet on an older registry, is skipped rather than
 * failing the whole report.
 */
async function readResourceLeases(root: string): Promise<BoardResourceLease[]> {
  let entries: string[]
  try {
    entries = await FS.listDir(root)
  } catch {
    return []
  }
  const leases: BoardResourceLease[] = []
  for (const entry of entries) {
    if (!entry.endsWith(RESOURCE_LEASE_SUFFIX)) {
      continue
    }
    const owner = await readResourceOwner(FS.resolvePath(entry, root))
    if (owner === undefined) {
      continue
    }
    const canonicalOwner = { ...owner, repositoryRoot: await canonicalPath(owner.repositoryRoot) }
    leases.push({ live: await MachineLanes.ownerIsLive(canonicalOwner), owner: canonicalOwner })
  }
  return leases
}

async function readResourceOwner(path: string): Promise<MachineResourceOwner | undefined> {
  try {
    const value = await FS.readJson<Partial<MachineResourceOwner>>(path)
    if (
      typeof value !== 'object' || value === null
      || typeof value.id !== 'string'
      || typeof value.name !== 'string'
      || typeof value.pid !== 'number'
      || typeof value.startedAt !== 'string'
    ) {
      return undefined
    }
    return {
      command: value.command ?? value.name,
      id: value.id,
      name: value.name,
      pid: value.pid,
      processStartedAt: value.processStartedAt,
      repositoryRoot: value.repositoryRoot ?? '<unknown worktree>',
      startedAt: value.startedAt,
    }
  } catch {
    return undefined
  }
}

async function canonicalPath(path: string): Promise<string> {
  return await FS.realPath(path).catch(() => FS.resolvePath(path))
}

/** Board owns the whole-machine, read-only status report behind `./dev board`. */
export const Board = { board, formatBoardReport, parseWorktreePorcelain } as const
