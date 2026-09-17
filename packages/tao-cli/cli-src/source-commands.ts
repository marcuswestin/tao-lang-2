import Formatter, { type FormatterSession } from '@formatter'
import { Diagnostic, Diagnostics, FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
import { type InPlace, inPlace } from './in-place-files'
import { findTaoFiles } from './tao-files'

type CanonicalSourceOptions = InPlace.PathOptions & {
  /** validate runs semantic validation and reports its errors and warnings alongside canonicalization. */
  validate?: boolean
  write: boolean
}

type OwnedTaoFile = Readonly<{
  path: string
  workspaceRoot: string
}>

/** runCheck checks canonical source and reports syntax and validation diagnostics without writing. */
export async function runCheck(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
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
  const partitions = new Map<string, { files: string[]; workspace: Workspace }>()
  for (const file of files) {
    const existing = partitions.get(file.workspaceRoot)
    if (existing === undefined) {
      partitions.set(file.workspaceRoot, {
        files: [file.path],
        workspace: await Workspace.open(file.workspaceRoot),
      })
    } else {
      existing.files.push(file.path)
    }
  }
  const diagnosticsByFile = new Map<string, readonly Diagnostic[]>()
  if (options.validate) {
    for (const partition of partitions.values()) {
      const validated = await partition.workspace.validateFiles(partition.files)
      for (const [filePath, diagnostics] of indexDiagnostics(validated.diagnostics)) {
        diagnosticsByFile.set(filePath, diagnostics)
      }
    }
  }
  const results: InPlace.Result[] = []
  for (const file of files) {
    const partition = partitions.get(file.workspaceRoot)
    if (partition === undefined) {
      continue
    }
    results.push(
      await canonicalizeFile(
        partition.workspace,
        file.path,
        options.write,
        diagnosticsByFile.get(file.path) ?? [],
      ),
    )
  }
  return results
}

async function ownedTaoFiles(root: string, options: InPlace.PathOptions): Promise<OwnedTaoFile[]> {
  const fallbackRoot = await inPlace.workspaceRootForPath(root, options)
  return await Promise.all((await findTaoFiles(root)).map(async path => ({
    path,
    workspaceRoot: await inPlace.workspaceRootForPath(path, { cwd: fallbackRoot }),
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

function protectedWriteOptions(path: string, workspaceRoot: string, requestedWrite: boolean): InPlace.ProcessOptions {
  const generated = inPlace.generatedRootPackageFile(path, workspaceRoot)
  return {
    ...(requestedWrite && generated
      ? { changedIsError: 'Generated source under @/ is not canonical; regenerate it instead of rewriting it.' }
      : {}),
    write: requestedWrite && !generated,
  }
}
