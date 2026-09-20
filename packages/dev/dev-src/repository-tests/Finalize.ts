import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { GeneratedEvidence } from './GeneratedEvidence'
import { type FindOptions, GreenTree, type GreenTreeKey, type GreenTreeMatch } from './GreenTree'
import { validateMergeMessage } from './MergeWithMain'
import { VerificationLanes } from './VerificationLanes'

/*
 * "Finalize and prepare the merge" used to exist only as prose in AGENTS.md and the
 * verification-lanes skill, so an agent replayed the whole sequence from scratch on every re-entry
 * — and a branch re-enters finalization often, driven by Ro's corrections, a red lane, or an
 * agent's own re-entry after a background job reports. `finalize` makes the sequence a command and
 * records enough evidence to make a re-entry cheap.
 *
 * Only one step here trusts recorded state, and it no longer trusts it with anything destructive:
 * the merge message is written only when none exists, or when `--redraft` explicitly asks for a new
 * one. Recorded state now decides one thing — whether a kept message is *proved* to cover the HEAD
 * finalize is looking at, or whether the report has to ask the author to confirm it. Main
 * integration and verification never trust it: integration re-asks Git whether main is already an
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
  'packages/studio/',
  'packages/code-editor/',
  'packages/icloud-native/',
  'packages/studio-companion-app/',
  'packages/runtime-toolchain/',
  'packages/parser/',
  'packages/validator/',
  'packages/compiler/',
  'packages/formatter/',
  'packages/source-actions/',
  'packages/runtime/',
  'packages/ast-utils/',
  'packages/stdlib/',
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
  exists: (path: string) => Promise<boolean>
  findGreenTree: (
    repositoryRoot: string,
    wanted: GreenTreeKey,
    acceptedLanes: readonly string[],
    options?: FindOptions,
  ) => Promise<GreenTreeMatch | undefined>
  /** The tree-plus-toolchain identity a record must match; see `GreenTree.key`. */
  key: (repositoryRoot: string) => Promise<GreenTreeKey>
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  run: FinalizeCommandRunner
  writeJson: (path: string, value: unknown) => Promise<void>
  writeLine: (line: string) => void
  writeText: (path: string, value: string) => Promise<void>
}

const defaultDependencies: FinalizeDependencies = {
  exists: FS.exists,
  findGreenTree: GreenTree.find,
  key: GreenTree.key,
  now: () => new Date(),
  readJson: FS.readJson,
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
  /** The HEAD the merge message on disk is known to cover — the HEAD it was drafted for, or the
   * HEAD at which finalize last kept and reported it. Never a licence to replace the file. */
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
  messageHeadSha: string
  /**
   * Why a kept message is not proved to cover this HEAD — empty when it is proved, or when the
   * message was drafted or redrafted. Only the author can settle this, so it becomes remaining work
   * rather than being resolved here.
   */
  unconfirmedReason: string
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

    const branch = await assertOnFeatureBranch(dependencies, root)
    await assertCleanWorktree(dependencies, root)

    const integration = await integrateMain(dependencies, root, check, lines)
    const verification = await verifyTree(dependencies, root, check, lines)

    const statePath = FS.resolvePath(`.artifacts/merge/${branch}.state.json`, root)
    const priorState = options.fresh === true ? undefined : await loadState(dependencies, statePath)

    const messageFile = FS.resolvePath(options.messageFile ?? `.artifacts/merge/${branch}.msg`, root)
    const message = await draftOrKeepMessage(
      dependencies,
      root,
      messageFile,
      priorState,
      integration.mainSha,
      integration.headSha,
      check,
      options.redraft === true,
      lines,
    )
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
  return message.unconfirmedReason === ''
    ? 'kept — recorded as written for this HEAD'
    : `kept — ${message.unconfirmedReason}; only the author can confirm it still describes this branch`
}

function messageRemaining(message: MessageOutcome, messageFile: string): string[] {
  const path = FS.displayPath(messageFile)
  if (message.decision === 'drafted') {
    return [`Review the drafted merge message before landing: ${path}`]
  }
  if (message.decision === 'redrafted') {
    return [`Review the redrafted merge message before landing; it replaced the previous one: ${path}`]
  }
  return message.unconfirmedReason === ''
    ? []
    : [`Confirm the kept merge message still describes this branch (${message.unconfirmedReason}): ${path}`]
}

async function assertOnFeatureBranch(dependencies: FinalizeDependencies, root: string): Promise<string> {
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
    Errors.throwUserInput(`finalize requires a feat/* branch; this worktree is on '${branch || 'detached HEAD'}'.`)
  }
  return branch
}

async function assertCleanWorktree(dependencies: FinalizeDependencies, root: string): Promise<void> {
  const status = (await git(dependencies, root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
  if (status !== '') {
    Errors.throwUserInput(
      `The worktree is not clean; finalize refuses to guess what to do with it. Dirty paths:\n${status.trimEnd()}`,
    )
  }
}

/**
 * Integrate main when the branch does not already contain it. `origin` is preferred, but
 * `git fetch origin` fails inside this repository's sandbox, so the local `main` branch is the
 * ordinary fallback here, not a degraded path — it is reported as progress, never as a warning.
 */
async function integrateMain(
  dependencies: FinalizeDependencies,
  root: string,
  check: boolean,
  lines: string[],
): Promise<MainIntegration> {
  const fetch = await dependencies.run('git', {
    args: ['fetch', '--quiet', REMOTE, MAIN_BRANCH],
    cwd: root,
    stdio: 'pipe',
  })
  const remoteReachable = fetch.exitCode === 0 && fetch.error === undefined && fetch.signal === null
  const mainSha = remoteReachable
    ? (await git(dependencies, root, ['rev-parse', `${REMOTE}/${MAIN_BRANCH}`])).stdout.trim()
    : await localMainSha(dependencies, root)
  lines.push(
    remoteReachable
      ? `PASS  Read ${REMOTE}/${MAIN_BRANCH} at ${shortSha(mainSha)}.`
      : `PASS  ${REMOTE} was unreachable; read the local ${MAIN_BRANCH} branch at ${shortSha(mainSha)} instead.`,
  )

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

  const merge = await dependencies.run('git', { args: ['merge', '--no-edit', mainSha], cwd: root, stdio: 'pipe' })
  if (merge.exitCode !== 0 || merge.error !== undefined || merge.signal !== null) {
    const conflicts = (await git(dependencies, root, ['diff', '--name-only', '--diff-filter=U']))
      .stdout.trim().split('\n').filter(Boolean)
    Errors.throwUserInput(
      `Integrating ${MAIN_BRANCH} conflicted; resolve it by hand and finalize again. Conflicting paths:\n`
        + conflicts.map(path => `- ${path}`).join('\n'),
    )
  }
  const headSha = (await git(dependencies, root, ['rev-parse', 'HEAD'])).stdout.trim()
  lines.push(`PASS  Merged ${MAIN_BRANCH} at ${shortSha(mainSha)} into this branch.`)
  return { headSha, integratedNow: true, mainSha }
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
 * what Ro may have read. So an existing message is never replaced except on an explicit `--redraft`,
 * and a message is drafted only when none exists. Recorded state decides nothing about writing any
 * more — it decides only whether the report can say the kept message is proved to cover this HEAD,
 * or has to hand that judgment to the author. This is deliberately asymmetric: finalize may keep a
 * message it should have redrafted, and must never replace one it should have kept.
 *
 * `check` reaches the same decision from the same inputs as a real run, so `--check` can no longer
 * describe the message differently from the run that follows it.
 *
 * A kept-but-unproved message is recorded against this HEAD once the run ends, so the confirmation
 * is asked for once rather than on every re-run of the landing convoy. The file itself is untouched
 * either way.
 */
async function draftOrKeepMessage(
  dependencies: FinalizeDependencies,
  root: string,
  messageFile: string,
  priorState: FinalizeState | undefined,
  mainSha: string,
  headSha: string,
  check: boolean,
  redraft: boolean,
  lines: string[],
): Promise<MessageOutcome> {
  const messageExists = await dependencies.exists(messageFile)
  if (messageExists && !redraft) {
    const unconfirmedReason = keptMessageReason(priorState, headSha)
    lines.push(
      `PASS  Kept the existing merge message; ${
        unconfirmedReason === ''
          ? `it is recorded as written for ${shortSha(headSha)}`
          : unconfirmedReason
      }: ${FS.displayPath(messageFile)}`,
    )
    return { decision: 'kept', messageHeadSha: headSha, unconfirmedReason }
  }

  const decision: MessageDecision = messageExists ? 'redrafted' : 'drafted'
  if (check) {
    lines.push(
      messageExists
        ? `PLAN  Redraft the merge message on request, replacing ${FS.displayPath(messageFile)}.`
        : 'PLAN  Draft the merge message; none exists yet.',
    )
    return { decision, messageHeadSha: headSha, unconfirmedReason: '' }
  }

  const commits = await readFeatureCommits(dependencies, root, mainSha, headSha)
  const draft = assertDraftValidates(draftMergeMessage(commits))
  await dependencies.writeText(messageFile, `${draft}\n`)
  lines.push(
    `PASS  ${messageExists ? 'Redrafted' : 'Drafted'} the merge message from ${commits.length} commit(s)`
      + `${messageExists ? ', replacing what was there' : ''}; review it before landing: `
      + FS.displayPath(messageFile),
  )
  return { decision, messageHeadSha: headSha, unconfirmedReason: '' }
}

/**
 * Why a kept message cannot be called current, in the author's terms: either nothing records which
 * HEAD it was written for (it was written by hand, or the record was discarded by `--fresh`), or it
 * was recorded against an earlier HEAD and the branch has gained commits since. Empty means the
 * record proves it covers this HEAD.
 */
function keptMessageReason(priorState: FinalizeState | undefined, headSha: string): string {
  if (priorState === undefined) {
    return 'nothing records which HEAD it was written for'
  }
  return priorState.messageHeadSha === headSha
    ? ''
    : `the branch has gained commits since it was recorded for ${shortSha(priorState.messageHeadSha)}`
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
    diffPaths.some(path => path.startsWith('packages/dev/') || path === 'Justfile')
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
