import { FS, Platform } from '@shared'
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

/** statusByBasename maps in-place results to file basenames for cwd-sensitive assertions. */
export function statusByBasename(results: readonly InPlaceFileResult[]): Record<string, string> {
  return Object.fromEntries(results.map(result => [FS.basename(result.path), result.status]))
}

/** withCwd runs a test block from `cwd`, then restores the original current working directory. */
export async function withCwd(cwd: string, testFunction: () => Promise<void>): Promise<void> {
  const originalCwd = Platform.runtimeProcess.cwd()
  try {
    Platform.runtimeProcess.chdir(cwd)
    await testFunction()
  } finally {
    Platform.runtimeProcess.chdir(originalCwd)
  }
}
