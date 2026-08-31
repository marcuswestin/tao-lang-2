import { CLI, Errors, FS, Platform, Time } from '@shared'

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
  private closed = false
  private readonly consoleEntries: BrowserConsoleEntry[] = []

  private constructor(
    private readonly client: CdpClient,
    private readonly cleanup: () => Promise<void>,
  ) {
    // A blank Studio usually says why in the console and nowhere else, so every error and
    // uncaught exception is retained for the smoke run to fail on and for its artifacts.
    client.onEvent((method, params) => {
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

  /** captureScreenshot writes a PNG of the current page, creating parent directories. */
  async captureScreenshot(path: string): Promise<string> {
    const result = await this.client.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    await FS.writeFile(path, Buffer.from(result.data, 'base64'))
    return path
  }

  static async launchChrome(): Promise<StudioCdp> {
    const chromePath = await findChromePath()
    const userDataRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-chrome-', FS.tmpdir()))
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
      stdio: 'pipe',
    })
    try {
      const port = await waitForActivePort(userDataRoot, command)
      const target = await waitForTarget(`http://127.0.0.1:${port}`)
      const client = await CdpClient.connect(requireWebSocketUrl(target))
      await configure(client)
      return new StudioCdp(client, async () => {
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
      })
    } catch (error) {
      command.kill('SIGKILL')
      await command.closeOutput()
      command.dispose()
      await FS.remove(userDataRoot)
      throw error
    }
  }

  static async attach(options: { baseUrl: string; targetUrlPrefix?: string }): Promise<StudioCdp> {
    const target = await waitForTarget(options.baseUrl, options.targetUrlPrefix)
    const client = await CdpClient.connect(requireWebSocketUrl(target))
    await configure(client)
    return new StudioCdp(client, async () => client.close())
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      await this.cleanup()
    }
  }

  async goto(url: string): Promise<void> {
    await this.client.send('Page.navigate', { url })
    await this.waitFor("document.readyState === 'interactive' || document.readyState === 'complete'", {
      timeoutMs: 20_000,
    })
  }

  async click(selector: string): Promise<void> {
    const point = await this.evaluate<{ x: number; y: number }>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element: ${selector}')
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
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

  async clickInFrame(urlPrefix: string, selector: string): Promise<void> {
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
      throw new Error(`Studio preview frame is missing: ${urlPrefix}`)
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
    throw new Error(`Timed out waiting for browser expression: ${expression}; last=${String(last)}`)
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
      throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`)
    }
    return response.result.value as Result
  }
}

class CdpClient {
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
  }

  /** onEvent receives every DevTools event, which is how console errors are noticed at all. */
  onEvent(listener: (method: string, params: Record<string, unknown>) => void): void {
    this.eventListeners.push(listener)
  }

  private handleMessage(raw: string): void {
    const response = JSON.parse(raw) as CdpResponse
    if (response.id === undefined) {
      if (typeof response.method === 'string') {
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
  const text = args.map(argument => argument.description ?? String(argument.value ?? '')).join(' ')
  return { level: type, text }
}

async function configure(client: CdpClient): Promise<void> {
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

async function waitForActivePort(userDataRoot: string, command: CLI.StartedCommand): Promise<number> {
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
      throw new Error(`Chrome exited before exposing DevTools: ${command.error?.message ?? command.exitCode}`)
    }
    await Time.sleep(100)
  }
  throw new Error('Timed out waiting for Chrome DevToolsActivePort.')
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
  throw new Error(`Timed out waiting for a browser target at ${baseUrl}.`)
}

function requireWebSocketUrl(target: ChromeTarget): string {
  if (target.webSocketDebuggerUrl === undefined) {
    throw new Error('Browser target has no DevTools WebSocket URL.')
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
