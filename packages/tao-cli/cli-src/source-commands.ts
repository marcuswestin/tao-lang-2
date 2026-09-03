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
  const workspaceRoot = await inPlace.workspaceRootForPath(root, options)
  // One formatter session serves the whole run instead of building parser services per file.
  const session = Formatter.createSession()
  return await inPlace.runOnTaoFiles(root, filePath => formatFile(session, filePath, workspaceRoot))
}

async function runCanonicalSource(path: string, options: CanonicalSourceOptions): Promise<InPlace.Result[]> {
  const root = FS.resolvePath(path, options.cwd)
  const workspace = await Workspace.open(await inPlace.workspaceRootForPath(root, options))
  const filePaths = await findTaoFiles(root)
  const warningsByFile = options.reportWarnings && filePaths.length > 0
    ? indexWarnings((await workspace.validateFiles(filePaths)).diagnostics)
    : new Map<string, readonly string[]>()
  const results: InPlace.Result[] = []
  for (const filePath of filePaths) {
    results.push(await canonicalizeFile(workspace, filePath, options.write, warningsByFile.get(filePath) ?? []))
  }
  return results
}

async function formatFile(session: FormatterSession, path: string, workspaceRoot: string): Promise<InPlace.Result> {
  return await inPlace.processFile(
    path,
    () => session.formatFile(path),
    protectedWriteOptions(path, workspaceRoot, true),
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

function formatCheckWarning(diagnostic: Diagnostic): string {
  const location = diagnostic.range === undefined
    ? FS.displayPath(diagnostic.filePath ?? '')
    : FS.displayPath(diagnostic.filePath ?? '') + ':' + String(diagnostic.range.start.line + 1) + ':'
      + String(diagnostic.range.start.character + 1)
  return location + ' - ' + diagnostic.message
}

function protectedWriteOptions(path: string, workspaceRoot: string, requestedWrite: boolean): InPlace.ProcessOptions {
  const generated = generatedPackageFile(path, workspaceRoot)
  return {
    ...(requestedWrite && generated
      ? { changedIsError: 'Generated source under @/ is not canonical; regenerate it instead of rewriting it.' }
      : {}),
    write: requestedWrite && !generated,
  }
}

function generatedPackageFile(path: string, workspaceRoot: string): boolean {
  return FS.pathIsWithin(path, FS.resolvePath('@', workspaceRoot))
}
