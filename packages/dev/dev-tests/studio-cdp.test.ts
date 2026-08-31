import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  StudioCdp,
  type StudioCdpTransport,
} from '../dev-src/studio/StudioCdp'

type CdpCall = {
  method: string
  params: Record<string, unknown>
}

class FakeCdpTransport implements StudioCdpTransport {
  readonly calls: CdpCall[] = []
  readonly evaluateResults: unknown[] = []
  screenshot = Buffer.from('screenshot bytes').toString('base64')
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>()

  async send<Result = Record<string, never>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    this.calls.push({ method, params })
    if (method === 'Runtime.evaluate') {
      return { result: { value: this.evaluateResults.shift() } } as Result
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

  Test('dispatches a pointer drag over deterministic interpolated coordinates', async () => {
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
    await Expect(browser.drag('#source', '#target', { steps: 0 })).rejects.toThrow(
      'drag steps must be a positive integer',
    )
  })

  Test('drags a resizer by an exact pointer delta', async () => {
    const transport = new FakeCdpTransport()
    transport.evaluateResults.push({ x: 200, y: 300 })
    const browser = StudioCdp.testing.create(transport)

    await browser.dragBy('[data-divider="preview"]', { x: -40, y: 0 }, { steps: 1 })

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
    const artifactRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-cdp-', FS.tmpdir()))
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
})
