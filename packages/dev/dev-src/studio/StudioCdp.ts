import { CLI, Errors, FS, Platform, Time } from '@shared'
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

type Point = {
  x: number
  y: number
}

type StudioCdpOptions = {
  artifactRoot?: string
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
  private readonly collectedBrowserEvents: StudioCdpBrowserEvent[] = []
  private readonly unsubscribeBrowserEvents: Array<() => void>
  private closed = false
  private readonly consoleEntries: BrowserConsoleEntry[] = []

  private constructor(
    private readonly client: StudioCdpTransport,
    private readonly cleanup: () => Promise<void>,
    private readonly options: StudioCdpOptions = {},
  ) {
    this.unsubscribeBrowserEvents = [
      client.subscribe('Runtime.consoleAPICalled', params => this.collectConsoleEvent(params)),
      client.subscribe('Runtime.exceptionThrown', params => this.collectExceptionEvent(params)),
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
    const userDataRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-chrome-', FS.tmpdir()))
    const startupOutput: string[] = []
    const command = CLI.start(chromePath, {
      args: [
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataRoot}`,
        '--headless=new',
        '--disable-gpu',
        '--no-default-browser-check',
        '--no-first-run',
        'about:blank',
      ],
      onOutput(stream, chunk) {
        startupOutput.push(`${stream}: ${chunk.toString('utf8')}`)
      },
      stdio: 'pipe',
    })
    try {
      const port = await waitForActivePort(userDataRoot, command, startupOutput)
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
    const point = await this.elementCenter(selector, 'clickable')
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
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      return {
        start: center(${JSON.stringify(fromSelector)}, 'drag source'),
        end: center(${JSON.stringify(toSelector)}, 'drag target'),
      }
    })()`)
    await this.dispatchHtml5Drag(points.start, points.end, steps)
  }

  async dragBy(selector: string, delta: Point, options: { steps?: number } = {}): Promise<void> {
    const steps = options.steps ?? 8
    requirePositiveInteger(steps, 'Studio browser drag steps')
    requireFiniteNumber(delta.x, 'Studio browser horizontal drag delta')
    requireFiniteNumber(delta.y, 'Studio browser vertical drag delta')
    const start = await this.elementCenter(selector, 'drag source')
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
          reject(new Error('The page never started an HTML5 drag for this source element.'))
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
      throw new Errors.UserInputError(
        'Studio browser screenshots require TAO_STUDIO_SMOKE_ARTIFACT_ROOT.',
      )
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
      throw new Errors.UserInputError(
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
    const isMac = await this.evaluate<boolean>("navigator.platform.toLowerCase().includes('mac')")
    const code = `Key${key.toUpperCase()}`
    const modifiers = isMac ? 4 : 2
    const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0)
    const params = { code, key, modifiers, windowsVirtualKeyCode }
    await this.client.send('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
    await this.client.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  }

  async evaluate<Result>(expression: string): Promise<Result> {
    return await this.evaluateInContext(expression)
  }

  async evaluateInFrame<Result>(urlPrefix: string, expression: string): Promise<Result> {
    const tree = await this.client.send<{ frameTree: FrameTree }>('Page.getFrameTree')
    const frameId = findFrameId(tree.frameTree, urlPrefix)
    if (frameId === undefined) {
      Errors.throwHostEnvironment(`Studio preview frame is missing: ${urlPrefix}`)
    }
    const world = await this.client.send<{ executionContextId: number }>('Page.createIsolatedWorld', {
      frameId,
      grantUniveralAccess: true,
      worldName: 'tao-studio-smoke',
    })
    return await this.evaluateInContext(expression, world.executionContextId)
  }

  async waitFor(expression: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000)
    let last: unknown
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression)
        if (last) {
          return
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
      }
      await Time.sleep(100)
    }
    Errors.throwHostEnvironment(`Timed out waiting for browser expression: ${expression}; last=${String(last)}`)
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

  private collectConsoleEvent(params: unknown): void {
    if (!isRecord(params)) {
      return
    }
    const args = Array.isArray(params['args']) ? params['args'] : []
    this.collectedBrowserEvents.push(withTimestamp({
      kind: 'console',
      level: typeof params['type'] === 'string' ? params['type'] : 'log',
      text: args.map(formatRemoteObject).join(' '),
    }, params['timestamp']))
  }

  private collectExceptionEvent(params: unknown): void {
    if (!isRecord(params) || !isRecord(params['exceptionDetails'])) {
      return
    }
    const details = params['exceptionDetails']
    const exception = isRecord(details['exception']) ? details['exception'] : undefined
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
        reject(new Error('Could not connect to Chrome DevTools.'))
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
      pending.reject(new Error(response.error.message))
    } else {
      pending.resolve(response.result ?? {})
    }
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message))
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
    throw new Errors.UserInputError(`${label} must be a positive integer.`)
  }
}

function requireFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Errors.UserInputError(`${label} must be finite.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatRemoteObject(value: unknown): string {
  if (!isRecord(value)) {
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
    if (candidate.includes('/') ? await FS.isFile(candidate) : await executableOnPath(candidate)) {
      return candidate
    }
  }
  throw new Errors.UserInputError('Studio smoke requires Chrome or Chromium; set TAO_STUDIO_CHROME_PATH.')
}

async function executableOnPath(command: string): Promise<boolean> {
  return (await CLI.run('which', { args: [command], stdio: 'pipe' })).exitCode === 0
}

async function waitForActivePort(
  userDataRoot: string,
  command: CLI.StartedCommand,
  startupOutput: readonly string[] = [],
): Promise<number> {
  const path = FS.resolvePath('DevToolsActivePort', userDataRoot)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await FS.isFile(path)) {
      const port = Number((await FS.readText(path)).split(/\r?\n/)[0])
      if (Number.isInteger(port) && port > 0) {
        return port
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
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment('Timed out waiting for Chrome DevToolsActivePort.')
}

async function waitForTarget(baseUrl: string, urlPrefix?: string): Promise<ChromeTarget> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/json/list`)
      if (response.ok) {
        const targets = await response.json() as ChromeTarget[]
        const target = targets.find(candidate =>
          candidate.webSocketDebuggerUrl !== undefined
          && (candidate.type === undefined || candidate.type === 'page')
          && (urlPrefix === undefined || candidate.url?.startsWith(urlPrefix) === true)
        )
        if (target !== undefined) {
          return target
        }
      }
    } catch {
      // Browser is still starting.
    }
    await Time.sleep(100)
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
