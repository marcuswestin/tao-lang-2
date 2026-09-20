import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { isSandboxDenial } from '../doctor/AgentCapabilities'
import {
  inspectLandingRemote,
  type LandingBrokerInspection,
  type LandingBrokerPush,
  pushLandingRemote,
} from '../landing-broker/LandingBrokerClient'
import { LandingLock, LandingLockBusyError } from './LandingLock'
import { MachineLanes, MachineResourceBusyError, type MachineResourceLease } from './MachineLanes'

const SNAPSHOT_VERSION = 1
const LANDING_RESOURCE_NAME = 'merge-with-main-landing'
// Bounded rather than infinite: a peer whose process is gone is pruned by the registry, but one that
// is merely wedged must eventually surface as an actionable error instead of hanging a landing.
const LEASE_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1_000
const MAX_STABILIZATION_PASSES = 3
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
/** Branches a landing accepts: `feat/` is an agent's, `dev/` a person's, and they land identically. */
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
  version: typeof SNAPSHOT_VERSION
}

/** MergePreflight is the immutable repository evidence collected before execution. */
export type MergePreflight = {
  branch: string
  branchHead: string
  featureRoot: string
  mainHead: string
  message: string
  messageFile: string
  /** Detached, clean worktrees sitting at main's tip: mirrors this landing moves forward with main. */
  mirrorRoots: string[]
  remoteFeatureHead?: string
  remoteFeatureBehind: boolean
  remoteMainHead: string
  remoteMergedHead?: string
  remoteTransport: RemoteTransport
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
  acquireLease: typeof MachineLanes.acquireResource
  askConfirm: (message: string) => Promise<boolean>
  exists: (path: string) => Promise<boolean>
  isInteractive: () => boolean
  inspectRemote?: (repositoryRoot: string, branches: readonly string[]) => Promise<LandingBrokerInspection | undefined>
  move: (fromPath: string, toPath: string) => Promise<void>
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  readText: (path: string) => Promise<string>
  remove: (path: string) => Promise<void>
  run: MergeCommandRunner
  pushRemote?: (repositoryRoot: string, push: LandingBrokerPush) => Promise<LandingBrokerInspection | undefined>
  writeJson: (path: string, value: unknown) => Promise<void>
  writeLine: (line: string, kind?: 'success') => void
  writeText: (path: string, value: string) => Promise<void>
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
  askConfirm: async message => await HCI.askConfirm({ defaultValue: false, message }),
  exists: FS.exists,
  isInteractive: HCI.isInteractive,
  inspectRemote: inspectLandingRemote,
  move: FS.move,
  now: () => new Date(),
  readJson: FS.readJson,
  readText: FS.readText,
  remove: FS.remove,
  run: CLI.run,
  pushRemote: pushLandingRemote,
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

/** archiveName is where a landed branch is preserved on the remote: `merged/<name>` without its prefix. */
function archiveName(branch: string): string {
  const prefix = LANDABLE_PREFIXES.find(candidate => branch.startsWith(candidate)) ?? ''
  return `merged/${branch.slice(prefix.length)}`
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

  const remote = await remoteHeads(dependencies, featureRoot, [MAIN_BRANCH, branch, archiveName(branch)])
  const remoteRefs = remote.refs
  const remoteMainHead = remoteRefs.get(MAIN_BRANCH)
  if (!remoteMainHead) {
    Errors.throwHostEnvironment(`Remote '${REMOTE}' did not report refs/heads/main.`)
  }
  if (mainHead !== remoteMainHead) {
    Errors.throwUserInput(
      `Local ${MAIN_BRANCH} is not at ${REMOTE}/main (${shortSha(remoteMainHead)}); refresh it before merging.`,
    )
  }
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
  const remoteMergedHead = remoteRefs.get(archiveName(branch))
  if (remoteMergedHead !== undefined) {
    Errors.throwUserInput(`Remote archive branch 'merged/${branch.slice(5)}' already exists.`)
  }

  const ancestor = await dependencies.run('git', {
    args: ['merge-base', '--is-ancestor', remoteMainHead, branchHead],
    cwd: featureRoot,
  })
  if (ancestor.exitCode === 1) {
    Errors.throwUserInput(`${REMOTE}/main must be merged into '${branch}' before landing it.`)
  }
  assertCommandSucceeded(ancestor)

  const messageFile = FS.resolvePath(options.messageFile ?? `.artifacts/merge/${branch}.msg`, featureRoot)
  if (!await dependencies.exists(messageFile)) {
    Errors.throwUserInput(`Merge message file does not exist: ${messageFile}`)
  }
  const message = validateMergeMessage(await dependencies.readText(messageFile))
  const warnings = await fullRunWarnings(dependencies, featureRoot)

  return {
    branch,
    branchHead,
    featureRoot,
    mainHead,
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

    const preflight = await inspectMergePreflight(options, dependencies)
    if (options.dryRun === true) {
      const lines = formatDryRun(preflight, options)
      writeLines(dependencies, lines)
      return { lines, mode: 'dry-run' }
    }

    await authorizeExecution(options, dependencies, preflight)
    // Held across every ref this command moves, and released whichever way it ends.
    const lease = await acquireLandingLease(dependencies, preflight)
    try {
      const snapshot = await createSnapshot(preflight, dependencies)
      writeLines(dependencies, [
        ...preflight.warnings.map(warning => `WARN  ${warning}`),
        `PASS  Landing lease held for ${preflight.branch}.`,
        `PASS  Safety snapshot: ${snapshot.snapshotPath}`,
      ])

      await stabilizeAndVerify(snapshot, options, dependencies)
      await verifyLandingSubject(snapshot, options, dependencies)
      await landSquash(snapshot, preflight, dependencies)
      await pushArchiveAndPreserve(snapshot, dependencies)

      const completed = [
        `PASS  Merged '${preflight.branch}' into main and archived it as ${archiveName(preflight.branch)}.`,
        `PASS  Preserved the clean invoking worktree at ${preflight.featureRoot} on detached HEAD; `
        + 'archive its owning task when you are ready to remove it.',
      ]
      writeLines(dependencies, completed, 'success')
      return { lines: completed, mode: 'executed', snapshotPath: snapshot.snapshotPath }
    } finally {
      await lease.release()
    }
  },
} as const

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
): Promise<MachineResourceLease> {
  const request = async (waitTimeoutMs: number) =>
    await dependencies.acquireLease({
      command: `merge-with-main ${preflight.branch}`,
      name: LANDING_RESOURCE_NAME,
      repositoryRoot: preflight.featureRoot,
      waitTimeoutMs,
    })
  try {
    return await request(0)
  } catch (error) {
    if (!(error instanceof MachineResourceBusyError)) {
      throw error
    }
    const owner = error.owner
    writeLines(dependencies, [
      `WARN  Landing lease held by '${owner.command}' in ${owner.repositoryRoot} (PID ${owner.pid}), `
      + `held for ${describeHeldFor(owner.startedAt, dependencies.now())}.`,
      'WARN  Waiting for it; this landing starts as soon as that one ends.',
    ])
    return await request(LEASE_WAIT_TIMEOUT_MS)
  }
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
const acquireLandingLock: typeof MachineLanes.acquireResource = async options => {
  const repositoryRoot = options.repositoryRoot
  const hold = await LandingLock.acquire({
    label: options.command,
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

/** Report how long a lease has been held, in the coarsest unit that still says something useful. */
function describeHeldFor(startedAt: string, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(startedAt))
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) {
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
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
    `PASS  Local main is current at ${shortSha(preflight.mainHead)}; no worktree has it checked out.`,
    `PASS  ${REMOTE}/main is an ancestor of the feature branch.`,
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
    fullVerifySkip === undefined
      ? 'PLAN  Run just verify-full on the feature branch.'
      : `PLAN  Skip just verify-full on the feature branch because ${fullVerifySkip} was passed.`,
    'PLAN  Fetch and, if main moved, merge it into the feature branch and restart full verification.',
    fullVerifySkip === undefined
      ? 'PLAN  Land the verified feature tree itself; full verification proved exactly those bytes.'
      : stagedVerifySkip === undefined
      ? 'PLAN  Run just verify --complete on the feature branch, because nothing else verified it.'
      : `PLAN  Skip just verify --complete because ${stagedVerifySkip} was passed; `
        + 'no lane will have verified these bytes.',
    'PLAN  Take the machine-wide landing lease, waiting for any landing already holding it.',
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
  return `--skip-all runs no fix, no typecheck, no lint, no tests, no just verify-full on '${branch}', `
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
    await assertExpectedLocalState(snapshot, dependencies)
    const fetchedMain = await refreshRemoteMain(snapshot, dependencies)
    const featureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    const ancestor = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', fetchedMain, featureHead],
      cwd: snapshot.featureRoot,
    })
    if (ancestor.exitCode === 1) {
      await runAndSnapshot(
        snapshot,
        'git',
        ['merge', '--no-edit', fetchedMain],
        snapshot.featureRoot,
        'feature-integrated',
        dependencies,
        { mutation: 'feature' },
      )
    } else {
      assertCommandSucceeded(ancestor)
    }

    const fullVerifySkip = fullVerifySkippedBy(options)
    if (fullVerifySkip === undefined) {
      const verifiedHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      await runAndSnapshot(
        snapshot,
        'just',
        ['verify-full'],
        snapshot.featureRoot,
        'feature-verified',
        dependencies,
        { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
      )
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
      await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH], snapshot.remoteTransport)
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

async function refreshRemoteMain(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<string> {
  if (snapshot.remoteTransport === 'broker') {
    const inspection = await dependencies.inspectRemote?.(snapshot.featureRoot, [MAIN_BRANCH])
    const main = inspection?.refs.get(MAIN_BRANCH)
    if (main === undefined) {
      Errors.throwHostEnvironment(
        "The Tao landing broker stopped answering. Run 'just landing-setup' in a normal terminal and retry.",
      )
    }
    return main
  }
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
    await runAndSnapshot(
      snapshot,
      'just',
      ['verify', '--complete'],
      snapshot.featureRoot,
      'main-verified',
      dependencies,
      { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
    )
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
  if (snapshot.remoteTransport === 'broker') {
    const landedHead = snapshot.landedHead
    if (landedHead === undefined) {
      Errors.throwUnexpected('The landing snapshot has no squash commit to push.')
    }
    const pushed = await dependencies.pushRemote?.(snapshot.featureRoot, {
      branch: snapshot.branch,
      expectedRemoteFeatureHead: snapshot.remoteFeatureHead ?? null,
      expectedRemoteMainHead: snapshot.remoteMainHead,
      featureHead: snapshot.currentFeatureHead,
      landedHead,
    })
    if (pushed === undefined) {
      Errors.throwHostEnvironment(
        "The Tao landing broker stopped answering. Run 'just landing-setup' in a normal terminal and retry.",
      )
    }
    if (
      pushed.refs.get(MAIN_BRANCH) !== landedHead
      || pushed.refs.get(archiveName(snapshot.branch)) !== snapshot.currentFeatureHead
      || snapshot.remoteFeatureHead !== undefined && pushed.refs.has(snapshot.branch)
    ) {
      Errors.throwHostEnvironment('The landing broker returned refs that do not match the requested landing.')
    }
    await advanceSnapshot(snapshot, 'pushed', dependencies)
    await advanceSnapshot(snapshot, 'archived', dependencies)
    return
  }

  const pushMain = await dependencies.run('git', {
    args: [
      'push',
      REMOTE,
      `--force-with-lease=refs/heads/${MAIN_BRANCH}:${snapshot.remoteMainHead}`,
      `${MAIN_BRANCH}:${MAIN_BRANCH}`,
    ],
    cwd: snapshot.featureRoot,
    stdio: 'stream',
  })
  if (pushMain.exitCode !== 0 || pushMain.error !== undefined || pushMain.signal !== null) {
    const observedMain = (
      await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH], 'direct')
    ).refs.get(MAIN_BRANCH)
    if (observedMain === snapshot.currentMainHead) {
      // A transport can report failure after the remote accepted the update. The exact remote ref
      // is stronger evidence than the process result, so recovery must stay on the irreversible side.
      await advanceSnapshot(snapshot, 'pushed', dependencies)
    } else if (observedMain !== undefined && observedMain !== snapshot.remoteMainHead) {
      // The force-with-lease proves this push changed nothing. Restore the reversible phase so the
      // guarded abort may remove only the local squash commit before a fresh preflight.
      snapshot.phase = 'committed'
      await persistSnapshot(snapshot, dependencies)
      Errors.throwHostEnvironment(
        `${REMOTE}/main moved to ${shortSha(observedMain)} before the verified squash could be pushed. `
          + `The remote was not changed; abort this snapshot with ./dev merge-with-main --abort ${snapshot.snapshotPath}, `
          + 'then merge current main into the feature branch, verify, and retry.',
      )
    } else {
      assertCommandSucceeded(pushMain)
    }
  } else {
    await advanceSnapshot(snapshot, 'pushed', dependencies)
  }

  const archive = archiveName(snapshot.branch)
  await runChecked(
    dependencies,
    'git',
    ['push', REMOTE, `--force-with-lease=refs/heads/${archive}:`, `${snapshot.branch}:refs/heads/${archive}`],
    snapshot.featureRoot,
    true,
  )
  if (snapshot.remoteFeatureHead !== undefined) {
    await runChecked(
      dependencies,
      'git',
      [
        'push',
        REMOTE,
        `--force-with-lease=refs/heads/${snapshot.branch}:${snapshot.remoteFeatureHead}`,
        `:refs/heads/${snapshot.branch}`,
      ],
      snapshot.featureRoot,
      true,
    )
  }
  await advanceSnapshot(snapshot, 'archived', dependencies)
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
  ) {
    Errors.throwUserInput(`Merge snapshot has an unsupported shape: ${path}`)
  }
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
  requiredTransport?: RemoteTransport,
): Promise<{ refs: Map<string, string>; transport: RemoteTransport }> {
  if (requiredTransport !== 'direct') {
    const broker = await dependencies.inspectRemote?.(cwd, branches)
    if (broker !== undefined) {
      return { refs: new Map(broker.refs), transport: 'broker' }
    }
    if (requiredTransport === 'broker') {
      Errors.throwHostEnvironment(
        "The Tao landing broker is unavailable. Run 'just landing-setup' in a normal terminal and retry.",
      )
    }
  }
  const result = await dependencies.run('git', {
    args: ['ls-remote', '--heads', REMOTE, ...branches.map(branch => `refs/heads/${branch}`)],
    cwd,
  })
  if (isSandboxDenial(result)) {
    Errors.throwHostEnvironment(
      `The sandbox denied merge-with-main's query of remote '${REMOTE}'. `
        + "Install the credential-isolated service with 'just landing-setup' in a normal terminal, then retry.",
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
    mutation?: 'feature' | 'none'
    stdio?: CLI.CommandStdio
  } = {},
): Promise<CLI.CommandResult> {
  const mutation = options.mutation ?? 'none'
  await assertExpectedLocalState(snapshot, dependencies)
  const result = await dependencies.run(command, { args, cwd, stdio: options.stdio ?? 'stream' })
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
