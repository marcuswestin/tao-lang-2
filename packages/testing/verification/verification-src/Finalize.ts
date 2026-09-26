import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { GeneratedEvidence } from './GeneratedEvidence'
import { type FindOptions, GreenTree, type GreenTreeKey, type GreenTreeMatch } from './GreenTree'
import { MergeWithMainCommand, validateMergeMessage } from './MergeWithMain'
import { VerificationLanes } from './VerificationLanes'

/*
 * "Finalize and prepare the merge" used to exist only as prose in AGENTS.md and the
 * verification-lanes skill, so an agent replayed the whole sequence from scratch on every re-entry
 * — and a branch re-enters finalization often, driven by the Developer's corrections, a red lane, or an
 * agent's own re-entry after a background job reports. `finalize` makes the sequence a command and
 * records enough evidence to make a re-entry cheap.
 *
 * Only one step here trusts recorded state, and it no longer trusts it with anything destructive:
 * the merge message is written only when none exists, or when `--redraft` explicitly asks for a new
 * one. Recorded state now decides one thing — whether a kept message is *proved* to cover the HEAD
 * finalize is looking at, or whether the report has to ask the author to confirm it. Main
 * integration and verification never trust it. A generated `DRAFT:` message additionally needs a
 * byte-changing author edit; recorded finalize state alone can never turn the draft into review.
 * Integration re-asks Git whether main is already an
 * ancestor (a single cheap command), and verification is gated entirely by `GreenTree`, whose
 * records are keyed by tree content, not by anything this file writes. A missing, unreadable,
 * malformed, or older-version state file therefore degrades to keeping the message and saying it
 * could not be proved current — never to a replaced message, a skipped integration, or a skipped
 * proof.
 */

/** Bumped because `verifiedToolchain` is a new required field; an older-version file therefore
 * degrades to keeping an existing merge message unproved rather than being read as if the field
 * were absent. */
const STATE_VERSION = 2
const REMOTE = 'origin'
const MAIN_BRANCH = 'main'
const VERIFY_LANE = VerificationLanes.VERIFY
/**
 * A green `verify` record is also proved by any lane whose gate membership is its superset. The
 * names come from `VerificationLanes` rather than being spelled here: this line previously read
 * `full-verify-sandbox` and `full-verify`, which are not lanes, so two of its three entries matched
 * no record and every branch last proved by `verify-full` was verified a second time for nothing.
 */
const VERIFY_ACCEPTED_LANES: readonly string[] = VerificationLanes.VERIFY_OR_WIDER
/** The ignored outputs every accepted verify lane generates before its readers run. */
const VERIFY_GENERATED_OUTPUTS = GeneratedEvidence.outputsForGates([
  '_parser-gen',
  '_compile-word-flower-app',
  '_ide-extension-build',
])
const MAX_SUMMARY_LENGTH = 72
const DRAFT_PREFIX = 'DRAFT: '
const DRAFT_REVIEW_VERSION = 1
/** ROADMAP_LEDGER_PATH is the durable developer-environment ledger this brief is itself filed against. */
const ROADMAP_LEDGER_PATH = 'Docs/Roadmap/Developer environment upgrades.md'

/**
 * A changed path under one of these prefixes plausibly needs a person's own look before landing,
 * because no sandboxed gate exercises it: Studio or app visible behavior, the language surface, or
 * a native or device path. `FULL_VERIFY_SKIPPED` in the Justfile and `./dev studio-manual-checks`
 * are the only things that ever prove these by hand.
 */
const HUMAN_VERIFICATION_PREFIXES: readonly string[] = [
  'Apps/',
  'packages/ides/studio/',
  'packages/ides/studio-tooling/',
  'packages/providers/icloud/',
  'packages/ides/studio-companion-app/',
  'packages/apps/expo-host/',
  'packages/language/parser/',
  'packages/language/validator/',
  'packages/compiler/',
  'packages/language/formatter/',
  'packages/language/source-actions/',
  'packages/apps/runtime/',
  'packages/language/ast-utils/',
  'packages/apps/stdlib/',
  'Docs/Spec/',
]

/** FinalizeOptions is the flags-ready input accepted by the development CLI command. */
export type FinalizeOptions = {
  /** Report without mutating anything: no merge, no verification lane, no file written. */
  check?: boolean
  /**
   * Ignore the recorded finalize state, mirroring `verify --fresh`. It never replaces an existing
   * merge message: without the record, finalize keeps the message and reports that nothing proves
   * which HEAD it was written for. `--redraft` is the only thing that replaces a message.
   */
  fresh?: boolean
  /** Override `.artifacts/merge/<branch>.msg`, principally for tests. */
  messageFile?: string
  /** Explicitly ask for a fresh mechanical draft, replacing any merge message already on disk. */
  redraft?: boolean
  /** Override the current repository root, principally for tests. */
  repositoryRoot?: string
}

/** FinalizeResult reports whether anything remains for the agent to do, and the lines it printed. */
export type FinalizeResult = {
  lines: string[]
  ok: boolean
}

/** FinalizeCommandRunner is the injectable process seam used to prove this command without a real Git remote. */
export type FinalizeCommandRunner = (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>

/** FinalizeDependencies isolates process, filesystem, verification, and clock effects for testing. */
export type FinalizeDependencies = {
  /** Whether this process may write an existing file, found by opening it without changing it. */
  canWriteFile: (path: string) => Promise<boolean>
  exists: (path: string) => Promise<boolean>
  findGreenTree: (
    repositoryRoot: string,
    wanted: GreenTreeKey,
    acceptedLanes: readonly string[],
    options?: FindOptions,
  ) => Promise<GreenTreeMatch | undefined>
  /** The tree-plus-toolchain identity a record must match; see `GreenTree.key`. */
  key: (repositoryRoot: string) => Promise<GreenTreeKey>
  isSymbolicLink: (path: string) => Promise<boolean>
  makeProbeDirectory: (prefix: string) => Promise<string>
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  realPath: (path: string) => Promise<string>
  readText: (path: string) => Promise<string>
  removeFile: (path: string) => Promise<void>
  run: FinalizeCommandRunner
  writeJson: (path: string, value: unknown) => Promise<void>
  writeLine: (line: string) => void
  writeText: (path: string, value: string) => Promise<void>
}

const defaultDependencies: FinalizeDependencies = {
  canWriteFile: async path => {
    try {
      // Append mode writes nothing on open, so an existing file's bytes and times are untouched.
      await (await FS.openAppend(path)).close()
      return true
    } catch {
      return false
    }
  },
  exists: FS.exists,
  findGreenTree: GreenTree.find,
  isSymbolicLink: FS.isSymbolicLink,
  key: GreenTree.key,
  makeProbeDirectory: FS.mkTmpDir,
  now: () => new Date(),
  readJson: FS.readJson,
  realPath: FS.realPath,
  readText: FS.readText,
  removeFile: FS.remove,
  run: CLI.run,
  writeJson: FS.writeJson,
  writeLine: HCI.writeLine,
  writeText: FS.writeText,
}

/**
 * FinalizeState is evidence about specific inputs, never a "done" flag. A re-entry recomputes the
 * current inputs (the branch's HEAD, the tree hash, main's sha) and reports the merge message as
 * current only when its recorded input is byte-identical to the current one. Nothing here authorizes
 * overwriting a file.
 */
export type FinalizeState = {
  headSha: string
  mainIntegratedSha: string
  /** The HEAD the merge message on disk is known to cover. A generated draft additionally needs an
   * author edit recorded by `DraftReviewState`; this field alone never marks it reviewed. */
  messageHeadSha: string
  updatedAt: string
  verifiedAt: string
  verifiedLane: string
  /** Resolved `.devenv/profile` toolchain the recorded verification proved this tree under; see `GreenTree`. */
  verifiedToolchain: string
  verifiedTreeHash: string
  version: typeof STATE_VERSION
}

type MainIntegration = {
  headSha: string
  integratedNow: boolean
  mainSha: string
}

/** The commands that integrate main, which word a failure's next step differently. */
type IntegratingCommand = 'finalize' | 'merge-main'

/** The one recovery for a merge the sandbox would half-write, named wherever that failure is reported. */
const UNSANDBOXED_MERGE =
  'run `./agent unsandboxed merge-main`, which makes this merge on the host, where those paths are writable'

type VerificationOutcome = {
  at: string
  lane: string
  toolchain: string
  treeHash: string
}

/** Which of the three things finalize did to `.artifacts/merge/<branch>.msg` on this run. */
type MessageDecision = 'drafted' | 'kept' | 'redrafted'

type MessageOutcome = {
  decision: MessageDecision
  /**
   * Why the landing will reject a kept message outright — empty when it will accept it. A drafted
   * or redrafted message is validated as it is written, so only a hand-edited one can be malformed,
   * and finding out at the landing means a round trip through preflight for a summary one character
   * too long.
   */
  malformed: string
  messageHeadSha: string
  /**
   * Why a kept message is not proved to cover this HEAD — empty when it is proved, or when the
   * message was drafted or redrafted. Only the author can settle this, so it becomes remaining work
   * rather than being resolved here.
   */
  unconfirmedReason: string
}

/** Only message review is recorded here; it is never verification or landing evidence. */
type DraftReviewState = {
  draftText: string
  headSha: string
  version: typeof DRAFT_REVIEW_VERSION
}

type DraftCommit = {
  body: string
  subject: string
}

/** FinalizeCommand is the CLI wiring surface consumed by `dev.ts`. */
export const FinalizeCommand = {
  async run(
    options: FinalizeOptions = {},
    dependencies: FinalizeDependencies = defaultDependencies,
  ): Promise<FinalizeResult> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const check = options.check === true
    const lines: string[] = []
    const remaining: string[] = []

    const branch = await assertOnFeatureBranch(dependencies, root, 'finalize')
    await assertCleanWorktree(dependencies, root, 'finalize')

    const integration = await integrateMain(dependencies, root, check, lines, 'finalize')
    const verification = await verifyTree(dependencies, root, check, lines)

    const statePath = FS.resolvePath(`.artifacts/merge/${branch}.state.json`, root)
    const priorState = options.fresh === true ? undefined : await loadState(dependencies, statePath)

    const messageFile = FS.resolvePath(options.messageFile ?? `.artifacts/merge/${branch}.msg`, root)
    const reviewPath = `${messageFile}.review.json`
    const message = await draftOrKeepMessage(
      dependencies,
      root,
      messageFile,
      priorState,
      undefined,
      integration.mainSha,
      integration.headSha,
      check,
      options.redraft === true,
      lines,
    )
    if (!check && message.decision !== 'kept') {
      await recordDraftReview(dependencies, reviewPath, messageFile, integration.headSha)
    }
    remaining.push(...messageRemaining(message, messageFile))

    // Advisory judgments never gate finalize's own exit code — the brief is explicit that this list
    // is advisory, not a gate. They are printed in their own section so a person can weigh them
    // without them silently turning a fully-done run non-zero.
    const advisories = await adviseOnDiff(dependencies, root, integration.mainSha, integration.headSha, branch, lines)

    if (!check) {
      const state: FinalizeState = {
        headSha: integration.headSha,
        mainIntegratedSha: integration.mainSha,
        messageHeadSha: message.messageHeadSha,
        updatedAt: dependencies.now().toISOString(),
        verifiedAt: verification.at,
        verifiedLane: verification.lane,
        verifiedToolchain: verification.toolchain,
        verifiedTreeHash: verification.treeHash,
        version: STATE_VERSION,
      }
      await dependencies.writeJson(statePath, state)
    }

    const ok = remaining.length === 0
    lines.push(...summaryLines(branch, integration, verification, message, remaining, advisories))
    writeLines(dependencies, lines)
    return { lines, ok }
  },
} as const

/** LandOptions is what `./dev land` accepts; every flag only removes work. */
export type LandOptions = {
  /** Report the readiness of this branch and the plan, and change nothing. */
  dryRun?: boolean
  /** Must resolve exactly to this branch's canonical `.artifacts/merge/<branch>.msg`. */
  messageFile?: string
  /** Override the current repository root, principally for tests. */
  repositoryRoot?: string
  /** Replace an existing merge message with a fresh mechanical draft before landing. */
  redraft?: boolean
  /** Skip the otherwise mandatory unsandboxed full verification; see `merge-with-main`. */
  skipVerifyFull?: boolean
  /** Skip the staged-squash `just verify --complete` pass; see `merge-with-main`. */
  skipVerify?: boolean
}

/** LandResult reports what the landing did and the lines it printed. */
export type LandResult = {
  lines: string[]
  mode: 'dry-run' | 'executed'
}

/**
 * LandCommand is the whole landing, as one command and one process.
 *
 * It exists because the sequence it replaces was not slow, it was *interrupted*. Across twenty
 * landings the merge itself took 2-94s from the locked snapshot to the moved ref, while the lock sat
 * held for 36-44 minutes against 5-15 minutes of lane time, over four to nine separately-invoked
 * locked runs. Every gap between those runs was a model turn, a refusal, or a re-verification —
 * agent latency spent inside a machine-wide lock. Collapsing the chain into one process removes the
 * gaps without making any single step faster, and the phase telemetry on the lock is what makes the
 * difference visible rather than asserted.
 *
 * The split is the design: readiness and the merge message are settled **before** the lock, because
 * they are the parts that need judgment and might need an author; integration, the barrier,
 * verification, the squash, the push, and the cleanup happen **after** it, in one `try`/`finally`,
 * because they are the parts that need the machine and must not be interleaved with another
 * landing's.
 */
export const LandCommand = {
  async run(
    options: LandOptions = {},
    dependencies: FinalizeDependencies = defaultDependencies,
  ): Promise<LandResult> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    if (options.skipVerify === true && options.skipVerifyFull === true) {
      Errors.throwUserInput(
        '`land` cannot combine --skip-verify-full with --skip-verify because that would land '
          + 'unverified bytes without confirmation. Use the lower-level `merge-with-main --skip-all` '
          + 'workflow when a person has explicitly chosen and confirmed that exception.',
      )
    }
    const branch = await assertOnFeatureBranch(dependencies, root, 'land')
    const messageFile = await assertCanonicalLandingMessageFile(
      dependencies,
      root,
      branch,
      options.messageFile,
    )
    const preparation = await prepareForLanding(
      {
        messageFile,
        redraft: options.redraft === true,
        repositoryRoot: root,
      },
      dependencies,
    )
    if (!preparation.ok) {
      Errors.throwUserInput(
        `'${preparation.branch}' is not ready to land, and the landing lock was not taken:\n`
          + preparation.remaining.map(item => `- ${item}`).join('\n'),
      )
    }

    const merge = await MergeWithMainCommand.run({
      dryRun: options.dryRun === true,
      messageFile,
      repositoryRoot: root,
      skipVerify: options.skipVerify === true,
      skipVerifyFull: options.skipVerifyFull === true,
    })
    return { lines: [...preparation.lines, ...merge.lines], mode: merge.mode === 'dry-run' ? 'dry-run' : 'executed' }
  },
} as const

/**
 * MergeMainCommand integrates current main into this feature branch and does nothing else: no lane,
 * no merge message. Most of main's commits write paths a harness write-protects against shell
 * commands (`agents/skills`, `.claude/settings.json`), so inside a sandbox this refuses before
 * starting, exactly as `finalize` does. Run as `./agent unsandboxed merge-main`, the same integration
 * completes on the host, which is the one sanctioned way for an agent to bring such a main in
 * without landing. Dirty work needs explicit --stash; --keep-stashed saves a mixed checkout for
 * selective restoration instead of replaying those partial integration bytes after the merge.
 */
type MergeMainOptions = Pick<FinalizeOptions, 'repositoryRoot'> & {
  /** Save dirty tracked and untracked work, then restore it after a successful merge. */
  stash?: boolean
  /** Leave the backup saved for selective recovery of an interrupted checkout. */
  keepStashed?: boolean
}

export const MergeMainCommand = {
  async run(
    options: MergeMainOptions = {},
    dependencies: FinalizeDependencies = defaultDependencies,
  ): Promise<{ lines: string[]; mergedNow: boolean }> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    const lines: string[] = []
    await assertOnFeatureBranch(dependencies, root, 'merge-main')
    if (options.keepStashed === true && options.stash !== true) {
      Errors.throwUserInput('--keep-stashed requires --stash.')
    }
    let stash: string | undefined
    if (options.stash === true) {
      await assertNoMergeInProgress(dependencies, root)
      const status = await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])
      if (status.stdout !== '') {
        stash = await saveMergeWork(dependencies, root, 'dirty work')
      }
    }
    await assertCleanWorktree(dependencies, root, 'merge-main')
    const integration = await integrateMain(dependencies, root, false, lines, 'merge-main')
    if (stash !== undefined && options.keepStashed !== true) {
      const restored = await dependencies.run('git', {
        args: ['stash', 'apply', '--index', stash],
        cwd: root,
        stdio: 'pipe',
      })
      if (restored.exitCode !== 0 || restored.error !== undefined || restored.signal !== null) {
        Errors.throwUserInput(
          `Main merged, but restoring saved work needs attention. Backup ${stash} is retained.\n${restored.stderr}`,
        )
      }
      lines.push(`PASS  Restored tracked and untracked work; backup stash ${stash} is retained.`)
    }
    if (stash !== undefined && options.keepStashed === true) {
      lines.push(
        `NOTE  Saved work has not been restored. Backup stash ${stash} is retained for selective restoration; `
          + 'do not apply an interrupted-checkout backup wholesale.',
      )
    }
    writeLines(dependencies, lines)
    return { lines, mergedNow: integration.integratedNow }
  },
} as const

async function assertNoMergeInProgress(dependencies: FinalizeDependencies, root: string): Promise<void> {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const path = (await git(dependencies, root, ['rev-parse', '--git-path', marker])).stdout.trim()
    if (await dependencies.exists(FS.resolvePath(path, root))) {
      Errors.throwUserInput(`merge-main refuses while ${marker} exists; finish the existing operation first.`)
    }
  }
}

/** Never pop: even a failed cleanup or restoration must leave the backup reachable. */
async function saveMergeWork(dependencies: FinalizeDependencies, root: string, purpose: string): Promise<string> {
  const label = `merge-main ${purpose} ${dependencies.now().toISOString()} ${root}`
  const saved = await dependencies.run('git', {
    args: ['stash', 'push', '--include-untracked', '--message', label],
    cwd: root,
    stdio: 'pipe',
  })
  // Stash creation can succeed before checkout cleanup fails. Report the reachable backup before
  // checking the exit code, and never attempt another checkout automatically after that failure.
  const reference = await dependencies.run('git', {
    args: ['rev-parse', '--verify', 'refs/stash'],
    cwd: root,
    stdio: 'pipe',
  })
  if (reference.exitCode !== 0) {
    assertCommandSucceeded(saved)
    Errors.throwHostEnvironment('Saving merge work produced no reachable stash; the merge was not started.')
  }
  const sha = reference.stdout.trim()
  const subject = (await git(dependencies, root, ['show', '-s', '--format=%s', sha])).stdout.trim()
  if (!subject.endsWith(`: ${label}`)) {
    Errors.throwHostEnvironment(
      'The shared stash changed concurrently. The merge was not started; '
        + `inspect git stash list for this backup label: ${label}`,
    )
  }
  dependencies.writeLine(`NOTE  Retained ${purpose} backup: ${sha}. It will never be dropped automatically.`)
  assertCommandSucceeded(saved)
  return sha
}

/** Start a new feature branch at freshly fetched origin/main after proving checkout writes safe. */
export const StartBranchCommand = {
  async run(
    name: string,
    options: Pick<FinalizeOptions, 'repositoryRoot'> = {},
    dependencies: FinalizeDependencies = defaultDependencies,
  ): Promise<void> {
    const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
    if (!name.startsWith('feat/') || name === 'feat/') {
      Errors.throwUserInput(`start-branch requires a feat/* branch name; got '${name}'.`)
    }
    const validName = await dependencies.run('git', {
      args: ['check-ref-format', '--branch', name],
      cwd: root,
      stdio: 'pipe',
    })
    if (validName.exitCode !== 0) {
      Errors.throwUserInput(`Invalid feature branch name: ${name}.`)
    }
    await assertCleanWorktree(dependencies, root, 'start-branch')
    const existing = await dependencies.run('git', {
      args: ['show-ref', '--verify', '--quiet', `refs/heads/${name}`],
      cwd: root,
      stdio: 'pipe',
    })
    if (existing.exitCode === 0) {
      Errors.throwUserInput(`Feature branch '${name}' already exists.`)
    }
    if (existing.exitCode !== 1) {
      assertCommandSucceeded(existing)
    }
    await git(dependencies, root, ['fetch', '--quiet', REMOTE, MAIN_BRANCH])
    const mainSha = (await git(dependencies, root, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`])).stdout.trim()
    const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
    const diff = await git(dependencies, root, ['diff', '--name-only', '--no-renames', '-z', headSha, mainSha])
    const blocked = await unwritablePaths(dependencies, root, diff.stdout.split('\0').filter(Boolean))
    if (blocked.length > 0) {
      Errors.throwHostEnvironment(
        `Starting '${name}' from origin/main would write paths this shell may not:\n`
          + blocked.map(path => `- ${path}`).join('\n')
          + `\nThe checkout and HEAD are untouched; run \`./agent unsandboxed start-branch ${name}\`.`,
      )
    }
    await git(dependencies, root, ['switch', '--no-track', '-c', name, mainSha])
    const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
    if (status !== '') {
      Errors.throwHostEnvironment(
        `Git switched to '${name}' but left a dirty checkout. Inspect these paths before continuing:\n${status.trimEnd()}`,
      )
    }
    dependencies.writeLine(`Started '${name}' from origin/main (${shortSha(mainSha)}).`)
  },
} as const

/**
 * The agent landing runs with host access, so its unlocked message preparation is restricted to the
 * one repository-owned artifact for this branch. The lower-level merge command keeps its explicit
 * override for a person, while this path rejects both lexical escapes and symlink components before
 * any message bytes are read or written.
 */
async function assertCanonicalLandingMessageFile(
  dependencies: FinalizeDependencies,
  root: string,
  branch: string,
  configuredPath: string | undefined,
): Promise<string> {
  const expected = FS.resolvePath(`.artifacts/merge/${branch}.msg`, root)
  const requested = FS.resolvePath(configuredPath ?? expected, root)
  if (requested !== expected) {
    Errors.throwUserInput(
      `\`land\` only accepts its canonical merge message: ${FS.displayPath(expected)}. `
        + 'Use the lower-level human workflow for an explicit alternate message file.',
    )
  }

  const physicalRoot = await dependencies.realPath(root)
  if (!FS.pathIsWithin(FS.resolvePath(FS.relativePath(root, requested), physicalRoot), physicalRoot)) {
    Errors.throwUserInput('The canonical landing merge message resolves outside the repository.')
  }
  let component = root
  for (const name of FS.relativePath(root, requested).split('/').filter(Boolean)) {
    component = FS.resolvePath(name, component)
    if (await dependencies.isSymbolicLink(component)) {
      Errors.throwUserInput(
        `The canonical landing merge message crosses a symbolic link: ${FS.displayPath(component)}.`,
      )
    }
    if (await dependencies.exists(component)) {
      const physicalComponent = await dependencies.realPath(component)
      if (!FS.pathIsWithin(physicalComponent, physicalRoot)) {
        Errors.throwUserInput(
          `The canonical landing merge message resolves outside the repository: ${FS.displayPath(component)}.`,
        )
      }
    }
  }
  return requested
}

/** LandingPreparation is everything settled before the lock is taken. */
export type LandingPreparation = {
  branch: string
  lines: string[]
  /** True when nothing is left for the author to do, which is the condition for taking the lock. */
  ok: boolean
  remaining: string[]
}

/**
 * The unlocked half of a landing: prove this is a clean feature branch, settle the merge message,
 * and say what a person still has to weigh. It deliberately does **not** integrate main and does
 * **not** verify. Both used to happen here, and both were wasted the moment main moved between this
 * command and the next: integration now happens inside the lock, and the cheap-gate barrier there is
 * what fails a bad tree fast. What is left is exactly the work that could need an author, which is
 * the work that must not happen while the machine is held.
 */
export async function prepareForLanding(
  options: Pick<FinalizeOptions, 'fresh' | 'messageFile' | 'redraft' | 'repositoryRoot'> = {},
  dependencies: FinalizeDependencies = defaultDependencies,
): Promise<LandingPreparation> {
  const root = FS.resolvePath(options.repositoryRoot ?? Repo.getRoot())
  const lines: string[] = []
  const remaining: string[] = []

  const branch = await assertOnFeatureBranch(dependencies, root, 'land')
  await assertCleanWorktree(dependencies, root, 'land')

  const mainSha = await readMainSha(dependencies, root, lines)
  const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()

  const statePath = FS.resolvePath(`.artifacts/merge/${branch}.state.json`, root)
  const priorState = options.fresh === true ? undefined : await loadState(dependencies, statePath)
  const messageFile = FS.resolvePath(options.messageFile ?? `.artifacts/merge/${branch}.msg`, root)
  const reviewPath = `${messageFile}.review.json`
  const draftReview = await loadDraftReview(dependencies, reviewPath)
  const reviewedDraftHeadSha = draftReview?.headSha === headSha
      && await dependencies.exists(messageFile)
      && await dependencies.readText(messageFile) !== draftReview.draftText
    ? headSha
    : undefined
  const message = await draftOrKeepMessage(
    dependencies,
    root,
    messageFile,
    priorState,
    reviewedDraftHeadSha,
    mainSha,
    headSha,
    false,
    options.redraft === true,
    lines,
  )
  // A kept message for an older HEAD needs a fresh author edit too. Record its current bytes as
  // the baseline, so that edit can be confirmed on the next land attempt without `finalize`.
  if (
    message.decision !== 'kept'
    || (message.unconfirmedReason !== '' && draftReview?.headSha !== headSha)
    || (message.malformed !== '' && draftReview?.headSha !== headSha)
  ) {
    await dependencies.writeJson(
      reviewPath,
      {
        draftText: await dependencies.readText(messageFile),
        headSha,
        version: DRAFT_REVIEW_VERSION,
      } satisfies DraftReviewState,
    )
  }
  remaining.push(...messageRemaining(message, messageFile))
  const advisories = await adviseOnDiff(dependencies, root, mainSha, headSha, branch, lines)
  for (const advisory of advisories) {
    lines.push(`NOTE  Advisory (not a gate): ${advisory}`)
  }
  return { branch, lines, ok: remaining.length === 0, remaining }
}

function summaryLines(
  branch: string,
  integration: MainIntegration,
  verification: VerificationOutcome,
  message: MessageOutcome,
  remaining: readonly string[],
  advisories: readonly string[],
): string[] {
  return [
    `1. Branch: ${branch}${integration.integratedNow ? ' — merged main just now' : ' — already contains main'}`,
    `2. Verification: ${
      verification.lane === ''
        ? 'no record covers this tree yet'
        : `stood on ${verification.lane} at ${verification.at}`
    }`,
    `3. Merge message: ${messageSummary(message)}`,
    remaining.length === 0
      ? '4. Remaining: none'
      : `4. Remaining:\n${remaining.map(item => `   - ${item}`).join('\n')}`,
    // Advisory only: never affects `ok`. A person weighs these before landing; finalize itself does
    // not treat them as unfinished work.
    advisories.length === 0
      ? '5. Advisory (not a gate): none'
      : `5. Advisory (not a gate):\n${advisories.map(item => `   - ${item}`).join('\n')}`,
  ]
}

/**
 * The summary always names which of the three things happened — kept, drafted, or redrafted — so no
 * run can leave a reader guessing whether a file they wrote is still the file that will land.
 */
function messageSummary(message: MessageOutcome): string {
  if (message.decision === 'drafted') {
    return 'drafted — needs review'
  }
  if (message.decision === 'redrafted') {
    return 'redrafted on request, replacing what was there — needs review'
  }
  if (message.malformed !== '') {
    return `kept — the landing will reject it: ${message.malformed}`
  }
  return message.unconfirmedReason === ''
    ? 'kept — recorded as written for this HEAD'
    : `kept — ${message.unconfirmedReason}; only the author can confirm it still describes this branch, `
      + 'by reading it and re-running finalize'
}

function messageRemaining(message: MessageOutcome, messageFile: string): string[] {
  const path = FS.displayPath(messageFile)
  if (message.decision === 'drafted') {
    return [`Review the drafted merge message before landing: ${path}`]
  }
  if (message.decision === 'redrafted') {
    return [`Review the redrafted merge message before landing; it replaced the previous one: ${path}`]
  }
  if (message.malformed !== '') {
    return [`Fix the kept merge message, which the landing will reject (${message.malformed}): ${path}`]
  }
  return message.unconfirmedReason === ''
    ? []
    : [
      `Confirm the kept merge message still describes this branch (${message.unconfirmedReason}), `
      + `by reading and updating it before retrying: ${path}`,
    ]
}

/**
 * keptMessageDefect reports why the landing would reject a hand-written merge message, in its own
 * words, or empty when it would accept it. `validateMergeMessage` is the landing's own rule, reused
 * here so the two cannot drift: finalize already validates what it drafts, and a message the author
 * wrote or edited is the only one that reaches the landing unchecked.
 */
function keptMessageDefect(source: string): string {
  try {
    validateMergeMessage(source)
    return ''
  } catch (error) {
    return Errors.messageOf(error)
  }
}

async function assertOnFeatureBranch(
  dependencies: FinalizeDependencies,
  root: string,
  command: string,
): Promise<string> {
  const branchResult = await dependencies.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: root,
    stdio: 'pipe',
  })
  if (branchResult.exitCode !== 0 && branchResult.exitCode !== 1) {
    assertCommandSucceeded(branchResult)
  }
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : ''
  if (!branch.startsWith('feat/')) {
    Errors.throwUserInput(`${command} requires a feat/* branch; this worktree is on '${branch || 'detached HEAD'}'.`)
  }
  return branch
}

async function assertCleanWorktree(dependencies: FinalizeDependencies, root: string, command: string): Promise<void> {
  const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
  if (status !== '') {
    Errors.throwUserInput(
      `The worktree is not clean; ${command} refuses to guess what to do with it. Dirty paths:\n${status.trimEnd()}`,
    )
  }
}

/**
 * Integrate main when the branch does not already contain it. Fetch the remote main ref,
 * with local main as the final offline fallback.
 */
async function integrateMain(
  dependencies: FinalizeDependencies,
  root: string,
  check: boolean,
  lines: string[],
  command: IntegratingCommand,
): Promise<MainIntegration> {
  const mainSha = await readMainSha(dependencies, root, lines)
  const branchHead = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
  const ancestor = await dependencies.run('git', { args: ['merge-base', '--is-ancestor', mainSha, 'HEAD'], cwd: root })
  if (ancestor.exitCode === 0) {
    lines.push(`PASS  ${MAIN_BRANCH} at ${shortSha(mainSha)} is already contained in this branch.`)
    return { headSha: branchHead, integratedNow: false, mainSha }
  }
  if (ancestor.exitCode !== 1) {
    assertCommandSucceeded(ancestor)
  }
  if (check) {
    lines.push(`PLAN  Merge ${MAIN_BRANCH} at ${shortSha(mainSha)} into this branch.`)
    return { headSha: branchHead, integratedNow: false, mainSha }
  }
  const incoming = await git(dependencies, root, ['diff', '--name-only', '-z', `${branchHead}...${mainSha}`])
  const blocked = await unwritablePaths(dependencies, root, incoming.stdout.split('\0').filter(Boolean))
  if (blocked.length > 0) {
    Errors.throwUserInput(deniedIntegrationReport(blocked, command))
  }

  const wouldConflict = await mergeTreeConflicts(dependencies, root, branchHead, mainSha)
  const merge = await dependencies.run('git', { args: ['merge', '--no-edit', mainSha], cwd: root, stdio: 'pipe' })
  if (merge.exitCode !== 0 || merge.error !== undefined || merge.signal !== null) {
    Errors.throwUserInput(
      failedIntegrationReport(merge, wouldConflict, await unmergedPaths(dependencies, root), command),
    )
  }
  const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
  lines.push(`PASS  Merged ${MAIN_BRANCH} at ${shortSha(mainSha)} into this branch.`)
  return { headSha, integratedNow: true, mainSha }
}

/**
 * readMainSha answers "what is main" with a direct fetch and the local ref offline. It is separate from
 * integrating because the landing transaction now integrates main itself, under the lock, while the
 * unlocked preparation still needs main's sha to draft a merge message against.
 */
async function readMainSha(dependencies: FinalizeDependencies, root: string, lines: string[]): Promise<string> {
  let directMain: string | undefined
  const fetch = await dependencies.run('git', {
    args: ['fetch', '--quiet', REMOTE, MAIN_BRANCH],
    cwd: root,
    stdio: 'pipe',
  })
  if (fetch.exitCode === 0 && fetch.error === undefined && fetch.signal === null) {
    directMain = (await git(dependencies, root, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`])).stdout.trim()
  }
  const mainSha = directMain ?? await localMainSha(dependencies, root)
  lines.push(
    directMain !== undefined
      ? `PASS  Read ${REMOTE}/${MAIN_BRANCH} at ${shortSha(mainSha)}.`
      : `PASS  ${REMOTE} was unreachable; read the local ${MAIN_BRANCH} branch at ${shortSha(mainSha)} instead.`,
  )
  return mainSha
}

/**
 * mergeTreeConflicts asks what an integration would conflict on without touching the worktree.
 * `git merge-tree --write-tree` writes only into the object database, so it answers even where the
 * merge itself cannot run — which is the case this exists for: a sandboxed shell denies writes to
 * the paths the policy protects, the merge stops partway, and the index it would have recorded the
 * conflicts in was never written. Asking first means a failure can always name paths.
 */
async function mergeTreeConflicts(
  dependencies: FinalizeDependencies,
  root: string,
  branchHead: string,
  mainSha: string,
): Promise<string[]> {
  const preview = await dependencies.run('git', {
    args: ['merge-tree', '--write-tree', '--name-only', branchHead, mainSha],
    cwd: root,
    stdio: 'pipe',
  })
  if (preview.exitCode === 0 || preview.error !== undefined || preview.signal !== null) {
    return []
  }
  // The first line is the tree this merge would produce; the conflicted paths follow, then a blank
  // line and git's own messages about them.
  const [, ...rest] = preview.stdout.split('\n')
  return rest.slice(0, rest.indexOf('')).map(line => line.trim()).filter(Boolean)
}

/** Prefix for a uniquely created probe directory; a fixed path could overwrite someone's file. */
const WRITE_PROBE_PREFIX = '.finalize-write-probe-'

/**
 * unwritablePaths returns the directories and files a checkout would write that this process cannot,
 * empty when the checkout can complete. A sandboxed shell write-protects part of the worktree —
 * `agents/skills` among them, which 77 of `main`'s last 100 commits touch — and `git merge` discovers
 * that partway through, leaving a tree with no `MERGE_HEAD`, no unmerged entries, and modifications
 * nobody made (DEVENV-111). Refusing before the merge starts is the difference between an instruction
 * and a mess.
 *
 * The test is an actual write rather than a list of protected prefixes, because the list belongs to
 * the harness rather than to this repository: it is not in `.rulesync/permissions.jsonc`, it is not
 * in the generated settings, and a copy kept here would rot silently the first time it changed. A
 * directory probe alone misses a protected file inside a writable directory, which is how
 * `.claude/settings.json` is protected, so every existing file main changes is opened for writing too.
 */
async function unwritablePaths(
  dependencies: FinalizeDependencies,
  root: string,
  paths: readonly string[],
): Promise<string[]> {
  const directories = new Set<string>()
  for (const path of paths) {
    directories.add(await nearestExistingDirectory(dependencies, root, FS.dirname(path)))
  }
  const blocked: string[] = []
  for (const directory of [...directories].sort()) {
    if (!await canWriteInto(dependencies, FS.resolvePath(directory, root))) {
      blocked.push(directory === '' ? '.' : directory)
    }
  }
  for (const path of [...paths].sort()) {
    const file = FS.resolvePath(path, root)
    const insideBlocked = blocked.some(directory => directory === '.' || path.startsWith(`${directory}/`))
    if (!insideBlocked && await dependencies.exists(file) && !await dependencies.canWriteFile(file)) {
      blocked.push(path)
    }
  }
  return blocked
}

/** nearestExistingDirectory walks up to the first directory that exists, since a new file's may not. */
async function nearestExistingDirectory(
  dependencies: FinalizeDependencies,
  root: string,
  directory: string,
): Promise<string> {
  let candidate = directory
  while (candidate !== '' && candidate !== '.' && !await dependencies.exists(FS.resolvePath(candidate, root))) {
    candidate = FS.dirname(candidate)
  }
  return candidate === '.' ? '' : candidate
}

/** canWriteInto reports whether this process may create an entry in a directory. */
async function canWriteInto(dependencies: FinalizeDependencies, directory: string): Promise<boolean> {
  let probe: string
  try {
    // mkdtemp creates the directory exclusively: an existing tracked or ignored path is untouched.
    probe = await dependencies.makeProbeDirectory(FS.resolvePath(WRITE_PROBE_PREFIX, directory))
  } catch {
    return false
  }
  try {
    await dependencies.removeFile(probe)
  } catch (error) {
    Errors.throwHostEnvironment(
      `The write probe could not be removed: ${probe}. `
        + 'Remove this empty directory with rmdir from a normal Terminal, then rerun the command. '
        + `Cleanup failed: ${Errors.asError(error).message}`,
    )
  }
  return true
}

/** deniedIntegrationReport says what the merge would half-write, and how to do it where it works. */
function deniedIntegrationReport(blocked: readonly string[], command: IntegratingCommand): string {
  return `Integrating ${MAIN_BRANCH} would write ${blocked.length} path${blocked.length === 1 ? '' : 's'} `
    + `this shell may not, so the merge would stop partway and leave a tree no Git command describes:\n`
    + `${blocked.map(path => `- ${path}`).join('\n')}\n`
    + `Nothing has been changed; ${UNSANDBOXED_MERGE}${command === 'finalize' ? ', then finalize again' : ''}.`
}

/** unmergedPaths reads the conflicts a merge actually recorded, which a denied merge never wrote. */
async function unmergedPaths(dependencies: FinalizeDependencies, root: string): Promise<string[]> {
  const unmerged = await dependencies.run('git', {
    args: ['diff', '--name-only', '--diff-filter=U'],
    cwd: root,
    stdio: 'pipe',
  })
  return unmerged.stdout.trim().split('\n').filter(Boolean)
}

/**
 * failedIntegrationReport separates the two failures that used to read identically. A merge that
 * conflicted leaves unmerged entries and is resolved by hand; a merge that never completed leaves
 * none, and telling its reader to resolve a conflict sends them looking for something that is not
 * there. The second case names what `merge-tree` says would conflict, and says the recovery, because
 * a grandchild `git` inherits the sandbox its top-level command is excluded from.
 */
function failedIntegrationReport(
  merge: { stderr?: string },
  wouldConflict: readonly string[],
  unmerged: readonly string[],
  command: IntegratingCommand,
): string {
  const list = (paths: readonly string[]): string => paths.map(path => `- ${path}`).join('\n')
  if (unmerged.length > 0) {
    return `Integrating ${MAIN_BRANCH} conflicted; resolve it by hand and `
      + `${command === 'finalize' ? 'finalize again' : 'commit the merge'}. Conflicting paths:\n${list(unmerged)}`
  }
  const reason = (merge.stderr ?? '').trim()
  return `Integrating ${MAIN_BRANCH} did not complete, and it is not a conflict: the merge recorded no `
    + 'unmerged paths, so the worktree may hold a partly written tree that no Git command describes.\n'
    + (reason === '' ? '' : `Git said:\n${reason}\n`)
    + (wouldConflict.length === 0
      ? 'Nothing would have conflicted.\n'
      : `These paths would conflict:\n${list(wouldConflict)}\n`)
    + 'A sandboxed shell denies the writes this merge needs under the paths the policy protects '
    + `(DEVENV-111). Once the worktree is back to its last commit, ${UNSANDBOXED_MERGE}.`
}

async function localMainSha(dependencies: FinalizeDependencies, root: string): Promise<string> {
  const local = await dependencies.run('git', {
    args: ['rev-parse', '--quiet', '--verify', `refs/heads/${MAIN_BRANCH}`],
    cwd: root,
    stdio: 'pipe',
  })
  if (local.exitCode !== 0 || local.error !== undefined || local.signal !== null) {
    Errors.throwHostEnvironment(
      `Neither ${REMOTE} nor a local ${MAIN_BRANCH} branch was reachable; finalize cannot tell what to integrate.`,
    )
  }
  return local.stdout.trim()
}

/**
 * Verification never trusts recorded state as a verdict; it always asks `GreenTree` about the
 * current tree. Only when no accepted lane already covers this exact tree *and toolchain* does
 * finalize run one — a record is now keyed by both, so a resolved `.devenv/profile` change alone
 * (with the tree otherwise byte-identical) is enough to force a real run, exactly as a bare
 * `just verify` would refuse to skip on it.
 */
async function verifyTree(
  dependencies: FinalizeDependencies,
  root: string,
  check: boolean,
  lines: string[],
): Promise<VerificationOutcome> {
  const wanted = await dependencies.key(root)
  const existing = await dependencies.findGreenTree(root, wanted, VERIFY_ACCEPTED_LANES, {
    generatedOutputs: VERIFY_GENERATED_OUTPUTS,
  })
  if (existing !== undefined) {
    lines.push(`PASS  ${GreenTree.describe(VERIFY_LANE, existing)}`)
    return { at: existing.at, lane: existing.lane, toolchain: wanted.toolchain, treeHash: wanted.treeHash }
  }
  if (check) {
    lines.push('PLAN  Run just verify --complete; no record already covers this tree.')
    return { at: '', lane: '', toolchain: wanted.toolchain, treeHash: wanted.treeHash }
  }

  lines.push('PASS  Running just verify --complete; no record already covers this tree.')
  const verify = await dependencies.run('just', { args: ['verify', '--complete'], cwd: root, stdio: 'stream' })
  if (verify.exitCode !== 0 || verify.error !== undefined || verify.signal !== null) {
    throw new Errors.CommandExecutionError(verify)
  }
  const verifiedKey = await dependencies.key(root)
  const record = await dependencies.findGreenTree(root, verifiedKey, VERIFY_ACCEPTED_LANES, {
    generatedOutputs: VERIFY_GENERATED_OUTPUTS,
  })
  const outcome: GreenTreeMatch = record ?? {
    at: dependencies.now().toISOString(),
    lane: VERIFY_LANE,
    logRoot: '',
    toolchain: verifiedKey.toolchain,
    treeHash: verifiedKey.treeHash,
  }
  lines.push(`PASS  Verified; standing on ${outcome.lane} recorded at ${outcome.at}.`)
  return { at: outcome.at, lane: outcome.lane, toolchain: verifiedKey.toolchain, treeHash: verifiedKey.treeHash }
}

/**
 * The merge message is the one artifact finalize cannot regenerate: it is what an author wrote and
 * what the Developer may have read. So an existing message is never replaced except on an explicit `--redraft`,
 * and a message is drafted only when none exists. Recorded state decides nothing about writing any
 * more — it decides only whether the report can say the kept message is proved to cover this HEAD,
 * or has to hand that judgment to the author. This is deliberately asymmetric: finalize may keep a
 * message it should have redrafted, and must never replace one it should have kept.
 *
 * `check` reaches the same decision from the same inputs as a real run, so `--check` can no longer
 * describe the message differently from the run that follows it.
 *
 * A kept-but-unproved hand-written message is recorded against this HEAD once the run ends, so the
 * confirmation is asked for once rather than on every re-run of the landing convoy. A generated
 * draft stays unconfirmed until its review baseline proves that an author changed its bytes. The
 * file itself is untouched either way.
 */
async function draftOrKeepMessage(
  dependencies: FinalizeDependencies,
  root: string,
  messageFile: string,
  priorState: FinalizeState | undefined,
  reviewedDraftHeadSha: string | undefined,
  mainSha: string,
  headSha: string,
  check: boolean,
  redraft: boolean,
  lines: string[],
): Promise<MessageOutcome> {
  const messageExists = await dependencies.exists(messageFile)
  if (messageExists && !redraft) {
    const source = await dependencies.readText(messageFile)
    const malformed = keptMessageDefect(source)
    if (malformed !== '') {
      lines.push(`FAIL  The kept merge message is not one the landing will accept: ${malformed}`)
      return { decision: 'kept', malformed, messageHeadSha: headSha, unconfirmedReason: '' }
    }
    const unconfirmedReason = keptMessageReason(source, priorState, headSha, reviewedDraftHeadSha)
    lines.push(
      `PASS  Kept the existing merge message; ${
        unconfirmedReason === ''
          ? `it is recorded as written for ${shortSha(headSha)}`
          : unconfirmedReason
      }: ${FS.displayPath(messageFile)}`,
    )
    return { decision: 'kept', malformed: '', messageHeadSha: headSha, unconfirmedReason }
  }

  const decision: MessageDecision = messageExists ? 'redrafted' : 'drafted'
  if (check) {
    lines.push(
      messageExists
        ? `PLAN  Redraft the merge message on request, replacing ${FS.displayPath(messageFile)}.`
        : 'PLAN  Draft the merge message; none exists yet.',
    )
    return { decision, malformed: '', messageHeadSha: headSha, unconfirmedReason: '' }
  }

  const commits = await readFeatureCommits(dependencies, root, mainSha, headSha)
  const draft = assertDraftValidates(draftMergeMessage(commits))
  await dependencies.writeText(messageFile, `${draft}\n`)
  lines.push(
    `PASS  ${messageExists ? 'Redrafted' : 'Drafted'} the merge message from ${commits.length} commit(s)`
      + `${messageExists ? ', replacing what was there' : ''}; review it before landing: `
      + FS.displayPath(messageFile),
  )
  return { decision, malformed: '', messageHeadSha: headSha, unconfirmedReason: '' }
}

/**
 * Why a kept message cannot be called current, in the author's terms: a generated draft has not
 * changed from its review baseline, nothing records which HEAD a hand-written message was for, or
 * it was recorded against an earlier HEAD and the branch has gained commits since. Empty means the
 * applicable evidence proves it covers this HEAD.
 */
function keptMessageReason(
  source: string,
  priorState: FinalizeState | undefined,
  headSha: string,
  reviewedDraftHeadSha: string | undefined,
): string {
  if (reviewedDraftHeadSha === headSha) {
    return ''
  }
  if (source.startsWith(DRAFT_PREFIX)) {
    return 'the generated draft has not been edited by its author'
  }
  if (priorState === undefined) {
    return 'nothing records which HEAD it was written for'
  }
  return priorState.messageHeadSha === headSha
    ? ''
    : `the branch has gained commits since it was recorded for ${shortSha(priorState.messageHeadSha)}`
}

async function loadDraftReview(
  dependencies: FinalizeDependencies,
  path: string,
): Promise<DraftReviewState | undefined> {
  if (!await dependencies.exists(path)) {
    return undefined
  }
  try {
    const value = await dependencies.readJson<Partial<DraftReviewState>>(path)
    return value.version === DRAFT_REVIEW_VERSION
        && typeof value.headSha === 'string'
        && typeof value.draftText === 'string'
      ? value as DraftReviewState
      : undefined
  } catch {
    return undefined
  }
}

async function recordDraftReview(
  dependencies: FinalizeDependencies,
  reviewPath: string,
  messageFile: string,
  headSha: string,
): Promise<void> {
  await dependencies.writeJson(
    reviewPath,
    {
      draftText: await dependencies.readText(messageFile),
      headSha,
      version: DRAFT_REVIEW_VERSION,
    } satisfies DraftReviewState,
  )
}

async function readFeatureCommits(
  dependencies: FinalizeDependencies,
  root: string,
  mainSha: string,
  headSha: string,
): Promise<DraftCommit[]> {
  const FIELD_SEPARATOR = ''
  const RECORD_SEPARATOR = ''
  const log = await git(dependencies, root, [
    'log',
    '--no-merges',
    `${mainSha}..${headSha}`,
    `--pretty=format:%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
  ])
  return log.stdout.split(RECORD_SEPARATOR)
    .map(entry => entry.replace(/^\n+/u, ''))
    .filter(entry => entry.length > 0)
    .map(entry => {
      const separatorIndex = entry.indexOf(FIELD_SEPARATOR)
      return separatorIndex < 0
        ? { body: '', subject: entry }
        : { body: entry.slice(separatorIndex + 1), subject: entry.slice(0, separatorIndex) }
    })
}

/**
 * Draft exactly the shape `MergeWithMain.validateMergeMessage` accepts, from real commit content
 * only: the summary names the newest commit so it can never invent a description, and every bullet
 * is a real commit subject or a real non-empty body line. The `DRAFT:` prefix is the one piece of
 * text this file adds, and it is what marks the message as one the agent must edit before landing.
 */
function draftMergeMessage(commits: readonly DraftCommit[]): string {
  if (commits.length === 0) {
    Errors.throwUserInput(
      'No feature commits were found between main and HEAD; there is nothing to draft a merge message from.',
    )
  }
  const summary = truncateSummary(`${DRAFT_PREFIX}${commits[0]!.subject.trim()}`)
  const bullets = [...commits].reverse().flatMap(commit => commitBullets(commit))
  return `${summary}\n\n${bullets.join('\n')}`
}

function commitBullets(commit: DraftCommit): string[] {
  const bodyBullets = commit.body.split('\n').map(line => line.trim()).filter(Boolean).map(line => `- ${line}`)
  return [`- ${commit.subject.trim()}`, ...bodyBullets]
}

function truncateSummary(summary: string): string {
  return summary.length <= MAX_SUMMARY_LENGTH ? summary : `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
}

function assertDraftValidates(draft: string): string {
  try {
    return validateMergeMessage(draft)
  } catch (error) {
    return Errors.throwUnexpected('Finalize drafted a merge message that fails its own validation.', {
      details: { draft, reason: Errors.asError(error).message },
    })
  }
}

async function loadState(dependencies: FinalizeDependencies, statePath: string): Promise<FinalizeState | undefined> {
  if (!await dependencies.exists(statePath)) {
    return undefined
  }
  try {
    const value = await dependencies.readJson<Partial<FinalizeState>>(statePath)
    if (
      value.version !== STATE_VERSION
      || typeof value.headSha !== 'string'
      || typeof value.mainIntegratedSha !== 'string'
      || typeof value.messageHeadSha !== 'string'
      || typeof value.updatedAt !== 'string'
      || typeof value.verifiedAt !== 'string'
      || typeof value.verifiedLane !== 'string'
      || typeof value.verifiedToolchain !== 'string'
      || typeof value.verifiedTreeHash !== 'string'
    ) {
      return undefined
    }
    return value as FinalizeState
  } catch {
    // A malformed or unreadable state file degrades to doing the full work; see the module doc.
    return undefined
  }
}

/**
 * Judgment (a) and (b) from the brief: which roadmap or ledger documents this branch's diff touches
 * or plausibly obsoletes, and whether the diff reaches paths only a person's own gates cover. Both
 * are explicitly advisory — the caller never folds their result into what gates `ok`.
 */
async function adviseOnDiff(
  dependencies: FinalizeDependencies,
  root: string,
  mainSha: string,
  headSha: string,
  branch: string,
  lines: string[],
): Promise<string[]> {
  const diffPaths = (await git(dependencies, root, ['diff', '--name-only', `${mainSha}..${headSha}`]))
    .stdout.split('\n').filter(Boolean)
  const advisories: string[] = []

  const roadmapTouched = diffPaths.filter(path => path.startsWith('Docs/Roadmap/') || path.startsWith('Docs/Spec/'))
  lines.push(
    roadmapTouched.length > 0
      ? `NOTE  This branch already edits: ${roadmapTouched.join(', ')}`
      : 'NOTE  This branch touches no Docs/Roadmap or Docs/Spec document.',
  )
  if (
    diffPaths.some(path =>
      path.startsWith('packages/cli/dev-cli/')
      || path.startsWith('packages/cli/agent-cli/')
      || path.startsWith('packages/cli/cli-kit/')
      || path.startsWith('packages/testing/verification/')
      || path.startsWith('packages/ides/studio-tooling/')
      || path === 'Justfile'
    )
    && !roadmapTouched.includes(ROADMAP_LEDGER_PATH)
  ) {
    advisories.push(
      `Consider whether ${ROADMAP_LEDGER_PATH} needs an update; the diff touches repository workflow code `
        + 'without touching it.',
    )
  }

  const humanVerificationPaths = diffPaths.filter(path =>
    HUMAN_VERIFICATION_PREFIXES.some(prefix => path.startsWith(prefix))
  )
  if (humanVerificationPaths.length > 0) {
    advisories.push(
      'This diff reaches paths only a host lane or a person covers (Studio, app, native, or language-surface '
        + `behavior); run the relevant host lane or ./dev studio-manual-checks before landing '${branch}'. Paths: `
        + humanVerificationPaths.join(', '),
    )
  }
  return advisories
}

async function git(
  dependencies: FinalizeDependencies,
  cwd: string,
  args: readonly string[],
): Promise<CLI.CommandResult> {
  const result = await dependencies.run('git', { args, cwd, stdio: 'pipe' })
  assertCommandSucceeded(result)
  return result
}

function assertCommandSucceeded(result: CLI.CommandResult): void {
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Errors.CommandExecutionError(result)
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 12)
}

function writeLines(dependencies: FinalizeDependencies, lines: readonly string[]): void {
  for (const line of lines) {
    dependencies.writeLine(line)
  }
}
