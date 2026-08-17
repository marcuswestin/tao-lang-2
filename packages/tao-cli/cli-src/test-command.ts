import { AST, Langium, Parser } from '@parser'
import { RuntimeToolchainPaths } from '@runtime-toolchain'
import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { CLI, Diagnostics, Errors, FS, HCI, Platform, Repo } from '@shared'
import Workspace from '@workspace'
import { findTaoFiles } from './tao-files'

/** TaoTestRunResult declares the files selected for one Tao test command run. */
type TaoTestRunResult = {
  commandResult?: CLI.CommandResult
  testPaths: readonly string[]
  validationErrors?: readonly TaoTestValidationError[]
}

/** TaoTestValidationError declares validation errors found before the runtime test harness starts. */
type TaoTestValidationError = {
  path: string
  messages: readonly string[]
}

type RunTestOptions = {
  stdio?: CLI.CommandStdio
  testPaths?: readonly string[]
} & RuntimeTesting.TestCompiler.ValidationOptions

type WriteTestManifestOptions = {
  runtimeRoot: string
} & RuntimeTesting.TestCompiler.ValidationOptions

/** runTestCommand runs the user-facing `tao test` command for one path. */
export async function runTestCommand(path: string): Promise<void> {
  try {
    const root = FS.resolvePath(path)
    HCI.logProcessInfo('test', `Finding Tao tests under ${displayPath(root)}`)
    const testPaths = await findTaoTestFiles(root)
    if (testPaths.length === 0) {
      HCI.writeLine(`No Tao tests found under ${displayPath(root)}`)
      return
    }
    HCI.logProcessInfo('test', `Found ${testPaths.length} Tao test ${testPaths.length === 1 ? 'file' : 'files'}`)
    HCI.logProcessInfo('test', 'Validating Tao test files')
    const validationErrors = await validateTaoTestFiles(testPaths)
    if (validationErrors.length > 0) {
      writeTaoTestValidationErrors(validationErrors)
      Platform.runtimeProcess.exit(1)
    }
    HCI.logProcessInfo('test', 'Compiling apps and running Tao tests')
    const result = await runTest(root, { stdio: 'pipe', testPaths, skipValidation: true })
    const commandResult = result.commandResult
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

/** runTest discovers and runs every `.tao` file with Tao test declarations at or under `path`. */
async function runTest(path = '.', options: RunTestOptions = {}): Promise<TaoTestRunResult> {
  const root = FS.resolvePath(path)
  const testPaths = options.testPaths ?? await findTaoTestFiles(root)
  if (testPaths.length === 0) {
    return { testPaths }
  }

  if (!options.skipValidation) {
    const validationErrors = await validateTaoTestFiles(testPaths)
    if (validationErrors.length > 0) {
      return { testPaths, validationErrors }
    }
  }

  const runtimeRoot = RuntimeToolchainPaths.packageRoot
  const manifestPath = await writeTestManifest(testPaths, {
    runtimeRoot,
    skipValidation: options.skipValidation,
  })
  const result = await CLI.run(await testNodePath(), {
    args: [
      'node_modules/jest/bin/jest.js',
      '--config',
      'jest.tao-test.config.cjs',
    ],
    cwd: runtimeRoot,
    env: { [RuntimeTesting.TEST_MANIFEST_ENV]: manifestPath },
    stdio: options.stdio,
  })
  return { commandResult: result, testPaths }
}

async function writeTestManifest(
  testPaths: readonly string[],
  options: WriteTestManifestOptions,
): Promise<string> {
  const runRoot = FS.resolvePath(
    `_gen_tao-app-test/tao-test-command/${RuntimeTesting.TestRunId.create()}`,
    options.runtimeRoot,
  )
  const manifestPath = FS.resolvePath('manifest.json', runRoot)
  const context: RuntimeTesting.TestCompiler.Context = { appModulePaths: new Map<string, string>(), runRoot }
  const compileOptions: RuntimeTesting.TestCompiler.CompileFileOptions = {
    context,
    skipValidation: options.skipValidation,
  }
  const compiledByPath = new Map<string, RuntimeTesting.TestCompiler.File>()

  await FS.mkdir(runRoot)
  await forEachDirectoryGroup(testPaths, async (_directory, group) => {
    for (const testPath of group) {
      compiledByPath.set(testPath, await RuntimeTesting.TestCompiler.compileTestFile(testPath, compileOptions))
    }
  })
  await FS.writeJson(manifestPath, {
    files: testPaths.map(testPath => compiledByPath.get(testPath)!),
  })
  return manifestPath
}

/** validateTaoTestFiles validates Tao test files before starting the runtime harness. */
export async function validateTaoTestFiles(testPaths: readonly string[]): Promise<TaoTestValidationError[]> {
  const errorsByPath = new Map<string, TaoTestValidationError[]>()
  await forEachDirectoryGroup(testPaths, async (directory, group) => {
    const workspace = await Workspace.shared(directory)
    for (const testPath of group) {
      errorsByPath.set(testPath, validationErrorsFor(await workspace.validate(testPath), testPath))
    }
  })
  return testPaths.flatMap(testPath => errorsByPath.get(testPath) ?? [])
}

function validationErrorsFor(
  validationResult: Awaited<ReturnType<typeof Workspace.validate>>,
  testPath: string,
): TaoTestValidationError[] {
  const messagesByPath = new Map<string, string[]>()
  for (const diagnostic of Diagnostics.errors(validationResult.diagnostics)) {
    const path = diagnostic.filePath ?? testPath
    const messages = messagesByPath.get(path) ?? []
    messages.push(diagnostic.message)
    messagesByPath.set(path, messages)
  }
  return [...messagesByPath].map(([path, messages]) => ({ path, messages }))
}

/** findTaoTestFiles finds `.tao` files with Tao test declarations at or under `path`. */
export async function findTaoTestFiles(path: string): Promise<string[]> {
  const declared = await Promise.all(
    (await findTaoFiles(path)).map(async filePath => await fileDeclaresTaoTests(filePath) ? filePath : undefined),
  )
  return declared.filter(filePath => filePath !== undefined).sort()
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

async function fileDeclaresTaoTests(path: string): Promise<boolean> {
  if (FS.extname(path) !== '.tao') {
    return false
  }
  const source = await FS.readText(path)
  if (!mayDeclareTaoTests(source)) {
    return false
  }
  const parsed = await Parser.parseSource(Parser.createContext(), source, {
    uri: Langium.URI.file(path),
    validation: false,
  })
  return parsed.entry.ast.statements.some(AST.isTestDeclaration)
}

function mayDeclareTaoTests(source: string): boolean {
  return /\btest(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*(?:\r?\n|$))*"/.test(source)
}

async function testNodePath(): Promise<string> {
  const devenvNode = Repo.resolvePath('.devenv/profile/bin/node')
  return await FS.isFile(devenvNode) ? devenvNode : 'node'
}

function displayPath(path: string): string {
  const relative = FS.relativePath(FS.resolvePath('.'), path)
  return relative === '' ? '.' : relative
}

function writeTaoTestValidationErrors(errors: readonly TaoTestValidationError[]): void {
  for (const error of errors) {
    for (const message of error.messages) {
      HCI.writeErrorLine(`${displayPath(error.path)}: ${message}`)
    }
  }
}
