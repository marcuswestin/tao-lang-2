import { RuntimeToolchainPaths } from '@expo-host'
import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { AST, Langium, Parser } from '@parser'
import { CLI, Errors, FS, HCI, Platform, Repo, TaoTestProtocol } from '@shared'
import { TaoAppModules } from './app-modules'
import { findTaoFiles } from './tao-files'
import { type FingerprintRequest, TestCache } from './test-cache'
import { TestOutput, type TestOutputMode } from './test-output'

/** CompiledTaoTests declares the files and generated manifest for one Tao test run. */
type CompiledTaoTests = {
  /** True when this run took a previous passing run's output instead of compiling its own. */
  reused?: boolean
  manifestPath?: string
  runRoot?: string
  runtimeRoot?: string
  testPaths: readonly string[]
}

/** TestCommandOptions configures one `tao test` run. */
export type TestCommandOptions = {
  /** Run only the journeys whose full name matches this pattern, instead of every journey found. */
  name?: string
  output?: TestOutputMode
  /**
   * Report a `--name` pattern that selects no journey as a finished run of nothing rather than as a
   * user error. A person who typed the pattern wants the error; a scheduler that hands the same
   * pattern to every suite it knows about wants the suites the pattern cannot describe to sit out
   * quietly instead of turning the whole filtered run red. Bun and Jest both offer this, and the
   * spelling here is Bun's, because Bun is the neighbouring runner in this repository.
   */
  passWithNoTests?: boolean
}

/** CompletedTestRun records one finished test runner process and everything it wrote. */
type CompletedTestRun = {
  output: string
  result?: CLI.CommandResult
}

/** TaoTestValidationError declares validation errors found before the runtime test harness starts. */
type TaoTestValidationError = RuntimeTesting.TestCompiler.ValidationError

/** TestRunOutcome reports whether one repeatable run of the selected test set failed. */
export type TestRunOutcome = { failed: boolean }

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
  try {
    const outcome = await runTestCommandOnce(paths, options)
    if (outcome.failed) {
      Platform.runtimeProcess.exit(1)
    }
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

/**
 * runTestCommandOnce runs the selected test set exactly once and reports whether it failed, instead
 * of exiting the process. `--watch` calls this directly, once per debounced change, so that a
 * failing run reports through the same output path a one-shot `tao test` uses without ending the
 * watch loop; `runTestCommand` is the one-shot entry point that turns a failing outcome into the
 * process exit code a plain `tao test` invocation reports.
 */
export async function runTestCommandOnce(
  paths: string | readonly string[],
  options: TestCommandOptions = {},
): Promise<TestRunOutcome> {
  const mode = options.output ?? 'lines'
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
    return { failed: false }
  }
  for (const testPath of testPaths) {
    await TaoAppModules.ensureForPath(testPath)
  }
  HCI.logProcessInfo('test', `Found ${testPaths.length} Tao test ${testPaths.length === 1 ? 'file' : 'files'}`)
  const runtimeRoot = testRuntimeRoot()
  const fingerprint = await reusableRunFingerprint({ roots, runtimeRoot, testPaths })
  const compiled = await reusedTaoTests(fingerprint, runtimeRoot, testPaths)
    ?? await validateAndCompileTaoTests(testPaths, runtimeRoot)
  if (compiled === 'validation-failed') {
    return { failed: true }
  }
  if (!await reportSelectedJourneys(compiled, options, fingerprint, displayRoots)) {
    return { failed: false }
  }
  HCI.logProcessInfo('test', 'Running Tao tests')
  const run = await runCompiledTaoTests(compiled, mode, options.name)
  const failed = run.result === undefined || run.result.error !== undefined || run.result.exitCode !== 0
  // The log lives in the run root, which a failing run keeps as its debugging artifact alongside
  // the generated code, and which a passing run either publishes for reuse or discards below.
  const logPath = await writeTestOutputLog(compiled, run.output)
  TestOutput.reportFinishedRun({ failed, logPath, mode, output: run.output })
  if (failed) {
    if (run.result?.error) {
      HCI.writeErrorLine(Errors.formatForUser(run.result.error))
    }
    return { failed: true }
  }
  await keepOrDiscardRunRoot(compiled, fingerprint)
  HCI.logProcessInfo('test', 'Tao tests finished')
  return { failed: false }
}

/**
 * reusableRunFingerprint identifies output this run may take from a previous one, or undefined when
 * it must compile for itself. An unset fingerprint is the whole of the opt-out: nothing is looked
 * up, and nothing this run produces is published.
 */
async function reusableRunFingerprint(request: FingerprintRequest): Promise<string | undefined> {
  return TestCache.disabled() ? undefined : await TestCache.fingerprint(request)
}

/**
 * reusedTaoTests returns a previous passing run's compiled output for this exact run, skipping both
 * the validate and the compile phase. The phases are skipped together on purpose: the same sources,
 * read by the same validator, produced no errors last time and cannot produce one now.
 */
async function reusedTaoTests(
  fingerprint: string | undefined,
  runtimeRoot: string,
  testPaths: readonly string[],
): Promise<CompiledTaoTests | undefined> {
  if (fingerprint === undefined) {
    return undefined
  }
  const cached = await RuntimeTesting.TestRunRoot.lookup(TestCache.CATEGORY, fingerprint, {
    runtimePackageRoot: runtimeRoot,
  })
  if (cached === undefined) {
    return undefined
  }
  HCI.logProcessInfo('test', 'Reusing compiled apps (nothing they are built from has changed)')
  return { manifestPath: cached.manifestPath, reused: true, runRoot: cached.runRoot, runtimeRoot, testPaths }
}

/**
 * keepOrDiscardRunRoot settles what a passing run leaves behind. Output a later identical run can
 * take is kept under its fingerprint; everything else is discarded exactly as before. A failing run
 * never reaches here, so a failure is never published and its root stays for debugging.
 */
async function keepOrDiscardRunRoot(compiled: CompiledTaoTests, fingerprint: string | undefined): Promise<void> {
  if (compiled.runRoot === undefined) {
    return
  }
  if (compiled.reused === true) {
    return
  }
  const options = { runtimePackageRoot: compiled.runtimeRoot }
  const published = fingerprint !== undefined
    && await RuntimeTesting.TestRunRoot.publish(TestCache.CATEGORY, fingerprint, compiled.runRoot, options)
  if (!published) {
    await RuntimeTesting.TestRunRoot.discard(compiled.runRoot, options)
  }
}

/**
 * reportSelectedJourneys settles what a `--name` pattern selected, before the runner starts, and
 * answers whether there is a run left to make.
 *
 * A pattern that matches nothing is reported as the user error it is rather than run: the runner
 * would otherwise filter every case out, print a run with no tests in it, and exit zero — a green
 * that proves nothing. `--pass-with-no-tests` is how a caller says that an empty selection is an
 * expected answer rather than a mistake, which is what a scheduler handing one pattern to every
 * suite it knows about needs: a Tao journey will never be named like a Bun test, so without it one
 * filtered run turns the whole scheduled sweep red.
 *
 * Nothing ran, but something was compiled, and the fingerprint is over the sources and the run's
 * shape rather than over which journeys a pattern selected — so this output is exactly what the
 * next run of the same shape would build. It is published like any other. Discarding it made every
 * name-filtered `just test` recompile every app, which is the common case rather than a rare one:
 * a scheduler hands its pattern to this suite on every filtered run precisely because the pattern
 * usually matches no journey.
 */
async function reportSelectedJourneys(
  compiled: CompiledTaoTests,
  options: TestCommandOptions,
  fingerprint: string | undefined,
  displayRoots: string,
): Promise<boolean> {
  const pattern = options.name
  if (pattern === undefined) {
    return true
  }
  const journeys = await compiledJourneyNames(compiled)
  const matcher = journeyMatcher(pattern)
  const matched = journeys.filter(journey => matcher.test(journey))
  if (matched.length === 0) {
    await keepOrDiscardRunRoot(compiled, fingerprint)
    const searched = `Searched ${journeys.length} ${
      journeys.length === 1 ? 'journey' : 'journeys'
    } under ${displayRoots}`
    if (options.passWithNoTests === true) {
      // The marker a scheduler reads to tell this pass from a pass that ran something. `tao test`
      // writes no per-test report, so this line is the only evidence either way.
      HCI.writeLine(
        `No Tao test journey matches --name ${JSON.stringify(pattern)}. ${searched}; `
          + `${TaoTestProtocol.NO_JOURNEYS_MATCHED}.`,
      )
      return false
    }
    Errors.throwUserInput(
      `No Tao test journey matches --name ${
        JSON.stringify(pattern)
      }. ${searched}; run tao test without --name to run them all.`,
    )
  }
  HCI.logProcessInfo(
    'test',
    `Selected ${matched.length} of ${journeys.length} Tao ${journeys.length === 1 ? 'journey' : 'journeys'}`,
  )
  return true
}

/**
 * journeyMatcher reads a `--name` pattern exactly as the test runner reads `--testNamePattern`: an
 * unanchored, case-insensitive regular expression. The two must agree, because this command decides
 * whether anything was selected and the runner decides what actually runs.
 */
function journeyMatcher(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i')
  } catch (error) {
    return Errors.throwUserInput(
      `--name ${JSON.stringify(pattern)} is not a valid regular expression: ${Errors.messageOf(error)}`,
    )
  }
}

/** compiledJourneyNames lists every journey in one compiled run under the name the runner gives it. */
async function compiledJourneyNames(compiled: CompiledTaoTests): Promise<string[]> {
  if (compiled.manifestPath === undefined) {
    return []
  }
  const manifest = await FS.readJson<RuntimeTesting.TestCompiler.Manifest>(compiled.manifestPath)
  return manifest.files.flatMap(file =>
    file.suites.flatMap(suite => suite.checks.map(check => RuntimeTesting.TestCaseName.full(file, suite, check)))
  )
}

type CompilerWorkerSession = ReturnType<typeof RuntimeTesting.TestCompiler.Worker.createSession>

/** ValidationFailed marks a run whose Tao test files failed preflight validation. */
type ValidationFailed = 'validation-failed'

// Validation and compilation run across a pool of compiler worker processes: each directory group
// stays on one worker so its files share that worker's workspace, and one worker's requests run
// serially in its process while distinct workers run in parallel.
async function validateAndCompileTaoTests(
  testPaths: readonly string[],
  runtimeRoot: string,
): Promise<CompiledTaoTests | ValidationFailed> {
  if (Platform.runtimeProcess.env['TAO_TEST_IN_PROCESS'] === 'true') {
    return await validateAndCompileTaoTestsInProcess(testPaths, runtimeRoot)
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
      return 'validation-failed'
    }

    HCI.logProcessInfo('test', 'Compiling apps')
    const runRoot = await RuntimeTesting.TestRunRoot.create(TestCache.CATEGORY, { runtimePackageRoot: runtimeRoot })
    const filesByPath = await mapTestFilesOnWorkers(
      groups,
      workers,
      async (worker, testPath) => await worker.compileTestPlan(testPath, { runRoot, skipValidation: true }),
    )
    const manifestPath = FS.resolvePath(RuntimeTesting.TestRunRoot.MANIFEST_FILE_NAME, runRoot)
    await FS.writeJson(manifestPath, {
      files: testPaths.map(testPath => filesByPath.get(testPath)!),
    })
    return { manifestPath, runRoot, runtimeRoot, testPaths }
  } finally {
    await Promise.all(workers.map(worker => worker.stop()))
  }
}

async function validateAndCompileTaoTestsInProcess(
  testPaths: readonly string[],
  runtimeRoot: string,
): Promise<CompiledTaoTests | ValidationFailed> {
  HCI.logProcessInfo('test', 'Validating Tao test files (packaged runner)')
  const validationErrors = (await Promise.all(
    testPaths.map(testPath => RuntimeTesting.TestCompiler.validateTestFile(testPath)),
  )).flat()
  if (validationErrors.length > 0) {
    writeTaoTestValidationErrors(validationErrors)
    return 'validation-failed'
  }
  HCI.logProcessInfo('test', 'Compiling apps')
  const runRoot = await RuntimeTesting.TestRunRoot.create(TestCache.CATEGORY, { runtimePackageRoot: runtimeRoot })
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
  const manifestPath = FS.resolvePath(RuntimeTesting.TestRunRoot.MANIFEST_FILE_NAME, runRoot)
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
 *   for `tao test`. It bounds the compiler worker pool, the test runner child's own `--maxWorkers`,
 *   and the number of Jest entrypoints the run is split into, so the reservation bounds the whole
 *   command rather than one part of it. Splitting further than the budget buys no parallelism and
 *   costs one module registry per extra entrypoint, so the budget is the ceiling on the split too.
 * - `TAO_TEST_IN_PROCESS`: `true` validates and compiles in this process instead of worker
 *   processes, for the packaged runner that ships without a worker entrypoint.
 * - `TAO_TEST_NO_CACHE`: `true` validates and compiles from source however unchanged the inputs
 *   are, and publishes nothing for a later run. `test-cache.ts` owns the name and the identity it
 *   switches off; a lane running `--no-cache` sets it, because a memoized compile is not fresh work.
 * - `TAO_TEST_JEST_PATH`: the test runner entrypoint to execute instead of the resolved one.
 * - `TAO_TEST_NODE_PATH`: the Node executable that runs it instead of the pinned repository Node.
 * - `TAO_TEST_RUNTIME_ROOT`: the expo-host package root one run compiles into.
 * - `TAO_TEST_RUNTIME_MANIFEST`: set by this command for its child; `RuntimeTesting` owns the name.
 * - `TAO_TEST_RUNTIME_ENTRYPOINTS`: set by this command for its child, naming the generated Jest
 *   entrypoints its run is split into; `TestHarnessFiles` owns the name.
 */
function taoTestJobs(): number | undefined {
  const envJobs = Number(Platform.runtimeProcess.env['TAO_TEST_JOBS'] ?? '')
  return Number.isInteger(envJobs) && envJobs > 0 ? envJobs : undefined
}

/**
 * runCompiledTaoTests runs the Jest harness for one already-compiled Tao test manifest, forwarding
 * its output as it arrives and returning the whole of it in the order the runner produced it.
 */
async function runCompiledTaoTests(
  compiled: CompiledTaoTests,
  mode: TestOutputMode,
  namePattern: string | undefined,
): Promise<CompletedTestRun> {
  if (compiled.manifestPath === undefined || compiled.runtimeRoot === undefined || compiled.runRoot === undefined) {
    return { output: '' }
  }
  const writer = TestOutput.createWriter(mode)
  const chunks: Buffer[] = []
  const entrypoints = await writeJourneyEntrypoints(compiled.manifestPath, compiled.runRoot, namePattern)
  const result = await CLI.run(await testNodePath(), {
    args: [
      await testJestPath(compiled.runtimeRoot),
      '--config',
      'jest.tao-test.config.cjs',
      '--no-watchman',
      // The run was split into exactly the entrypoints its worker budget affords, so the pool is
      // sized to the split rather than to the machine: every worker gets one entrypoint, and no
      // worker waits behind another for a second one.
      `--maxWorkers=${Math.max(1, entrypoints.shardCount)}`,
      // One Jest case per Tao journey is what makes this select a journey rather than a whole file.
      ...(namePattern === undefined ? [] : ['--testNamePattern', namePattern]),
    ],
    cwd: compiled.runtimeRoot,
    env: {
      [RuntimeTesting.TEST_MANIFEST_ENV]: compiled.manifestPath,
      [RuntimeTesting.TestHarnessFiles.ENTRYPOINTS_ENV]: entrypoints.directory,
    },
    onOutput: (_stream, chunk) => {
      chunks.push(chunk)
      writer?.write(chunk)
    },
    stdio: 'pipe',
  })
  writer?.flush()
  return { output: Buffer.concat(chunks).toString('utf8'), result }
}

/**
 * writeJourneyEntrypoints generates the Jest entrypoints this run is started through.
 *
 * They are generated per run rather than per compile because how many there are is the run's worker
 * budget, and a reused run root was compiled under whatever budget its own run happened to have.
 * The manifest is read back for the same reason: on the reused path it is the only description of
 * the run this process holds. They are written beside the run root rather than into it, so the
 * directory Jest is configured with stays put across compiles; `TestHarnessFiles.write` owns why.
 */
async function writeJourneyEntrypoints(
  manifestPath: string,
  runRoot: string,
  namePattern: string | undefined,
): Promise<RuntimeTesting.TestHarnessFiles.Generated> {
  const manifest = await FS.readJson<RuntimeTesting.TestCompiler.Manifest>(manifestPath)
  return await RuntimeTesting.TestHarnessFiles.write(
    FS.dirname(runRoot),
    selectableFiles(manifest, namePattern),
    maxTestWorkers(),
  )
}

/**
 * selectableFiles drops the Tao test files a `--name` pattern can select nothing from. The runner
 * filters by case name and reaches the same journeys either way, but it pays for a module registry
 * per entrypoint it opens, so an entrypoint holding nothing the pattern selects is a worker that
 * loads React Native to run no journey. Selecting one journey out of a corpus is the inner loop this
 * protects; the count the command itself reports is still taken from the whole manifest.
 */
function selectableFiles(
  manifest: RuntimeTesting.TestCompiler.Manifest,
  namePattern: string | undefined,
): RuntimeTesting.TestCompiler.Manifest {
  if (namePattern === undefined) {
    return manifest
  }
  const matcher = journeyMatcher(namePattern)
  return {
    files: manifest.files.filter(file =>
      file.suites.some(suite =>
        suite.checks.some(check => matcher.test(RuntimeTesting.TestCaseName.full(file, suite, check)))
      )
    ),
  }
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
    : FS.resolvePath('../../../node_modules/jest/bin/jest.js', runtimeRoot)
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
