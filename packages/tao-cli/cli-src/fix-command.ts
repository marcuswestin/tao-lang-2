import { FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
import {
  inPlaceError,
  type InPlaceFileResult,
  runOnTaoFiles,
  workspaceRootForInPlacePath,
  writeWhenChanged,
} from './in-place-files'

/** runFix canonicalizes every .tao file at or under `path` in place: renders last, organized imports, formatted. */
export async function runFix(path: string): Promise<InPlaceFileResult[]> {
  const root = FS.resolvePath(path)
  const workspace = await Workspace.open(await workspaceRootForInPlacePath(root))
  return await runOnTaoFiles(root, filePath => fixFile(workspace, filePath))
}

async function fixFile(workspace: Workspace, path: string): Promise<InPlaceFileResult> {
  try {
    const before = await FS.readText(path)
    const parsed = await workspace.parse(path)
    return await writeWhenChanged(
      path,
      before,
      await SourceActions.fixSource(parsed.entry.document, {
        parseUpdatedDocument: async (document, text) => {
          return (await workspace.parseSource(text, document.uri)).entry.document
        },
      }),
    )
  } catch (error) {
    return inPlaceError(path, error)
  }
}
