import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { MachineLanes, MachineResourceBusyError, type MachineResourceLease } from './MachineLanes'

const SNAPSHOT_VERSION = 2
const MAX_STABILIZATION_PASSES = 3
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
/** The machine-wide name every worktree's landing contends for; one holder at a time, machine-wide. */
const LANDING_RESOURCE_NAME = 'merge-with-main-landing'
/**
 * Bounded rather than infinite: a peer lease a host cannot yet prove dead must eventually surface as
 * an actionable error naming its holder, rather than hang a landing forever with nothing to read.
 */
const LEASE_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1_000
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
  /** Skip the `just verify --complete` pass that stands in when `just verify-full` was skipped. */
  skipVerify?: boolean
  /** Skip the otherwise mandatory unsandboxed full verification of the integration tree. */
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

/**
 * MergeSnapshot records the exact local state the command owns and may safely restore.
 *
 * Landing does not mutate a shared `main` checkout at all: the squash is staged, verified, and
 * committed in a disposable integration worktree built at `origin/main`. The only durable state this
 * command owns is therefore the invoking feature worktree plus this snapshot, which is the recovery
 * record for a process that died before its own cleanup ran. The integration worktree is removed
 * when the landing succeeds or is aborted, and deliberately kept when it fails, because it then
 * holds the only copy of what went wrong.
 */
export type MergeSnapshot = {
  branch: string
  createdAt: string
  currentFeatureDiff: string
  currentFeatureHead: string
  currentFeatureStatus: string
  featureHead: string
  featureIndexTree: string
  featureRoot: string
  featureTree: string
  /** The squash commit inside the integration worktree, once it exists; this is what gets pushed. */
  integrationHead?: string
  /** Present while the disposable integration worktree exists; absent once it has been removed. */
  integrationRoot?: string
  mainHead: string
  messageFile: string
  phase: MergePhase
  remoteFeatureHead?: string
  remoteMainHead: string
  snapshotPath: string
  stagedTree?: string
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
  remoteFeatureHead?: string
  remoteFeatureBehind: boolean
  remoteMainHead: string
  remoteMergedHead?: string
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

/** MergeWithMainDependencies isolates process, filesystem, terminal, clock, and lease effects for testing. */
export type MergeWithMainDependencies = {
  acquireLease: typeof MachineLanes.acquireResource
  askConfirm: (message: string) => Promise<boolean>
  exists: (path: string) => Promise<boolean>
  isInteractive: () => boolean
  move: (fromPath: string, toPath: string) => Promise<void>
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  readText: (path: string) => Promise<string>
  remove: (path: string) => Promise<void>
  run: MergeCommandRunner
  writeJson: (path: string, value: unknown) => Promise<void>
  writeLine: (line: string) => void
  writeText: (path: string, value: string) => Promise<void>
}

type Worktree = {
  branch?: string
  head: string
  path: string
}

const defaultDependencies: MergeWithMainDependencies = {
  acquireLease: MachineLanes.acquireResource,
  askConfirm: async message => await HCI.askConfirm({ defaultValue: false, message }),
  exists: FS.exists,
  isInteractive: HCI.isInteractive,
  move: FS.move,
  now: () => new Date(),
  readJson: FS.readJson,
  readText: FS.readText,
  remove: FS.remove,
  run: CLI.run,
  writeJson: FS.writeJson,
  writeLine: HCI.writeLine,
  writeText: FS.writeText,
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
  if (/^(?:co-authored-by|generated(?:-by|-with)?|ai-assisted-by|assisted-by):\s*\S/imu.test(message)) {
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
  if (!branch.startsWith('feat/')) {
    Errors.throwUserInput(
      `merge-with-main requires a feat/* branch; this worktree is on '${branch || 'detached HEAD'}'.`,
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
  // Landing needs no checkout on main, and does not care how many there are: it stages, verifies and
  // commits the squash in a disposable worktree of its own and pushes from there. Main the *ref*
  // still has to agree with `origin/main` before landing starts, because the squash is built on that
  // ref's tip — but that is a statement about the ref, not about any worktree holding it.
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

  const remoteRefs = await remoteHeads(dependencies, featureRoot, [MAIN_BRANCH, branch, `merged/${branch.slice(5)}`])
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
  const remoteMergedHead = remoteRefs.get(`merged/${branch.slice(5)}`)
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
    remoteFeatureHead,
    remoteFeatureBehind,
    remoteMainHead,
    remoteMergedHead,
    warnings,
  }
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
    const lease = await acquireLandingLease(dependencies, preflight)
    try {
      const snapshot = await createSnapshot(preflight, dependencies)
      writeLines(dependencies, [
        ...preflight.warnings.map(warning => `WARN  ${warning}`),
        `PASS  Landing lease held by this run: ${lease.owner.command}`,
        `PASS  Safety snapshot: ${snapshot.snapshotPath}`,
      ])

      try {
        await stabilizeAndVerify(snapshot, options, dependencies)
        await commitSquash(snapshot, preflight.message, dependencies)
        await pushArchiveAndPreserve(snapshot, dependencies)
      } catch (error) {
        // A landing that failed leaves its integration worktree where it is. Removing it would
        // destroy the staged squash, the conflict, or the red tree that explains the failure, and
        // the snapshot alone cannot reproduce them. Say where it is instead: a stray worktree is
        // cheap to remove once its evidence has been read, and `git worktree list` shows it.
        warnAboutStrandedIntegrationWorktree(snapshot, dependencies)
        throw error
      }
      await disposeIntegrationWorktree(snapshot, dependencies)

      const completed = [
        `PASS  Merged '${preflight.branch}' into main and archived it as merged/${preflight.branch.slice(5)}.`,
        `PASS  Preserved the clean invoking worktree at ${preflight.featureRoot} on detached HEAD; `
        + 'archive its owning task when you are ready to remove it.',
      ]
      writeLines(dependencies, completed)
      return { lines: completed, mode: 'executed', snapshotPath: snapshot.snapshotPath }
    } finally {
      await lease.release()
    }
  },
} as const

/** Report whether the feature branch's `just verify-full` pass is skipped, and by which flag. */
function fullVerifySkippedBy(options: MergeWithMainOptions): string | undefined {
  return options.skipVerifyFull === true ? '--skip-verify-full' : options.skipAll === true ? '--skip-all' : undefined
}

/** Report whether the staged squash's `just verify --complete` pass is skipped, and by which flag. */
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
    `PASS  Local main matches ${REMOTE}/main: ${shortSha(preflight.mainHead)}`,
    `PASS  ${REMOTE}/main is an ancestor of the feature branch.`,
    `PASS  Merge message: ${preflight.messageFile}`,
    `PASS  Remote '${REMOTE}' is reachable.`,
    ...preflight.warnings.map(warning => `WARN  ${warning}`),
    'PLAN  Wait for the machine-wide landing lease, so this landing does not race another.',
    'PLAN  Write a safety snapshot before creating the disposable integration worktree.',
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
    `PLAN  Create a disposable integration worktree at ${REMOTE}/main, squash the feature branch onto it, and prove `
    + 'the staged tree equals the feature tree.',
    fullVerifySkip === undefined
      ? "PLAN  Accept that tree equality as the staged squash's evidence; full verification proved the same bytes."
      : stagedVerifySkip === undefined
      ? 'PLAN  Run just verify --complete on the feature branch instead, because nothing else verified this branch.'
      : `PLAN  Skip just verify --complete because ${stagedVerifySkip} was passed; `
        + 'no lane will have verified these bytes.',
    "PLAN  Commit the staged squash with Git's generated squash appendix.",
    'PLAN  Push main from the integration worktree, archive the remote feature branch, detach its clean worktree, '
    + 'delete its local branch, and prune.',
    'PLAN  Move local main to the pushed commit, warning without failing when it cannot be moved.',
    'PLAN  Remove the disposable integration worktree once the landing succeeds; keep it and say where it is if '
    + 'the landing fails.',
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

/**
 * Nothing else serializes landing. Preflight lets any number of worktrees reach execution at once,
 * and each builds its own integration worktree on the same `origin/main` tip, so without this lease
 * two of them stage and push competing squashes and only the loser finds out — after it has paid a
 * full verification. The lease is taken before any state is written, held through the push, and
 * released whichever way the landing ends.
 *
 * There is no takeover and no flag to skip the wait: ending someone else's landing mid-squash is not
 * a decision to make on their behalf, so the only two outcomes are waiting and a named holder.
 */
async function acquireLandingLease(
  dependencies: MergeWithMainDependencies,
  preflight: MergePreflight,
): Promise<MachineResourceLease> {
  const command = `merge-with-main ${preflight.branch}`
  const request = async (waitTimeoutMs: number): Promise<MachineResourceLease> =>
    await dependencies.acquireLease({
      command,
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
      'WARN  Waiting for it to free; landings run one at a time on this machine.',
    ])
    return await request(LEASE_WAIT_TIMEOUT_MS)
  }
}

function describeHeldFor(startedAt: string, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(startedAt))
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) {
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

async function createSnapshot(
  preflight: MergePreflight,
  dependencies: MergeWithMainDependencies,
): Promise<MergeSnapshot> {
  const createdAt = dependencies.now().toISOString()
  const stamp = `${createdAt.replaceAll(/[:.]/gu, '-')}-${Platform.randomUUID().slice(0, 8)}`
  // A snapshot is what `--abort` restores from, so it lives in the invoking worktree, which this
  // command preserves through success and failure alike — never in a checkout it disposes of.
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
    featureHead: preflight.branchHead,
    featureIndexTree,
    featureRoot: preflight.featureRoot,
    featureTree,
    mainHead: preflight.mainHead,
    messageFile: preflight.messageFile,
    phase: 'prepared',
    remoteFeatureHead: preflight.remoteFeatureHead,
    remoteMainHead: preflight.remoteMainHead,
    snapshotPath,
    version: SNAPSHOT_VERSION,
  }
  await persistSnapshot(snapshot, dependencies)
  return snapshot
}

/**
 * fetchMain confirms what the remote's main actually is, rather than assuming local state is
 * authoritative. `git fetch` has no network inside the agent sandbox, so a failure here has to read
 * as "the remote could not be confirmed" — swallowing it would silently promote a stale local ref
 * into the tip a squash gets built on.
 */
async function fetchMain(dependencies: MergeWithMainDependencies, featureRoot: string): Promise<void> {
  const result = await dependencies.run('git', {
    args: ['fetch', '--prune', REMOTE],
    cwd: featureRoot,
    stdio: 'stream',
  })
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    Errors.throwHostEnvironment(
      `Could not fetch '${REMOTE}' to confirm its current main, so the remote is unconfirmed; this landing will `
        + 'not treat local state as authoritative. Run it from a shell that can reach the remote. '
        + result.stderr.trim(),
      { details: { stderr: result.stderr } },
    )
  }
}

/**
 * stabilizeAndVerify integrates `origin/main` into the feature branch and verifies that branch,
 * once `origin/main` has held still across the lane.
 *
 * The lane runs in the invoking worktree rather than in the disposable one, and that is not a
 * compromise: preflight already refuses to start unless `origin/main` is an ancestor of the feature
 * branch, so squashing the branch onto that tip can only produce the feature tree. The tree this
 * worktree holds *is* the tree that ships, by construction, and `stageSquash` proves it again from
 * Git rather than from this argument. Verifying here is also the only place the evidence is
 * affordable: the green-tree store is per checkout and keyed on the resolved `.devenv/profile`, and
 * a worktree created a moment ago has neither, so the same lane in the integration worktree would
 * run cold and reinstall dependencies on every landing.
 */
async function stabilizeAndVerify(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  for (let pass = 1; pass <= MAX_STABILIZATION_PASSES; pass += 1) {
    await assertExpectedLocalState(snapshot, dependencies)
    await fetchMain(dependencies, snapshot.featureRoot)
    const fetchedMain = (await git(dependencies, snapshot.featureRoot, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`]))
      .stdout.trim()
    const featureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    const ancestor = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', fetchedMain, featureHead],
      cwd: snapshot.featureRoot,
    })
    if (ancestor.exitCode === 1) {
      await runAndSnapshotFeature(
        snapshot,
        'git',
        ['merge', '--no-edit', `${REMOTE}/${MAIN_BRANCH}`],
        snapshot.featureRoot,
        'feature-integrated',
        dependencies,
      )
    } else {
      assertCommandSucceeded(ancestor)
    }

    await verifyFeatureBranch(snapshot, options, dependencies)

    const remoteMain = (await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH])).get(MAIN_BRANCH)
    if (!remoteMain) {
      Errors.throwHostEnvironment(`Remote '${REMOTE}' stopped reporting refs/heads/main.`)
    }
    if (remoteMain === fetchedMain) {
      snapshot.remoteMainHead = remoteMain
      await persistSnapshot(snapshot, dependencies)
      // Nothing is staged until the tip has held still, so a red lane leaves no worktree behind and
      // has nothing to clean up.
      await stageSquash(snapshot, fetchedMain, options, dependencies)
      return
    }
    if (pass === MAX_STABILIZATION_PASSES) {
      await markFailed(snapshot, dependencies)
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
 * Run the one lane this landing pays for, in the invoking worktree. `--skip-verify` has no effect
 * until `verify-full` is gone: with full verification running there is no second pass for it to
 * remove, which is why the two flags read as one ladder rather than as independent switches.
 */
async function verifyFeatureBranch(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const fullVerifySkip = fullVerifySkippedBy(options)
  if (fullVerifySkip === undefined) {
    await runWatchedCommand(
      snapshot,
      'just',
      ['verify-full'],
      snapshot.featureRoot,
      'feature-verified',
      dependencies,
      { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
    )
    return
  }
  dependencies.writeLine(
    `WARN  Skipped just verify-full on '${snapshot.branch}' because ${fullVerifySkip} `
      + 'was passed.',
  )
  if (stagedVerifySkippedBy(options) === undefined) {
    // Nothing else verifies this branch, so this pass is the evidence the squash will stand on.
    await runWatchedCommand(
      snapshot,
      'just',
      ['verify', '--complete'],
      snapshot.featureRoot,
      'feature-verified',
      dependencies,
      { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
    )
    return
  }
  await advanceSnapshot(snapshot, 'feature-verified', dependencies)
}

/**
 * stageSquash builds the disposable integration worktree at `mainSha` and squashes the verified
 * feature branch onto it. It exists so that landing never touches a `main` checkout a person owns:
 * the worktree is this command's own, it holds the squash, the commit and the push, and nothing
 * else on the machine can be looking at it.
 */
async function stageSquash(
  snapshot: MergeSnapshot,
  mainSha: string,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const integrationRoot = FS.resolvePath(
    `.artifacts/merge/integration-${snapshot.createdAt.replaceAll(/[:.]/gu, '-')}-${Platform.randomUUID().slice(0, 8)}`,
    snapshot.featureRoot,
  )
  // Detached, so this worktree claims no branch name any other worktree or landing could want.
  await runChecked(
    dependencies,
    'git',
    ['worktree', 'add', '--detach', integrationRoot, mainSha],
    snapshot.featureRoot,
    true,
  )
  snapshot.integrationRoot = integrationRoot
  await persistSnapshot(snapshot, dependencies)

  const stableFeatureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  const stableFeatureTree = (await git(
    dependencies,
    snapshot.featureRoot,
    ['rev-parse', `${stableFeatureHead}^{tree}`],
  )).stdout.trim()
  const squashResult = await dependencies.run('git', {
    args: ['merge', '--squash', stableFeatureHead],
    cwd: integrationRoot,
    stdio: 'stream',
  })
  if (squashResult.exitCode !== 0 || squashResult.error !== undefined || squashResult.signal !== null) {
    await markFailed(snapshot, dependencies)
    assertCommandSucceeded(squashResult)
  }
  await assertFeatureUnchanged(snapshot, dependencies)
  const stagedTree = (await git(dependencies, integrationRoot, ['write-tree'])).stdout.trim()
  snapshot.stagedTree = stagedTree
  snapshot.phase = 'squashed'
  await persistSnapshot(snapshot, dependencies)
  if (stagedTree !== stableFeatureTree) {
    Errors.throwUnexpected('The staged squash tree does not equal the verified feature tree.', {
      details: { stableFeatureTree, stagedTree },
    })
  }

  // Git has just said the staged squash is the same tree, byte for byte, as the head a lane proved
  // a moment ago. Running the repository's slowest lane over those same bytes a second time can
  // only reproduce that verdict, so the equality above is the evidence this phase records.
  const fullVerifySkip = fullVerifySkippedBy(options)
  const stagedVerifySkip = stagedVerifySkippedBy(options)
  writeLines(dependencies, [
    fullVerifySkip === undefined
      ? `PASS  Staged squash tree ${shortSha(stagedTree)} equals the fully verified feature tree; `
        + 'not verifying the same bytes twice.'
      : stagedVerifySkip === undefined
      ? `PASS  Staged squash tree ${shortSha(stagedTree)} equals the feature tree just verify --complete proved.`
      : `WARN  Skipped just verify --complete on staged squash tree ${shortSha(stagedTree)} because `
        + `${stagedVerifySkip} was passed; it equals the feature tree, which no lane verified.`,
  ])
  await advanceSnapshot(snapshot, 'main-verified', dependencies)
}

async function commitSquash(
  snapshot: MergeSnapshot,
  message: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const integrationRoot = requireIntegrationRoot(snapshot)
  const squashMessagePath = FS.resolvePath(
    (await git(
      dependencies,
      integrationRoot,
      ['rev-parse', '--git-path', 'SQUASH_MSG'],
    )).stdout.trim(),
    integrationRoot,
  )
  if (!await dependencies.exists(squashMessagePath)) {
    Errors.throwUnexpected('git merge --squash did not produce SQUASH_MSG.')
  }
  const appendix = (await dependencies.readText(squashMessagePath)).trim()
  if (!appendix.startsWith('Squashed commit of the following:')) {
    Errors.throwUnexpected('Git produced an unrecognised squash appendix.', { details: { squashMessagePath } })
  }
  const commitMessagePath = `${snapshot.snapshotPath}.commit-message`
  const finalMessage = `${message}\n\n${appendix}\n`
  assertNoAutomatedAttribution(finalMessage)
  await dependencies.writeText(commitMessagePath, finalMessage)
  await runWatchedCommand(
    snapshot,
    'git',
    ['commit', '-F', commitMessagePath],
    integrationRoot,
    'committed',
    dependencies,
  )
  const committedTree = (await git(dependencies, integrationRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
  if (snapshot.stagedTree === undefined || committedTree !== snapshot.stagedTree) {
    Errors.throwUnexpected('The committed integration tree does not equal the verified squash tree.', {
      details: { committedTree, verifiedTree: snapshot.stagedTree },
    })
  }
  snapshot.integrationHead = (await git(dependencies, integrationRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  await persistSnapshot(snapshot, dependencies)
}

async function pushArchiveAndPreserve(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const integrationRoot = requireIntegrationRoot(snapshot)
  await advanceSnapshot(snapshot, 'push-started', dependencies)
  const pushMain = await dependencies.run('git', {
    args: [
      'push',
      REMOTE,
      `--force-with-lease=refs/heads/${MAIN_BRANCH}:${snapshot.remoteMainHead}`,
      `HEAD:refs/heads/${MAIN_BRANCH}`,
    ],
    cwd: integrationRoot,
    stdio: 'stream',
  })
  if (pushMain.exitCode !== 0 || pushMain.error !== undefined || pushMain.signal !== null) {
    const observedMain = (await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH])).get(MAIN_BRANCH)
    if (observedMain !== undefined && observedMain === snapshot.integrationHead) {
      // A transport can report failure after the remote accepted the update. The exact remote ref
      // is stronger evidence than the process result, so recovery must stay on the irreversible side.
      await advanceSnapshot(snapshot, 'pushed', dependencies)
    } else if (observedMain !== undefined && observedMain !== snapshot.remoteMainHead) {
      // The force-with-lease proves this push changed nothing. Restore the reversible phase so the
      // guarded abort may dispose of the integration worktree before a fresh preflight.
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

  // The remote is authoritative from here on, so a local `main` left behind is a convenience
  // problem, never a landing problem: this only ever warns.
  await refreshLocalMain(snapshot, dependencies)

  const archive = `merged/${snapshot.branch.slice(5)}`
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
  const preservedState = await readFeatureState(snapshot, dependencies)
  if (
    preservedState.featureHead !== snapshot.currentFeatureHead
    || preservedState.featureStatus !== ''
    || preservedState.featureDiff !== ''
  ) {
    Errors.throwUnexpected('The preserved feature worktree changed while detaching its archived tip.')
  }
  adoptFeatureState(snapshot, preservedState)
  await persistSnapshot(snapshot, dependencies)

  // A squash commit has no ancestry relationship to the feature tip, so `-d` cannot remove it even
  // after the remote is safely archived. The preceding push/archive phases make this forced local
  // deletion deliberate and recoverable.
  await runChecked(dependencies, 'git', ['branch', '-D', snapshot.branch], snapshot.featureRoot, true)
  await runChecked(dependencies, 'git', ['worktree', 'prune'], snapshot.featureRoot, true)
  snapshot.phase = 'complete'
  await persistSnapshot(snapshot, dependencies)
}

/**
 * refreshLocalMain moves local `main` to the commit just pushed, so the next landing's preflight
 * sees a current ref instead of refusing until a person fast-forwards it by hand.
 *
 * The two cases are not interchangeable (see the `git-workflow` skill, "Moving a branch ref"): a
 * branch some worktree has checked out must be fast-forwarded with `git merge --ff-only` from inside
 * that worktree, because `git update-ref` would move the ref and leave that worktree's index and
 * tree at the old commit, so `git status` there would report the whole difference as staged changes.
 * A branch no worktree holds has nowhere to run that, and `update-ref` is safe precisely because
 * nothing has it checked out.
 *
 * The remote is already authoritative by the time this runs, so every failure here is a warning
 * naming the exact command to run by hand. A landing that succeeded must never be reported as failed.
 */
async function refreshLocalMain(snapshot: MergeSnapshot, dependencies: MergeWithMainDependencies): Promise<void> {
  const pushedHead = snapshot.integrationHead
  if (pushedHead === undefined) {
    return
  }
  const worktrees = parseWorktrees(
    (await git(dependencies, snapshot.featureRoot, ['worktree', 'list', '--porcelain'])).stdout,
  )
  const mainWorktree = worktrees.find(worktree => worktree.branch === MAIN_BRANCH)

  if (mainWorktree === undefined) {
    const result = await dependencies.run('git', {
      args: ['update-ref', `refs/heads/${MAIN_BRANCH}`, pushedHead],
      cwd: snapshot.featureRoot,
      stdio: 'pipe',
    })
    if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
      dependencies.writeLine(
        'WARN  Could not move local main, which no worktree has checked out, to the pushed commit. '
          + `Run: git update-ref refs/heads/${MAIN_BRANCH} ${pushedHead}`,
      )
    }
    return
  }

  const mainStatus = await status(dependencies, mainWorktree.path)
  if (mainStatus !== '') {
    dependencies.writeLine(
      `WARN  Local main is checked out at ${mainWorktree.path}, which is not clean; leaving it behind the `
        + `pushed commit. Run: git -C ${mainWorktree.path} merge --ff-only ${pushedHead}`,
    )
    return
  }
  const fastForward = await dependencies.run('git', {
    args: ['merge', '--ff-only', pushedHead],
    cwd: mainWorktree.path,
    stdio: 'pipe',
  })
  if (fastForward.exitCode !== 0 || fastForward.error !== undefined || fastForward.signal !== null) {
    dependencies.writeLine(
      `WARN  Could not fast-forward local main at ${mainWorktree.path} to the pushed commit. `
        + `Run: git -C ${mainWorktree.path} merge --ff-only ${pushedHead}`,
    )
  }
}

/**
 * A failed landing keeps its integration worktree, because that worktree holds the only copy of what
 * went wrong — the staged squash, the conflict, or the red tree. Name it, so the evidence can be
 * read and the worktree removed once it has been.
 */
function warnAboutStrandedIntegrationWorktree(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): void {
  const integrationRoot = snapshot.integrationRoot
  if (integrationRoot === undefined) {
    return
  }
  writeLines(dependencies, [
    `WARN  The integration worktree is left at ${integrationRoot} so its state can be inspected; it holds `
    + 'the staged squash this landing failed on.',
    `WARN  Remove it when you are done: git worktree remove --force ${integrationRoot}`,
  ])
}

/** Remove the disposable integration worktree, tolerating it having already been removed or never created. */
async function disposeIntegrationWorktree(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const integrationRoot = snapshot.integrationRoot
  if (integrationRoot === undefined) {
    return
  }
  if (await dependencies.exists(integrationRoot)) {
    // `--force` is required because a squash conflict or a fixer leaves the worktree dirty, and a
    // worktree nothing else refers to is exactly what this removal is for.
    await dependencies.run('git', {
      args: ['worktree', 'remove', '--force', integrationRoot],
      cwd: snapshot.featureRoot,
      stdio: 'pipe',
    }).catch(() => {})
    await dependencies.remove(integrationRoot).catch(() => {})
  }
  await dependencies.run('git', { args: ['worktree', 'prune'], cwd: snapshot.featureRoot, stdio: 'pipe' })
    .catch(() => {})
  snapshot.integrationRoot = undefined
  await persistSnapshot(snapshot, dependencies)
}

function requireIntegrationRoot(snapshot: MergeSnapshot): string {
  if (snapshot.integrationRoot === undefined) {
    Errors.throwUnexpected('No disposable integration worktree is recorded on the merge snapshot.')
  }
  return snapshot.integrationRoot
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
  // An abort is the one place a failed landing's integration worktree is deliberately discarded: the
  // person asked for the state it holds to be undone, which is the opposite of keeping it to read.
  await disposeIntegrationWorktree(snapshot, dependencies)
  await runChecked(dependencies, 'git', ['reset', '--hard', snapshot.featureHead], snapshot.featureRoot, true)
  await dependencies.remove(`${snapshot.snapshotPath}.commit-message`).catch(() => {})
  snapshot.phase = 'aborted'
  snapshot.currentFeatureDiff = ''
  snapshot.currentFeatureHead = snapshot.featureHead
  snapshot.currentFeatureStatus = ''
  await persistSnapshot(snapshot, dependencies)
  const lines = [`PASS  Restored '${snapshot.branch}' to its recorded pre-merge state.`]
  writeLines(dependencies, lines)
  return { lines, mode: 'aborted', snapshotPath: snapshot.snapshotPath }
}

async function assertSnapshotState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readFeatureState(snapshot, dependencies)
  if (!featureStateMatches(snapshot, current)) {
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
    || typeof value.featureHead !== 'string'
    || typeof value.featureIndexTree !== 'string'
    || typeof value.featureRoot !== 'string'
    || typeof value.featureTree !== 'string'
    || typeof value.mainHead !== 'string'
    || typeof value.messageFile !== 'string'
    || !isMergePhase(value.phase)
    || typeof value.remoteMainHead !== 'string'
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
  const current = await readFeatureState(snapshot, dependencies)
  if (!featureStateMatches(snapshot, current)) {
    Errors.throwUserInput('Repository state changed after preflight; refusing to continue the merge.')
  }
}

async function assertFeatureUnchanged(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readFeatureState(snapshot, dependencies)
  if (!featureStateMatches(snapshot, current)) {
    Errors.throwUserInput('The feature worktree changed unexpectedly while the merge command was running.')
  }
}

type FeatureState = {
  featureDiff: string
  featureHead: string
  featureStatus: string
}

async function readFeatureState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<FeatureState> {
  const [featureHead, featureDiff, featureStatus] = await Promise.all([
    git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
    diff(dependencies, snapshot.featureRoot),
    status(dependencies, snapshot.featureRoot),
  ])
  return { featureDiff, featureHead, featureStatus }
}

function featureStateMatches(snapshot: MergeSnapshot, current: FeatureState): boolean {
  return current.featureHead === snapshot.currentFeatureHead
    && current.featureDiff === snapshot.currentFeatureDiff
    && current.featureStatus === snapshot.currentFeatureStatus
}

function adoptFeatureState(snapshot: MergeSnapshot, current: FeatureState): void {
  snapshot.currentFeatureHead = current.featureHead
  snapshot.currentFeatureDiff = current.featureDiff
  snapshot.currentFeatureStatus = current.featureStatus
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

async function markFailed(snapshot: MergeSnapshot, dependencies: MergeWithMainDependencies): Promise<void> {
  snapshot.phase = 'failed'
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
): Promise<Map<string, string>> {
  const result = await dependencies.run('git', {
    args: ['ls-remote', '--heads', REMOTE, ...branches.map(branch => `refs/heads/${branch}`)],
    cwd,
  })
  assertCommandSucceeded(result)
  const refs = new Map<string, string>()
  for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
    const match = /^(\S+)\s+refs\/heads\/(.+)$/u.exec(line)
    if (match) {
      refs.set(match[2]!, match[1]!)
    }
  }
  return refs
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

/** Run a Git operation that mutates the feature worktree, after the safety snapshot exists. */
async function runAndSnapshotFeature(
  snapshot: MergeSnapshot,
  command: string,
  args: readonly string[],
  cwd: string,
  successPhase: MergePhase,
  dependencies: MergeWithMainDependencies,
): Promise<CLI.CommandResult> {
  await assertExpectedLocalState(snapshot, dependencies)
  const result = await dependencies.run(command, { args, cwd, stdio: 'stream' })
  const succeeded = result.exitCode === 0 && result.error === undefined && result.signal === null
  if (!succeeded) {
    // A conflicted merge is state the abort must be able to restore from, so record it. Anything
    // else is left exactly as the snapshot already describes it.
    const failed = await readFeatureState(snapshot, dependencies)
    if (
      featureStateMatches(snapshot, failed)
      || (failed.featureHead === snapshot.currentFeatureHead && recoverableMergeFailureStatus(failed.featureStatus))
    ) {
      adoptFeatureState(snapshot, failed)
    }
    await markFailed(snapshot, dependencies)
    assertCommandSucceeded(result)
  }
  const current = await readFeatureState(snapshot, dependencies)
  if (current.featureStatus !== '' || current.featureDiff !== '') {
    Errors.throwUserInput('The feature worktree was not clean after the command-owned Git operation.')
  }
  adoptFeatureState(snapshot, current)
  snapshot.phase = successPhase
  await persistSnapshot(snapshot, dependencies)
  return result
}

/**
 * Run a command that must leave the invoking worktree exactly as it found it — a lane in that
 * worktree, or a Git operation in the disposable one — and record the phase it establishes.
 */
async function runWatchedCommand(
  snapshot: MergeSnapshot,
  command: string,
  args: readonly string[],
  cwd: string,
  successPhase: MergePhase,
  dependencies: MergeWithMainDependencies,
  options: { stdio?: CLI.CommandStdio } = {},
): Promise<CLI.CommandResult> {
  await assertExpectedLocalState(snapshot, dependencies)
  const result = await dependencies.run(command, { args, cwd, stdio: options.stdio ?? 'stream' })
  const succeeded = result.exitCode === 0 && result.error === undefined && result.signal === null
  if (!succeeded) {
    await markFailed(snapshot, dependencies)
    assertCommandSucceeded(result)
  }
  // A lane runs for minutes and is the one window wide enough for someone else's edit to land in
  // the invoking worktree. Adopting it would fold work this command never saw into the squash.
  const after = await readFeatureState(snapshot, dependencies)
  if (!featureStateMatches(snapshot, after)) {
    await markFailed(snapshot, dependencies)
    Errors.throwUserInput('Repository state changed while validation was running; refusing to continue the merge.')
  }
  snapshot.phase = successPhase
  await persistSnapshot(snapshot, dependencies)
  return result
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

function writeLines(dependencies: MergeWithMainDependencies, lines: readonly string[]): void {
  for (const line of lines) {
    dependencies.writeLine(line)
  }
}
