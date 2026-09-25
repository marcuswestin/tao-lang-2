import TR from '@runtime/TR'
import { navigationCommandTestId, navigationTitleTestId } from '@runtime/TR-navigation-basic-stack'
import {
  replayTaoJourneyEventStep,
  type TaoJourneyEvent,
  type TaoJourneyEventAdapter,
  type TaoJourneyStep,
} from '@runtime/TR-studio-journey'
import { Assert, Errors, Switch, Text } from '@shared/core'
import { act, fireEvent, within } from '@testing-library/react-native'
import {
  type JourneyCheckObservation,
  JourneyObservations,
  type JourneyRenderObservation,
} from './journey-observations'
import { renderCompiledApp } from './render-app'
import type { RuntimeApp } from './RuntimeApp'
import type * as TestCompiler from './test-compiler/TestCompiler'

/** TaoCheckFailure reports a failed Tao check under a product name rather than a taxonomy one. */
class TaoCheckFailure extends Error {
  override readonly name = 'Tao'
}

type TestInstance = ReturnType<RuntimeApp.Screen['getByTestId']>
type ScopeResolver = () => TestInstance | undefined
const selectedOutlineIdentities = new WeakMap<TestInstance, string>()

/**
 * RunningApp is the app instance a check is currently driving. It is a holder rather than a value
 * because `relaunch` replaces the mounted instance mid-check, and every later step — and the
 * unmount that ends the check — must reach the instance that is live now.
 */
type RunningApp = {
  readonly device: TestCompiler.Device | undefined
  readonly modulePath: string
  screen: RuntimeApp.Screen
}

/** runTestFile runs one precompiled Tao test file through the Expo render harness. */
export async function runTestFile(file: TestCompiler.File): Promise<void> {
  for (const suite of file.suites) {
    for (const check of suite.checks) {
      await runTestCheck(suite.name, check)
    }
  }
}

/**
 * runTestCheck runs one precompiled Tao journey through the Expo render harness. It is the whole of
 * a journey's work: every isolation boundary below belongs to the check rather than to the file
 * around it, so a caller may run one journey per test case or a file's journeys in a loop and get
 * the same behaviour either way.
 */
export async function runTestCheck(suiteName: string, check: TestCompiler.Check): Promise<JourneyCheckObservation> {
  let app: RunningApp | undefined
  const renders = new Map<string, JourneyRenderObservation>()
  let status: JourneyCheckObservation['status'] = 'failed'
  let observation: JourneyCheckObservation | undefined
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
    TR.TestActionStubs.beginTest(check.actionFailureStubs ?? [])
    app = {
      device: check.device,
      modulePath: check.app.modulePath,
      screen: await launchApp(check.app.modulePath, check.fixture),
    }
    applyDeviceViewport(app.screen, app.device)
    await settleData()
    if (containsWaitForSync(check.steps)) {
      TR.Data.TestWorld.preflightWaitForSync()
    }
    observeJourneyRenders(app.screen, renders)
    for (const step of check.steps) {
      await runStep(app, step)
      await settleData()
      observeJourneyRenders(app.screen, renders)
    }
    status = 'passed'
  } catch (error) {
    // Jest heads the report with `${name}: ${message}`, and this is the most-read error in the
    // product, so the name must not be internal vocabulary: `UserInputError:` would sit atop every
    // failing journey. The message keeps `Tao check failed:` because that substring is the contract
    // both Studio runners and this package's own tests match on.
    throw new TaoCheckFailure(
      `Tao check failed: ${suiteName} > ${check.name}\n${formatSource(check.source)}\n${Errors.messageOf(error)}`,
    )
  } finally {
    if (app !== undefined) {
      observeJourneyRenders(app.screen, renders)
    }
    const completedObservation: JourneyCheckObservation = {
      appSourcePath: check.app.sourcePath,
      checkName: check.name,
      checkSource: check.source,
      renders: [...renders.values()],
      status,
      suiteName,
    }
    observation = completedObservation
    app?.screen.unmount()
    TR.Clock.endTest()
    TR.TestActionStubs.endTest()
    TR.Navigation.endTest()
    TR.Persisted.endTest()
    TR.Data.endTest()
    await JourneyObservations.record(completedObservation)
  }
  Assert.defined(observation, 'completed Tao check has an observation')
  return observation
}

function containsWaitForSync(steps: readonly TestCompiler.Step[]): boolean {
  return steps.some(step => step.kind === 'waitForSync' || (step.kind === 'select' && containsWaitForSync(step.steps)))
}

/** observeJourneyRenders reads test-only generated props from the live React tree, never static source coverage. */
function observeJourneyRenders(screen: RuntimeApp.Screen, renders: Map<string, JourneyRenderObservation>): void {
  for (const instance of screen.UNSAFE_root.findAll(() => true)) {
    const candidate = (instance.props as { __tao?: { journeyObservation?: unknown } }).__tao?.journeyObservation
    if (!isJourneyRenderObservation(candidate)) {
      continue
    }
    const previous = renders.get(candidate['renderId'])
    if (previous === undefined) {
      renders.set(candidate['renderId'], candidate)
    }
  }
}

function isJourneyRenderObservation(value: unknown): value is JourneyRenderObservation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate['renderId'] === 'string'
    && typeof candidate['sourcePath'] === 'string'
    && typeof candidate['sourceVersion'] === 'string'
    && Number.isInteger(candidate['start'])
    && Number.isInteger(candidate['end'])
}

async function runStep(
  app: RunningApp,
  step: TestCompiler.Step,
  resolveScope: ScopeResolver = () => undefined,
): Promise<void> {
  const screen = app.screen
  await Switch.kind<TestCompiler.Step, void | Promise<void>>(step, {
    advance: advance => advanceStep(advance),
    network: async network => {
      await act(async () => TR.Data.TestWorld.network(network.mode))
    },
    waitForSync: async () => {
      await TR.Data.TestWorld.waitForSync()
    },
    datasourceFailure: step => {
      TR.Data.TestWorld.failAfter(step.operation, step.entity, step.message)
    },
    back: back => backStep(back),
    enter: enter => enterStep(screen, enter, resolveScope()),
    expect: expectation => assertExpectation(screen, expectation, resolveScope()),
    expectCheckboxState: expectation => assertCheckboxState(screen, expectation, resolveScope()),
    expectFocusRegion: expectation => assertFocusRegion(expectation),
    expectGroup: expectation => assertExpectationGroup(screen, expectation, resolveScope()),
    expectNavigationTitle: expectation => assertNavigationTitle(screen, expectation),
    expectInputValue: expectation => assertInputValue(screen, expectation, resolveScope()),
    expectTarget: expectation => assertTarget(expectation),
    expectToolbarCommand: expectation => assertToolbarCommand(screen, expectation),
    focus: focus => journeyEventStep(screen, focus, resolveScope()),
    hover: hover => journeyEventStep(screen, hover, resolveScope()),
    press: press => pressStep(screen, press, resolveScope()),
    pressDown: press => journeyEventStep(screen, press, resolveScope()),
    pressUp: press => journeyEventStep(screen, press, resolveScope()),
    expectVerbs: expectation => assertVerbs(expectation),
    narrow: narrow => narrowStep(narrow),
    pressKey: press => pressKeyStep(press),
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
  const adapter: TaoJourneyEventAdapter<TestInstance> = {
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
  }
  await replayTaoJourneyEventStep(step as Exclude<TaoJourneyStep, { kind: 'advance' | 'select' }>, adapter)
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

/**
 * launchApp mounts one generated app module and waits out the host's own launch reads. `fixture`
 * seeds the app's store before this launch's first render, through the same Studio-preview seeding
 * seam a scenario's fixture already materializes through; omit it on a relaunch, whose whole point is
 * that the device's stored data survives untouched rather than being seeded again.
 */
async function launchApp(modulePath: string, fixture?: TestCompiler.Fixture): Promise<RuntimeApp.Screen> {
  const screen = renderCompiledApp(
    { testAppPath: modulePath },
    fixture ? { cell: fixtureCell(fixture) } : {},
  )
  await act(async () => {
    // The host reads navigation restoration before exposing the initial semantic tree.
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>(resolve => queueMicrotask(resolve))
  })
  return screen
}

/** fixtureCell wraps one compiled fixture's rows in the cell shape `TR.Studio.Environment.Host` mounts. */
function fixtureCell(fixture: TestCompiler.Fixture): TR.StudioCellRuntime {
  return {
    environment: {
      network: { mode: 'online' },
      scheme: { requested: 'system' },
      version: 1,
    },
    fixture: { accounts: [], creates: fixture.creates },
    scenario: { kind: 'app', prepare: [], subjectId: '' },
  }
}

/**
 * applyDeviceViewport gives every layout-observing view in the tree the `on <device>` viewport once
 * after launch, the one initial layout pass a real device of that size would give it. It is not a
 * cascading layout engine — a view nested under a narrower sibling still only sees this full width —
 * so it proves the device for a check's top-level adaptive layout rather than for arbitrary depth.
 * Exported because the test language itself has no selector for a chosen layout direction (§_Tao
 * Testing.md_'s non-goals): the harness proof for `on <device>` reads this same rendered style.
 */
export function applyDeviceViewport(screen: RuntimeApp.Screen, device: TestCompiler.Device | undefined): void {
  if (!device) {
    return
  }
  const layout = { height: device.height, width: device.width }
  for (
    const instance of screen.UNSAFE_root.findAll((node: TestInstance) => typeof node.props['onLayout'] === 'function')
  ) {
    // A real layout event reaches every listener through React Native's own synthetic wrapping,
    // which still carries a `persist` no-op; `fireEvent` hands the handler exactly what is passed
    // here, so a bare `nativeEvent` breaks any listener — React Navigation's chrome among them —
    // that calls `event.persist()` the way a real one always answers.
    fireEvent(instance, 'layout', { nativeEvent: { layout }, persist: () => {} })
  }
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
  applyDeviceViewport(app.screen, app.device)
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

async function pressKeyStep(step: Extract<TestCompiler.Step, { kind: 'pressKey' }>): Promise<void> {
  let handled = false
  await act(async () => {
    handled = TR.Interaction.PressKey(step.key)
  })
  if (!handled) {
    Errors.throwUserInput(`${formatStep(step)} was not handled.\n${formatSource(step.source)}`)
  }
}

async function narrowStep(step: Extract<TestCompiler.Step, { kind: 'narrow' }>): Promise<void> {
  await act(async () => {
    TR.Interaction.Narrow(step.text)
  })
}

function assertTarget(step: Extract<TestCompiler.Step, { kind: 'expectTarget' }>): void {
  const actual = TR.Interaction.Attention.read().targetLabel
  if (actual !== step.label) {
    Errors.throwUserInput(
      `${formatStep(step)} expected interaction target ${JSON.stringify(step.label)}, got ${JSON.stringify(actual)}.\n${
        formatSource(step.source)
      }`,
    )
  }
}

function assertFocusRegion(step: Extract<TestCompiler.Step, { kind: 'expectFocusRegion' }>): void {
  const actual = TR.Interaction.Attention.read().focusRegionLabel
  if (actual !== step.label) {
    Errors.throwUserInput(
      `${formatStep(step)} expected interaction focus region ${JSON.stringify(step.label)}, got ${
        JSON.stringify(actual)
      }.\n${formatSource(step.source)}`,
    )
  }
}

function assertVerbs(step: Extract<TestCompiler.Step, { kind: 'expectVerbs' }>): void {
  // Exact membership and tier order are the observable verb-surface contract. Containment would
  // miss leaked hidden commands, duplicate labels, and priority regressions.
  const actual = TR.Interaction.Attention.read().verbs.map(verb => verb.label)
  if (JSON.stringify(actual) !== JSON.stringify(step.labels)) {
    Errors.throwUserInput(
      `${formatStep(step)} expected interaction verbs ${JSON.stringify(step.labels)}, got ${JSON.stringify(actual)}.\n${
        formatSource(step.source)
      }`,
    )
  }
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
  const parentIdentity = parentScope === undefined ? undefined : selectedOutlineIdentities.get(parentScope)
  const outlineIdentity = TR.Interaction.Outline.itemIdentityForTestTag(step.tag, step.index, parentIdentity)
  if (outlineIdentity !== undefined) {
    selectedOutlineIdentities.set(row, outlineIdentity)
  }
  return row
}

function formatStep(step: TestCompiler.Step): string {
  return Switch.kind<TestCompiler.Step, string>(step, {
    advance: advance => `advance ${advance.milliseconds}ms`,
    network: step => `network ${step.mode}`,
    waitForSync: () => 'wait for sync',
    datasourceFailure: step => `datasource fails after ${step.operation} ${step.entity} "${step.message}"`,
    back: () => 'back',
    enter: enter => `enter "${enter.value}" into ${enter.selector} "${enter.target}"`,
    expect: expectation =>
      expectation.missing
        ? `expect missing ${expectation.selector} "${expectation.text}"`
        : `expect ${expectation.selector} "${expectation.text}"`,
    expectCheckboxState: expectation =>
      `expect checkbox #${expectation.tag} ${expectation.checked ? 'checked' : 'unchecked'}`,
    expectFocusRegion: expectation => `expect focus region "${expectation.label}"`,
    expectGroup: expectation => expectation.scopeTag ? `expect #${expectation.scopeTag} { … }` : 'expect { … }',
    expectNavigationTitle: expectation => `expect navigation title "${expectation.title}"`,
    expectInputValue: expectation =>
      `expect input ${expectation.selector} "${expectation.target}" value "${expectation.value}"`,
    expectTarget: expectation => `expect target "${expectation.label}"`,
    expectToolbarCommand: expectation =>
      `expect toolbar command "${expectation.label}" ${expectation.enabled ? 'enabled' : 'disabled'}`,
    focus: focus => `focus #${focus.tag}`,
    hover: hover => `hover ${hover.selector} "${hover.target}"`,
    press: press => `press ${press.selector} "${press.text}"`,
    pressDown: press => `press down ${press.selector} "${press.target}"`,
    pressUp: press => `press up ${press.selector} "${press.target}"`,
    expectVerbs: expectation => `expect verbs ${expectation.labels.map(label => `"${label}"`).join(', ')}`,
    narrow: narrow => `narrow "${narrow.text}"`,
    pressKey: press => `press key "${press.key}"`,
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
    const pattern = new RegExp(`(?:^|\\s)${Text.escapeRegExp(target)}(?:\\s|$)`)
    const matches = queries.queryAllByTestId(pattern)
    if (scope && pattern.test(String(scope.props.testID ?? '')) && !matches.includes(scope)) {
      return [scope, ...matches]
    }
    return matches
  }
  if (selector === 'label') {
    const matches = queries.queryAllByLabelText(target)
    const semanticRow = accessibleAncestorWithLabel(scope, target)
    if (semanticRow && !matches.includes(semanticRow)) {
      return [semanticRow, ...matches]
    }
    const outlineIdentity = scope === undefined ? undefined : selectedOutlineIdentities.get(scope)
    const outlineRow = outlineIdentity === undefined
      ? undefined
      : TR.Interaction.Outline.read().nodes.find(node => node.identity === outlineIdentity)
    if (outlineRow?.label === target && !matches.includes(scope!)) {
      return [scope!, ...matches]
    }
    return matches
  }
  if (selector === 'text') {
    return queries.queryAllByText(target)
  }
  if (selector === 'placeholder') {
    return queries.queryAllByPlaceholderText(target)
  }
  Errors.throwUserInput(`Unsupported test selector '${selector}'.`)
}

function accessibleAncestorWithLabel(scope: TestInstance | undefined, label: string): TestInstance | undefined {
  let current = scope
  while (current) {
    if (
      current.props.accessibilityLabel === label
      && (current.props.accessible === true || current.props.accessibilityRole !== undefined)
    ) {
      return current
    }
    current = current.parent ?? undefined
  }
  return undefined
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
