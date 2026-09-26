import { CLI, Errors, FS, Json, Platform, Repo, Time } from '@shared'
import { Buffer } from 'node:buffer'

type CdpResponse = {
  error?: { message: string }
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

type PendingCommand = {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
}

type ChromeTarget = {
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

type FrameTree = {
  childFrames?: FrameTree[]
  frame: { id: string; url: string }
}

type CdpEventListener = (params: unknown) => void

export type StudioCdpTransport = {
  send<Result = Record<string, never>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Result>
  subscribe(method: string, listener: CdpEventListener): () => void
  onEvent?(listener: (method: string, params: Record<string, unknown>) => void): void
}

export type StudioCdpBrowserEvent = {
  kind: 'console' | 'exception'
  level: string
  text: string
  timestamp?: number
}

/** StudioCdpRendererFingerprint records the browser facts that make two captures comparable. */
export type StudioCdpRendererFingerprint = {
  colorGamut: 'p3' | 'srgb' | 'unknown'
  deviceScaleFactor: number
  fontFingerprint: string
  jsVersion: string
  locale: string
  platform: string
  product: string
  protocolVersion: string
  timezone: string
  userAgent: string
}

type Point = {
  x: number
  y: number
}

type StudioCdpOptions = {
  artifactRoot?: string
  onProfileCreated?: (path: string) => Promise<void>
  startupTimeoutMs?: number
  useMockKeychain?: boolean
}

type StudioCdpKeyOptions = {
  alt?: boolean
  control?: boolean
  primary?: boolean
  shift?: boolean
}

const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
  'chromium-browser',
] as const

/** StudioCdp drives the real Studio browser shell for explicit slow smoke tests. */
/** BrowserConsoleEntry is one message the page logged, kept so a smoke run can gate on errors. */
export type BrowserConsoleEntry = {
  level: 'error' | 'warning'
  text: string
}

export class StudioCdp {
  private captureSequence = 0
  private readonly collectedBrowserEvents: StudioCdpBrowserEvent[] = []
  private readonly unsubscribeBrowserEvents: Array<() => void>
  private closed = false
  private readonly consoleEntries: BrowserConsoleEntry[] = []
  /** Each frame's own execution context, as opposed to the isolated worlds this harness creates. */
  private readonly frameWorlds = new Map<string, number>()

  private constructor(
    private readonly client: StudioCdpTransport,
    private readonly cleanup: () => Promise<void>,
    private readonly options: StudioCdpOptions = {},
  ) {
    this.unsubscribeBrowserEvents = [
      client.subscribe('Runtime.consoleAPICalled', params => this.collectConsoleEvent(params)),
      client.subscribe('Runtime.exceptionThrown', params => this.collectExceptionEvent(params)),
      // A frame's own execution context is only ever announced, never queryable, so it is tracked
      // from the moment the connection is configured.
      client.subscribe('Runtime.executionContextCreated', params => this.trackExecutionContext(params)),
      client.subscribe('Runtime.executionContextDestroyed', params => this.forgetExecutionContext(params)),
    ]
    // A blank Studio usually says why in the console and nowhere else, so every error and
    // uncaught exception is retained for the smoke run to fail on and for its artifacts.
    client.onEvent?.((method, params) => {
      const entry = consoleEntry(method, params)
      if (entry !== undefined) {
        this.consoleEntries.push(entry)
      }
    })
  }

  /** consoleErrors returns the page errors seen so far, in the order they were logged. */
  consoleErrors(): readonly BrowserConsoleEntry[] {
    return this.consoleEntries.filter(entry => entry.level === 'error')
  }

  static async launchChrome(options: StudioCdpOptions = {}): Promise<StudioCdp> {
    const chromePath = await findChromePath()
    const userDataRoot = await Repo.mkScratchDirOrHost('tao-studio-chrome-')
    const startupOutput: string[] = []
    const command = CLI.start(chromePath, {
      args: [
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataRoot}`,
        '--headless=new',
        '--disable-gpu',
        '--no-default-browser-check',
        '--no-first-run',
        ...(options.useMockKeychain ? ['--use-mock-keychain'] : []),
        'about:blank',
      ],
      onOutput(stream, chunk) {
        startupOutput.push(`${stream}: ${chunk.toString('utf8')}`)
      },
      stdio: 'pipe',
    })
    try {
      await options.onProfileCreated?.(userDataRoot)
      const port = await waitForActivePort(userDataRoot, command, startupOutput, options.startupTimeoutMs)
      const target = await waitForTarget(`http://127.0.0.1:${port}`)
      const client = await CdpClient.connect(requireWebSocketUrl(target))
      const studio = new StudioCdp(client, async () => {
        client.close()
        if (command.exitCode === null && command.signalCode === null) {
          command.kill('SIGTERM')
          await Promise.race([command.waitForClose(), Time.sleep(3_000)])
          if (command.exitCode === null && command.signalCode === null) {
            command.kill('SIGKILL')
            await command.waitForClose()
          }
        }
        await command.closeOutput()
        command.dispose()
        await FS.remove(userDataRoot)
      }, options)
      await configure(client)
      return studio
    } catch (error) {
      if (command.exitCode === null && command.signalCode === null) {
        command.kill('SIGKILL')
        await command.waitForClose()
      }
      await command.closeOutput()
      command.dispose()
      await FS.remove(userDataRoot)
      throw error
    }
  }

  static async attach(options: {
    artifactRoot?: string
    baseUrl: string
    targetUrlPrefix?: string
  }): Promise<StudioCdp> {
    const target = await waitForTarget(options.baseUrl, options.targetUrlPrefix)
    const client = await CdpClient.connect(requireWebSocketUrl(target))
    const studio = new StudioCdp(client, async () => client.close(), { artifactRoot: options.artifactRoot })
    await configure(client)
    return studio
  }

  static readonly testing = {
    create(client: StudioCdpTransport, options: StudioCdpOptions = {}): StudioCdp {
      return new StudioCdp(client, async () => {}, options)
    },
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      for (const unsubscribe of this.unsubscribeBrowserEvents) {
        unsubscribe()
      }
      await this.cleanup()
    }
  }

  async setViewport(width: number, height: number): Promise<void> {
    requirePositiveInteger(width, 'Studio browser viewport width')
    requirePositiveInteger(height, 'Studio browser viewport height')
    await this.client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height,
      mobile: false,
      width,
    })
  }

  async goto(url: string): Promise<void> {
    await this.client.send('Page.navigate', { url })
    await this.waitFor("document.readyState === 'interactive' || document.readyState === 'complete'", {
      timeoutMs: 20_000,
    })
  }

  async click(selector: string): Promise<void> {
    // Raw `Error`: this string is evaluated by Chrome through `Runtime.evaluate`, so it runs in the
    // page with no module system and no reach into Tao's error taxonomy.
    await this.evaluate(`(() => {
      const selector = ${JSON.stringify(selector)}
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element: ' + selector)
      element.scrollIntoView({ block: 'center', inline: 'center' })
      return true
    })()`)
    await this.clickAt(await this.elementCenter(selector, 'clickable'))
  }

  /** Clicks a viewport point with real mouse input, reaching whatever is drawn there, including inside a frame. */
  async clickAt(point: Point): Promise<void> {
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      type: 'mousePressed',
      ...point,
    })
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      type: 'mouseReleased',
      ...point,
    })
  }

  /** Sends two physical clicks at the same point so Chrome performs native double-click recognition. */
  async doubleClick(selector: string): Promise<void> {
    const point = await this.elementPointAtOffset(selector, { x: 12, y: 12 }, {
      element: 'double-click target',
      gesture: 'double-click',
    })
    for (const clickCount of [1, 2]) {
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'left',
        buttons: 1,
        clickCount,
        type: 'mousePressed',
        ...point,
      })
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'left',
        buttons: 0,
        clickCount,
        type: 'mouseReleased',
        ...point,
      })
    }
  }

  /** Clicks one point inside an element's box, for targets whose own center is not the live hit area. */
  async clickAtOffset(selector: string, offset: Point): Promise<void> {
    await this.clickAt(await this.elementPointAtOffset(selector, offset, { element: 'clickable', gesture: 'click' }))
  }

  /**
   * Resolves one viewport point inside an element's box, clamped to stay inside it.
   *
   * The element is scrolled into view with `nearest` rather than `center`: an element wider or
   * taller than its scroller — a long source line, a full-height divider — has its leading edge
   * pushed out of the visible box by centring, and the offset is measured from that leading edge.
   * The resolved point is then required to actually hit the element, because pointer input reaches
   * whatever is painted there and a silent miss is reported much later as an unrelated timeout.
   */
  private async elementPointAtOffset(
    selector: string,
    offset: Point,
    labels: { element: string; gesture: string },
  ): Promise<Point> {
    requireFiniteNumber(offset.x, `Studio browser horizontal ${labels.gesture} offset`)
    requireFiniteNumber(offset.y, `Studio browser vertical ${labels.gesture} offset`)
    // Raw `Error`: this string is evaluated by Chrome through `Runtime.evaluate`, so it runs in the
    // page with no module system and no reach into Tao's error taxonomy.
    return await this.evaluate<Point>(`(() => {
      const selector = ${JSON.stringify(selector)}
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('Missing ${labels.element} element: ' + selector)
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const rect = element.getBoundingClientRect()
      const x = rect.left + Math.max(1, Math.min(rect.width - 1, ${offset.x}))
      const y = rect.top + Math.max(1, Math.min(rect.height - 1, ${offset.y}))
      const covering = document.elementFromPoint(x, y)
      if (covering !== null && covering !== element && !element.contains(covering)) {
        const describe = node =>
          node.tagName.toLowerCase()
          + (typeof node.className === 'string' && node.className.length > 0 ? '.' + node.className.trim().split(/\\s+/u).join('.') : '')
        throw new Error(
          'Point ' + Math.round(x) + ',' + Math.round(y) + ' for ' + selector
            + ' lands on ' + describe(covering) + ', not the element',
        )
      }
      return { x, y }
    })()`)
  }

  async wheel(
    selector: string,
    delta: Point,
    options: { primary?: boolean } = {},
  ): Promise<void> {
    requireFiniteNumber(delta.x, 'Studio browser horizontal wheel delta')
    requireFiniteNumber(delta.y, 'Studio browser vertical wheel delta')
    const point = await this.elementCenter(selector, 'wheel target')
    const primaryModifier = options.primary === true
      ? await this.evaluate<boolean>("navigator.platform.toLowerCase().includes('mac')") ? 4 : 2
      : 0
    await this.client.send('Input.dispatchMouseEvent', {
      deltaX: delta.x,
      deltaY: delta.y,
      modifiers: primaryModifier,
      type: 'mouseWheel',
      ...point,
    })
  }

  async drag(fromSelector: string, toSelector: string, options: { steps?: number } = {}): Promise<void> {
    const steps = options.steps ?? 8
    requirePositiveInteger(steps, 'Studio browser drag steps')
    // Raw `Error`: this string is evaluated by Chrome through `Runtime.evaluate`, so it runs in the
    // page with no module system and no reach into Tao's error taxonomy.
    const points = await this.evaluate<{ end: Point; start: Point }>(`(() => {
      const center = (selector, label) => {
        const element = document.querySelector(selector)
        if (!(element instanceof HTMLElement)) throw new Error('Missing ' + label + ' element: ' + selector)
        const rect = element.getBoundingClientRect()
        // An element taller or wider than the window — a scrolled editor's content, a long list —
        // has its own centre outside the window, where pointer input never reaches it. The centre
        // of the part actually on screen is both inside the element and somewhere a person could
        // aim at.
        const left = Math.max(rect.left, 0)
        const right = Math.min(rect.right, window.innerWidth)
        const top = Math.max(rect.top, 0)
        const bottom = Math.min(rect.bottom, window.innerHeight)
        if (right <= left || bottom <= top) {
          throw new Error('No visible part of the ' + label + ' element: ' + selector)
        }
        return { x: (left + right) / 2, y: (top + bottom) / 2 }
      }
      return {
        start: center(${JSON.stringify(fromSelector)}, 'drag source'),
        end: center(${JSON.stringify(toSelector)}, 'drag target'),
      }
    })()`)
    await this.dispatchHtml5Drag(points.start, points.end, steps)
  }

  /**
   * `offset` starts the gesture at one point inside the element's box instead of its center, for a
   * target whose center is not its live grab area — a long, thin divider that a floating panel
   * covers over part of its length, say.
   */
  async dragBy(
    selector: string,
    delta: Point,
    options: { offset?: Point; steps?: number } = {},
  ): Promise<void> {
    const steps = options.steps ?? 8
    requirePositiveInteger(steps, 'Studio browser drag steps')
    requireFiniteNumber(delta.x, 'Studio browser horizontal drag delta')
    requireFiniteNumber(delta.y, 'Studio browser vertical drag delta')
    // A selector can resolve while its element remains outside a nested scroll viewport. Pointer
    // coordinates outside Chrome's visible surface do not reach that element, so establish the
    // same visibility precondition as click() before calculating the gesture coordinates.
    await this.evaluate(`(() => {
      const selector = ${JSON.stringify(selector)}
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('Missing drag source element: ' + selector)
      element.scrollIntoView({ block: 'center', inline: 'center' })
      return true
    })()`)
    const start = options.offset === undefined
      ? await this.elementCenter(selector, 'drag source')
      : await this.elementPointAtOffset(selector, options.offset, { element: 'drag source', gesture: 'drag' })
    await this.dispatchDrag(start, { x: start.x + delta.x, y: start.y + delta.y }, steps)
  }

  /**
   * Chrome never synthesizes HTML5 drag-and-drop from plain mouse events, so `dispatchDrag` can
   * move a pointer-driven divider but can never fire `dragstart`/`drop`. Real DnD needs drag
   * interception: the page's own `dragstart` builds the payload, Chrome hands it back through
   * `Input.dragIntercepted` instead of dropping it, and that payload is then replayed into
   * dragEnter/dragOver/drop over the target.
   */
  private async dispatchHtml5Drag(start: Point, end: Point, steps: number): Promise<void> {
    await this.client.send('Input.setInterceptDrags', { enabled: true })
    try {
      // Subscribe before the gesture: Chrome reports the interception while the moves are still
      // being dispatched, and the whole gesture must land before the drop replays it.
      const intercepted = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe()
          reject(new Errors.HostEnvironmentError('The page never started an HTML5 drag for this source element.'))
        }, 10_000)
        const unsubscribe = this.client.subscribe('Input.dragIntercepted', params => {
          clearTimeout(timer)
          unsubscribe()
          resolve((params as { data: Record<string, unknown> }).data)
        })
      })
      await this.beginDrag(start, end, steps)
      const data = await intercepted
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await this.client.send('Input.dispatchDragEvent', { data, type, ...end })
      }
    } finally {
      await this.client.send('Input.setInterceptDrags', { enabled: false })
    }
  }

  /** Presses at the source and moves far enough that Chrome recognises the gesture as a drag. */
  private async beginDrag(start: Point, end: Point, steps: number): Promise<void> {
    await this.client.send('Input.dispatchMouseEvent', { button: 'none', buttons: 0, type: 'mouseMoved', ...start })
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      type: 'mousePressed',
      ...start,
    })
    for (let step = 1; step <= steps; step += 1) {
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'left',
        buttons: 1,
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * step / steps,
        y: start.y + (end.y - start.y) * step / steps,
      })
    }
  }

  private async dispatchDrag(start: Point, end: Point, steps: number): Promise<void> {
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'none',
      buttons: 0,
      type: 'mouseMoved',
      ...start,
    })
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      type: 'mousePressed',
      ...start,
    })
    for (let step = 1; step <= steps; step += 1) {
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'left',
        buttons: 1,
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * step / steps,
        y: start.y + (end.y - start.y) * step / steps,
      })
    }
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      type: 'mouseReleased',
      ...end,
    })
  }

  async captureScreenshot(name: string): Promise<string> {
    const artifactRoot = this.options.artifactRoot
      ?? Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    if (artifactRoot === undefined || artifactRoot.length === 0) {
      Errors.throwUserInput(
        'Studio browser screenshots require TAO_STUDIO_SMOKE_ARTIFACT_ROOT.',
      )
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
      Errors.throwUserInput(
        'Studio browser screenshot names must use only letters, numbers, dots, underscores, or dashes.',
      )
    }
    const fileName = name.endsWith('.png') ? name : `${name}.png`
    const path = FS.resolvePath(`screenshots/${fileName}`, artifactRoot)
    const screenshot = await this.client.send<{ data: string }>('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png',
      fromSurface: true,
    })
    await FS.writeFile(path, Buffer.from(screenshot.data, 'base64'))
    return path
  }

  async captureScreenshotAt(path: string): Promise<string> {
    const screenshot = await this.client.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    await FS.writeFile(path, Buffer.from(screenshot.data, 'base64'))
    return path
  }

  /** Captures exactly one DOM element after fonts and two paint frames have settled. */
  async captureElementScreenshotAt(path: string, selector: string): Promise<string> {
    const captureToken = `tao-cdp-capture-${this.captureSequence++}`
    let previewFrameUrl: string | undefined
    // Raw `Error`: this expression executes in Chrome and cannot import Tao's error taxonomy.
    try {
      previewFrameUrl = await this.evaluate<string | undefined>(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)})
        const frame = element?.querySelector('iframe')
        return frame instanceof HTMLIFrameElement ? frame.src : undefined
      })()`)
      if (previewFrameUrl !== undefined) {
        await this.evaluateInFrame(
          previewFrameUrl,
          `(async () => {
          const captureToken = ${JSON.stringify(captureToken)}
          const freeze = document.createElement('style')
          freeze.dataset.taoCdpFrameFreeze = captureToken
          freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
          document.head.append(freeze)
          if (document.fonts?.ready !== undefined) await document.fonts.ready
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return true
        })()`,
        )
      }
      const clip = await this.evaluate<{
        height: number
        width: number
        x: number
        y: number
      }>(`(async () => {
      const selector = ${JSON.stringify(selector)}
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('Missing screenshot element: ' + selector)
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const captureToken = ${JSON.stringify(captureToken)}
      const freeze = document.createElement('style')
      freeze.dataset.taoCdpFreeze = captureToken
      freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
      document.head.append(freeze)
      if (document.fonts?.ready !== undefined) await document.fonts.ready
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const restoreProperty = '__taoCdpCaptureStyle_' + captureToken
      for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
        current[restoreProperty] = current.getAttribute('style')
        current.style.setProperty('overflow', 'visible', 'important')
        current.style.setProperty('contain', 'none', 'important')
        current.style.setProperty('clip', 'auto', 'important')
        current.style.setProperty('clip-path', 'none', 'important')
        if (current !== element) current.style.setProperty('transform', 'none', 'important')
      }
      element.dataset.taoCdpCapture = captureToken
      element.style.setProperty('position', 'fixed', 'important')
      element.style.setProperty('inset', '0 auto auto 0', 'important')
      element.style.setProperty('margin', '0', 'important')
      element.style.setProperty('max-width', 'none', 'important')
      element.style.setProperty('max-height', 'none', 'important')
      element.style.setProperty('transform', 'none', 'important')
      element.style.setProperty('z-index', '2147483647', 'important')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) throw new Error('Screenshot element has no visible area: ' + selector)
      return {
        height: rect.height,
        width: rect.width,
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
      }
    })()`)
      const screenshot = await this.client.send<{ data: string }>('Page.captureScreenshot', {
        captureBeyondViewport: true,
        clip: { ...clip, scale: 1 },
        format: 'png',
        fromSurface: true,
      })
      await FS.writeFile(path, Buffer.from(screenshot.data, 'base64'))
      return path
    } finally {
      const outerCleanup = this.evaluate(`(() => {
        const captureToken = ${JSON.stringify(captureToken)}
        document.querySelector('style[data-tao-cdp-freeze="' + captureToken + '"]')?.remove()
        const element = document.querySelector('[data-tao-cdp-capture="' + captureToken + '"]')
        if (!(element instanceof HTMLElement)) return false
        const restoreProperty = '__taoCdpCaptureStyle_' + captureToken
        for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
          const original = current[restoreProperty]
          if (original === null) current.removeAttribute('style')
          else if (typeof original === 'string') current.setAttribute('style', original)
          delete current[restoreProperty]
        }
        delete element.dataset.taoCdpCapture
        return true
      })()`)
      const frameCleanup = previewFrameUrl === undefined
        ? Promise.resolve()
        : this.evaluateInFrame(
          previewFrameUrl,
          `(() => {
          document.querySelector('style[data-tao-cdp-frame-freeze="${captureToken}"]')?.remove()
          return true
        })()`,
        ).catch(() => undefined)
      const [outerResult] = await Promise.allSettled([outerCleanup, frameCleanup])
      if (outerResult.status === 'rejected') {
        throw outerResult.reason
      }
    }
  }

  /** Returns the stable browser identity recorded beside visual-review evidence. */
  async rendererFingerprint(): Promise<StudioCdpRendererFingerprint> {
    let lastContextFailure: Error | undefined
    const fingerprint = await Time.pollUntil(async () => {
      try {
        return await this.readRendererFingerprint()
      } catch (error) {
        if (!isTransientExecutionContextFailure(error)) {
          throw error
        }
        lastContextFailure = Errors.asError(error)
        return undefined
      }
    }, { intervalMs: 100, timeoutMs: 10_000 })
    if (fingerprint !== undefined) {
      return fingerprint
    }
    if (lastContextFailure !== undefined) {
      throw lastContextFailure
    }
    Errors.throwHostEnvironment('Timed out while reading the Studio renderer fingerprint.')
  }

  private async readRendererFingerprint(): Promise<StudioCdpRendererFingerprint> {
    const browser = await this.client.send<{
      jsVersion?: string
      product?: string
      protocolVersion?: string
      userAgent?: string
    }>('Browser.getVersion')
    const page = await this.evaluate<{
      colorGamut: 'p3' | 'srgb' | 'unknown'
      deviceScaleFactor: number
      fontFingerprint: string
      locale: string
      platform: string
      timezone: string
    }>(`(async () => {
      if (document.fonts?.ready !== undefined) await document.fonts.ready
      return {
      colorGamut: matchMedia('(color-gamut: p3)').matches ? 'p3' : matchMedia('(color-gamut: srgb)').matches ? 'srgb' : 'unknown',
      deviceScaleFactor: window.devicePixelRatio,
      fontFingerprint: JSON.stringify(document.fonts === undefined ? [] : [...document.fonts].map(font => [font.family, font.style, font.weight, font.stretch, font.status]).sort()),
      locale: navigator.language,
      platform: navigator.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
      }
    })()`)
    const tree = await this.client.send<{ frameTree: FrameTree }>('Page.getFrameTree')
    const frameFingerprints: Array<readonly [string, string]> = []
    for (const frame of childFrames(tree.frameTree)) {
      const world = await this.client.send<{ executionContextId: number }>('Page.createIsolatedWorld', {
        frameId: frame.id,
        grantUniveralAccess: true,
        worldName: 'tao-studio-review-fingerprint',
      })
      const fingerprint = await this.evaluateInContext<string>(
        `(async () => {
        if (document.fonts?.ready !== undefined) await document.fonts.ready
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 128
        const context = canvas.getContext('2d')
        const sample = 'Tao AaBb 0123 → fi Ω'
        if (context !== null) {
          context.fillStyle = '#000'
          for (const [index, font] of ['16px system-ui','16px sans-serif','16px serif','16px monospace'].entries()) {
            context.font = font
            context.fillText(sample, 4, 22 + index * 28)
          }
        }
        return JSON.stringify({
          fonts: document.fonts === undefined ? [] : [...document.fonts].map(font => [font.family, font.style, font.weight, font.stretch, font.status]).sort(),
          glyphs: canvas.toDataURL(),
        })
      })()`,
        world.executionContextId,
      )
      frameFingerprints.push([frame.url, fingerprint])
    }
    const fontFingerprint = frameFingerprints.length === 0
      ? page.fontFingerprint
      : Platform.sha256Hex(JSON.stringify([
        page.fontFingerprint,
        ...frameFingerprints.sort(([left], [right]) => left.localeCompare(right)),
      ]))
    return {
      colorGamut: page.colorGamut,
      deviceScaleFactor: page.deviceScaleFactor,
      fontFingerprint,
      jsVersion: browser.jsVersion ?? 'unknown',
      locale: page.locale,
      platform: page.platform,
      product: browser.product ?? 'unknown',
      protocolVersion: browser.protocolVersion ?? 'unknown',
      timezone: page.timezone,
      userAgent: browser.userAgent ?? 'unknown',
    }
  }

  browserEvents(): readonly StudioCdpBrowserEvent[] {
    return this.collectedBrowserEvents.map(event => ({ ...event }))
  }

  browserFailures(): readonly StudioCdpBrowserEvent[] {
    return this.browserEvents().filter(event =>
      event.kind === 'exception' || event.level === 'error' || event.level === 'assert'
    )
  }

  clearBrowserEvents(): void {
    this.collectedBrowserEvents.length = 0
  }

  async clickInFrame(urlPrefix: string, selector: string): Promise<void> {
    // Raw `Error`: this string is evaluated by Chrome through `Runtime.evaluate`, so it runs in the
    // page with no module system and no reach into Tao's error taxonomy.
    await this.evaluateInFrame(
      urlPrefix,
      `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) throw new Error('Missing frame element: ${selector}')
      element.click()
      return true
    })()`,
    )
  }

  async insertText(value: string): Promise<void> {
    await this.client.send('Input.insertText', { text: value })
  }

  async pressShortcut(key: string): Promise<void> {
    await this.pressKey(key, { primary: true })
  }

  /** Holds a physical key across a pointer gesture, releasing it even when the gesture fails. */
  async withKeyHeld(key: string, gesture: () => Promise<void>): Promise<void> {
    const params = chromeKeyDetails(key)
    await this.client.send('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
    try {
      await gesture()
    } finally {
      await this.client.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
    }
  }

  /** pressKey sends the same physical key events Chrome receives from a keyboard. */
  async pressKey(key: string, options: StudioCdpKeyOptions = {}): Promise<void> {
    const primaryModifier = options.primary === true
      ? await this.evaluate<boolean>("navigator.platform.toLowerCase().includes('mac')") ? 4 : 2
      : 0
    const details = chromeKeyDetails(key)
    const modifiers = primaryModifier
      | (options.alt === true ? 1 : 0)
      | (options.control === true ? 2 : 0)
      | (options.shift === true ? 8 : 0)
    const params = { ...details, modifiers }
    await this.client.send('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
    await this.client.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  }

  async evaluate<Result>(expression: string): Promise<Result> {
    return await this.evaluateInContext(expression)
  }

  /**
   * Evaluates in a frame, by default in an isolated world: it shares the frame's DOM but not its
   * JavaScript globals, which keeps the harness from disturbing the page it observes. `world: 'page'`
   * runs in the frame's own context instead, for the few probes that have to read or write a global
   * the page itself defines; an isolated world would write to a different `window` and the page
   * would never see it.
   */
  async evaluateInFrame<Result>(
    urlPrefix: string,
    expression: string,
    options: { world?: 'isolated' | 'page' } = {},
  ): Promise<Result> {
    let lastContextFailure: Error | undefined
    const contextId = await Time.pollUntil(async () => {
      try {
        const tree = await this.client.send<{ frameTree: FrameTree }>('Page.getFrameTree')
        const frameId = findFrameId(tree.frameTree, urlPrefix)
        if (frameId === undefined) {
          return undefined
        }
        if (options.world === 'page') {
          return this.frameWorlds.get(frameId)
        }
        const world = await this.client.send<{ executionContextId: number }>('Page.createIsolatedWorld', {
          frameId,
          grantUniveralAccess: true,
          worldName: 'tao-studio-smoke',
        })
        return world.executionContextId
      } catch (error) {
        if (!isTransientExecutionContextFailure(error)) {
          throw error
        }
        lastContextFailure = Errors.asError(error)
        return undefined
      }
    }, { intervalMs: 100, timeoutMs: 10_000 })
    if (contextId === undefined) {
      if (lastContextFailure !== undefined) {
        throw lastContextFailure
      }
      Errors.throwHostEnvironment(`Studio preview frame is missing: ${urlPrefix}`)
    }
    // Do not retry after Runtime.evaluate begins: the page action may already have dispatched even
    // when navigation destroys its response context. Repeating it could duplicate a user action.
    return await this.evaluateInContext(expression, contextId)
  }

  async waitFor(expression: string, options: { timeoutMs?: number } = {}): Promise<void> {
    let last: unknown
    const satisfied = await Time.pollUntil(async () => {
      try {
        last = await this.evaluate(expression)
        return !!last
      } catch (error) {
        if (!isTransientExecutionContextFailure(error)) {
          throw error
        }
        last = Errors.messageOf(error)
        return false
      }
    }, { intervalMs: 100, timeoutMs: options.timeoutMs ?? 15_000 })
    if (satisfied) {
      return
    }
    Errors.throwHostEnvironment(`Timed out waiting for browser expression: ${expression}; last=${String(last)}`)
  }

  async waitForInFrame(
    urlPrefix: string,
    expression: string,
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    let last: unknown
    const satisfied = await Time.pollUntil(async () => {
      try {
        last = await this.evaluateInFrame(urlPrefix, expression)
        return !!last
      } catch (error) {
        if (!isTransientExecutionContextFailure(error)) {
          throw error
        }
        last = Errors.messageOf(error)
        return false
      }
    }, { intervalMs: 100, timeoutMs: options.timeoutMs ?? 15_000 })
    if (satisfied) {
      return
    }
    Errors.throwHostEnvironment(
      `Timed out waiting for browser frame expression: ${expression}; last=${String(last)}`,
    )
  }

  private async evaluateInContext<Result>(expression: string, contextId?: number): Promise<Result> {
    const response = await this.client.send<{
      exceptionDetails?: unknown
      result: { value?: unknown }
    }>('Runtime.evaluate', {
      awaitPromise: true,
      contextId,
      expression,
      returnByValue: true,
    })
    if (response.exceptionDetails !== undefined) {
      Errors.throwHostEnvironment(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`)
    }
    return response.result.value as Result
  }

  private async elementCenter(selector: string, label: string): Promise<Point> {
    // Raw `Error`: this string is evaluated by Chrome through `Runtime.evaluate`, so it runs in the
    // page with no module system and no reach into Tao's error taxonomy.
    return await this.evaluate<Point>(`(() => {
      const selector = ${JSON.stringify(selector)}
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error('Missing ${label} element: ' + selector)
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
  }

  /** Moves the physical pointer without pressing, including over embedded app content. */
  async hover(selector: string): Promise<void> {
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'none',
      buttons: 0,
      type: 'mouseMoved',
      ...await this.elementCenter(selector, 'hover target'),
    })
  }

  private collectConsoleEvent(params: unknown): void {
    if (!Json.isRecord(params)) {
      return
    }
    const args = Array.isArray(params['args']) ? params['args'] : []
    this.collectedBrowserEvents.push(withTimestamp({
      kind: 'console',
      level: typeof params['type'] === 'string' ? params['type'] : 'log',
      text: args.map(formatRemoteObject).join(' '),
    }, params['timestamp']))
  }

  private trackExecutionContext(params: unknown): void {
    if (!Json.isRecord(params) || !Json.isRecord(params['context'])) {
      return
    }
    const context = params['context']
    const auxData = Json.isRecord(context['auxData']) ? context['auxData'] : undefined
    const frameId = auxData?.['frameId']
    if (auxData?.['isDefault'] !== true || typeof frameId !== 'string' || typeof context['id'] !== 'number') {
      return
    }
    this.frameWorlds.set(frameId, context['id'])
  }

  private forgetExecutionContext(params: unknown): void {
    if (!Json.isRecord(params) || typeof params['executionContextId'] !== 'number') {
      return
    }
    for (const [frameId, contextId] of this.frameWorlds) {
      if (contextId === params['executionContextId']) {
        this.frameWorlds.delete(frameId)
      }
    }
  }

  private collectExceptionEvent(params: unknown): void {
    if (!Json.isRecord(params) || !Json.isRecord(params['exceptionDetails'])) {
      return
    }
    const details = params['exceptionDetails']
    const exception = Json.isRecord(details['exception']) ? details['exception'] : undefined
    const description = exception === undefined ? undefined : exception['description']
    const text = typeof description === 'string'
      ? description
      : typeof details['text'] === 'string'
      ? details['text']
      : 'Uncaught browser exception'
    this.collectedBrowserEvents.push(withTimestamp({
      kind: 'exception',
      level: 'error',
      text,
    }, details['timestamp']))
  }
}

function chromeKeyDetails(key: string): { code: string; key: string; windowsVirtualKeyCode: number } {
  const named = chromeNamedKeys[key]
  if (named !== undefined) {
    return { ...named, key }
  }
  if (/^[a-z]$/iu.test(key)) {
    const upper = key.toUpperCase()
    return { code: `Key${upper}`, key, windowsVirtualKeyCode: upper.charCodeAt(0) }
  }
  if (/^[0-9]$/u.test(key)) {
    return { code: `Digit${key}`, key, windowsVirtualKeyCode: key.charCodeAt(0) }
  }
  Errors.throwUserInput(`Studio browser key is unsupported: ${JSON.stringify(key)}`)
}

const chromeNamedKeys: Readonly<Record<string, { code: string; windowsVirtualKeyCode: number }>> = {
  ' ': { code: 'Space', windowsVirtualKeyCode: 32 },
  '+': { code: 'Equal', windowsVirtualKeyCode: 187 },
  '-': { code: 'Minus', windowsVirtualKeyCode: 189 },
  '.': { code: 'Period', windowsVirtualKeyCode: 190 },
  '/': { code: 'Slash', windowsVirtualKeyCode: 191 },
  '=': { code: 'Equal', windowsVirtualKeyCode: 187 },
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
  End: { code: 'End', windowsVirtualKeyCode: 35 },
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13 },
  Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
  Home: { code: 'Home', windowsVirtualKeyCode: 36 },
  Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
}

class CdpClient implements StudioCdpTransport {
  private readonly listeners = new Map<string, Set<CdpEventListener>>()
  private nextId = 1
  private readonly eventListeners: ((method: string, params: Record<string, unknown>) => void)[] = []
  private readonly pending = new Map<number, PendingCommand>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => this.handleMessage(String(event.data)))
    socket.addEventListener('close', () => this.rejectAll('Chrome DevTools connection closed.'))
    socket.addEventListener('error', () => this.rejectAll('Chrome DevTools connection failed.'))
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }
      const onOpen = (): void => {
        cleanup()
        resolve()
      }
      const onError = (): void => {
        cleanup()
        reject(new Errors.HostEnvironmentError('Could not connect to Chrome DevTools.'))
      }
      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })
    return new CdpClient(socket)
  }

  async send<Result = Record<string, never>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { reject, resolve }))
    this.socket.send(JSON.stringify({ id, method, params }))
    return await result as Result
  }

  close(): void {
    this.socket.close()
    this.rejectAll('Chrome DevTools connection closed.')
    this.listeners.clear()
  }

  subscribe(method: string, listener: CdpEventListener): () => void {
    const listeners = this.listeners.get(method) ?? new Set<CdpEventListener>()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(method)
      }
    }
  }

  /** onEvent receives every DevTools event, which is how console errors are noticed at all. */
  onEvent(listener: (method: string, params: Record<string, unknown>) => void): void {
    this.eventListeners.push(listener)
  }

  private handleMessage(raw: string): void {
    const response = JSON.parse(raw) as CdpResponse
    if (response.id === undefined) {
      if (response.method !== undefined) {
        for (const listener of this.listeners.get(response.method) ?? []) {
          listener(response.params)
        }
        for (const listener of this.eventListeners) {
          listener(response.method, response.params ?? {})
        }
      }
      return
    }
    const pending = this.pending.get(response.id)
    if (pending === undefined) {
      return
    }
    this.pending.delete(response.id)
    if (response.error !== undefined) {
      pending.reject(new Errors.HostEnvironmentError(response.error.message))
    } else {
      pending.resolve(response.result ?? {})
    }
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Errors.HostEnvironmentError(message))
    }
    this.pending.clear()
  }
}

/** consoleEntry reads the two DevTools events that carry a page-side failure. */
function consoleEntry(method: string, params: Record<string, unknown>): BrowserConsoleEntry | undefined {
  if (method === 'Runtime.exceptionThrown') {
    const details = params['exceptionDetails'] as { exception?: { description?: string }; text?: string } | undefined
    return { level: 'error', text: details?.exception?.description ?? details?.text ?? 'Uncaught exception' }
  }
  if (method !== 'Runtime.consoleAPICalled') {
    return undefined
  }
  const type = params['type']
  if (type !== 'error' && type !== 'warning') {
    return undefined
  }
  const args = (params['args'] as { description?: string; value?: unknown }[] | undefined) ?? []
  return { level: type, text: args.map(argument => argument.description ?? String(argument.value ?? '')).join(' ') }
}

async function configure(client: StudioCdpTransport): Promise<void> {
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    deviceScaleFactor: 1,
    height: 900,
    mobile: false,
    width: 1440,
  })
  await client.send('Page.bringToFront')
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    Errors.throwUserInput(`${label} must be a positive integer.`)
  }
}

function requireFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    Errors.throwUserInput(`${label} must be finite.`)
  }
}

function isTransientExecutionContextFailure(error: unknown): boolean {
  const message = Errors.messageOf(error)
  return message.includes('Execution context was destroyed')
    || message.includes('Cannot find context with specified id')
}

function formatRemoteObject(value: unknown): string {
  if (!Json.isRecord(value)) {
    return String(value)
  }
  if ('value' in value) {
    const remoteValue = value['value']
    if (typeof remoteValue === 'string') {
      return remoteValue
    }
    return JSON.stringify(remoteValue) ?? String(remoteValue)
  }
  if (typeof value['unserializableValue'] === 'string') {
    return value['unserializableValue']
  }
  if (typeof value['description'] === 'string') {
    return value['description']
  }
  return typeof value['type'] === 'string' ? value['type'] : 'unknown'
}

function withTimestamp(
  event: StudioCdpBrowserEvent,
  timestamp: unknown,
): StudioCdpBrowserEvent {
  return typeof timestamp === 'number' ? { ...event, timestamp } : event
}

async function findChromePath(): Promise<string> {
  const configured = Platform.runtimeProcess.env['TAO_STUDIO_CHROME_PATH']
    ?? Platform.runtimeProcess.env['CHROME_PATH']
  if (configured !== undefined && await FS.isFile(configured)) {
    return configured
  }
  for (const candidate of chromeCandidates) {
    if (candidate.includes('/') ? await FS.isFile(candidate) : await CLI.commandExists(candidate)) {
      return candidate
    }
  }
  Errors.throwUserInput('Studio smoke requires Chrome or Chromium; set TAO_STUDIO_CHROME_PATH.')
}

async function waitForActivePort(
  userDataRoot: string,
  command: CLI.StartedCommand,
  startupOutput: readonly string[] = [],
  timeoutMs = 20_000,
): Promise<number> {
  const path = FS.resolvePath('DevToolsActivePort', userDataRoot)
  const port = await Time.pollUntil(async () => {
    if (await FS.isFile(path)) {
      const candidate = Number((await FS.readText(path)).split(/\r?\n/)[0])
      if (Number.isInteger(candidate) && candidate > 0) {
        return candidate
      }
    }
    if (command.exitCode !== null || command.signalCode !== null || command.error !== undefined) {
      const diagnostic = startupOutput.join('').trim().slice(-4_000)
      Errors.throwHostEnvironment(
        `Chrome exited before exposing DevTools (exit ${command.exitCode ?? 'none'}, signal ${
          command.signalCode ?? 'none'
        })${command.error === undefined ? '' : `: ${command.error.message}`}${
          diagnostic === '' ? '' : `\n${diagnostic}`
        }`,
      )
    }
    return undefined
  }, { intervalMs: 100, timeoutMs })
  if (port !== undefined) {
    return port
  }
  const diagnostic = startupOutput.join('').trim().slice(-4_000)
  Errors.throwHostEnvironment(
    `Timed out waiting for Chrome DevToolsActivePort.${diagnostic === '' ? '' : `\n${diagnostic}`}`,
  )
}

async function waitForTarget(baseUrl: string, urlPrefix?: string): Promise<ChromeTarget> {
  const target = await Time.pollUntil(async () => {
    try {
      const response = await fetch(`${baseUrl}/json/list`)
      if (!response.ok) {
        return undefined
      }
      const targets = await response.json() as ChromeTarget[]
      return targets.find(candidate =>
        candidate.webSocketDebuggerUrl !== undefined
        && (candidate.type === undefined || candidate.type === 'page')
        && (urlPrefix === undefined || candidate.url?.startsWith(urlPrefix) === true)
      )
    } catch {
      // Browser is still starting.
      return undefined
    }
  }, { intervalMs: 100, timeoutMs: 20_000 })
  if (target !== undefined) {
    return target
  }
  Errors.throwHostEnvironment(`Timed out waiting for a browser target at ${baseUrl}.`)
}

function requireWebSocketUrl(target: ChromeTarget): string {
  if (target.webSocketDebuggerUrl === undefined) {
    Errors.throwHostEnvironment('Browser target has no DevTools WebSocket URL.')
  }
  return target.webSocketDebuggerUrl
}

function findFrameId(tree: FrameTree, urlPrefix: string): string | undefined {
  if (tree.frame.url.startsWith(urlPrefix)) {
    return tree.frame.id
  }
  for (const child of tree.childFrames ?? []) {
    const match = findFrameId(child, urlPrefix)
    if (match !== undefined) {
      return match
    }
  }
  return undefined
}

function childFrames(tree: FrameTree): readonly FrameTree['frame'][] {
  return (tree.childFrames ?? []).flatMap(child => [child.frame, ...childFrames(child)])
}
