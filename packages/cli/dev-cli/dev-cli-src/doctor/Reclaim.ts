import { CLI, Errors, FS, Repo } from '@shared'
import { LandingLock } from '@verification/LandingLock'
import { MachineLanes, type MachineResourceOwner } from '@verification/MachineLanes'
import { parseWorktreePorcelain } from './Board'
import {
  readWorktreeThreads,
  threadInventoryAvailable,
  type WorktreeThread,
  type WorktreeThreadInventory,
} from './WorktreeThreads'

/**
 * `reclaim` is the verdict `board` deliberately refuses to draw. `board` is a read-only picture of
 * who is touching this machine; this command answers the next question — which of these checkouts
 * is finished with — and, only when asked, acts on it.
 *
 * The danger it is built around is not deleting the wrong file, it is deleting a worktree that went
 * back to work. A landing leaves its worktree in place, detached at the verified tip, so "clean,
 * detached, contained in `main`" describes a finished task *and* an idle one somebody is about to
 * return to. The 2026-09-19 sweep that motivated this command caught exactly that: a worktree that
 * was clean, detached at a merged ref and idle for seventeen hours registered a new `verify` lane
 * between the inventory and the action. So the liveness signals are re-read per worktree at the
 * moment of removal rather than trusted from the opening report, and anything this command cannot
 * prove idle is `unclassified` and left alone. Silence is never taken for absence.
 */

const MAIN_BRANCH = 'main'
/**
 * `merge-with-main` keeps a recovery worktree under `.artifacts/merge/`, which a landing reads while
 * its snapshot says `push-started`. Nothing here is ever allowed to classify one of those as
 * reclaimable, whatever its Git state looks like, because the window in which it matters is exactly
 * the window in which it looks idle.
 */
const PROTECTED_PATH_FRAGMENT = '/.artifacts/merge/'
const RESOURCE_LEASE_SUFFIX = '.lease'

export type ReclaimDependencies = {
  registryRoot?: string
  run?: typeof CLI.run
  readThreads?: (paths: readonly string[]) => Promise<WorktreeThreadInventory>
  inSandbox?: () => boolean
  /** The worktree asking. Injected by tests; nothing may reclaim the ground it is standing on. */
  thisRoot?: string
}

/**
 * A verdict says what was proved, not how confident the command feels.
 *
 * - `reclaimable` — proved idle and proved preserved: every liveness signal is silent, the tree is
 *   clean, and the commit is reachable from `main` or from an `origin/merged/*` ref, so removing the
 *   directory loses no history.
 * - `live` — proved in use: a lane, a resource lease, the landing lock, uncommitted changes, or a
 *   protected path. Reported so the count adds up, never acted on.
 * - `unclassified` — neither was proved. An unreadable worktree, a commit reachable from nothing,
 *   a Git command that failed. This is the class that keeps the command honest: it is where
 *   everything the rules do not cover lands, rather than defaulting into `reclaimable`.
 */
type ReclaimVerdict = 'live' | 'reclaimable' | 'unclassified'

/** ReclaimWorktree is one checkout with its verdict and the evidence that produced it. */
type ReclaimWorktree = {
  branch?: string
  detached: boolean
  /** Why this verdict, in the order the checks ran. Always populated: a verdict with no evidence
   * behind it is the thing this command exists to avoid printing. */
  evidence: readonly string[]
  head: string
  path: string
  threads: readonly WorktreeThread[]
  verdict: ReclaimVerdict
}

/** ReclaimRemoval records what `--execute` did to one worktree, including why it declined. */
export type ReclaimRemoval = {
  outcome: 'removed' | 'skipped-now-live' | 'failed'
  path: string
  reason?: string
}

/** ReclaimReport is the versioned `--json` shape of `reclaim`. */
export type ReclaimReport = {
  providers: WorktreeThreadInventory['providers']
  removals?: readonly ReclaimRemoval[]
  version: 2
  worktrees: readonly ReclaimWorktree[]
}

type LiveRoots = {
  /** Canonical worktree paths the machine registry says are working right now. */
  busy: ReadonlySet<string>
  /** False when the registry could not be read at all, which forbids every reclamation: an empty
   * registry and an unreadable one look identical, and only one of them is safe. */
  registryAvailable: boolean
}

/** reclaim gathers the verdicts. It changes nothing; `execute` is what acts. */
export async function reclaim(dependencies: ReclaimDependencies = {}): Promise<ReclaimReport> {
  const run = dependencies.run ?? CLI.run
  const thisRoot = await canonicalPath(dependencies.thisRoot ?? Repo.getRoot())
  const records = await listWorktrees(run)
  const live = await readLiveRoots(dependencies.registryRoot)
  const threads = await (dependencies.readThreads ?? readWorktreeThreads)(records.map(record => record.path))
  const primary = records[0]?.path
  const worktrees = await Promise.all(
    records.map(async record => await classify(record, { live, primary, run, thisRoot, threads })),
  )
  return { providers: threads.providers, version: 2, worktrees }
}

type ClassifyContext = {
  live: LiveRoots
  primary?: string
  run: typeof CLI.run
  thisRoot: string
  threads: WorktreeThreadInventory
}

/**
 * classify runs the cheap disqualifiers before the Git questions, so the common answer costs one
 * `git status`. Every branch returns evidence, and the only path to `reclaimable` is the one that
 * fell through all of them.
 */
async function classify(
  record: { branch?: string; detached: boolean; head: string; path: string },
  context: ClassifyContext,
): Promise<ReclaimWorktree> {
  const path = await canonicalPath(record.path)
  const attached = context.threads.byPath[path] ?? []
  const row = {
    branch: record.branch,
    detached: record.detached,
    head: record.head.slice(0, 10),
    path: record.path,
    threads: attached,
  }

  if (path === context.thisRoot) {
    return { ...row, evidence: ['this worktree is the one running reclaim'], verdict: 'live' }
  }
  if (context.primary !== undefined && path === await canonicalPath(context.primary)) {
    return { ...row, evidence: ['primary checkout'], verdict: 'live' }
  }
  if (record.path.includes(PROTECTED_PATH_FRAGMENT)) {
    return { ...row, evidence: ["a landing's recovery worktree under .artifacts/merge"], verdict: 'live' }
  }
  if (!context.live.registryAvailable) {
    return { ...row, evidence: ['the machine lane registry could not be read'], verdict: 'unclassified' }
  }
  if (context.live.busy.has(path)) {
    return { ...row, evidence: ['holds a lane, a resource lease, or the landing lock'], verdict: 'live' }
  }
  if (attached.length > 0) {
    return { ...row, evidence: [`attached to ${attached.length} agent task(s)`], verdict: 'live' }
  }
  if (!threadInventoryAvailable(context.threads)) {
    return { ...row, evidence: ['an installed agent task index could not be read'], verdict: 'unclassified' }
  }
  if (!await FS.isDirectory(record.path)) {
    return {
      ...row,
      evidence: ['the directory no longer exists; `git worktree prune` owns this'],
      verdict: 'unclassified',
    }
  }

  const clean = await readClean(record.path, context.run)
  if (clean === undefined) {
    return { ...row, evidence: ['could not read the working tree'], verdict: 'unclassified' }
  }
  if (!clean) {
    return { ...row, evidence: ['uncommitted changes'], verdict: 'live' }
  }

  const containing = await readContainingRefs(record.path, record.head, context.run)
  if (containing === undefined) {
    return { ...row, evidence: ['clean', 'could not ask which refs contain this commit'], verdict: 'unclassified' }
  }
  if (containing.length === 0) {
    return {
      ...row,
      evidence: ['clean', 'idle', `${row.head} is reachable from neither main nor any origin/merged/* ref`],
      verdict: 'unclassified',
    }
  }
  return { ...row, evidence: ['clean', 'idle', `contained in ${containing[0]}`], verdict: 'reclaimable' }
}

/**
 * execute removes the reclaimable worktrees, re-reading the liveness signals immediately before each
 * one. The re-read is the whole point: the report it acts on is already stale by the time a person
 * has read it, and a worktree that took a lane in between must survive.
 */
export async function execute(
  report: ReclaimReport,
  dependencies: ReclaimDependencies = {},
): Promise<readonly ReclaimRemoval[]> {
  if ((dependencies.inSandbox ?? CLI.inAgentSandbox)()) {
    Errors.throwHostEnvironment(
      'Reclaim cannot remove worktrees inside an agent sandbox: Git may unregister a worktree before the sandbox denies directory deletion. Run --execute from a normal Terminal.',
    )
  }
  const run = dependencies.run ?? CLI.run
  const readThreads = dependencies.readThreads ?? readWorktreeThreads
  const removals: ReclaimRemoval[] = []
  for (const worktree of report.worktrees.filter(candidate => candidate.verdict === 'reclaimable')) {
    const live = await readLiveRoots(dependencies.registryRoot)
    const path = await canonicalPath(worktree.path)
    if (!live.registryAvailable || live.busy.has(path)) {
      removals.push({
        outcome: 'skipped-now-live',
        path: worktree.path,
        reason: live.registryAvailable ? 'took a lane since the report' : 'the lane registry became unreadable',
      })
      continue
    }
    const threads = await readThreads([path])
    if (!threadInventoryAvailable(threads) || (threads.byPath[path] ?? []).length > 0) {
      removals.push({
        outcome: 'skipped-now-live',
        path: worktree.path,
        reason: threadInventoryAvailable(threads)
          ? 'attached to an agent task'
          : 'an agent task index became unreadable',
      })
      continue
    }
    if (await readClean(worktree.path, run) !== true) {
      removals.push({
        outcome: 'skipped-now-live',
        path: worktree.path,
        reason: 'gained uncommitted changes since the report',
      })
      continue
    }
    removals.push(await removeWorktree(worktree.path, run))
  }
  return removals
}

/**
 * removeWorktree names a sandbox denial rather than letting it read as a generic Git failure.
 * A denial can happen after Git unregisters the checkout, so its directory must be inspected.
 */
async function removeWorktree(path: string, run: typeof CLI.run): Promise<ReclaimRemoval> {
  const result = await run('git', { args: ['worktree', 'remove', path], cwd: Repo.getRoot(), stdio: 'pipe' })
  if (result.error === undefined && result.exitCode === 0) {
    return { outcome: 'removed', path }
  }
  const stderr = `${result.stderr ?? ''}${result.error === undefined ? '' : String(result.error)}`
  return {
    outcome: 'failed',
    path,
    reason: CLI.isSandboxDenial(result)
      ? 'the sandbox denied directory deletion; Git may already have unregistered the worktree. Inspect the registry and directory before retrying from a normal Terminal.'
      : stderr.trim().split('\n')[0] ?? 'git worktree remove failed',
  }
}

/**
 * readLiveRoots collects every worktree path the machine says is working, from all three registries
 * `board` reads: running lanes, held host-resource leases, and the landing lock. A lease is counted
 * separately from a lane on purpose — a simulator or port lease can outlive the lane that took it,
 * and a worktree holding one is not idle.
 *
 * An unreadable registry returns `registryAvailable: false` rather than an empty set, because those
 * two states produce identical evidence and only one of them makes removal safe.
 */
async function readLiveRoots(registryRoot?: string): Promise<LiveRoots> {
  const root = registryRoot ?? MachineLanes.registryRoot()
  const busy = new Set<string>()
  const inspected = await MachineLanes.inspectLanes(root, { prune: false })
  if (!inspected.available) {
    return { busy, registryAvailable: false }
  }
  for (const lane of inspected.lanes) {
    busy.add(await canonicalPath(lane.repositoryRoot))
  }
  for (const owner of await readLiveResourceOwners(root)) {
    busy.add(await canonicalPath(owner.repositoryRoot))
  }
  const lock = await LandingLock.inspectState(root)
  if (lock.kind === 'unreadable') {
    return { busy, registryAvailable: false }
  }
  if (lock.kind === 'held') {
    busy.add(await canonicalPath(lock.record.holder))
  }
  return { busy, registryAvailable: true }
}

/** readLiveResourceOwners reads the host-resource leases, keeping only those whose holder is alive. */
async function readLiveResourceOwners(root: string): Promise<readonly MachineResourceOwner[]> {
  let entries: string[]
  try {
    entries = await FS.listDir(root)
  } catch {
    return []
  }
  const owners: MachineResourceOwner[] = []
  for (const entry of entries.filter(name => name.endsWith(RESOURCE_LEASE_SUFFIX))) {
    const owner = await FS.readJson<MachineResourceOwner>(FS.resolvePath(entry, root)).catch(() => undefined)
    if (owner?.repositoryRoot === undefined) {
      continue
    }
    if (await MachineLanes.ownerIsLive({ ...owner, repositoryRoot: await canonicalPath(owner.repositoryRoot) })) {
      owners.push(owner)
    }
  }
  return owners
}

async function listWorktrees(run: typeof CLI.run): Promise<ReturnType<typeof parseWorktreePorcelain>> {
  const result = await run('git', { args: ['worktree', 'list', '--porcelain'], cwd: Repo.getRoot(), stdio: 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment("Could not list this repository's worktrees.", { details: { stderr: result.stderr } })
  }
  return parseWorktreePorcelain(result.stdout)
}

async function readClean(path: string, run: typeof CLI.run): Promise<boolean | undefined> {
  const result = await run('git', { args: ['status', '--porcelain'], cwd: path, stdio: 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  return result.stdout.trim().length === 0
}

/**
 * readContainingRefs asks Git which preserved ref reaches this commit, in one call rather than one
 * `merge-base --is-ancestor` per candidate ref — this repository carries dozens of `origin/merged/*`
 * refs and dozens of worktrees, and the product of the two is the reason a hand-built inventory was
 * needed before. An empty list is a real answer: nothing preserves this commit.
 */
async function readContainingRefs(
  path: string,
  head: string,
  run: typeof CLI.run,
): Promise<readonly string[] | undefined> {
  const result = await run('git', {
    args: [
      'for-each-ref',
      `--contains=${head}`,
      '--format=%(refname:short)',
      `refs/heads/${MAIN_BRANCH}`,
      `refs/remotes/origin/${MAIN_BRANCH}`,
      'refs/remotes/origin/merged',
    ],
    cwd: path,
    stdio: 'pipe',
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  return result.stdout.trim().split('\n').filter(line => line.length > 0)
}

async function canonicalPath(path: string): Promise<string> {
  return await FS.realPath(path).catch(() => FS.resolvePath(path))
}

/** formatReclaimReport renders the report `reclaim` prints without `--json`. */
export function formatReclaimReport(report: ReclaimReport): string {
  const counts = { live: 0, reclaimable: 0, unclassified: 0 }
  for (const worktree of report.worktrees) {
    counts[worktree.verdict] += 1
  }
  const rows = report.worktrees.map(worktree =>
    [
      `${worktree.verdict.toUpperCase().padEnd(13)} ${FS.displayPath(worktree.path)}`,
      `              ${worktree.branch ?? `detached at ${worktree.head}`} — ${worktree.evidence.join('; ')}`,
      ...worktree.threads.map(thread =>
        `              ${thread.app}${thread.archived ? ' (archived)' : ''}: ${thread.title} — ${
          thread.description || 'no description'
        }; created ${thread.createdAt ?? 'unknown'}; active ${thread.lastActivityAt ?? 'unknown'}`
      ),
    ].join('\n')
  )
  const summary = `${counts.reclaimable} reclaimable, ${counts.live} live, ${counts.unclassified} unclassified`
  const sections = [
    report.worktrees.length === 0 ? '(no worktrees found)' : rows.join('\n'),
    '',
    summary,
    `Task indexes: ${Object.entries(report.providers).map(([app, status]) => `${app}=${status}`).join(', ')}`,
    ...(report.removals === undefined
      ? counts.reclaimable === 0 ? [] : ['Nothing was removed. Re-run with --execute to remove the reclaimable ones.']
      : [
        '',
        'Removals:',
        ...report.removals.map(removal =>
          `  ${removal.outcome.padEnd(16)} ${FS.displayPath(removal.path)}${
            removal.reason === undefined ? '' : ` — ${removal.reason}`
          }`
        ),
      ]),
  ]
  return sections.join('\n')
}

/** formatWorktreeStatus prints one compact entry per checkout; `reclaim --json` retains every task. */
export function formatWorktreeStatus(report: ReclaimReport): string {
  const shorten = (value: string, limit: number): string =>
    value.length > limit ? `${value.slice(0, limit - 1)}…` : value
  const date = (value: string | null): string => {
    if (value === null) {
      return 'unknown'
    }
    const parsed = new Date(value)
    return Number.isNaN(parsed.valueOf()) ? value : `${parsed.toISOString().slice(0, 16)}Z`
  }
  const rows = report.worktrees.flatMap(worktree => {
    const latest = worktree.threads[0]
    const task = latest === undefined
      ? 'no matching task'
      : `${latest.app}${latest.archived ? ' archived' : ''}: ${shorten(latest.title, 48)}`
        + ` — ${shorten(latest.description || 'no description', 64)}`
        + `; created ${date(latest.createdAt)}; active ${date(latest.lastActivityAt)}`
        + (worktree.threads.length === 1 ? '' : `; +${worktree.threads.length - 1} other task(s)`)
    return [
      `${worktree.verdict.toUpperCase().padEnd(12)} ${FS.displayPath(worktree.path)}`
      + ` — ${worktree.branch ?? `detached ${worktree.head}`}`,
      `  ${task}`,
    ]
  })
  return [
    ...rows,
    `${
      report.worktrees.filter(row => row.verdict === 'reclaimable').length
    } would be attempted by reclaim --execute; no worktrees removed.`,
    `Task indexes: ${Object.entries(report.providers).map(([app, status]) => `${app}=${status}`).join(', ')}`,
  ].join('\n')
}
