import { AST } from '@parser'
import { CLI, Diagnostics, FS } from '@shared'
import Workspace from '@workspace'
import { findTaoFiles } from './tao-files'

const TEST_PLAN_ENV = 'TAO_TEST_PLAN_PATHS'

/** TaoTestRunResult declares the files selected for one Tao test command run. */
export type TaoTestRunResult = {
  commandResult?: CLI.CommandResult
  testPaths: readonly string[]
  validationErrors?: readonly TaoTestValidationError[]
}

/** TaoTestValidationError declares validation errors found before the runtime test harness starts. */
export type TaoTestValidationError = {
  path: string
  messages: readonly string[]
}

type RunTestOptions = {
  stdio?: CLI.CommandStdio
  testPaths?: readonly string[]
  skipValidation?: boolean
}

/** runTest discovers and runs every `.tao` file with Tao test declarations at or under `path`. */
export async function runTest(path = '.', options: RunTestOptions = {}): Promise<TaoTestRunResult> {
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

  const runtimeRoot = FS.repoPath('packages/runtime')
  const result = await CLI.run(await testNodePath(), {
    args: [
      'node_modules/jest/bin/jest.js',
      '--runInBand',
      '--watchman=false',
      '--testMatch',
      '**/runtime-tests/tao-test-command.jest.tsx',
    ],
    cwd: runtimeRoot,
    env: {
      [TEST_PLAN_ENV]: JSON.stringify(testPaths),
    },
    stdio: options.stdio,
  })
  return { commandResult: result, testPaths }
}

/** validateTaoTestFiles validates Tao test files before starting the runtime harness. */
export async function validateTaoTestFiles(testPaths: readonly string[]): Promise<TaoTestValidationError[]> {
  const validationErrors: TaoTestValidationError[] = []
  for (const testPath of testPaths) {
    const validationResult = await Workspace.validate(testPath)
    const messagesByPath = new Map<string, string[]>()
    for (const diagnostic of Diagnostics.errors(validationResult.diagnostics)) {
      const path = diagnostic.filePath ?? testPath
      const messages = messagesByPath.get(path) ?? []
      messages.push(diagnostic.message)
      messagesByPath.set(path, messages)
    }
    for (const [path, messages] of messagesByPath) {
      validationErrors.push({ path, messages })
    }
  }
  return validationErrors
}

/** findTaoTestFiles finds `.tao` files with Tao test declarations at or under `path`. */
export async function findTaoTestFiles(path: string): Promise<string[]> {
  const testPaths: string[] = []
  for (const filePath of await findTaoFiles(path)) {
    if (await fileDeclaresTaoTests(filePath)) {
      testPaths.push(filePath)
    }
  }
  return testPaths.sort()
}

async function fileDeclaresTaoTests(path: string): Promise<boolean> {
  if (FS.extname(path) !== '.tao') {
    return false
  }
  const source = await FS.readText(path)
  if (!/\btest\s+"/.test(source)) {
    return false
  }
  const parsed = await Workspace.parse(path)
  return parsed.entry.ast.statements.some(AST.isTestDeclaration)
}

async function testNodePath(): Promise<string> {
  const devenvNode = FS.repoPath('.devenv/profile/bin/node')
  return await FS.isFile(devenvNode) ? devenvNode : 'node'
}
