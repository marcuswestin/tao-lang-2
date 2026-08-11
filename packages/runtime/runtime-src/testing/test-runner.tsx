import TR from '@runtime/TR'
import { Switch } from '@shared/core'
import { act, fireEvent } from '@testing-library/react-native'
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
    TR.Data.beginTest()
    TR.Navigation.beginTest()
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
    TR.Data.endTest()
  }
}

function runStep(screen: RuntimeApp.Screen, step: TestCompiler.Step): void {
  return Switch.kind<TestCompiler.Step, void>(step, {
    back: back => backStep(back),
    dataStatus: status => dataStatusStep(status),
    enter: enter => enterStep(screen, enter),
    expect: expectation => assertExpectation(screen, expectation),
    expectInputValue: expectation => assertInputValue(screen, expectation),
    press: press => pressStep(screen, press),
    submit: submit => submitStep(screen, submit),
  })
}

function backStep(_step: Extract<TestCompiler.Step, { kind: 'back' }>): void {
  act(() => {
    TR.Navigation.Back()
  })
}

function dataStatusStep(step: Extract<TestCompiler.Step, { kind: 'dataStatus' }>): void {
  act(() => {
    TR.Data.setTestStatus(step.dataName, step.status, step.message)
  })
}

function pressStep(screen: RuntimeApp.Screen, step: Extract<TestCompiler.Step, { kind: 'press' }>): void {
  const match = requireSingleMatch(screen, step, step.text, 'pressable')
  fireEvent.press(match)
}

function enterStep(screen: RuntimeApp.Screen, step: Extract<TestCompiler.Step, { kind: 'enter' }>): void {
  const match = requireSingleMatch(screen, step, step.target, 'text input')
  fireEvent.changeText(match, step.value)
}

function submitStep(screen: RuntimeApp.Screen, step: Extract<TestCompiler.Step, { kind: 'submit' }>): void {
  const match = requireSingleMatch(screen, step, step.target, 'submittable input')
  fireEvent(match, 'submitEditing')
}

function assertExpectation(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expect' }>,
): void {
  const matches = querySelector(screen, expectation.selector, expectation.text)
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

function assertInputValue(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expectInputValue' }>,
): void {
  const match = requireSingleMatch(screen, expectation, expectation.target, 'input')
  if (match.props.value !== expectation.value) {
    throw new Error(
      `${formatStep(expectation)} expected input value ${JSON.stringify(expectation.value)}, got ${
        JSON.stringify(
          match.props.value,
        )
      }.\n${formatSource(expectation.source)}`,
    )
  }
}

function formatStep(step: TestCompiler.Step): string {
  return Switch.kind<TestCompiler.Step, string>(step, {
    back: () => 'back',
    enter: enter => `enter "${enter.value}" into ${enter.selector} "${enter.target}"`,
    dataStatus: status =>
      status.status === 'error'
        ? `data ${status.dataName} error "${status.message}"`
        : `data ${status.dataName} ${status.status}`,
    expect: expectation =>
      expectation.missing
        ? `expect missing ${expectation.selector} "${expectation.text}"`
        : `expect ${expectation.selector} "${expectation.text}"`,
    expectInputValue: expectation =>
      `expect input ${expectation.selector} "${expectation.target}" value "${expectation.value}"`,
    press: press => `press ${press.selector} "${press.text}"`,
    submit: submit => `submit ${submit.selector} "${submit.target}"`,
  })
}

function requireSingleMatch(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { selector: string }>,
  target: string,
  description: string,
) {
  const matches = querySelector(screen, step.selector, target)
  if (matches.length !== 1) {
    throw new Error(
      `${formatStep(step)} expected one ${description} but found ${matches.length} matches.\n${
        formatSource(step.source)
      }`,
    )
  }
  return matches[0]!
}

function querySelector(screen: RuntimeApp.Screen, selector: string, target: string) {
  if (selector === 'id') {
    return screen.queryAllByTestId(target)
  }
  if (selector === 'label') {
    return screen.queryAllByLabelText(target)
  }
  if (selector === 'text') {
    return screen.queryAllByText(target)
  }
  if (selector === 'placeholder') {
    return screen.queryAllByPlaceholderText(target)
  }
  throw new Error(`Unsupported test selector '${selector}'.`)
}

function formatSource(source: TestCompiler.Source): string {
  const range = source.range
  const line = range === undefined ? '' : `:${range.start.line + 1}:${range.start.character + 1}`
  return `Source: ${source.filePath}${line}`
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
