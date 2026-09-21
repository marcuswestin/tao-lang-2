import { HostControlError } from '@host-control'
import { Errors } from '@shared'

export type AppiumCapabilityValue = boolean | number | string
export type AppiumCapabilities = Readonly<Record<string, AppiumCapabilityValue>>
export type AppiumLocator = Readonly<{ using: string; value: string }>

export type AppiumElementRect = Readonly<{ height: number; width: number; x: number; y: number }>
export type AppiumElementObservation = Readonly<{
  accessibilityLabel?: string
  rect?: AppiumElementRect
  text?: string
  visible: boolean
}>

export type AppiumElement = Readonly<{
  click: () => Promise<void>
  find: (locator: AppiumLocator) => Promise<AppiumElement>
  findAll: (locator: AppiumLocator) => Promise<readonly AppiumElement[]>
  getAttribute: (name: string) => Promise<string | undefined>
  getRect: () => Promise<AppiumElementRect | undefined>
  getText: () => Promise<string | undefined>
  id: string
  observe: () => Promise<AppiumElementObservation>
  sendKeys: (text: string) => Promise<void>
  visible: () => Promise<boolean>
}>

export type AppiumActionSequence = Readonly<Record<string, unknown>>

export type AppiumSession = Readonly<{
  actions: (actions: readonly AppiumActionSequence[]) => Promise<void>
  activateApplication: (appId: string) => Promise<void>
  delete: () => Promise<void>
  dismissAlert?: () => Promise<void>
  executeScript: <T = unknown>(script: string, args?: readonly unknown[]) => Promise<T>
  find: (locator: AppiumLocator) => Promise<AppiumElement>
  findAll: (locator: AppiumLocator) => Promise<readonly AppiumElement[]>
  id: string
  screenshot: () => Promise<Uint8Array>
  terminateApplication: (appId: string) => Promise<void>
}>

/** AppiumSessionFactory is the typed seam used by each platform adapter to create its W3C session. */
export type AppiumSessionFactory = Readonly<{
  createSession: (capabilities: AppiumCapabilities) => Promise<AppiumSession>
}>

export type AppiumHttpTransport = Readonly<{
  request: (request: AppiumHttpRequest) => Promise<AppiumHttpResponse>
}>

export type AppiumHttpRequest = Readonly<{
  body?: unknown
  method: 'DELETE' | 'GET' | 'POST'
  path: string
}>

export type AppiumHttpResponse = Readonly<{
  body: unknown
  status: number
}>

/** AppiumNoSuchElementError makes an expected absent lookup distinct from a broken WebDriver transport. */
export class AppiumNoSuchElementError extends HostControlError {
  readonly kind = 'no-such-element'

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('host', message, details)
  }
}

/** AppiumNoSuchAlertError lets platform adapters make idempotent alert cleanup explicit. */
export class AppiumNoSuchAlertError extends HostControlError {
  readonly kind = 'no-such-alert'

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('host', message, details)
  }
}

/** createAppiumHttpTransport binds an injected fetch implementation to an Appium HTTP server. */
export function createAppiumHttpTransport(
  options: Readonly<{
    fetch?: (input: string, init?: RequestInit) => Promise<Response>
    serverUrl: string
  }>,
): AppiumHttpTransport {
  const serverUrl = normalizeServerUrl(options.serverUrl)
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  return {
    async request(request) {
      let response: Response
      try {
        response = await fetcher(serverUrl + request.path, {
          method: request.method,
          ...(request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body), headers: { 'content-type': 'application/json' } }),
        })
      } catch (error) {
        throw new HostControlError(
          'host',
          `Appium request ${request.method} ${request.path} could not reach its local server.`,
          { cause: error },
        )
      }
      const text = await response.text()
      return { body: text.length === 0 ? {} : parseJson(text, request), status: response.status }
    },
  }
}

/** createAppiumWebDriverClient translates the reusable W3C subset into typed sessions and elements. */
export function createAppiumWebDriverClient(transport: AppiumHttpTransport): AppiumSessionFactory {
  return new AppiumWebDriverClient(transport)
}

class AppiumWebDriverClient implements AppiumSessionFactory {
  readonly #transport: AppiumHttpTransport

  constructor(transport: AppiumHttpTransport) {
    this.#transport = transport
  }

  async createSession(capabilities: AppiumCapabilities): Promise<AppiumSession> {
    const value = await requestValue<unknown>(this.#transport, {
      body: { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } },
      method: 'POST',
      path: '/session',
    })
    const session = record(value)
    const sessionId = string(session?.['sessionId'])
    if (sessionId === undefined) {
      protocolError('Appium created a session without a W3C session identifier.')
    }
    return new AppiumWebDriverSession(this.#transport, sessionId)
  }
}

class AppiumWebDriverSession implements AppiumSession {
  readonly #transport: AppiumHttpTransport
  readonly id: string

  constructor(transport: AppiumHttpTransport, id: string) {
    this.#transport = transport
    this.id = id
  }

  async actions(actions: readonly AppiumActionSequence[]): Promise<void> {
    await this.#request('POST', 'actions', { actions })
  }

  async activateApplication(appId: string): Promise<void> {
    await this.#request('POST', 'appium/device/activate_app', { bundleId: appId })
  }

  async delete(): Promise<void> {
    await requestValue(this.#transport, { method: 'DELETE', path: this.#path() })
  }

  async dismissAlert(): Promise<void> {
    await this.#request('POST', 'alert/dismiss', {})
  }

  async executeScript<T = unknown>(script: string, args: readonly unknown[] = []): Promise<T> {
    return await this.#request<T>('POST', 'execute/sync', { args, script })
  }

  async find(locator: AppiumLocator): Promise<AppiumElement> {
    return this.#element(await this.#request('POST', 'element', locator))
  }

  async findAll(locator: AppiumLocator): Promise<readonly AppiumElement[]> {
    const value = await this.#request<unknown>('POST', 'elements', locator)
    if (!Array.isArray(value)) {
      protocolError('Appium returned a non-array element collection.')
    }
    return value.map(element => this.#element(element))
  }

  async screenshot(): Promise<Uint8Array> {
    const value = await this.#request<unknown>('GET', 'screenshot')
    if (typeof value !== 'string') {
      protocolError('Appium returned a non-string screenshot payload.')
    }
    return Uint8Array.from(Buffer.from(value, 'base64'))
  }

  async terminateApplication(appId: string): Promise<void> {
    await this.#request('POST', 'appium/device/terminate_app', { bundleId: appId })
  }

  #element(value: unknown): AppiumElement {
    const id = string(record(value)?.['element-6066-11e4-a52e-4f735466cecf']) ?? string(record(value)?.['ELEMENT'])
    if (id === undefined) {
      protocolError('Appium returned an element without a W3C element identifier.')
    }
    return new AppiumWebDriverElement(this.#transport, this.id, id)
  }

  async #request<T = unknown>(method: AppiumHttpRequest['method'], suffix: string, body?: unknown): Promise<T> {
    return await requestValue<T>(this.#transport, {
      ...(body === undefined ? {} : { body }),
      method,
      path: this.#path(suffix),
    })
  }

  #path(suffix = ''): string {
    return `/session/${encodeURIComponent(this.id)}${suffix.length === 0 ? '' : `/${suffix}`}`
  }
}

class AppiumWebDriverElement implements AppiumElement {
  readonly #sessionId: string
  readonly #transport: AppiumHttpTransport
  readonly id: string

  constructor(
    transport: AppiumHttpTransport,
    sessionId: string,
    id: string,
  ) {
    this.#transport = transport
    this.#sessionId = sessionId
    this.id = id
  }

  async click(): Promise<void> {
    await this.#request('POST', 'click', {})
  }
  async find(locator: AppiumLocator): Promise<AppiumElement> {
    return this.#element(await this.#request('POST', 'element', locator))
  }
  async findAll(locator: AppiumLocator): Promise<readonly AppiumElement[]> {
    const value = await this.#request<unknown>('POST', 'elements', locator)
    if (!Array.isArray(value)) {
      protocolError('Appium returned a non-array element collection.')
    }
    return value.map(element => this.#element(element))
  }
  async getAttribute(name: string): Promise<string | undefined> {
    return string(await this.#request('GET', `attribute/${encodeURIComponent(name)}`))
  }
  async getRect(): Promise<AppiumElementRect | undefined> {
    return rect(await this.#request('GET', 'rect'))
  }
  async getText(): Promise<string | undefined> {
    return string(await this.#request('GET', 'text'))
  }
  async sendKeys(text: string): Promise<void> {
    await this.#request('POST', 'value', { text, value: [...text] })
  }

  async observe(): Promise<AppiumElementObservation> {
    const [accessibilityLabel, rect, text, visible] = await Promise.all([
      this.getAttribute('label'),
      this.getRect(),
      this.getText(),
      this.visible(),
    ])
    return {
      ...(accessibilityLabel === undefined ? {} : { accessibilityLabel }),
      ...(rect === undefined ? {} : { rect }),
      ...(text === undefined ? {} : { text }),
      visible,
    }
  }

  async visible(): Promise<boolean> {
    const value = await this.#request<unknown>('GET', 'displayed')
    if (typeof value !== 'boolean') {
      protocolError('Appium returned a non-boolean displayed state.')
    }
    return value
  }

  async #request<T = unknown>(method: AppiumHttpRequest['method'], suffix: string, body?: unknown): Promise<T> {
    return await requestValue<T>(this.#transport, {
      ...(body === undefined ? {} : { body }),
      method,
      path: `/session/${encodeURIComponent(this.#sessionId)}/element/${encodeURIComponent(this.id)}/${suffix}`,
    })
  }

  #element(value: unknown): AppiumElement {
    const id = string(record(value)?.['element-6066-11e4-a52e-4f735466cecf']) ?? string(record(value)?.['ELEMENT'])
    if (id === undefined) {
      protocolError('Appium returned an element without a W3C element identifier.')
    }
    return new AppiumWebDriverElement(this.#transport, this.#sessionId, id)
  }
}

async function requestValue<T>(transport: AppiumHttpTransport, request: AppiumHttpRequest): Promise<T> {
  let response: AppiumHttpResponse
  try {
    response = await transport.request(request)
  } catch (error) {
    if (error instanceof HostControlError) {
      throw error
    }
    throw new HostControlError('host', `Appium request ${request.method} ${request.path} did not complete.`, {
      cause: error,
    })
  }
  const payload = record(response.body)
  if (response.status < 200 || response.status >= 300) {
    const value = record(payload?.['value'])
    const message = string(value?.['message']) ?? `HTTP ${response.status}`
    if (value?.['error'] === 'no such element') {
      throw new AppiumNoSuchElementError(
        `Appium request ${request.method} ${request.path} found no matching element: ${message}`,
        {
          status: response.status,
        },
      )
    }
    if (value?.['error'] === 'no such alert') {
      throw new AppiumNoSuchAlertError(`Appium request ${request.method} ${request.path} found no alert: ${message}`, {
        status: response.status,
      })
    }
    throw new HostControlError('host', `Appium request ${request.method} ${request.path} failed: ${message}`, {
      details: { status: response.status },
    })
  }
  if (payload === undefined || !('value' in payload)) {
    protocolError(`Appium request ${request.method} ${request.path} returned no W3C value.`)
  }
  return payload['value'] as T
}

function normalizeServerUrl(input: string): string {
  let url: URL | undefined
  try {
    url = new URL(input)
  } catch {
    Errors.throwUserInput('Appium serverUrl must be a valid HTTP or HTTPS URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    Errors.throwUserInput('Appium serverUrl must use HTTP or HTTPS.')
  }
  return url.toString().replace(/\/$/u, '')
}

function parseJson(text: string, request: AppiumHttpRequest): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new HostControlError('host', `Appium request ${request.method} ${request.path} returned invalid JSON.`, {
      cause: error,
    })
  }
}

function protocolError(message: string): never {
  throw new HostControlError('host', message)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function rect(value: unknown): AppiumElementRect | undefined {
  const candidate = record(value)
  const height = candidate?.['height']
  const width = candidate?.['width']
  const x = candidate?.['x']
  const y = candidate?.['y']
  return [height, width, x, y].every(part => typeof part === 'number' && Number.isFinite(part))
    ? { height: height as number, width: width as number, x: x as number, y: y as number }
    : undefined
}
