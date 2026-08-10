import { Switch } from '@shared/core'
import { fireEvent } from '@testing-library/react-native'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import type * as TestCompiler from './test-compiler/TestCompiler'

type SelectableStep = Extract<TestCompiler.Step, { selector: string }>

// `write` and `submit` act on the control the previous `press` focused.
type CheckState = { focused?: RuntimeApp.Element }

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
    const state: CheckState = {}
    for (const step of check.steps) {
      runStep(screen, state, step)
    }
  } catch (error) {
    throw new Error(
      `Tao check failed: ${suiteName} > ${check.name}\n${formatSource(check.source)}\n${formatError(error)}`,
    )
  } finally {
    screen?.unmount()
  }
}

function runStep(screen: RuntimeApp.Screen, state: CheckState, step: TestCompiler.Step): void {
  return Switch.kind<TestCompiler.Step, void>(step, {
    expect: expectation => assertExpectation(screen, expectation),
    'expect-input': expectation => assertInputValue(screen, expectation),
    press: press => pressStep(screen, state, press),
    submit: submit => submitStep(state, submit),
    write: write => writeStep(state, write),
  })
}

function pressStep(
  screen: RuntimeApp.Screen,
  state: CheckState,
  step: Extract<TestCompiler.Step, { kind: 'press' }>,
): void {
  const match = uniqueMatch(screen, step, 'pressable')
  state.focused = match
  fireEvent.press(match)
}

function writeStep(state: CheckState, step: Extract<TestCompiler.Step, { kind: 'write' }>): void {
  const target = state.focused
  if (!target) {
    throw new Error(
      `write "${step.text}" has no focused control. Press an input first.\n${formatSource(step.source)}`,
    )
  }
  fireEvent.changeText(target, step.text)
}

function submitStep(state: CheckState, step: Extract<TestCompiler.Step, { kind: 'submit' }>): void {
  const target = state.focused
  if (!target) {
    throw new Error(`submit has no focused control. Press an input first.\n${formatSource(step.source)}`)
  }
  fireEvent(target, 'submitEditing')
}

function assertExpectation(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expect' }>,
): void {
  const matches = queryAll(screen, expectation)
  if (!expectation.missing && matches.length === 0) {
    throw new Error(
      `${formatStep(expectation)} expected a rendered match but found none.\n${formatSource(expectation.source)}`,
    )
  }
  if (expectation.missing && matches.length > 0) {
    throw new Error(
      `${formatStep(expectation)} expected no rendered match but found ${matches.length} ${
        matches.length === 1 ? 'match' : 'matches'
      }.\n${formatSource(expectation.source)}`,
    )
  }
}

function assertInputValue(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expect-input' }>,
): void {
  const match = uniqueMatch(screen, expectation, 'input')
  const actual = (match.props as { value?: unknown }).value
  if (actual !== expectation.value) {
    throw new Error(
      `${formatStep(expectation)} expected value "${expectation.value}" but found "${String(actual)}".\n${
        formatSource(expectation.source)
      }`,
    )
  }
}

function uniqueMatch(
  screen: RuntimeApp.Screen,
  step: SelectableStep,
  subject: string,
): RuntimeApp.Element {
  const matches = queryAll(screen, step)
  if (matches.length === 0) {
    throw new Error(`${formatStep(step)} expected a ${subject} match but found none.\n${formatSource(step.source)}`)
  }
  if (matches.length > 1) {
    throw new Error(
      `${formatStep(step)} expected one ${subject} match but found ${matches.length} matches.\n${
        formatSource(step.source)
      }`,
    )
  }
  return matches[0]!
}

function queryAll(screen: RuntimeApp.Screen, step: SelectableStep): RuntimeApp.Element[] {
  return Switch<string, RuntimeApp.Element[]>(step.selector, {
    text: () => screen.queryAllByText(step.text),
    label: () => screen.queryAllByLabelText(step.text),
    placeholder: () => screen.queryAllByPlaceholderText(step.text),
  })
}

function formatStep(step: TestCompiler.Step): string {
  return Switch.kind<TestCompiler.Step, string>(step, {
    expect: expectation =>
      expectation.missing
        ? `expect missing ${expectation.selector} "${expectation.text}"`
        : `expect ${expectation.selector} "${expectation.text}"`,
    'expect-input': expectation =>
      `expect input ${expectation.selector} "${expectation.text}" value "${expectation.value}"`,
    press: press => `press ${press.selector} "${press.text}"`,
    submit: () => 'submit',
    write: write => `write "${write.text}"`,
  })
}

function formatSource(source: TestCompiler.Source): string {
  const range = source.range
  const line = range === undefined ? '' : `:${range.start.line + 1}:${range.start.character + 1}`
  return `Source: ${source.filePath}${line}`
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
