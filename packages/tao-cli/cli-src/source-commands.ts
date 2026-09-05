import Formatter, { type FormatterSession } from '@formatter'
import { type Diagnostic, Diagnostics, FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
import { type InPlace, inPlace } from './in-place-files'
import { findTaoFiles } from './tao-files'

type CanonicalSourceOptions = InPlace.PathOptions & {
  reportWarnings?: boolean
  write: boolean
}

type OwnedTaoFile = Readonly<{
  path: string
  workspaceRoot: string
}>

/** runCheck checks canonical source and reports validation warnings without writing. */
export async function runCheck(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
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
    results.push(await formatFile(session, file.path))
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
  const warningsByFile = new Map<string, readonly string[]>()
  if (options.reportWarnings) {
    for (const partition of partitions.values()) {
      const warnings = indexWarnings((await partition.workspace.validateFiles(partition.files)).diagnostics)
      for (const [filePath, messages] of warnings) {
        warningsByFile.set(filePath, messages)
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
        warningsByFile.get(file.path) ?? [],
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

async function formatFile(session: FormatterSession, path: string): Promise<InPlace.Result> {
  return await inPlace.processFile(
    path,
    () => session.formatFile(path),
    protectedWriteOptions(path, true),
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
    protectedWriteOptions(path, write),
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

function formatCheckWarning(diagnostic: Diagnostic): string {
  const location = diagnostic.range === undefined
    ? FS.displayPath(diagnostic.filePath ?? '')
    : FS.displayPath(diagnostic.filePath ?? '') + ':' + String(diagnostic.range.start.line + 1) + ':'
      + String(diagnostic.range.start.character + 1)
  return location + ' - ' + diagnostic.message
}

function protectedWriteOptions(path: string, requestedWrite: boolean): InPlace.ProcessOptions {
  const generated = inPlace.generatedRootPackageFile(path)
  return {
    ...(requestedWrite && generated
      ? { changedIsError: 'Generated source under @/ is not canonical; regenerate it instead of rewriting it.' }
      : {}),
    write: requestedWrite && !generated,
  }
}
