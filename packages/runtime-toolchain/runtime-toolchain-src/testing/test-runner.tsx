import TR from '@runtime/TR'
import { navigationCommandTestId, navigationTitleTestId } from '@runtime/TR-navigation-basic-stack'
import {
  replayTaoJourneyStep,
  type TaoJourneyAdapter,
  type TaoJourneyEvent,
  type TaoJourneyStep,
} from '@runtime/TR-studio-journey'
import { Errors, Switch } from '@shared/core'
import { act, fireEvent, within } from '@testing-library/react-native'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import type * as TestCompiler from './test-compiler/TestCompiler'

/** TaoCheckFailure reports a failed Tao check under a product name rather than a taxonomy one. */
class TaoCheckFailure extends Error {
  override readonly name = 'Tao'
}

type TestInstance = ReturnType<RuntimeApp.Screen['getByTestId']>
type ScopeResolver = () => TestInstance | undefined

/**
 * RunningApp is the app instance a check is currently driving. It is a holder rather than a value
 * because `relaunch` replaces the mounted instance mid-check, and every later step — and the
 * unmount that ends the check — must reach the instance that is live now.
 */
type RunningApp = {
  readonly modulePath: string
  screen: RuntimeApp.Screen
}

/** runTestFile runs one precompiled Tao test file through the Expo render harness. */
export async function runTestFile(file: TestCompiler.File): Promise<void> {
  for (const suite of file.suites) {
    for (const check of suite.checks) {
      await runCheck(suite.name, check)
    }
  }
}

async function runCheck(suiteName: string, check: TestCompiler.Check): Promise<void> {
  let app: RunningApp | undefined
  try {
    TR.Data.beginTest()
    // Every check gets a device nobody has used. Persisted state is declared at generated-module
    // scope and therefore outlives both the mount and the check, so without this a width one check
    // widens is still widened when the next check launches the same app.
    TR.Persisted.beginTest()
    // The same boundary for navigation: restoration keeps working, over a store nobody has written.
    TR.Navigation.beginTest()
    // Every check starts from the same instant and moves only when the journey says so.
    TR.Clock.beginTest()
    app = { modulePath: check.app.modulePath, screen: await launchApp(check.app.modulePath) }
    await settleData()
    for (const step of check.steps) {
      await runStep(app, step)
      await settleData()
    }
  } catch (error) {
    // Jest heads the report with `${name}: ${message}`, and this is the most-read error in the
    // product, so the name must not be internal vocabulary: `UserInputError:` would sit atop every
    // failing journey. The message keeps `Tao check failed:` because that substring is the contract
    // both Studio runners and this package's own tests match on.
    throw new TaoCheckFailure(
      `Tao check failed: ${suiteName} > ${check.name}\n${formatSource(check.source)}\n${formatError(error)}`,
    )
  } finally {
    app?.screen.unmount()
    TR.Clock.endTest()
    TR.Navigation.endTest()
    TR.Persisted.endTest()
    TR.Data.endTest()
  }
}

async function runStep(
  app: RunningApp,
  step: TestCompiler.Step,
  resolveScope: ScopeResolver = () => undefined,
): Promise<void> {
  const screen = app.screen
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
    focus: focus => journeyEventStep(screen, focus, resolveScope()),
    hover: hover => journeyEventStep(screen, hover, resolveScope()),
    press: press => pressStep(screen, press, resolveScope()),
    pressDown: press => journeyEventStep(screen, press, resolveScope()),
    pressUp: press => journeyEventStep(screen, press, resolveScope()),
    pressToolbarCommand: press => pressToolbarCommandStep(screen, press),
    relaunch: relaunch => relaunchStep(app, relaunch),
    select: select => selectStep(app, select, resolveScope),
    submit: submit => submitStep(screen, submit, resolveScope()),
  })
}

async function journeyEventStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'focus' | 'hover' | 'pressDown' | 'pressUp' }>,
  scope?: TestInstance,
): Promise<void> {
  const adapter: TaoJourneyAdapter<TestInstance> = {
    advance(milliseconds) {
      TR.Clock.advance(milliseconds)
    },
    async dispatch(target, event) {
      await dispatchInteraction(() => fireEvent(target, journeyTestingLibraryEvent(event)))
    },
    find(selector, target) {
      const matches = querySelector(screen, selector, target, scope)
      if (matches.length !== 1) {
        Errors.throwUserInput(
          `${formatStep(step)} expected one interaction target but found ${matches.length} matches.\n${
            formatSource(step.source)
          }`,
        )
      }
      return matches[0]!
    },
    settle() {},
  }
  await replayTaoJourneyStep(step as TaoJourneyStep, adapter)
}

function journeyTestingLibraryEvent(event: TaoJourneyEvent): string {
  return event === 'pressDown'
    ? 'pressIn'
    : event === 'pressUp'
    ? 'pressOut'
    : event === 'hover'
    ? 'hoverIn'
    : 'focus'
}

/** launchApp mounts one generated app module and waits out the host's own launch reads. */
async function launchApp(modulePath: string): Promise<RuntimeApp.Screen> {
  const screen = renderCompiledApp({ testAppPath: modulePath })
  await act(async () => {
    // The host reads navigation restoration before exposing the initial semantic tree.
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>(resolve => queueMicrotask(resolve))
  })
  return screen
}

/**
 * relaunch is a person quitting the app and opening it again on the same device. The mounted
 * instance is torn down and a new one launches in its place over the same device-local storage,
 * the same stored data, and the same held clock — a relaunch does not rewind time or wipe a device.
 * Everything the running instance owned is gone: view-local state, `let` derivations, and in-flight
 * asks. The new instance then restores its navigation from the device, which is what a real
 * relaunch does; `relaunch fresh` opts that one launch out and opens on the initial screen.
 */
async function relaunchStep(app: RunningApp, step: Extract<TestCompiler.Step, { kind: 'relaunch' }>): Promise<void> {
  app.screen.unmount()
  // beginLaunch is the launch boundary: every navigation value and app occurrence returns to its
  // declared configuration, every action root the ending launch started abandons its transaction
  // rather than committing into the launch that replaces it, and the restoration controller forgets
  // the launch it was in, while the store it reads and writes stays exactly as the previous
  // instance left it.
  await TR.Navigation.beginLaunch({ fresh: step.fresh })
  // The same boundary for device-local `(persist)` state, and for the same reason: a generated
  // module declares it once, so the value and the resolved read outlive the instance that owned
  // them. Dropping both is what makes the next instance hydrate from the device rather than
  // inherit memory, which is the only way this step can tell a working round trip from a broken
  // one. The device itself is untouched.
  //
  // There is deliberately no `beginTest()` for either domain here, and none for `TR.Data` or
  // `TR.Clock`. Those are the device, and a relaunch keeps the device: only the check boundary
  // hands the next journey a device nobody has used.
  await TR.Persisted.beginLaunch()
  app.screen = await launchApp(app.modulePath)
}

function assertNavigationTitle(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'expectNavigationTitle' }>,
): void {
  const title = screen.queryByTestId(navigationTitleTestId)
  if (!title || title.props.children !== step.title) {
    Errors.throwUserInput(
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
    Errors.throwUserInput(
      `${formatStep(step)} expected exactly one visible toolbar command, got ${commands.length}.\n${
        formatSource(step.source)
      }`,
    )
  }
  const command = commands[0]!
  const disabled = command.props.accessibilityState?.disabled === true
  if (disabled === step.enabled) {
    Errors.throwUserInput(`${formatStep(step)} observed the opposite enabled state.\n${formatSource(step.source)}`)
  }
}

async function pressToolbarCommandStep(
  screen: RuntimeApp.Screen,
  step: Extract<TestCompiler.Step, { kind: 'pressToolbarCommand' }>,
): Promise<void> {
  const commands = screen.queryAllByTestId(navigationCommandTestId(step.label))
  if (commands.length !== 1) {
    Errors.throwUserInput(
      `${formatStep(step)} expected exactly one visible toolbar command, got ${commands.length}.\n${
        formatSource(step.source)
      }`,
    )
  }
  const command = commands[0]!
  if (command.props.accessibilityState?.disabled === true) {
    Errors.throwUserInput(`${formatStep(step)} cannot press a disabled toolbar command.\n${formatSource(step.source)}`)
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
    Errors.throwUserInput(
      `${formatStep(expectation)} expected rendered text but found none.\n${formatSource(expectation.source)}`,
    )
  }
  if (expectation.missing && matches.length > 0) {
    Errors.throwUserInput(
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
    Errors.throwUserInput(
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
    Errors.throwUserInput(
      `${formatStep(expectation)} expected one accessible checkbox but found ${matches.length}.\n${
        formatSource(expectation.source)
      }`,
    )
  }
  const checked = matches[0]!.props.accessibilityState.checked as boolean
  if (checked !== expectation.checked) {
    Errors.throwUserInput(
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
        Errors.throwUserInput(`${formatStep(step)} input value expectations require a #tag scope.`)
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
    Errors.throwUserInput(`${formatStep(step)} failed:\n- ${failures.join('\n- ')}\n${formatSource(step.source)}`)
  }
}

async function selectStep(
  app: RunningApp,
  step: Extract<TestCompiler.Step, { kind: 'select' }>,
  resolveParentScope: ScopeResolver,
): Promise<void> {
  for (const nested of step.steps) {
    // Resolve the row again for each operation because a prior operation may rerender or remove it.
    await runStep(app, nested, () => selectedRow(app.screen, step, resolveParentScope()))
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
    Errors.throwUserInput(
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
    focus: focus => `focus #${focus.tag}`,
    hover: hover => `hover ${hover.selector} "${hover.target}"`,
    press: press => `press ${press.selector} "${press.text}"`,
    pressDown: press => `press down ${press.selector} "${press.target}"`,
    pressUp: press => `press up ${press.selector} "${press.target}"`,
    pressToolbarCommand: press => `press toolbar command "${press.label}"`,
    relaunch: relaunch => relaunch.fresh ? 'relaunch fresh' : 'relaunch',
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
    Errors.throwUserInput(
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
  Errors.throwUserInput(`Unsupported test selector '${selector}'.`)
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
    Errors.throwUserInput(`${formatStep(step)} expected one #${tag} scope but found ${matches.length}.`)
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
    Errors.throwUserInput(`${formatStep(step)} expected one interactive native target but found ${matches.length}.`)
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
    Errors.throwUserInput(`${formatStep(step)} expected one input value target but found ${matches.length}.`)
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
