import { Errors, FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test } from '@shared/test'
import {
  StudioCdp,
  type StudioCdpTransport,
} from '../studio-tooling-src/StudioCdp'

type CdpCall = {
  method: string
  params: Record<string, unknown>
}

const FAKE_DRAG_DATA = {
  dragOperationsMask: 1,
  items: [{ data: '{"kind":"component"}', mimeType: 'application/x-tao-studio-palette' }],
}

class FakeCdpTransport implements StudioCdpTransport {
  browserVersion = {
    jsVersion: '14.2',
    product: 'Chrome/142.0.1',
    protocolVersion: '1.3',
    userAgent: 'Fake Chrome',
  }
  readonly calls: CdpCall[] = []
  readonly evaluateResults: unknown[] = []
  evaluateExpression: ((expression: string) => unknown) | undefined
  readonly isolatedWorldErrors: Error[] = []
  frameTree: {
    childFrames?: Array<{ frame: { id: string; url: string } }>
    frame: { id: string; url: string }
  } = { frame: { id: 'root', url: 'http://127.0.0.1/studio' } }
  screenshot = Buffer.from('screenshot bytes').toString('base64')
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>()
  private intercepting = false
  failMouseType: string | undefined

  listenerCount(method: string): number {
    return this.listeners.get(method)?.size ?? 0
  }

  async send<Result = Record<string, never>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    this.calls.push({ method, params })
    if (method === 'Input.setInterceptDrags') {
      this.intercepting = params['enabled'] === true
    }
    if (method === 'Input.dispatchMouseEvent' && params['type'] === this.failMouseType) {
      Errors.throwHostEnvironment('Mouse transport failed')
    }
    // Chrome answers an intercepted drag gesture with the payload the page's own dragstart built.
    if (this.intercepting && method === 'Input.dispatchMouseEvent' && params['buttons'] === 1) {
      this.intercepting = false
      this.emit('Input.dragIntercepted', { data: FAKE_DRAG_DATA })
    }
    if (method === 'Runtime.evaluate') {
      const value = this.evaluateExpression === undefined
        ? this.evaluateResults.shift()
        : this.evaluateExpression(params['expression'] as string)
      if (value instanceof Error) {
        throw value
      }
      return { result: { value } } as Result
    }
    if (method === 'Browser.getVersion') {
      return this.browserVersion as Result
    }
    if (method === 'Page.getFrameTree') {
      return { frameTree: this.frameTree } as Result
    }
    if (method === 'Page.createIsolatedWorld') {
      const error = this.isolatedWorldErrors.shift()
      if (error !== undefined) {
        throw error
      }
      return { executionContextId: 42 } as Result
    }
    if (method === 'Page.captureScreenshot') {
      return { data: this.screenshot } as Result
    }
    return {} as Result
  }

  subscribe(method: string, listener: (params: unknown) => void): () => void {
    const listeners = this.listeners.get(method) ?? new Set<(params: unknown) => void>()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners.get(method) ?? []) {
      listener(params)
    }
  }
}

Describe('Studio browser CDP harness', () => {
  Test('joins owned Chrome cleanup after a natural exit before disposing its observers', async () => {
    const profile = await mkTestDir('tao-studio-cdp-cleanup-')
    const joined = Deferred<{ exitCode: number; signal: null }>()
    const events: string[] = []
    const cleanup = StudioCdp.testing.stopChrome(
      {
        exitCode: 0,
        signalCode: null,
        kill: () => {
          events.push('kill')
          return true
        },
        waitForClose: () => {
          events.push('join')
          return joined.promise
        },
        closeOutput: async () => {
          events.push('output')
        },
        dispose: () => events.push('dispose'),
      },
      profile,
      'SIGTERM',
    )
    await settle()
    Expect(events).toEqual(['join'])
    Expect(await FS.isDirectory(profile)).toBe(true)
    joined.resolve({ exitCode: 0, signal: null })
    await cleanup
    Expect(events).toEqual(['join', 'output', 'dispose'])
    Expect(await FS.isDirectory(profile)).toBe(false)
  })

  Test('retains cleanup failures while still disposing Chrome output and removing its profile', async () => {
    const profile = await mkTestDir('tao-studio-cdp-cleanup-')
    const events: string[] = []
    const original = new Errors.HostEnvironmentError('original ownership join failure')
    let caught: unknown
    try {
      await StudioCdp.testing.stopChrome(
        {
          exitCode: 19,
          signalCode: null,
          kill: () => true,
          waitForClose: async () => {
            throw original
          },
          closeOutput: async () => {
            events.push('output')
            Errors.throwHostEnvironment('output drain failure')
          },
          dispose: () => events.push('dispose'),
        },
        profile,
        'SIGKILL',
      )
    } catch (error) {
      caught = error
    }
    Expect(caught).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect((caught as Errors.HostEnvironmentError).cause).toBe(original)
    Expect(Errors.formatForLog(caught)).toContain('output drain failure')
    Expect(events).toEqual(['output', 'dispose'])
    Expect(await FS.isDirectory(profile)).toBe(false)
  })

  Test('rejects a stale DevTools port after Chrome failed with its original startup output', async () => {
    const profile = await mkTestDir('tao-studio-cdp-startup-')
    await FS.writeText(FS.resolvePath('DevToolsActivePort', profile), '9222\n/browser/token')
    await Expect(
      StudioCdp.testing.waitForActivePort(
        profile,
        { exitCode: 19, signalCode: null },
        () => 'Executable: fixture Chrome\noriginal Chrome failure',
      ),
    )
      .rejects.toThrow(
        'Chrome DevToolsActivePort failed to start (exit 19):\nExecutable: fixture Chrome\noriginal Chrome failure',
      )
  })

  Test('accepts the DevTools port only while its Chrome child remains healthy', async () => {
    const profile = await mkTestDir('tao-studio-cdp-startup-')
    await FS.writeText(FS.resolvePath('DevToolsActivePort', profile), '9222\n/browser/token')
    Expect(await StudioCdp.testing.waitForActivePort(profile, { exitCode: null, signalCode: null })).toBe(9222)
  })

  Test('sets explicit deterministic desktop viewport dimensions', async () => {
    const transport = new FakeCdpTransport()
    const browser = StudioCdp.testing.create(transport)

    await browser.setViewport(390, 844)

    Expect(transport.calls).toEqual([{
      method: 'Emulation.setDeviceMetricsOverride',
      params: {
        deviceScaleFactor: 1,
        height: 844,
        mobile: false,
        width: 390,
      },
    }])
    await Expect(browser.setViewport(390.5, 844)).rejects.toThrow('width must be a positive integer')
  })

  Test('scrolls a clickable control into view before dispatching its pointer event', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push(true, { x: 200, y: 300 })
    const browser = StudioCdp.testing.create(transport)

    await browser.click('[data-action="undo"]')

    const evaluations = transport.calls.filter(call => call.method === 'Runtime.evaluate')
    Expect(evaluations[0]?.params['expression']).toContain("scrollIntoView({ block: 'center', inline: 'center' })")
    Expect(transport.calls.filter(call => call.method === 'Input.dispatchMouseEvent')).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, clickCount: 1, type: 'mousePressed', x: 200, y: 300 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x: 200, y: 300 },
      },
    ])
  })

  Test('dispatches bounded offset clicks and physical primary-wheel gestures', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push({ x: 12, y: 34 }, { x: 200, y: 300 }, true)
    const browser = StudioCdp.testing.create(transport)

    await browser.clickAtOffset('.cm-line', { x: 2, y: 10 })
    await browser.wheel('.studio-preview-cell iframe', { x: 4, y: -180 }, { primary: true })

    Expect(transport.calls.filter(call => call.method === 'Input.dispatchMouseEvent')).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, clickCount: 1, type: 'mousePressed', x: 12, y: 34 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x: 12, y: 34 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { deltaX: 4, deltaY: -180, modifiers: 4, type: 'mouseWheel', x: 200, y: 300 },
      },
    ])
    await Expect(browser.clickAtOffset('.cm-line', { x: Number.NaN, y: 0 })).rejects.toThrow(
      'horizontal click offset must be finite',
    )
    await Expect(browser.wheel('.cm-scroller', { x: 0, y: Number.NaN })).rejects.toThrow(
      'vertical wheel delta must be finite',
    )
  })

  // Chrome never synthesizes HTML5 drag-and-drop from mouse events, so a palette drag has to go
  // through drag interception: press and move to make the page start the drag, then replay the
  // intercepted payload into dragEnter/dragOver/drop over the target.
  Test('drops the intercepted page payload at an explicit iframe target point', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push({ x: 40, y: 80 })
    const browser = StudioCdp.testing.create(transport)

    await browser.dragToPoint('[data-field="Title"]', { x: 640, y: 360 }, { steps: 2 })

    Expect(transport.calls.filter(call => call.method === 'Input.dispatchDragEvent' && call.params['type'] === 'drop'))
      .toEqual([
        { method: 'Input.dispatchDragEvent', params: { data: FAKE_DRAG_DATA, type: 'drop', x: 640, y: 360 } },
      ])
    await Expect(browser.dragToPoint('#source', { x: Number.NaN, y: 0 })).rejects.toThrow(
      'horizontal drop coordinate must be finite',
    )
  })

  Test('cleans up interception when the source mouse gesture fails before a payload arrives', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push({ x: 40, y: 80 })
    transport.failMouseType = 'mousePressed'
    const browser = StudioCdp.testing.create(transport)
    try {
      await Expect(browser.dragToPoint('#source', { x: 640, y: 360 })).rejects.toThrow('Mouse transport failed')
      Expect(transport.calls.slice(-2)).toEqual([
        {
          method: 'Input.dispatchMouseEvent',
          params: { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x: 640, y: 360 },
        },
        { method: 'Input.setInterceptDrags', params: { enabled: false } },
      ])
      Expect(transport.listenerCount('Input.dragIntercepted')).toBe(0)
    } finally {
      // Also clears the old implementation's timer when this regression is run red.
      transport.emit('Input.dragIntercepted', { data: FAKE_DRAG_DATA })
    }
  })

  Test('dispatches an intercepted HTML5 drag over deterministic interpolated coordinates', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push({
      end: { x: 30, y: 60 },
      start: { x: 10, y: 20 },
    })
    const browser = StudioCdp.testing.create(transport)

    await browser.drag('[data-component="Text"]', '[data-canvas]', { steps: 2 })

    Expect(transport.calls.filter(call => call.method === 'Input.dispatchMouseEvent')).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'none', buttons: 0, type: 'mouseMoved', x: 10, y: 20 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, clickCount: 1, type: 'mousePressed', x: 10, y: 20 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, type: 'mouseMoved', x: 20, y: 40 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, type: 'mouseMoved', x: 30, y: 60 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x: 30, y: 60 },
      },
    ])
    Expect(transport.calls.filter(call => call.method === 'Input.dispatchDragEvent')).toEqual(
      ['dragEnter', 'dragOver', 'drop'].map(type => ({
        method: 'Input.dispatchDragEvent',
        params: { data: FAKE_DRAG_DATA, type, x: 30, y: 60 },
      })),
    )
    Expect(transport.calls.filter(call => call.method === 'Input.setInterceptDrags')).toEqual([
      { method: 'Input.setInterceptDrags', params: { enabled: true } },
      { method: 'Input.setInterceptDrags', params: { enabled: false } },
    ])
    await Expect(browser.drag('#source', '#target', { steps: 0 })).rejects.toThrow(
      'drag steps must be a positive integer',
    )
  })

  Test('drops on the visible editor content inside separately clipped scroll axes', async () => {
    class Element {
      constructor(
        readonly rect: { bottom: number; left: number; right: number; top: number },
        readonly parentElement: Element | null = null,
        readonly clip?: { clientHeight: number; clientLeft: number; clientTop: number; clientWidth: number },
      ) {}

      getBoundingClientRect() {
        return this.rect
      }
      get clientHeight() {
        return this.clip?.clientHeight ?? this.rect.bottom - this.rect.top
      }
      get clientLeft() {
        return this.clip?.clientLeft ?? 0
      }
      get clientTop() {
        return this.clip?.clientTop ?? 0
      }
      get clientWidth() {
        return this.clip?.clientWidth ?? this.rect.right - this.rect.left
      }
      get tagName() {
        return 'DIV'
      }
      contains(node: Element) {
        return node === this
      }
    }
    const horizontalClip = new Element(
      { left: 500, right: 720, top: 0, bottom: 720 },
      null,
      { clientLeft: 10, clientTop: 0, clientWidth: 180, clientHeight: 720 },
    )
    const verticalClip = new Element(
      { left: 0, right: 1280, top: 200, bottom: 420 },
      horizontalClip,
      { clientLeft: 0, clientTop: 10, clientWidth: 1280, clientHeight: 180 },
    )
    const source = new Element({ left: 20, right: 100, top: 20, bottom: 100 })
    const target = new Element({ left: 400, right: 1600, top: 100, bottom: 1100 }, verticalClip)
    const shield = new Element({ left: 700, right: 1280, top: 0, bottom: 720 })
    let shieldCoversEditor = false
    const transport = new FakeCdpTransport()
    transport.evaluateExpression = expression =>
      new Function(
        'document',
        'window',
        'HTMLElement',
        'getComputedStyle',
        `return ${expression}`,
      )(
        {
          querySelector: (selector: string) =>
            selector === '#source' ? source : selector === '.cm-content' ? target : null,
          elementFromPoint: (x: number, y: number) => {
            if (x >= 20 && x <= 100 && y >= 20 && y <= 100) {
              return source
            }
            if (x >= 510 && x <= 690 && y >= 210 && y <= 390) {
              return shieldCoversEditor ? shield : target
            }
            return shield
          },
        },
        { innerWidth: 1280, innerHeight: 720 },
        Element,
        (element: Element) =>
          element === horizontalClip
            ? { overflowX: 'hidden', overflowY: 'visible' }
            : element === verticalClip
            ? { overflowX: 'visible', overflowY: 'auto' }
            : { overflowX: 'visible', overflowY: 'visible' },
      )
    const browser = StudioCdp.testing.create(transport)

    await browser.drag('#source', '.cm-content', { steps: 1 })

    Expect(transport.calls.filter(call => call.method === 'Input.dispatchDragEvent' && call.params['type'] === 'drop'))
      .toEqual([{ method: 'Input.dispatchDragEvent', params: { data: FAKE_DRAG_DATA, type: 'drop', x: 600, y: 300 } }])

    shieldCoversEditor = true
    await Expect(browser.drag('#source', '.cm-content')).rejects.toThrow(
      'Visible center of the drag target element .cm-content lands on',
    )
    shieldCoversEditor = false
    verticalClip.clip!.clientHeight = 0
    await Expect(browser.drag('#source', '.cm-content')).rejects.toThrow(
      'No visible part of the drag target element: .cm-content',
    )
    Expect(transport.calls.filter(call => call.method === 'Input.setInterceptDrags')).toHaveLength(2)
  })

  Test('drags a resizer by an exact pointer delta', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push(true, { x: 200, y: 300 })
    const browser = StudioCdp.testing.create(transport)

    await browser.dragBy('[data-divider="preview"]', { x: -40, y: 0 }, { steps: 1 })

    const evaluations = transport.calls.filter(call => call.method === 'Runtime.evaluate')
    Expect(evaluations[0]?.params['expression']).toContain("scrollIntoView({ block: 'center', inline: 'center' })")
    Expect(transport.calls.filter(call => call.method === 'Input.dispatchMouseEvent')).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'none', buttons: 0, type: 'mouseMoved', x: 200, y: 300 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, clickCount: 1, type: 'mousePressed', x: 200, y: 300 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 1, type: 'mouseMoved', x: 160, y: 300 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x: 160, y: 300 },
      },
    ])
    await Expect(browser.dragBy('#divider', { x: Number.NaN, y: 0 })).rejects.toThrow(
      'horizontal drag delta must be finite',
    )
  })

  Test('writes screenshots beneath the configured smoke artifact root', async () => {
    const artifactRoot = await mkTestDir('tao-studio-cdp-')
    try {
      const transport = new FakeCdpTransport()
      const browser = StudioCdp.testing.create(transport, { artifactRoot })

      const path = await browser.captureScreenshot('narrow-desktop')

      Expect(path).toBe(FS.resolvePath('screenshots/narrow-desktop.png', artifactRoot))
      Expect(await FS.readText(path)).toBe('screenshot bytes')
      Expect(transport.calls.at(-1)).toEqual({
        method: 'Page.captureScreenshot',
        params: {
          captureBeyondViewport: false,
          format: 'png',
          fromSurface: true,
        },
      })
      await Expect(browser.captureScreenshot('../escape')).rejects.toThrow(
        'screenshot names must use only',
      )
    } finally {
      await FS.remove(artifactRoot)
    }
  })

  Test('captures only a settled DOM element with its page-space clip', async () => {
    const artifactRoot = await mkTestDir('tao-studio-cdp-element-')
    try {
      const transport = new FakeCdpTransport()
      transport.evaluateResults.push(undefined, { height: 844, width: 390, x: 120, y: 240 })
      const browser = StudioCdp.testing.create(transport)
      const path = FS.resolvePath('cell.png', artifactRoot)

      await browser.captureElementScreenshotAt(path, '.studio-preview-cell-viewport')

      Expect(await FS.readText(path)).toBe('screenshot bytes')
      const evaluation = transport.calls.find(call =>
        call.method === 'Runtime.evaluate'
        && String(call.params['expression']).includes('document.fonts?.ready')
      )
      Expect(evaluation?.params['expression']).toContain('requestAnimationFrame(() => requestAnimationFrame(resolve))')
      Expect(evaluation?.params['expression']).toContain('animation:none!important')
      Expect(evaluation?.params['expression']).toContain("setProperty('position', 'fixed', 'important')")
      Expect(transport.calls.find(call => call.method === 'Page.captureScreenshot')).toEqual({
        method: 'Page.captureScreenshot',
        params: {
          captureBeyondViewport: true,
          clip: { height: 844, scale: 1, width: 390, x: 120, y: 240 },
          format: 'png',
          fromSurface: true,
        },
      })
      Expect(transport.calls.at(-1)?.params['expression']).toContain('restoreProperty')
    } finally {
      await FS.remove(artifactRoot)
    }
  })

  Test('freezes the exact cross-origin preview frame while capturing its viewport', async () => {
    const artifactRoot = await mkTestDir('tao-studio-cdp-frame-')
    try {
      const transport = new FakeCdpTransport()
      transport.frameTree = {
        childFrames: [{ frame: { id: 'preview', url: 'http://127.0.0.1:55102/?preview=one' } }],
        frame: { id: 'root', url: 'http://127.0.0.1:55101/studio' },
      }
      transport.evaluateResults.push(
        'http://127.0.0.1:55102/?preview=one',
        true,
        { height: 844, width: 390, x: 120, y: 240 },
        true,
        true,
      )
      const browser = StudioCdp.testing.create(transport)

      await browser.captureElementScreenshotAt(FS.resolvePath('cell.png', artifactRoot), '.viewport')

      const frameEvaluations = transport.calls.filter(call =>
        call.method === 'Runtime.evaluate' && call.params['contextId'] === 42
      )
      Expect(frameEvaluations[0]?.params['expression']).toContain('taoCdpFrameFreeze')
      Expect(frameEvaluations[0]?.params['expression']).toContain('document.fonts?.ready')
      Expect(frameEvaluations.at(-1)?.params['expression']).toContain('tao-cdp-frame-freeze')
    } finally {
      await FS.remove(artifactRoot)
    }
  })

  Test('records the browser renderer fingerprint used for review comparison', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push({
      colorGamut: 'p3',
      deviceScaleFactor: 2,
      fontFingerprint: '[["Inter","normal","400","normal","loaded"]]',
      locale: 'en-US',
      platform: 'MacIntel',
      timezone: 'America/New_York',
    })
    const browser = StudioCdp.testing.create(transport)

    Expect(await browser.rendererFingerprint()).toEqual({
      colorGamut: 'p3',
      deviceScaleFactor: 2,
      fontFingerprint: '[["Inter","normal","400","normal","loaded"]]',
      jsVersion: '14.2',
      locale: 'en-US',
      platform: 'MacIntel',
      product: 'Chrome/142.0.1',
      protocolVersion: '1.3',
      timezone: 'America/New_York',
      userAgent: 'Fake Chrome',
    })
  })

  Test('retries a renderer fingerprint when a live preview reload destroys its context', async () => {
    const transport = new FakeCdpTransport()
    transport.frameTree = {
      childFrames: [{ frame: { id: 'preview', url: 'http://127.0.0.1:55102/?preview=one' } }],
      frame: { id: 'root', url: 'http://127.0.0.1/studio' },
    }
    const pageFingerprint = {
      colorGamut: 'srgb',
      deviceScaleFactor: 1,
      fontFingerprint: 'page-fonts',
      locale: 'en-US',
      platform: 'MacIntel',
      timezone: 'America/New_York',
    }
    transport.evaluateResults.push(
      pageFingerprint,
      new Errors.HostEnvironmentError('Execution context was destroyed.'),
      pageFingerprint,
      'frame-fonts',
    )
    const browser = StudioCdp.testing.create(transport)

    Expect(await browser.rendererFingerprint()).toMatchObject({
      fontFingerprint: '09947a6b4157d40020e97c9861a1c64833e62a0fd315930d5b822a4c538ec41e',
      product: 'Chrome/142.0.1',
    })
    Expect(transport.calls.filter(call => call.method === 'Browser.getVersion')).toHaveLength(2)
    Expect(transport.calls.filter(call => call.method === 'Page.getFrameTree')).toHaveLength(2)
  })

  Test('fingerprints preview frames by what they render, not the URL each launch serves them from', async () => {
    const fingerprintFor = async (urls: readonly string[]) => {
      const transport = new FakeCdpTransport()
      transport.frameTree = {
        childFrames: urls.map((url, index) => ({ frame: { id: `preview-${index}`, url } })),
        frame: { id: 'root', url: 'http://127.0.0.1/studio' },
      }
      transport.evaluateResults.push(
        {
          colorGamut: 'srgb',
          deviceScaleFactor: 1,
          fontFingerprint: 'page-fonts',
          locale: 'en-US',
          platform: 'MacIntel',
          timezone: 'America/New_York',
        },
        ...urls.map(() => 'frame-fonts'),
      )
      return (await StudioCdp.testing.create(transport).rendererFingerprint()).fontFingerprint
    }

    Expect(await fingerprintFor(['http://127.0.0.1:55102/?previewInstanceId=one'])).toBe(
      await fingerprintFor([
        'http://127.0.0.1:61877/?previewInstanceId=two',
        'http://127.0.0.1:61877/?previewInstanceId=three',
      ]),
    )
  })

  Test('retries waits only for recognized execution-context replacement', async () => {
    const transient = new FakeCdpTransport()
    transient.evaluateResults.push(
      new Errors.HostEnvironmentError('Execution context was destroyed.'),
      true,
    )
    const browser = StudioCdp.testing.create(transient)

    await browser.waitFor('window.ready === true', { timeoutMs: 10_000 })
    Expect(transient.calls.filter(call => call.method === 'Runtime.evaluate')).toHaveLength(2)

    const productFailure = new FakeCdpTransport()
    productFailure.evaluateResults.push(new Errors.HostEnvironmentError('Preview handler failed after dispatch.'))
    // `productFailure` throws on its first evaluate, before any poll interval elapses.
    await Expect(
      StudioCdp.testing.create(productFailure).waitFor('window.ready === true', { timeoutMs: 10_000 }),
    ).rejects.toThrow('Preview handler failed after dispatch.')
    Expect(productFailure.calls.filter(call => call.method === 'Runtime.evaluate')).toHaveLength(1)
  })

  Test('retries frame replacement only before dispatching the page action', async () => {
    const transport = new FakeCdpTransport()
    transport.frameTree = {
      childFrames: [{ frame: { id: 'preview', url: 'http://127.0.0.1:55102/' } }],
      frame: { id: 'root', url: 'http://127.0.0.1/studio' },
    }
    transport.isolatedWorldErrors.push(new Errors.HostEnvironmentError('Cannot find context with specified id'))
    transport.evaluateResults.push(true)
    const browser = StudioCdp.testing.create(transport)

    await browser.clickInFrame('http://127.0.0.1:55102/', '#send-once')

    Expect(transport.calls.filter(call => call.method === 'Page.createIsolatedWorld')).toHaveLength(2)
    Expect(transport.calls.filter(call => call.method === 'Runtime.evaluate')).toHaveLength(1)

    const afterDispatch = new FakeCdpTransport()
    afterDispatch.frameTree = transport.frameTree
    afterDispatch.evaluateResults.push(new Errors.HostEnvironmentError('Execution context was destroyed.'))
    await Expect(
      StudioCdp.testing.create(afterDispatch).clickInFrame('http://127.0.0.1:55102/', '#send-once'),
    ).rejects.toThrow('Execution context was destroyed.')
    Expect(afterDispatch.calls.filter(call => call.method === 'Runtime.evaluate')).toHaveLength(1)
  })

  Test('dispatches physical keys with platform-primary and unmodified punctuation', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push(true)
    const browser = StudioCdp.testing.create(transport)

    await browser.pressShortcut('k')
    await browser.pressKey('/')
    await browser.pressKey('Enter')

    Expect(transport.calls.filter(call => call.method === 'Input.dispatchKeyEvent')).toEqual([
      {
        method: 'Input.dispatchKeyEvent',
        params: { code: 'KeyK', key: 'k', modifiers: 4, type: 'rawKeyDown', windowsVirtualKeyCode: 75 },
      },
      {
        method: 'Input.dispatchKeyEvent',
        params: { code: 'KeyK', key: 'k', modifiers: 4, type: 'keyUp', windowsVirtualKeyCode: 75 },
      },
      {
        method: 'Input.dispatchKeyEvent',
        params: { code: 'Slash', key: '/', modifiers: 0, text: '/', type: 'keyDown', windowsVirtualKeyCode: 191 },
      },
      {
        method: 'Input.dispatchKeyEvent',
        params: { code: 'Slash', key: '/', modifiers: 0, type: 'keyUp', windowsVirtualKeyCode: 191 },
      },
      {
        method: 'Input.dispatchKeyEvent',
        params: { code: 'Enter', key: 'Enter', modifiers: 0, text: '\r', type: 'keyDown', windowsVirtualKeyCode: 13 },
      },
      {
        method: 'Input.dispatchKeyEvent',
        params: { code: 'Enter', key: 'Enter', modifiers: 0, type: 'keyUp', windowsVirtualKeyCode: 13 },
      },
    ])
    await Expect(browser.pressKey('unsupported')).rejects.toThrow('browser key is unsupported')
  })

  Test('collects console messages and uncaught exceptions without mixing non-failures', async () => {
    const transport = new FakeCdpTransport()
    const browser = StudioCdp.testing.create(transport)
    transport.emit('Runtime.consoleAPICalled', {
      args: [{ value: 'loaded' }, { value: { cell: 'primary' } }],
      timestamp: 11,
      type: 'log',
    })
    transport.emit('Runtime.consoleAPICalled', {
      args: [{ description: 'Error: preview failed' }],
      timestamp: 12,
      type: 'error',
    })
    transport.emit('Runtime.exceptionThrown', {
      exceptionDetails: {
        exception: { description: 'TypeError: uncaught preview failure' },
        timestamp: 13,
      },
    })

    Expect(browser.browserEvents()).toEqual([
      { kind: 'console', level: 'log', text: 'loaded {"cell":"primary"}', timestamp: 11 },
      { kind: 'console', level: 'error', text: 'Error: preview failed', timestamp: 12 },
      { kind: 'exception', level: 'error', text: 'TypeError: uncaught preview failure', timestamp: 13 },
    ])
    Expect(browser.browserFailures()).toEqual([
      { kind: 'console', level: 'error', text: 'Error: preview failed', timestamp: 12 },
      { kind: 'exception', level: 'error', text: 'TypeError: uncaught preview failure', timestamp: 13 },
    ])

    browser.clearBrowserEvents()
    Expect(browser.browserEvents()).toEqual([])
    await browser.close()
    transport.emit('Runtime.exceptionThrown', {
      exceptionDetails: { text: 'after close' },
    })
    Expect(browser.browserEvents()).toEqual([])
  })

  Test('names the frame whose page logged each console message or exception', async () => {
    const transport = new FakeCdpTransport()
    const browser = StudioCdp.testing.create(transport)
    transport.emit('Runtime.executionContextCreated', {
      context: { auxData: { frameId: 'cell-frame', isDefault: true }, id: 7 },
    })
    transport.emit('Runtime.consoleAPICalled', {
      args: [{ value: 'cell failed' }],
      executionContextId: 7,
      timestamp: 21,
      type: 'error',
    })
    transport.emit('Runtime.exceptionThrown', {
      exceptionDetails: { executionContextId: 9, text: 'elsewhere', timestamp: 22 },
    })

    Expect(browser.browserEvents()).toEqual([
      { frameId: 'cell-frame', kind: 'console', level: 'error', text: 'cell failed', timestamp: 21 },
      { kind: 'exception', level: 'error', text: 'elsewhere', timestamp: 22 },
    ])
    await browser.close()
  })
})
