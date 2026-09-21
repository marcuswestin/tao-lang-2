import { Describe, Expect, Test } from '@shared/test'
import {
  AppiumNoSuchAlertError,
  AppiumNoSuchElementError,
  createAppiumHttpTransport,
  createAppiumWebDriverClient,
} from '../appium-driver-src/AppiumWebDriver'

Describe('Appium W3C transport', () => {
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
