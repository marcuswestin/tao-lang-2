import Formatter, { type FormatterSession } from '@formatter'
import { FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
import { type InPlace, inPlace } from './in-place-files'

type CanonicalSourceOptions = InPlace.PathOptions & {
  write: boolean
}

/** runCheck checks whether every .tao file at or under `path` is fully canonical without writing. */
export async function runCheck(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
  return await runCanonicalSource(path, { ...options, write: false })
}

/** runFix canonicalizes every .tao file at or under `path` in place: renders last, organized imports, formatted. */
export async function runFix(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
  return await runCanonicalSource(path, { ...options, write: true })
}

/** runFmt formats every .tao file at or under `path` in place and returns per-file results. */
export async function runFmt(path: string, options: InPlace.PathOptions = {}): Promise<InPlace.Result[]> {
  const root = FS.resolvePath(path, options.cwd)
  // One formatter session serves the whole run instead of building parser services per file.
  const session = Formatter.createSession()
  return await inPlace.runOnTaoFiles(root, filePath => formatFile(session, filePath))
}

async function runCanonicalSource(path: string, options: CanonicalSourceOptions): Promise<InPlace.Result[]> {
  const root = FS.resolvePath(path, options.cwd)
  const workspace = await Workspace.open(await inPlace.workspaceRootForPath(root, options))
  return await inPlace.runOnTaoFiles(root, filePath => canonicalizeFile(workspace, filePath, options))
}

async function formatFile(session: FormatterSession, path: string): Promise<InPlace.Result> {
  return await inPlace.processFile(path, () => session.formatFile(path), { write: true })
}

async function canonicalizeFile(
  workspace: Workspace,
  path: string,
  options: Pick<CanonicalSourceOptions, 'write'>,
): Promise<InPlace.Result> {
  return await inPlace.processFile(
    path,
    async () => {
      const parsed = await workspace.parse(path)
      return await SourceActions.fixSource(parsed.entry.document, {
        parseUpdatedDocument: async (document, text) => {
          return (await workspace.parseSource(text, document.uri)).entry.document
        },
      })
    },
    { write: options.write },
  )
}
