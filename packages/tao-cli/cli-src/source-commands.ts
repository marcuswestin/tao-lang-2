import { Packages } from '@ast-utils'
import Formatter, { type FormatterSession } from '@formatter'
import { Diagnostic, Diagnostics, FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
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
}

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
  const cleared = new Map<string, readonly CheckCacheDiagnostic[]>()
  for (const [workspaceRoot, partition] of partitions) {
    const replayed = await cache?.reuse(workspaceRoot, partition.entryFiles)
    if (replayed !== undefined) {
      partition.replayed = replayed
      options.onWorkspace?.({ resolution: 'replayed', workspaceRoot })
      mergeDiagnostics(diagnosticsByFile, replayedDiagnostics(workspaceRoot, replayed))
      continue
    }
    options.onWorkspace?.({ resolution: 'checked', workspaceRoot })
    const workspace = await Workspace.open(workspaceRoot)
    workspaces.set(workspaceRoot, workspace)
    if (options.validate === true) {
      const diagnostics = (await workspace.validateFiles(partition.entryFiles)).diagnostics
      mergeDiagnostics(diagnosticsByFile, indexDiagnostics(diagnostics))
      if (!Diagnostics.hasError(diagnostics)) {
        // Offered for stamping, and withdrawn below by any file this workspace cannot report clean.
        cleared.set(workspaceRoot, recordableWarnings(workspaceRoot, diagnostics))
      }
    }
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
    const result = await canonicalizeFile(workspace, file.path, options.write, diagnostics)
    if (result.status !== 'unchanged') {
      cleared.delete(file.workspaceRoot)
    }
    results.push(result)
  }

  if (cache !== undefined) {
    await cache.commit(
      [...cleared].map(([workspaceRoot, diagnostics]) => ({ diagnostics, workspaceRoot })),
    )
  }
  return results
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

async function formatFile(session: FormatterSession, file: OwnedTaoFile): Promise<InPlace.Result> {
  return await inPlace.processFile(
    file.path,
    () => session.formatFile(file.path),
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
): Promise<InPlace.Result> {
  let parsed: Awaited<ReturnType<Workspace['parse']>>
  try {
    parsed = await workspace.parse(path)
  } catch (error) {
    return inPlace.errorResult(path, error)
  }
  const syntaxError = firstSyntaxError(parsed.diagnostics, path)
  if (syntaxError !== undefined) {
    return { path, status: 'error', diagnostics: [syntaxError] }
  }
  const result = await inPlace.processFile(
    path,
    async () => {
      return await SourceActions.fixSource(parsed.entry.document, {
        parseUpdatedDocument: async (document, text) => {
          return (await workspace.parseSource(text, document.uri)).entry.document
        },
      })
    },
    protectedWriteOptions(path, workspace.root, write),
  )
  return diagnostics.length === 0 ? result : { ...result, diagnostics }
}

/**
 * firstSyntaxError returns the file's first lexer or parser error. Only the first is reported: a
 * single misplaced token makes the parser mis-read everything after it, so the rest of the run is
 * cascade rather than a list of separate mistakes.
 */
function firstSyntaxError(diagnostics: readonly Diagnostic[], path: string): Diagnostic | undefined {
  return Diagnostics.errors(diagnostics, 'lexer', 'parser').find(diagnostic => diagnostic.filePath === path)
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
      ...(diagnostic.character === undefined || diagnostic.line === undefined ? {} : {
        range: {
          start: { character: diagnostic.character, line: diagnostic.line },
          end: { character: diagnostic.character, line: diagnostic.line },
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
      ...(diagnostic.range === undefined
        ? {}
        : { character: diagnostic.range.start.character, line: diagnostic.range.start.line }),
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
