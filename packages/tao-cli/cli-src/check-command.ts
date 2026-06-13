import { Parser } from '@parser'
import { FS } from '@shared'
import SourceActions from '@source-actions'
import { compareOnly, inPlaceError, type InPlaceFileResult, runOnTaoFiles } from './in-place-files'

/** runCheck checks whether every .tao file at or under `path` is fully canonical without writing. */
export async function runCheck(path: string): Promise<InPlaceFileResult[]> {
  return await runOnTaoFiles(path, checkFile)
}

async function checkFile(path: string): Promise<InPlaceFileResult> {
  try {
    const before = await FS.readText(path)
    const parsed = await Parser.parseFile(path)
    return compareOnly(path, before, await SourceActions.fixSource(parsed.document))
  } catch (error) {
    return inPlaceError(path, error)
  }
}
