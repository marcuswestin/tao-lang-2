import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { randomUUID } from 'node:crypto'

// TODO(merge-with-main-default): Change `execute`'s CLI default from false to true after this command
// has landed several merges safely; retain an explicit `--dry-run` escape hatch when doing so.

const SNAPSHOT_VERSION = 1
const MAX_STABILIZATION_PASSES = 3
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
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

/** MergeWithMainOptions is the flags-ready input accepted by the development CLI command. */
export type MergeWithMainOptions = {
  /** Restore command-owned state from a snapshot instead of starting a merge. */
  abortSnapshot?: string
  /** Perform the merge. The first release deliberately defaults to a ref-preserving dry run. */
  execute?: boolean
  /** Override `.artifacts/merge/<branch>.msg`. */
  messageFile?: string
  /** Override the current repository root, principally for tests. */
  repositoryRoot?: string
  /** Explicitly authorize a push when no interactive terminal is available. */
  push?: boolean
  /** Skip the otherwise mandatory unsandboxed full verification. */
  skipFullVerify?: boolean
  /** Confirm execution non-interactively. This never implies `push`. */
  yes?: boolean
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
  currentMainHead: string
  currentMainDiff: string
  currentMainStatus: string
  featureHead: string
  featureIndexTree: string
  featureRoot: string
  featureTree: string
  mainHead: string
  mainIndexTree: string
  mainRoot: string
  mainTree: string
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
  featurePushRequired: boolean
  featureRoot: string
  mainHead: string
  mainRoot: string
  message: string
  messageFile: string
  remoteFeatureHead?: string
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

/** MergeWithMainDependencies isolates process, filesystem, terminal, and clock effects for testing. */
export type MergeWithMainDependencies = {
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
  const mainWorktrees = worktrees.filter(worktree => worktree.branch === MAIN_BRANCH)
  if (mainWorktrees.length !== 1) {
    Errors.throwUserInput(`Expected exactly one main worktree, found ${mainWorktrees.length}.`)
  }
  const mainRoot = mainWorktrees[0]!.path
  const mainStatus = await status(dependencies, mainRoot)
  assertClean('main', mainRoot, mainStatus)
  const mainHead = (await git(dependencies, mainRoot, ['rev-parse', 'HEAD'])).stdout.trim()

  const remoteRefs = await remoteHeads(dependencies, featureRoot, [MAIN_BRANCH, branch, `merged/${branch.slice(5)}`])
  const remoteMainHead = remoteRefs.get(MAIN_BRANCH)
  if (!remoteMainHead) {
    Errors.throwHostEnvironment(`Remote '${REMOTE}' did not report refs/heads/main.`)
  }
  if (mainHead !== remoteMainHead) {
    Errors.throwUserInput(
      `The main worktree is not at ${REMOTE}/main (${shortSha(remoteMainHead)}); refresh it before merging.`,
    )
  }
  // A remote feature branch left behind by earlier commits is the ordinary case, not an obstacle:
  // execution pushes it forward. Only a remote holding commits this worktree lacks must stop the
  // landing, because the squash would silently drop them.
  const remoteFeatureHead = remoteRefs.get(branch)
  let featurePushRequired = false
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
    featurePushRequired = true
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
    featurePushRequired,
    featureRoot,
    mainHead,
    mainRoot,
    message,
    messageFile,
    remoteFeatureHead,
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
        options.execute === true
        || options.push === true
        || options.skipFullVerify === true
        || options.messageFile !== undefined
      ) {
        Errors.throwUserInput('--abort cannot be combined with merge execution options; only --yes is applicable.')
      }
      return await abortMerge(options, dependencies)
    }

    const preflight = await inspectMergePreflight(options, dependencies)
    const lines = formatDryRun(preflight, options)
    if (options.execute !== true) {
      writeLines(dependencies, lines)
      return { lines, mode: 'dry-run' }
    }

    await authorizeExecution(options, dependencies, preflight)
    const snapshot = await createSnapshot(preflight, dependencies)
    writeLines(dependencies, [
      ...preflight.warnings.map(warning => `WARN  ${warning}`),
      `PASS  Safety snapshot: ${snapshot.snapshotPath}`,
    ])

    await catchUpRemoteFeature(snapshot, preflight, dependencies)
    await stabilizeAndVerify(snapshot, options, dependencies)
    await squashAndVerify(snapshot, dependencies)
    await commitSquash(snapshot, preflight.message, dependencies)
    await pushArchiveAndPreserve(snapshot, dependencies)

    const completed = [
      `PASS  Merged '${preflight.branch}' into main and archived it as merged/${preflight.branch.slice(5)}.`,
      `PASS  Preserved the clean invoking worktree at ${preflight.featureRoot} on detached HEAD; `
      + 'archive its owning task when you are ready to remove it.',
    ]
    writeLines(dependencies, completed)
    return { lines: completed, mode: 'executed', snapshotPath: snapshot.snapshotPath }
  },
} as const

function formatDryRun(preflight: MergePreflight, options: MergeWithMainOptions): string[] {
  const command = executionCommand(options)
  return [
    `PASS  Feature branch: ${preflight.branch} at ${shortSha(preflight.branchHead)}`,
    `PASS  Feature worktree clean: ${preflight.featureRoot}`,
    `PASS  Main worktree clean and current: ${preflight.mainRoot} at ${shortSha(preflight.mainHead)}`,
    `PASS  ${REMOTE}/main is an ancestor of the feature branch.`,
    `PASS  Merge message: ${preflight.messageFile}`,
    `PASS  Remote '${REMOTE}' is reachable.`,
    ...preflight.warnings.map(warning => `WARN  ${warning}`),
    'PLAN  Write a safety snapshot before moving any ref.',
    ...(preflight.featurePushRequired
      ? [`PLAN  Push '${preflight.branch}' to ${REMOTE}, whose branch is behind this worktree.`]
      : []),
    options.skipFullVerify === true
      ? 'PLAN  Skip full verification because --skip-full-verify was explicit.'
      : 'PLAN  Run just full-verify on the feature branch.',
    'PLAN  Fetch and, if main moved, merge it into the feature branch and restart full verification.',
    "PLAN  Squash onto main, compare tree hashes, run just verify, and commit with Git's squash appendix.",
    'PLAN  Push main, archive the remote feature branch, detach its clean worktree, delete its local branch, and prune.',
    'PLAN  Preserve the invoking worktree and shell until its owning task is archived.',
    `DRY RUN  No refs or worktrees changed. Execute with: ${command}`,
  ]
}

function executionCommand(options: MergeWithMainOptions): string {
  const parts = ['./dev', 'merge-with-main', '--execute']
  if (options.skipFullVerify === true) {
    parts.push('--skip-full-verify')
  }
  if (options.messageFile !== undefined) {
    parts.push('--message-file', shellQuote(options.messageFile))
  }
  return parts.join(' ')
}

function shellQuote(value: string): string {
  return /^[\w./:@+-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

async function authorizeExecution(
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
  preflight: MergePreflight,
): Promise<void> {
  const interactive = dependencies.isInteractive()
  if (!interactive && options.yes !== true) {
    Errors.throwUserInput('Non-interactive execution requires --yes; dry-run remains available without it.')
  }
  if (!interactive && options.push !== true) {
    Errors.throwUserInput('Non-interactive execution requires explicit --push authorization.')
  }
  if (
    interactive && options.yes !== true && !await dependencies.askConfirm(
      `Execute the squash merge of '${preflight.branch}' into main?`,
    )
  ) {
    Errors.throwUserInput('Merge cancelled before changing repository state.')
  }
  if (
    interactive && options.push !== true && !await dependencies.askConfirm(
      `Authorize pushing main and archiving '${preflight.branch}' on ${REMOTE}?`,
    )
  ) {
    Errors.throwUserInput('Merge cancelled before changing repository state.')
  }
}

async function createSnapshot(
  preflight: MergePreflight,
  dependencies: MergeWithMainDependencies,
): Promise<MergeSnapshot> {
  const createdAt = dependencies.now().toISOString()
  const stamp = `${createdAt.replaceAll(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
  const snapshotPath = FS.resolvePath(`.artifacts/merge/${stamp}.json`, preflight.mainRoot)
  const [featureTree, featureIndexTree, mainTree, mainIndexTree] = await Promise.all([
    git(dependencies, preflight.featureRoot, ['rev-parse', 'HEAD^{tree}']).then(result => result.stdout.trim()),
    git(dependencies, preflight.featureRoot, ['write-tree']).then(result => result.stdout.trim()),
    git(dependencies, preflight.mainRoot, ['rev-parse', 'HEAD^{tree}']).then(result => result.stdout.trim()),
    git(dependencies, preflight.mainRoot, ['write-tree']).then(result => result.stdout.trim()),
  ])
  const snapshot: MergeSnapshot = {
    branch: preflight.branch,
    createdAt,
    currentFeatureDiff: '',
    currentFeatureHead: preflight.branchHead,
    currentFeatureStatus: '',
    currentMainDiff: '',
    currentMainHead: preflight.mainHead,
    currentMainStatus: '',
    featureHead: preflight.branchHead,
    featureIndexTree,
    featureRoot: preflight.featureRoot,
    featureTree,
    mainHead: preflight.mainHead,
    mainIndexTree,
    mainRoot: preflight.mainRoot,
    mainTree,
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

/** Carry a behind remote feature branch up to this worktree so a stale remote never blocks landing. */
async function catchUpRemoteFeature(
  snapshot: MergeSnapshot,
  preflight: MergePreflight,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  if (!preflight.featurePushRequired || snapshot.remoteFeatureHead === undefined) {
    return
  }
  const pushed = snapshot.currentFeatureHead
  await runChecked(
    dependencies,
    'git',
    [
      'push',
      REMOTE,
      `--force-with-lease=refs/heads/${snapshot.branch}:${snapshot.remoteFeatureHead}`,
      `${snapshot.branch}:refs/heads/${snapshot.branch}`,
    ],
    snapshot.featureRoot,
    true,
  )
  // The archive step deletes this branch under a lease, so the lease must name what is on the
  // remote now rather than the head observed before this push.
  snapshot.remoteFeatureHead = pushed
  await persistSnapshot(snapshot, dependencies)
  writeLines(dependencies, [`PASS  Pushed '${snapshot.branch}' to ${REMOTE} at ${shortSha(pushed)}.`])
}

async function stabilizeAndVerify(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  for (let pass = 1; pass <= MAX_STABILIZATION_PASSES; pass += 1) {
    await assertExpectedLocalState(snapshot, dependencies)
    await runChecked(dependencies, 'git', ['fetch', '--prune', REMOTE], snapshot.featureRoot, true)
    const fetchedMain = (await git(dependencies, snapshot.featureRoot, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`]))
      .stdout.trim()
    const featureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    const ancestor = await dependencies.run('git', {
      args: ['merge-base', '--is-ancestor', fetchedMain, featureHead],
      cwd: snapshot.featureRoot,
    })
    if (ancestor.exitCode === 1) {
      await runAndSnapshot(
        snapshot,
        'git',
        ['merge', '--no-edit', `${REMOTE}/${MAIN_BRANCH}`],
        snapshot.featureRoot,
        'feature-integrated',
        dependencies,
        { mutation: 'feature' },
      )
    } else {
      assertCommandSucceeded(ancestor)
    }

    if (options.skipFullVerify !== true) {
      const verifiedHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      await runAndSnapshot(
        snapshot,
        'just',
        ['full-verify'],
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
      await advanceSnapshot(snapshot, 'feature-verified', dependencies)
    }

    const remoteMain = (await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH])).get(MAIN_BRANCH)
    if (!remoteMain) {
      Errors.throwHostEnvironment(`Remote '${REMOTE}' stopped reporting refs/heads/main.`)
    }
    if (remoteMain === fetchedMain) {
      snapshot.remoteMainHead = remoteMain
      await persistSnapshot(snapshot, dependencies)
      const mainHead = (await git(dependencies, snapshot.mainRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      if (mainHead !== fetchedMain) {
        // Keep main untouched until the feature has been fully verified against the stable remote
        // head. A red full verification can therefore only leave command-owned feature changes.
        await runAndSnapshot(
          snapshot,
          'git',
          ['merge', '--ff-only', `${REMOTE}/${MAIN_BRANCH}`],
          snapshot.mainRoot,
          'feature-verified',
          dependencies,
          { mutation: 'main' },
        )
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

async function squashAndVerify(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await assertExpectedLocalState(snapshot, dependencies)
  const stableFeatureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  const stableFeatureTree = (await git(
    dependencies,
    snapshot.featureRoot,
    ['rev-parse', `${stableFeatureHead}^{tree}`],
  )).stdout.trim()
  const squashResult = await dependencies.run('git', {
    args: ['merge', '--squash', stableFeatureHead],
    cwd: snapshot.mainRoot,
    stdio: 'stream',
  })
  if (squashResult.exitCode !== 0 || squashResult.error !== undefined || squashResult.signal !== null) {
    await captureFailedMutation(snapshot, 'main', dependencies)
    assertCommandSucceeded(squashResult)
  }
  const afterSquash = await readLocalState(snapshot, dependencies)
  assertFeatureMatches(snapshot, afterSquash)
  if (afterSquash.mainHead !== snapshot.currentMainHead || hasUnstagedOrUntracked(afterSquash.mainStatus)) {
    Errors.throwUserInput('Repository state changed unexpectedly while preparing the staged squash.')
  }
  const stagedTree = (await git(dependencies, snapshot.mainRoot, ['write-tree'])).stdout.trim()
  snapshot.stagedTree = stagedTree
  adoptLocalState(snapshot, afterSquash)
  snapshot.phase = 'squashed'
  await persistSnapshot(snapshot, dependencies)
  if (stagedTree !== stableFeatureTree) {
    Errors.throwUnexpected('The staged squash tree does not equal the verified feature tree.', {
      details: { stagedTree, stableFeatureTree },
    })
  }
  const mainHeadBeforeVerify = snapshot.currentMainHead
  await runAndSnapshot(
    snapshot,
    'just',
    ['verify'],
    snapshot.mainRoot,
    'main-verified',
    dependencies,
    { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
  )
  const stagedTreeAfterVerify = (await git(dependencies, snapshot.mainRoot, ['write-tree'])).stdout.trim()
  const mainHeadAfterVerify = (await git(dependencies, snapshot.mainRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  if (stagedTreeAfterVerify !== stagedTree || mainHeadAfterVerify !== mainHeadBeforeVerify) {
    Errors.throwUnexpected('Verification changed the staged squash or moved main.')
  }
}

async function commitSquash(
  snapshot: MergeSnapshot,
  message: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const squashMessagePath = FS.resolvePath(
    (await git(
      dependencies,
      snapshot.mainRoot,
      ['rev-parse', '--git-path', 'SQUASH_MSG'],
    )).stdout.trim(),
    snapshot.mainRoot,
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
  await runAndSnapshot(
    snapshot,
    'git',
    ['commit', '-F', commitMessagePath],
    snapshot.mainRoot,
    'committed',
    dependencies,
    { mutation: 'main' },
  )
  const committedTree = (await git(dependencies, snapshot.mainRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
  if (snapshot.stagedTree === undefined || committedTree !== snapshot.stagedTree) {
    Errors.throwUnexpected('The committed main tree does not equal the verified squash tree.', {
      details: { committedTree, verifiedTree: snapshot.stagedTree },
    })
  }
  await assertExpectedLocalState(snapshot, dependencies)
}

async function pushArchiveAndPreserve(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await advanceSnapshot(snapshot, 'push-started', dependencies)
  await runChecked(dependencies, 'git', ['push', REMOTE, `${MAIN_BRANCH}:${MAIN_BRANCH}`], snapshot.mainRoot, true)
  await advanceSnapshot(snapshot, 'pushed', dependencies)

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
  await runChecked(dependencies, 'git', ['branch', '-D', snapshot.branch], snapshot.mainRoot, true)
  await runChecked(dependencies, 'git', ['worktree', 'prune'], snapshot.mainRoot, true)
  snapshot.phase = 'complete'
  // The snapshot lives in main's ignored artifacts, so it survives local feature-branch deletion.
  snapshot.currentMainHead = (await git(dependencies, snapshot.mainRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  snapshot.currentMainStatus = await status(dependencies, snapshot.mainRoot)
  await persistSnapshot(snapshot, dependencies)
}

async function abortMerge(
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<MergeWithMainResult> {
  const path = FS.resolvePath(options.abortSnapshot!)
  const snapshot = await readSnapshot(path, dependencies)
  if (phaseAtOrAfterPush(snapshot.phase)) {
    Errors.throwUserInput(
      `Snapshot '${path}' reached phase '${snapshot.phase}'. Refusing to rewrite pushed history. Fetch the remote, `
        + 'inspect main and the merged/* archive against the snapshot, then complete only any missing archive or local cleanup steps; '
        + 'do not reset or force-push main.',
    )
  }
  if (!dependencies.isInteractive() && options.yes !== true) {
    Errors.throwUserInput('Non-interactive --abort requires --yes.')
  }
  if (
    dependencies.isInteractive() && options.yes !== true && !await dependencies.askConfirm(
      `Restore command-owned state recorded in '${path}'?`,
    )
  ) {
    Errors.throwUserInput('Abort cancelled without changing repository state.')
  }

  await assertSnapshotState(snapshot, dependencies)
  await runChecked(dependencies, 'git', ['reset', '--hard', snapshot.mainHead], snapshot.mainRoot, true)
  await runChecked(dependencies, 'git', ['reset', '--hard', snapshot.featureHead], snapshot.featureRoot, true)
  const squashMessagePath = FS.resolvePath(
    (await git(
      dependencies,
      snapshot.mainRoot,
      ['rev-parse', '--git-path', 'SQUASH_MSG'],
    )).stdout.trim(),
    snapshot.mainRoot,
  )
  await dependencies.remove(squashMessagePath)
  await dependencies.remove(`${snapshot.snapshotPath}.commit-message`)
  snapshot.phase = 'aborted'
  snapshot.currentFeatureDiff = ''
  snapshot.currentFeatureHead = snapshot.featureHead
  snapshot.currentFeatureStatus = ''
  snapshot.currentMainDiff = ''
  snapshot.currentMainHead = snapshot.mainHead
  snapshot.currentMainStatus = ''
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
  if (snapshot.stagedTree !== undefined) {
    const stagedTree = (await git(dependencies, snapshot.mainRoot, ['write-tree'])).stdout.trim()
    if (stagedTree !== snapshot.stagedTree) {
      Errors.throwUserInput('The staged tree no longer matches the merge snapshot; refusing to discard later work.')
    }
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
    || typeof value.currentMainDiff !== 'string'
    || typeof value.currentMainHead !== 'string'
    || typeof value.currentMainStatus !== 'string'
    || typeof value.featureHead !== 'string'
    || typeof value.featureIndexTree !== 'string'
    || typeof value.featureRoot !== 'string'
    || typeof value.featureTree !== 'string'
    || typeof value.mainHead !== 'string'
    || typeof value.mainIndexTree !== 'string'
    || typeof value.mainRoot !== 'string'
    || typeof value.mainTree !== 'string'
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
  const current = await readLocalState(snapshot, dependencies)
  if (!localStateMatches(snapshot, current)) {
    Errors.throwUserInput('Repository state changed after preflight; refusing to continue the merge.')
  }
}

type LocalState = {
  featureDiff: string
  featureHead: string
  featureStatus: string
  mainDiff: string
  mainHead: string
  mainStatus: string
}

async function readLocalState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<LocalState> {
  const [featureHead, mainHead, featureDiff, mainDiff, featureStatus, mainStatus] = await Promise.all([
    git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
    git(dependencies, snapshot.mainRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
    diff(dependencies, snapshot.featureRoot),
    diff(dependencies, snapshot.mainRoot),
    status(dependencies, snapshot.featureRoot),
    status(dependencies, snapshot.mainRoot),
  ])
  return { featureDiff, featureHead, featureStatus, mainDiff, mainHead, mainStatus }
}

function localStateMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  return current.featureHead === snapshot.currentFeatureHead
    && current.featureDiff === snapshot.currentFeatureDiff
    && current.featureStatus === snapshot.currentFeatureStatus
    && current.mainHead === snapshot.currentMainHead
    && current.mainDiff === snapshot.currentMainDiff
    && current.mainStatus === snapshot.currentMainStatus
}

function assertLocalStateMatches(snapshot: MergeSnapshot, current: LocalState): void {
  if (!localStateMatches(snapshot, current)) {
    Errors.throwUserInput('Repository state changed while validation was running; refusing to continue the merge.')
  }
}

function assertFeatureMatches(snapshot: MergeSnapshot, current: LocalState): void {
  if (!featureMatches(snapshot, current)) {
    Errors.throwUserInput('The feature worktree changed unexpectedly while the merge command was running.')
  }
}

function assertMainMatches(snapshot: MergeSnapshot, current: LocalState): void {
  if (!mainMatches(snapshot, current)) {
    Errors.throwUserInput('The main worktree changed unexpectedly while the merge command was running.')
  }
}

function featureMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  return current.featureHead === snapshot.currentFeatureHead
    && current.featureDiff === snapshot.currentFeatureDiff
    && current.featureStatus === snapshot.currentFeatureStatus
}

function mainMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  return current.mainHead === snapshot.currentMainHead
    && current.mainDiff === snapshot.currentMainDiff
    && current.mainStatus === snapshot.currentMainStatus
}

function adoptLocalState(snapshot: MergeSnapshot, current: LocalState): void {
  snapshot.currentFeatureHead = current.featureHead
  snapshot.currentFeatureDiff = current.featureDiff
  snapshot.currentFeatureStatus = current.featureStatus
  snapshot.currentMainHead = current.mainHead
  snapshot.currentMainDiff = current.mainDiff
  snapshot.currentMainStatus = current.mainStatus
}

function hasUnstagedOrUntracked(statusOutput: string): boolean {
  return statusOutput.split('\n').filter(Boolean).some(line => line.startsWith('??') || line[1] !== ' ')
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
  const temporaryPath = `${snapshot.snapshotPath}.${randomUUID()}.tmp`
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

/** Run a command after the safety snapshot exists and persist its resulting local state even on failure. */
async function runAndSnapshot(
  snapshot: MergeSnapshot,
  command: string,
  args: readonly string[],
  cwd: string,
  successPhase: MergePhase,
  dependencies: MergeWithMainDependencies,
  options: {
    mutation?: 'feature' | 'main' | 'none'
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
  } else if (mutation === 'feature') {
    assertMainMatches(snapshot, current)
    if (current.featureStatus !== '' || current.featureDiff !== '') {
      Errors.throwUserInput('The feature worktree was not clean after the command-owned Git operation.')
    }
  } else {
    assertFeatureMatches(snapshot, current)
    if (current.mainStatus !== '' || current.mainDiff !== '') {
      Errors.throwUserInput('The main worktree was not clean after the command-owned Git operation.')
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
  mutation: 'feature' | 'main' | 'none',
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readLocalState(snapshot, dependencies)
  const targetIsRecoverable = mutation === 'feature'
    ? mainMatches(snapshot, current)
      && current.featureHead === snapshot.currentFeatureHead
      && recoverableMergeFailureStatus(current.featureStatus)
    : mutation === 'main'
    ? featureMatches(snapshot, current)
      && current.mainHead === snapshot.currentMainHead
      && recoverableMergeFailureStatus(current.mainStatus)
    : false
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

function writeLines(dependencies: MergeWithMainDependencies, lines: readonly string[]): void {
  for (const line of lines) {
    dependencies.writeLine(line)
  }
}
