import { expect, test } from '@playwright/test'
import { Errors, FS, Repo } from '@shared'
import {
  androidShellUrl,
  appiumFault,
  cleanupAppiumNativeHostProof,
  journeyFor,
  parseAndroidAvdName,
  requireNativeNavigationHosts,
  runIosBuildOnly,
  shouldReleaseAppiumTargetLease,
} from '../AppiumNativeHostProofCommand'
import { type HostJourney, runHostJourney } from '../journey/HostJourney'

test('build-only installs and exports with scoped Xcode, releases its lease, and retains the app for inspection', async () => {
  const events: string[] = []
  const receipts: unknown[] = []
  const environment = { DEVELOPER_DIR: '/Applications/Xcode-beta.app/Contents/Developer' }
  const request = {
    kind: 'native',
    mode: 'ios',
    device: 'simulator',
    subject: 'native-navigation',
    seed: 1,
    browserChannel: 'chrome',
    buildOnly: true,
    output: '/retained',
  } as const
  const context = { artifactRoot: '/artifacts', environment, playwright: '', runId: 'run-id' }
  const build = { appId: 'unique-app', root: '/build', compiledArtifactDigest: 'compiled', entrySourceDigest: 'source' }
  await runIosBuildOnly(request, context, build, {
    acquire: async () => {
      events.push('acquire')
      return {
        release: async () => {
          events.push('release')
        },
      }
    },
    install: async (platform, device, preparation, env) => {
      expect([platform, device, preparation, env]).toEqual(['ios', 'simulator', build, environment])
      events.push('install')
    },
    appPath: async () => '/build/Review.app',
    exportApp: async input => {
      expect(input).toEqual({
        appPath: '/build/Review.app',
        output: '/retained',
        environment,
        appId: 'unique-app',
        runId: 'run-id',
      })
      events.push('export')
    },
    writeReceipt: async (_path, receipt) => {
      receipts.push(receipt)
      events.push('receipt')
    },
  })
  expect(events).toEqual(['acquire', 'install', 'export', 'receipt', 'release'])
  expect(receipts).toEqual([
    expect.objectContaining({
      status: 'installed',
      mode: 'build-install-only',
      appId: 'unique-app',
      acceptance: 'Build and simulator installation only; no launch, visual inspection, or journey acceptance claimed.',
    }),
  ])
  const failed: unknown[] = []
  await expect(runIosBuildOnly(request, context, build, {
    acquire: async () => ({
      release: async () => {
        events.push('failed-release')
      },
    }),
    install: async () => Errors.throwHostEnvironment('build failed'),
    writeReceipt: async (_path, receipt) => {
      failed.push(receipt)
    },
  })).rejects.toThrow('build failed')
  expect(failed).toEqual([expect.objectContaining({ status: 'failed', failure: 'build failed' })])
  expect(events.at(-1)).toBe('failed-release')
})

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

test('Syntax2 Appium proof selects the installed Library native acceptance check', async () => {
  await expect(journeyFor('syntax2')).resolves.toMatchObject({
    check: { name: 'renders the installed Library', run: { appName: 'LibraryApp' } },
  })
})

test('retains the real target lease when a proof receipt reports an ambiguous failed open', () => {
  expect(shouldReleaseAppiumTargetLease({ retainsTargetLease: true })).toBe(false)
  expect(shouldReleaseAppiumTargetLease({ cleanupFailure: { message: 'close failed' } })).toBe(false)
  expect(shouldReleaseAppiumTargetLease({})).toBe(true)
  expect(shouldReleaseAppiumTargetLease(undefined)).toBe(false)
})

test('attempts owned cleanup but retains the target when Appium server close fails', async () => {
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

    expect(events).toEqual(['close server', 'uninstall'])
    expect(failures.map(failure => [failure.operation, Errors.messageOf(failure.error)])).toEqual([
      ['close Appium server', 'server close failed'],
      ['uninstall isolated application', 'uninstall failed'],
      ['retain host target lease', 'Appium driver or server shutdown is unproved; the target fence remains retained.'],
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
    expect(failures).toEqual([expect.objectContaining({ operation: 'retain host target lease' })])
  } finally {
    await FS.remove(artifactRoot)
  }
})

for (const startupCleanupProved of [true, false]) {
  test(`startup without a returned server ${startupCleanupProved ? 'releases a proved' : 'retains an unproved'} target`, async () => {
    const artifactRoot = await Repo.mkScratchDir('tao-appium-startup-custody-')
    let releases = 0
    try {
      const failures = await cleanupAppiumNativeHostProof({
        artifactRoot,
        serverShutdownProved: startupCleanupProved,
        targetLease: {
          release: async () => {
            releases++
          },
        },
        uninstall: async () => {},
      })
      expect(releases).toBe(startupCleanupProved ? 1 : 0)
      expect(failures.map(failure => failure.operation)).toEqual(
        startupCleanupProved ? [] : ['retain host target lease'],
      )
    } finally {
      await FS.remove(artifactRoot)
    }
  })
}

test('log and uninstall failures preserve diagnostics without overriding proved server shutdown', async () => {
  const artifactRoot = await Repo.mkScratchDir('tao-appium-cleanup-diagnostics-')
  const events: string[] = []
  try {
    const failures = await cleanupAppiumNativeHostProof({
      artifactRoot,
      server: {
        close: async () => {
          events.push('close server')
        },
        logs: () => Errors.throwHostEnvironment('log failed'),
      },
      serverShutdownProved: false,
      targetLease: {
        release: async () => {
          events.push('release target')
        },
      },
      uninstall: async () => Errors.throwHostEnvironment('uninstall failed'),
    })
    expect(events).toEqual(['close server', 'release target'])
    expect(failures.map(failure => failure.operation)).toEqual([
      'write Appium server log',
      'uninstall isolated application',
    ])
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
