import { createAppiumHttpTransport, createAppiumWebDriverClient, isManagedRuntimeIdentityRequest } from '@appium-driver'
import type { AppiumCapabilities, AppiumSession, AppiumSessionFactory } from '@appium-driver'
import { Errors } from '@shared'
import { Expect, Test } from '@shared/test'
import {
  createAppiumAndroidController,
  createManagedAppiumAndroidController,
} from '../native/appium-android/AppiumAndroidController'
import { createManagedAppiumXcuiTestController } from '../native/appium/AppiumXcuiTestController'
import { appiumAndroidClient, appiumXcuiTestClient } from '../native/AppiumMobileClients'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

for (
  const mode of [
    'clear',
    'tutorial',
    'missing-marker',
    'duplicate-marker',
    'foreign-marker',
    'stale-nonce',
    'stale-source',
    'foreground-change',
    'unknown-overlay',
    'unknown-window',
    'unknown-popup-root',
    'popup-after-dismiss',
    'ambiguous-control',
    'overlay-remains',
    'stale-after-click',
    'revoked-before-preparation',
    'revoked-before-click',
    'status-runtime',
    'status-tutorial',
    'status-system-dialog',
    'status-drawer',
    'status-interactive-child',
    'status-focusable-child',
    'status-interactive-root',
    'status-focusable-root',
    'status-foreign-child',
    'status-missing-chain',
    'status-multiple-bars',
    'status-multiple-roots',
    'status-bounds-mismatch',
    'status-large-root',
    'status-off-origin',
    'status-malformed-bounds',
    'status-popup-before',
    'status-popup-after',
    'status-interactive-after',
  ] as const
) {
  Test(`managed Android ${mode} observes exact runtime before any tutorial preparation`, async () => {
    const runtime = {
      session: 'session',
      checkout: '/checkout',
      loopGeneration: 'generation',
      kind: 'expo-go' as const,
      appId: 'host.exp.exponent',
      devUrl: 'exp://127.0.0.1:8081',
      projectRoot: '/project',
      appName: 'DataMVPApp',
      sourceRevision: 'source',
      compiledRevision: 'compiled',
      nonce: 'nonce',
    }
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform: 'android', id: 'emulator-owned' },
        resources: [],
        runtime,
      },
      assertLoopCurrent: async () => {},
      assertOwnerCurrent: async () => {},
    })
    const events: string[] = []
    let windowsEnabled = false
    const hasStatus = mode.startsWith('status-')
    const succeeds = ['clear', 'tutorial', 'status-runtime', 'status-tutorial'].includes(mode)
    let overlay = mode !== 'clear' && mode !== 'unknown-popup-root' && mode !== 'status-runtime'
      && mode !== 'status-popup-before'
    let packageReads = 0
    let portReleases = 0
    let clicks = 0
    let deletes = 0
    let preparations = 0
    const id = (value: string) => ({ 'element-6066-11e4-a52e-4f735466cecf': value })
    const publication = {
      ...runtime,
      devUrl: 'http://127.0.0.1:8081/index.bundle',
      ...(mode === 'stale-nonce' ? { nonce: 'other-nonce' } : {}),
      ...(mode === 'stale-source' ? { sourceRevision: 'other-source' } : {}),
    }
    const identifier = `tao-managed-loop-identity.${encodeURIComponent(JSON.stringify(publication))}`
    const factory = createAppiumWebDriverClient(createAppiumHttpTransport({
      serverUrl: 'http://127.0.0.1:4723',
      signal: grant.signal,
      requestTimeoutMs: 30_000,
      assertRequest: async request => {
        if (request.method === 'DELETE') {
          await grant.assertCleanupCurrent()
        } else if (request.path === '/session' || isManagedRuntimeIdentityRequest(request, 'android', runtime.appId)) {
          await grant.assertRequestCurrent()
        } else {
          await grant.assertCurrent()
        }
      },
      fetch: async (url, init) => {
        const path = new URL(url).pathname
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        let value: unknown
        if (path === '/session') {
          events.push('created')
          value = { sessionId: 'driver' }
        } else if (init?.method === 'DELETE') {
          deletes++
          events.push('deleted')
          value = null
        } else if (path.endsWith('/appium/settings')) {
          Expect(body).toEqual({ settings: { enableMultiWindows: true, allowInvisibleElements: true } })
          windowsEnabled = true
          events.push('observer-settings')
          value = null
        } else if (path.endsWith('/current_package')) {
          packageReads++
          value = mode === 'foreground-change' && packageReads > 1 ? 'foreign.package' : runtime.appId
        } else if (path.endsWith('/attribute/bounds')) {
          events.push('status-bounds')
          value = mode === 'status-large-root'
            ? '[0,0][1080,900]'
            : mode === 'status-off-origin'
            ? '[0,10][1080,73]'
            : mode === 'status-malformed-bounds'
            ? '[0,0][1080,NaN]'
            : mode === 'status-bounds-mismatch' && path.includes('/status-bar/')
            ? '[0,0][1080,64]'
            : '[0,0][1080,63]'
        } else if (path.endsWith('/attribute/package')) {
          value = mode === 'foreign-marker' ? 'foreign.package' : runtime.appId
        } else if (path.endsWith('/attribute/resource-id')) {
          events.push('marker-read')
          value = mode === 'stale-after-click' && clicks > 0
            ? `tao-managed-loop-identity.${
              encodeURIComponent(JSON.stringify({ ...publication, sourceRevision: 'changed' }))
            }`
            : identifier
        } else if (path.endsWith('/elements')) {
          Expect(body.using).toBe('xpath')
          if (body.value.startsWith('/hierarchy/')) {
            const popup = mode === 'unknown-popup-root' || mode === 'status-popup-before'
              || (mode === 'popup-after-dismiss' || mode === 'status-popup-after') && clicks > 0
            if (body.value === "/hierarchy/*[@displayed='true']") {
              value = [
                id('runtime-root'),
                ...(overlay ? [id('tutorial-root')] : []),
                ...(hasStatus ? [id('status-root')] : []),
                ...(mode === 'status-multiple-roots' ? [id('other-status-root')] : []),
                ...(popup ? [id('popup')] : []),
              ]
            } else if (body.value.includes("@package='com.android.systemui'")) {
              const rejectsNonInput = body.value.includes(
                "[not(.//*[not(@package='com.android.systemui' and @clickable='false' and @focusable='false')])]",
              )
              const invalidChild = mode === 'status-interactive-child' || mode === 'status-focusable-child'
                || mode === 'status-foreign-child' || mode === 'status-interactive-after' && clicks > 0
              const rejectsInteractiveRoot = body.value.includes("[@clickable='false' and @focusable='false']")
              const invalidRoot = mode === 'status-interactive-root' || mode === 'status-focusable-root'
              const validChain = body.value.includes(
                "count(android.widget.FrameLayout[@resource-id='com.android.systemui:id/status_bar_launch_animation_container'])=1",
              ) && body.value.includes(
                "android.widget.FrameLayout[@resource-id='com.android.systemui:id/status_bar_container']/android.widget.FrameLayout[@resource-id='com.android.systemui:id/status_bar']/android.widget.LinearLayout[@resource-id='com.android.systemui:id/status_bar_contents']",
              )
              const invalidStructure = ['status-system-dialog', 'status-drawer', 'status-missing-chain'].includes(mode)
              const rejectsMultiple = body.value.includes(
                "count(.//*[@resource-id='com.android.systemui:id/status_bar'])=1",
              )
              value = !hasStatus || rejectsNonInput && invalidChild || rejectsInteractiveRoot && invalidRoot
                  || validChain && invalidStructure
                  || rejectsMultiple && mode === 'status-multiple-bars'
                ? []
                : body.value.endsWith("/android.widget.FrameLayout[@resource-id='com.android.systemui:id/status_bar']")
                ? [id('status-bar')]
                : [id('status-root')]
            } else if (body.value.includes("starts-with(@resource-id, 'tao-managed-loop-identity.')")) {
              value = [id('runtime-root')]
            } else {
              Expect(body.value.includes('This is the developer menu.')).toBe(true)
              value = overlay ? [id('tutorial-root')] : []
            }
          } else if (body.value.includes('starts-with(@resource-id,')) {
            Expect(body.value.includes("@package='host.exp.exponent'")).toBe(true)
            value = !windowsEnabled || mode === 'missing-marker'
              ? []
              : mode === 'duplicate-marker'
              ? [id('marker'), id('other-marker')]
              : [id('marker')]
          } else if (body.value.includes("@resource-id='android:id/content'")) {
            preparations++
            value = overlay ? [id('content'), id('dialog-content')] : [id('content')]
          } else if (body.value.includes("android.widget.TextView[@text='Continue']")) {
            Expect(
              body.value.includes(
                'This is the developer menu. It gives you access to useful tools in your development builds.',
              ),
            ).toBe(true)
            Expect(
              body.value.includes(
                'You can press ⌘ + m on macOS or Ctrl + m on other platforms to get back to it at any time.',
              ),
            ).toBe(true)
            Expect(body.value.includes("@clickable='true'")).toBe(true)
            value = mode === 'unknown-overlay'
              ? []
              : mode === 'ambiguous-control'
              ? [id('continue'), id('other')]
              : [id('continue')]
          } else if (body.value.startsWith('//androidx.compose.ui.platform.ComposeView')) {
            value = overlay && mode !== 'unknown-window' ? [id('compose')] : []
          } else {
            Errors.throwUnexpected('The source driver received an unrelated hierarchy lookup.')
          }
        } else if (path.endsWith('/displayed')) {
          value = true
          if (mode === 'revoked-before-click') {
            grant.revoke()
          }
        } else if (path.endsWith('/click')) {
          Expect(path).toBe('/session/driver/element/continue/click')
          clicks++
          events.push('clicked')
          if (mode !== 'overlay-remains') {
            overlay = false
          }
          value = null
        } else {
          Errors.throwUnexpected('Preparation must not reset, relaunch, type, or press a key.')
        }
        return new Response(JSON.stringify({ value }))
      },
    }))
    const controller = createManagedAppiumAndroidController({
      client: appiumAndroidClient(factory, grant),
      grant,
      leases: {
        acquire: async () => Errors.throwUnexpected('The physical target must remain held.'),
        tryAcquire: async name => ({
          generation: name,
          assertCurrent: async () => {},
          release: async () => {
            portReleases++
          },
        }),
      },
      receipts: {
        write: async (_path, receipt) => {
          events.push(`receipt:${receipt.lifecycle}`)
          if (receipt.lifecycle === 'open' && mode === 'revoked-before-preparation') {
            grant.revoke()
          }
        },
      },
      target: { kind: 'emulator', serial: 'emulator-owned', appId: runtime.appId },
    })
    const opened = controller.openSession({
      artifactRoot: '/source-proof',
      mode: 'acceptance',
      revision: { source: 'source', build: 'compiled' },
      target: 'emulator-owned',
    })
    try {
      if (succeeds) {
        const session = await opened
        Expect(session.descriptor().id).toBe('driver')
        await grant.assertCurrent()
      } else {
        await Expect(opened).rejects.toThrow()
      }
      const expectedClicks = mode === 'tutorial' || mode === 'overlay-remains' || mode === 'stale-after-click'
          || mode === 'popup-after-dismiss' || mode === 'status-tutorial' || mode === 'status-popup-after'
          || mode === 'status-interactive-after'
        ? 1
        : 0
      Expect(clicks).toBe(expectedClicks)
      if (mode === 'status-tutorial') {
        Expect(events.indexOf('status-bounds') < events.indexOf('clicked')).toBe(true)
        Expect(events.lastIndexOf('status-bounds') > events.indexOf('clicked')).toBe(true)
      }
      if (mode === 'status-runtime') {
        Expect(events.includes('status-bounds')).toBe(true)
      }
      if (expectedClicks) {
        Expect(events.indexOf('receipt:open') < events.indexOf('clicked')).toBe(true)
        Expect(events.indexOf('marker-read') < events.indexOf('clicked')).toBe(true)
        Expect(events.lastIndexOf('marker-read') > events.indexOf('clicked')).toBe(true)
      }
      if (
        ['missing-marker', 'duplicate-marker', 'foreign-marker', 'stale-nonce', 'stale-source', 'foreground-change']
          .includes(mode)
      ) {
        Expect(preparations).toBe(0)
      }
    } finally {
      await controller.close()
    }
    Expect(deletes).toBe(1)
    Expect(portReleases).toBe(2)
    Expect(events.includes('receipt:opening')).toBe(true)
    if (!succeeds) {
      Expect(events.includes('receipt:failed')).toBe(true)
    }
  })
}

for (const platform of ['ios', 'android'] as const) {
  Test(`managed ${platform} attach preserves runtime and closes only its driver after revocation`, async () => {
    const runtime = {
      session: 'session',
      checkout: '/checkout',
      loopGeneration: 'generation',
      kind: 'companion' as const,
      appId: 'com.devtao.studio.companion',
      devUrl: 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081',
      projectRoot: '/app',
      appName: 'DataMVPApp',
      sourceRevision: 'source',
      compiledRevision: 'compiled',
      nonce: 'nonce',
    }
    let physicalOwner = true
    let lifecycleCalls = 0
    let alerts = 0
    let deletions = 0
    let portReleases = 0
    let mountedNonce = 'nonce'
    let nativeLookups = 0
    const grant = createManagedMobileGrant({
      identity: {
        session: 'session',
        checkout: '/checkout',
        loopGeneration: 'generation',
        target: { platform, id: 'DEVICE' },
        resources: [{ name: 'target', generation: 'retained' }],
        runtime,
      },
      assertLoopCurrent: async () => {},
      assertOwnerCurrent: async () => {
        if (!physicalOwner) {
          Errors.throwHostEnvironment('physical owner changed')
        }
      },
    })
    const remote: AppiumSession = {
      id: 'driver',
      actions: async () => {},
      executeScript: async <T>(): Promise<T> => undefined as T,
      activateApplication: async () => {
        lifecycleCalls++
      },
      terminateApplication: async () => {
        lifecycleCalls++
      },
      dismissAlert: async () => {
        alerts++
      },
      delete: async () => {
        deletions++
      },
      screenshot: async () => new Uint8Array(),
      findAll: async () => [],
      find: async () => {
        nativeLookups++
        return Errors.throwUnexpected('Native input must be blocked before lookup in this test.')
      },
      readManagedRuntimeIdentity: async () => ({
        appId: runtime.appId,
        label: JSON.stringify({ ...runtime, nonce: mountedNonce, devUrl: 'http://127.0.0.1:8081/index.bundle' }),
      }),
    }
    let capabilities: AppiumCapabilities | undefined
    const factory: AppiumSessionFactory = {
      createSession: async next => {
        capabilities = next
        return remote
      },
    }
    const leases = {
      acquire: async () => Errors.throwUnexpected('Managed attach must not reacquire its physical target.'),
      tryAcquire: async (name: string) => ({
        generation: name,
        assertCurrent: async () => {},
        release: async () => {
          portReleases++
        },
      }),
    }
    const receipts = { write: async () => {} }
    const controller = platform === 'ios'
      ? createManagedAppiumXcuiTestController({
        client: appiumXcuiTestClient(factory, grant),
        grant,
        leases,
        receipts,
        target: { kind: 'simulator', udid: 'DEVICE', appId: runtime.appId },
      })
      : createManagedAppiumAndroidController({
        client: appiumAndroidClient(factory, grant),
        grant,
        leases,
        receipts,
        target: { kind: 'emulator', serial: 'DEVICE', appId: runtime.appId },
      })
    const revision = { source: 'source', build: 'compiled' }
    const session = await controller.openSession({
      artifactRoot: '/proof',
      mode: 'acceptance',
      revision,
      target: 'DEVICE',
    })
    Expect(capabilities?.['appium:app']).toBeUndefined()
    Expect(capabilities?.['appium:autoLaunch']).toBe(false)
    Expect(capabilities?.['appium:shouldTerminateApp']).toBe(false)
    Expect(capabilities?.['appium:noReset']).toBe(true)
    Expect(capabilities?.['appium:fullReset']).toBe(false)
    Expect(alerts).toBe(0)
    Expect(session.descriptor().capabilities.includes('relaunchApplication')).toBe(false)
    await Expect(
      session.perform({ kind: 'relaunchApplication', lease: session.descriptor().lease, expectedRevision: revision }),
    ).rejects.toThrow('cannot relaunch')
    mountedNonce = 'peer-nonce'
    await Expect(session.observe({ target: { kind: 'tag', value: 'workspaceName' }, expectedRevision: revision }))
      .rejects.toThrow('different nonce')
    Expect(nativeLookups).toBe(0)
    grant.revoke()
    physicalOwner = false
    await Expect(controller.close()).rejects.toThrow('physical owner changed')
    Expect(deletions).toBe(0)
    Expect(portReleases).toBe(0)
    physicalOwner = true
    await controller.close()
    Expect(deletions).toBe(1)
    Expect(portReleases).toBe(2)
    Expect(lifecycleCalls).toBe(0)
    await grant.assertCleanupCurrent()
  })
}

Test('the isolated Android factory still rejects managed application identifiers before driver creation', async () => {
  let created = false
  const controller = createAppiumAndroidController({
    target: { kind: 'emulator', serial: 'DEVICE', appId: 'com.devtao.studio.companion' },
    build: { apkPath: '/proof/app.apk', compiledArtifactDigest: 'a'.repeat(64) },
    client: {
      createSession: async () => {
        created = true
        return Errors.throwUnexpected('Expected isolated build validation before creation.')
      },
    },
  })
  await Expect(
    controller.openSession({
      artifactRoot: '/proof',
      mode: 'acceptance',
      revision: { build: 'build', source: 'source' },
      target: 'DEVICE',
    }),
  ).rejects.toThrow('isolated dev.tao.taohost')
  Expect(created).toBe(false)
})
