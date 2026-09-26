import { expect, test } from '@playwright/test'
import { Errors, FS, Repo } from '@shared'
import {
  androidShellUrl,
  appiumFault,
  cleanupAppiumNativeHostProof,
  parseAndroidAvdName,
  requireNativeNavigationHosts,
  shouldReleaseAppiumTargetLease,
} from '../AppiumNativeHostProofCommand'
import { type HostJourney, runHostJourney } from '../journey/HostJourney'

test("escapes Android control query separators for adb's device-side shell parse", () => {
  expect(androidShellUrl('taohost://control?runId=one&advanceMs=1000')).toBe(
    'taohost://control?runId=one\\&advanceMs=1000',
  )
})

test("maps an ADB emulator serial response to Expo's AVD name without treating its acknowledgement as a name", () => {
  expect(parseAndroidAvdName('Tao_Pixel_API_36\r\nOK\r\n', 'emulator-5554')).toBe('Tao_Pixel_API_36')
  expect(() => parseAndroidAvdName('first\nsecond\nOK\n', 'emulator-5554')).toThrow(
    "Android emulator 'emulator-5554' reported an ambiguous AVD name.",
  )
})

test('binds the HNReader mutation to the post-relaunch source-ranged assertion rather than its duplicate text', () => {
  const journey: HostJourney = {
    check: {
      name: 'keeps reading history',
      run: { appName: 'HNReaderStub', appSourcePath: 'HNReader.tao', source: source(1) },
      source: source(1),
      steps: [
        { kind: 'expect', missing: false, selector: 'text', source: source(10), text: '2 opened' },
        { fresh: false, kind: 'relaunch', source: source(20) },
        { kind: 'expect', missing: false, selector: 'text', source: source(30), text: '2 opened' },
      ],
    },
    sourcePath: 'HNReader.test.tao',
    version: 1,
  }

  expect(appiumFault('hnreader-reading-history-no-write', journey).expectedAssertion).toEqual({
    operation: 'expect',
    sourceMarker: 'HNReader.test.tao:30:0:30:12',
    sourcePath: 'HNReader.test.tao',
    text: '2 opened',
  })
})

test('retains the real target lease when a proof receipt reports an ambiguous failed open', () => {
  expect(shouldReleaseAppiumTargetLease({ retainsTargetLease: true })).toBe(false)
  expect(shouldReleaseAppiumTargetLease({ cleanupFailure: { message: 'close failed' } })).toBe(false)
  expect(shouldReleaseAppiumTargetLease({})).toBe(true)
})

test('attempts Appium server close, uninstall, and target release independently while preserving every failure', async () => {
  const artifactRoot = await Repo.mkScratchDir('tao-appium-cleanup-')
  const events: string[] = []
  try {
    const failures = await cleanupAppiumNativeHostProof({
      artifactRoot,
      server: {
        close: async () => {
          events.push('close server')
          Errors.throwHostEnvironment('server close failed')
        },
        logs: () => 'server log',
      },
      targetLease: {
        release: async () => {
          events.push('release target')
          Errors.throwHostEnvironment('target release failed')
        },
      },
      uninstall: async () => {
        events.push('uninstall')
        Errors.throwHostEnvironment('uninstall failed')
      },
    })

    expect(events).toEqual(['close server', 'uninstall', 'release target'])
    expect(failures.map(failure => [failure.operation, Errors.messageOf(failure.error)])).toEqual([
      ['close Appium server', 'server close failed'],
      ['uninstall isolated application', 'uninstall failed'],
      ['release host target lease', 'target release failed'],
    ])
    await expect(FS.readText(FS.resolvePath('appium/server.log', artifactRoot))).resolves.toBe('server log')
  } finally {
    await FS.remove(artifactRoot)
  }
})

function source(
  line: number,
): {
  filePath: string
  range: { end: { character: number; line: number }; start: { character: number; line: number } }
} {
  return {
    filePath: 'HNReader.test.tao',
    range: { end: { character: 12, line }, start: { character: 0, line } },
  }
}

test('retains a target lease when driver cleanup was ambiguous', async () => {
  const artifactRoot = await Repo.mkScratchDir('tao-appium-retained-target-')
  const events: string[] = []
  try {
    const failures = await cleanupAppiumNativeHostProof({
      artifactRoot,
      releaseTargetLease: false,
      targetLease: {
        release: async () => {
          events.push('release target')
        },
      },
      uninstall: async () => {
        events.push('uninstall')
      },
    })
    expect(events).toEqual(['uninstall'])
    expect(failures).toEqual([])
  } finally {
    await FS.remove(artifactRoot)
  }
})

test('requires actual native-host receipts before and after the authored navigation journey', () => {
  const authored = { kind: 'press' as const, selector: 'label' as const, source: source(10), text: 'Library' }
  const journey: HostJourney = {
    version: 1,
    sourcePath: 'Native Navigation.test.tao',
    check: {
      name: 'switch tabs',
      source: source(1),
      run: { appName: 'NativeNavigation', appSourcePath: 'Native Navigation.tao', source: source(1) },
      steps: [authored],
    },
  }
  const guarded = requireNativeNavigationHosts(journey)
  expect(guarded.check.steps).toEqual([
    expect.objectContaining({ kind: 'expect', missing: false, text: 'Native navigation host: tabs and stack' }),
    authored,
    expect.objectContaining({ kind: 'expect', missing: false, text: 'Native navigation host: tabs and stack' }),
  ])
  expect(journey.check.steps).toEqual([authored])
  const hnreader = requireNativeNavigationHosts(journey, 'hnreader')
  expect(hnreader.check.steps).toEqual([
    expect.objectContaining({ kind: 'expect', missing: false, text: 'Native navigation host: stack' }),
    authored,
    expect.objectContaining({ kind: 'expect', missing: false, text: 'Native navigation host: stack' }),
  ])
})

for (const fallbackAt of ['before relaunch', 'after relaunch'] as const) {
  test(`native receipts stop on fallback ${fallbackAt} before a new lifetime can hide it`, async () => {
    const journey: HostJourney = {
      version: 1,
      sourcePath: 'HNReader.test.tao',
      check: {
        name: 'restores history',
        source: source(1),
        run: { appName: 'HNReaderStub', appSourcePath: 'HNReader.tao', source: source(1) },
        steps: [
          { kind: 'press', selector: 'label', text: 'Before relaunch', source: source(10) },
          { kind: 'relaunch', fresh: false, source: source(11) },
          { kind: 'press', selector: 'label', text: 'After relaunch', source: source(12) },
        ],
      },
    }
    const operations: string[] = []
    let native = true
    await expect(runHostJourney(requireNativeNavigationHosts(journey, 'hnreader'), {
      capabilities: ['runApplication', 'assertText', 'press', 'relaunch'],
      async execute(operation) {
        operations.push(operation.kind)
        if (operation.kind === 'expect' && !native) {
          Errors.throwHostEnvironment('native stack fallback receipt')
        }
        if (operation.kind === 'press') {
          // A later action could restore a native-looking receipt. It must not erase the failed boundary.
          native = operation.text === 'After relaunch' || fallbackAt !== 'before relaunch'
        }
        if (operation.kind === 'relaunch') {
          native = fallbackAt !== 'after relaunch'
        }
      },
    })).rejects.toThrow('native stack fallback receipt')
    expect(operations).toEqual(
      fallbackAt === 'before relaunch'
        ? ['run', 'expect', 'press', 'expect']
        : ['run', 'expect', 'press', 'expect', 'relaunch', 'expect'],
    )
  })
}

test('native acceptance rejects a scoped relaunch instead of looking for global receipts inside a selection', () => {
  const journey: HostJourney = {
    version: 1,
    sourcePath: 'HNReader.test.tao',
    check: {
      name: 'scoped relaunch',
      source: source(1),
      run: { appName: 'HNReaderStub', appSourcePath: 'HNReader.tao', source: source(1) },
      steps: [{
        kind: 'select',
        tag: 'reading',
        index: 1,
        source: source(10),
        steps: [{ kind: 'relaunch', fresh: false, source: source(11) }],
      }],
    },
  }
  expect(() => requireNativeNavigationHosts(journey, 'hnreader')).toThrow('relaunch outside select blocks')
})
