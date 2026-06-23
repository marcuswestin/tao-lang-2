import { FS } from '@shared'
import { cleanup } from '@testing-library/react-native'
import { Workspace } from '@workspace'
import {
  compileAppForTest,
  type CompiledRuntimeApp,
  renderCompiledApp,
  type RuntimeScreen,
} from './test-compile-app'

type CompiledTestPlan = Awaited<ReturnType<typeof Workspace.compileTestPlan>>
type CompiledTestSuite = CompiledTestPlan['suites'][number]
type CompiledTestCheck = CompiledTestPlan['suites'][number]['checks'][number]
type CompiledTestExpectation = CompiledTestCheck['expectations'][number]

/** TaoTestRuntimeContext keeps reusable runtime state for one Tao test command run. */
export type TaoTestRuntimeContext = {
  compiledApps: Map<string, CompiledRuntimeApp>
}

/** createTaoTestRuntimeContext creates reusable runtime state for one Tao test command run. */
export function createTaoTestRuntimeContext(): TaoTestRuntimeContext {
  return { compiledApps: new Map() }
}

/** runTaoTestPlan runs a v0 Tao test-plan file through the Expo render harness. */
export async function runTaoTestPlan(
  testFilePath: string,
  context: TaoTestRuntimeContext = createTaoTestRuntimeContext(),
): Promise<void> {
  const plan = await Workspace.compileTestPlan(testFilePath)
  for (const suite of plan.suites) {
    for (const check of suite.checks) {
      await runCheck(suite, check, context)
    }
  }
}

async function runCheck(
  suite: CompiledTestSuite,
  check: CompiledTestCheck,
  context: TaoTestRuntimeContext,
): Promise<void> {
  try {
    const screen = renderCompiledApp(await compileCheckApp(check, context))
    for (const expectation of check.expectations) {
      assertExpectation(screen, expectation)
    }
  } catch (error) {
    throw new Error(
      `Tao check failed: ${suite.name} > ${check.name}\n${formatSource(check.source)}\n${formatError(error)}`,
    )
  } finally {
    cleanup()
  }
}

async function compileCheckApp(
  check: CompiledTestCheck,
  context: TaoTestRuntimeContext,
): Promise<CompiledRuntimeApp> {
  const cached = context.compiledApps.get(check.run.appSourcePath)
  if (cached) {
    return cached
  }
  const compiledApp = await compileAppForTest(check.run.appSourcePath)
  context.compiledApps.set(check.run.appSourcePath, compiledApp)
  return compiledApp
}

function assertExpectation(screen: RuntimeScreen, expectation: CompiledTestExpectation): void {
  const matches = screen.queryAllByText(expectation.text)
  if (expectation.kind === 'text' && matches.length === 0) {
    throw new Error(
      `${formatExpectation(expectation)} expected rendered text but found none.\n${formatSource(expectation.source)}`,
    )
  }
  if (expectation.kind === 'missingText' && matches.length > 0) {
    throw new Error(
      `${formatExpectation(expectation)} expected no rendered text but found ${matches.length} ${
        matches.length === 1 ? 'match' : 'matches'
      }.\n${formatSource(expectation.source)}`,
    )
  }
}

function formatExpectation(expectation: CompiledTestExpectation): string {
  return expectation.kind === 'missingText'
    ? `expect missing text "${expectation.text}"`
    : `expect text "${expectation.text}"`
}

function formatSource(source: CompiledTestCheck['source']): string {
  const range = source.range
  const line = range === undefined ? '' : `:${range.start.line + 1}:${range.start.character + 1}`
  return `Source: ${displayPath(source.filePath)}${line}`
}

function displayPath(path: string): string {
  const relative = FS.relativePath(FS.repoPath(), path)
  return relative.startsWith('..') ? path : relative
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
