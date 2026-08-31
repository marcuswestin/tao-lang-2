import { AST, Langium, Parser } from '@parser'
import { RuntimeToolchainPaths } from '@runtime-toolchain'
import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { findTaoFiles } from './tao-files'

/** CompiledTaoTests declares the files and generated manifest for one Tao test run. */
type CompiledTaoTests = {
  manifestPath?: string
  runtimeRoot?: string
  testPaths: readonly string[]
}

/** TaoTestValidationError declares validation errors found before the runtime test harness starts. */
type TaoTestValidationError = RuntimeTesting.TestCompiler.ValidationError

/** runTestCommand runs the user-facing `tao test` command for one path. */
export async function runTestCommand(path: string): Promise<void> {
  try {
    const root = FS.resolvePath(path)
    HCI.logProcessInfo('test', `Finding Tao tests under ${FS.displayPath(root)}`)
    const testPaths = await findTaoTestFiles(root)
    if (testPaths.length === 0) {
      HCI.writeLine(`No Tao tests found under ${FS.displayPath(root)}`)
      return
    }
    HCI.logProcessInfo('test', `Found ${testPaths.length} Tao test ${testPaths.length === 1 ? 'file' : 'files'}`)
    const compiled = await validateAndCompileTaoTests(testPaths)
    HCI.logProcessInfo('test', 'Running Tao tests')
    const commandResult = await runCompiledTaoTests(compiled, { stdio: 'pipe' })
    if (commandResult !== undefined) {
      HCI.write(commandResult.stdout)
      HCI.write(commandResult.stderr)
    }
    if (!commandResult || commandResult.error || commandResult.exitCode !== 0) {
      if (commandResult?.error) {
        HCI.writeErrorLine(Errors.formatForUser(commandResult.error))
      }
      Platform.runtimeProcess.exit(1)
    }
    HCI.logProcessInfo('test', 'Tao tests finished')
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

type CompilerWorkerSession = ReturnType<typeof RuntimeTesting.TestCompiler.Worker.createSession>

// Validation and compilation run across a pool of compiler worker processes: each directory group
// stays on one worker so its files share that worker's workspace, and one worker's requests run
// serially in its process while distinct workers run in parallel.
async function validateAndCompileTaoTests(testPaths: readonly string[]): Promise<CompiledTaoTests> {
  if (Platform.runtimeProcess.env['TAO_TEST_IN_PROCESS'] === 'true') {
    return await validateAndCompileTaoTestsInProcess(testPaths)
  }
  const groups = [...groupPathsByDirectory(testPaths).values()]
  const workers = createTestWorkers(groups.length)
  try {
    HCI.logProcessInfo(
      'test',
      `Validating Tao test files (${workers.length} ${workers.length === 1 ? 'worker' : 'workers'})`,
    )
    const errorsByPath = await mapTestFilesOnWorkers(
      groups,
      workers,
      async (worker, testPath) => await worker.validateTestFile(testPath),
    )
    const validationErrors = testPaths.flatMap(testPath => errorsByPath.get(testPath) ?? [])
    if (validationErrors.length > 0) {
      writeTaoTestValidationErrors(validationErrors)
      Platform.runtimeProcess.exit(1)
    }

    HCI.logProcessInfo('test', 'Compiling apps')
    const runtimeRoot = testRuntimeRoot()
    const runRoot = FS.resolvePath(
      `_gen_tao-app-test/tao-test-command/${RuntimeTesting.TestRunId.create()}`,
      runtimeRoot,
    )
    await FS.mkdir(runRoot)
    const filesByPath = await mapTestFilesOnWorkers(
      groups,
      workers,
      async (worker, testPath) => await worker.compileTestPlan(testPath, { runRoot, skipValidation: true }),
    )
    const manifestPath = FS.resolvePath('manifest.json', runRoot)
    await FS.writeJson(manifestPath, {
      files: testPaths.map(testPath => filesByPath.get(testPath)!),
    })
    return { manifestPath, runtimeRoot, testPaths }
  } finally {
    await Promise.all(workers.map(worker => worker.stop()))
  }
}

async function validateAndCompileTaoTestsInProcess(testPaths: readonly string[]): Promise<CompiledTaoTests> {
  HCI.logProcessInfo('test', 'Validating Tao test files (packaged runner)')
  const validationErrors = (await Promise.all(
    testPaths.map(testPath => RuntimeTesting.TestCompiler.validateTestFile(testPath)),
  )).flat()
  if (validationErrors.length > 0) {
    writeTaoTestValidationErrors(validationErrors)
    Platform.runtimeProcess.exit(1)
  }
  HCI.logProcessInfo('test', 'Compiling apps')
  const runtimeRoot = testRuntimeRoot()
  const runRoot = FS.resolvePath(
    `_gen_tao-app-test/tao-test-command/${RuntimeTesting.TestRunId.create()}`,
    runtimeRoot,
  )
  await FS.mkdir(runRoot)
  const context: RuntimeTesting.TestCompiler.Context = { appModulePaths: new Map(), runRoot }
  const files = []
  for (const testPath of testPaths) {
    files.push(
      await RuntimeTesting.TestCompiler.compileTestFile(testPath, {
        context,
        skipValidation: true,
      }),
    )
  }
  const manifestPath = FS.resolvePath('manifest.json', runRoot)
  await FS.writeJson(manifestPath, { files })
  return { manifestPath, runtimeRoot, testPaths }
}

async function mapTestFilesOnWorkers<ResultT>(
  groups: readonly (readonly string[])[],
  workers: readonly CompilerWorkerSession[],
  run: (worker: CompilerWorkerSession, testPath: string) => Promise<ResultT>,
): Promise<Map<string, ResultT>> {
  const results = new Map<string, ResultT>()
  await Promise.all(groups.map(async (group, index) => {
    const worker = workers[index % workers.length]!
    for (const testPath of group) {
      results.set(testPath, await run(worker, testPath))
    }
  }))
  return results
}

function createTestWorkers(groupCount: number): CompilerWorkerSession[] {
  const size = Math.max(1, Math.min(groupCount, maxTestWorkers()))
  return Array.from({ length: size }, () => RuntimeTesting.TestCompiler.Worker.createSession())
}

function maxTestWorkers(): number {
  const envJobs = Number(Platform.runtimeProcess.env['TAO_TEST_JOBS'] ?? '')
  if (Number.isInteger(envJobs) && envJobs > 0) {
    return envJobs
  }
  return Platform.cpuCount()
}

/** runCompiledTaoTests runs the Jest harness for one already-compiled Tao test manifest. */
async function runCompiledTaoTests(
  compiled: CompiledTaoTests,
  options: { stdio?: CLI.CommandStdio } = {},
): Promise<CLI.CommandResult | undefined> {
  if (compiled.manifestPath === undefined || compiled.runtimeRoot === undefined) {
    return undefined
  }
  return await CLI.run(await testNodePath(), {
    args: [
      await testJestPath(compiled.runtimeRoot),
      '--config',
      'jest.tao-test.config.cjs',
      '--no-watchman',
    ],
    cwd: compiled.runtimeRoot,
    env: { [RuntimeTesting.TEST_MANIFEST_ENV]: compiled.manifestPath },
    stdio: options.stdio,
  })
}

async function testJestPath(runtimeRoot: string): Promise<string> {
  const explicitJest = Platform.runtimeProcess.env['TAO_TEST_JEST_PATH']
  if (explicitJest !== undefined) {
    return explicitJest
  }
  const localJest = FS.resolvePath('node_modules/jest/bin/jest.js', runtimeRoot)
  return await FS.isFile(localJest)
    ? localJest
    : FS.resolvePath('../../node_modules/jest/bin/jest.js', runtimeRoot)
}

/** validateTaoTestFiles validates Tao test files before starting the runtime harness. */
export async function validateTaoTestFiles(testPaths: readonly string[]): Promise<TaoTestValidationError[]> {
  const errorsByPath = new Map<string, TaoTestValidationError[]>()
  await forEachDirectoryGroup(testPaths, async (_directory, group) => {
    for (const testPath of group) {
      errorsByPath.set(testPath, await RuntimeTesting.TestCompiler.validateTestFile(testPath))
    }
  })
  return testPaths.flatMap(testPath => errorsByPath.get(testPath) ?? [])
}

/** findTaoTestFiles finds `.tao` files with Tao test declarations at or under `path`. */
export async function findTaoTestFiles(path: string): Promise<string[]> {
  // One parser context serves the whole discovery pass; sharing it also serializes the
  // parses so concurrent builds cannot interleave on its shared document store.
  const parserContext = Parser.createContext()
  const declared: string[] = []
  for (const filePath of await findTaoFiles(path)) {
    if (await fileDeclaresTaoTests(parserContext, filePath)) {
      declared.push(filePath)
    }
  }
  return declared.sort()
}

async function forEachDirectoryGroup(
  paths: readonly string[],
  runGroup: (directory: string, group: readonly string[]) => Promise<void>,
): Promise<void> {
  await Promise.all(
    [...groupPathsByDirectory(paths)].map(([directory, group]) => runGroup(directory, group)),
  )
}

function groupPathsByDirectory(paths: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const directory = FS.dirname(path)
    const group = groups.get(directory) ?? []
    group.push(path)
    groups.set(directory, group)
  }
  return groups
}

async function fileDeclaresTaoTests(parserContext: Parser.Context, path: string): Promise<boolean> {
  if (FS.extname(path) !== '.tao') {
    return false
  }
  const source = await FS.readText(path)
  if (!mayDeclareTaoTests(source)) {
    return false
  }
  const parsed = await Parser.parseSource(parserContext, source, {
    uri: Langium.URI.file(path),
    validation: false,
  })
  return parsed.entry.ast.statements.some(AST.isTestDeclaration)
}

function mayDeclareTaoTests(source: string): boolean {
  return /\btest(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*(?:\r?\n|$))*"/.test(source)
}

async function testNodePath(): Promise<string> {
  const explicitNode = Platform.runtimeProcess.env['TAO_TEST_NODE_PATH']
  if (explicitNode !== undefined) {
    return explicitNode
  }
  // `tao test` also runs against fixtures outside any Git worktree, where the repository's
  // pinned devenv Node cannot be located. Fall back to the Node on PATH instead of failing.
  const devenvNode = Repo.tryResolvePath('.devenv/profile/bin/node')
  if (devenvNode === undefined) {
    return 'node'
  }
  return await FS.isFile(devenvNode) ? devenvNode : 'node'
}

function testRuntimeRoot(): string {
  return Platform.runtimeProcess.env['TAO_TEST_RUNTIME_ROOT'] ?? RuntimeToolchainPaths.packageRoot
}

function writeTaoTestValidationErrors(errors: readonly TaoTestValidationError[]): void {
  for (const error of errors) {
    for (const message of error.messages) {
      HCI.writeErrorLine(`${FS.displayPath(error.path)}: ${message}`)
    }
  }
}
