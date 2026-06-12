import { FS } from '@shared'
import type { InPlaceFileResult } from '../cli-src/in-place-files'

/** withTaoFixture writes a temp directory of files, runs the tests, and cleans up. */
export async function withTaoFixture(
  files: Record<string, string>,
  testsFunction: (rootDir: string) => Promise<void>,
): Promise<void> {
  const rootDir = await FS.mkTmpDir(FS.resolvePath('tao-cli-test', { cwd: FS.tmpdir() }))
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      await FS.writeText(FS.resolvePath(relativePath, { cwd: rootDir }), source)
    }
    await testsFunction(rootDir)
  } finally {
    await FS.remove(rootDir)
  }
}

/** statusByFile maps in-place results to root-relative paths for assertions. */
export function statusByFile(results: readonly InPlaceFileResult[], rootDir: string): Record<string, string> {
  return Object.fromEntries(results.map(result => [FS.relativePath(rootDir, result.path), result.status]))
}
