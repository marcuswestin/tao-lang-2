import { Packages } from '@ast-utils'
import Workspace from '@compiler/workspace'
import Formatter, { type FormatAttempt, type FormatterSession } from '@formatter'
import { ensureProjectTypeScriptConfig, ProjectTooling } from '@project-tooling'
import { Diagnostic, Diagnostics, FS } from '@shared'
import SourceActions from '@source-actions'
import { TaoAppModules } from './app-modules'
import { CheckCache, type CheckCacheDiagnostic, type CheckCacheOptions } from './check-cache'
import { type InPlace, inPlace } from './in-place-files'
import { findTaoFiles } from './tao-files'

type CanonicalSourceOptions = CheckOptions & {
  /** validate runs semantic validation and reports its errors and warnings alongside canonicalization. */
  validate?: boolean
  write: boolean
}

/** CheckOptions configures `tao check`; `cache` is the seam tests use to place the stamp. */
export type CheckOptions = InPlace.PathOptions & {
  cache?: CheckCacheOptions
  /**
   * Reports how each workspace was resolved, in partition order. Whether a workspace was checked or
   * replayed changes nothing a caller sees in the results, which is exactly why it needs saying out
   * loud somewhere a test can read it.
   */
  onWorkspace?: (outcome: CheckWorkspaceOutcome) => void
}

/** CheckWorkspaceOutcome says whether one workspace was checked from source or replayed from the stamp. */
export type CheckWorkspaceOutcome = {
  resolution: 'checked' | 'replayed'
  workspaceRoot: string
}

type OwnedTaoFile = Readonly<{
  path: string
  workspaceRoot: string
}>

/** Partition is one workspace's share of a canonical-source pass. */
type Partition = {
  entryFiles: string[]
  /** The recorded warnings a warm stamp replayed, or undefined when this workspace was checked. */
  replayed?: readonly CheckCacheDiagnostic[]
  /**
   * Each file's parse from the one build its workspace was given, by path. It is dropped the moment
   * any file of the workspace is found changed or is parsed again, because either rebuilds or
   * outdates the documents the rest were linked against.
   */
  parsed?: Map<string, ParsedFile>
}

/** ParsedFile is one entry file's parse: the entry and the graph it reaches. */
type ParsedFile = Awaited<ReturnType<Workspace['parse']>>

/** runCheck checks canonical source and reports syntax and validation diagnostics without writing. */
export async function runCheck(path: string, options: CheckOptions = {}): Promise<InPlace.Result[]> {
  return await runCanonicalSource(path, { ...options, validate: true, write: false })
}

/** runFix canonicalizes every .tao file at or under `path` in place: renders last, organized imports, formatted. */
export async function runFix(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
  return await runCanonicalSource(path, { ...options, write: true })
}

/** runFmt formats every .tao file at or under `path` in place and returns per-file results. */
export async function runFmt(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
  const root = FS.resolvePath(path, options.cwd)
  const files = await ownedTaoFiles(root, options)
  // One formatter session serves the whole run instead of building parser services per file.
  const session = Formatter.createSession()
  const results: InPlace.Result[] = []
  for (const file of files) {
    results.push(await formatFile(session, file))
  }
  return results
}

async function runCanonicalSource(path: string, options: CanonicalSourceOptions): Promise<InPlace.Result[]> {
  const root = FS.resolvePath(path, options.cwd)
  const files = await ownedTaoFiles(root, options)
  const partitions = new Map<string, Partition>()
  for (const file of files) {
    const existing = partitions.get(file.workspaceRoot)
    if (existing === undefined) {
      partitions.set(file.workspaceRoot, { entryFiles: [file.path] })
    } else {
      existing.entryFiles.push(file.path)
    }
  }
  // Only `check` consults the stamp. `fix` and `fmt` rewrite the files they read, and a pass that
  // writes has no verdict to hand the next run.
  const cache = options.validate === true && !options.write ? await CheckCache.open(options.cache) : undefined
  const diagnosticsByFile = new Map<string, readonly Diagnostic[]>()
  const workspaces = new Map<string, Workspace>()
  /**
   * The workspaces this run may stamp, against the warnings they reported. A workspace qualifies
   * only when `check` had nothing to report about any of its files beyond warnings: one file that is
   * not canonical, that could not be read at all, or that carries an error withdraws the whole
   * workspace and its next run checks from source again.
   *
   * Warnings are recorded and replayed rather than disqualifying, because they are `check`'s normal
   * output rather than a sign of trouble — this repository reports eighty of them across almost every
   * workspace, so a rule that refused to stamp a workspace with warnings would stamp nothing at all.
   * Errors are the opposite: a stamp that replayed them would keep reporting a failure the author may
   * already have fixed, and the exit code rides on them, so a workspace with any error is never
   * stamped and is always checked from source.
   */
  const cleared = new Map<string, {
    dependencyRoots: readonly string[]
    diagnostics: readonly CheckCacheDiagnostic[]
    externalSidecarInputPaths: readonly string[]
    metadataPaths: readonly string[]
  }>()
  for (const [workspaceRoot, partition] of partitions) {
    if (options.validate === true) {
      await ensureProjectTypeScriptConfig(workspaceRoot, { runtimeRoot: TaoAppModules.runtimeRoot() })
    }
    const replayed = await cache?.reuse(workspaceRoot, partition.entryFiles)
    if (replayed !== undefined) {
      partition.replayed = replayed.diagnostics
      options.onWorkspace?.({ resolution: 'replayed', workspaceRoot })
      mergeDiagnostics(diagnosticsByFile, replayedDiagnostics(workspaceRoot, replayed.diagnostics))
      continue
    }
    options.onWorkspace?.({ resolution: 'checked', workspaceRoot })
    const workspace = await Workspace.open(workspaceRoot)
    workspaces.set(workspaceRoot, workspace)
    const parsedFiles = await parseWorkspaceFiles(workspace, partition.entryFiles)
    partition.parsed = parsedFiles
    if (options.validate === true) {
      const refreshed = await ProjectTooling.refresh(workspaceRoot, { runtimeRoot: TaoAppModules.runtimeRoot() })
      const diagnostics = [...refreshed.diagnostics]
      mergeDiagnostics(diagnosticsByFile, indexDiagnostics(diagnostics))
      if (refreshed.status === 'fresh' && !Diagnostics.hasError(diagnostics)) {
        // Offered for stamping, and withdrawn below by any file this workspace cannot report clean.
        cleared.set(workspaceRoot, {
          dependencyRoots: refreshed.dependencyRoots,
          diagnostics: recordableWarnings(workspaceRoot, diagnostics),
          externalSidecarInputPaths: refreshed.externalSidecarInputPaths,
          metadataPaths: [
            ...refreshed.contractPaths,
            ...refreshed.configInputPaths,
            FS.resolvePath('tsconfig.json', workspaceRoot),
            FS.resolvePath('.tao/cache/typescript/tsconfig.json', workspaceRoot),
          ],
        })
      }
    }
  }

  const results: InPlace.Result[] = []
  for (const file of files) {
    const partition = partitions.get(file.workspaceRoot)
    if (partition === undefined) {
      continue
    }
    const diagnostics = diagnosticsByFile.get(file.path) ?? []
    if (partition.replayed !== undefined) {
      // A stamped workspace is one whose every file was canonical and error-free, so its files are
      // unchanged by construction; only the warnings it recorded vary.
      results.push({ path: file.path, status: 'unchanged', ...(diagnostics.length === 0 ? {} : { diagnostics }) })
      continue
    }
    const workspace = workspaces.get(file.workspaceRoot)
    if (workspace === undefined) {
      continue
    }
    const result = await canonicalizeFile(workspace, file.path, options.write, diagnostics, partition)
    if (result.status !== 'unchanged') {
      cleared.delete(file.workspaceRoot)
      // Whatever this file became, the build the rest of its workspace was parsed in no longer
      // describes it, so the files after it are parsed afresh the way they always were.
      delete partition.parsed
    }
    results.push(result)
  }

  if (options.validate === true) {
    const selected = new Set(files.map(file => file.path))
    for (const [path, diagnostics] of [...diagnosticsByFile].sort(([left], [right]) => left.localeCompare(right))) {
      if (!selected.has(path)) {
        results.push({ path, status: 'diagnostics', diagnostics })
      }
    }
  }

  if (cache !== undefined) {
    await cache.commit(
      [...cleared].map(([workspaceRoot, record]) => ({ ...record, workspaceRoot })),
    )
  }
  return results
}

/**
 * parseWorkspaceFiles parses a workspace's files with one build, keyed by path, or returns nothing
 * when the batch cannot be parsed together — one file that cannot be read fails the whole build, and
 * each file then reports for itself through its own parse.
 */
async function parseWorkspaceFiles(
  workspace: Workspace,
  entryFiles: readonly string[],
): Promise<Map<string, ParsedFile> | undefined> {
  try {
    return new Map((await workspace.parseFiles(entryFiles)).map(parsed => [parsed.entry.path, parsed]))
  } catch {
    return undefined
  }
}

/** mergeDiagnostics folds one workspace's indexed diagnostics into the run's map. */
function mergeDiagnostics(
  diagnosticsByFile: Map<string, readonly Diagnostic[]>,
  indexed: ReadonlyMap<string, readonly Diagnostic[]>,
): void {
  for (const [filePath, diagnostics] of indexed) {
    diagnosticsByFile.set(filePath, diagnostics)
  }
}

async function ownedTaoFiles(root: string, options: InPlace.PathOptions): Promise<OwnedTaoFile[]> {
  // Every file's walk to its project root passes through the ancestors its neighbours also walk, so
  // one sweep answers each directory once for the whole pass rather than once per file.
  const sweep = Packages.createProjectRootSweep()
  const fallbackRoot = await inPlace.workspaceRootForPath(root, options, sweep)
  return await Promise.all((await findTaoFiles(root)).map(async path => ({
    path,
    workspaceRoot: await inPlace.workspaceRootForPath(path, { cwd: fallbackRoot }, sweep),
  })))
}

/**
 * formatFile formats one file, or reports its syntax errors instead — the same two outcomes
 * `canonicalizeFile` gives `check` and `fix`, so `fmt` prints a positioned diagnostic for a file it
 * cannot parse rather than the formatter's internal invariant.
 */
async function formatFile(session: FormatterSession, file: OwnedTaoFile): Promise<InPlace.Result> {
  let attempt: FormatAttempt
  try {
    attempt = await session.tryFormatFile(file.path)
  } catch (error) {
    return inPlace.errorResult(file.path, error)
  }
  const { formatted } = attempt
  if (formatted === undefined) {
    const syntax = reportableSyntaxErrors(attempt.diagnostics, file.path)
    return {
      path: file.path,
      status: 'error',
      diagnostics: syntax.reported.length === 0 ? attempt.diagnostics : syntax.reported,
      unreportedDiagnostics: syntax.unreported,
    }
  }
  return await inPlace.processFile(
    file.path,
    async () => formatted,
    protectedWriteOptions(file.path, file.workspaceRoot, true),
  )
}

/**
 * canonicalizeFile canonicalizes one file, or reports its syntax errors instead. Source fixes and
 * formatting both require a parsed document, so a file that does not parse is reported from its own
 * lexer and parser diagnostics rather than through the assertion those transforms would raise.
 */
async function canonicalizeFile(
  workspace: Workspace,
  path: string,
  write: boolean,
  diagnostics: readonly Diagnostic[],
  partition: Partition,
): Promise<InPlace.Result> {
  let parsed: ParsedFile
  try {
    parsed = partition.parsed?.get(path) ?? await workspace.parse(path)
  } catch (error) {
    return inPlace.errorResult(path, error)
  }
  const syntax = reportableSyntaxErrors(parsed.diagnostics, path)
  if (syntax.reported.length > 0) {
    return { path, status: 'error', diagnostics: syntax.reported, unreportedDiagnostics: syntax.unreported }
  }
  const result = await inPlace.processFile(
    path,
    async () => {
      return await SourceActions.fixSource(parsed.entry.document, {
        parseUpdatedDocument: async (document, text) => {
          // Parsing the rewritten text rebuilds the workspace around this one file.
          delete partition.parsed
          return (await workspace.parseSource(text, document.uri)).entry.document
        },
      })
    },
    protectedWriteOptions(path, workspace.root, write),
  )
  return diagnostics.length === 0 ? result : { ...result, diagnostics }
}

/**
 * A file reports at most this many syntax errors at once. A misplaced token makes the parser
 * mis-read what follows, so the tail of a run is usually cascade rather than separate mistakes;
 * three is enough to show a reader that a second, unrelated mistake exists further down without
 * turning one broken file into a screen they have to scroll before they can start fixing it.
 */
const REPORTED_SYNTAX_ERRORS = 3

/** SyntaxErrorReport declares the syntax errors one file shows and how many it held back. */
type SyntaxErrorReport = {
  reported: Diagnostic[]
  unreported: number
}

/**
 * reportableSyntaxErrors returns the file's lexer and parser errors in source order, keeping the
 * first on each line. Cascade piles onto the token that first confused the parser — one stray word
 * produced three messages about the same word — so one line is one mistake as far as the reader is
 * concerned, and what survives that is a list of genuinely separate places to look.
 */
function reportableSyntaxErrors(diagnostics: readonly Diagnostic[], path: string): SyntaxErrorReport {
  const inFile = Diagnostics.errors(diagnostics, 'lexer', 'parser')
    .filter(diagnostic => diagnostic.filePath === path)
    .sort(bySourcePosition)
  // Compared through `lineOf` rather than on the raw line: an unplaced diagnostic must still match
  // itself, and `NaN === NaN` is false, which would drop every diagnostic on such a line instead.
  const firstPerLine = inFile.filter((diagnostic, index) =>
    inFile.findIndex(other => lineOf(other) === lineOf(diagnostic)) === index
  )
  return {
    reported: firstPerLine.slice(0, REPORTED_SYNTAX_ERRORS),
    unreported: Math.max(firstPerLine.length - REPORTED_SYNTAX_ERRORS, 0),
  }
}

/** bySourcePosition orders syntax errors the way a reader walks the file, with a rangeless one last. */
function bySourcePosition(left: Diagnostic, right: Diagnostic): number {
  if (lineOf(left) !== lineOf(right)) {
    return lineOf(left) - lineOf(right)
  }
  // A lexer error is a fact about the characters themselves, never a consequence of how the parser
  // read them, so it leads its line: a character Tao cannot read explains the parse that follows it.
  if (isLexerError(left) !== isLexerError(right)) {
    return isLexerError(left) ? -1 : 1
  }
  return (left.range?.start.character ?? 0) - (right.range?.start.character ?? 0)
}

/** lineOf returns the line a diagnostic points at, sorting one that is not placed to the end. */
function lineOf(diagnostic: Diagnostic): number {
  const line = diagnostic.range?.start.line
  return line === undefined || !Number.isFinite(line) ? Number.MAX_SAFE_INTEGER : line
}

/** isLexerError says whether a diagnostic came from the lexer rather than the parser. */
function isLexerError(diagnostic: Diagnostic): boolean {
  return Diagnostic.hasSource(diagnostic, 'lexer')
}

/** indexDiagnostics groups reportable diagnostics by the file they point into, keeping report order. */
function indexDiagnostics(diagnostics: readonly Diagnostic[]): ReadonlyMap<string, readonly Diagnostic[]> {
  const byFile = new Map<string, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.filePath === undefined || Diagnostic.isInformation(diagnostic) || Diagnostic.isHint(diagnostic)) {
      continue
    }
    const forFile = byFile.get(diagnostic.filePath) ?? []
    forFile.push(diagnostic)
    byFile.set(diagnostic.filePath, forFile)
  }
  return byFile
}

/**
 * replayedDiagnostics rebuilds a stamped workspace's warnings as ordinary diagnostics, so a warm run
 * renders them through exactly the path a cold one does. The stamp holds the position rather than a
 * printed sentence, because that sentence names the file relative to the working directory and a run
 * from elsewhere must print its own. Only warnings are ever stamped, so every one rebuilds as one.
 */
function replayedDiagnostics(
  workspaceRoot: string,
  diagnostics: readonly CheckCacheDiagnostic[],
): ReadonlyMap<string, readonly Diagnostic[]> {
  const byFile = new Map<string, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    const filePath = FS.resolvePath(diagnostic.path, workspaceRoot)
    const forFile = byFile.get(filePath) ?? []
    forFile.push({
      filePath,
      message: diagnostic.message,
      severity: 'warning',
      source: 'validator',
      ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
      ...(diagnostic.nodeType === undefined ? {} : { nodeType: diagnostic.nodeType }),
      ...(diagnostic.character === undefined || diagnostic.line === undefined ? {} : {
        range: {
          start: { character: diagnostic.character, line: diagnostic.line },
          end: {
            character: diagnostic.endCharacter ?? diagnostic.character,
            line: diagnostic.endLine ?? diagnostic.line,
          },
        },
      }),
    })
    byFile.set(filePath, forFile)
  }
  return byFile
}

/** recordableWarnings reduces a checked workspace's warnings to what a stamp can replay. */
function recordableWarnings(
  workspaceRoot: string,
  diagnostics: readonly Diagnostic[],
): readonly CheckCacheDiagnostic[] {
  return Diagnostics.warnings(diagnostics).flatMap(diagnostic =>
    diagnostic.filePath === undefined ? [] : [{
      ...(diagnostic.range === undefined ? {} : {
        character: diagnostic.range.start.character,
        endCharacter: diagnostic.range.end.character,
        endLine: diagnostic.range.end.line,
        line: diagnostic.range.start.line,
      }),
      ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
      ...(diagnostic.nodeType === undefined ? {} : { nodeType: diagnostic.nodeType }),
      message: diagnostic.message,
      path: FS.relativePath(workspaceRoot, diagnostic.filePath),
    }]
  )
}

function protectedWriteOptions(path: string, workspaceRoot: string, requestedWrite: boolean): InPlace.ProcessOptions {
  const generated = inPlace.generatedRootPackageFile(path, workspaceRoot)
  return {
    ...(requestedWrite && generated
      ? { changedIsError: 'Generated source under @/ is not canonical; regenerate it instead of rewriting it.' }
      : {}),
    write: requestedWrite && !generated,
  }
}
