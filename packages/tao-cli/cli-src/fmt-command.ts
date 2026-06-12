import Formatter from '@formatter'
import { Errors, FS } from '@shared'

/** FmtFileResult declares the outcome of formatting one Tao file in place. */
export type FmtFileResult = {
  path: string
  status: 'formatted' | 'unchanged' | 'error'
  error?: string
}

/** runFmt formats every .tao file at or under `path` in place and returns per-file results. */
export async function runFmt(path: string): Promise<FmtFileResult[]> {
  const results: FmtFileResult[] = []
  const files = FS.walk(FS.resolvePath(path), {
    extensions: ['.tao'],
    excludeDirectoryNames: ['node_modules'],
  })
  for await (const filePath of files) {
    results.push(await fmtFile(filePath))
  }
  return results
}

async function fmtFile(path: string): Promise<FmtFileResult> {
  try {
    const before = await FS.readText(path)
    const after = await Formatter.formatFile(path)
    if (after === before) {
      return { path, status: 'unchanged' }
    }
    await FS.writeText(path, after)
    return { path, status: 'formatted' }
  } catch (error) {
    return { path, status: 'error', error: Errors.formatForUser(error) }
  }
}
