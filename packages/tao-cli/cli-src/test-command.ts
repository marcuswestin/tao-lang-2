import { AST, Langium, Parser } from '@parser'
import { RuntimeToolchainPaths } from '@runtime-toolchain'
import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { TaoAppModules } from './app-modules'
import { findTaoFiles } from './tao-files'
import { TestOutput, type TestOutputMode } from './test-output'

/** CompiledTaoTests declares the files and generated manifest for one Tao test run. */
type CompiledTaoTests = {
  manifestPath?: string
  runRoot?: string
  runtimeRoot?: string
  testPaths: readonly string[]
}

/** TestCommandOptions configures one `tao test` run. */
export type TestCommandOptions = {
  output?: TestOutputMode
}

/** CompletedTestRun records one finished test runner process and everything it wrote. */
type CompletedTestRun = {
  output: string
  result?: CLI.CommandResult
}

/** TaoTestValidationError declares validation errors found before the runtime test harness starts. */
type TaoTestValidationError = RuntimeTesting.TestCompiler.ValidationError

/**
 * runTestCommand runs the user-facing `tao test` command for one or more paths, compiled and run as
 * one plan. `options.output` selects how the test runner's own output is reported; a caller that
 * does not choose gets the streamed lines, because an embedding host — Tao Studio's packaged
 * runner — reads the whole stream. The CLI resolves the mode from `--output` and the terminal
 * before calling here.
 */
export async function runTestCommand(
  paths: string | readonly string[],
  options: TestCommandOptions = {},
): Promise<void> {
  const mode = options.output ?? 'lines'
  try {
    const roots = (typeof paths === 'string' ? [paths] : paths).map(path => FS.resolvePath(path))
    const displayRoots = roots.map(root => FS.displayPath(root)).join(', ')
    HCI.logProcessInfo('test', `Finding Tao tests under ${displayRoots}`)
    const found = new Set<string>()
    for (const root of roots) {
      for (const testPath of await findTaoTestFiles(root)) {
        found.add(testPath)
      }
    }
    const testPaths = [...found].sort()
    if (testPaths.length === 0) {
      HCI.writeLine(`No Tao tests found under ${displayRoots}`)
      return
    }
    for (const testPath of testPaths) {
      await TaoAppModules.ensureForPath(testPath)
    }
    HCI.logProcessInfo('test', `Found ${testPaths.length} Tao test ${testPaths.length === 1 ? 'file' : 'files'}`)
    const compiled = await validateAndCompileTaoTests(testPaths)
    HCI.logProcessInfo('test', 'Running Tao tests')
    const run = await runCompiledTaoTests(compiled, mode)
    const failed = run.result === undefined || run.result.error !== undefined || run.result.exitCode !== 0
    // The log lives in the run root, which a failing run keeps as its debugging artifact alongside
    // the generated code, and which a passing run discards below.
    const logPath = await writeTestOutputLog(compiled, run.output)
    TestOutput.reportFinishedRun({ failed, logPath, mode, output: run.output })
    if (failed) {
      if (run.result?.error) {
        HCI.writeErrorLine(Errors.formatForUser(run.result.error))
      }
      Platform.runtimeProcess.exit(1)
    }
    if (compiled.runRoot !== undefined) {
      await RuntimeTesting.TestRunRoot.discard(compiled.runRoot, { runtimePackageRoot: compiled.runtimeRoot })
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
    const runRoot = await RuntimeTesting.TestRunRoot.create('tao-test-command', { runtimePackageRoot: runtimeRoot })
    const filesByPath = await mapTestFilesOnWorkers(
      groups,
      workers,
      async (worker, testPath) => await worker.compileTestPlan(testPath, { runRoot, skipValidation: true }),
    )
    const manifestPath = FS.resolvePath('manifest.json', runRoot)
    await FS.writeJson(manifestPath, {
      files: testPaths.map(testPath => filesByPath.get(testPath)!),
    })
    return { manifestPath, runRoot, runtimeRoot, testPaths }
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
  const runRoot = await RuntimeTesting.TestRunRoot.create('tao-test-command', { runtimePackageRoot: runtimeRoot })
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
  return { manifestPath, runRoot, runtimeRoot, testPaths }
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
  return taoTestJobs() ?? Platform.cpuCount()
}

/*
 * The `TAO_TEST_*` environment contract, read here and below. Every key is optional; an unset key
 * leaves this command resolving the value itself.
 *
 * - `TAO_TEST_JOBS`: worker budget for one run, set by an outer scheduler that reserved that width
 *   for `tao test`. It bounds both the compiler worker pool and the test runner child's own
 *   `--maxWorkers`, so the reservation bounds the whole command rather than one half of it.
 * - `TAO_TEST_IN_PROCESS`: `true` validates and compiles in this process instead of worker
 *   processes, for the packaged runner that ships without a worker entrypoint.
 * - `TAO_TEST_JEST_PATH`: the test runner entrypoint to execute instead of the resolved one.
 * - `TAO_TEST_NODE_PATH`: the Node executable that runs it instead of the pinned repository Node.
 * - `TAO_TEST_RUNTIME_ROOT`: the runtime-toolchain package root one run compiles into.
 * - `TAO_TEST_RUNTIME_MANIFEST`: set by this command for its child; `RuntimeTesting` owns the name.
 */
function taoTestJobs(): number | undefined {
  const envJobs = Number(Platform.runtimeProcess.env['TAO_TEST_JOBS'] ?? '')
  return Number.isInteger(envJobs) && envJobs > 0 ? envJobs : undefined
}

/**
 * runCompiledTaoTests runs the Jest harness for one already-compiled Tao test manifest, forwarding
 * its output as it arrives and returning the whole of it in the order the runner produced it.
 */
async function runCompiledTaoTests(compiled: CompiledTaoTests, mode: TestOutputMode): Promise<CompletedTestRun> {
  if (compiled.manifestPath === undefined || compiled.runtimeRoot === undefined) {
    return { output: '' }
  }
  const writer = TestOutput.createWriter(mode)
  const chunks: Buffer[] = []
  const jobs = taoTestJobs()
  const result = await CLI.run(await testNodePath(), {
    args: [
      await testJestPath(compiled.runtimeRoot),
      '--config',
      'jest.tao-test.config.cjs',
      '--no-watchman',
      // An outer scheduler reserves a fixed width for this whole command, so the Jest child is held
      // to the same budget as the compiler worker pool rather than sizing itself to the machine.
      ...(jobs === undefined ? [] : [`--maxWorkers=${jobs}`]),
    ],
    cwd: compiled.runtimeRoot,
    env: { [RuntimeTesting.TEST_MANIFEST_ENV]: compiled.manifestPath },
    onOutput: (_stream, chunk) => {
      chunks.push(chunk)
      writer?.write(chunk)
    },
    stdio: 'pipe',
  })
  writer?.flush()
  return { output: Buffer.concat(chunks).toString('utf8'), result }
}

/** writeTestOutputLog keeps one run's whole test output beside the code that run generated. */
async function writeTestOutputLog(compiled: CompiledTaoTests, output: string): Promise<string | undefined> {
  if (compiled.runRoot === undefined || output.length === 0) {
    return undefined
  }
  const logPath = FS.resolvePath(TestOutput.LOG_FILE_NAME, compiled.runRoot)
  await FS.writeText(logPath, output)
  return logPath
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
