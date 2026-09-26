import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { createHash, randomUUID } from 'node:crypto'

/**
 * Langium's generator prints diagnostics that nothing reads, so a new one is indistinguishable
 * from the two the repository already carries. This runs the generator unchanged and turns that
 * around: the known diagnostics are named and allowed, and any other one fails the step.
 *
 * Suppression is per diagnostic and documented, never a switch that turns the generator's own
 * checks off — a genuinely dead rule must still be reported the first time it appears.
 *
 * Several gates depend on this step, and each gate is its own process, so a single gate run
 * reaches it more than once. A content stamp makes the repeat runs skip Langium: without it they
 * delete and rewrite the generated directory while a parallel gate is reading it.
 */

/**
 * Diagnostics Langium reports that are not true. Langium's reachability check walks from each
 * grammar file's own entry rule, so a rule declared in one imported file and called only from
 * another is reported as unreferenced even though the parser uses it.
 */
const ACCEPTED_DIAGNOSTICS: readonly { file: string; reason: string; rule: string }[] = [
  {
    file: 'parser-grammar/imports.langium',
    reason: 'called by ViewDeclaration and TypeDeclaration in other grammar files',
    rule: 'PackageMemberReference',
  },
  {
    file: 'parser-grammar/actions.langium',
    reason: 'called by AppBlockDiagnosticStatement in blocks.langium',
    rule: 'CommandDeclaration',
  },
]

/** A diagnostic line, as Langium prints it: `<file>:<line>:<column> - <message>`. */
const DIAGNOSTIC_PATTERN = /^\S+\.langium:\d+:\d+ - .+$/

/**
 * Where the stamp is kept. `.artifacts` is the repository's ignored scratch root, and it is the
 * only correct home for this file: the generated parser directory is deleted and recreated by
 * Langium on every run, and a stranger left inside it makes the generator stop and ask whether to
 * delete the files it did not write.
 */
const STAMP_PATH = '.artifacts/parser-generate-stamp.json'

/** The stamp layout. An older or unreadable stamp is treated as stale, never as an error. */
const STAMP_VERSION = 3

/** Langium's configuration file, which is both an input to generation and the list of outputs. */
const LANGIUM_CONFIG = 'langium-config.json'

/** ParserGenerateStamp records what the last successful generation read and what it wrote. */
type ParserGenerateStamp = {
  inputs: string
  outputs: readonly string[]
  outputsHash: string
  version: number
}

/** ParserGenerateReview separates the diagnostics that were expected from the ones that were not. */
export type ParserGenerateReview = {
  accepted: readonly string[]
  unexpected: readonly string[]
}

/** reviewParserGenerateOutput classifies every diagnostic the generator printed. */
export function reviewParserGenerateOutput(
  output: string,
  grammarSources: Record<string, string> = {},
): ParserGenerateReview {
  const accepted: string[] = []
  const unexpected: string[] = []
  for (const line of output.split(/\r?\n/).map(entry => entry.trim())) {
    if (!DIAGNOSTIC_PATTERN.test(line)) {
      continue
    }
    ;(isAcceptedDiagnostic(line, grammarSources) ? accepted : unexpected).push(line)
  }
  return { accepted, unexpected }
}

/**
 * A diagnostic is accepted only when it names the exact rule that was documented, which means
 * resolving the reported line back to the rule declared there. Matching on the file alone would
 * make every future dead rule in these two files invisible — the opposite of the intent.
 */
function isAcceptedDiagnostic(line: string, grammarSources: Record<string, string>): boolean {
  const parsed = /^(\S+\.langium):(\d+):\d+ - (.+)$/.exec(line)
  if (parsed === null) {
    return false
  }
  const [, file, lineNumber, message] = parsed
  return ACCEPTED_DIAGNOSTICS.some(entry =>
    entry.file === file
    && message === 'This rule is declared but never referenced.'
    && declaredRuleAt(grammarSources[file], Number(lineNumber)) === entry.rule
  )
}

/** declaredRuleAt reads the rule name a grammar line declares, which is the text before its colon. */
export function declaredRuleAt(source: string | undefined, lineNumber: number): string | undefined {
  const line = source?.split(/\r?\n/)[lineNumber - 1]
  return /^([A-Za-z_][\w]*)\s*(returns\s+\w+\s*)?:/.exec(line ?? '')?.[1]
}

/** acceptedDiagnosticReasons explains, for the terminal, why each accepted diagnostic is kept. */
export function acceptedDiagnosticReasons(): readonly string[] {
  return ACCEPTED_DIAGNOSTICS.map(entry => `${entry.rule} is ${entry.reason}`)
}

/** ParserGenerateOutcome is what one Langium invocation reported, whether real or substituted. */
export type ParserGenerateOutcome = {
  error?: Error
  exitCode: number | null
  output: string
}

/** ParserGenerateOptions lets a test substitute the generator; the workflow always runs Langium. */
export type ParserGenerateOptions = {
  beforeCleanup?: () => Promise<void>
  beforeLockRelease?: () => Promise<void>
  beforeMkdir?: (path: string) => Promise<void>
  beforeMove?: (fromPath: string, toPath: string) => Promise<void>
  beforePublication?: () => Promise<void>
  beforeRemove?: (path: string) => Promise<void>
  generate?: (parserRoot: string, repositoryRoot: string) => Promise<ParserGenerateOutcome>
  repositoryRoot?: string
}

type ParserGenerateFileHooks = Pick<
  ParserGenerateOptions,
  'beforeMkdir' | 'beforeMove' | 'beforeRemove'
>

/** runParserGenerate regenerates the parser and fails on any diagnostic that is not documented. */
export async function runParserGenerate(options: ParserGenerateOptions = {}): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const parserRoot = FS.resolvePath('packages/language/parser', repositoryRoot)
  const stampPath = FS.resolvePath(STAMP_PATH, repositoryRoot)
  const inputs = await parserGenerateInputHash(parserRoot)
  if (await parserGenerateIsUpToDate(parserRoot, repositoryRoot, stampPath, inputs)) {
    HCI.writeLine('parser generate: up to date')
    return 0
  }

  return await FS.withFileMutationLock(stampPath, repositoryRoot, async () => {
    // Every verification gate is a separate process. Another process may have completed generation
    // while this one waited for the canonical repository lock, so never trust the pre-lock result.
    const lockedInputs = await parserGenerateInputHash(parserRoot)
    if (await parserGenerateIsUpToDate(parserRoot, repositoryRoot, stampPath, lockedInputs)) {
      HCI.writeLine('parser generate: up to date')
      return 0
    }
    return await runParserGenerateLocked(options, repositoryRoot, parserRoot, stampPath, lockedInputs)
  }, { beforeRelease: options.beforeLockRelease })
}

async function runParserGenerateLocked(
  options: ParserGenerateOptions,
  repositoryRoot: string,
  parserRoot: string,
  stampPath: string,
  inputs: string,
): Promise<number> {
  // Langium recursively removes its output directory before regenerating, and macOS can deny both
  // removal and rename for provenance-bearing worktree directories. Generate into a disposable
  // host-temporary package instead, then publish files into the existing directory shape.
  const stagingRepositoryRoot = await createParserGenerateStagingRepository(parserRoot)
  const stagingParserRoot = FS.resolvePath('packages/language/parser', stagingRepositoryRoot)
  const generate = options.generate
    ?? (async () => await runLangiumGenerate(stagingParserRoot, repositoryRoot, parserRoot))
  let outcome: number | undefined
  let primaryError: unknown
  try {
    outcome = await (async () => {
      // Langium deletes each configured output before writing it. Validate both mappings before the
      // CLI sees the config so a typo or hostile checkout cannot turn the host-temporary safety copy
      // into a deletion primitive outside the staging or live repository.
      await validateDeclaredOutputBoundaries(stagingParserRoot, stagingRepositoryRoot, 'staged parser output')
      await validateDeclaredOutputBoundaries(parserRoot, repositoryRoot, 'parser output')
      const result = await generate(stagingParserRoot, stagingRepositoryRoot)
      const output = result.output
      HCI.write(output)
      if (result.error !== undefined || result.exitCode !== 0) {
        return result.exitCode ?? 1
      }

      const review = reviewParserGenerateOutput(output, await readGrammarSources(parserRoot))
      for (const diagnostic of review.unexpected) {
        HCI.writeErrorLine(`parser generate: ${diagnostic}`)
      }
      if (review.unexpected.length > 0) {
        HCI.writeErrorLine(
          'Fix the rule, or document the diagnostic in '
            + 'packages/testing/verification/verification-src/ParserGenerate.ts if the generator is wrong about it.',
        )
        return 1
      }

      await synchronizeGeneratedOutputs(
        stagingParserRoot,
        stagingRepositoryRoot,
        parserRoot,
        repositoryRoot,
        inputs,
        options,
      )
      if (await parserGenerateInputHash(parserRoot) !== inputs) {
        Errors.throwUnexpected('Parser generation inputs changed before stamp publication; refusing stale metadata.')
      }
      await writeParserGenerateStamp(
        stampPath,
        {
          inputs,
          outputs: (await generatedFilePaths(parserRoot)).map(path => FS.relativePath(repositoryRoot, path)),
          outputsHash: await parserGenerateOutputHash(parserRoot),
          version: STAMP_VERSION,
        },
        repositoryRoot,
        {
          ...options,
          beforeMove: async (fromPath, toPath) => {
            await options.beforeMove?.(fromPath, toPath)
            if (await parserGenerateInputHash(parserRoot) !== inputs) {
              Errors.throwUnexpected(
                'Parser generation inputs changed before stamp publication; refusing stale metadata.',
              )
            }
          },
        },
      )
      return 0
    })()
  } catch (error) {
    primaryError = error
  }
  let cleanupError: unknown
  try {
    await FS.remove(stagingRepositoryRoot)
  } catch (error) {
    cleanupError = error
  }
  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      throw combinedFailure(primaryError, 'stagingRepositoryCleanupError', Errors.messageOf(cleanupError))
    }
    throw primaryError
  }
  if (cleanupError !== undefined) {
    throw cleanupError
  }
  return outcome!
}

async function validateDeclaredOutputBoundaries(
  parserRoot: string,
  repositoryRoot: string,
  label: string,
): Promise<void> {
  for (const outputPath of await declaredOutputPaths(parserRoot)) {
    if (outputPath === repositoryRoot || !FS.pathIsWithin(outputPath, repositoryRoot)) {
      Errors.throwUnexpected(`The ${label} escapes its repository root: ${outputPath}`)
    }
    await assertNoSymbolicLinkComponents(repositoryRoot, outputPath, label)
  }
}

/**
 * createParserGenerateStagingRepository copies only Langium's inputs into worktree scratch.
 * Dependencies stay in the real parser package and are invoked by absolute path.
 */
async function createParserGenerateStagingRepository(parserRoot: string): Promise<string> {
  const stagingRepositoryRoot = await Repo.mkScratchDir('tao-parser-generate-', FS.resolvePath('../../..', parserRoot))
  const stagingParserRoot = FS.resolvePath('packages/language/parser', stagingRepositoryRoot)
  try {
    await FS.copyFile(
      FS.resolvePath(LANGIUM_CONFIG, parserRoot),
      FS.resolvePath(LANGIUM_CONFIG, stagingParserRoot),
    )
    await FS.copyDirectory(
      FS.resolvePath('parser-grammar', parserRoot),
      FS.resolvePath('parser-grammar', stagingParserRoot),
    )
    return stagingRepositoryRoot
  } catch (error) {
    await FS.remove(stagingRepositoryRoot)
    throw error
  }
}

/** runLangiumGenerate invokes the Langium CLI from the parser package, capturing what it printed. */
async function runLangiumGenerate(
  parserRoot: string,
  repositoryRoot: string,
  dependencyParserRoot: string,
): Promise<ParserGenerateOutcome> {
  const node = FS.resolvePath('.devenv/profile/bin/node', repositoryRoot)
  const langiumCli = FS.resolvePath('node_modules/langium-cli/bin/langium.js', dependencyParserRoot)
  const result = await CLI.run(await FS.isFile(node) ? node : 'node', {
    args: [langiumCli, 'generate'],
    cwd: parserRoot,
    stdio: 'pipe',
  })
  return { error: result.error, exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` }
}

type DesiredGeneratedFile = { sourcePath: string; targetPath: string }
type GeneratedPublicationPlan = {
  desiredDirectories: readonly string[]
  desiredFiles: readonly DesiredGeneratedFile[]
  originalFiles: readonly string[]
  outputPaths: readonly string[]
  staleFiles: readonly string[]
}

/** synchronizeGeneratedOutputs publishes every declared output as one rollback-capable file transaction. */
async function synchronizeGeneratedOutputs(
  stagingParserRoot: string,
  stagingRepositoryRoot: string,
  parserRoot: string,
  repositoryRoot: string,
  expectedInputs: string,
  options: ParserGenerateOptions,
): Promise<void> {
  const plan = await generatedPublicationPlan(stagingParserRoot, stagingRepositoryRoot, parserRoot, repositoryRoot)
  const transactionRoot = await Repo.mkScratchDir('tao-parser-publish-', repositoryRoot)
  const publicationScratchRoot = FS.resolvePath('.artifacts', repositoryRoot)
  const stagedFiles = new Map<string, string>()
  const backups = new Map<string, string>()
  const worktreeTemporaryFiles: string[] = []
  const committedChanges: GeneratedPublicationChange[] = []
  const publicationHooks: ParserGenerateFileHooks = {
    beforeMkdir: options.beforeMkdir,
    beforeMove: async (fromPath, toPath) => {
      await options.beforeMove?.(fromPath, toPath)
      if (await parserGenerateInputHash(parserRoot) !== expectedInputs) {
        Errors.throwUnexpected('Parser generation inputs changed before publication; refusing stale generated output.')
      }
    },
    beforeRemove: options.beforeRemove,
  }
  let commitStarted = false
  let primaryError: unknown
  try {
    // Capture every desired and original byte before the first worktree mutation. The generator's
    // own staging tree is already isolated, but this immutable transaction copy also protects the
    // rollback source while publishing proceeds.
    for (const [index, desired] of plan.desiredFiles.entries()) {
      const stagedPath = FS.resolvePath(`desired/${index}`, transactionRoot)
      await FS.copyFile(desired.sourcePath, stagedPath)
      stagedFiles.set(desired.targetPath, stagedPath)
    }
    for (const [index, originalPath] of plan.originalFiles.entries()) {
      const backupPath = FS.resolvePath(`original/${index}`, transactionRoot)
      await FS.copyFile(originalPath, backupPath)
      backups.set(originalPath, backupPath)
    }
    const originalIdentity = await FS.filesIdentity(
      plan.originalFiles.map(originalPath => [
        FS.relativePath(repositoryRoot, originalPath),
        backups.get(originalPath)!,
      ]),
    )
    await FS.mkdirWithinBoundary(publicationScratchRoot, repositoryRoot, publicationHooks)
    for (const [index, desired] of plan.desiredFiles.entries()) {
      const temporaryPath = FS.resolvePath(`parser-publish-${randomUUID()}-${index}.tmp`, publicationScratchRoot)
      worktreeTemporaryFiles.push(temporaryPath)
      await FS.copyFile(stagedFiles.get(desired.targetPath)!, temporaryPath)
    }
    await options.beforePublication?.()

    // The lock coordinates other parser gates. This final link, shape, and content check also
    // rejects unrelated tools that touched an output while generation ran.
    await validatePublicationPrecommit(plan, parserRoot, repositoryRoot, originalIdentity, expectedInputs)
    for (const directory of plan.desiredDirectories) {
      await FS.mkdirWithinBoundary(directory, repositoryRoot, publicationHooks)
    }
    await validatePublicationPrecommit(plan, parserRoot, repositoryRoot, originalIdentity, expectedInputs)
    commitStarted = true
    for (const [index, desired] of plan.desiredFiles.entries()) {
      const expectedIdentity = await generatedPathIdentity(worktreeTemporaryFiles[index]!)
      try {
        await FS.moveFileWithinBoundary(
          worktreeTemporaryFiles[index]!,
          desired.targetPath,
          repositoryRoot,
          publicationHooks,
        )
      } catch (error) {
        if (await generatedPathIdentity(desired.targetPath) === expectedIdentity) {
          committedChanges.push(generatedPublicationChange(desired.targetPath, backups, expectedIdentity))
        }
        throw error
      }
      committedChanges.push(generatedPublicationChange(desired.targetPath, backups, expectedIdentity))
    }
    for (const stalePath of plan.staleFiles) {
      try {
        await FS.removeFileWithinBoundary(stalePath, repositoryRoot, publicationHooks)
      } catch (error) {
        if (await generatedPathIdentity(stalePath) === 'missing') {
          committedChanges.push(generatedPublicationChange(stalePath, backups, 'missing'))
        }
        throw error
      }
      committedChanges.push(generatedPublicationChange(stalePath, backups, 'missing'))
    }
  } catch (error) {
    primaryError = error
    if (commitStarted) {
      const rollbackIssues = await rollbackGeneratedPublication(
        committedChanges,
        worktreeTemporaryFiles,
        repositoryRoot,
        publicationHooks,
      )
      if (rollbackIssues.length > 0) {
        primaryError = combinedFailure(error, 'rollbackIssues', rollbackIssues)
      }
    }
  }
  const cleanupIssues: unknown[] = []
  try {
    await options.beforeCleanup?.()
  } catch (error) {
    cleanupIssues.push(error)
  }
  await removeExistingFiles(worktreeTemporaryFiles, repositoryRoot, cleanupIssues)
  try {
    await FS.remove(transactionRoot)
  } catch (error) {
    cleanupIssues.push(error)
  }
  if (primaryError !== undefined) {
    if (cleanupIssues.length > 0) {
      throw combinedFailure(primaryError, 'stagingCleanupIssues', cleanupIssues.map(Errors.messageOf))
    }
    throw primaryError
  }
  if (cleanupIssues.length > 0) {
    throw combinedFailure(cleanupIssues[0], 'additionalCleanupIssues', cleanupIssues.slice(1).map(Errors.messageOf))
  }
}

async function validatePublicationPrecommit(
  plan: GeneratedPublicationPlan,
  parserRoot: string,
  repositoryRoot: string,
  originalIdentity: string,
  expectedInputs: string,
): Promise<void> {
  if (await parserGenerateInputHash(parserRoot) !== expectedInputs) {
    Errors.throwUnexpected('Parser generation inputs changed before publication; refusing stale generated output.')
  }
  for (const outputPath of plan.outputPaths) {
    await assertNoSymbolicLinkComponents(repositoryRoot, outputPath, 'parser output')
  }
  for (const directory of plan.desiredDirectories) {
    if (await FS.isFile(directory) || await FS.isSymbolicLink(directory)) {
      Errors.throwUnexpected(`Parser generation output shape changed before publication: ${directory}`)
    }
  }
  for (const desired of plan.desiredFiles) {
    if (await FS.isDirectory(desired.targetPath) || await FS.isSymbolicLink(desired.targetPath)) {
      Errors.throwUnexpected(`Parser generation output shape changed before publication: ${desired.targetPath}`)
    }
  }
  const currentFiles = new Set<string>()
  for (const outputPath of await declaredOutputPaths(parserRoot)) {
    await collectOriginalOutput(outputPath, currentFiles)
  }
  const currentIdentity = await FS.filesIdentity(
    [...currentFiles].map(path => [FS.relativePath(repositoryRoot, path), path]),
  )
  if (currentIdentity !== originalIdentity) {
    Errors.throwUnexpected(
      'Parser generation outputs changed before publication; refusing to overwrite concurrent work.',
    )
  }
}

/** generatedPublicationPlan rejects shape and symlink hazards before collecting any publication work. */
async function generatedPublicationPlan(
  stagingParserRoot: string,
  stagingRepositoryRoot: string,
  parserRoot: string,
  repositoryRoot: string,
): Promise<GeneratedPublicationPlan> {
  const stagedOutputs = await declaredOutputPaths(stagingParserRoot)
  const outputs = await declaredOutputPaths(parserRoot)
  if (stagedOutputs.length !== outputs.length) {
    Errors.throwUnexpected('Parser generation staging changed the declared output count.')
  }

  const desiredDirectories = new Set<string>()
  const desiredFiles = new Map<string, string>()
  const originalFiles = new Set<string>()
  for (let index = 0; index < outputs.length; index += 1) {
    const stagedPath = stagedOutputs[index]!
    const outputPath = outputs[index]!
    await assertNoSymbolicLinkComponents(stagingRepositoryRoot, stagedPath, 'staged parser output')
    await assertNoSymbolicLinkComponents(repositoryRoot, outputPath, 'parser output')
    await collectDesiredOutput(stagedPath, outputPath, desiredDirectories, desiredFiles)
    await collectOriginalOutput(outputPath, originalFiles)
  }

  for (const directory of desiredDirectories) {
    if (originalFiles.has(directory)) {
      Errors.throwUnexpected(`Parser generation cannot replace a file with a directory: ${directory}`)
    }
  }
  for (const targetPath of desiredFiles.keys()) {
    if (await FS.isDirectory(targetPath)) {
      Errors.throwUnexpected(`Parser generation cannot replace a directory with a file: ${targetPath}`)
    }
  }

  return {
    desiredDirectories: [...desiredDirectories].sort((left, right) => left.length - right.length),
    desiredFiles: [...desiredFiles].sort(([left], [right]) => left.localeCompare(right)).map(
      ([targetPath, sourcePath]) => ({ sourcePath, targetPath }),
    ),
    originalFiles: [...originalFiles].sort(),
    outputPaths: outputs,
    staleFiles: [...originalFiles].filter(path => !desiredFiles.has(path)).sort(),
  }
}

async function collectDesiredOutput(
  stagedPath: string,
  outputPath: string,
  directories: Set<string>,
  files: Map<string, string>,
): Promise<void> {
  if (await FS.isSymbolicLink(stagedPath)) {
    Errors.throwUnexpected(`Parser generation staged output contains a symbolic link: ${stagedPath}`)
  }
  if (await FS.isFile(stagedPath)) {
    files.set(outputPath, stagedPath)
    return
  }
  if (!await FS.isDirectory(stagedPath)) {
    Errors.throwUnexpected(`Parser generation did not produce its declared output: ${stagedPath}`)
  }
  directories.add(outputPath)
  for await (const stagedEntry of FS.walk(stagedPath, { includeDirectories: true, includeHidden: true })) {
    if (await FS.isSymbolicLink(stagedEntry)) {
      Errors.throwUnexpected(`Parser generation staged output contains a symbolic link: ${stagedEntry}`)
    }
    const outputEntry = FS.resolvePath(FS.relativePath(stagedPath, stagedEntry), outputPath)
    if (await FS.isDirectory(stagedEntry)) {
      directories.add(outputEntry)
    } else if (await FS.isFile(stagedEntry)) {
      files.set(outputEntry, stagedEntry)
    } else {
      Errors.throwUnexpected(`Parser generation staged output has an unsupported file type: ${stagedEntry}`)
    }
  }
}

async function collectOriginalOutput(outputPath: string, files: Set<string>): Promise<void> {
  if (await FS.isSymbolicLink(outputPath)) {
    Errors.throwUnexpected(`Parser generation output contains a symbolic link: ${outputPath}`)
  }
  if (await FS.isFile(outputPath)) {
    files.add(outputPath)
    return
  }
  if (!await FS.exists(outputPath)) {
    return
  }
  if (!await FS.isDirectory(outputPath)) {
    Errors.throwUnexpected(`Parser generation output has an unsupported file type: ${outputPath}`)
  }
  for await (const outputEntry of FS.walk(outputPath, { includeDirectories: true, includeHidden: true })) {
    if (await FS.isSymbolicLink(outputEntry)) {
      Errors.throwUnexpected(`Parser generation output contains a symbolic link: ${outputEntry}`)
    }
    if (await FS.isFile(outputEntry)) {
      files.add(outputEntry)
    } else if (!await FS.isDirectory(outputEntry)) {
      Errors.throwUnexpected(`Parser generation output has an unsupported file type: ${outputEntry}`)
    }
  }
}

/** assertNoSymbolicLinkComponents prevents an output root from escaping through a symlink ancestor. */
async function assertNoSymbolicLinkComponents(boundary: string, path: string, label: string): Promise<void> {
  if (!FS.pathIsWithin(path, boundary)) {
    Errors.throwUnexpected(`The ${label} escapes its repository root: ${path}`)
  }
  if (await FS.isSymbolicLink(boundary)) {
    Errors.throwUnexpected(`The ${label} repository root is a symbolic link: ${boundary}`)
  }
  let currentPath = boundary
  for (const component of FS.relativePath(boundary, path).split('/').filter(Boolean)) {
    currentPath = FS.resolvePath(component, currentPath)
    if (await FS.isSymbolicLink(currentPath)) {
      Errors.throwUnexpected(`The ${label} crosses a symbolic link: ${currentPath}`)
    }
  }
}

type GeneratedPublicationChange = {
  backupPath?: string
  expectedIdentity: string
  path: string
}

function generatedPublicationChange(
  path: string,
  backups: ReadonlyMap<string, string>,
  expectedIdentity: string,
): GeneratedPublicationChange {
  const backupPath = backups.get(path)
  return { ...(backupPath === undefined ? {} : { backupPath }), expectedIdentity, path }
}

/** rollbackGeneratedPublication restores only bytes still owned by the failed publication. */
async function rollbackGeneratedPublication(
  changes: readonly GeneratedPublicationChange[],
  siblingTemporaryFiles: string[],
  repositoryRoot: string,
  hooks: ParserGenerateFileHooks,
): Promise<unknown[]> {
  const issues: unknown[] = []
  for (const [index, change] of [...changes].reverse().entries()) {
    try {
      const currentIdentity = await generatedPathIdentity(change.path)
      if (currentIdentity !== change.expectedIdentity) {
        issues.push(
          `Rollback preserved a concurrent write at ${change.path}; expected ${change.expectedIdentity}, found ${currentIdentity}.`,
        )
        continue
      }
      if (change.backupPath === undefined) {
        if (currentIdentity !== 'missing') {
          await FS.removeFileWithinBoundary(change.path, repositoryRoot, hooks)
        }
        continue
      }
      const temporaryPath = FS.resolvePath(`parser-rollback-${randomUUID()}-${index}.tmp`, FS.dirname(change.path))
      siblingTemporaryFiles.push(temporaryPath)
      await FS.copyFile(change.backupPath, temporaryPath)
      await FS.moveFileWithinBoundary(temporaryPath, change.path, repositoryRoot, hooks)
    } catch (error) {
      issues.push(error)
    }
  }
  return issues
}

async function removeExistingFiles(
  paths: readonly string[],
  repositoryRoot: string,
  issues: unknown[],
): Promise<void> {
  for (const path of paths) {
    try {
      if (await FS.isFile(path)) {
        await FS.removeFileWithinBoundary(path, repositoryRoot)
      }
    } catch (error) {
      issues.push(error)
    }
  }
}

async function generatedPathIdentity(path: string): Promise<string> {
  if (!await FS.exists(path)) {
    return 'missing'
  }
  if (await FS.isSymbolicLink(path)) {
    return 'symbolic-link'
  }
  if (await FS.isDirectory(path)) {
    return 'directory'
  }
  return `file:${fileBytesIdentity(await FS.readFile(path))}`
}

function combinedFailure(primary: unknown, detailName: string, secondary: unknown): Error {
  return new Errors.UnexpectedBehaviorError(Errors.messageOf(primary), {
    cause: primary,
    details: { [detailName]: secondary },
  })
}

/**
 * parserGenerateInputHash hashes everything the generator reads: its configuration, every grammar
 * file, and the generator's own version. Content is hashed rather than modification times, so a
 * checkout, a worktree copy, or a reverted edit does not force a regeneration.
 */
export async function parserGenerateInputHash(parserRoot: string): Promise<string> {
  const grammars = await FS.filesIdentity(
    (await grammarInputPaths(parserRoot)).map(path => [FS.relativePath(parserRoot, path), path]),
  )
  return FS.contentIdentity([`langium-cli@${await langiumGeneratorVersion(parserRoot)}`, grammars])
}

/**
 * parserGenerateIsUpToDate answers whether Langium can be skipped. The stamp alone is not enough:
 * a generated file that was deleted or cleaned away has to be rebuilt whatever the inputs say.
 */
async function parserGenerateIsUpToDate(
  parserRoot: string,
  repositoryRoot: string,
  stampPath: string,
  inputs: string,
): Promise<boolean> {
  const stamp = await readParserGenerateStamp(stampPath)
  if (stamp === undefined || stamp.version !== STAMP_VERSION || stamp.inputs !== inputs) {
    return false
  }
  for (const declared of await declaredOutputPaths(parserRoot)) {
    if (!await FS.exists(declared)) {
      return false
    }
  }
  for (const generated of stamp.outputs) {
    if (!await FS.isFile(FS.resolvePath(generated, repositoryRoot))) {
      return false
    }
  }
  // Existence is not enough: an interrupted tool or manual edit can corrupt generated parser
  // output without changing its inputs. Hash only generator-owned output inside the parser package;
  // downstream builds deliberately post-process external products such as the IDE grammar.
  if (await parserGenerateOutputHash(parserRoot) !== stamp.outputsHash) {
    return false
  }
  return stamp.outputs.length > 0
}

/** parserGenerateOutputHash hashes the generated files themselves, in a stable order. */
export async function parserGenerateOutputHash(parserRoot: string): Promise<string> {
  return FS.filesIdentity(
    (await generatedFilePaths(parserRoot))
      .filter(path => FS.pathIsWithin(path, parserRoot))
      .map(path => [FS.relativePath(parserRoot, path), path]),
  )
}

/** grammarInputPaths lists the configuration and grammar files, in a stable order. */
async function grammarInputPaths(parserRoot: string): Promise<string[]> {
  const grammarRoot = FS.resolvePath('parser-grammar', parserRoot)
  const grammarFiles: string[] = []
  if (await FS.isDirectory(grammarRoot)) {
    for await (const path of FS.walk(grammarRoot, { extensions: ['.langium'] })) {
      grammarFiles.push(path)
    }
  }
  return [FS.resolvePath(LANGIUM_CONFIG, parserRoot), ...grammarFiles.sort()]
}

/**
 * declaredOutputPaths lists what the configuration tells Langium to write. Every generator target
 * declares its destination under an `out` key, so collecting them keeps the parser directory and
 * the TextMate grammar — and any target added later — in the staleness decision by construction.
 */
async function declaredOutputPaths(parserRoot: string): Promise<string[]> {
  const config = await FS.readJson(FS.resolvePath(LANGIUM_CONFIG, parserRoot))
  return collectDeclaredOut(config).map(path => FS.resolvePath(path, parserRoot)).sort()
}

/** collectDeclaredOut walks the configuration for every `out` destination it declares. */
function collectDeclaredOut(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectDeclaredOut)
  }
  if (value === null || typeof value !== 'object') {
    return []
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'out' && typeof entry === 'string' ? [entry] : collectDeclaredOut(entry)
  )
}

/** generatedFilePaths lists the files that now exist at the declared destinations. */
async function generatedFilePaths(parserRoot: string): Promise<string[]> {
  const files: string[] = []
  for (const declared of await declaredOutputPaths(parserRoot)) {
    if (await FS.isDirectory(declared)) {
      for await (const path of FS.walk(declared)) {
        files.push(path)
      }
    } else if (await FS.isFile(declared)) {
      files.push(declared)
    }
  }
  return files.sort()
}

/** readParserGenerateStamp reads the stamp, treating a missing or malformed one as no stamp. */
async function readParserGenerateStamp(stampPath: string): Promise<ParserGenerateStamp | undefined> {
  try {
    const value = await FS.readJson<Partial<ParserGenerateStamp>>(stampPath)
    if (
      typeof value?.inputs !== 'string'
      || typeof value.version !== 'number'
      || typeof value.outputsHash !== 'string'
      || !Array.isArray(value.outputs)
    ) {
      return undefined
    }
    return {
      inputs: value.inputs,
      outputs: value.outputs.filter(entry => typeof entry === 'string'),
      outputsHash: value.outputsHash,
      version: value.version,
    }
  } catch {
    return undefined
  }
}

/**
 * writeParserGenerateStamp publishes the stamp with a rename, so a reader never sees a half-written
 * file. It runs only after a clean generation: a failed or diagnostic-rejected run leaves the old
 * stamp in place and the next run repeats the work rather than inheriting the failure.
 */
async function writeParserGenerateStamp(
  stampPath: string,
  stamp: ParserGenerateStamp,
  repositoryRoot: string,
  hooks: ParserGenerateFileHooks,
): Promise<void> {
  const temporaryPath = `${stampPath}.${randomUUID()}.tmp`
  let primaryError: unknown
  try {
    await FS.writeJson(temporaryPath, stamp)
    await FS.moveFileWithinBoundary(temporaryPath, stampPath, repositoryRoot, hooks)
  } catch (error) {
    primaryError = error
  }
  let cleanupError: unknown
  try {
    if (await FS.isFile(temporaryPath)) {
      await FS.removeFileWithinBoundary(temporaryPath, repositoryRoot)
    }
  } catch (error) {
    cleanupError = error
  }
  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      throw combinedFailure(primaryError, 'stampCleanupError', Errors.messageOf(cleanupError))
    }
    throw primaryError
  }
  if (cleanupError !== undefined) {
    throw cleanupError
  }
}

/** langiumGeneratorVersion names the generator, so upgrading it invalidates the stamp. */
async function langiumGeneratorVersion(parserRoot: string): Promise<string> {
  const manifest = FS.resolvePath('node_modules/langium-cli/package.json', parserRoot)
  try {
    return String((await FS.readJson<{ version?: unknown }>(manifest)).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

/**
 * fileBytesIdentity reduces one file's bytes to a digest. `FS.contentIdentity` cannot serve here
 * because it identifies ordered strings, and what is being identified is the file's bytes.
 */
function fileBytesIdentity(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/** readGrammarSources loads the grammar files a diagnostic can name, keyed as Langium reports them. */
async function readGrammarSources(parserRoot: string): Promise<Record<string, string>> {
  const sources: Record<string, string> = {}
  for (const entry of ACCEPTED_DIAGNOSTICS) {
    const path = FS.resolvePath(entry.file, parserRoot)
    if (await FS.isFile(path)) {
      sources[entry.file] = await FS.readText(path)
    }
  }
  return sources
}

if (import.meta.main) {
  Platform.runtimeProcess.setExitCode(await runParserGenerate())
}
