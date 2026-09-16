import { CLI, FS, HCI, Platform, Repo } from '@shared'
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
  generate?: (parserRoot: string, repositoryRoot: string) => Promise<ParserGenerateOutcome>
  repositoryRoot?: string
}

/** runParserGenerate regenerates the parser and fails on any diagnostic that is not documented. */
export async function runParserGenerate(options: ParserGenerateOptions = {}): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const generate = options.generate ?? runLangiumGenerate
  const parserRoot = FS.resolvePath('packages/parser', repositoryRoot)
  const stampPath = FS.resolvePath(STAMP_PATH, repositoryRoot)
  const inputs = await parserGenerateInputHash(parserRoot)
  if (await parserGenerateIsUpToDate(parserRoot, repositoryRoot, stampPath, inputs)) {
    HCI.writeLine('parser generate: up to date')
    return 0
  }

  const result = await generate(parserRoot, repositoryRoot)
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
        + 'packages/dev/dev-src/repository-tests/ParserGenerate.ts if the generator is wrong about it.',
    )
    return 1
  }

  await writeParserGenerateStamp(stampPath, {
    inputs,
    outputs: (await generatedFilePaths(parserRoot)).map(path => FS.relativePath(repositoryRoot, path)),
    outputsHash: await parserGenerateOutputHash(parserRoot),
    version: STAMP_VERSION,
  })
  return 0
}

/** runLangiumGenerate invokes the Langium CLI from the parser package, capturing what it printed. */
async function runLangiumGenerate(parserRoot: string, repositoryRoot: string): Promise<ParserGenerateOutcome> {
  const node = FS.resolvePath('.devenv/profile/bin/node', repositoryRoot)
  const result = await CLI.run(await FS.isFile(node) ? node : 'node', {
    args: ['node_modules/langium-cli/bin/langium.js', 'generate'],
    cwd: parserRoot,
    stdio: 'pipe',
  })
  return { error: result.error, exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` }
}

/**
 * parserGenerateInputHash hashes everything the generator reads: its configuration, every grammar
 * file, and the generator's own version. Content is hashed rather than modification times, so a
 * checkout, a worktree copy, or a reverted edit does not force a regeneration.
 */
export async function parserGenerateInputHash(parserRoot: string): Promise<string> {
  const entries: string[] = [`langium-cli@${await langiumGeneratorVersion(parserRoot)}`]
  for (const path of await grammarInputPaths(parserRoot)) {
    entries.push(`${FS.relativePath(parserRoot, path)}\n${hashContent(await FS.readFile(path))}`)
  }
  return hashContent(entries.join('\n'))
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
  const entries: string[] = []
  for (const path of (await generatedFilePaths(parserRoot)).filter(path => FS.pathIsWithin(path, parserRoot))) {
    entries.push(`${FS.relativePath(parserRoot, path)}\n${hashContent(await FS.readFile(path))}`)
  }
  return hashContent(entries.join('\n'))
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
async function writeParserGenerateStamp(stampPath: string, stamp: ParserGenerateStamp): Promise<void> {
  const temporaryPath = `${stampPath}.${randomUUID()}.tmp`
  try {
    await FS.writeJson(temporaryPath, stamp)
    await FS.move(temporaryPath, stampPath)
  } finally {
    await FS.remove(temporaryPath)
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

/** hashContent reduces file content to a digest the stamp can compare. */
function hashContent(content: string | Uint8Array): string {
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
