import { Packages } from '@ast-utils'
import Formatter, { type FormatterSession } from '@formatter'
import { type Diagnostic, Diagnostics, FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
import { CheckCache, type CheckCacheDiagnostic, type CheckCacheOptions } from './check-cache'
import { type InPlace, inPlace } from './in-place-files'
import { findTaoFiles } from './tao-files'

type CanonicalSourceOptions = CheckOptions & {
  reportWarnings?: boolean
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

/** CheckWarningLocation is the part of a diagnostic a check warning sentence is built from. */
type CheckWarningLocation = {
  filePath?: string
  message: string
  range?: { start: { character: number; line: number } }
}

/** Partition is one workspace's share of a canonical-source pass. */
type Partition = {
  entryFiles: string[]
  /** The recorded warnings a warm stamp replayed, or undefined when this workspace was checked. */
  replayed?: readonly CheckCacheDiagnostic[]
}

/** runCheck checks canonical source and reports validation warnings without writing. */
export async function runCheck(path: string, options: CheckOptions = {}): Promise<InPlace.Result[]> {
  return await runCanonicalSource(path, { ...options, reportWarnings: true, write: false })
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
  const cache = options.reportWarnings === true && !options.write ? await CheckCache.open(options.cache) : undefined
  const warningsByFile = new Map<string, readonly string[]>()
  const workspaces = new Map<string, Workspace>()
  /**
   * The workspaces this run may stamp, against the warnings they reported. A workspace qualifies
   * only when `check` had nothing to report about any of its files beyond warnings: one file that is
   * not canonical, or that could not be read at all, withdraws the whole workspace and its next run
   * checks from source again.
   *
   * Warnings are recorded and replayed rather than disqualifying, because they are `check`'s normal
   * output rather than a sign of trouble — this repository reports eighty of them across almost every
   * workspace, so a rule that refused to stamp a workspace with warnings would stamp nothing at all.
   * Replaying them is what keeps a warm run's output identical to a cold one's, word for word.
   */
  const cleared = new Map<string, readonly CheckCacheDiagnostic[]>()
  for (const [workspaceRoot, partition] of partitions) {
    const replayed = await cache?.reuse(workspaceRoot, partition.entryFiles)
    if (replayed !== undefined) {
      partition.replayed = replayed
      options.onWorkspace?.({ resolution: 'replayed', workspaceRoot })
      mergeWarnings(warningsByFile, replayedWarnings(workspaceRoot, replayed))
      continue
    }
    options.onWorkspace?.({ resolution: 'checked', workspaceRoot })
    const workspace = await Workspace.open(workspaceRoot)
    workspaces.set(workspaceRoot, workspace)
    if (options.reportWarnings === true) {
      const diagnostics = (await workspace.validateFiles(partition.entryFiles)).diagnostics
      mergeWarnings(warningsByFile, indexWarnings(diagnostics))
      // Offered for stamping, and withdrawn below by any file this workspace cannot report clean.
      cleared.set(workspaceRoot, recordableWarnings(workspaceRoot, diagnostics))
    }
  }

  const results: InPlace.Result[] = []
  for (const file of files) {
    const partition = partitions.get(file.workspaceRoot)
    if (partition === undefined) {
      continue
    }
    const warnings = warningsByFile.get(file.path) ?? []
    if (partition.replayed !== undefined) {
      // A stamped workspace is one whose every file was canonical, so its files are unchanged by
      // construction; only the warnings it recorded vary.
      results.push({ path: file.path, status: 'unchanged', ...(warnings.length === 0 ? {} : { warnings }) })
      continue
    }
    const workspace = workspaces.get(file.workspaceRoot)
    if (workspace === undefined) {
      continue
    }
    const result = await canonicalizeFile(workspace, file.path, options.write, warnings)
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

/** mergeWarnings folds one workspace's indexed warnings into the run's map. */
function mergeWarnings(
  warningsByFile: Map<string, readonly string[]>,
  indexed: ReadonlyMap<string, readonly string[]>,
): void {
  for (const [filePath, messages] of indexed) {
    warningsByFile.set(filePath, messages)
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

async function canonicalizeFile(
  workspace: Workspace,
  path: string,
  write: boolean,
  warnings: readonly string[],
): Promise<InPlace.Result> {
  const result = await inPlace.processFile(
    path,
    async () => {
      const parsed = await workspace.parse(path)
      return await SourceActions.fixSource(parsed.entry.document, {
        parseUpdatedDocument: async (document, text) => {
          return (await workspace.parseSource(text, document.uri)).entry.document
        },
      })
    },
    protectedWriteOptions(path, workspace.root, write),
  )
  return warnings.length === 0 ? result : { ...result, warnings }
}

function indexWarnings(diagnostics: readonly Diagnostic[]): ReadonlyMap<string, readonly string[]> {
  const byFile = new Map<string, string[]>()
  for (const diagnostic of Diagnostics.warnings(diagnostics)) {
    if (diagnostic.filePath === undefined) {
      continue
    }
    const warnings = byFile.get(diagnostic.filePath) ?? []
    warnings.push(formatCheckWarning(diagnostic))
    byFile.set(diagnostic.filePath, warnings)
  }
  return byFile
}

/**
 * replayedWarnings rebuilds a stamped workspace's warnings through the same formatter a checked one
 * uses. The stamp holds the position rather than the printed sentence, because that sentence names
 * the file relative to the working directory and a run from elsewhere must print its own.
 */
function replayedWarnings(
  workspaceRoot: string,
  diagnostics: readonly CheckCacheDiagnostic[],
): ReadonlyMap<string, readonly string[]> {
  const byFile = new Map<string, string[]>()
  for (const diagnostic of diagnostics) {
    const filePath = FS.resolvePath(diagnostic.path, workspaceRoot)
    const warnings = byFile.get(filePath) ?? []
    warnings.push(formatCheckWarning({
      filePath,
      message: diagnostic.message,
      ...(diagnostic.character === undefined || diagnostic.line === undefined
        ? {}
        : { range: { start: { character: diagnostic.character, line: diagnostic.line } } }),
    }))
    byFile.set(filePath, warnings)
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

function formatCheckWarning(diagnostic: CheckWarningLocation): string {
  const location = diagnostic.range === undefined
    ? FS.displayPath(diagnostic.filePath ?? '')
    : FS.displayPath(diagnostic.filePath ?? '') + ':' + String(diagnostic.range.start.line + 1) + ':'
      + String(diagnostic.range.start.character + 1)
  return location + ' - ' + diagnostic.message
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
