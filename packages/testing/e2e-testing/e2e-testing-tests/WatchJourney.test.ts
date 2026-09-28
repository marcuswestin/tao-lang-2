import { FS, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import { compileHostJourney, type HostJourney } from '../journey/HostJourney'
import { planWatchJourney } from '../native/watchos/WatchJourneyPlan'
import { prepareWatchJourney } from '../native/watchos/WatchJourneyRunner'

const source = {
  filePath: 'WatchHello.test.tao',
  range: { start: { line: 7, character: 2 }, end: { line: 7, character: 24 } },
}
const bundleIdentifier = 'com.devtao.preview.watchhello'

function journey(steps: HostJourney['check']['steps']): HostJourney {
  return {
    version: 1,
    sourcePath: 'WatchHello.test.tao',
    check: {
      name: 'counts reps',
      source,
      run: { appName: 'WatchHello', appSourcePath: 'WatchHello.tao', source },
      steps,
    },
  }
}

Test('records launch and authored operations in order with exact native targets and source locations', async () => {
  const plan = await planWatchJourney(
    journey([
      { kind: 'expectNavigationTitle', title: 'Workout', source },
      { kind: 'expect', selector: 'text', text: '0 of 12', missing: false, source },
      { kind: 'press', selector: 'text', text: 'Rep', source },
      { kind: 'expect', selector: 'text', text: '1 of 12', missing: false, source },
      { kind: 'press', selector: 'text', text: 'Reset', source },
      { kind: 'expect', selector: 'text', text: '1 of 12', missing: true, source },
    ]),
    bundleIdentifier,
  )
  Expect(JSON.parse(JSON.stringify(plan))).toEqual({
    version: 1,
    bundleIdentifier: 'com.devtao.preview.watchhello',
    check: 'counts reps',
    sourcePath: 'WatchHello.test.tao',
    operations: [
      { kind: 'run', appName: 'WatchHello', appSourcePath: 'WatchHello.tao', source },
      { kind: 'expectNavigationTitle', title: 'Workout', source },
      { kind: 'expect', text: '0 of 12', missing: false, source },
      { kind: 'press', text: 'Rep', source },
      { kind: 'expect', text: '1 of 12', missing: false, source },
      { kind: 'press', text: 'Reset', source },
      { kind: 'expect', text: '1 of 12', missing: true, source },
    ],
  })
})

Test('accepts the real compiled WatchHello journey and preserves its limit and reset assertions', async () => {
  const compiled = await compileHostJourney(Repo.resolvePath('Apps/WatchHello/WatchHello.test.tao'), {
    suite: 'WatchHello',
    check: 'records one set and resets',
  })
  Expect(compiled.check.actionFailureStubs).toEqual([])
  const plan = await planWatchJourney(compiled, bundleIdentifier)
  Expect(plan.operations.map(operation => operation.kind)).toEqual([
    'run',
    'expectNavigationTitle',
    'expect',
    'press',
    'expect',
    'press',
    'expect',
    'press',
    'press',
    'press',
    'press',
    'press',
    'press',
    'press',
    'press',
    'press',
    'press',
    'expect',
    'press',
    'expect',
    'press',
    'expect',
  ])
  Expect(plan.operations.filter(operation => operation.kind === 'expect').map(operation => operation.text)).toEqual([
    '0 of 12',
    '1 of 12',
    '2 of 12',
    '12 of 12',
    '12 of 12',
    '0 of 12',
  ])
  Expect(plan.operations[1]).toMatchObject({ kind: 'expectNavigationTitle', title: 'One set' })
  Expect(plan.operations[21]?.source.filePath).toEndWith('Apps/WatchHello/WatchHello.test.tao')
  Expect(plan.operations[21]?.source.range?.start.line).toBe(25)
})

for (
  const metadata of [
    { device: { device: 'phone', height: 800, width: 400 } },
    { fixture: { accounts: [], creates: [], name: 'empty' } },
    { actionFailureStubs: [{ actionKey: 'Save', caseName: 'failed' }] },
  ] as const
) {
  Test(`rejects check-level ${Object.keys(metadata)[0]} rather than dropping its semantics`, async () => {
    const input = journey([])
    await Expect(
      planWatchJourney({ ...input, check: { ...input.check, ...metadata } } as HostJourney, bundleIdentifier),
    )
      .rejects.toThrow('WatchHello.test.tao:8:3')
  })
}

Test('rejects unsupported operations, selectors and payloads at their authored location', async () => {
  const unsupported: HostJourney['check']['steps'] = [
    { kind: 'press', selector: 'tag', text: 'rep', source },
    { kind: 'expect', selector: 'label', text: 'Rep', missing: false, source },
    { kind: 'expectToolbarCommand', label: 'Rep', enabled: false, source },
    { kind: 'advance', milliseconds: 1000, source },
    { kind: 'select', index: 1, tag: 'rep', steps: [], source },
    { kind: 'expect', selector: 'text', text: 'Rep', missing: 'false', source } as never,
    { kind: 'press', selector: 'text', text: 'Rep', source, extra: true } as never,
  ]
  for (const step of unsupported) {
    await Expect(planWatchJourney(journey([step]), bundleIdentifier)).rejects.toThrow('WatchHello.test.tao:8:3')
  }
})

Test('does not export any test artifacts if the last operation is unsupported', async () => {
  const root = await Repo.mkScratchDir('watch-journey-preflight-')
  try {
    const outputDirectory = FS.resolvePath('uncreated', root)
    await Expect(prepareWatchJourney({
      bundleIdentifier,
      outputDirectory,
      journey: journey([
        { kind: 'press', selector: 'text', text: 'Rep', source },
        { kind: 'expect', selector: 'placeholder', text: 'wrong', missing: false, source },
      ]),
    })).rejects.toThrow("expect selector 'placeholder'")
    Expect(await FS.exists(outputDirectory)).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

Test('exports the central XCTest interpreter and selected JSON resource for the native exporter', async () => {
  const outputDirectory = await Repo.mkScratchDir('watch-journey-export-')
  try {
    const output = await prepareWatchJourney({ journey: journey([]), bundleIdentifier, outputDirectory })
    const serialized = JSON.parse(await FS.readText(output.plan))
    Expect(serialized.bundleIdentifier).toBe('com.devtao.preview.watchhello')
    Expect(serialized.operations).toHaveLength(1)
    Expect(serialized.operations[0].kind).toBe('run')
    Expect(await FS.readText(output.source)).toContain('final class WatchJourneyTests: XCTestCase')
    Expect(FS.basename(output.plan)).toBe('WatchJourneyPlan.json')
  } finally {
    await FS.remove(outputDirectory)
  }
})
