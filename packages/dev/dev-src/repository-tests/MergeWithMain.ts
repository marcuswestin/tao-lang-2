import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { MachineLanes, MachineResourceBusyError, type MachineResourceLease } from './MachineLanes'

// TODO(merge-with-main-default): Change `execute`'s CLI default from false to true after this command
// has landed several merges safely; retain an explicit `--dry-run` escape hatch when doing so.

const SNAPSHOT_VERSION = 2
const MAX_STABILIZATION_PASSES = 3
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
const MERGE_PHASES: readonly MergePhase[] = [
  'prepared',
  'integration-created',
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

// The lease is a single machine-wide resource: only one worktree may be landing at a time,
// regardless of which repository root asks. A busy machine convoys landings into each other
// (DEVENV-069); serializing them here removes the race the old shared-main-worktree design left
// open, where two concurrent `--execute` runs could stage a squash in the same checkout and only
// notice afterwards.
const LANDING_LEASE_NAME = 'merge-with-main-landing'
const LANDING_LEASE_WAIT_TIMEOUT_MS = 30 * 60 * 1_000
const LANDING_LEASE_POLL_MS = 5_000

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
  /**
   * Fail immediately when the landing lease is held elsewhere instead of waiting for it. The
   * default is to wait: a human running this interactively is better served by the command
   * quietly taking its turn than by having to notice a refusal and retry by hand, and an
   * unattended `--yes --push` run should not spuriously fail just because the machine happened to
   * be mid-landing when it started.
   */
  refuseIfBusy?: boolean
  /** Skip the otherwise mandatory unsandboxed full verification. */
  skipFullVerify?: boolean
  /** Confirm execution non-interactively. This never implies `push`. */
  yes?: boolean
}

/** MergePhase names each durable recovery boundary in the landing workflow. */
export type MergePhase =
  | 'prepared'
  | 'integration-created'
  | 'squashed'
  | 'integration-verified'
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
  currentFeatureDiff: string
  currentFeatureHead: string
  currentFeatureStatus: string
  /** Undefined until the disposable integration worktree exists, and again once it is removed. */
  currentIntegrationDiff?: string
  currentIntegrationHead?: string
  currentIntegrationStatus?: string
  featureHead: string
  featureIndexTree: string
  featureRoot: string
  featureTree: string
  /** Where the disposable integration worktree lives, or last lived, under the feature root. */
  integrationRoot: string
  /** `origin/main`'s tip when this landing was built. Rebuilt in place if the remote moves. */
  mainHead: string
  mainTree: string
  messageFile: string
  phase: MergePhase
  remoteFeatureHead?: string
  snapshotPath: string
  stagedTree?: string
  version: typeof SNAPSHOT_VERSION
}

/** MergePreflight is the immutable repository evidence collected before execution. */
export type MergePreflight = {
  branch: string
  branchHead: string
  featureRoot: string
  /** `origin/main`'s tip, or undefined when the remote could not be confirmed (see `warnings`). */
  mainHead?: string
  message: string
  messageFile: string
  remoteFeatureHead?: string
  remoteFeatureBehind: boolean
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
  /** Claims the machine-wide landing lease, or throws `MachineResourceBusyError` after `waitTimeoutMs`. */
  acquireLease: (repositoryRoot: string, waitTimeoutMs: number) => Promise<MachineResourceLease>
  askConfirm: (message: string) => Promise<boolean>
  exists: (path: string) => Promise<boolean>
  isInteractive: () => boolean
  move: (fromPath: string, toPath: string) => Promise<void>
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  readText: (path: string) => Promise<string>
  remove: (path: string) => Promise<void>
  run: MergeCommandRunner
  sleep: (ms: number) => Promise<void>
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
  acquireLease: async (repositoryRoot, waitTimeoutMs) =>
    await MachineLanes.acquireResource({
      command: 'merge-with-main',
      name: LANDING_LEASE_NAME,
      repositoryRoot,
      waitTimeoutMs,
    }),
  askConfirm: async message => await HCI.askConfirm({ defaultValue: false, message }),
  exists: FS.exists,
  isInteractive: HCI.isInteractive,
  move: FS.move,
  now: () => new Date(),
  readJson: FS.readJson,
  readText: FS.readText,
  remove: FS.remove,
  run: CLI.run,
  sleep: Time.sleep,
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

  const warnings: string[] = []
  // `git fetch` has no network in the agent sandbox. Preflight must say so plainly rather than
  // silently treating whatever this worktree already knew as authoritative, so this failure is
  // caught here instead of surfacing as an opaque command failure deep in a report.
  const fetch = await tryFetchMain(dependencies, featureRoot)
  const mainHead = fetch.mainSha
  if (!fetch.reachable) {
    warnings.push(`Could not reach ${REMOTE} to fetch refs/heads/${MAIN_BRANCH}; treating main as unconfirmed.`)
  }

  // A local `main` branch is not required to exist or be checked out anywhere anymore — the
  // landing builds its own disposable integration worktree from `origin/main`. But if a local
  // `main` ref does exist (most checkouts have one), it must agree with the remote: a person's own
  // stale or diverged main checkout is the one thing this cannot safely paper over, because the
  // force-with-lease push would otherwise silently leave their unpushed commits behind.
  const localMainRef = await dependencies.run('git', {
    args: ['rev-parse', '--verify', '--quiet', `refs/heads/${MAIN_BRANCH}`],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  const localMainHead = localMainRef.exitCode === 0 ? localMainRef.stdout.trim() : undefined
  if (localMainHead !== undefined && mainHead !== undefined && localMainHead !== mainHead) {
    Errors.throwUserInput(
      `Local branch '${MAIN_BRANCH}' (${shortSha(localMainHead)}) is not at ${REMOTE}/${MAIN_BRANCH} `
        + `(${shortSha(mainHead)}); refresh it before merging.`,
    )
  }

  let remoteFeatureHead: string | undefined
  let remoteFeatureBehind = false
  let remoteMergedHead: string | undefined
  if (mainHead !== undefined) {
    const remoteRefs = await remoteHeads(dependencies, featureRoot, [branch, `merged/${branch.slice(5)}`])
    // A remote feature branch left behind by earlier commits is the ordinary case, not an
    // obstacle: execution pushes it forward. Only a remote holding commits this worktree lacks
    // must stop the landing, because the squash would silently drop them.
    remoteFeatureHead = remoteRefs.get(branch)
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
    remoteMergedHead = remoteRefs.get(`merged/${branch.slice(5)}`)
    if (remoteMergedHead !== undefined) {
      Errors.throwUserInput(`Remote archive branch 'merged/${branch.slice(5)}' already exists.`)
    }
  } else {
    warnings.push(`Could not confirm '${branch}' or its archive branch on ${REMOTE} because the remote was unreachable.`)
  }

  const messageFile = FS.resolvePath(options.messageFile ?? `.artifacts/merge/${branch}.msg`, featureRoot)
  if (!await dependencies.exists(messageFile)) {
    Errors.throwUserInput(`Merge message file does not exist: ${messageFile}`)
  }
  const message = validateMergeMessage(await dependencies.readText(messageFile))
  warnings.push(...await fullRunWarnings(dependencies, featureRoot))

  return {
    branch,
    branchHead,
    featureRoot,
    mainHead,
    message,
    messageFile,
    remoteFeatureHead,
    remoteFeatureBehind,
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
      const lease = await acquireLandingLease(options, dependencies)
      try {
        return await abortMerge(options, dependencies)
      } finally {
        await lease.release()
      }
    }

    if (options.execute !== true) {
      // A dry run never mutates anything, so it does not compete for the landing lease; it only
      // reports what an execute run would do, including whether that run would have to wait.
      const preflight = await inspectMergePreflight(options, dependencies)
      const lines = formatDryRun(preflight, options)
      writeLines(dependencies, lines)
      return { lines, mode: 'dry-run' }
    }

    // The lease is held for the whole preflight-to-push window: preflight already inspects state
    // that execution is about to act on, so claiming the lease only after preflight would leave a
    // window where two concurrent runs could both pass preflight before either mutates anything.
    const lease = await acquireLandingLease(options, dependencies)
    try {
      const preflight = await inspectMergePreflight(options, dependencies)
      const { mainHead } = preflight
      if (mainHead === undefined) {
        Errors.throwHostEnvironment(
          `Cannot confirm ${REMOTE}/${MAIN_BRANCH}; merge-with-main requires network access to land safely. `
            + 'Retry once the remote is reachable.',
        )
      }
      await authorizeExecution(options, dependencies, preflight)
      const snapshot = await createSnapshot(preflight, mainHead, dependencies)
      writeLines(dependencies, [
        ...preflight.warnings.map(warning => `WARN  ${warning}`),
        `PASS  Safety snapshot: ${snapshot.snapshotPath}`,
      ])

      await buildAndVerifyIntegration(snapshot, options, dependencies)
      await commitSquash(snapshot, preflight.message, dependencies)
      await pushArchiveAndPreserve(snapshot, dependencies)

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

function formatDryRun(preflight: MergePreflight, options: MergeWithMainOptions): string[] {
  const command = executionCommand(options)
  return [
    `PASS  Feature branch: ${preflight.branch} at ${shortSha(preflight.branchHead)}`,
    `PASS  Feature worktree clean: ${preflight.featureRoot}`,
    preflight.mainHead !== undefined
      ? `PASS  ${REMOTE}/${MAIN_BRANCH} is reachable at ${shortSha(preflight.mainHead)}.`
      : `WARN  Could not reach ${REMOTE} to confirm ${MAIN_BRANCH}; execution requires network access.`,
    `PASS  Merge message: ${preflight.messageFile}`,
    ...preflight.warnings.map(warning => `WARN  ${warning}`),
    'PLAN  Wait for the machine-wide landing lease (or refuse immediately with --refuse-if-busy) before touching any ref.',
    'PLAN  Write a safety snapshot before creating any worktree.',
    ...(preflight.remoteFeatureBehind
      ? [`PLAN  Keep the behind ${REMOTE}/${preflight.branch} unchanged until the verified archive replaces it.`]
      : []),
    'PLAN  Build a disposable integration worktree from main and stage the squash there.',
    options.skipFullVerify === true
      ? 'PLAN  Skip full verification and run just verify --complete on the staged squash instead.'
      : 'PLAN  Run just full-verify on the staged squash in the integration worktree.',
    'PLAN  If main moves before the staged squash is pushed, rebuild the integration tree and verify again.',
    "PLAN  Commit with Git's squash appendix, push main, archive the remote feature branch, detach its clean "
      + 'worktree, delete its local branch, and remove the integration worktree.',
    'PLAN  Preserve the invoking worktree and shell until its owning task is archived.',
    `DRY RUN  No refs or worktrees changed. Execute with: ${command}`,
  ]
}

function executionCommand(options: MergeWithMainOptions): string {
  // The printed command is the one a non-interactive shell can run, so it carries the confirmation
  // flag; `--push` stays the operator's explicit choice and is added only when this run asked for it.
  const parts = ['./dev', 'merge-with-main', '--execute', '--yes']
  if (options.push === true) {
    parts.push('--push')
  }
  if (options.skipFullVerify === true) {
    parts.push('--skip-full-verify')
  }
  if (options.refuseIfBusy === true) {
    parts.push('--refuse-if-busy')
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
 * acquireLandingLease claims the one machine-wide landing lease. Unlike the native host lease,
 * this never offers to stop the session holding it: a native dev server is safe to kill and
 * restart, but interrupting another landing mid-squash or mid-push is not something a takeover
 * should decide on someone's behalf. The only choices are to wait, printing the current holder so
 * a person can decide to stop waiting, or to refuse outright via `--refuse-if-busy`.
 */
async function acquireLandingLease(
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<MachineResourceLease> {
  const repositoryRoot = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
  const deadline = Time.nowMs() + LANDING_LEASE_WAIT_TIMEOUT_MS
  let reportedOwnerId: string | undefined
  while (true) {
    try {
      return await dependencies.acquireLease(repositoryRoot, 0)
    } catch (error) {
      if (!(error instanceof MachineResourceBusyError)) {
        throw error
      }
      const owner = error.owner
      if (options.refuseIfBusy === true) {
        Errors.throwHostEnvironment(
          `The merge-with-main landing lease is held by ${owner.command} in ${owner.repositoryRoot} `
            + `(PID ${owner.pid}), since ${owner.startedAt}. Refusing to wait because --refuse-if-busy was set; `
            + 'retry once that landing finishes.',
          { details: { failureKind: 'native-host-busy', owner } },
        )
      }
      if (reportedOwnerId !== owner.id) {
        // The underlying resource is a single-owner mutex, not a real waiting-line broker, so
        // there is no true multi-waiter queue position to print. What is truthful is who holds it
        // and how long this run has been waiting its turn, which is what gets printed here.
        dependencies.writeLine(
          `WARN  Waiting for the merge-with-main landing lease held by ${owner.command} in ${owner.repositoryRoot} `
            + `(PID ${owner.pid}), since ${owner.startedAt}. This run is next in line; `
            + 'pass --refuse-if-busy to fail instead of waiting.',
        )
        reportedOwnerId = owner.id
      }
      if (Time.nowMs() >= deadline) {
        Errors.throwHostEnvironment(
          `Timed out after ${Math.round(LANDING_LEASE_WAIT_TIMEOUT_MS / 60_000)} minutes waiting for the `
            + `merge-with-main landing lease held by ${owner.command} in ${owner.repositoryRoot} (PID ${owner.pid}).`,
          { details: { failureKind: 'native-host-busy', owner } },
        )
      }
      await dependencies.sleep(LANDING_LEASE_POLL_MS)
    }
  }
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
  mainHead: string,
  dependencies: MergeWithMainDependencies,
): Promise<MergeSnapshot> {
  const createdAt = dependencies.now().toISOString()
  const stamp = `${createdAt.replaceAll(/[:.]/gu, '-')}-${Platform.randomUUID().slice(0, 8)}`
  const snapshotPath = FS.resolvePath(`.artifacts/merge/${stamp}.json`, preflight.featureRoot)
  const integrationRoot = FS.resolvePath(`.artifacts/merge/${stamp}-integration`, preflight.featureRoot)
  const [featureTree, featureIndexTree, mainTree] = await Promise.all([
    git(dependencies, preflight.featureRoot, ['rev-parse', 'HEAD^{tree}']).then(result => result.stdout.trim()),
    git(dependencies, preflight.featureRoot, ['write-tree']).then(result => result.stdout.trim()),
    git(dependencies, preflight.featureRoot, ['rev-parse', `${mainHead}^{tree}`]).then(result => result.stdout.trim()),
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
    integrationRoot,
    mainHead,
    mainTree,
    messageFile: preflight.messageFile,
    phase: 'prepared',
    remoteFeatureHead: preflight.remoteFeatureHead,
    snapshotPath,
    version: SNAPSHOT_VERSION,
  }
  await persistSnapshot(snapshot, dependencies)
  return snapshot
}

/**
 * buildAndVerifyIntegration builds a disposable integration worktree from `origin/main`, stages
 * the squash there, and runs the one verification lane directly against that staged tree. Nothing
 * pre-integrates `origin/main` into the feature branch first: the old design's re-integrate cycle
 * existed only because it verified the branch and then shipped a squash onto a main that could
 * still have moved. Verifying the exact tree that gets committed removes that mismatch, so a
 * restart is needed only if the remote genuinely moves while this pass is running.
 */
async function buildAndVerifyIntegration(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  // Every exit from this phase other than the one that hands off to `commitSquash` must leave no
  // integration worktree behind: a red verification is the ordinary outcome of a landing attempt
  // that does not succeed, not a corner case, and a stranded worktree poisons `git worktree list`
  // and `./agent board` for every worktree on the machine, not just this one. The snapshot itself
  // is the recovery record and must survive; only the disposable worktree is discarded here.
  try {
    for (let pass = 1; pass <= MAX_STABILIZATION_PASSES; pass += 1) {
      await createIntegrationWorktree(snapshot, dependencies)
      await stageSquash(snapshot, dependencies)
      await runVerification(snapshot, options, dependencies)

      const remoteMain = (await remoteHeads(dependencies, snapshot.featureRoot, [MAIN_BRANCH])).get(MAIN_BRANCH)
      if (!remoteMain) {
        Errors.throwHostEnvironment(`Remote '${REMOTE}' stopped reporting refs/heads/${MAIN_BRANCH}.`)
      }
      if (remoteMain === snapshot.mainHead) {
        // Success: the caller (`commitSquash`, then `pushArchiveAndPreserve`) still needs this
        // worktree, so it is deliberately kept alive past this return.
        return
      }
      if (pass === MAX_STABILIZATION_PASSES) {
        await advanceSnapshot(snapshot, 'failed', dependencies)
        Errors.throwHostEnvironment(
          `${REMOTE}/${MAIN_BRANCH} moved during ${MAX_STABILIZATION_PASSES} consecutive verification passes; `
            + 'stop and retry when main is stable.',
        )
      }
      dependencies.writeLine(
        `WARN  ${REMOTE}/${MAIN_BRANCH} moved during verification; rebuilding the integration tree at the new head `
          + `(pass ${pass + 1}/${MAX_STABILIZATION_PASSES}).`,
      )
      // A deliberate rebuild, not a failure: remove and immediately recreate at the new head.
      await removeIntegrationWorktree(snapshot.featureRoot, snapshot.integrationRoot, dependencies)
      adoptLocalState(snapshot, await readLocalState(snapshot, dependencies))
      snapshot.mainHead = await fetchMainOrThrow(dependencies, snapshot.featureRoot)
      snapshot.stagedTree = undefined
      await persistSnapshot(snapshot, dependencies)
    }
  } catch (error) {
    await disposeIntegrationWorktreeAfterFailure(snapshot, dependencies)
    throw error
  }
}

/**
 * disposeIntegrationWorktreeAfterFailure removes the disposable worktree on any exceptional exit
 * from `buildAndVerifyIntegration` — a staging conflict, a red verification lane, a lost remote,
 * or the moved-main retry budget running out. It is a no-op when the worktree was already removed
 * (the moved-main rebuild step removes and recreates it itself, so a later throw in that same pass
 * sees nothing to clean up twice). It resyncs the snapshot's integration-side bookkeeping but does
 * not re-validate the feature worktree: asserting here could mask the error that is already being
 * propagated, and the snapshot remains the recovery record regardless.
 */
async function disposeIntegrationWorktreeAfterFailure(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  if (!await dependencies.exists(snapshot.integrationRoot)) {
    return
  }
  await removeIntegrationWorktree(snapshot.featureRoot, snapshot.integrationRoot, dependencies)
  adoptLocalState(snapshot, await readLocalState(snapshot, dependencies))
  await persistSnapshot(snapshot, dependencies).catch(() => {})
}

async function createIntegrationWorktree(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await assertExpectedLocalState(snapshot, dependencies)
  await runChecked(
    dependencies,
    'git',
    ['worktree', 'add', '--detach', snapshot.integrationRoot, snapshot.mainHead],
    snapshot.featureRoot,
    true,
  )
  const current = await readLocalState(snapshot, dependencies)
  assertFeatureMatches(snapshot, current)
  if (current.integrationHead !== snapshot.mainHead || current.integrationStatus !== '' || current.integrationDiff !== '') {
    Errors.throwUnexpected('The freshly created integration worktree was not clean at the expected main head.')
  }
  adoptLocalState(snapshot, current)
  snapshot.phase = 'integration-created'
  await persistSnapshot(snapshot, dependencies)
}

/**
 * removeIntegrationWorktree is the mechanical removal shared by every disposal site: success (in
 * `pushArchiveAndPreserve`), a deliberate moved-main rebuild, an abort, and a failure caught by
 * `disposeIntegrationWorktreeAfterFailure`.
 */
async function removeIntegrationWorktree(
  featureRoot: string,
  integrationRoot: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const removed = await dependencies.run('git', {
    args: ['worktree', 'remove', '--force', integrationRoot],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  if (removed.exitCode !== 0 || removed.error !== undefined || removed.signal !== null) {
    await dependencies.remove(integrationRoot).catch(() => {})
    await dependencies.run('git', { args: ['worktree', 'prune'], cwd: featureRoot, stdio: 'pipe' }).catch(() => {})
  }
}

async function stageSquash(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  await assertExpectedLocalState(snapshot, dependencies)
  const squashResult = await dependencies.run('git', {
    args: ['merge', '--squash', snapshot.featureHead],
    cwd: snapshot.integrationRoot,
    stdio: 'stream',
  })
  if (squashResult.exitCode !== 0 || squashResult.error !== undefined || squashResult.signal !== null) {
    await captureFailedMutation(snapshot, 'integration', dependencies)
    assertCommandSucceeded(squashResult)
  }
  const afterSquash = await readLocalState(snapshot, dependencies)
  assertFeatureMatches(snapshot, afterSquash)
  if (
    afterSquash.integrationHead !== snapshot.currentIntegrationHead
    || hasUnstagedOrUntracked(afterSquash.integrationStatus ?? '')
  ) {
    Errors.throwUserInput('The integration worktree changed unexpectedly while preparing the staged squash.')
  }
  const stagedTree = (await git(dependencies, snapshot.integrationRoot, ['write-tree'])).stdout.trim()
  snapshot.stagedTree = stagedTree
  adoptLocalState(snapshot, afterSquash)
  snapshot.phase = 'squashed'
  await persistSnapshot(snapshot, dependencies)
}

/**
 * runVerification runs the one verification lane against the staged, uncommitted squash and then
 * proves the tree it just examined is byte-identical to the tree about to be committed. That
 * before/after equality is the same reasoning the old two-worktree design used to avoid verifying
 * twice — Git proves the committed tree is the tree that was verified — collapsed onto a single
 * worktree because there is now only one tree to verify in the first place.
 */
async function runVerification(
  snapshot: MergeSnapshot,
  options: MergeWithMainOptions,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const stagedTreeBeforeVerify = snapshot.stagedTree
  if (stagedTreeBeforeVerify === undefined) {
    Errors.throwUnexpected('runVerification was called before a squash was staged.')
  }
  const verifyArgs = options.skipFullVerify === true ? ['verify', '--complete'] : ['full-verify']
  await runAndSnapshot(
    snapshot,
    'just',
    verifyArgs,
    snapshot.integrationRoot,
    'integration-verified',
    dependencies,
    { stdio: dependencies.isInteractive() ? 'inherit' : 'stream' },
  )
  const stagedTreeAfterVerify = (await git(dependencies, snapshot.integrationRoot, ['write-tree'])).stdout.trim()
  if (stagedTreeAfterVerify !== stagedTreeBeforeVerify) {
    Errors.throwUnexpected('Verification changed the staged squash tree.', {
      details: { stagedTreeAfterVerify, stagedTreeBeforeVerify },
    })
  }
  writeLines(dependencies, [
    `PASS  Verified the integration tree ${shortSha(stagedTreeAfterVerify)}; the staged squash is unchanged and ready to commit.`,
  ])
}

async function commitSquash(
  snapshot: MergeSnapshot,
  message: string,
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const squashMessagePath = FS.resolvePath(
    (await git(
      dependencies,
      snapshot.integrationRoot,
      ['rev-parse', '--git-path', 'SQUASH_MSG'],
    )).stdout.trim(),
    snapshot.integrationRoot,
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
    snapshot.integrationRoot,
    'committed',
    dependencies,
    { mutation: 'integration' },
  )
  const committedTree = (await git(dependencies, snapshot.integrationRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
  if (snapshot.stagedTree === undefined || committedTree !== snapshot.stagedTree) {
    Errors.throwUnexpected('The committed tree does not equal the verified squash tree.', {
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
  const integrationHead = snapshot.currentIntegrationHead
  if (integrationHead === undefined) {
    Errors.throwUnexpected('The integration worktree has no recorded head before push.')
  }
  const pushMain = await dependencies.run('git', {
    args: [
      'push',
      REMOTE,
      `--force-with-lease=refs/heads/${MAIN_BRANCH}:${snapshot.mainHead}`,
      `${integrationHead}:refs/heads/${MAIN_BRANCH}`,
    ],
    cwd: snapshot.integrationRoot,
    stdio: 'stream',
  })
  if (pushMain.exitCode !== 0 || pushMain.error !== undefined || pushMain.signal !== null) {
    const observedMain = (await remoteHeads(dependencies, snapshot.integrationRoot, [MAIN_BRANCH])).get(MAIN_BRANCH)
    if (observedMain === integrationHead) {
      // A transport can report failure after the remote accepted the update. The exact remote ref
      // is stronger evidence than the process result, so recovery must stay on the irreversible side.
      await advanceSnapshot(snapshot, 'pushed', dependencies)
    } else if (observedMain !== undefined && observedMain !== snapshot.mainHead) {
      // The force-with-lease proves this push changed nothing. Restore the reversible phase so the
      // guarded abort may remove only the disposable integration worktree before a fresh preflight.
      snapshot.phase = 'committed'
      await persistSnapshot(snapshot, dependencies)
      Errors.throwHostEnvironment(
        `${REMOTE}/${MAIN_BRANCH} moved to ${shortSha(observedMain)} before the verified squash could be pushed. `
          + `The remote was not changed; abort this snapshot with ./dev merge-with-main --abort ${snapshot.snapshotPath} --yes, `
          + 'then retry the landing so it rebuilds against the new main.',
      )
    } else {
      assertCommandSucceeded(pushMain)
    }
  } else {
    await advanceSnapshot(snapshot, 'pushed', dependencies)
  }

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

  // The disposable worktree has done its job once main is pushed; remove it before touching the
  // invoking worktree so a later failure never leaves two worktrees to explain.
  await removeIntegrationWorktree(snapshot.featureRoot, snapshot.integrationRoot, dependencies)
  const afterRemoval = await readLocalState(snapshot, dependencies)
  assertFeatureMatches(snapshot, afterRemoval)
  adoptLocalState(snapshot, afterRemoval)
  await persistSnapshot(snapshot, dependencies)

  // Keep the invoking directory usable after success. Detaching at the verified feature tip leaves
  // its tree unchanged; the feature worktree was never otherwise touched by this landing.
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
  // The snapshot lives in the feature worktree's ignored artifacts, so it survives the branch delete.
  snapshot.currentFeatureHead = (await git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  snapshot.currentFeatureStatus = await status(dependencies, snapshot.featureRoot)
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
  // The feature worktree is never mutated before push, so there is nothing to reset there; the
  // only command-owned state to discard is the disposable integration worktree, when it exists.
  if (await dependencies.exists(snapshot.integrationRoot)) {
    await removeIntegrationWorktree(snapshot.featureRoot, snapshot.integrationRoot, dependencies)
  }
  snapshot.phase = 'aborted'
  adoptLocalState(snapshot, await readLocalState(snapshot, dependencies))
  await persistSnapshot(snapshot, dependencies)
  const lines = [
    `PASS  Removed the disposable integration worktree and left '${snapshot.branch}' at its untouched pre-merge state.`,
  ]
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
  if (snapshot.stagedTree !== undefined && await dependencies.exists(snapshot.integrationRoot)) {
    const stagedTree = (await git(dependencies, snapshot.integrationRoot, ['write-tree'])).stdout.trim()
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
    || typeof value.featureHead !== 'string'
    || typeof value.featureIndexTree !== 'string'
    || typeof value.featureRoot !== 'string'
    || typeof value.featureTree !== 'string'
    || typeof value.integrationRoot !== 'string'
    || typeof value.mainHead !== 'string'
    || typeof value.mainTree !== 'string'
    || typeof value.messageFile !== 'string'
    || !isMergePhase(value.phase)
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
  integrationDiff?: string
  integrationHead?: string
  integrationStatus?: string
}

/** readLocalState includes the integration worktree only while it actually exists on disk. */
async function readLocalState(
  snapshot: MergeSnapshot,
  dependencies: MergeWithMainDependencies,
): Promise<LocalState> {
  const includeIntegration = await dependencies.exists(snapshot.integrationRoot)
  if (!includeIntegration) {
    const [featureHead, featureDiff, featureStatus] = await Promise.all([
      git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
      diff(dependencies, snapshot.featureRoot),
      status(dependencies, snapshot.featureRoot),
    ])
    return { featureDiff, featureHead, featureStatus }
  }
  const [featureHead, integrationHead, featureDiff, integrationDiff, featureStatus, integrationStatus] = await Promise
    .all([
      git(dependencies, snapshot.featureRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
      git(dependencies, snapshot.integrationRoot, ['rev-parse', 'HEAD']).then(result => result.stdout.trim()),
      diff(dependencies, snapshot.featureRoot),
      diff(dependencies, snapshot.integrationRoot),
      status(dependencies, snapshot.featureRoot),
      status(dependencies, snapshot.integrationRoot),
    ])
  return { featureDiff, featureHead, featureStatus, integrationDiff, integrationHead, integrationStatus }
}

function localStateMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  const featureMatches_ = current.featureHead === snapshot.currentFeatureHead
    && current.featureDiff === snapshot.currentFeatureDiff
    && current.featureStatus === snapshot.currentFeatureStatus
  if (current.integrationHead === undefined) {
    return featureMatches_ && snapshot.currentIntegrationHead === undefined
  }
  return featureMatches_
    && current.integrationHead === snapshot.currentIntegrationHead
    && current.integrationDiff === snapshot.currentIntegrationDiff
    && current.integrationStatus === snapshot.currentIntegrationStatus
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

function featureMatches(snapshot: MergeSnapshot, current: LocalState): boolean {
  return current.featureHead === snapshot.currentFeatureHead
    && current.featureDiff === snapshot.currentFeatureDiff
    && current.featureStatus === snapshot.currentFeatureStatus
}

function adoptLocalState(snapshot: MergeSnapshot, current: LocalState): void {
  snapshot.currentFeatureHead = current.featureHead
  snapshot.currentFeatureDiff = current.featureDiff
  snapshot.currentFeatureStatus = current.featureStatus
  snapshot.currentIntegrationHead = current.integrationHead
  snapshot.currentIntegrationDiff = current.integrationDiff
  snapshot.currentIntegrationStatus = current.integrationStatus
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

/** tryFetchMain fetches `origin/main` without throwing, so preflight can degrade honestly offline. */
async function tryFetchMain(
  dependencies: MergeWithMainDependencies,
  featureRoot: string,
): Promise<{ mainSha?: string; reachable: boolean }> {
  const fetched = await dependencies.run('git', {
    args: ['fetch', '--prune', REMOTE, MAIN_BRANCH],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  if (fetched.exitCode !== 0 || fetched.error !== undefined || fetched.signal !== null) {
    return { reachable: false }
  }
  const rev = await dependencies.run('git', {
    args: ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`],
    cwd: featureRoot,
    stdio: 'pipe',
  })
  if (rev.exitCode !== 0 || rev.error !== undefined || rev.signal !== null) {
    return { reachable: false }
  }
  return { mainSha: rev.stdout.trim(), reachable: true }
}

/** fetchMainOrThrow is used once execution already depends on network access, so a failure here is honest. */
async function fetchMainOrThrow(dependencies: MergeWithMainDependencies, featureRoot: string): Promise<string> {
  await runChecked(dependencies, 'git', ['fetch', '--prune', REMOTE, MAIN_BRANCH], featureRoot, true)
  return (await git(dependencies, featureRoot, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`])).stdout.trim()
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
    mutation?: 'integration' | 'none'
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
    assertFeatureMatches(snapshot, current)
    if (current.integrationStatus !== '' || current.integrationDiff !== '') {
      Errors.throwUserInput('The integration worktree was not clean after the command-owned Git operation.')
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
  mutation: 'integration' | 'none',
  dependencies: MergeWithMainDependencies,
): Promise<void> {
  const current = await readLocalState(snapshot, dependencies)
  const targetIsRecoverable = mutation === 'integration'
    && featureMatches(snapshot, current)
    && current.integrationHead === snapshot.currentIntegrationHead
    && recoverableMergeFailureStatus(current.integrationStatus ?? '')
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
