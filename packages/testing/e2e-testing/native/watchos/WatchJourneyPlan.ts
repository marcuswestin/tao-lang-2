import { Errors, Switch } from '@shared'
import { type HostJourney, type HostJourneyOperation, runHostJourney } from '../../journey/HostJourney'

type Source = HostJourney['check']['source']

type WatchJourneyOperation = Readonly<
  | { kind: 'run'; appName: string; appSourcePath: string; source: Source }
  | { kind: 'press'; text: string; source: Source }
  | { kind: 'expect'; text: string; missing: boolean; source: Source }
  | { kind: 'expectNavigationTitle'; title: string; source: Source }
>

/** The deliberately small, source-linked wire contract understood by WatchJourneyTests.swift. */
export type WatchJourneyPlan = Readonly<{
  version: 1
  bundleIdentifier: string
  check: string
  sourcePath: string
  operations: readonly WatchJourneyOperation[]
}>

/** Records a whole check before any native export or host execution may begin. */
export async function planWatchJourney(journey: HostJourney, bundleIdentifier: string): Promise<WatchJourneyPlan> {
  if (journey.version !== 1) {
    unsupported(journey.check.source, 'test-plan version')
  }
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(bundleIdentifier)) {
    unsupported(journey.check.source, 'bundle identifier')
  }
  for (const field of ['fixture', 'device'] as const) {
    if (journey.check[field] !== undefined) {
      unsupported(journey.check.source, field)
    }
  }
  const stubs = journey.check.actionFailureStubs
  if (stubs !== undefined && (!Array.isArray(stubs) || stubs.length !== 0)) {
    unsupported(journey.check.source, 'actionFailureStubs')
  }
  fields(
    journey.check,
    ['name', 'source', 'run', 'steps', 'fixture', 'device', 'actionFailureStubs'],
    journey.check.source,
  )
  fields(journey.check.run, ['appName', 'appSourcePath', 'source'], journey.check.run.source)
  const operations: WatchJourneyOperation[] = []
  await runHostJourney(journey, {
    capabilities: ['runApplication', 'press', 'assertText', 'assertNavigationTitle'],
    async execute(operation) {
      operations.push(recordOperation(operation))
    },
  })
  return {
    version: 1,
    bundleIdentifier,
    check: journey.check.name,
    sourcePath: journey.sourcePath,
    operations,
  }
}

function recordOperation(operation: HostJourneyOperation): WatchJourneyOperation {
  if ('selections' in operation && operation.selections.length !== 0) {
    unsupported(operation.source, 'selection scope')
  }
  return Switch.kind<HostJourneyOperation, WatchJourneyOperation>(operation, {
    run: next => {
      keys(next, ['kind', 'appName', 'appSourcePath', 'source'])
      text(next.appName, next.source)
      text(next.appSourcePath, next.source)
      return { kind: 'run', appName: next.appName, appSourcePath: next.appSourcePath, source: next.source }
    },
    press: next => {
      keys(next, ['kind', 'selector', 'text', 'source', 'selections'])
      if (next.selector !== 'text') {
        unsupported(next.source, `press selector '${next.selector}'`)
      }
      text(next.text, next.source)
      return { kind: 'press', text: next.text, source: next.source }
    },
    expect: next => {
      keys(next, ['kind', 'selector', 'text', 'missing', 'source', 'selections'])
      if (next.selector !== 'text') {
        unsupported(next.source, `expect selector '${next.selector}'`)
      }
      text(next.text, next.source)
      if (typeof next.missing !== 'boolean') {
        unsupported(next.source, 'missing expectation flag')
      }
      return { kind: 'expect', text: next.text, missing: next.missing, source: next.source }
    },
    expectNavigationTitle: next => {
      keys(next, ['kind', 'title', 'source', 'selections'])
      text(next.title, next.source)
      return { kind: 'expectNavigationTitle', title: next.title, source: next.source }
    },
    advance: unsupportedOperation,
    back: unsupportedOperation,
    datasourceFailure: unsupportedOperation,
    enter: unsupportedOperation,
    expectCheckboxState: unsupportedOperation,
    expectFocusRegion: unsupportedOperation,
    expectGroup: unsupportedOperation,
    expectInputValue: unsupportedOperation,
    expectTarget: unsupportedOperation,
    expectToolbarCommand: unsupportedOperation,
    expectVerbs: unsupportedOperation,
    focus: unsupportedOperation,
    hover: unsupportedOperation,
    narrow: unsupportedOperation,
    network: unsupportedOperation,
    pressDown: unsupportedOperation,
    pressKey: unsupportedOperation,
    pressToolbarCommand: unsupportedOperation,
    pressUp: unsupportedOperation,
    relaunch: unsupportedOperation,
    submit: unsupportedOperation,
    waitForSync: unsupportedOperation,
  })
}

function keys(operation: HostJourneyOperation, allowed: readonly string[]): void {
  fields(operation, allowed, operation.source)
}

function fields(value: object, allowed: readonly string[], source: Source): void {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      unsupported(source, `field '${field}'`)
    }
  }
}

function text(value: string, source: Source): void {
  if (typeof value !== 'string' || value.length === 0) {
    unsupported(source, 'empty or non-string target')
  }
}

function unsupportedOperation(operation: HostJourneyOperation): never {
  return unsupported(operation.source, `operation '${operation.kind}'`)
}

function unsupported(source: Source, feature: string): never {
  const location = source.range === undefined
    ? source.filePath
    : `${source.filePath}:${source.range.start.line + 1}:${source.range.start.character + 1}`
  return Errors.throwUserInput(`watchOS journey does not support ${feature} at ${location}.`, { source })
}
