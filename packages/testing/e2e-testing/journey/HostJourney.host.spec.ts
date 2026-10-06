import { expect, test } from '@playwright/test'
import { Errors, FS, Repo } from '@shared'
import {
  compileHostJourney,
  type HostJourney,
  type HostJourneyAdapter,
  type HostJourneyCapability,
  type HostJourneyOperation,
  HostJourneyUnsupportedCapabilityError,
  runHostJourney,
} from './HostJourney'

const selector = {
  check: 'keeps reading history across a relaunch in most-recent order',
  suite: 'hn reader',
} as const

const capabilities = [
  'advanceTime',
  'assertCheckboxState',
  'assertFocusRegion',
  'assertGrouped',
  'assertInputValue',
  'assertNavigationTitle',
  'assertTarget',
  'assertText',
  'assertToolbarCommand',
  'assertVerbs',
  'back',
  'focus',
  'hover',
  'key',
  'narrow',
  'pointerPhase',
  'press',
  'pressToolbarCommand',
  'relaunch',
  'runApplication',
  'select',
  'submit',
  'textInput',
] as const satisfies readonly HostJourneyCapability[]

let journey: HostJourney

test.beforeAll(async () => {
  journey = await compileHostJourney(Repo.resolvePath('Apps/HNReader/HNReader.test.tao'), selector)
})

test('selects the one HNReader lifecycle journey with authored source locations', async () => {
  const lines = (await FS.readText(journey.sourcePath)).split('\n')
  expect(journey.version).toBe(1)
  expect(journey.check.name).toBe('keeps reading history across a relaunch in most-recent order')
  expect(journey.check.source.filePath).toMatch(/Apps\/HNReader\/HNReader\.test\.tao$/u)
  const checkLine = journey.check.source.range!.start.line
  expect(lines[checkLine]?.trim()).toBe(`test "${selector.check}" {`)
  expect(journey.check.run.source.range!.start.line).toBe(checkLine + 1)
  expect(lines[checkLine + 1]?.trim()).toBe('run HNReaderStub')
  expect(journey.check.steps.map(step => step.kind)).toEqual([
    'press',
    'press',
    'advance',
    'press',
    'press',
    'press',
    'expect',
    'select',
    'select',
    'press',
    'expectNavigationTitle',
    'relaunch',
    'expectNavigationTitle',
    'press',
    'expect',
    'select',
    'select',
  ])
})

test('preflights missing row selection before it sends any host input and reports the select source', async () => {
  const operations: HostJourneyOperation[] = []
  const adapter: HostJourneyAdapter = {
    capabilities: capabilities.filter(capability => capability !== 'select'),
    async execute(operation) {
      operations.push(operation)
    },
  }

  const failure = await runHostJourney(journey, adapter).catch(error => error)

  expect(failure).toBeInstanceOf(HostJourneyUnsupportedCapabilityError)
  const unsupported = failure as HostJourneyUnsupportedCapabilityError
  expect(unsupported.capability).toBe('select')
  expect(unsupported.source.filePath).toMatch(/Apps\/HNReader\/HNReader\.test\.tao$/u)
  const lines = (await FS.readText(journey.sourcePath)).split('\n')
  const selectionLine = unsupported.source.range!.start.line
  expect(lines[selectionLine]?.trim()).toBe('select #reading[1] {')
  expect(selectionLine).toBeGreaterThan(journey.check.source.range!.start.line)
  expect(selectionLine).toBeLessThan(journey.check.source.range!.end.line)
  expect(operations).toEqual([])
})

test('joins a host lifecycle hook before admitting the next authored operation', async () => {
  const phases: string[] = []
  await expect(runHostJourney(journey, {
    capabilities,
    async execute(operation) {
      phases.push(operation.kind)
    },
  }, async operation => {
    phases.push(`after:${operation.kind}`)
    if (operation.kind === 'press') {
      Errors.throwUserInput('Lifecycle proof failed.')
    }
  })).rejects.toThrow('Lifecycle proof failed.')
  expect(phases).toEqual(['run', 'after:run', 'press', 'after:press'])
})

test('preserves lifecycle and selected-row scope in neutral host operations', async () => {
  const operations: HostJourneyOperation[] = []
  const adapter: HostJourneyAdapter = {
    capabilities,
    async execute(operation) {
      operations.push(operation)
    },
  }

  await runHostJourney(journey, adapter)

  expect(operations.map(operation => operation.kind)).toEqual([
    'run',
    'press',
    'press',
    'advance',
    'press',
    'press',
    'press',
    'expect',
    'expect',
    'expect',
    'press',
    'expectNavigationTitle',
    'relaunch',
    'expectNavigationTitle',
    'press',
    'expect',
    'expect',
    'expect',
  ])
  expect(operations[8]).toMatchObject({
    kind: 'expect',
    selections: [{ index: 1, tag: 'reading' }],
    text: 'Why local-first sync wins',
  })
  expect(operations[9]).toMatchObject({
    kind: 'expect',
    selections: [{ index: 2, tag: 'reading' }],
    text: 'Show HN: A Tao reader',
  })
  expect(operations[16]).toMatchObject({
    kind: 'expect',
    selections: [{ index: 1, tag: 'reading' }],
    text: 'Why local-first sync wins',
  })
})

test('propagates a host assertion failure from the authored assertion', async () => {
  const adapter: HostJourneyAdapter = {
    capabilities,
    async execute(operation) {
      if (operation.kind === 'expect' && operation.text === '2 opened') {
        return Errors.throwUserInput('Host assertion failed: expected visible text "2 opened".')
      }
    },
  }

  await expect(runHostJourney(journey, adapter)).rejects.toThrow(
    'Host assertion failed: expected visible text "2 opened".',
  )
})

test('compiles and emits the authored Clockwork countdown journey', async () => {
  const clockwork = await compileHostJourney(
    Repo.resolvePath('packages/testing/e2e-testing/fixtures/Clockwork/Clockwork.test.tao'),
    { check: 'counts down after a controlled second', suite: 'clockwork' },
  )
  const operations: HostJourneyOperation[] = []
  const adapter: HostJourneyAdapter = {
    capabilities: ['advanceTime', 'assertText', 'runApplication'],
    async execute(operation) {
      operations.push(operation)
    },
  }

  await runHostJourney(clockwork, adapter)

  expect(clockwork.check.source.filePath).toMatch(/fixtures\/Clockwork\/Clockwork\.test\.tao$/u)
  expect(operations).toMatchObject([
    { appName: 'Clockwork', kind: 'run' },
    { kind: 'expect', text: 'Countdown: 0:10' },
    { kind: 'advance', milliseconds: 1_000 },
    { kind: 'expect', text: 'Control received: advance 1000ms' },
    { kind: 'expect', text: 'Countdown: 0:09' },
  ])
})

test('compiles real Clipboard operations against the maintained Native Bridge app without mocked native modules', async () => {
  const clipboard = await compileHostJourney(
    Repo.resolvePath('Apps/Test Apps/Native Bridge/.host-tests/Clipboard.test.tao'),
    {
      suite: 'Native Clipboard acceptance',
      check: 'round trips native clipboard formats and manages change subscriptions',
    },
  )
  expect(clipboard.check.run.appName).toBe('NativeBridge')
  expect(clipboard.check.run.appSourcePath).toBe(Repo.resolvePath('Apps/Test Apps/Native Bridge/App.tao'))
  const operations: HostJourneyOperation[] = []
  await runHostJourney(clipboard, {
    capabilities,
    execute: async operation => {
      operations.push(operation)
    },
  })
  expect(operations.filter(operation => operation.kind === 'press').map(operation => operation.text)).toEqual(
    expect.arrayContaining([
      'Copy text',
      'Read HTML',
      'Read PNG',
      'Read JPEG',
      'Copy sample URL',
      'Start listening',
      'Stop listening',
      'Stop via deprecated API',
    ]),
  )
})
