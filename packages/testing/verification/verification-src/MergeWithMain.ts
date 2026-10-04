import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { LandingLock, LandingLockBusyError, type LandingPhaseName } from './LandingLock'
import {
  type LandingPriorityLease,
  MachineLanes,
  MachineResourceBusyError,
  type MachineResourceLease,
} from './MachineLanes'
import { RunHistory } from './RunHistory'
import { extractLaneReport } from './RunSummary'

const SNAPSHOT_VERSION = 1
const LANDING_RESOURCE_NAME = 'merge-with-main-landing'
// Bounded rather than infinite: a peer whose process is gone is pruned by the registry, but one that
// is merely wedged must eventually surface as an actionable error instead of hanging a landing.
const LEASE_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1_000
/**
 * How many times a landing re-integrates `origin/main` and starts its verification over.
 *
 * It was three while integration happened before the lock, where main moving mid-run was ordinary.
 * Inside the transaction main can only move by a push from another machine or a person, so a restart
 * is already the unusual case — and each one costs the full expensive suites again while this
 * landing holds the machine, which is exactly the long hold the transaction exists to remove. Two is
 * the honest number: one restart absorbs a push that landed while this run was verifying, and a
 * second means main is moving faster than the machine can verify, which is a situation to hand back
 * rather than to keep paying for.
 */
const MAX_STABILIZATION_PASSES = 2
/**
 * The cheap-gate barrier: generation and formatting consistency, repository lint, types, and dead
 * exports, in check mode. It is the first thing the transaction spends after integrating main,
 * because a red one of these costs about 30s to learn and the suites behind it cost 60-170s more to
 * learn nothing extra.
 */
const LAND_BARRIER_LANE = 'land-barrier'
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
/**
 * Branches a landing accepts: `feat/` is an agent's, `dev/` a person's. They land the same way,
 * except a personal branch archives once per landing (`merged/<name>/<utc>`) so the name can be
 * recreated from main and landed again. A feature branch archives once, at `merged/<name>`.
 */
const LANDABLE_PREFIXES = ['feat/', 'dev/'] as const
const MERGE_PHASES: readonly MergePhase[] = [
  'prepared',
  'feature-integrated',
  'feature-verified',
  'squashed',
  'main-verified',
  'committed',
  'push-started',
  'pushed',
  'archived',
  'complete',
  'aborted',
  'failed',
]

/**
 * MergeWithMainOptions is the flags-ready input accepted by the development CLI command.
 *
 * The plain invocation performs the landing: it moves refs, needs no confirmation, and pushes.
 * Every other option only removes work, apart from `--abort`, `--dry-run`, and `--message-file`.
 */
export type MergeWithMainOptions = {
  /** Restore command-owned state from a snapshot instead of starting a merge. */
  abortSnapshot?: string
  /** Report the plan and change nothing. The only way to see the plan without landing. */
  dryRun?: boolean
  /** Override `.artifacts/merge/<branch>.msg`. */
  messageFile?: string
  /** Override the current repository root, principally for tests. */
  repositoryRoot?: string
  /** Imply both skip options after one interactive confirmation that defaults to No. */
  skipAll?: boolean
  /** Skip the staged-squash `just verify --complete` pass. */
  skipVerify?: boolean
  /** Skip the otherwise mandatory unsandboxed full verification of the feature branch. */
  skipVerifyFull?: boolean
}

/** MergePhase names each durable recovery boundary in the landing workflow. */
export type MergePhase =
  | 'prepared'
  | 'feature-integrated'
  | 'feature-verified'
  | 'squashed'
  | 'main-verified'
  | 'committed'
  | 'push-started'
  | 'pushed'
  | 'archived'
  | 'complete'
  | 'aborted'
  | 'failed'

/** MergeSnapshot records the exact local state the command owns and may safely restore. */
export type MergeSnapshot = {
  branch: string
  createdAt: string
  currentFeatureHead: string
  currentFeatureDiff: string
  currentFeatureStatus: string
  /** Where `refs/heads/main` points now. A ref, not a checkout: no worktree holds main. */
  currentMainHead: string
  featureHead: string
  featureIndexTree: string
  featureRoot: string
  featureTree: string
  mainHead: string
  messageFile: string
  /** The commit this landing built, once it exists; what `--abort` removes main from. */
  landedHead?: string
  phase: MergePhase
  remoteFeatureHead?: string
  remoteMainHead: string
  remoteTransport?: RemoteTransport
  snapshotPath: string
  /** The archive ref chosen at preflight. Push uses this rather than naming one again later. */
  archive?: string
  version: typeof SNAPSHOT_VERSION
}

/** MergePreflight is the immutable repository evidence collected before execution. */
export type MergePreflight = {
  branch: string
  branchHead: string
  featureRoot: string
  /**
   * Whether local `refs/heads/main` already sits at `origin/main`. Once a precondition, now a fact
   * the report states: the landing fast-forwards the ref itself, inside the lock.
   */
  localMainCurrent: boolean
  mainHead: string
  /**
   * Whether `origin/main` is already an ancestor of the branch. Once a precondition, now a fact: a
   * branch that has fallen behind is integrated inside the lock, where nothing can move main
   * underneath it again. Requiring it beforehand is what made a landing lose a race it had already
   * paid a full verification for — four times on one branch — because main moved between the
   * preflight that checked it and the lock that was supposed to protect it.
   */
  mainIntegrated: boolean
  message: string
  messageFile: string
  /** Detached, clean worktrees sitting at main's tip: mirrors this landing moves forward with main. */
  mirrorRoots: string[]
  remoteFeatureHead?: string
  remoteFeatureBehind: boolean
  remoteMainHead: string
  remoteMergedHead?: string
  remoteTransport: RemoteTransport
  /** The remote ref this landing will create. Dated for `dev/*`, a single name for `feat/*`. */
  archive: string
  warnings: string[]
}

/** MergeWithMainResult reports the selected mode and its concise terminal lines. */
export type MergeWithMainResult = {
  lines: string[]
  mode: 'aborted' | 'dry-run' | 'executed'
  snapshotPath?: string
}

/** MergeCommandRunner is the injectable process seam used to prove workflows without moving real refs. */
export type MergeCommandRunner = (
  command: string,
  spec: CLI.CommandSpec,
) => Promise<CLI.CommandResult>

/** MergeWithMainDependencies isolates process, filesystem, terminal, and clock effects for testing. */
export type MergeWithMainDependencies = {
  acquireLease: (
    options: Parameters<typeof MachineLanes.acquireResource>[0] & {
      onQueueWait?: () => Promise<void>
    },
  ) => Promise<MachineResourceLease>
  acquireVerificationPriority: (repositoryRoot: string) => Promise<LandingPriorityLease | undefined>
  askConfirm: (message: string) => Promise<boolean>
  /** Report which phase of the landing the lock is being spent on. Never throws; see `LandingLock`. */
  beginPhase: (repositoryRoot: string, name: LandingPhaseName) => Promise<void>
  /** End this worktree's durable `land-lock` claim, which `release` alone deliberately survives. */
  endDurableClaim: (repositoryRoot: string) => Promise<void>
  /** Close the phase still open, so a finished landing does not read as one still in a phase. */
  endPhases: (repositoryRoot: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  isInteractive: () => boolean
  move: (fromPath: string, toPath: string) => Promise<void>
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  readText: (path: string) => Promise<string>
  /**
   * Record the finished landing in the machine-wide history while the lock is still held. Optional
   * so an injected landing records nothing; telemetry, so it never throws.
   */
  recordLanding?: (landing: FinishedLanding) => Promise<void>
  remove: (path: string) => Promise<void>
  run: MergeCommandRunner
  writeJson: (path: string, value: unknown) => Promise<void>
  writeLine: (line: string, kind?: 'success') => void
  writeText: (path: string, value: string) => Promise<void>
}

/** FinishedLanding is what the landing itself knows when its transaction ends, either way. */
export type FinishedLanding = {
  branch: string
  endedAt: Date
  error?: unknown
  repositoryRoot: string
  startedAt: Date
}

type Worktree = {
  branch?: string
  head: string
  path: string
}

type RemoteTransport = 'broker' | 'direct'

const defaultDependencies: MergeWithMainDependencies = {
  // Forwarded rather than referenced, because the adapter is declared with the landing code it
  // belongs beside rather than up here with the rest of the injected effects.
  acquireLease: async options => await acquireLandingLock(options),
  acquireVerificationPriority: async () => await MachineLanes.beginLandingPriority(),
  askConfirm: async message => await HCI.askConfirm({ defaultValue: false, message }),
  beginPhase: async (repositoryRoot, name) => {
    await LandingLock.beginPhase({ name, repositoryRoot })
  },
  endDurableClaim: async repositoryRoot => {
    await LandingLock.release({ repositoryRoot })
  },
  endPhases: async repositoryRoot => {
    await LandingLock.endPhases({ repositoryRoot })
  },
  exists: FS.exists,
  isInteractive: HCI.isInteractive,
  move: FS.move,
  now: () => new Date(),
  readJson: FS.readJson,
  readText: FS.readText,
  recordLanding: async landing => await recordLanding(landing),
  remove: FS.remove,
  run: CLI.run,
  writeJson: FS.writeJson,
  writeLine: (line, kind) => {
    if (kind === 'success') {
      HCI.writeSuccess(`${line}\n`)
    } else {
      HCI.writeLine(line)
    }
  },
  writeText: FS.writeText,
}

/**
 * archiveStem is the undated archive name: `merged/<name>` with the `feat/` or `dev/` prefix removed.
 * A feature branch publishes exactly this ref. A personal branch publishes children under it.
 */
function archiveStem(branch: string): string {
  const prefix = LANDABLE_PREFIXES.find(candidate => branch.startsWith(candidate)) ?? ''
  return `merged/${branch.slice(prefix.length)}`
}

/**
 * archiveStamp is a UTC time a Git ref can hold. `2026-09-28T15:12:03.789Z` becomes
 * `2026-09-28T15-12-03-789Z`, because a ref cannot contain a colon.
 */
function archiveStamp(at: Date): string {
  const [date, fraction] = at.toISOString().split('.')
  const millis = (fraction ?? '000Z').slice(0, 3)
  return `${date!.replaceAll(':', '-')}-${millis}Z`
}

/** archiveName is the ref this landing publishes. Personal branches include the preflight time. */
function archiveName(branch: string, at: Date): string {
  const stem = archiveStem(branch)
  return branch.startsWith('dev/') ? `${stem}/${archiveStamp(at)}` : stem
}

/**
 * landedReport answers one question an agent otherwise has to infer: did this branch land?
 *
 * Inference is what goes wrong. A landing runs for minutes through a wrapper, and every signal
 * short of the repository itself is ambiguous — a stopped wrapper, a task marked failed because the
 * shell it was piped into exited non-zero, a `summary.json` read while the lane was still writing
 * it. An agent that guesses re-lands work already on `main`, which is how one branch was re-landed
 * twice in a single session.
 *
 * The archive ref is the fact. `merge-with-main` pushes it as part of a successful landing and at
 * no other time. A feature branch has one ref, `merged/<name>`. A personal branch has one ref per
 * landing, `merged/<name>/<utc>`, and any of them means the branch has landed. Query the remote
 * directly; a failed query must not look like an absent archive.
 */
export async function landedReport(
  branch?: string,
  dependencies: MergeWithMainDependencies = defaultDependencies,
  repositoryRoot?: string,
): Promise<{ archive: string; branch: string; landed: boolean }> {
  const root = repositoryRoot ?? Repo.getRoot()
  const named = branch ?? await currentBranch(dependencies, root)
  if (named === undefined) {
    Errors.throwUserInput(
      'This worktree is on a detached HEAD, so there is no branch to ask about. Name one: `./agent landed feat/<name>`.',
    )
  }
  const stem = archiveStem(named)
  if (named.startsWith('dev/')) {
    const remote = await remoteHeads(dependencies, root, [`${stem}/*`])
    const archives = [...remote.refs.keys()].filter(name => name.startsWith(`${stem}/`)).sort()
    const archive = archives.at(-1) ?? `${stem}/`
    return { archive, branch: named, landed: archives.length > 0 }
  }
  const remote = await remoteHeads(dependencies, root, [stem])
  return { archive: stem, branch: named, landed: remote.refs.has(stem) }
}

/** currentBranch names this worktree's branch, or undefined on a detached HEAD. */
async function currentBranch(
  dependencies: MergeWithMainDependencies,
  root: string,
): Promise<string | undefined> {
  const result = await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: root,
    stdio: 'pipe',
  })
  const name = (result.stdout ?? '').trim()
  return name.length > 0 ? name : undefined
}

/** Validate the human-authored part of a squash commit message. */
export function validateMergeMessage(source: string): string {
  const message = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\n+$/u, '')
  const lines = message.split('\n')
  const summary = lines[0] ?? ''

  if (summary.trim().length === 0) {
    Errors.throwUserInput('The merge message must start with a summary line.')
  }
  if (summary.length > 72) {
    Errors.throwUserInput('The merge message summary must be at most 72 characters.')
  }
  if (lines[1] !== '') {
    Errors.throwUserInput('The merge message summary must be followed by one blank line.')
  }
  // A bullet may wrap onto indented continuation lines. Requiring each one to occupy a single
  // physical line bought nothing — the appendix Git generates below it is already wrapped — and
  // pushed authors into 240-character lines that no diff or terminal shows whole.
  if (lines.length < 3 || !/^- \S/u.test(lines[2] ?? '')) {
    Errors.throwUserInput('The merge message must continue with a `- ...` bullet after the summary.')
  }
  if (lines.slice(3).some(line => !/^- \S/u.test(line) && !/^ +\S/u.test(line))) {
    Errors.throwUserInput(
      'The merge message must end with a contiguous bullet block: every line after the first bullet '
        + 'either starts a new `- ...` bullet or is an indented continuation of the one above it.',
    )
  }
  assertNoAutomatedAttribution(message)
  if (/^Squashed commit of the following:/mu.test(message)) {
    Errors.throwUserInput("Do not hand-write the squash appendix; merge-with-main appends Git's generated appendix.")
  }

  return message
}

function assertNoAutomatedAttribution(message: string): void {
  // Indentation included: the squash appendix quotes each landed commit's body indented by four
  // spaces, so an attribution trailer arrives shifted right and used to slip past this check.
  if (/^[ \t]*(?:co-authored-by|generated(?:-by|-with)?|ai-assisted-by|assisted-by):\s*\S/imu.test(message)) {
    Errors.throwUserInput('The merge message must not contain automated-author attribution.')
  }
}

/** Parse `git worktree list --porcelain` without depending on human-formatted columns. */
export function parseWorktrees(source: string): Worktree[] {
  return source.trim().split(/\n\n+/u).filter(Boolean).flatMap(block => {
    const fields = new Map(
      block.split('\n').map(line => {
        const separator = line.indexOf(' ')
        return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
      }),
    )
    // A prunable record no longer names a usable checkout. Preflight is deliberately read-only,
    // so it ignores the record and leaves cleanup to an explicit `git worktree prune`.
    if (fields.has('prunable')) {
      return []
    }
    const path = fields.get('worktree')
    const head = fields.get('HEAD')
    if (!path || !head) {
      Errors.throwUnexpected('Git returned an incomplete worktree record.', { details: { block } })
    }
    return [{ branch: fields.get('branch')?.replace(/^refs\/heads\//u, ''), head, path: FS.resolvePath(path) }]
  })
}

/** Read-only preflight shared by dry-run and execution. */
export async function inspectMergePreflight(
  options: Pick<MergeWithMainOptions, 'messageFile' | 'repositoryRoot'> = {},
  dependencies: MergeWithMainDependencies = defaultDependencies,
): Promise<MergePreflight> {
  const featureRoot = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
  const branchResult = await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  if (branchResult.exitCode !== 0 && branchResult.exitCode !== 1) {
    assertCommandSucceeded(branchResult)
  }
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : ''
  if (!LANDABLE_PREFIXES.some(prefix => branch.startsWith(prefix))) {
    Errors.throwUserInput(
      `merge-with-main requires a ${LANDABLE_PREFIXES.map(prefix => `${prefix}*`).join(' or ')} branch; `
        + `this worktree is on '${branch || 'detached HEAD'}'.`,
    )
  }

  const featureStatus = await status(dependencies, featureRoot)
  assertClean('feature', featureRoot, featureStatus)
  const branchHead = (await git(dependencies, featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  const worktrees = parseWorktrees(
    (await git(dependencies, featureRoot, ['worktree', 'list', '--porcelain'])).stdout,
  )
  const featureWorktrees = worktrees.filter(worktree => worktree.branch === branch)
  if (featureWorktrees.length !== 1 || featureWorktrees[0]?.path !== featureRoot) {
    Errors.throwUserInput(`Branch '${branch}' must be checked out only in the invoking worktree.`)
  }
  // A landing moves `refs/heads/main` and builds its commit with plumbing, so it needs no checkout
  // on main and must not have one. A checked-out branch is a promise that a worktree's index and
  // files match it: move the ref underneath and `git status` there reports the whole landing as
  // uncommitted deletions. Worse, a shared checkout left holding a staged squash is work any other
  // agent's `git commit` can pick up, which is how a landing once reached main as someone else's
  // commit. Mirrors are detached instead, and this command moves them forward itself.
  const mainWorktrees = worktrees.filter(worktree => worktree.branch === MAIN_BRANCH)
  if (mainWorktrees.length > 0) {
    Errors.throwUserInput(
      `No worktree may have '${MAIN_BRANCH}' checked out while landing; ${
        mainWorktrees.map(worktree => worktree.path).join(', ')
      } does. Main is a ref this command moves, not a workspace: switch that checkout to a branch of `
        + `its own (git -C <path> switch -c <name>), or make it a mirror that follows main `
        + `(git -C <path> checkout --detach ${MAIN_BRANCH}).`,
    )
  }
  // Read through the ref rather than through a checkout's HEAD, so both cases answer identically.
  const localMain = await dependencies.run('git', {
    args: ['rev-parse', '--verify', '--quiet', `refs/heads/${MAIN_BRANCH}`],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  if (localMain.exitCode !== 0) {
    Errors.throwUserInput(
      `This checkout has no local '${MAIN_BRANCH}' branch to merge onto; `
        + `create it from ${REMOTE}/${MAIN_BRANCH} before landing.`,
    )
  }
  const mainHead = localMain.stdout.trim()
  const mirrorRoots = await readMirrorRoots(dependencies, worktrees, mainHead)

  const archive = archiveName(branch, dependencies.now())
  const stem = archiveStem(branch)
  const remote = await remoteHeads(
    dependencies,
    featureRoot,
    branch.startsWith('dev/') ? [MAIN_BRANCH, branch, archive, stem] : [MAIN_BRANCH, branch, archive],
  )
  const remoteRefs = remote.refs
  const remoteMainHead = remoteRefs.get(MAIN_BRANCH)
  if (!remoteMainHead) {
    Errors.throwHostEnvironment(`Remote '${REMOTE}' did not report refs/heads/main.`)
  }
  // Neither "local main is current" nor "main is merged into the branch" is a precondition any
  // more. Both are things the landing does for itself, under the lock, in the one place where the
  // answer cannot go stale between the check and the act.
  const localMainCurrent = mainHead === remoteMainHead
  // A remote feature branch left behind by earlier commits is the ordinary case, not an obstacle:
  // execution pushes it forward. Only a remote holding commits this worktree lacks must stop the
  // landing, because the squash would silently drop them.
  const remoteFeatureHead = remoteRefs.get(branch)
  let remoteFeatureBehind = false
  if (remoteFeatureHead !== undefined && remoteFeatureHead !== branchHead) {
    const contained = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', remoteFeatureHead, branchHead],
      cwd: featureRoot,
    })
    if (contained.exitCode !== 0) {
      Errors.throwUserInput(
        `${REMOTE}/${branch} (${shortSha(remoteFeatureHead)}) is not contained in this worktree's HEAD; `
          + 'fetch and reconcile it before landing the branch.',
      )
    }
    remoteFeatureBehind = true
  }
  const remoteMergedHead = remoteRefs.get(archive)
  if (remoteMergedHead !== undefined) {
    Errors.throwUserInput(`Remote archive branch '${archive}' already exists.`)
  }
  // `refs/heads/merged/ro` and `refs/heads/merged/ro/<time>` cannot exist together: Git stores the
  // first as a file and the second needs that path to be a directory.
  if (branch.startsWith('dev/') && remoteRefs.get(stem) !== undefined) {
    Errors.throwUserInput(
      `Remote archive '${stem}' is one ref, so a dated archive under '${stem}/' cannot be created beside it. `
        + `Move '${stem}' to '${stem}/<date-time>' first.`,
    )
  }

  const ancestor = await dependencies.run('git', {
    args: ['merge-base', '--is-ancestor', remoteMainHead, branchHead],
    cwd: featureRoot,
  })
  if (ancestor.exitCode !== 0 && ancestor.exitCode !== 1) {
    assertCommandSucceeded(ancestor)
  }
  const mainIntegrated = ancestor.exitCode === 0

  const messageFile = FS.resolvePath(options.messageFile ?? `.artifacts/merge/${branch}.msg`, featureRoot)
  if (!await dependencies.exists(messageFile)) {
    Errors.throwUserInput(`Merge message file does not exist: ${messageFile}`)
  }
  const message = validateMergeMessage(await dependencies.readText(messageFile))
  const warnings = await fullRunWarnings(dependencies, featureRoot)

  return {
    archive,
    branch,
    branchHead,
    featureRoot,
    localMainCurrent,
    mainHead,
    mainIntegrated,
    message,
    messageFile,
    mirrorRoots,
    remoteFeatureHead,
    remoteFeatureBehind,
    remoteMainHead,
    remoteMergedHead,
    remoteTransport: remote.transport,
    warnings,
  }
}

/**
 * readMirrorRoots finds the checkouts that exist to show what main holds. A mirror is detached at
 * main's tip and clean, which is what makes it safe to move: nothing is being edited there, and no
 * ref points at it, so this command can fast-forward its files the moment main moves. A worktree
 * detached anywhere else is someone reading history and is left alone; a dirty one is someone's
 * work, whatever its HEAD says.
 */
async function readMirrorRoots(
  dependencies: MergeWithMainDependencies,
  worktrees: readonly Worktree[],
  mainHead: string,
): Promise<string[]> {
  const candidates = worktrees.filter(worktree => worktree.branch === undefined && worktree.head === mainHead)
  const mirrors: string[] = []
  for (const candidate of candidates) {
    if (await status(dependencies, candidate.path) === '') {
      mirrors.push(candidate.path)
    }
  }
  return mirrors
}

/** MergeWithMainCommand is the CLI wiring surface consumed by `dev.ts`. */
export const MergeWithMainCommand = {
  async run(
    options: MergeWithMainOptions = {},
    dependencies: MergeWithMainDependencies = defaultDependencies,
  ): Promise<MergeWithMainResult> {
    if (options.abortSnapshot !== undefined) {
      if (
        options.dryRun === true
        || options.skipAll === true
        || options.skipVerifyFull === true
        || options.skipVerify === true
        || options.messageFile !== undefined
      ) {
        Errors.throwUserInput('--abort cannot be combined with the options that start a merge.')
      }
      return await abortMerge(dependencies, options.abortSnapshot)
    }
    if (options.skipAll !== true && options.skipVerify === true && options.skipVerifyFull === true) {
      Errors.throwUserInput(
        '--skip-verify-full and --skip-verify cannot be combined directly because that would run no '
          + 'verification without confirmation. Use --skip-all to require the explicit interactive confirmation.',
      )
    }

    const preflight = await inspectMergePreflight(options, dependencies)
    if (options.dryRun === true) {
      const lines = formatDryRun(preflight, options)
      writeLines(dependencies, lines)
      return { lines, mode: 'dry-run' }
    }

    await authorizeExecution(options, dependencies, preflight)
    // Everything above this line is unlocked, and everything below it is one process holding the
    // lock from the first ref it touches to the last, with a `finally` that gives the lock back
    // whichever way the transaction ends. Nothing between two commands waits on an agent any more:
    // that gap — not the merge, which measured 2-94s — is what held the lock for 36-44 minutes.
    const acquisition = await acquireLandingLease(dependencies, preflight)
    const lease = acquisition.lease
    const landingStartedAt = dependencies.now()
    let landingError: unknown
    try {
      // Queue-side merges change HEAD, and another landing may move main during the wait. Refresh
      // the preflight whenever either ref changed; an uncontended landing avoids a second remote
      // query (and preserves the same evidence its existing tests exercise).
      const currentHead = (await git(dependencies, preflight.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      const currentMain = (await git(dependencies, preflight.featureRoot, ['rev-parse', `refs/heads/${MAIN_BRANCH}`]))
        .stdout.trim()
      const lockedPreflight = !acquisition.waited && currentHead === preflight.branchHead
          && currentMain === preflight.mainHead
        ? preflight
        : await inspectMergePreflight(options, dependencies)
      if (lockedPreflight.branch !== preflight.branch) {
        Errors.throwUserInput('The feature branch changed while waiting for its landing turn.')
      }
      const snapshot = await createSnapshot(lockedPreflight, dependencies)
      writeLines(dependencies, [
        ...lockedPreflight.warnings.map(warning => `WARN  ${warning}`),
        `PASS  Landing lock held for ${lockedPreflight.branch}; every step below runs inside it.`,
        `PASS  Safety snapshot: ${snapshot.snapshotPath}`,
      ])

      await stabilizeAndVerify(snapshot, options, dependencies)
      await verifyLandingSubject(snapshot, options, dependencies)
      await beginPhase(lockedPreflight.featureRoot, 'push', dependencies)
      await landSquash(snapshot, lockedPreflight, dependencies)
      await pushArchiveAndPreserve(snapshot, dependencies)

      const completed = [
        `PASS  Merged '${lockedPreflight.branch}' into main and archived it as ${lockedPreflight.archive}.`,
        `PASS  Preserved the clean invoking worktree at ${lockedPreflight.featureRoot} on detached HEAD; `
        + 'run `./agent start-branch feat/<name>` for the next slice, or archive its owning task.',
      ]
      writeLines(dependencies, completed, 'success')
      return { lines: completed, mode: 'executed', snapshotPath: snapshot.snapshotPath }
    } catch (error) {
      landingError = error
      throw error
    } finally {
      await dependencies.endPhases(preflight.featureRoot)
      // Before the release: the phases being recorded live on the lock record the release removes.
      await dependencies.recordLanding?.({
        branch: preflight.branch,
        endedAt: dependencies.now(),
        ...(landingError === undefined ? {} : { error: landingError }),
        repositoryRoot: preflight.featureRoot,
        startedAt: landingStartedAt,
      })
      await lease.release()
    }
  },
} as const

/**
 * LandingIntegrationConflictError is the one failure that ends the lock rather than the landing.
 *
 * Resolving a conflict is a person's or an agent's work, measured in model turns, and holding the
 * machine-wide lock through it would put the long hold straight back inside the transaction it was
 * moved out of. So the conflicted worktree is left exactly as Git left it, the lock goes back — the
 * durable claim included, because a claim that outlives `release` by design would otherwise keep the
 * machine blocked through the whole resolution — and the landing is simply re-run afterwards.
 */
export class LandingIntegrationConflictError extends Errors.UserInputError {}

/**
 * The lock is ended here, not just released. `release` without a token deliberately survives a
 * durable `land-lock` claim, and that is right everywhere except this path: the agent that claimed
 * the lock is about to spend an unbounded number of turns resolving a conflict, and nothing else on
 * the machine should wait behind that.
 */
async function endLockForConflictResolution(
  featureRoot: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await dependencies.endDurableClaim(featureRoot).catch((error: unknown) => {
    HCI.writeLine(
      `WARN  Could not end this worktree's durable landing-lock claim after the conflict: ${
        error instanceof Error ? error.message : String(error)
      } Release it with \`./dev land-unlock\` before resolving.`,
    )
  })
}

/** Record which phase of the landing the lock is being spent on; telemetry never fails a landing. */
async function beginPhase(
  featureRoot: string,
  name: LandingPhaseName,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await dependencies.beginPhase(featureRoot, name)
}

/**
 * Landing moves refs, and two landings at once would move the same ones. The lease is the only thing
 * that serializes them: `update-ref`'s compare-and-swap catches a peer that already moved `main`, but
 * only after this run has paid for a full verification, and nothing at all protects the archive push
 * or the branch deletion that follow.
 *
 * It is a file in the machine-wide registry, so it needs no network and is correct offline — which is
 * the case that matters most, because with `commit-tree` and `update-ref` a landing moves local `main`
 * whether or not a remote is ever reached. That local ref is what a second landing would race.
 *
 * Waiting is the behavior, not a fallback: there is no flag to skip it, and no takeover, because
 * ending someone else's landing part-way is not a decision to make on their behalf.
 */
async function acquireLandingLease(
  dependencies: MergeWithMainDependencies,
  preflight: MergePreflight,
): Promise<{ lease: MachineResourceLease; waited: boolean }> {
  let checkedAt = 0
  let waited = false
  const onQueueWait = async () => {
    waited = true
    const now = Date.now()
    if (now - checkedAt < 15_000) {
      return
    }
    checkedAt = now
    await remoteHeads(dependencies, preflight.featureRoot, [MAIN_BRANCH])
    await runChecked(dependencies, 'git', ['fetch', '--prune', REMOTE], preflight.featureRoot)
    const current = (await git(dependencies, preflight.featureRoot, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`]))
      .stdout.trim()
    if (current.length === 0) {
      Errors.throwHostEnvironment(`Remote '${REMOTE}' stopped reporting main.`)
    }
    const head = (await git(dependencies, preflight.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    const ancestor = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', current, head],
      cwd: preflight.featureRoot,
    })
    if (ancestor.exitCode === 0) {
      return
    }
    if (ancestor.exitCode !== 1) {
      assertCommandSucceeded(ancestor)
    }
    const merged = await dependencies.run('git', {
      args: ['merge', '--no-edit', current],
      cwd: preflight.featureRoot,
      stdio: 'pipe',
    })
    if (merged.exitCode !== 0) {
      Errors.throwUserInput(
        `Merging main while queued conflicted. This landing left the ready queue without taking `
          + 'the lock. Resolve the conflict, commit the merge, then run `./agent land` again.',
      )
    }
    dependencies.writeLine(
      `PASS  Refreshed queued branch with main at ${shortSha(current)}; full verification waits for the lock.`,
    )
  }
  const request = async (waitTimeoutMs: number) =>
    await dependencies.acquireLease({
      command: `merge-with-main ${preflight.branch}`,
      name: LANDING_RESOURCE_NAME,
      repositoryRoot: preflight.featureRoot,
      waitTimeoutMs,
      onQueueWait,
    })
  const lease = await request(LEASE_WAIT_TIMEOUT_MS)
  return { lease, waited }
}

/**
 * The landing takes the same lock the broad verification lanes take, and takes it through this
 * adapter so the rest of this command keeps the lease shape its tests inject.
 *
 * Using one lock is not a tidiness preference. While `verify` took the landing lock and the landing
 * took a separate resource lease, two agents could acquire the two in opposite orders — one holding
 * the lock and waiting for the lease, the other holding the lease and waiting for the lock — and
 * wedge each other with no timeout on either. One lock cannot deadlock against itself.
 *
 * Re-entrancy is the other half: an agent that claimed the lock with `land-lock` already owns this
 * right, so it must not queue behind itself, and the release must leave that lock held because the
 * agent took it deliberately and returns it itself.
 */
const acquireLandingLock: MergeWithMainDependencies['acquireLease'] = async options => {
  const repositoryRoot = options.repositoryRoot
  const hold = await LandingLock.acquire({
    label: options.command,
    // Marks the hold a landing rather than a lane, which is what makes the board's phase report
    // meaningful and what stops new diff-scoped lanes being admitted beside it.
    landing: true,
    ...(options.onQueueWait === undefined ? {} : { onQueueWait: options.onQueueWait }),
    // Without this a landing blocked behind an abandoned lock says nothing for the whole six-hour
    // wait. Nothing will break the lock for it, so saying who holds it, repeatedly, is the only
    // way the wait ever reaches a person.
    onWaiting: (holder, waitedMs) => {
      HCI.writeLine(LandingLock.describeWaiting(holder, waitedMs))
    },
    repositoryRoot,
    ...(options.registryRoot === undefined ? {} : { registryRoot: options.registryRoot }),
    ...(options.waitTimeoutMs === undefined ? {} : { waitTimeoutMs: options.waitTimeoutMs }),
  }).catch((error: unknown) => {
    if (error instanceof LandingLockBusyError) {
      throw new MachineResourceBusyError({
        command: error.holder.label,
        id: `landing-lock-${error.holder.pid}`,
        name: options.name,
        pid: error.holder.pid,
        repositoryRoot: error.holder.holder,
        startedAt: error.holder.acquiredAt,
      })
    }
    throw error
  })
  return {
    owner: {
      command: hold.record.label,
      id: `landing-lock-${hold.record.pid}`,
      name: options.name,
      pid: hold.record.pid,
      repositoryRoot: hold.record.holder,
      startedAt: hold.record.acquiredAt,
    },
    // Returns exactly this hold. A durable claim the agent made with `land-lock` has no token and
    // is therefore left standing, which is what lets one agent verify, land, and then unlock.
    // Called from a `finally`, so it must not throw: a release that fails after the squash already
    // moved `main` would replace the landing's own outcome with a lock error, or mask the error the
    // caller actually needs. It warns instead, naming the lock that is still on disk.
    release: async () => {
      await LandingLock.release({
        repositoryRoot,
        ...(options.registryRoot === undefined ? {} : { registryRoot: options.registryRoot }),
        ...(hold.token === undefined ? {} : { token: hold.token }),
      }).catch((error: unknown) => {
        HCI.writeLine(
          `WARN  Could not release the landing lock: ${
            error instanceof Error ? error.message : String(error)
          } Clear it with \`./dev land-unlock --force\` before the next landing.`,
        )
      })
    },
  }
}

/**
 * Append a finished landing, its phases read off the lock record it still holds, to the history
 * every worktree shares. A landing's own log lives in a checkout; this outlives it.
 */
async function recordLanding(landing: FinishedLanding): Promise<void> {
  try {
    const lock = await LandingLock.inspect().catch(() => undefined)
    const ownLock = lock !== undefined && FS.resolvePath(lock.holder) === FS.resolvePath(landing.repositoryRoot)
    const reason = landing.error === undefined
      ? undefined
      : (landing.error instanceof Error ? landing.error.message : String(landing.error)).split('\n')[0]?.slice(0, 300)
    await RunHistory.recordLanding({
      branch: landing.branch,
      elapsedMs: landing.endedAt.getTime() - landing.startedAt.getTime(),
      endedAt: landing.endedAt.toISOString(),
      kind: 'landing',
      ...(ownLock ? { phases: lock.phases } : {}),
      ...(reason === undefined ? {} : { reason }),
      repositoryRoot: landing.repositoryRoot,
      startedAt: landing.startedAt.toISOString(),
      status: landing.error === undefined ? 'passed' : 'failed',
    })
  } catch {
    // A landing's outcome is the landing's; a lost history line must never replace it.
  }
}

/** Report whether the feature branch's `just verify-full` pass is skipped, and by which flag. */
function fullVerifySkippedBy(options: MergeWithMainOptions): string | undefined {
  return options.skipVerifyFull === true ? '--skip-verify-full' : options.skipAll === true ? '--skip-all' : undefined
}

/** Report whether the fallback `just verify --complete` pass is skipped, and by which flag. */
function stagedVerifySkippedBy(options: MergeWithMainOptions): string | undefined {
  return options.skipVerify === true ? '--skip-verify' : options.skipAll === true ? '--skip-all' : undefined
}

function formatDryRun(preflight: MergePreflight, options: MergeWithMainOptions): string[] {
  const command = executionCommand(options)
  const fullVerifySkip = fullVerifySkippedBy(options)
  const stagedVerifySkip = stagedVerifySkippedBy(options)
  return [
    `PASS  Feature branch: ${preflight.branch} at ${shortSha(preflight.branchHead)}`,
    `PASS  Feature worktree clean: ${preflight.featureRoot}`,
    `PASS  No worktree has ${MAIN_BRANCH} checked out; local main is at ${shortSha(preflight.mainHead)}.`,
    preflight.localMainCurrent
      ? `PASS  Local main is already at ${REMOTE}/main.`
      : `PLAN  Fast-forward local main to ${REMOTE}/main (${shortSha(preflight.remoteMainHead)}) inside the lock.`,
    preflight.mainIntegrated
      ? `PASS  ${REMOTE}/main is an ancestor of the feature branch.`
      : `PLAN  Merge ${REMOTE}/main into '${preflight.branch}' inside the lock, before any gate runs.`,
    `PASS  Merge message: ${preflight.messageFile}`,
    `PASS  Remote '${REMOTE}' is reachable.`,
    ...preflight.warnings.map(warning => `WARN  ${warning}`),
    ...(preflight.mirrorRoots.length > 0
      ? [`PLAN  Move ${preflight.mirrorRoots.length} main mirror(s) forward: ${preflight.mirrorRoots.join(', ')}.`]
      : []),
    'PLAN  Write a safety snapshot before moving any ref.',
    ...(preflight.remoteFeatureBehind
      ? [`PLAN  Keep the behind ${REMOTE}/${preflight.branch} unchanged until the verified archive replaces it.`]
      : []),
    ...(options.skipAll === true
      ? ['PLAN  Ask once, defaulting to No, whether to merge with nothing verified at all.']
      : []),
    'PLAN  Take the machine-wide landing lock, waiting for any landing already holding it. Everything '
    + 'below this line happens inside one process, under that lock, and releases it whichever way it ends.',
    options.skipAll === true
      ? `PLAN  Skip the ${LAND_BARRIER_LANE} cheap-gate barrier because --skip-all was passed.`
      : `PLAN  Run the cheap-gate barrier (just ${LAND_BARRIER_LANE}) and release immediately if it fails, `
        + 'rather than spending the expensive suites to learn the same thing.',
    fullVerifySkip === undefined
      ? 'PLAN  Run just verify-full on the feature branch.'
      : `PLAN  Skip just verify-full on the feature branch because ${fullVerifySkip} was passed.`,
    `PLAN  If ${REMOTE}/main moved while verifying, merge it and restart (at most ${MAX_STABILIZATION_PASSES} passes).`,
    fullVerifySkip === undefined
      ? 'PLAN  Land the verified feature tree itself; full verification proved exactly those bytes.'
      : stagedVerifySkip === undefined
      ? 'PLAN  Run just verify --complete on the feature branch, because nothing else verified it.'
      : `PLAN  Skip just verify --complete because ${stagedVerifySkip} was passed; `
        + 'no lane will have verified these bytes.',
    'PLAN  Build the squash commit with git commit-tree and move refs/heads/main to it only if it has '
    + 'not moved.',
    'PLAN  Push main, archive the remote feature branch, detach its clean worktree, delete its local branch, and prune.',
    'PLAN  Preserve the invoking worktree and shell until its owning task is archived.',
    `DRY RUN  No refs or worktrees changed. Land it with: ${command}`,
  ]
}

function executionCommand(options: MergeWithMainOptions): string {
  // The plain invocation performs the landing, so the printed command carries only the options this
  // run actually asked for; nothing has to be added to make it do its job.
  const parts = ['./dev', 'merge-with-main']
  if (options.skipAll === true) {
    parts.push('--skip-all')
  }
  if (options.skipVerifyFull === true) {
    parts.push('--skip-verify-full')
  }
  if (options.skipVerify === true) {
    parts.push('--skip-verify')
  }
  if (options.messageFile !== undefined) {
    parts.push('--message-file', shellQuote(options.messageFile))
  }
  return parts.join(' ')
}

function shellQuote(value: string): string {
  return /^[\w./:@+-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * The plain invocation is the authorization: it performs the landing and pushes without a prompt.
 * Only `--skip-all` still asks, because it is the one combination that lands unverified bytes.
 */
async function authorizeExecution(
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
  preflight: MergePreflight,
): Promise<void> {
  if (options.skipAll !== true) {
    return
  }
  if (!dependencies.isInteractive()) {
    Errors.throwUserInput(
      '--skip-all needs an interactive terminal to confirm; there is no flag that pre-answers its prompt.',
    )
  }
  if (!await dependencies.askConfirm(skipAllPrompt(preflight.branch))) {
    Errors.throwUserInput('Merge cancelled before changing repository state.')
  }
}

function skipAllPrompt(branch: string): string {
  return `--skip-all runs no cheap-gate barrier, no fix, no typecheck, no lint, no tests, `
    + `no just verify-full on '${branch}', `
    + 'and no just verify --complete on the staged squash. An unverified squash of '
    + `'${branch}' would then be pushed to main, whose linear history is the product of squashing, `
    + 'so it cannot be fast-forwarded away afterwards. Really merge with nothing checked at all?'
}

async function createSnapshot(
  preflight: MergePreflight,
  dependencies: MergeWithMainDependencies,
): Promise<MergeSnapshot> {
  const createdAt = dependencies.now().toISOString()
  const stamp = `${createdAt.replaceAll(/[:.]/gu, '-')}-${Platform.randomUUID().slice(0, 8)}`
  // A snapshot is what `--abort` restores from, and the invoking worktree is preserved through
  // success and failure alike, so it is the one place a snapshot is always still there to read.
  const snapshotPath = FS.resolvePath(`.artifacts/merge/${stamp}.json`, preflight.featureRoot)
  const [featureTree, featureIndexTree] = await Promise.all([
    git(dependencies, preflight.featureRoot, ['rev-parse', 'HEAD^{tree}']).then(result => result.stdout.trim()),
    git(dependencies, preflight.featureRoot, ['write-tree']).then(result => result.stdout.trim()),
  ])
  const snapshot: MergeSnapshot = {
    archive: preflight.archive,
    branch: preflight.branch,
    createdAt,
    currentFeatureDiff: '',
    currentFeatureHead: preflight.branchHead,
    currentFeatureStatus: '',
    currentMainHead: preflight.mainHead,
    featureHead: preflight.branchHead,
    featureIndexTree,
    featureRoot: preflight.featureRoot,
    featureTree,
    mainHead: preflight.mainHead,
    messageFile: preflight.messageFile,
    phase: 'prepared',
    remoteFeatureHead: preflight.remoteFeatureHead,
    remoteMainHead: preflight.remoteMainHead,
    remoteTransport: preflight.remoteTransport,
    snapshotPath,
    version: SNAPSHOT_VERSION,
  }
  await persistSnapshot(snapshot, dependencies)
  return snapshot
}

async function stabilizeAndVerify(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  for (let pass = 1; pass <= MAX_STABILIZATION_PASSES; pass += 1) {
    await beginPhase(snapshot.featureRoot, 'integrating', dependencies)
    await assertExpectedLocalState(snapshot, dependencies)
    const fetchedMain = await refreshRemoteMain(snapshot, dependencies)
    const featureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    const ancestor = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', fetchedMain, featureHead],
      cwd: snapshot.featureRoot,
    })
    if (ancestor.exitCode === 1) {
      await integrateMain(snapshot, fetchedMain, dependencies)
    } else {
      assertCommandSucceeded(ancestor)
    }
    await runBarrier(snapshot, options, dependencies)

    const fullVerifySkip = fullVerifySkippedBy(options)
    if (fullVerifySkip === undefined) {
      // One phase, not two, for one process. `just verify-full` runs the repository suites and the
      // host gates in a single `./dev gates` run, and nothing outside that process can see it cross
      // from one to the other; `LANDING_PHASES` names both because the phase this reports will split
      // in two as soon as `GateRunner` can say when it does.
      await beginPhase(snapshot.featureRoot, 'repository tests', dependencies)
      const verifiedHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      await runVerificationLane(snapshot, ['verify-full'], 'feature-verified', dependencies)
      if (
        snapshot.currentFeatureHead !== verifiedHead
        || snapshot.currentFeatureStatus !== ''
      ) {
        Errors.throwUnexpected('Full verification changed the feature branch or its tracked worktree state.')
      }
    } else {
      dependencies.writeLine(
        `WARN  Skipped just verify-full on '${snapshot.branch}' because ${fullVerifySkip} `
          + 'was passed.',
      )
      await advanceSnapshot(snapshot, 'feature-verified', dependencies)
    }

    const remoteMain = (
      await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH])
    ).refs.get(MAIN_BRANCH)
    if (!remoteMain) {
      Errors.throwHostEnvironment(`Remote '${REMOTE}' stopped reporting refs/heads/main.`)
    }
    if (remoteMain === fetchedMain) {
      snapshot.remoteMainHead = remoteMain
      await persistSnapshot(snapshot, dependencies)
      const mainHead = await readMainRef(snapshot, dependencies)
      if (mainHead !== fetchedMain) {
        // Keep main untouched until the feature has been fully verified against the stable remote
        // head. A red full verification can therefore only leave command-owned feature changes.
        // Compare-and-swap, so a peer landing at the same moment loses the race rather than the ref.
        await moveMainRef(snapshot, fetchedMain, mainHead, dependencies)
        await advanceSnapshot(snapshot, 'feature-verified', dependencies)
      }
      return
    }
    if (pass === MAX_STABILIZATION_PASSES) {
      await advanceSnapshot(snapshot, 'failed', dependencies)
      Errors.throwHostEnvironment(
        `${REMOTE}/main moved during ${MAX_STABILIZATION_PASSES} consecutive verification passes; `
          + 'stop and retry when main is stable.',
      )
    }
    dependencies.writeLine(
      `WARN  ${REMOTE}/main moved during verification; integrating it and restarting full verification `
        + `(pass ${pass + 1}/${MAX_STABILIZATION_PASSES}).`,
    )
  }
}

/**
 * Merge `origin/main` into the branch, inside the lock, where the answer cannot go stale.
 *
 * A conflict here is not a landing failure to retry: it is work for a person or an agent, and the
 * conflicted worktree is left exactly as Git wrote it. The lock goes back first — released by the
 * caller's `finally`, and its durable claim ended here — because resolution is model turns, and
 * holding the machine through them is the one thing this whole transaction exists to stop.
 */
async function integrateMain(
  snapshot: MergeSnapshot,
  fetchedMain: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  try {
    await runAndSnapshot(
      snapshot,
      'git',
      ['merge', '--no-edit', fetchedMain],
      snapshot.featureRoot,
      'feature-integrated',
      dependencies,
      { mutation: 'feature' },
    )
  } catch (error) {
    const unmerged = (await dependencies.run('git', {
      args: ['diff', '--name-only', '--diff-filter=U'],
      cwd: snapshot.featureRoot,
      stdio: 'pipe',
    })).stdout.trim().split('\n').filter(Boolean)
    if (unmerged.length === 0) {
      throw error
    }
    await endLockForConflictResolution(snapshot.featureRoot, dependencies)
    throw new LandingIntegrationConflictError(
      `Integrating ${REMOTE}/main at ${shortSha(fetchedMain)} into '${snapshot.branch}' conflicted, so this `
        + 'landing released the landing lock and stopped. Nothing was pushed and main was not moved.\n'
        + `Conflicting paths:\n${unmerged.map(path => `- ${path}`).join('\n')}\n`
        + 'Resolve them here, unlocked — the machine is free for everyone else while you do — commit the '
        + 'merge with `git commit --no-edit`, and run `./agent land` again. The landing re-integrates '
        + 'whatever main has become by then, so nothing you do now has to anticipate it.',
    )
  }
}

/**
 * The cheap-gate barrier, run after integrating main and before anything expensive.
 *
 * It runs the gates in **check** mode rather than the `_fix-*` fixers the verify lanes use, and that
 * is the whole point of putting it here. A fixer inside the transaction writes to the tree this
 * landing is about to commit, and `verifyLandingSubject` then refuses the landing outright with
 * `Verification changed the tree this landing was about to commit.` — so the fixers would turn a
 * one-line formatting drift into a failed landing that has already paid for the barrier. Committing
 * their output instead would be worse: main would gain bytes no author wrote, no reviewer read, and
 * no merge message describes. Check mode fails in about 30s, names the file, and hands the tree back
 * clean and unlocked so `just fix` can run where it belongs. The fixers still run later inside
 * `verify-full`, where a check-clean tree makes them no-ops.
 */
async function runBarrier(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await beginPhase(snapshot.featureRoot, 'cheap gates', dependencies)
  // `--skip-all` is the one flag that means nothing at all, confirmed at a terminal against a prompt
  // that says so in those words. A barrier that ran anyway would make that prompt a lie.
  if (options.skipAll === true) {
    dependencies.writeLine(
      `WARN  Skipped the ${LAND_BARRIER_LANE} cheap-gate barrier because --skip-all was passed; `
        + 'no gate will have looked at these bytes.',
    )
    return
  }
  await runVerificationLane(snapshot, [LAND_BARRIER_LANE], snapshot.phase, dependencies)
}

async function refreshRemoteMain(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<string> {
  await runChecked(dependencies, 'git', ['fetch', '--prune', REMOTE], snapshot.featureRoot, true)
  return (await git(dependencies, snapshot.featureRoot, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`])).stdout.trim()
}

/**
 * verifyLandingSubject proves the bytes about to become main's next commit.
 *
 * The subject is the feature head's tree, because preflight required main to be merged into the
 * branch first: squashing that branch onto main can only produce the tree the branch already has.
 * So when full verification ran, it ran on exactly these bytes and nothing is re-run; when it was
 * skipped, this is where `just verify --complete` happens — on the feature worktree, which is the
 * only checkout involved in a landing at all.
 */
async function verifyLandingSubject(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await assertExpectedLocalState(snapshot, dependencies)
  const featureTree = await readFeatureTree(snapshot, dependencies)
  await advanceSnapshot(snapshot, 'squashed', dependencies)
  const fullVerifySkip = fullVerifySkippedBy(options)
  const stagedVerifySkip = stagedVerifySkippedBy(options)
  if (fullVerifySkip === undefined) {
    writeLines(dependencies, [
      `PASS  Landing the fully verified feature tree ${shortSha(featureTree)} itself; `
      + 'not verifying the same bytes twice.',
    ])
    await advanceSnapshot(snapshot, 'main-verified', dependencies)
  } else if (stagedVerifySkip === undefined) {
    // Nothing has verified this branch yet, so this is where it happens.
    await runVerificationLane(snapshot, ['verify', '--complete'], 'main-verified', dependencies)
  } else {
    writeLines(dependencies, [
      `WARN  Skipped just verify --complete on feature tree ${shortSha(featureTree)} because `
      + `${stagedVerifySkip} was passed; no lane verified these bytes.`,
    ])
    await advanceSnapshot(snapshot, 'main-verified', dependencies)
  }
  if (await readFeatureTree(snapshot, dependencies) !== featureTree) {
    Errors.throwUnexpected('Verification changed the tree this landing was about to commit.')
  }
}

/**
 * landSquash builds main's next commit and moves the ref to it, without a working tree anywhere.
 *
 * A commit is a tree, its parents, and a message, and `git commit-tree` makes one from those three
 * directly. Nothing is staged, so there is no window in which a shared checkout holds this landing's
 * work for another process to commit, and a landing that fails leaves nothing behind at all: the
 * commit exists only from the moment the ref moves to it.
 *
 * The ref moves by compare-and-swap. `git update-ref` with an expected old value refuses when a peer
 * landed first, which turns a race into a clean refusal instead of a check that can only report the
 * damage afterwards.
 */
async function landSquash(
  snapshot: MergeSnapshot,
  preflight: MergePreflight,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const featureTree = await readFeatureTree(snapshot, dependencies)
  const appendix = await squashAppendix(snapshot, dependencies)
  const commitMessagePath = `${snapshot.snapshotPath}.commit-message`
  const finalMessage = `${preflight.message}\n\n${appendix}\n`
  assertNoAutomatedAttribution(finalMessage)
  await dependencies.writeText(commitMessagePath, finalMessage)
  const landed = (await runChecked(
    dependencies,
    'git',
    ['commit-tree', featureTree, '-p', snapshot.currentMainHead, '-F', commitMessagePath],
    snapshot.featureRoot,
  )).stdout.trim()
  snapshot.landedHead = landed
  await persistSnapshot(snapshot, dependencies)
  const committedTree = (await git(dependencies, snapshot.featureRoot, ['rev-parse', `${landed}^{tree}`]))
    .stdout.trim()
  if (committedTree !== featureTree) {
    Errors.throwUnexpected('The built squash commit does not carry the verified tree.', {
      details: { committedTree, featureTree },
    })
  }
  await moveMainRef(snapshot, landed, snapshot.currentMainHead, dependencies)
  await advanceSnapshot(snapshot, 'committed', dependencies)
  await refreshMirrors(snapshot, preflight, landed, dependencies)
  await assertExpectedLocalState(snapshot, dependencies)
}

/**
 * squashAppendix reproduces what `git merge --squash` would have written into `SQUASH_MSG`: the
 * landed commits in `git log`'s default format, newest first. It is the record of what the one
 * commit on main contains, and `main`'s history is written this way throughout.
 */
async function squashAppendix(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<string> {
  const log = (await runChecked(
    dependencies,
    'git',
    ['log', `${snapshot.currentMainHead}..${snapshot.currentFeatureHead}`],
    snapshot.featureRoot,
  )).stdout.trim()
  if (log === '') {
    Errors.throwUnexpected('The feature branch adds no commits to main.')
  }
  return `Squashed commit of the following:\n\n${log}`
}

/**
 * refreshMirrors moves the read-only checkouts that exist to show main's content. Each was detached
 * at main's previous tip and clean when preflight looked, so moving it is a fast-forward of files
 * nobody is editing. One that has since been touched is left alone and said so: a mirror is a
 * convenience, never a reason to fail a landing that has already moved the ref.
 */
async function refreshMirrors(
  snapshot: MergeSnapshot,
  preflight: MergePreflight,
  landed: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  for (const mirror of preflight.mirrorRoots) {
    const head = (await git(dependencies, mirror, ['rev-parse', 'HEAD'])).stdout.trim()
    if (head !== snapshot.mainHead || await status(dependencies, mirror) !== '') {
      writeLines(dependencies, [
        `WARN  Left the main mirror at ${mirror} alone: it is no longer clean at main's previous tip.`,
      ])
      continue
    }
    const moved = await dependencies.run('git', {
      args: ['checkout', '--detach', landed],
      cwd: mirror,
      stdio: 'pipe',
    })
    writeLines(dependencies, [
      moved.exitCode === 0
        ? `PASS  Moved the main mirror at ${mirror} to ${shortSha(landed)}.`
        : `WARN  Could not move the main mirror at ${mirror}; refresh it with git -C ${mirror} `
          + `checkout --detach ${MAIN_BRANCH}.`,
    ])
  }
}

/** readFeatureTree reads the tree of the branch tip, which is what a landing commits. */
async function readFeatureTree(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<string> {
  return (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
}

/** readMainRef reads `refs/heads/main` itself; no worktree holds it, so there is no HEAD to consult. */
async function readMainRef(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<string> {
  return (await git(dependencies, snapshot.featureRoot, ['rev-parse', `refs/heads/${MAIN_BRANCH}`])).stdout.trim()
}

/**
 * moveMainRef is the only way this command moves main, and it never moves it blind: `update-ref`
 * with an expected old value is atomic, so two landings on one machine cannot interleave. The loser
 * is told main moved, which is a state it can recover from by merging main and verifying again.
 */
async function moveMainRef(
  snapshot: MergeSnapshot,
  next: string,
  expected: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const moved = await dependencies.run('git', {
    args: ['update-ref', '-m', `merge-with-main: ${snapshot.branch}`, `refs/heads/${MAIN_BRANCH}`, next, expected],
    cwd: snapshot.featureRoot,
    stdio: 'pipe',
  })
  if (moved.exitCode !== 0 || moved.error !== undefined || moved.signal !== null) {
    const observed = await readMainRef(snapshot, dependencies)
    Errors.throwUserInput(
      `refs/heads/${MAIN_BRANCH} moved to ${shortSha(observed)} while this landing was verifying `
        + `${shortSha(expected)}; nothing was changed. Merge main into '${snapshot.branch}', verify, and retry.`,
    )
  }
  snapshot.currentMainHead = next
  await persistSnapshot(snapshot, dependencies)
}

async function pushArchiveAndPreserve(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await advanceSnapshot(snapshot, 'push-started', dependencies)
  await pushRemoteRefs(snapshot, dependencies)

  await beginPhase(snapshot.featureRoot, 'cleanup', dependencies)
  // Keep the invoking directory usable after success. Detaching at the verified feature tip leaves
  // its tree unchanged while allowing the local feature ref to be deleted after the remote archive
  // has made that tip durable.
  await runChecked(
    dependencies,
    'git',
    ['switch', '--detach', snapshot.currentFeatureHead],
    snapshot.featureRoot,
    true,
  )
  const detached = await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    cwd: snapshot.featureRoot,
    stdio: 'pipe',
  })
  if (
    detached.exitCode !== 1
    || detached.error !== undefined
    || detached.signal !== null
  ) {
    Errors.throwUnexpected('The preserved feature worktree did not enter detached HEAD state.')
  }
  const preservedState = await readLocalState(snapshot, dependencies)
  assertMainMatches(snapshot, preservedState)
  if (
    preservedState.featureHead !== snapshot.currentFeatureHead
    || preservedState.featureStatus !== ''
    || preservedState.featureDiff !== ''
  ) {
    Errors.throwUnexpected('The preserved feature worktree changed while detaching its archived tip.')
  }
  adoptLocalState(snapshot, preservedState)
  await persistSnapshot(snapshot, dependencies)

  // A squash commit has no ancestry relationship to the feature tip, so `-d` cannot remove it even
  // after the remote is safely archived. The preceding push/archive phases make this forced local
  // deletion deliberate and recoverable.
  await runChecked(dependencies, 'git', ['branch', '-D', snapshot.branch], snapshot.featureRoot, true)
  await runChecked(dependencies, 'git', ['worktree', 'prune'], snapshot.featureRoot, true)
  snapshot.phase = 'complete'
  snapshot.currentMainHead = await readMainRef(snapshot, dependencies)
  await persistSnapshot(snapshot, dependencies)
}

async function pushRemoteRefs(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const landedHead = snapshot.landedHead
  if (landedHead === undefined) {
    Errors.throwUnexpected('The landing snapshot has no squash commit to push.')
  }
  const archive = snapshot.archive ?? archiveName(snapshot.branch, new Date(snapshot.createdAt))
  const args = [
    'push',
    '--porcelain',
    '--atomic',
    `--force-with-lease=refs/heads/${MAIN_BRANCH}:${snapshot.remoteMainHead}`,
    `--force-with-lease=refs/heads/${archive}:`,
  ]
  if (snapshot.remoteFeatureHead !== undefined) {
    args.push(`--force-with-lease=refs/heads/${snapshot.branch}:${snapshot.remoteFeatureHead}`)
  }
  args.push(
    REMOTE,
    `${landedHead}:refs/heads/${MAIN_BRANCH}`,
    `${snapshot.currentFeatureHead}:refs/heads/${archive}`,
  )
  if (snapshot.remoteFeatureHead !== undefined) {
    args.push(`:refs/heads/${snapshot.branch}`)
  }
  const pushed = await dependencies.run('git', {
    args,
    cwd: snapshot.featureRoot,
    stdio: 'stream',
  })
  // The process result can be lost after the remote accepts an atomic push. Inspect every affected
  // ref before deciding whether the landing succeeded or a retry can safely begin before the push.
  const observed = (await remoteHeads(
    dependencies,
    snapshot.featureRoot,
    [MAIN_BRANCH, archive, snapshot.branch],
  )).refs
  const fullyLanded = observed.get(MAIN_BRANCH) === landedHead
    && observed.get(archive) === snapshot.currentFeatureHead
    && (snapshot.remoteFeatureHead === undefined || !observed.has(snapshot.branch))
  if (fullyLanded) {
    await advanceSnapshot(snapshot, 'pushed', dependencies)
    await advanceSnapshot(snapshot, 'archived', dependencies)
    return
  }
  const noLandingRefsChanged = observed.get(archive) === undefined
    && observed.get(snapshot.branch) === snapshot.remoteFeatureHead
    && observed.get(MAIN_BRANCH) !== landedHead
  if (pushed.exitCode !== 0 || pushed.error !== undefined || pushed.signal !== null) {
    if (noLandingRefsChanged) {
      snapshot.phase = 'committed'
      await persistSnapshot(snapshot, dependencies)
      Errors.throwHostEnvironment(
        `The atomic remote push changed no landing refs; ${REMOTE}/main is at `
          + `${shortSha(observed.get(MAIN_BRANCH) ?? '')}. `
          + `Abort this snapshot with ./dev merge-with-main --abort ${snapshot.snapshotPath}, `
          + 'then merge current main into the feature branch, verify, and retry.',
      )
    }
    assertCommandSucceeded(pushed)
  }
  Errors.throwHostEnvironment(
    'The atomic push returned, but remote main, archive, and feature refs do not match the landing. '
      + `Inspect the remote refs and snapshot ${snapshot.snapshotPath} before recovery.`,
  )
}

async function abortMerge(
  dependencies: MergeWithMainDependencies,
  abortSnapshot: string,
): Promise<MergeWithMainResult> {
  const path = FS.resolvePath(abortSnapshot)
  const snapshot = await readSnapshot(path, dependencies)
  if (phaseAtOrAfterPush(snapshot.phase)) {
    Errors.throwUserInput(
      `Snapshot '${path}' reached phase '${snapshot.phase}'. Refusing to rewrite pushed history. Fetch the remote, `
        + 'inspect main and the merged/* archive against the snapshot, then complete only any missing archive or local cleanup steps; '
        + 'do not reset or force-push main.',
    )
  }
  // Naming a snapshot is itself the request, so an unattended `--abort` proceeds. A human at a
  // terminal still gets one chance to say no, because the restore discards command-owned commits.
  if (
    dependencies.isInteractive() && !await dependencies.askConfirm(
      `Restore command-owned state recorded in '${path}'?`,
    )
  ) {
    Errors.throwUserInput('Abort cancelled without changing repository state.')
  }

  await assertSnapshotState(snapshot, dependencies)
  // Main is a ref, so restoring it is a compare-and-swap back to where preflight found it. A landing
  // that never reached the ref has nothing here to undo, which is the ordinary case now that the
  // commit is built only at the moment it lands.
  const currentMain = await readMainRef(snapshot, dependencies)
  if (currentMain !== snapshot.mainHead) {
    await moveMainRef(snapshot, snapshot.mainHead, currentMain, dependencies)
  }
  await runChecked(dependencies, 'git', ['reset', '--hard', snapshot.featureHead], snapshot.featureRoot, true)
  await dependencies.remove(`${snapshot.snapshotPath}.commit-message`)
  snapshot.phase = 'aborted'
  snapshot.currentFeatureDiff = ''
  snapshot.currentFeatureHead = snapshot.featureHead
  snapshot.currentFeatureStatus = ''
  snapshot.currentMainHead = snapshot.mainHead
  await persistSnapshot(snapshot, dependencies)
  const lines = [`PASS  Restored main and '${snapshot.branch}' to their recorded pre-merge state.`]
  writeLines(dependencies, lines)
  return { lines, mode: 'aborted', snapshotPath: snapshot.snapshotPath }
}

async function assertSnapshotState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readLocalState(snapshot, dependencies)
  if (!localStateMatches(snapshot, current)) {
    Errors.throwUserInput('Repository state no longer matches the merge snapshot; refusing to discard later work.')
  }
}

async function readSnapshot(path: string, dependencies: MergeWithMainDependencies): Promise<MergeSnapshot> {
  if (!await dependencies.exists(path)) {
    Errors.throwUserInput(`Merge snapshot does not exist: ${path}`)
  }
  let value: MergeSnapshot
  try {
    value = await dependencies.readJson<MergeSnapshot>(path)
  } catch {
    Errors.throwUserInput(`Merge snapshot is not valid JSON: ${path}`, { path })
  }
  if (
    value.version !== SNAPSHOT_VERSION
    || typeof value.branch !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.currentFeatureDiff !== 'string'
    || typeof value.currentFeatureHead !== 'string'
    || typeof value.currentFeatureStatus !== 'string'
    || typeof value.currentMainHead !== 'string'
    || typeof value.featureHead !== 'string'
    || typeof value.featureIndexTree !== 'string'
    || typeof value.featureRoot !== 'string'
    || typeof value.featureTree !== 'string'
    || typeof value.mainHead !== 'string'
    || typeof value.messageFile !== 'string'
    || !isMergePhase(value.phase)
    || typeof value.remoteMainHead !== 'string'
    || value.remoteTransport !== undefined && value.remoteTransport !== 'broker' && value.remoteTransport !== 'direct'
    || typeof value.snapshotPath !== 'string'
    || value.archive !== undefined && typeof value.archive !== 'string'
  ) {
    Errors.throwUserInput(`Merge snapshot has an unsupported shape: ${path}`)
  }
  value.archive ??= archiveName(value.branch, new Date(value.createdAt))
  return value
}

function isMergePhase(value: unknown): value is MergePhase {
  return typeof value === 'string' && MERGE_PHASES.includes(value as MergePhase)
}

function phaseAtOrAfterPush(phase: MergePhase): boolean {
  return phase === 'push-started' || phase === 'pushed' || phase === 'archived' || phase === 'complete'
}

async function assertExpectedLocalState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readLocalState(snapshot, dependencies)
  if (!localStateMatches(snapshot, current)) {
    Errors.throwUserInput('Repository state changed after preflight; refusing to continue the merge.')
  }
}

/** LocalState is what this command owns: one feature worktree, and main as a ref. */
type LocalState = {
  featureDiff: string
  featureHead: string
  featureStatus: string
  mainHead: string
}

async function readLocalState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<LocalState> {
  const [featureHead, mainHead, featureDiff, featureStatus] = await Promise.all([
    git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
    readMainRef(snapshot, dependencies),
    diff(dependencies, snapshot.featureRoot),
    status(dependencies, snapshot.featureRoot),
  ])
  return { featureDiff, featureHead, featureStatus, mainHead }
}

function localStateMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  return current.featureHead === snapshot.currentFeatureHead
    && current.featureDiff === snapshot.currentFeatureDiff
    && current.featureStatus === snapshot.currentFeatureStatus
    && current.mainHead === snapshot.currentMainHead
}

function assertLocalStateMatches(snapshot: MergeSnapshot, current: LocalState): void {
  if (!localStateMatches(snapshot, current)) {
    Errors.throwUserInput('Repository state changed while validation was running; refusing to continue the merge.')
  }
}

function assertMainMatches(snapshot: MergeSnapshot, current: LocalState): void {
  if (!mainMatches(snapshot, current)) {
    Errors.throwUserInput('refs/heads/main moved unexpectedly while the merge command was running.')
  }
}

function mainMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  return current.mainHead === snapshot.currentMainHead
}

function adoptLocalState(snapshot: MergeSnapshot, current: LocalState): void {
  snapshot.currentFeatureHead = current.featureHead
  snapshot.currentFeatureDiff = current.featureDiff
  snapshot.currentFeatureStatus = current.featureStatus
  snapshot.currentMainHead = current.mainHead
}

async function advanceSnapshot(
  snapshot: MergeSnapshot,
  phase: MergePhase,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await assertExpectedLocalState(snapshot, dependencies)
  snapshot.phase = phase
  await persistSnapshot(snapshot, dependencies)
}

async function persistSnapshot(snapshot: MergeSnapshot, dependencies: MergeWithMainDependencies): Promise<void> {
  const temporaryPath = `${snapshot.snapshotPath}.${Platform.randomUUID()}.tmp`
  await dependencies.writeJson(temporaryPath, snapshot)
  try {
    await dependencies.move(temporaryPath, snapshot.snapshotPath)
  } catch (error) {
    await dependencies.remove(temporaryPath).catch(() => {})
    throw error
  }
}

async function fullRunWarnings(dependencies: MergeWithMainDependencies, featureRoot: string): Promise<string[]> {
  const ledgerPath = FS.resolvePath('.artifacts/testing/ledger.json', featureRoot)
  if (!await dependencies.exists(ledgerPath)) {
    return ['No package-test full-run timestamp is recorded for this worktree.']
  }
  try {
    const ledger = await dependencies.readJson<{ lastFullRunStartedAt?: unknown }>(ledgerPath)
    if (typeof ledger.lastFullRunStartedAt !== 'string') {
      return ['The package-test ledger has no full-run timestamp.']
    }
    const commitTime = (await git(dependencies, featureRoot, ['log', '-1', '--format=%cI', 'HEAD'])).stdout.trim()
    const ledgerTime = Date.parse(ledger.lastFullRunStartedAt)
    const newestCommitTime = Date.parse(commitTime)
    if (!Number.isFinite(ledgerTime) || !Number.isFinite(newestCommitTime)) {
      return ['The package-test ledger full-run timestamp could not be compared with the newest feature commit.']
    }
    if (ledgerTime < newestCommitTime) {
      return ['The latest package-test full run predates the newest feature commit.']
    }
    return []
  } catch {
    return ['The package-test ledger could not be read; treat its full-run evidence as unavailable.']
  }
}

async function remoteHeads(
  dependencies: MergeWithMainDependencies,
  cwd: string,
  branches: readonly string[],
): Promise<{ refs: Map<string, string>; transport: RemoteTransport }> {
  const result = await dependencies.run('git', {
    args: ['ls-remote', '--heads', REMOTE, ...branches.map(branch => `refs/heads/${branch}`)],
    cwd,
  })
  if (CLI.isSandboxDenial(result)) {
    Errors.throwHostEnvironment(
      `The sandbox denied merge-with-main's query of remote '${REMOTE}'. Run this command with ./agent unsandboxed.`,
      {
        cause: new Errors.CommandExecutionError(result),
        details: { command: result.command, stderr: result.stderr },
      },
    )
  }
  assertCommandSucceeded(result)
  const refs = new Map<string, string>()
  for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
    const match = /^(\S+)\s+refs\/heads\/(.+)$/u.exec(line)
    if (match) {
      refs.set(match[2]!, match[1]!)
    }
  }
  return { refs, transport: 'direct' }
}

async function status(dependencies: MergeWithMainDependencies, cwd: string): Promise<string> {
  return (await git(dependencies, cwd, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
}

async function diff(dependencies: MergeWithMainDependencies, cwd: string): Promise<string> {
  return (await git(dependencies, cwd, ['diff', '--no-ext-diff', '--binary', 'HEAD'])).stdout
}

function assertClean(name: string, path: string, value: string): void {
  if (value !== '') {
    Errors.throwUserInput(`The ${name} worktree is not clean: ${path}`)
  }
}

async function git(
  dependencies: MergeWithMainDependencies,
  cwd: string,
  args: readonly string[],
): Promise<CLI.CommandResult> {
  return await runChecked(dependencies, 'git', args, cwd)
}

async function runChecked(
  dependencies: MergeWithMainDependencies,
  command: string,
  args: readonly string[],
  cwd: string,
  stream = false,
): Promise<CLI.CommandResult> {
  const result = await dependencies.run(command, { args, cwd, stdio: stream ? 'stream' : 'pipe' })
  assertCommandSucceeded(result)
  return result
}

/** Run a command after the safety snapshot exists and persist its resulting local state even on failure. */
async function runAndSnapshot(
  snapshot: MergeSnapshot,
  command: string,
  args: readonly string[],
  cwd: string,
  successPhase: MergePhase,
  dependencies: MergeWithMainDependencies,
  options: {
    env?: CLI.CommandSpec['env']
    mutation?: 'feature' | 'none'
    onOutput?: CLI.CommandSpec['onOutput']
    stdio?: CLI.CommandStdio
  } = {},
): Promise<CLI.CommandResult> {
  const mutation = options.mutation ?? 'none'
  await assertExpectedLocalState(snapshot, dependencies)
  const result = await dependencies.run(command, {
    args,
    cwd,
    stdio: options.stdio ?? 'stream',
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.onOutput === undefined ? {} : { onOutput: options.onOutput }),
  })
  const succeeded = result.exitCode === 0 && result.error === undefined && result.signal === null
  if (!succeeded) {
    await captureFailedMutation(snapshot, mutation, dependencies)
    assertCommandSucceeded(result)
  }
  const current = await readLocalState(snapshot, dependencies)
  if (mutation === 'none') {
    assertLocalStateMatches(snapshot, current)
  } else {
    assertMainMatches(snapshot, current)
    if (current.featureStatus !== '' || current.featureDiff !== '') {
      Errors.throwUserInput('The feature worktree was not clean after the command-owned Git operation.')
    }
  }
  adoptLocalState(snapshot, current)
  snapshot.phase = successPhase
  await persistSnapshot(snapshot, dependencies)
  assertCommandSucceeded(result)
  return result
}

/**
 * runVerificationLane runs one of this landing's own `just` verification lanes — full verify, the
 * cheap-gate barrier, or the staged verify — the way `runAndSnapshot` always has for a human at a
 * terminal, and differently for a non-interactive one.
 *
 * `stdio: 'stream'` used to run either way: an interactive caller wants the lane's live progress, but
 * a non-interactive one — an agent's landing, most of the time — got the exact same flood forwarded
 * to its own stdout as the lane ran, ending on nothing more than `Command failed: just verify-full`
 * once it failed, with no test name in sight. `pipe` still captures every byte; a non-interactive
 * caller is shown only the lane's own verdict, its `Failed:` block, and where its logs live —
 * `extractLaneReport` reads them back out of the captured output — printed once when the lane finishes
 * and, on failure, repeated from the thrown error's own captured output so the last screen a reader
 * sees still names the tests.
 *
 * `mergedOutputCapture` is read first, not `result.stdout` alone: a `just` spawn error, a `Recipe …
 * does not exist`, or a sandbox denial writes to stderr, which nothing above this read, so a
 * genuinely failed lane could print nothing before the generic `Command failed: just verify-full`.
 * The interactive branch returns before any of this runs, so its `stdio: 'inherit'` path is
 * unchanged byte for byte.
 */
async function runVerificationLane(
  snapshot: MergeSnapshot,
  args: readonly string[],
  successPhase: MergePhase,
  dependencies: MergeWithMainDependencies,
): Promise<CLI.CommandResult> {
  const priority = args[0] === LAND_BARRIER_LANE
    ? undefined
    : await dependencies.acquireVerificationPriority(snapshot.featureRoot)
  if (args[0] !== LAND_BARRIER_LANE && priority === undefined) {
    dependencies.writeLine('WARN  Landing verification priority unavailable; other lanes may contend for this run.')
  }
  const env = priority === undefined ? undefined : { [MachineLanes.LANDING_PRIORITY_ENV_KEY]: priority.token }
  try {
    if (dependencies.isInteractive()) {
      return await runAndSnapshot(snapshot, 'just', args, snapshot.featureRoot, successPhase, dependencies, {
        env,
        stdio: 'inherit',
      })
    }
    const capture = mergedOutputCapture()
    try {
      const result = await runAndSnapshot(snapshot, 'just', args, snapshot.featureRoot, successPhase, dependencies, {
        env,
        onOutput: capture.onOutput,
        stdio: 'pipe',
      })
      writeLines(dependencies, laneReportLines(mergedLaneOutput(capture, result), result.error))
      return result
    } catch (error) {
      if (error instanceof Errors.CommandExecutionError) {
        writeLines(dependencies, laneReportLines(mergedLaneOutput(capture, error.result), error.result.error))
      }
      throw error
    }
  } finally {
    await priority?.release()
  }
}

/**
 * mergedOutputCapture collects a lane's stdout and stderr as bytes actually arrive, so a caller that
 * only inspects the finished `CommandResult` afterward still sees them close to interleaved, the way
 * a terminal would have shown them, rather than every stdout byte before every stderr one.
 */
function mergedOutputCapture(): { onOutput: NonNullable<CLI.CommandSpec['onOutput']>; read: () => string } {
  const chunks: string[] = []
  return {
    onOutput: (_stream, chunk) => {
      chunks.push(chunk.toString('utf8'))
    },
    read: () => chunks.join(''),
  }
}

/**
 * mergedLaneOutput prefers the bytes `mergedOutputCapture` actually saw arrive, in that order. A
 * runner that never wires `onOutput` through — every test double in this file, and any future one —
 * still gets both streams, just concatenated rather than interleaved: acceptable next to the silence
 * this replaces.
 */
function mergedLaneOutput(
  capture: { read: () => string },
  result: Pick<CLI.CommandResult, 'stderr' | 'stdout'>,
): string {
  const captured = capture.read()
  if (captured.length > 0) {
    return captured
  }
  return result.stderr.length === 0 ? result.stdout : `${result.stdout}\n${result.stderr}`
}

/**
 * laneReportLines is what a non-interactive landing shows for a nested lane: its own structured
 * verdict when the merged output matched one, the same short raw tail every other failed log's
 * reader gets when it did not, and — either way — the spawn error the `just` invocation itself
 * failed with, when there was one. A pure spawn failure (the binary missing, a sandbox denial before
 * the child ever wrote a byte) leaves the merged output empty, so the spawn error is the one thing
 * that keeps this from printing nothing at all.
 */
function laneReportLines(output: string, spawnError: Error | undefined): string[] {
  const lines = extractLaneReport(output)
  return spawnError === undefined ? lines : [...lines, `Spawn error: ${spawnError.message}`]
}

async function captureFailedMutation(
  snapshot: MergeSnapshot,
  mutation: 'feature' | 'none',
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readLocalState(snapshot, dependencies)
  const targetIsRecoverable = mutation === 'feature'
    && mainMatches(snapshot, current)
    && current.featureHead === snapshot.currentFeatureHead
    && recoverableMergeFailureStatus(current.featureStatus)
  if (localStateMatches(snapshot, current) || targetIsRecoverable) {
    adoptLocalState(snapshot, current)
  }
  snapshot.phase = 'failed'
  await persistSnapshot(snapshot, dependencies)
}

const MERGE_CONFLICT_CODES = new Set(['AA', 'AU', 'DD', 'DU', 'UA', 'UD', 'UU'])

function recoverableMergeFailureStatus(statusOutput: string): boolean {
  const lines = statusOutput.split('\n').filter(Boolean)
  return lines.some(line => MERGE_CONFLICT_CODES.has(line.slice(0, 2)))
    && lines.every(line => line.length >= 2 && (line[1] === ' ' || MERGE_CONFLICT_CODES.has(line.slice(0, 2))))
}

function assertCommandSucceeded(result: CLI.CommandResult): void {
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Errors.CommandExecutionError(result)
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 12)
}

function writeLines(
  dependencies: MergeWithMainDependencies,
  lines: readonly string[],
  kind?: 'success',
): void {
  for (const line of lines) {
    dependencies.writeLine(line, kind)
  }
}
