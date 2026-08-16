import { FS, Platform, Text } from '@shared'
import { mkTestDir } from '@shared/test'
import { Writable } from 'node:stream'
import type { InPlace } from '../cli-src/in-place-files'
import { runTaoCli } from '../cli-src/tao-cli'

class TaoCliExit extends Error {}

/** TaoCliTestResult records one in-process Tao CLI run. */
export type TaoCliTestResult = {
  exitCode: number
  stderr: string
  stdout: string
}

type PackageAwareCliPathCase = {
  name: string
  resolve: (rootDir: string) => {
    cwd?: string
    path: string
  }
}

export const packageAwareCliMainPath = 'Packages/@cards/screens/Main.tao'
export const packageAwareCliFixture = {
  [packageAwareCliMainPath]: Text.stripIndent(`
    use LocalText, Missing from @cards/widgets

    view MainView() { }
  `),
  'Packages/@cards/widgets/Widget.tao': 'public view LocalText(Value is text) { }\n',
} as const
export const packageAwareCliFixedSource = `${
  Text.stripIndent(`
    use Missing from @cards/widgets

    view MainView() { }
  `)
}\n`

/** packageAwareCliPathCases covers absolute and cwd-relative file and directory entrypoints. */
export const packageAwareCliPathCases: readonly PackageAwareCliPathCase[] = [
  {
    name: 'an explicit nested package file',
    resolve: (rootDir: string) => ({ path: FS.resolvePath(packageAwareCliMainPath, rootDir) }),
  },
  {
    name: 'an explicit nested package directory',
    resolve: (rootDir: string) => ({ path: FS.resolvePath(FS.dirname(packageAwareCliMainPath), rootDir) }),
  },
  {
    name: 'a relative directory path inside a nested package',
    resolve: (rootDir: string) => ({
      cwd: FS.resolvePath(FS.dirname(packageAwareCliMainPath), rootDir),
      path: '.',
    }),
  },
  {
    name: 'a relative file path inside a nested package',
    resolve: (rootDir: string) => ({
      cwd: FS.resolvePath(FS.dirname(packageAwareCliMainPath), rootDir),
      path: FS.basename(packageAwareCliMainPath),
    }),
  },
]

/** withTaoFixture writes a temp directory of files, runs the tests, and cleans up. */
export async function withTaoFixture(
  files: Record<string, string>,
  testsFunction: (rootDir: string) => Promise<void>,
): Promise<void> {
  const rootDir = await mkTestDir('tao-cli-test')
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      await FS.writeText(FS.resolvePath(relativePath, rootDir), source)
    }
    await testsFunction(rootDir)
  } finally {
    await FS.remove(rootDir)
  }
}

/** statusByFile maps in-place results to root-relative paths for assertions. */
export function statusByFile(results: readonly InPlace.Result[], rootDir: string): Record<string, string> {
  return Object.fromEntries(results.map(result => [FS.relativePath(rootDir, result.path), result.status]))
}

/** statusByBasename maps in-place results to file basenames for cwd-sensitive assertions. */
export function statusByBasename(results: readonly InPlace.Result[]): Record<string, string> {
  return Object.fromEntries(results.map(result => [FS.basename(result.path), result.status]))
}

/** runTaoCliForTest runs the Tao CLI in-process while capturing terminal output and exit code. */
export async function runTaoCliForTest(args: readonly string[]): Promise<TaoCliTestResult> {
  const stdout = Platform.runtimeProcess.stdout
  const stderr = Platform.runtimeProcess.stderr
  const exit = Platform.runtimeProcess.exit
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let exitCode = 0

  Platform.runtimeProcess.stdout = captureStream(stdoutChunks) as typeof Platform.runtimeProcess.stdout
  Platform.runtimeProcess.stderr = captureStream(stderrChunks) as typeof Platform.runtimeProcess.stderr
  Platform.runtimeProcess.exit = ((code = 0) => {
    exitCode = Number(code ?? 0)
    throw new TaoCliExit()
  }) as typeof Platform.runtimeProcess.exit

  try {
    await runTaoCli(['bun', 'tao', ...args])
  } catch (error) {
    if (!(error instanceof TaoCliExit)) {
      throw error
    }
  } finally {
    Platform.runtimeProcess.stdout = stdout
    Platform.runtimeProcess.stderr = stderr
    Platform.runtimeProcess.exit = exit
  }

  return {
    exitCode,
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
  }
}

function captureStream(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
}
