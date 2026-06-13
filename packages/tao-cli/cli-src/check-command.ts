import { FS } from '@shared'
import SourceActions from '@source-actions'
import Workspace from '@workspace'
import {
  compareOnly,
  inPlaceError,
  type InPlaceFileResult,
  runOnTaoFiles,
  workspaceRootForInPlacePath,
} from './in-place-files'

/** runCheck checks whether every .tao file at or under `path` is fully canonical without writing. */
export async function runCheck(path: string): Promise<InPlaceFileResult[]> {
  const root = FS.resolvePath(path)
  const workspace = await Workspace.open(await workspaceRootForInPlacePath(root))
  return await runOnTaoFiles(root, filePath => checkFile(workspace, filePath))
}

async function checkFile(workspace: Workspace, path: string): Promise<InPlaceFileResult> {
  try {
    const before = await FS.readText(path)
    const parsed = await workspace.parse(path)
    return compareOnly(
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
