import { FS, Platform, Text } from '@shared'
import { withTaoFiles } from '@shared/test'
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

/**
 * checkedProjectFile gives a fixture the project identity `tao check` now requires of any file it
 * validates. Tests whose subject is not project identity include it so its diagnostic does not
 * crowd out theirs.
 */
export const checkedProjectFile = {
  'Project.tao': 'project {\n   id "tao-cli-test"\n   name "Tao CLI test"\n}\n',
} as const

/** checkedView is a canonical view that validates cleanly, for tests whose subject is elsewhere. */
export function checkedView(name: string): string {
  return `use Text from @tao/ui\n\nview ${name}() {\n   render Text("${name}")\n}\n`
}

/**
 * The cache opt-outs `tao check` and `tao test` read. A verification lane run with `--no-cache` sets
 * `TAO_TEST_NO_CACHE` on every process in its graph, so these suites would inherit an answer to the
 * very question they exist to ask. A fixture is a throwaway root that never reads or writes this
 * checkout's stamps, so nothing the lane distrusts can reach one: the opt-out is cleared on the way
 * in, and a test that wants it sets it for itself inside the fixture.
 */
const NO_CACHE_ENV_KEYS: readonly string[] = ['TAO_CHECK_NO_CACHE', 'TAO_TEST_NO_CACHE']

/** withTaoFixture writes the given files verbatim into a temp directory: the CLI sees exactly what the test wrote. */
export async function withTaoFixture(
  files: Record<string, string>,
  testsFunction: (rootDir: string) => Promise<void>,
): Promise<void> {
  await withoutInheritedNoCache(async () => {
    await withTaoFiles('tao-cli-test', files, (_paths, rootDir) => testsFunction(rootDir), { verbatim: true })
  })
}

/** withoutInheritedNoCache runs one fixture with the lane's cache opt-out out of the way, then restores it. */
async function withoutInheritedNoCache(run: () => Promise<void>): Promise<void> {
  const previous = NO_CACHE_ENV_KEYS.map(key => [key, Platform.runtimeProcess.env[key]] as const)
  for (const [key] of previous) {
    delete Platform.runtimeProcess.env[key]
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete Platform.runtimeProcess.env[key]
      } else {
        Platform.runtimeProcess.env[key] = value
      }
    }
  }
}

/** statusByFile maps in-place results to root-relative paths for assertions. */
export function statusByFile(results: readonly InPlace.Result[], rootDir: string): Record<string, string> {
  return Object.fromEntries(results.map(result => [FS.relativePath(rootDir, result.path), result.status]))
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
