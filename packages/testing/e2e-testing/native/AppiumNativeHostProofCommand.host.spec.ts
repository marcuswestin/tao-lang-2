import { expect, test } from '@playwright/test'
import { Errors, FS, Repo } from '@shared'
import {
  androidShellUrl,
  appiumFault,
  cleanupAppiumNativeHostProof,
  parseAndroidAvdName,
  shouldReleaseAppiumTargetLease,
} from '../AppiumNativeHostProofCommand'
import type { HostJourney } from '../journey/HostJourney'

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
