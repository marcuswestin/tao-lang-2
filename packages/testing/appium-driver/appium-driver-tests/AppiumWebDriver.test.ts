import { Errors, Time } from '@shared'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { managedLoopIdentityMarker } from '../../../apps/expo-host/ManagedLoopIdentityMarker'
import { appiumAndroidClient } from '../../e2e-testing/native/AppiumMobileClients'
import { createManagedMobileGrant } from '../../e2e-testing/native/ManagedMobileGrant'
import {
  AppiumNoSuchAlertError,
  AppiumNoSuchElementError,
  createAppiumHttpTransport,
  createAppiumWebDriverClient,
  isManagedRuntimeIdentityRequest,
} from '../appium-driver-src/AppiumWebDriver'

Describe('Appium W3C transport', () => {
  Test('only fixed identity settings and native marker reads receive pre-proof authority', () => {
    const request = {
      method: 'POST' as const,
      path: '/session/owned/appium/settings',
      purpose: 'managed-identity' as const,
    }
    Expect(
      isManagedRuntimeIdentityRequest(
        { ...request, body: { settings: { enableMultiWindows: true, allowInvisibleElements: true } } },
        'android',
        'runtime.app',
      ),
    ).toBe(true)
    for (
      const body of [
        { settings: { enableMultiWindows: false, allowInvisibleElements: true } },
        { settings: { enableMultiWindows: true, allowInvisibleElements: true, other: true } },
        { settings: { enableMultiWindows: true, allowInvisibleElements: true }, script: 'private' },
      ]
    ) {
      Expect(isManagedRuntimeIdentityRequest({ ...request, body }, 'android', 'runtime.app')).toBe(false)
    }
    for (
      const path of ['/session/owned/element/continue/click', '/session/owned/actions', '/session/owned/execute/sync']
    ) {
      Expect(
        isManagedRuntimeIdentityRequest(
          { ...request, path, body: { script: 'mobile: shell', args: [] } },
          'android',
          'runtime.app',
        ),
      ).toBe(false)
    }
    Expect(
      isManagedRuntimeIdentityRequest(
        { ...request, path: '/session/owned/execute/sync', body: { script: 'mobile: activeAppInfo', args: [] } },
        'ios',
        'runtime.app',
      ),
    ).toBe(true)
    Expect(
      isManagedRuntimeIdentityRequest(
        { ...request, path: '/session/owned/execute/sync', body: { script: 'mobile: terminateApp', args: [] } },
        'ios',
        'runtime.app',
      ),
    ).toBe(false)
  })

  for (const malformed of ['encoding', 'oversized'] as const) {
    Test(`bounded Android marker refuses ${malformed} without any physical action`, async () => {
      const requests: string[] = []
      const session = await createAppiumWebDriverClient({
        request: async request => {
          requests.push(request.path)
          const value = request.path === '/session'
            ? { sessionId: 'driver' }
            : request.path.endsWith('/elements')
            ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'marker' }]
            : request.path.endsWith('/attribute/resource-id')
            ? `tao-managed-loop-identity.${
              malformed === 'encoding' ? '%broken' : encodeURIComponent(JSON.stringify({ nonce: 'x'.repeat(9_000) }))
            }`
            : 'runtime.app'
          return { body: { value }, status: 200 }
        },
      }).createSession({ platformName: 'Android' })
      await Expect(session.readManagedRuntimeIdentity!('android', 'runtime.app')).rejects.toThrow(
        malformed === 'encoding' ? 'malformed' : 'oversized',
      )
      Expect(requests.some(path => /click|actions|terminate|activate|pressKey/u.test(path))).toBe(false)
    })
  }

  Test('only exact session creation survives thirty seconds within its separate finite budget', async () => {
    let now = 0
    const timers: { deadline: number; controller: AbortController }[] = []
    const advance = (milliseconds: number) => {
      now += milliseconds
      for (const timer of timers) {
        if (timer.deadline <= now) {
          timer.controller.abort(Errors.abortError('virtual request timeout'))
        }
      }
    }
    const external = new AbortController()
    const transport = createAppiumHttpTransport({
      serverUrl: 'http://127.0.0.1:4723',
      requestTimeoutMs: 30_000,
      sessionCreationTimeoutMs: 90_000,
      signal: external.signal,
      fetch: async (_url, init) => {
        advance(35_000)
        init?.signal?.throwIfAborted()
        return new Response('{"value":{"sessionId":"owned"}}')
      },
    }, {
      now: () => now,
      timeoutSignal: milliseconds => {
        const controller = new AbortController()
        timers.push({ deadline: now + milliseconds, controller })
        return controller.signal
      },
    })
    Expect((await createAppiumWebDriverClient(transport).createSession({ platformName: 'iOS' })).id).toBe('owned')
    for (
      const [method, path] of [
        ['GET', '/session/owned/source'],
        ['POST', '/session/owned/actions'],
        ['DELETE', '/session/owned'],
        ['POST', '/session/owned/session'],
        ['GET', '/session'],
      ] as const
    ) {
      let failure: unknown
      try {
        await transport.request({ method, path })
      } catch (error) {
        failure = error
      }
      Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
      if (!(failure instanceof Errors.HostEnvironmentError)) {
        Errors.throwUnexpected('Missing bounded request failure.')
      }
      Expect(failure.details?.['transportFailure']).toEqual({
        stage: 'fetch',
        elapsedMs: 35_000,
        timeoutMs: 30_000,
        operation: method === 'DELETE' ? 'session-deletion' : 'ordinary',
        cancellation: 'timeout',
      })
    }
    external.abort(Errors.abortError('external owner revoked'))
    await Expect(transport.request({ method: 'POST', path: '/session' })).rejects.toThrow('could not reach')
  })

  Test('creation timeout and external cancellation retain the original failure and safe stage evidence', async () => {
    for (const cancellation of ['timeout', 'external', 'none'] as const) {
      const external = new AbortController()
      const budget = new AbortController()
      const original = cancellation === 'none' ? 'secret=private-origin' : Errors.abortError('creation interrupted')
      let now = 10
      const transport = createAppiumHttpTransport({
        serverUrl: 'http://127.0.0.1:4723',
        signal: external.signal,
        requestTimeoutMs: 30_000,
        sessionCreationTimeoutMs: 90_000,
        fetch: async () => {
          now = 91_010
          if (cancellation === 'timeout') {
            budget.abort()
          }
          if (cancellation === 'external') {
            external.abort()
          }
          throw original
        },
      }, { timeoutSignal: () => budget.signal, now: () => now })
      let failure: unknown
      try {
        await transport.request({ method: 'POST', path: '/session', body: { password: 'private-body' } })
      } catch (error) {
        failure = error
      }
      if (!(failure instanceof Errors.HostEnvironmentError)) {
        Errors.throwUnexpected('Missing creation failure.')
      }
      Expect(failure.details?.['cause']).toBe(original)
      Expect(failure.details?.['transportFailure']).toEqual({
        stage: 'fetch',
        elapsedMs: 91_000,
        timeoutMs: 90_000,
        operation: 'session-creation',
        cancellation,
      })
      Expect(JSON.stringify(failure.details?.['transportFailure']).includes('private')).toBe(false)
    }
  })

  Test('element screenshots encode both identities and refuse invalid or oversized PNG payloads', async () => {
    const requests: { method: string; path: string; responseByteLimit?: number }[] = []
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])
    let payload: unknown = Buffer.from(png).toString('base64')
    const client = createAppiumWebDriverClient({
      request: async request => {
        requests.push(request)
        const value = request.path === '/session'
          ? { sessionId: 'owned/session?#' }
          : request.path.endsWith('/element')
          ? { 'element-6066-11e4-a52e-4f735466cecf': 'fixture/element?#' }
          : payload
        return { status: 200, body: { value } }
      },
    })
    const session = await client.createSession({ platformName: 'mac' })
    const element = await session.find({ using: 'xpath', value: '//owned' })
    Expect(await element.screenshot!()).toEqual(png)
    Expect(requests[2]).toEqual({
      method: 'GET',
      path: '/session/owned%2Fsession%3F%23/element/fixture%2Felement%3F%23/screenshot',
      responseByteLimit: 14 * 1024 * 1024,
    })
    for (const value of [undefined, 'bad!', 'AQI=', 'A'.repeat(14 * 1024 * 1024)]) {
      payload = value
      await Expect(element.screenshot!()).rejects.toThrow(/element screenshot/)
    }
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)
    oversized.set(png.subarray(0, 8))
    payload = oversized.toString('base64')
    await Expect(element.screenshot!()).rejects.toThrow('private capture limit')
    Expect(requests.some(request => request.path === '/session/owned%2Fsession%3F%23/screenshot')).toBe(false)
  })

  Test(
    'diagnostic HTTP bounds cancel an oversized streamed response without affecting ordinary responses',
    async () => {
      let cancelled = false
      const transport = createAppiumHttpTransport({
        serverUrl: 'http://127.0.0.1:4723',
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"value":"'))
                controller.enqueue(new TextEncoder().encode('oversized diagnostic payload"}'))
              },
              cancel() {
                cancelled = true
              },
            }),
          ),
      })
      await Expect(
        transport.request({
          method: 'GET',
          path: '/session/driver/source',
          purpose: 'managed-diagnostic',
          responseByteLimit: 16,
        }),
      ).rejects.toThrow('private capture limit')
      Expect(cancelled).toBe(true)
      const ordinary = createAppiumHttpTransport({
        serverUrl: 'http://127.0.0.1:4723',
        fetch: async () => new Response('{"value":"ordinary payload"}'),
      })
      Expect((await ordinary.request({ method: 'GET', path: '/ordinary' })).body).toEqual({ value: 'ordinary payload' })
    },
  )

  Test('diagnostic HTTP cancellation reaches fetch and blocks any later capture', async () => {
    const cancellation = new AbortController()
    let requests = 0
    const client = createAppiumWebDriverClient(createAppiumHttpTransport({
      serverUrl: 'http://127.0.0.1:4723',
      fetch: async (_url, init) => {
        if (init?.method === 'POST') {
          return new Response('{"value":{"sessionId":"driver"}}')
        }
        requests++
        cancellation.abort()
        return await new Promise<Response>((_resolve, reject) => {
          if (init!.signal!.aborted) {
            reject(new Errors.HostEnvironmentError('cancelled diagnostic fetch'))
          } else {
            init!.signal!.addEventListener(
              'abort',
              () => reject(new Errors.HostEnvironmentError('cancelled diagnostic fetch')),
              {
                once: true,
              },
            )
          }
        })
      },
    }))
    const remote = await client.createSession({ platformName: 'Android' })
    await Expect(remote.captureManagedHandshakeDiagnostics!({
      expectedAppId: 'owned.app',
      signal: cancellation.signal,
      assertCurrent: async () => {},
    })).rejects.toThrow('could not reach its local server')
    Expect(requests).toBe(1)
  })

  for (
    const changed of [
      undefined,
      'near-prefix',
      'session',
      'checkout',
      'loopGeneration',
      'projectRoot',
      'appName',
      'sourceRevision',
      'compiledRevision',
      'nonce',
      'devUrl',
    ] as const
  ) {
    Test(
      `Android parsed marker selector ${
        changed === undefined ? 'accepts the mounted publication' : `refuses ${changed}`
      }`,
      async () => {
        const publication = {
          session: 'fixture-session',
          checkout: '/fixture-checkout',
          loopGeneration: 'fixture-loop',
          projectRoot: '/fixture-project',
          appName: 'DataMVPApp',
          sourceRevision: 'source',
          compiledRevision: 'compiled',
          nonce: 'fixture-nonce',
        }
        const devUrl = 'http://127.0.0.1:8081/index.bundle'
        const mounted = changed === undefined || changed === 'near-prefix' || changed === 'devUrl'
          ? publication
          : { ...publication, [changed]: 'foreign-value' }
        const marker = managedLoopIdentityMarker(
          mounted,
          changed === 'devUrl' ? 'http://127.0.0.1:9999/index.bundle' : devUrl,
        )
        const identifier = changed === 'near-prefix' ? marker.testID.replace('identity.', 'identityX') : marker.testID
        let markerMatched = false
        const factory = createAppiumWebDriverClient({
          request: async request => {
            if (request.path.endsWith('/elements')) {
              const locator = request.body as { using: string; value: string }
              Expect(locator).toEqual({
                using: 'xpath',
                value: "//*[@package='host.exp.exponent' and starts-with(@resource-id, 'tao-managed-loop-identity.')]",
              })
              markerMatched = identifier.startsWith('tao-managed-loop-identity.')
              return {
                body: { value: markerMatched ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'marker' }] : [] },
                status: 200,
              }
            }
            const value = request.path === '/session'
              ? { sessionId: 'driver' }
              : request.path.endsWith('/current_package')
              ? 'host.exp.exponent'
              : request.path.endsWith('/attribute/package')
              ? 'host.exp.exponent'
              : identifier
            return { body: { value }, status: 200 }
          },
        })
        const grant = createManagedMobileGrant({
          identity: {
            ...publication,
            target: { platform: 'android', id: 'emulator-5554' },
            resources: [
              { name: 'android-avd:fixture', generation: 'retained-generation' },
              { name: 'android-emulator:5554', generation: 'retained-generation' },
            ],
            runtime: { ...publication, kind: 'expo-go', appId: 'host.exp.exponent', devUrl },
          },
          assertOwnerCurrent: async () => {},
          assertLoopCurrent: async () => {},
        })
        try {
          await appiumAndroidClient(factory, grant).createSession({ platformName: 'Android' })
          if (changed === undefined) {
            await grant.assertCurrent()
          } else {
            const failure = changed === 'near-prefix'
              ? 'exactly one mounted managed marker'
              : changed === 'devUrl'
              ? 'different development server URL'
              : `different ${changed}`
            await Expect(grant.assertCurrent()).rejects.toThrow(failure)
          }
          Expect(markerMatched).toBe(changed !== 'near-prefix')
        } finally {
          grant.revoke()
        }
      },
    )
  }

  Test('ordinary native session creation carries no implicit HTTP cancellation budget', async () => {
    const response = Deferred<Response>()
    const entered = Deferred<void>()
    let signalSupplied = false
    const transport = createAppiumHttpTransport({
      serverUrl: 'http://127.0.0.1:4723',
      fetch: async (_url, init) => {
        signalSupplied = init !== undefined && 'signal' in init
        entered.resolve()
        return await response.promise
      },
    })
    const pending = transport.request({ method: 'POST', path: '/session' })
    await entered.promise
    await Time.sleep(20)
    response.resolve(new Response(JSON.stringify({ value: { sessionId: 'ordinary' } }), { status: 200 }))
    Expect((await pending).status).toBe(200)
    Expect(signalSupplied).toBe(false)
  })

  Test(
    'explicit managed request budget aborts a delayed creation and revoked authority blocks late input',
    async () => {
      const owner = new AbortController()
      let requests = 0
      const transport = createAppiumHttpTransport({
        serverUrl: 'http://127.0.0.1:4723',
        signal: owner.signal,
        requestTimeoutMs: 10,
        assertRequest: async () => {
          if (owner.signal.aborted) {
            Errors.throwHostEnvironment('managed authority revoked')
          }
        },
        fetch: async (_url, init) => {
          requests++
          return await new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener(
              'abort',
              () => reject(new Errors.HostEnvironmentError('finite request cancelled')),
              { once: true },
            )
          })
        },
      })
      const creation = transport.request({ method: 'POST', path: '/session' }).then(() => 'created', Errors.messageOf)
      // budget-ok: The deliberately short injected cancellation deadline must reject a never-completing fetch, rather than measure host speed.
      const outcome = await Promise.race([creation, Time.sleep(200).then(() => 'unbounded')])
      owner.abort()
      await creation
      Expect(outcome).toContain('could not reach its local server')
      await Expect(transport.request({ method: 'POST', path: '/session/late/actions', body: {} })).rejects.toThrow(
        'authority revoked',
      )
      Expect(requests).toBe(1)
    },
  )
  for (const platform of ['ios', 'android'] as const) {
    Test(
      `managed ${platform} handshake reads mounted metadata through native identifier without accessibility labels`,
      async () => {
        const label = JSON.stringify({ nonce: 'mounted', devUrl: 'http://127.0.0.1:8081/index.bundle' })
        const requests: Array<{ path: string; body?: unknown; purpose?: string }> = []
        const remote = createAppiumWebDriverClient({
          request: async request => {
            requests.push(request)
            const value = request.path === '/session'
              ? { sessionId: 'driver' }
              : request.path.endsWith('/current_package')
              ? 'runtime.app'
              : request.path.endsWith('/attribute/package')
              ? 'runtime.app'
              : request.path.endsWith('/execute/sync')
              ? { bundleId: 'runtime.app' }
              : request.path.endsWith('/element')
              ? { 'element-6066-11e4-a52e-4f735466cecf': 'marker' }
              : request.path.endsWith('/elements')
              ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'marker' }]
              : `tao-managed-loop-identity.${encodeURIComponent(label)}`
            return { body: { value }, status: 200 }
          },
        })
        const session = await remote.createSession({ platformName: platform })
        Expect(await session.readManagedRuntimeIdentity!(platform, 'runtime.app')).toEqual({
          appId: 'runtime.app',
          label,
        })
        const handshake = requests.slice(1)
        Expect(handshake.every(request => request.purpose === 'managed-identity')).toBe(true)
        Expect(handshake.at(-1)?.path).toBe(
          platform === 'ios'
            ? '/session/driver/element/marker/attribute/name'
            : '/session/driver/appium/device/current_package',
        )
        Expect(JSON.stringify(handshake)).not.toContain('content-desc')
        Expect(JSON.stringify(handshake)).not.toContain('accessibility id')
      },
    )
  }
  Test('managed cancellation aborts a finite action while deletion uses its separate cleanup budget', async () => {
    const aborted = new AbortController()
    const entered = Deferred<void>()
    let deletionSignal: RequestInit['signal']
    const transport = createAppiumHttpTransport({
      serverUrl: 'http://127.0.0.1:4723',
      signal: aborted.signal,
      requestTimeoutMs: 30_000,
      fetch: async (_url, init) => {
        if (init?.method === 'DELETE') {
          deletionSignal = init.signal
          return new Response(JSON.stringify({ value: null }), { status: 200 })
        }
        entered.resolve()
        return await new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {
            once: true,
          })
        })
      },
    })
    const action = transport.request({ method: 'POST', path: '/session/managed/actions', body: {} })
    await entered.promise
    aborted.abort()
    await Expect(action).rejects.toThrow('could not reach its local server')
    await transport.request({ method: 'DELETE', path: '/session/managed' })
    Expect(deletionSignal?.aborted).toBe(false)
  })
  Test('encodes session, element, external, input, and screenshot operations', async () => {
    const requests: Array<{ body?: unknown; method?: string; path: string }> = []
    const transport = createAppiumHttpTransport({
      fetch: async (url, init) => {
        const path = new URL(url).pathname
        requests.push({
          ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
          method: init?.method,
          path,
        })
        const value = path === '/session'
          ? { sessionId: 'session-1' }
          : path.endsWith('/element')
          ? { 'element-6066-11e4-a52e-4f735466cecf': 'element-1' }
          : path.endsWith('/displayed')
          ? true
          : path.endsWith('/text')
          ? 'Studio'
          : path.endsWith('/attribute/label')
          ? 'Studio window'
          : path.endsWith('/rect')
          ? { height: 20, width: 40, x: 2, y: 4 }
          : path.endsWith('/screenshot')
          ? 'AQI='
          : { complete: true }
        return new Response(JSON.stringify({ value }), { status: 200 })
      },
      serverUrl: 'http://127.0.0.1:4723/',
    })
    const session = await createAppiumWebDriverClient(transport).createSession({
      'appium:automationName': 'Mac2',
      platformName: 'mac',
    })
    const element = await session.find({ using: 'accessibility id', value: 'studio-window' })
    await element.find({ using: 'accessibility id', value: 'toolbar' })
    await element.click()
    await element.sendKeys('Tao')
    await session.actions([{ actions: [{ type: 'keyDown', value: 'Enter' }], id: 'key', type: 'key' }])
    await session.dismissAlert!()
    await session.activateApplication('dev.tao.studio')
    await session.terminateApplication('dev.tao.studio')
    await Expect(session.executeScript('macos: click', [{ x: 1, y: 2 }])).resolves.toEqual({ complete: true })
    await Expect(element.observe()).resolves.toEqual({
      accessibilityLabel: 'Studio window',
      rect: { height: 20, width: 40, x: 2, y: 4 },
      text: 'Studio',
      visible: true,
    })
    await Expect(session.screenshot()).resolves.toEqual(new Uint8Array([1, 2]))
    await session.delete()

    Expect(requests.map(request => `${request.method} ${request.path}`)).toEqual([
      'POST /session',
      'POST /session/session-1/element',
      'POST /session/session-1/element/element-1/element',
      'POST /session/session-1/element/element-1/click',
      'POST /session/session-1/element/element-1/value',
      'POST /session/session-1/actions',
      'POST /session/session-1/alert/dismiss',
      'POST /session/session-1/appium/device/activate_app',
      'POST /session/session-1/appium/device/terminate_app',
      'POST /session/session-1/execute/sync',
      'GET /session/session-1/element/element-1/attribute/label',
      'GET /session/session-1/element/element-1/rect',
      'GET /session/session-1/element/element-1/text',
      'GET /session/session-1/element/element-1/displayed',
      'GET /session/session-1/screenshot',
      'DELETE /session/session-1',
    ])
    Expect(requests[0]?.body).toEqual({
      capabilities: { alwaysMatch: { 'appium:automationName': 'Mac2', platformName: 'mac' }, firstMatch: [{}] },
    })
  })

  Test('reports an absent element separately from a WebDriver host failure', async () => {
    const transport = createAppiumHttpTransport({
      fetch: async url =>
        new URL(url).pathname === '/session'
          ? new Response(JSON.stringify({ value: { sessionId: 'session-1' } }), { status: 200 })
          : new Response(JSON.stringify({ value: { error: 'no such element', message: 'missing control' } }), {
            status: 404,
          }),
      serverUrl: 'http://127.0.0.1:4723',
    })
    const session = await createAppiumWebDriverClient(transport).createSession({ 'appium:automationName': 'mac2' })
    await Expect(session.find({ using: 'accessibility id', value: 'missing' })).rejects.toBeInstanceOf(
      AppiumNoSuchElementError,
    )
  })

  Test('reports an absent alert separately so session cleanup can be idempotent', async () => {
    const transport = createAppiumHttpTransport({
      fetch: async url =>
        new URL(url).pathname === '/session'
          ? new Response(JSON.stringify({ value: { sessionId: 'session-1' } }), { status: 200 })
          : new Response(JSON.stringify({ value: { error: 'no such alert', message: 'no alert open' } }), {
            status: 404,
          }),
      serverUrl: 'http://127.0.0.1:4723',
    })
    const session = await createAppiumWebDriverClient(transport).createSession({ 'appium:automationName': 'xcuitest' })
    await Expect(session.dismissAlert!()).rejects.toBeInstanceOf(AppiumNoSuchAlertError)
  })
})
