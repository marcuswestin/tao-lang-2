import Formatter from '@formatter'
import { FS } from '@shared'
import { inPlaceError, type InPlaceFileResult, runOnTaoFiles, writeWhenChanged } from './in-place-files'

/** runFmt formats every .tao file at or under `path` in place and returns per-file results. */
export async function runFmt(path: string): Promise<InPlaceFileResult[]> {
  return await runOnTaoFiles(path, fmtFile)
}

async function fmtFile(path: string): Promise<InPlaceFileResult> {
  try {
    const before = await FS.readText(path)
    return await writeWhenChanged(path, before, await Formatter.formatFile(path))
  } catch (error) {
    return inPlaceError(path, error)
  }
}
