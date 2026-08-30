import TR from '@runtime/TR'
import { navigationCommandTestId, navigationTitleTestId } from '@runtime/TR-navigation-basic-stack'
import { Switch } from '@shared/core'
import { act, fireEvent, within } from '@testing-library/react-native'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import type * as TestCompiler from './test-compiler/TestCompiler'

type TestInstance = ReturnType<RuntimeApp.Screen['getByTestId']>
type ScopeResolver = () => TestInstance | undefined

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
    // Every check starts from the same instant and moves only when the journey says so.
    TR.Clock.beginTest()
    screen = renderCompiledApp({ testAppPath: check.app.modulePath })
    await settleData()
    for (const step of check.steps) {
      await runStep(screen, step)
      await settleData()
    }
  } catch (error) {
    throw new Error(
      `Tao check failed: ${suiteName} > ${check.name}\n${formatSource(check.source)}\n${formatError(error)}`,
    )
  } finally {
    screen?.unmount()
    TR.Clock.endTest()
    TR.Data.endTest()
  }
}

async function runStep(
  screen: RuntimeApp.Screen,
  step: TestCompiler.Step,
  resolveScope: ScopeResolver = () => undefined,
): Promise<void> {
  await Switch.kind<TestCompiler.Step, void | Promise<void>>(step, {
    advance: advance => advanceStep(advance),
    back: back => backStep(back),
    enter: enter => enterStep(screen, enter, resolveScope()),
    expect: expectation => assertExpectation(screen, expectation, resolveScope()),
    expectCheckboxState: expectation => assertCheckboxState(screen, expectation, resolveScope()),
    expectGroup: expectation => assertExpectationGroup(screen, expectation, resolveScope()),
    expectNavigationTitle: expectation => assertNavigationTitle(screen, expectation),
    expectInputValue: expectation => assertInputValue(screen, expectation, resolveScope()),
    expectToolbarCommand: expectation => assertToolbarCommand(screen, expectation),
    press: press => pressStep(screen, press, resolveScope()),
    pressToolbarCommand: press => pressToolbarCommandStep(screen, press),
    select: select => selectStep(screen, select, resolveScope),
    submit: submit => submitStep(screen, submit, resolveScope()),
  })
}

function assertNavigationTitle(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'expectNavigationTitle' }>,
): void {
  const title = screen.queryByTestId(navigationTitleTestId)
  if (!title || title.props.children !== step.title) {
    throw new Error(
      `${formatStep(step)} expected ${JSON.stringify(step.title)}, got ${JSON.stringify(title?.props.children)}.\n${
        formatSource(step.source)
      }`,
    )
  }
}

function assertToolbarCommand(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'expectToolbarCommand' }>,
): void {
  const commands = screen.queryAllByTestId(navigationCommandTestId(step.label))
  if (commands.length !== 1) {
    throw new Error(
      `${formatStep(step)} expected exactly one visible toolbar command, got ${commands.length}.\n${
        formatSource(step.source)
      }`,
    )
  }
  const command = commands[0]!
  const disabled = command.props.accessibilityState?.disabled === true
  if (disabled === step.enabled) {
    throw new Error(`${formatStep(step)} observed the opposite enabled state.\n${formatSource(step.source)}`)
  }
}

async function pressToolbarCommandStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'pressToolbarCommand' }>,
): Promise<void> {
  const commands = screen.queryAllByTestId(navigationCommandTestId(step.label))
  if (commands.length !== 1) {
    throw new Error(
      `${formatStep(step)} expected exactly one visible toolbar command, got ${commands.length}.\n${
        formatSource(step.source)
      }`,
    )
  }
  const command = commands[0]!
  if (command.props.accessibilityState?.disabled === true) {
    throw new Error(`${formatStep(step)} cannot press a disabled toolbar command.\n${formatSource(step.source)}`)
  }
  await dispatchInteraction(() => fireEvent.press(command))
}

/** advance moves the held clock, firing every ticker and timer that falls due, in order. */
async function advanceStep(step: Extract<TestCompiler.Step, { kind: 'advance' }>): Promise<void> {
  await act(async () => {
    TR.Clock.advance(step.milliseconds)
  })
}

async function backStep(_step: Extract<TestCompiler.Step, { kind: 'back' }>): Promise<void> {
  await act(async () => {
    TR.Navigation.Back()
  })
}

async function pressStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'press' }>,
  scope?: TestInstance,
): Promise<void> {
  const match = requireSingleMatch(screen, step, { target: step.text, description: 'pressable', scope })
  // A person interacts with a control; the control decides what that means. A platform switch
  // reports through `onValueChange` and has no press, so `press` drives it the same way, which is
  // what keeps a native implementation and a JS one interchangeable under one journey.
  const valueControl = valueChangingNode(match)
  if (valueControl) {
    await dispatchInteraction(() => fireEvent(valueControl, 'valueChange', valueControl.props['value'] !== true))
    return
  }
  await dispatchInteraction(() => fireEvent.press(match))
}

/** valueChangingNode returns a value-reporting control with no press of its own, if this is one. */
function valueChangingNode(root: TestInstance): TestInstance | undefined {
  const candidates = [root, ...root.findAll((node: TestInstance) => node !== root)].filter(node =>
    typeof node.props['onValueChange'] === 'function'
  )
  const pressable = [root, ...root.findAll((node: TestInstance) => node !== root)].some(node =>
    typeof node.props['onPress'] === 'function'
  )
  return pressable ? undefined : candidates[0]
}

async function enterStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'enter' }>,
  scope?: TestInstance,
): Promise<void> {
  const match = requireSingleMatch(screen, step, { target: step.target, description: 'text input', scope })
  await dispatchInteraction(() => fireEvent.changeText(requireInteractiveNode(match, 'onChangeText', step), step.value))
}

async function submitStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'submit' }>,
  scope?: TestInstance,
): Promise<void> {
  const match = requireSingleMatch(screen, step, { target: step.target, description: 'submittable input', scope })
  await dispatchInteraction(() => fireEvent(requireInteractiveNode(match, 'onSubmitEditing', step), 'submitEditing'))
}

/** Dispatches an interaction through React, then flushes continuations without awaiting a suspended ask. */
async function dispatchInteraction(dispatch: () => void): Promise<void> {
  dispatch()
  await act(async () => {})
}

/** settleData waits out data loads, query fills, and saves so assertions read a quiet store. */
async function settleData(): Promise<void> {
  await act(async () => {
    await TR.Data.SettleAll()
  })
}

function assertExpectation(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expect' }>,
  scope?: TestInstance,
): void {
  const matches = querySelector(screen, expectation.selector, expectation.text, scope)
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
  scope?: TestInstance,
): void {
  const match = requireSingleMatch(screen, expectation, { target: expectation.target, description: 'input', scope })
  const input = requireValueInput(match, expectation)
  if (input.props.value !== expectation.value) {
    throw new Error(
      `${formatStep(expectation)} expected input value ${JSON.stringify(expectation.value)}, got ${
        JSON.stringify(input.props.value)
      }.\n${formatSource(expectation.source)}`,
    )
  }
}

function assertCheckboxState(
  screen: RuntimeApp.Screen,
  expectation: Extract<TestCompiler.Step, { kind: 'expectCheckboxState' }>,
  scope?: TestInstance,
): void {
  const matches = querySelector(screen, 'tag', expectation.tag, scope).filter(isAccessibleCheckbox)
  if (matches.length !== 1) {
    throw new Error(
      `${formatStep(expectation)} expected one accessible checkbox but found ${matches.length}.\n${
        formatSource(expectation.source)
      }`,
    )
  }
  const checked = matches[0]!.props.accessibilityState.checked as boolean
  if (checked !== expectation.checked) {
    throw new Error(
      `${formatStep(expectation)} expected ${expectation.checked ? 'checked' : 'unchecked'} but was ${
        checked ? 'checked' : 'unchecked'
      }.\n${formatSource(expectation.source)}`,
    )
  }
}

function isAccessibleCheckbox(node: TestInstance): boolean {
  return node.props.accessible !== false
    && node.props.accessibilityRole === 'checkbox'
    && typeof node.props.accessibilityState?.checked === 'boolean'
}

function assertExpectationGroup(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'expectGroup' }>,
  parentScope?: TestInstance,
): void {
  const scope = step.scopeTag ? requireSingleTag(screen, step.scopeTag, step, parentScope) : parentScope
  // Every member is evaluated against the same render state; all failures report as one step.
  const failures: string[] = []
  for (const expectation of step.expectations) {
    if (expectation.kind === 'inputValue') {
      if (!scope) {
        throw new Error(`${formatStep(step)} input value expectations require a #tag scope.`)
      }
      const input = requireValueInput(scope, step)
      if (input.props.value !== expectation.value) {
        failures.push(
          `expected input value ${JSON.stringify(expectation.value)}, got ${JSON.stringify(input.props.value)}`,
        )
      }
      continue
    }
    const matches = querySelector(screen, expectation.selector, expectation.target, scope)
    if (!expectation.missing && matches.length === 0) {
      failures.push(`expected ${expectation.selector} ${JSON.stringify(expectation.target)}`)
    }
    if (expectation.missing && matches.length > 0) {
      failures.push(`expected missing ${expectation.selector} ${JSON.stringify(expectation.target)}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`${formatStep(step)} failed:\n- ${failures.join('\n- ')}\n${formatSource(step.source)}`)
  }
}

async function selectStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'select' }>,
  resolveParentScope: ScopeResolver,
): Promise<void> {
  for (const nested of step.steps) {
    // Resolve the row again for each operation because a prior operation may rerender or remove it.
    await runStep(screen, nested, () => selectedRow(screen, step, resolveParentScope()))
  }
}

function selectedRow(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'select' }>,
  parentScope?: TestInstance,
): TestInstance {
  const matches = querySelector(screen, 'tag', step.tag, parentScope)
  const row = matches[step.index - 1]
  if (!row) {
    throw new Error(
      `${formatStep(step)} expected row ${step.index} but found ${matches.length} tagged rows.\n${
        formatSource(step.source)
      }`,
    )
  }
  return row
}

function formatStep(step: TestCompiler.Step): string {
  return Switch.kind<TestCompiler.Step, string>(step, {
    advance: advance => `advance ${advance.milliseconds}ms`,
    back: () => 'back',
    enter: enter => `enter "${enter.value}" into ${enter.selector} "${enter.target}"`,
    expect: expectation =>
      expectation.missing
        ? `expect missing ${expectation.selector} "${expectation.text}"`
        : `expect ${expectation.selector} "${expectation.text}"`,
    expectCheckboxState: expectation =>
      `expect checkbox #${expectation.tag} ${expectation.checked ? 'checked' : 'unchecked'}`,
    expectGroup: expectation => expectation.scopeTag ? `expect #${expectation.scopeTag} { … }` : 'expect { … }',
    expectNavigationTitle: expectation => `expect navigation title "${expectation.title}"`,
    expectInputValue: expectation =>
      `expect input ${expectation.selector} "${expectation.target}" value "${expectation.value}"`,
    expectToolbarCommand: expectation =>
      `expect toolbar command "${expectation.label}" ${expectation.enabled ? 'enabled' : 'disabled'}`,
    press: press => `press ${press.selector} "${press.text}"`,
    pressToolbarCommand: press => `press toolbar command "${press.label}"`,
    select: select => `select #${select.tag}[${select.index}] { … }`,
    submit: submit => `submit ${submit.selector} "${submit.target}"`,
  })
}

type SingleMatchOptions = {
  target: string
  description: string
  scope?: TestInstance
}

function requireSingleMatch(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { selector: string }>,
  { target, description, scope }: SingleMatchOptions,
): TestInstance {
  const matches = querySelector(screen, step.selector, target, scope)
  if (matches.length !== 1) {
    throw new Error(
      `${formatStep(step)} expected one ${description} but found ${matches.length} matches.\n${
        formatSource(step.source)
      }`,
    )
  }
  return matches[0]!
}

function querySelector(
  screen: RuntimeApp.Screen,
  selector: string,
  target: string,
  scope?: TestInstance,
): TestInstance[] {
  const queries = scope ? within(scope) : screen
  if (selector === 'tag') {
    // A loop-row tag and its direct render tag can intentionally share one
    // concrete native root. Generated testIDs encode those identities as
    // whitespace-delimited tokens, so either Tao tag remains independently
    // addressable without introducing a layout-changing wrapper.
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(target)}(?:\\s|$)`)
    const matches = queries.queryAllByTestId(pattern)
    if (scope && pattern.test(String(scope.props.testID ?? '')) && !matches.includes(scope)) {
      return [scope, ...matches]
    }
    return matches
  }
  if (selector === 'label') {
    return queries.queryAllByLabelText(target)
  }
  if (selector === 'text') {
    return queries.queryAllByText(target)
  }
  if (selector === 'placeholder') {
    return queries.queryAllByPlaceholderText(target)
  }
  throw new Error(`Unsupported test selector '${selector}'.`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function requireSingleTag(
  screen: RuntimeApp.Screen,
  tag: string,
  step: TestCompiler.Step,
  scope?: TestInstance,
): TestInstance {
  const matches = querySelector(screen, 'tag', tag, scope)
  if (matches.length !== 1) {
    throw new Error(`${formatStep(step)} expected one #${tag} scope but found ${matches.length}.`)
  }
  return matches[0]!
}

function requireInteractiveNode(
  root: TestInstance,
  prop: 'onChangeText' | 'onPress' | 'onSubmitEditing',
  step: TestCompiler.Step,
): TestInstance {
  const candidates = [
    root,
    ...root.findAll((node: TestInstance) => node !== root && typeof node.props[prop] === 'function'),
  ].filter(node => typeof node.props[prop] === 'function')
  const matches = candidates.filter(candidate =>
    candidate.findAll((node: TestInstance) => node !== candidate && typeof node.props[prop] === 'function').length === 0
  )
  if (matches.length !== 1) {
    throw new Error(`${formatStep(step)} expected one interactive native target but found ${matches.length}.`)
  }
  return matches[0]!
}

function requireValueInput(root: TestInstance, step: TestCompiler.Step): TestInstance {
  const candidates = [
    root,
    ...root.findAll((node: TestInstance) => node !== root && typeof node.props['onChangeText'] === 'function'),
  ]
    .filter(node => typeof node.props['onChangeText'] === 'function' && 'value' in node.props)
  const matches = candidates.filter(candidate =>
    candidate.findAll((node: TestInstance) =>
      node !== candidate
      && typeof node.props['onChangeText'] === 'function'
      && 'value' in node.props
    ).length === 0
  )
  if (matches.length !== 1) {
    throw new Error(`${formatStep(step)} expected one input value target but found ${matches.length}.`)
  }
  return matches[0]!
}

function formatSource(source: TestCompiler.Source): string {
  const range = source.range
  const line = range === undefined ? '' : `:${range.start.line + 1}:${range.start.character + 1}`
  return `Source: ${source.filePath}${line}`
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
