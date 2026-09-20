import type Compiler from '@compiler'
import { Errors, Switch } from '@shared'
import { Workspace } from '@workspace'

type TestPlan = Compiler.TestPlan
type TestCheck = TestPlan['suites'][number]['checks'][number]
type TestStep = TestCheck['steps'][number]
type TestSource = TestCheck['source']

/** HostJourney names one selected, source-linked Tao check ready for a real host. */
export type HostJourney = Readonly<{
  check: TestCheck
  sourcePath: string
  version: 1
}>

/** HostJourneySelection preserves a nested Tao `select #tag[index]` scope for a host adapter. */
export type HostJourneySelection = Readonly<{
  index: number
  source: TestSource
  tag: string
}>

type HostJourneyStepOperation =
  & Exclude<TestStep, { kind: 'select' }>
  & Readonly<{
    selections: readonly HostJourneySelection[]
  }>

/** HostJourneyOperation is the driver-neutral operation emitted from one Tao check. */
export type HostJourneyOperation =
  | HostJourneyStepOperation
  | Readonly<{
    appName: string
    appSourcePath: string
    kind: 'run'
    source: TestSource
  }>

/** HostJourneyCapability names one host behavior needed to preserve a Tao test operation. */
export type HostJourneyCapability =
  | 'advanceTime'
  | 'assertCheckboxState'
  | 'assertFocusRegion'
  | 'assertGrouped'
  | 'assertInputValue'
  | 'assertNavigationTitle'
  | 'assertTarget'
  | 'assertText'
  | 'assertToolbarCommand'
  | 'assertVerbs'
  | 'back'
  | 'focus'
  | 'hover'
  | 'key'
  | 'narrow'
  | 'pointerPhase'
  | 'press'
  | 'pressToolbarCommand'
  | 'relaunch'
  | 'runApplication'
  | 'select'
  | 'submit'
  | 'textInput'

/** HostJourneyAdapter is the narrow vendor-neutral seam for browser, native, and device drivers. */
export type HostJourneyAdapter = Readonly<{
  capabilities: readonly HostJourneyCapability[]
  execute(operation: HostJourneyOperation): Promise<void>
}>

/** HostJourneySelector identifies one suite/check pair from a compiled Tao test file. */
export type HostJourneySelector = Readonly<{
  check: string
  suite: string
}>

/** HostJourneyUnsupportedCapabilityError points to the authored operation a host cannot preserve. */
export class HostJourneyUnsupportedCapabilityError extends Errors.UserInputError {
  readonly capability: HostJourneyCapability
  readonly source: TestSource

  constructor(capability: HostJourneyCapability, source: TestSource) {
    super(
      `Host journey needs '${capability}' at ${formatSource(source)}, but the selected host does not provide it.`,
      { capability, source },
    )
    this.capability = capability
    this.source = source
  }
}

/** compileHostJourney compiles and selects one Tao check without the in-process test runner. */
export async function compileHostJourney(entryFile: string, selector: HostJourneySelector): Promise<HostJourney> {
  return selectHostJourney(await Workspace.compileTestPlan(entryFile), selector)
}

/** selectHostJourney selects one authored Tao check from a public, versioned test-plan IR. */
function selectHostJourney(plan: TestPlan, selector: HostJourneySelector): HostJourney {
  if (plan.version !== 1) {
    return Errors.throwUserInput(`Unsupported Tao test-plan version '${String(plan.version)}'.`)
  }
  const suite = plan.suites.find(candidate => candidate.name === selector.suite)
  if (suite === undefined) {
    return Errors.throwUserInput(`Tao test-plan has no suite named '${selector.suite}'.`, {
      selector,
      sourcePath: plan.sourcePath,
    })
  }
  const check = suite.checks.find(candidate => candidate.name === selector.check)
  if (check === undefined) {
    return Errors.throwUserInput(
      `Tao test suite '${selector.suite}' has no check named '${selector.check}'.`,
      { selector, sourcePath: plan.sourcePath },
    )
  }
  return { check, sourcePath: plan.sourcePath, version: 1 }
}

/** preflightHostJourney rejects every unsupported operation before the adapter receives input. */
function preflightHostJourney(
  journey: HostJourney,
  capabilities: readonly HostJourneyCapability[],
): void {
  const supported = new Set(capabilities)
  for (const requirement of requirementsFor(journey)) {
    if (!supported.has(requirement.capability)) {
      throw new HostJourneyUnsupportedCapabilityError(requirement.capability, requirement.source)
    }
  }
}

/** runHostJourney preflights an entire Tao check, then emits its lifecycle and scoped operations in order. */
export async function runHostJourney(journey: HostJourney, adapter: HostJourneyAdapter): Promise<void> {
  preflightHostJourney(journey, adapter.capabilities)
  await adapter.execute({
    appName: journey.check.run.appName,
    appSourcePath: journey.check.run.appSourcePath,
    kind: 'run',
    source: journey.check.run.source,
  })
  await runSteps(journey.check.steps, [], adapter)
}

type HostJourneyRequirement = Readonly<{
  capability: HostJourneyCapability
  source: TestSource
}>

function requirementsFor(journey: HostJourney): readonly HostJourneyRequirement[] {
  return [
    { capability: 'runApplication', source: journey.check.run.source },
    ...requirementsForSteps(journey.check.steps),
  ]
}

function requirementsForSteps(steps: readonly TestStep[]): readonly HostJourneyRequirement[] {
  return steps.flatMap(step => {
    const requirement = { capability: capabilityFor(step), source: step.source }
    return step.kind === 'select' ? [requirement, ...requirementsForSteps(step.steps)] : [requirement]
  })
}

function capabilityFor(step: TestStep): HostJourneyCapability {
  return Switch.kind(step, {
    advance: () => 'advanceTime',
    back: () => 'back',
    enter: () => 'textInput',
    expect: () => 'assertText',
    expectCheckboxState: () => 'assertCheckboxState',
    expectFocusRegion: () => 'assertFocusRegion',
    expectGroup: () => 'assertGrouped',
    expectInputValue: () => 'assertInputValue',
    expectNavigationTitle: () => 'assertNavigationTitle',
    expectTarget: () => 'assertTarget',
    expectToolbarCommand: () => 'assertToolbarCommand',
    expectVerbs: () => 'assertVerbs',
    focus: () => 'focus',
    hover: () => 'hover',
    narrow: () => 'narrow',
    press: () => 'press',
    pressDown: () => 'pointerPhase',
    pressKey: () => 'key',
    pressToolbarCommand: () => 'pressToolbarCommand',
    pressUp: () => 'pointerPhase',
    relaunch: () => 'relaunch',
    select: () => 'select',
    submit: () => 'submit',
  })
}

async function runSteps(
  steps: readonly TestStep[],
  selections: readonly HostJourneySelection[],
  adapter: HostJourneyAdapter,
): Promise<void> {
  for (const step of steps) {
    if (step.kind === 'select') {
      await runSteps(step.steps, [...selections, { index: step.index, source: step.source, tag: step.tag }], adapter)
    } else {
      await adapter.execute({ ...step, selections })
    }
  }
}

function formatSource(source: TestSource): string {
  if (source.range === undefined) {
    return source.filePath
  }
  return `${source.filePath}:${source.range.start.line + 1}:${source.range.start.character + 1}`
}
