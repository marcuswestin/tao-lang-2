import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import {
  MachineLanes,
  MachineResourceBusyError,
  type MachineResourceLease,
} from './MachineLanes'

const SNAPSHOT_VERSION = 2
const MAX_STABILIZATION_PASSES = 3
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
const LANDING_RESOURCE_NAME = 'merge-with-main-landing'
// Bounded rather than infinite: a genuinely stuck peer lease (a crashed process whose registry
// entry a host cannot yet prove dead) must eventually surface as an actionable error rather than
// hang a landing forever.
const LEASE_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1_000
const MERGE_PHASES: readonly MergePhase[] = [
  'prepared',
  'feature-integrated',
  'feature-verified',
  'squashed',
  'integration-verified',
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
  /** Skip the otherwise mandatory unsandboxed full verification of the integration tree. */
  skipFullVerify?: boolean
  /** Skip the staged-squash `just verify --complete` pass. */
  skipVerify?: boolean
}

/** MergePhase names each durable recovery boundary in the landing workflow. */
export type MergePhase =
  | 'prepared'
  | 'feature-integrated'
  | 'feature-verified'
  | 'squashed'
  | 'integration-verified'
  | 'committed'
  | 'push-started'
  | 'pushed'
  | 'archived'
  | 'complete'
  | 'aborted'
  | 'failed'

/**
 * MergeSnapshot records the exact local state the command owns and may safely restore. Landing no
 * longer mutates a shared `main` worktree at all: the squash is staged and verified in a disposable
 * integration worktree, so the only durable state this command owns is the invoking feature worktree
 * plus this snapshot itself. That worktree is removed when the landing succeeds and deliberately
 * kept when it fails, because it holds the only copy of what went wrong.
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
  /** The squash commit's head inside the (by now removed) integration worktree, once committed. */
  integrationHead?: string
  /** Present only while the disposable integration worktree exists; absent once it is removed. */
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
  if (lines.length < 3 || lines.slice(2).some(line => !/^- \S/u.test(line))) {
    Errors.throwUserInput(
      'The merge message must end with a contiguous bullet block using one `- ...` bullet per line.',
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
  // Landing no longer requires a checked-out `main` worktree at all: it stages and verifies the
  // squash in a disposable worktree of its own. `main` the *ref* still has to agree with
  // `origin/main` before landing starts — that is a correctness check on the ref, not on any
  // worktree that happens to have it checked out.
  const mainHead = (await git(dependencies, featureRoot, ['rev-parse', `refs/heads/${MAIN_BRANCH}`])).stdout.trim()

  const remoteRefs = await remoteHeads(dependencies, featureRoot, [MAIN_BRANCH, branch, `merged/${branch.slice(5)}`])
  const remoteMainHead = remoteRefs.get(MAIN_BRANCH)
  if (!remoteMainHead) {
    Errors.throwHostEnvironment(`Remote '${REMOTE}' did not report refs/heads/main.`)
  }
  if (mainHead !== remoteMainHead) {
    Errors.throwUserInput(
      `Local main (${shortSha(mainHead)}) is not at ${REMOTE}/main (${
        shortSha(remoteMainHead)
      }); refresh it before merging.`,
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
        || options.skipFullVerify === true
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
        `PASS  Landing lease acquired: ${lease.owner.command}`,
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
      return { lines: completed, mode: 'executed' }
    } finally {
      await lease.release()
    }
  },
} as const

/** Report whether the integration tree's `just full-verify` pass is skipped, and by which flag. */
function fullVerifySkippedBy(options: MergeWithMainOptions): string | undefined {
  return options.skipFullVerify === true ? '--skip-full-verify' : options.skipAll === true ? '--skip-all' : undefined
}

/** Report whether the integration tree's `just verify --complete` pass is skipped, and by which flag. */
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
    'PLAN  Create a disposable integration worktree from origin/main and squash the feature branch onto it.',
    'PLAN  Prove the staged squash tree equals the feature tree.',
    fullVerifySkip === undefined
      ? 'PLAN  Run just full-verify on the integration worktree, once.'
      : stagedVerifySkip === undefined
      ? `PLAN  Skip just full-verify because ${fullVerifySkip} was passed; run just verify --complete on the `
        + 'integration worktree instead.'
      : `PLAN  Skip all verification of the integration worktree because ${stagedVerifySkip} was passed.`,
    'PLAN  Fetch and, if origin/main moved during verification, rebuild and re-verify the integration worktree '
    + '(up to 3 attempts).',
    "PLAN  Commit the staged squash with Git's generated squash appendix.",
    'PLAN  Push the integration worktree onto main, archive the remote feature branch, detach its clean worktree, '
    + 'delete its local branch, and prune.',
    'PLAN  Move local main to the pushed commit if some worktree has it checked out and is clean, or if none '
    + 'does; warn without failing otherwise.',
    'PLAN  Remove the disposable integration worktree on every exit path, success or failure.',
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
  if (options.skipFullVerify === true) {
    parts.push('--skip-full-verify')
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
  return `--skip-all runs no fix, no typecheck, no lint, no tests, and no verification of the integration `
    + `tree built from '${branch}'. An unverified squash of '${branch}' would then be pushed to main, whose `
    + 'linear history is the product of squashing, so it cannot be fast-forwarded away afterwards. '
    + 'Really merge with nothing checked at all?'
}

/**
 * Nothing serializes landing today except this lease: preflight allows any number of worktrees to
 * reach it at once, and each builds and verifies its own disposable integration worktree, so two
 * concurrent landings must not race each other onto the same `main` tip. The lease is held from
 * here through push and released whichever way the landing ends.
 */
async function acquireLandingLease(
  dependencies: MergeWithMainDependencies,
  preflight: MergePreflight,
): Promise<MachineResourceLease> {
  const command = `merge-with-main ${preflight.branch}`
  const request = async (waitTimeoutMs: number) =>
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
    dependencies.writeLine(
      `WARN  Landing lease held by '${owner.command}' in ${owner.repositoryRoot} (PID ${owner.pid}), `
        + `held for ${describeHeldFor(owner.startedAt, dependencies.now())}.`,
    )
    dependencies.writeLine('WARN  Waiting for the landing lease to free...')
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
 * fetchMain confirms the remote's current main rather than assuming local state is authoritative.
 * `git fetch` has no network inside the agent sandbox, so a failure here must read as "the remote
 * could not be confirmed", not be swallowed into treating whatever main last observed as current.
 */
async function fetchMain(dependencies: MergeWithMainDependencies, featureRoot: string): Promise<void> {
  const result = await dependencies.run('git', {
    args: ['fetch', '--prune', REMOTE, `refs/heads/${MAIN_BRANCH}`],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    Errors.throwHostEnvironment(
      `Could not fetch '${REMOTE}' to confirm its current main; treating the remote as unconfirmed rather `
        + `than assuming local state is authoritative. ${result.stderr.trim()}`,
      { details: { stderr: result.stderr } },
    )
  }
}

/**
 * stabilizeAndVerify builds the disposable integration worktree from the remote's current main,
 * squashes the feature branch onto it, and verifies that exact tree once. Verifying a tree the
 * command is not going to ship is what used to force a re-integrate-and-verify cycle when main
 * moved; verifying the tree that will actually be pushed removes that cycle, and only origin/main
 * moving again during that verification still restarts the (bounded) loop.
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

    await disposeIntegrationWorktree(snapshot, dependencies)
    await buildAndVerifyIntegrationTree(snapshot, fetchedMain, options, dependencies)

    const remoteMain = (await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH])).get(MAIN_BRANCH)
    if (!remoteMain) {
      Errors.throwHostEnvironment(`Remote '${REMOTE}' stopped reporting refs/heads/main.`)
    }
    if (remoteMain === fetchedMain) {
      snapshot.remoteMainHead = remoteMain
      await persistSnapshot(snapshot, dependencies)
      return
    }
    if (pass === MAX_STABILIZATION_PASSES) {
      // Keep this pass's integration worktree: it is the evidence of what was verified against the
      // main tip that kept moving, and the caller's handler names where it is.
      await markFailed(snapshot, dependencies)
      Errors.throwHostEnvironment(
        `${REMOTE}/main moved during ${MAX_STABILIZATION_PASSES} consecutive verification passes; `
          + 'stop and retry when main is stable.',
      )
    }
    dependencies.writeLine(
      `WARN  ${REMOTE}/main moved during verification; rebuilding the integration worktree and restarting `
        + `verification (pass ${pass + 1}/${MAX_STABILIZATION_PASSES}).`,
    )
  }
}

/** Create the disposable integration worktree at `mainSha`, squash the feature branch onto it, and verify once. */
async function buildAndVerifyIntegrationTree(
  snapshot: MergeSnapshot,
  mainSha: string,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const integrationRoot = FS.resolvePath(
    `.artifacts/merge/integration-${snapshot.createdAt.replaceAll(/[:.]/gu, '-')}-${Platform.randomUUID().slice(0, 8)}`,
    snapshot.featureRoot,
  )
  await runChecked(dependencies, 'git', ['worktree', 'add', '--detach', integrationRoot, mainSha], snapshot.featureRoot)
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

  const fullVerifySkip = fullVerifySkippedBy(options)
  const stagedVerifySkip = stagedVerifySkippedBy(options)
  if (fullVerifySkip === undefined) {
    await runIntegrationCommand(
      snapshot,
      'just',
      ['full-verify'],
      'integration-verified',
      dependencies,
      { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
    )
  } else if (stagedVerifySkip === undefined) {
    await runIntegrationCommand(
      snapshot,
      'just',
      ['verify', '--complete'],
      'integration-verified',
      dependencies,
      { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
    )
  } else {
    writeLines(dependencies, [
      `WARN  Skipped all verification of integration tree ${shortSha(stagedTree)} because ${stagedVerifySkip} `
      + 'was passed; nothing has verified these bytes.',
    ])
    await advanceSnapshot(snapshot, 'integration-verified', dependencies)
  }

  const stagedTreeAfterVerify = (await git(dependencies, integrationRoot, ['write-tree'])).stdout.trim()
  if (stagedTreeAfterVerify !== stagedTree) {
    Errors.throwUnexpected('Verification changed the staged integration tree.', {
      details: { stagedTree, stagedTreeAfterVerify },
    })
  }
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
  await runIntegrationCommand(snapshot, 'git', ['commit', '-F', commitMessagePath], 'committed', dependencies)
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
    if (observedMain === snapshot.integrationHead) {
      // A transport can report failure after the remote accepted the update. The exact remote ref
      // is stronger evidence than the process result, so recovery must stay on the irreversible side.
      await advanceSnapshot(snapshot, 'pushed', dependencies)
    } else if (observedMain !== undefined && observedMain !== snapshot.remoteMainHead) {
      // The force-with-lease proves this push changed nothing. Restore the reversible phase so the
      // guarded abort may remove only the disposable integration worktree before a fresh preflight.
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

  // The remote is now authoritative, so a local `main` left behind is a convenience problem, never
  // a landing problem: this only ever warns, and never throws, no matter which way it fails.
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
 * refreshLocalMain moves local `main` to the commit that was just pushed, so the next landing's
 * preflight sees an up-to-date ref instead of failing until a person fast-forwards it by hand.
 * Pushing only ever advances `origin/main`; nothing else in this command moves the local ref.
 *
 * The two cases are not interchangeable (see the `git-workflow` skill, "Moving a branch ref"):
 * a branch checked out somewhere must be fast-forwarded with `git merge --ff-only` from inside that
 * worktree, because `git update-ref` would move the ref while leaving that worktree's index and
 * tree behind, and `git status` there would then report the whole difference as staged changes,
 * inverted and alarming. A branch checked out nowhere has no worktree to run that in, so
 * `git update-ref` is the only option and is safe precisely because nothing has it checked out.
 *
 * The remote is already authoritative by the time this runs, so any failure here — the main
 * worktree is dirty, or the fast-forward is refused for some other reason — is only ever a warning
 * naming the exact command to run by hand; it must never fail a landing that has already happened.
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
        `WARN  Could not move local main, which no worktree has checked out, to the pushed commit. `
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
 * went wrong. Name it so the evidence can be read and the worktree removed once it has been.
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
    // `--force` is required because a squash conflict or a fixer leaves the worktree dirty; a
    // disposable worktree that failed mid-stage is exactly the case this cleanup exists for.
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
    const current = await readFeatureState(snapshot, dependencies)
    if (featureStateMatches(snapshot, current) || recoverableMergeFailureStatus(current.featureStatus)) {
      adoptFeatureState(snapshot, current)
    }
    await markFailed(snapshot, dependencies)
    assertCommandSucceeded(result)
  }
  const current = await readFeatureState(snapshot, dependencies)
  adoptFeatureState(snapshot, current)
  snapshot.phase = successPhase
  await persistSnapshot(snapshot, dependencies)
  return result
}

/** Run a command inside the disposable integration worktree, asserting the feature worktree stays untouched. */
async function runIntegrationCommand(
  snapshot: MergeSnapshot,
  command: string,
  args: readonly string[],
  successPhase: MergePhase,
  dependencies: MergeWithMainDependencies,
  options: { stdio?: CLI.CommandStdio } = {},
): Promise<CLI.CommandResult> {
  const integrationRoot = requireIntegrationRoot(snapshot)
  await assertFeatureUnchanged(snapshot, dependencies)
  const result = await dependencies.run(command, { args, cwd: integrationRoot, stdio: options.stdio ?? 'stream' })
  const succeeded = result.exitCode === 0 && result.error === undefined && result.signal === null
  if (!succeeded) {
    await markFailed(snapshot, dependencies)
    assertCommandSucceeded(result)
  }
  try {
    await assertFeatureUnchanged(snapshot, dependencies)
  } catch (error) {
    await markFailed(snapshot, dependencies)
    throw error
  }
  snapshot.phase = successPhase
  await persistSnapshot(snapshot, dependencies)
  assertCommandSucceeded(result)
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
