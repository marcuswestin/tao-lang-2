import { CLI, Errors, FS, HCI, Platform, Repo, TaoStdlib } from '@shared'

/**
 * `just test`, `just test-file`, `just test-changed`, `just test-retry`, and both verify lanes all
 * depend on the WordFlower app being compiled into `packages/apps/expo-host/_gen_tao-app`. That
 * compile costs ~2.7s of single-threaded work and used to be paid unconditionally, so running one
 * dev test that never reads the generated app still waited three seconds for it, and every verify
 * lane carried it on the serial floor.
 *
 * This is the same content stamp `ParserGenerate.ts` puts in front of Langium: hash what the
 * compile reads, remember what it wrote, and skip the compile while both still agree. Unlike that
 * one it publishes nothing itself — `./tao compile` remains the only thing that writes the
 * generated app — so the stamp is purely a decision about whether to spawn it.
 *
 * `./tao compile` is the published product surface, which is why the stamp lives here rather than
 * in the CLI: a user compiling their own project gets a compile, and this repository's build gets a
 * repository build stamp on top of it. `packages/dev` does not depend on `tao-cli`, so the compile
 * is delegated as a child process rather than imported; on a stamp miss the ~2.7s of compiling
 * dwarfs the spawn, and on a hit nothing is spawned at all.
 */

/**
 * Where the stamp is kept. `.artifacts` is the repository's ignored scratch root, so a reclaimed
 * `.artifacts` or a fresh checkout simply has no stamp and rebuilds.
 */
const STAMP_PATH = '.artifacts/compile-app-stamp.json'

/**
 * The stamp layout, and with it the input-hashing scheme. An older or unreadable stamp is treated as
 * stale, never as an error. Raise this whenever the set of inputs or the way they are hashed
 * changes, or a stamp written under the old scheme is honoured against inputs it never covered.
 */
const STAMP_VERSION = 2

/** Where `./tao compile` writes the generated app, relative to the repository root. */
const DEFAULT_OUTPUT_ROOT = 'packages/apps/expo-host/_gen_tao-app'

/**
 * Every repository-owned directory whose content can change what a compile produces. Getting this
 * set right is the whole correctness question: a missed input means a stale generated app and a
 * green run over code that was never rebuilt, which is far worse than repeating a 2.7s compile.
 * The rule applied here is to hash more rather than reason narrowly — whole source trees, including
 * their tests, rather than the files a dependency graph says are reachable today.
 *
 * - `parser-src` carries the generated `_gen_tao-parser` tree as well as the hand-written parser, so
 *   naming it once keeps both the parser and its generator's output in the decision.
 * - `packages/apps/stdlib` is named at its package root rather than at `stdlib-src`, because the Tao
 *   stdlib is `@tao/**` — `.tao` sources and the TypeScript sidecars the compiler copies beside
 *   them — and a new top-level asset directory there must be picked up without editing this list.
 * - The app's own project tree is not here; it is hashed from the app path the caller passes.
 */
export const COMPILE_SOURCE_ROOTS: readonly string[] = [
  'packages/language/ast-utils/ast-utils-src',
  'packages/compiler/compiler-src',
  'packages/ai/generation/generation-src',
  'packages/providers/icloud/icloud-src',
  'packages/language/parser/parser-src',
  'packages/apps/expo-host/expo-host-src',
  'packages/shared/shared-src',
  'packages/apps/stdlib',
  'packages/cli/tao-cli/cli-src',
  'packages/language/validator/validator-src',
]

/**
 * Individual files outside those trees that still decide what a compile produces: the dependency
 * lock, so upgrading a package the compiler uses invalidates the stamp, and each participating
 * package's manifest, whose `exports` map decides which module a package import resolves to.
 */
export const COMPILE_INPUT_FILES: readonly string[] = [
  'bun.lock',
  'packages/language/ast-utils/package.json',
  'packages/compiler/package.json',
  'packages/ai/generation/package.json',
  'packages/providers/icloud/package.json',
  'packages/language/parser/package.json',
  'packages/apps/expo-host/package.json',
  'packages/shared/package.json',
  'packages/apps/stdlib/package.json',
  'packages/cli/tao-cli/package.json',
  'packages/language/validator/package.json',
]

/** Directories no input walk descends: installed dependencies and Git's own store. */
const EXCLUDED_INPUT_DIRECTORIES = new Set(['node_modules', '.git'])

/**
 * TypeScript's incremental build state is rewritten by every typecheck without any source changing.
 * It sits inside `packages/apps/stdlib`, so hashing it would make the compile rebuild after each
 * `_typecheck` — a stale input in the other direction.
 */
const EXCLUDED_INPUT_SUFFIX = '.tsbuildinfo'

/** How an absent declared input is recorded, so that its appearance or removal changes the hash. */
const ABSENT = '<absent>'

/**
 * The environment a lane's `--no-cache` reaches this gate through. `--no-cache` is the one flag
 * every verification scope takes, and it means the same thing everywhere: run anyway rather than
 * trust recorded evidence. This gate honoured its own stamp regardless, so the one flag a developer
 * reaches for when they suspect a stale generated app was the one flag that could not rebuild it.
 *
 * `TAO_CHECK_NO_CACHE` is honoured too, because `tao check` reads both and the two schemes cover
 * the same compile.
 */
export const NO_CACHE_ENV_KEYS: readonly string[] = ['TAO_CHECK_NO_CACHE', 'TAO_TEST_NO_CACHE']

/** cacheDisabled reports whether this run was told to ignore the stamp entirely. */
function cacheDisabled(): boolean {
  return NO_CACHE_ENV_KEYS.some(key => Platform.runtimeProcess.env[key] === 'true')
}

/** CompileAppStamp records what the last successful compile read and what it wrote. */
type CompileAppStamp = {
  inputs: string
  outputs: readonly string[]
  outputsHash: string
  version: number
}

/** CompileAppOptions lets a test substitute the compiler and the roots; the workflow uses `./tao`. */
export type CompileAppOptions = {
  appName?: string
  appPath: string
  compile?: (appPath: string, appName: string | undefined, repositoryRoot: string) => Promise<number>
  inputFiles?: readonly string[]
  outputRoot?: string
  /**
   * Ignore the stamp and compile regardless, defaulting to what the environment says. It is a field
   * so a test can exercise it without writing to the process environment: this suite runs
   * `--concurrent`, so an environment a test mutates is one every sibling running beside it reads.
   */
  noCache?: boolean
  repositoryRoot?: string
  sourceRoots?: readonly string[]
}

/** runCompileApp compiles a repository app, skipping the compile when nothing it reads has changed. */
export async function runCompileApp(options: CompileAppOptions): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const appPath = FS.resolvePath(options.appPath, repositoryRoot)
  const outputRoot = FS.resolvePath(options.outputRoot ?? DEFAULT_OUTPUT_ROOT, repositoryRoot)
  const stampPath = FS.resolvePath(STAMP_PATH, repositoryRoot)
  if (!await FS.isFile(appPath)) {
    Errors.throwUserInput(`No Tao app file found at ${appPath}`)
  }

  // Asked once, so the pre-lock and in-lock answers cannot disagree.
  const honoursStamp = !(options.noCache ?? cacheDisabled())
  const inputs = await compileAppInputHash(repositoryRoot, appPath, options)
  if (honoursStamp && await compileAppIsUpToDate(repositoryRoot, outputRoot, stampPath, inputs)) {
    HCI.writeLine('compile app: up to date')
    return 0
  }

  return await FS.withFileMutationLock(stampPath, repositoryRoot, async () => {
    // Every gate is a separate process, and several of them depend on this one. Another process may
    // have finished the compile while this one waited for the lock, so never trust the pre-lock
    // answer: re-read the inputs and re-ask inside the lock.
    const lockedInputs = await compileAppInputHash(repositoryRoot, appPath, options)
    if (honoursStamp && await compileAppIsUpToDate(repositoryRoot, outputRoot, stampPath, lockedInputs)) {
      HCI.writeLine('compile app: up to date')
      return 0
    }
    return await runCompileAppLocked(options, repositoryRoot, appPath, outputRoot, stampPath, lockedInputs)
  })
}

async function runCompileAppLocked(
  options: CompileAppOptions,
  repositoryRoot: string,
  appPath: string,
  outputRoot: string,
  stampPath: string,
  inputs: string,
): Promise<number> {
  const compile = options.compile ?? runTaoCompile
  const exitCode = await compile(appPath, options.appName, repositoryRoot)
  if (exitCode !== 0) {
    // A failed compile leaves no stamp at all, so the next run repeats the work rather than
    // inheriting the failure as a skip.
    return exitCode
  }

  // The compile just read these files; if any of them moved while it ran, the generated app does not
  // correspond to any single input state and must not be stamped as if it did.
  if (await compileAppInputHash(repositoryRoot, appPath, options) !== inputs) {
    Errors.throwUnexpected('App compilation inputs changed while the compile ran; refusing stale metadata.')
  }
  const outputs = await generatedFilePaths(outputRoot)
  if (outputs.length === 0) {
    Errors.throwUnexpected(`App compilation produced no output under ${outputRoot}.`)
  }
  await writeCompileAppStamp(stampPath, repositoryRoot, {
    inputs,
    outputs: outputs.map(path => FS.relativePath(repositoryRoot, path)),
    outputsHash: await compileAppOutputHash(outputRoot),
    version: STAMP_VERSION,
  })
  return 0
}

/** runTaoCompile invokes the published CLI, streaming what it prints straight through to the lane. */
async function runTaoCompile(
  appPath: string,
  appName: string | undefined,
  repositoryRoot: string,
): Promise<number> {
  const result = await CLI.run(FS.resolvePath('tao', repositoryRoot), {
    args: ['compile', appPath, ...(appName === undefined ? [] : ['--app', appName])],
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    throw result.error
  }
  return result.exitCode ?? 1
}

/**
 * compileAppInputHash hashes everything the compile reads: the app's own project tree, the project
 * identity its ancestors declare, every declared repository source root, and every declared input
 * file. Content is hashed rather than modification times, so a checkout, a worktree copy, or a
 * reverted edit does not force a rebuild.
 */
async function compileAppInputHash(
  repositoryRoot: string,
  appPath: string,
  options: Pick<CompileAppOptions, 'appName' | 'inputFiles' | 'sourceRoots'> = {},
): Promise<string> {
  const entries: string[] = [
    `app\n${FS.relativePath(repositoryRoot, appPath)}#${options.appName ?? ''}`,
    await treeEntry(repositoryRoot, FS.dirname(appPath)),
    ...await ancestorProjectEntries(repositoryRoot, FS.dirname(appPath)),
    `stdlib\n${await TaoStdlib.declaredRootIdentity(repositoryRoot)}`,
  ]
  for (const root of options.sourceRoots ?? COMPILE_SOURCE_ROOTS) {
    entries.push(await treeEntry(repositoryRoot, FS.resolvePath(root, repositoryRoot)))
  }
  for (const file of options.inputFiles ?? COMPILE_INPUT_FILES) {
    entries.push(await fileEntry(repositoryRoot, FS.resolvePath(file, repositoryRoot)))
  }
  return Platform.sha256Hex(entries.join('\n'))
}

/**
 * ancestorProjectEntries covers the one input that is not a file the app owns or a repository source
 * root: `Packages` walks from the app directory up through its ancestors looking for the `Project.tao`
 * that declares project identity, so a `Project.tao` appearing above the app changes what compiles.
 */
async function ancestorProjectEntries(repositoryRoot: string, appRoot: string): Promise<string[]> {
  const entries: string[] = []
  let current = FS.dirname(appRoot)
  while (FS.pathIsWithin(current, repositoryRoot)) {
    entries.push(await fileEntry(repositoryRoot, FS.resolvePath('Project.tao', current)))
    const parent = FS.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return entries
}

/** treeEntry is the identity of a whole directory: every file it holds, in a stable path order. */
async function treeEntry(repositoryRoot: string, root: string): Promise<string> {
  const relativeRoot = FS.relativePath(repositoryRoot, root)
  if (!await FS.isDirectory(root)) {
    return `${relativeRoot}\n${ABSENT}`
  }
  const lines: string[] = []
  for (const path of await inputFilePaths(root)) {
    lines.push(`${FS.relativePath(root, path)}\n${Platform.sha256Hex(await FS.readFile(path))}`)
  }
  return `${relativeRoot}\n${Platform.sha256Hex(lines.join('\n'))}`
}

/** fileEntry is the identity of one declared file, which may legitimately not exist. */
async function fileEntry(repositoryRoot: string, path: string): Promise<string> {
  const relative = FS.relativePath(repositoryRoot, path)
  if (!await FS.isFile(path)) {
    return `${relative}\n${ABSENT}`
  }
  return `${relative}\n${Platform.sha256Hex(await FS.readFile(path))}`
}

/** inputFilePaths lists the hashable files under a root, in a stable order. */
async function inputFilePaths(root: string): Promise<string[]> {
  const paths: string[] = []
  for await (
    const path of FS.walk(root, {
      excludeDirectory: name => EXCLUDED_INPUT_DIRECTORIES.has(name),
      includeHidden: true,
    })
  ) {
    if (!path.endsWith(EXCLUDED_INPUT_SUFFIX)) {
      paths.push(path)
    }
  }
  return paths.sort()
}

/**
 * compileAppIsUpToDate answers whether the compile can be skipped. The stamp alone is not enough.
 * The generated tree is one shared directory that `./tao compile` on another app, `./tao dev`, a
 * reclaimed scratch root, or an interrupted write can all leave absent, partial, or holding somebody
 * else's app while this app's inputs are untouched — so the output is hashed, not merely counted.
 */
async function compileAppIsUpToDate(
  repositoryRoot: string,
  outputRoot: string,
  stampPath: string,
  inputs: string,
): Promise<boolean> {
  const stamp = await readCompileAppStamp(stampPath)
  if (stamp === undefined || stamp.version !== STAMP_VERSION || stamp.inputs !== inputs) {
    return false
  }
  if (stamp.outputs.length === 0 || !await FS.isDirectory(outputRoot)) {
    return false
  }
  for (const generated of stamp.outputs) {
    if (!await FS.isFile(FS.resolvePath(generated, repositoryRoot))) {
      return false
    }
  }
  return await compileAppOutputHash(outputRoot) === stamp.outputsHash
}

/** compileAppOutputHash hashes the generated app tree itself, in a stable order. */
export async function compileAppOutputHash(outputRoot: string): Promise<string> {
  const entries: string[] = []
  for (const path of await generatedFilePaths(outputRoot)) {
    entries.push(`${FS.relativePath(outputRoot, path)}\n${Platform.sha256Hex(await FS.readFile(path))}`)
  }
  return Platform.sha256Hex(entries.join('\n'))
}

/** generatedFilePaths lists the files the generated app tree now holds, in a stable order. */
async function generatedFilePaths(outputRoot: string): Promise<string[]> {
  if (!await FS.isDirectory(outputRoot)) {
    return []
  }
  const paths: string[] = []
  for await (const path of FS.walk(outputRoot, { includeHidden: true })) {
    paths.push(path)
  }
  return paths.sort()
}

/** readCompileAppStamp reads the stamp, treating a missing or malformed one as no stamp. */
async function readCompileAppStamp(stampPath: string): Promise<CompileAppStamp | undefined> {
  try {
    const value = await FS.readJson<Partial<CompileAppStamp>>(stampPath)
    if (
      typeof value?.inputs !== 'string'
      || typeof value.outputsHash !== 'string'
      || typeof value.version !== 'number'
      || !Array.isArray(value.outputs)
    ) {
      return undefined
    }
    return {
      inputs: value.inputs,
      outputs: value.outputs.filter(entry => typeof entry === 'string'),
      outputsHash: value.outputsHash,
      version: value.version,
    }
  } catch {
    return undefined
  }
}

/**
 * writeCompileAppStamp publishes the stamp with a rename, so a reader never sees a half-written
 * file. It runs only after a clean compile.
 */
async function writeCompileAppStamp(
  stampPath: string,
  repositoryRoot: string,
  stamp: CompileAppStamp,
): Promise<void> {
  const temporaryPath = `${stampPath}.${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporaryPath, stamp)
    await FS.moveFileWithinBoundary(temporaryPath, stampPath, repositoryRoot)
  } finally {
    if (await FS.isFile(temporaryPath)) {
      await FS.removeFileWithinBoundary(temporaryPath, repositoryRoot)
    }
  }
}

/**
 * The gate runs this module directly rather than through `./dev`, matching `_parser-gen`. Both are
 * private recipes nobody types, so the discoverable command buys nothing here, while `./dev`'s own
 * boot is ~160ms against ~27ms for a bare `bun run` — most of the warm gate, paid by every
 * `just test`, `test-file`, `test-changed`, `test-retry` and verify lane.
 */
if (import.meta.main) {
  const argv = Platform.runtimeProcess.argv.slice(2)
  const appFlag = argv.indexOf('--app')
  const appPath = argv.find(argument => !argument.startsWith('--') && argv.indexOf(argument) !== appFlag + 1)
  if (appPath === undefined) {
    Errors.throwUserInput('Usage: CompileApp.ts <app path> [--app <name>]')
  }
  Platform.runtimeProcess.setExitCode(
    await runCompileApp({ appName: appFlag === -1 ? undefined : argv[appFlag + 1], appPath }),
  )
}
