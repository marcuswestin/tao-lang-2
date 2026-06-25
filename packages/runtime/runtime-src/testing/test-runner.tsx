import { Switch } from '@shared/core'
import { fireEvent } from '@testing-library/react-native'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import type * as TestCompiler from './test-compiler/TestCompiler'

/** runTestFile runs one precompiled Tao test file through the Expo render harness. */
export async function runTestFile(file: TestCompiler.File): Promise<void> {
  for (const suite of file.suites) {
    for (const check of suite.checks) {
      await runCheck(suite.name, check)
    }
  }
}

async function runCheck(suiteName: string, check: TestCompiler.Check): Promise<void> {
  let screen: RuntimeApp.Screen | undefined
  try {
    screen = renderCompiledApp({ testAppPath: check.app.modulePath })
    for (const step of check.steps) {
      runStep(screen, step)
    }
  } catch (error) {
    throw new Error(
      `Tao check failed: ${suiteName} > ${check.name}\n${formatSource(check.source)}\n${formatError(error)}`,
    )
  } finally {
    screen?.unmount()
  }
}

function runStep(screen: RuntimeApp.Screen, step: TestCompiler.Step): void {
  return Switch.kind<TestCompiler.Step, void>(step, {
    expect: expectation => assertExpectation(screen, expectation),
    press: press => pressStep(screen, press),
  })
}

function pressStep(screen: RuntimeApp.Screen, step: Extract<TestCompiler.Step, { kind: 'press' }>): void {
  assertTextSelector(step)
  const matches = screen.queryAllByText(step.text)
  if (matches.length === 0) {
    throw new Error(
      `${formatStep(step)} expected pressable rendered text but found none.\n${formatSource(step.source)}`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `${formatStep(step)} expected one pressable rendered text but found ${matches.length} matches.\n${
        formatSource(step.source)
      }`,
    )
  }
  const match = matches[0]
  if (match === undefined) {
    throw new Error(`${formatStep(step)} expected one pressable rendered text but found none.`)
  }
  fireEvent.press(match)
}

function assertExpectation(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expect' }>,
): void {
  assertTextSelector(expectation)
  const matches = screen.queryAllByText(expectation.text)
  if (!expectation.missing && matches.length === 0) {
    throw new Error(
      `${formatStep(expectation)} expected rendered text but found none.\n${formatSource(expectation.source)}`,
    )
  }
  if (expectation.missing && matches.length > 0) {
    throw new Error(
      `${formatStep(expectation)} expected no rendered text but found ${matches.length} ${
        matches.length === 1 ? 'match' : 'matches'
      }.\n${formatSource(expectation.source)}`,
    )
  }
}

function formatStep(step: TestCompiler.Step): string {
  return Switch.kind<TestCompiler.Step, string>(step, {
    expect: expectation =>
      expectation.missing
        ? `expect missing ${expectation.selector} "${expectation.text}"`
        : `expect ${expectation.selector} "${expectation.text}"`,
    press: press => `press ${press.selector} "${press.text}"`,
  })
}

function assertTextSelector(step: TestCompiler.Step): void {
  if (step.selector !== 'text') {
    throw new Error(`${formatStep(step)} has unsupported selector '${step.selector}'.`)
  }
}

function formatSource(source: TestCompiler.Source): string {
  const range = source.range
  const line = range === undefined ? '' : `:${range.start.line + 1}:${range.start.character + 1}`
  return `Source: ${source.filePath}${line}`
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
