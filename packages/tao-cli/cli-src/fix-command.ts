import { Parser } from '@parser'
import { FS } from '@shared'
import SourceActions from '@source-actions'
import { inPlaceError, type InPlaceFileResult, runOnTaoFiles, writeWhenChanged } from './in-place-files'

/** runFix canonicalizes every .tao file at or under `path` in place: renders last, organized imports, formatted. */
export async function runFix(path: string): Promise<InPlaceFileResult[]> {
  return await runOnTaoFiles(path, fixFile)
}

async function fixFile(path: string): Promise<InPlaceFileResult> {
  try {
    const before = await FS.readText(path)
    const parsed = await Parser.parseFile(path)
    return await writeWhenChanged(path, before, await SourceActions.fixSource(parsed.document))
  } catch (error) {
    return inPlaceError(path, error)
  }
}
