import { createAppiumWebDriverClient } from '@appium-driver'
import { HostControlError } from '@host-control'
import { Errors, FS, Time } from '@shared'
import { Deferred, Expect, mkTestDir, MockModule, Test, testOverrideSlot } from '@shared/test'
import { createManagedAppiumAndroidController } from '../native/appium-android/AppiumAndroidController'
import { appiumAndroidClient, appiumXcuiTestClient } from '../native/AppiumMobileClients'
import { runManagedMobileFixture } from '../native/ManagedMobileFixture'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

// Complete transparent 1×1 RGBA PNG, including IHDR, compressed IDAT and IEND chunks with CRCs.
const transparentPixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='

const originalFS = { ...FS }
const diagnosticWrite = testOverrideSlot({
  read: () => FS.writeExclusiveFile,
  write: value => {
    MockModule(new URL('../../../shared/shared-src/FS.ts', import.meta.url).pathname, () => ({
      ...originalFS,
      writeExclusiveFile: value,
    }))
  },
})

for (
  const fault of [
    'capture',
    'bundle-before',
    'bundle-springboard',
    'bundle-expo-go',
    'bundle-missing',
    'bundle-transport',
    'bundle-after-source',
    'bundle-after-png',
    'generation-revoked',
    'invalid-base64',
    'non-png',
    'source-transport',
  ] as const
) {
  Test(`managed iOS pre-handshake diagnostics ${fault} retain exact bundle and ownership fences`, async () => {
    const root = await mkTestDir('managed-ios-handshake-')
    let sourceRead = false
    let pngRead = false
    let generationCurrent = true
    const paths: string[] = []
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform: 'ios', id: 'owned-simulator' },
        resources: [{ name: 'ios-simulator:owned-simulator', generation: 'retained' }],
        runtime: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'generation',
          projectRoot: '/fresh',
          appName: 'FirebaseLiveAcceptance',
          sourceRevision: 'source',
          compiledRevision: 'compiled',
          nonce: 'nonce',
          kind: 'companion',
          appId: 'owned.bundle',
          devUrl: 'taostudiocompanion://dev',
        },
      },
      assertOwnerCurrent: async () => {},
      assertLoopCurrent: async () => {
        if (!generationCurrent) {
          Errors.throwHostEnvironment('generation revoked')
        }
      },
    })
    const factory = createAppiumWebDriverClient({
      request: async request => {
        if (request.path === '/session') {
          return { status: 200, body: { value: { sessionId: 'driver' } } }
        }
        if (request.purpose === 'managed-identity' && request.path.endsWith('/element')) {
          return { status: 404, body: { value: { error: 'no such element', message: 'iOS mounted marker absent' } } }
        }
        if (request.purpose === 'managed-diagnostic') {
          paths.push(request.path)
        }
        let value: unknown = null
        if (request.path.endsWith('/execute/sync')) {
          Expect(request.body).toEqual({ script: 'mobile: activeAppInfo', args: [] })
          if (request.purpose === 'managed-diagnostic' && fault === 'bundle-transport') {
            Errors.throwHostEnvironment('Foreground query failed with private-token.')
          }
          const foreign = request.purpose === 'managed-diagnostic' && (
            fault === 'bundle-before' || fault === 'bundle-springboard' || fault === 'bundle-expo-go'
            || fault === 'bundle-missing' || fault === 'bundle-after-source' && sourceRead
            || fault === 'bundle-after-png' && pngRead
          )
          value = {
            ...(fault === 'bundle-missing' && foreign ? {} : {
              bundleId: foreign
                ? fault === 'bundle-springboard'
                  ? 'com.apple.springboard'
                  : fault === 'bundle-expo-go'
                  ? 'host.exp.Exponent'
                  : 'unrelated.bundle'
                : 'owned.bundle',
            }),
          }
        } else if (request.path.endsWith('/source')) {
          sourceRead = true
          if (fault === 'source-transport') {
            throw new HostControlError('host', 'Diagnostic XML failed with private-token.')
          }
          if (fault === 'generation-revoked') {
            generationCurrent = false
          }
          value = '<XCUIElementTypeApplication name="Companion" />'
        } else if (request.path.endsWith('/screenshot')) {
          pngRead = true
          value = fault === 'invalid-base64' ? 'bad!' : fault === 'non-png' ? 'AQID' : transparentPixelPng
        }
        return { status: 200, body: { value } }
      },
    })
    try {
      const session = await appiumXcuiTestClient(factory, grant, {
        artifactRoot: root,
        assertOwnedTargetCurrent: async () => {
          if (!generationCurrent) {
            Errors.throwHostEnvironment('owned generation revoked')
          }
        },
      }).createSession({ platformName: 'iOS' })
      await Expect(grant.assertCurrent()).rejects.toThrow('iOS mounted marker absent')
      const directories = await FS.listDir(root)
      Expect(directories.length).toBe(1)
      if (fault === 'capture') {
        const directory = FS.resolvePath(directories[0]!, root)
        Expect(await FS.readFile(FS.resolvePath('handshake.png', directory)))
          .toEqual(Uint8Array.from(Buffer.from(transparentPixelPng, 'base64')))
        Expect(await FS.fileMode(FS.resolvePath('handshake.png', directory))).toBe(0o600)
        Expect(await FS.readJson(FS.resolvePath('diagnostic.json', directory))).toEqual({
          classification: 'runtime-identity-unproved',
          sourceIdentityProved: false,
          inputPerformed: false,
          captures: ['handshake.xml', 'handshake.png'],
        })
        Expect(paths.map(path => path.split('/').at(-1))).toEqual(['sync', 'source', 'sync', 'screenshot', 'sync'])
      } else {
        const directory = FS.resolvePath(directories[0]!, root)
        Expect(FS.basename(directory).startsWith('managed-handshake-failure-')).toBe(true)
        Expect(await FS.fileMode(directory)).toBe(0o700)
        Expect(await FS.listDir(directory)).toEqual(['diagnostic-failure.json'])
        const file = FS.resolvePath('diagnostic-failure.json', directory)
        Expect(await FS.fileMode(file)).toBe(0o600)
        Expect(await FS.readJson(file)).toEqual({
          classification: 'runtime-identity-unproved',
          status: fault.startsWith('bundle-') || fault === 'generation-revoked' ? 'refused' : 'failed',
          stage: fault.startsWith('bundle-')
            ? 'foreground-bundle'
            : fault === 'generation-revoked'
            ? 'ownership'
            : fault === 'source-transport'
            ? 'xml'
            : 'screenshot',
          ...(fault.startsWith('bundle-')
            ? {
              foregroundCategory: fault === 'bundle-springboard'
                ? 'springboard'
                : fault === 'bundle-expo-go'
                ? 'expo-go'
                : fault === 'bundle-missing'
                ? 'missing'
                : fault === 'bundle-transport'
                ? 'unobserved'
                : 'other',
            }
            : {}),
          ...(fault === 'bundle-springboard' ? { springBoardAlertStatus: 'empty' } : {}),
          expectedTarget: { platform: 'ios', id: 'owned-simulator' },
          loopGeneration: 'generation',
          sourceIdentityProved: false,
          inputPerformed: false,
          captures: [],
        })
        Expect(JSON.stringify(await FS.readJson(file))).not.toContain('private-token')
        Expect(JSON.stringify(await FS.readJson(file))).not.toContain('unrelated.bundle')
      }
      if (
        fault === 'bundle-before' || fault === 'bundle-springboard' || fault === 'bundle-expo-go'
        || fault === 'bundle-missing' || fault === 'bundle-transport'
      ) {
        Expect(sourceRead).toBe(false)
        Expect(pngRead).toBe(false)
      }
      if (fault === 'bundle-springboard') {
        Expect(paths.map(path => path.split('/').at(-1))).toEqual(['sync', 'text'])
      }
      if (fault === 'bundle-after-source' || fault === 'generation-revoked' || fault === 'source-transport') {
        Expect(pngRead).toBe(false)
      }
      generationCurrent = true
      await session.deleteSession()
    } finally {
      grant.revoke()
      await FS.remove(root)
    }
  })
}

for (const outcome of ['captured', 'over-limit', 'query-failed', 'revoked', 'borrowed'] as const) {
  Test(`owned iOS SpringBoard alert ${outcome} retains only bounded private text`, async () => {
    const root = await mkTestDir('managed-ios-alert-')
    const alertText = 'SpringBoard permission prompt with private-token'
    let generationCurrent = true
    const paths: string[] = []
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform: 'ios', id: 'owned-simulator' },
        resources: [{ name: 'ios-simulator:owned-simulator', generation: 'retained' }],
        runtime: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'generation',
          projectRoot: '/fresh',
          appName: 'FirebaseLiveAcceptance',
          sourceRevision: 'source',
          compiledRevision: 'compiled',
          nonce: 'nonce',
          kind: 'companion',
          appId: 'owned.bundle',
          devUrl: 'taostudiocompanion://dev',
        },
      },
      assertOwnerCurrent: async () => {},
      assertLoopCurrent: async () => {
        if (!generationCurrent) {
          Errors.throwHostEnvironment('generation revoked')
        }
      },
    })
    const factory = createAppiumWebDriverClient({
      request: async request => {
        if (request.path === '/session') {
          return { status: 200, body: { value: { sessionId: 'driver' } } }
        }
        if (request.method === 'DELETE') {
          return { status: 200, body: { value: null } }
        }
        if (request.purpose === 'managed-identity' && request.path.endsWith('/element')) {
          return { status: 404, body: { value: { error: 'no such element', message: 'iOS mounted marker absent' } } }
        }
        if (request.purpose === 'managed-diagnostic') {
          paths.push(request.path)
        }
        if (request.path.endsWith('/execute/sync')) {
          return { status: 200, body: { value: { bundleId: 'com.apple.springboard' } } }
        }
        if (request.path.endsWith('/alert/text')) {
          Expect(request.responseByteLimit).toBe(8 * 1024)
          if (outcome === 'query-failed') {
            Errors.throwHostEnvironment('Private alert query failed.')
          }
          if (outcome === 'revoked') {
            generationCurrent = false
          }
          return { status: 200, body: { value: outcome === 'over-limit' ? alertText.repeat(100) : alertText } }
        }
        Errors.throwUnexpected('A SpringBoard refusal cannot read source, pixels, or perform input.')
      },
    })
    try {
      const session = await appiumXcuiTestClient(factory, grant, {
        artifactRoot: root,
        assertOwnedTargetCurrent: async () => {
          if (outcome === 'borrowed') {
            Errors.throwHostEnvironment('borrowed simulator cannot capture')
          }
          if (!generationCurrent) {
            Errors.throwHostEnvironment('owned generation revoked')
          }
        },
      }).createSession({ platformName: 'iOS' })
      await Expect(grant.assertCurrent()).rejects.toThrow('foreground iOS bundle differs')
      const directories = await FS.listDir(root)
      Expect(directories.length).toBe(1)
      const directory = FS.resolvePath(directories[0]!, root)
      const files = await FS.listDir(directory)
      Expect(files).toEqual(
        outcome === 'captured'
          ? ['diagnostic-failure.json', 'springboard-alert.txt']
          : ['diagnostic-failure.json'],
      )
      const record = await FS.readJson(FS.resolvePath('diagnostic-failure.json', directory))
      Expect(record).toMatchObject({
        stage: outcome === 'borrowed' ? 'current-target' : outcome === 'revoked' ? 'ownership' : 'foreground-bundle',
        status: 'refused',
        captures: [],
        ...(outcome === 'borrowed' ? {} : {
          ...(outcome === 'revoked' ? {} : { foregroundCategory: 'springboard' }),
          springBoardAlertStatus: outcome === 'revoked' ? 'unobserved' : outcome,
        }),
      })
      Expect(JSON.stringify(record)).not.toContain('private-token')
      Expect(paths.map(path => path.split('/').at(-1))).toEqual(outcome === 'borrowed' ? [] : ['sync', 'text'])
      if (outcome === 'captured') {
        const alertPath = FS.resolvePath('springboard-alert.txt', directory)
        Expect(Buffer.from(await FS.readFile(alertPath)).toString('utf8')).toBe(alertText)
        Expect(await FS.fileMode(alertPath)).toBe(0o600)
      }
      generationCurrent = true
      await session.deleteSession()
    } finally {
      grant.revoke()
      await FS.remove(root)
    }
  })
}

for (const fault of ['write-failure', 'revoked-after-xml'] as const) {
  Test(`managed iOS diagnostics remove partial XML after ${fault}`, async () => {
    const root = await mkTestDir('managed-ios-partial-')
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform: 'ios', id: 'owned-simulator' },
        resources: [],
        runtime: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'generation',
          projectRoot: '/fresh',
          appName: 'FirebaseLiveAcceptance',
          sourceRevision: 'source',
          compiledRevision: 'compiled',
          nonce: 'nonce',
          kind: 'companion',
          appId: 'owned.bundle',
          devUrl: 'taostudiocompanion://dev',
        },
      },
      assertOwnerCurrent: async () => {},
      assertLoopCurrent: async () => {},
    })
    const factory = createAppiumWebDriverClient({
      request: async request => ({
        status: 200,
        body: {
          value: request.path === '/session'
            ? { sessionId: 'driver' }
            : request.path.endsWith('/execute/sync')
            ? { bundleId: 'owned.bundle' }
            : request.path.endsWith('/source')
            ? '<Application secret="private" />'
            : request.path.endsWith('/screenshot')
            ? transparentPixelPng
            : null,
        },
      }),
    })
    const originalWrite = FS.writeExclusiveFile
    let xmlWritten = false
    const restore = diagnosticWrite.install(async (path, content, options) => {
      await originalWrite(path, content, options)
      if (FS.basename(path) === 'handshake.xml') {
        xmlWritten = true
        if (fault === 'write-failure') {
          Errors.throwHostEnvironment('Private post-write failure.')
        }
        grant.revokeInput()
      }
    })
    try {
      await appiumXcuiTestClient(factory, grant, {
        artifactRoot: root,
        assertOwnedTargetCurrent: async () => {},
      }).createSession({ platformName: 'iOS' })
      await Expect(grant.assertCurrent()).rejects.toThrow('Appium did not identify the mounted managed marker')
      Expect(xmlWritten).toBe(true)
      const directories = await FS.listDir(root)
      Expect(directories.length).toBe(1)
      Expect(directories[0]!.startsWith('managed-handshake-failure-')).toBe(true)
      const directory = FS.resolvePath(directories[0]!, root)
      Expect(await FS.listDir(directory)).toEqual(['diagnostic-failure.json'])
      const record = await FS.readJson(FS.resolvePath('diagnostic-failure.json', directory))
      Expect(record).toMatchObject({
        stage: fault === 'write-failure' ? 'unknown' : 'ownership',
        captures: [],
      })
      Expect(JSON.stringify(record)).not.toContain('private')
    } finally {
      restore()
      grant.revoke()
      await FS.remove(root)
    }
  })
}

Test('managed iOS late diagnostic response cannot publish a capture after revocation', async () => {
  const root = await mkTestDir('managed-ios-late-')
  const entered = Deferred<void>()
  const release = Deferred<void>()
  const returned = Deferred<void>()
  const grant = createManagedMobileGrant({
    identity: {
      session: 'session',
      checkout: '/checkout',
      loopGeneration: 'generation',
      target: { platform: 'ios', id: 'owned-simulator' },
      resources: [],
      runtime: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        projectRoot: '/fresh',
        appName: 'FirebaseLiveAcceptance',
        sourceRevision: 'source',
        compiledRevision: 'compiled',
        nonce: 'nonce',
        kind: 'companion',
        appId: 'owned.bundle',
        devUrl: 'taostudiocompanion://dev',
      },
    },
    assertOwnerCurrent: async () => {},
    assertLoopCurrent: async () => {},
  })
  const factory = createAppiumWebDriverClient({
    request: async request => {
      if (request.purpose === 'managed-diagnostic' && request.path.endsWith('/source')) {
        entered.resolve()
        await release.promise
        returned.resolve()
      }
      return {
        status: 200,
        body: {
          value: request.path === '/session'
            ? { sessionId: 'driver' }
            : request.path.endsWith('/execute/sync')
            ? { bundleId: 'owned.bundle' }
            : request.path.endsWith('/source')
            ? '<Application />'
            : request.path.endsWith('/screenshot')
            ? transparentPixelPng
            : null,
        },
      }
    },
  })
  try {
    await appiumXcuiTestClient(factory, grant, {
      artifactRoot: root,
      assertOwnedTargetCurrent: async () => {},
    }).createSession({ platformName: 'iOS' })
    const observed = grant.assertCurrent()
    await entered.promise
    grant.revokeInput()
    await Expect(observed).rejects.toThrow('Appium did not identify the mounted managed marker')
    release.resolve()
    await returned.promise
    await Time.sleep(0)
    const directories = await FS.listDir(root)
    Expect(directories.length).toBe(1)
    Expect(directories[0]!.startsWith('managed-handshake-failure-')).toBe(true)
    Expect(await FS.listDir(FS.resolvePath(directories[0]!, root))).toEqual(['diagnostic-failure.json'])
  } finally {
    release.resolve()
    grant.revoke()
    await FS.remove(root)
  }
})

for (
  const fault of [
    undefined,
    'nonce-mismatch',
    'borrowed',
    'owner-lost',
    'owner-after-source',
    'app-before',
    'app-after-source',
    'app-after-png',
    'xml-limit',
    'png-limit',
    'cancelled',
    'input-revoked',
    'timeout',
    'no-callback',
  ] as const
) {
  Test(
    `managed Android failed handshake diagnostics ${
      fault ?? 'capture privately'
    } preserve the primary failure and driver cleanup`,
    async () => {
      const root = await mkTestDir('managed-handshake-test-')
      const runtime = {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'loop',
        projectRoot: '/project',
        appName: 'DataMVPApp',
        sourceRevision: 'source',
        compiledRevision: 'compiled',
        nonce: 'nonce',
        kind: 'expo-go' as const,
        appId: 'host.exp.exponent',
        devUrl: 'http://127.0.0.1:8081',
      }
      let owner = fault !== 'owner-lost'
      let sourceRead = false
      let pngRead = false
      let cancelled = false
      let deletions = 0
      let identityReads = 0
      const diagnosticPaths: string[] = []
      const grant = createManagedMobileGrant({
        identity: {
          session: runtime.session,
          checkout: runtime.checkout,
          loopGeneration: runtime.loopGeneration,
          target: { platform: 'android', id: 'emulator-5554' },
          resources: [{ name: 'android-avd:owned', generation: 'retained' }],
          runtime,
        },
        assertOwnerCurrent: async () => {
          if (!owner) {
            Errors.throwHostEnvironment('physical owner lost')
          }
        },
        assertLoopCurrent: async () => {},
      })
      const factory = createAppiumWebDriverClient({
        request: async request => {
          if (request.method === 'DELETE') {
            deletions++
            return { status: 200, body: { value: null } }
          }
          if (request.purpose === 'managed-identity' && request.path.endsWith('/elements')) {
            identityReads++
            if (fault === 'nonce-mismatch') {
              return { status: 200, body: { value: [{ 'element-6066-11e4-a52e-4f735466cecf': 'marker' }] } }
            }
            return { status: 404, body: { value: { error: 'no such element', message: 'initial marker absent' } } }
          }
          if (request.purpose === 'managed-diagnostic') {
            Expect(request.method).toBe('GET')
            diagnosticPaths.push(request.path)
            if (fault === 'cancelled' || fault === 'input-revoked' || fault === 'timeout') {
              if (fault === 'cancelled') {
                grant.revoke()
              } else if (fault === 'input-revoked') {
                grant.revokeInput()
              }
              await new Promise<void>(resolve => {
                const finish = () => {
                  cancelled = true
                  resolve()
                }
                if (request.diagnosticSignal!.aborted) {
                  finish()
                } else {
                  request.diagnosticSignal!.addEventListener('abort', finish, { once: true })
                }
              })
            }
          }
          let value: unknown = null
          if (request.path === '/session') {
            value = { sessionId: 'driver' }
          } else if (request.path.endsWith('/current_package')) {
            value = request.purpose === 'managed-diagnostic' && (
                fault === 'app-before' || fault === 'app-after-source' && sourceRead
                || fault === 'app-after-png' && pngRead
              )
              ? 'unrelated.app'
              : runtime.appId
          } else if (request.path.endsWith('/source')) {
            sourceRead = true
            if (fault === 'owner-after-source') {
              owner = false
            }
            value = fault === 'xml-limit'
              ? 'x'.repeat(2 * 1024 * 1024 + 1)
              : '<hierarchy><node resource-id="owned" /></hierarchy>'
          } else if (request.path.endsWith('/screenshot')) {
            pngRead = true
            value = fault === 'png-limit' ? 'A'.repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 4) : transparentPixelPng
          } else if (request.path.endsWith('/attribute/resource-id')) {
            value = `tao-managed-loop-identity.${encodeURIComponent(JSON.stringify({ ...runtime, nonce: 'foreign' }))}`
          } else if (request.path.endsWith('/attribute/package')) {
            value = runtime.appId
          }
          return { status: 200, body: { value } }
        },
      })
      const controller = createManagedAppiumAndroidController({
        client: appiumAndroidClient(
          factory,
          grant,
          fault === 'no-callback' ? undefined : {
            artifactRoot: root,
            assertOwnedTargetCurrent: async () => {
              if (fault === 'borrowed') {
                Errors.throwHostEnvironment('borrowed target cannot capture before identity')
              }
            },
          },
        ),
        grant,
        leases: {
          acquire: async () => Errors.throwUnexpected('Cannot reacquire a target for diagnostics.'),
          tryAcquire: async name => ({ generation: name, assertCurrent: async () => {}, release: async () => {} }),
        },
        receipts: { write: async () => {} },
        target: { kind: 'emulator', serial: 'emulator-5554', appId: runtime.appId },
      })
      try {
        const began = Date.now()
        let openingFailure: unknown
        await Expect(
          controller.openSession({
            artifactRoot: root,
            mode: 'acceptance',
            target: 'emulator-5554',
            revision: { source: 'source', build: 'compiled' },
          }).catch(error => {
            openingFailure = error
            throw error
          }),
        ).rejects.toThrow(
          fault === 'owner-lost'
            ? 'physical owner lost'
            : fault === 'owner-after-source'
            ? 'retaining its emulator and port leases'
            : fault === 'nonce-mismatch'
            ? 'different nonce'
            : 'initial marker absent',
        )
        if (fault === 'owner-after-source') {
          if (!(openingFailure instanceof Errors.HostEnvironmentError)) {
            Errors.throwUnexpected('Expected retained cleanup evidence.')
          }
          Expect(String(openingFailure.details?.['openFailure'])).toContain('initial marker absent')
          Expect(openingFailure.details?.['retainsTargetLease']).toBe(true)
        }
        if (fault === 'timeout') {
          Expect(Date.now() - began >= 9_500).toBe(true)
          Expect(Date.now() - began < 15_000).toBe(true)
        }
        if (fault === 'cancelled') {
          Expect(Date.now() - began < 2_000).toBe(true)
        }
        const directories = (await FS.listDir(root)).filter(name => name.startsWith('managed-handshake-'))
        const captured = fault === undefined || fault === 'nonce-mismatch'
        const enteredCapture = fault !== 'owner-lost' && fault !== 'no-callback'
        Expect(directories.length).toBe(enteredCapture ? 1 : 0)
        if (!enteredCapture) {
          Expect(await FS.listDir(root)).toEqual([])
        } else if (!captured) {
          const directory = FS.resolvePath(directories[0]!, root)
          Expect(FS.basename(directory).startsWith('managed-handshake-failure-')).toBe(true)
          Expect(await FS.fileMode(directory)).toBe(0o700)
          Expect(await FS.listDir(directory)).toEqual(['diagnostic-failure.json'])
          const file = FS.resolvePath('diagnostic-failure.json', directory)
          Expect(await FS.fileMode(file)).toBe(0o600)
          Expect(await FS.readJson(file)).toEqual({
            classification: 'runtime-identity-unproved',
            status: [
                'borrowed',
                'owner-lost',
                'owner-after-source',
                'app-before',
                'app-after-source',
                'app-after-png',
                'cancelled',
                'input-revoked',
              ].includes(fault!)
              ? 'refused'
              : 'failed',
            stage: fault === 'borrowed'
              ? 'current-target'
              : ['owner-lost', 'owner-after-source', 'cancelled', 'input-revoked'].includes(fault!)
              ? 'ownership'
              : ['app-before', 'app-after-source', 'app-after-png'].includes(fault!)
              ? 'foreground-bundle'
              : fault === 'xml-limit'
              ? 'xml'
              : fault === 'png-limit'
              ? 'screenshot'
              : fault === 'timeout'
              ? 'timeout'
              : 'unknown',
            ...(['app-before', 'app-after-source', 'app-after-png'].includes(fault!)
              ? { foregroundCategory: 'other' }
              : {}),
            expectedTarget: { platform: 'android', id: 'emulator-5554' },
            loopGeneration: 'loop',
            sourceIdentityProved: false,
            inputPerformed: false,
            captures: [],
          })
        }
        if (captured) {
          const directory = FS.resolvePath(directories[0]!, root)
          Expect(await FS.fileMode(directory)).toBe(0o700)
          for (const name of ['handshake.xml', 'handshake.png', 'diagnostic.json']) {
            Expect(await FS.fileMode(FS.resolvePath(name, directory))).toBe(0o600)
          }
          Expect(await FS.readJson(FS.resolvePath('diagnostic.json', directory))).toEqual({
            classification: 'runtime-identity-unproved',
            sourceIdentityProved: false,
            inputPerformed: false,
            captures: ['handshake.xml', 'handshake.png'],
          })
          Expect(diagnosticPaths.map(path => path.split('/').at(-1))).toEqual([
            'current_package',
            'source',
            'current_package',
            'screenshot',
            'current_package',
          ])
          // Diagnostics are one-shot even if a caller checks the failed observer again.
          await Expect(grant.assertCurrent()).rejects.toThrow(
            fault === 'nonce-mismatch' ? 'different nonce' : 'initial marker absent',
          )
          Expect(diagnosticPaths.length).toBe(5)
          Expect(identityReads).toBe(2)
        }
        if (fault === 'borrowed' || fault === 'owner-lost' || fault === 'no-callback') {
          Expect(diagnosticPaths).toEqual([])
        }
        if (fault === 'app-before') {
          Expect(sourceRead).toBe(false)
        }
        if (fault === 'owner-after-source' || fault === 'app-after-source' || fault === 'xml-limit') {
          Expect(pngRead).toBe(false)
        }
        if (fault === 'cancelled' || fault === 'input-revoked' || fault === 'timeout') {
          Expect(cancelled).toBe(true)
          Expect(diagnosticPaths.length).toBe(1)
        }
        if (fault === 'cancelled' || fault === 'input-revoked') {
          Expect(grant.externalCancellationSignal.aborted).toBe(fault === 'cancelled')
        }
        owner = true
        grant.revoke()
        await controller.close()
        Expect(deletions).toBe(fault === 'owner-lost' || fault === 'owner-after-source' ? 0 : 1)
      } finally {
        owner = true
        grant.revoke()
        await controller.close()
        await FS.remove(root)
      }
    },
  )
}

for (const causeKind of ['timeout', 'explicit', 'null', 'non-error', 'cycle', 'depth'] as const) {
  Test(
    `managed private cleanup evidence preserves bounded ${causeKind} host causes without exposing secrets`,
    async () => {
      const root = await mkTestDir('managed-private-cause-')
      const timeout = new DOMException(
        'POST /session timed out at http://private.invalid/session authorization=private-token',
        'TimeoutError',
      )
      let incoming: Error = new HostControlError('host', 'Transport failed.', { cause: timeout })
      if (causeKind === 'explicit') {
        incoming = new Errors.HostEnvironmentError('Transport failed.', {
          cause: new Errors.HostEnvironmentError('Explicit cause wins.'),
          details: { cause: timeout },
        })
      }
      if (causeKind === 'null') {
        incoming = new Errors.HostEnvironmentError('Transport failed.', { cause: null, details: { cause: timeout } })
      }
      if (causeKind === 'non-error') {
        incoming = new HostControlError('host', 'Transport failed.', {
          cause: { name: 'TimeoutError', message: 'http://private.invalid secret=private-token' },
        })
      }
      if (causeKind === 'cycle') {
        const cyclic = new HostControlError('host', 'Transport failed.', {})
        cyclic.details!['cause'] = cyclic
        incoming = cyclic
      }
      if (causeKind === 'depth') {
        incoming = timeout
        for (let level = 5; level >= 1; level--) {
          incoming = new HostControlError('host', `Transport level ${level}.`, { cause: incoming })
        }
      }
      const primary = new Errors.HostEnvironmentError('Driver creation returned no session identity.', {
        cause: incoming,
        details: { retainsTargetLease: true },
      })
      const grant = createManagedMobileGrant({
        identity: {
          session: 'session',
          checkout: '/checkout',
          loopGeneration: 'loop',
          target: { platform: 'ios', id: 'OWNED' },
          resources: [],
          runtime: {
            session: 'session',
            checkout: '/checkout',
            loopGeneration: 'loop',
            projectRoot: '/project',
            appName: 'DataMVPApp',
            sourceRevision: 'source',
            compiledRevision: 'compiled',
            nonce: 'nonce',
            kind: 'companion',
            appId: 'runtime.app',
            devUrl: 'http://127.0.0.1:8081',
          },
        },
        assertOwnerCurrent: async () => {},
        assertLoopCurrent: async () => {},
      })
      try {
        let failure: unknown
        let attemptRoot: string | undefined
        await Expect(
          runManagedMobileFixture({
            grant,
            artifactRoot: root,
            onDriverProcess: async () => {},
            onCleanup: async () => {},
          }, {
            startServer: async ({ artifactRoot }) => {
              attemptRoot = artifactRoot
              return { url: 'http://127.0.0.1:4723', logs: () => '', close: async () => {} }
            },
            resources: () => ({
              leases: {
                acquire: async () => Errors.throwUnexpected('This private artifact fixture cannot acquire resources.'),
                tryAcquire: async () => undefined,
              },
              serverReservations: () => ({
                reserve: async () => Errors.throwUnexpected('This private artifact fixture cannot reserve ports.'),
              }),
              releaseAfterCleanup: async () => Errors.throwUnexpected('Uncertain creation cannot release fences.'),
            }),
            controller: () => ({
              openSession: async () => {
                throw primary
              },
              close: async () => {},
            }),
          }).catch(error => {
            failure = error
            throw error
          }),
        ).rejects.toThrow('target and driver fences remain retained')
        if (!(failure instanceof Errors.HostEnvironmentError)) {
          Errors.throwUnexpected('Expected private fixture cleanup failure evidence.')
        }
        Expect(failure.cause).toBe(primary)
        Expect(primary.cause).toBe(incoming)
        if (attemptRoot === undefined) {
          Errors.throwUnexpected('Missing started private diagnostic artifact namespace.')
        }
        Expect(await FS.listDir(root)).toEqual([FS.basename(attemptRoot)])
        Expect(await FS.fileMode(attemptRoot)).toBe(0o700)
        const cleanupNames = (await FS.listDir(attemptRoot)).filter(name => name.startsWith('managed-mobile-cleanup-'))
        Expect(cleanupNames).toHaveLength(1)
        const directory = FS.resolvePath(cleanupNames[0]!, attemptRoot)
        const artifact = FS.resolvePath('cleanup.json', directory)
        Expect(await FS.fileMode(directory)).toBe(0o700)
        Expect(await FS.fileMode(artifact)).toBe(0o600)
        const text = await FS.readText(artifact)
        Expect(text.includes('private.invalid')).toBe(false)
        Expect(text.includes('private-token')).toBe(false)
        const record = JSON.parse(text)
        const expected = [
          { name: 'HostEnvironmentError', message: 'Driver creation returned no session identity.' },
          { name: 'HostEnvironmentError', message: causeKind === 'depth' ? 'Transport level 1.' : 'Transport failed.' },
        ]
        if (causeKind === 'timeout') {
          expected.push({
            name: 'TimeoutError',
            message: 'POST /session timed out at [redacted-url] authorization=[redacted]',
          })
        }
        if (causeKind === 'explicit') {
          expected.push({ name: 'HostEnvironmentError', message: 'Explicit cause wins.' })
        }
        if (causeKind === 'null') {
          expected.push({ name: 'UnknownFailure', message: 'Non-error failure' })
        }
        if (causeKind === 'depth') {
          expected.push(
            { name: 'HostEnvironmentError', message: 'Transport level 2.' },
            { name: 'HostEnvironmentError', message: 'Transport level 3.' },
          )
        }
        Expect(record.originalFailure).toEqual(expected)
        Expect(failure.details?.['originalFailure']).toEqual(expected)
        Expect(record.cleanupProved).toBe(false)
        Expect(record.driverResourcesReleased).toBe(false)
      } finally {
        await FS.remove(root)
      }
    },
  )
}
