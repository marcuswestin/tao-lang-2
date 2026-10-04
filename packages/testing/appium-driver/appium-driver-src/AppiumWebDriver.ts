import { HostControlError } from '@host-control'
import { Errors, Time } from '@shared'
import { devLoopMobileIdentityId } from '@shared/DevLoopControl'

export type AppiumCapabilityValue = boolean | number | string | Readonly<Record<string, boolean | number | string>>
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
  /** Native element capture; adapters without this capability must refuse target screenshots. */
  screenshot?: () => Promise<Uint8Array>
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
  findAll: (locator: AppiumLocator, responseByteLimit?: number) => Promise<readonly AppiumElement[]>
  id: string
  screenshot: () => Promise<Uint8Array>
  terminateApplication: (appId: string) => Promise<void>
  readManagedRuntimeIdentity?: (
    platform: 'ios' | 'android',
    expectedAppId: string,
  ) => Promise<Readonly<{ appId: string; label: string }>>
  captureManagedHandshakeDiagnostics?: (
    options: Readonly<{
      expectedAppId: string
      signal: AbortSignal
      assertCurrent: () => Promise<void>
    }>,
  ) => Promise<Readonly<{ source: string; screenshot: Uint8Array }>>
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
  /** Only the fixed read-only foreground-app and mounted-marker handshake uses this role. */
  purpose?: 'managed-identity' | 'managed-diagnostic'
  diagnosticSignal?: AbortSignal
  responseByteLimit?: number
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
    /** Managed actions and deletion have independent cancellation budgets. */
    signal?: AbortSignal
    cleanupSignal?: AbortSignal
    requestTimeoutMs?: number
    /** Creating a native driver may build and launch its runner before returning a UUID. */
    sessionCreationTimeoutMs?: number
    assertRequest?: (request: AppiumHttpRequest) => Promise<void>
  }>,
  dependencies: {
    timeoutSignal?: (milliseconds: number) => AbortSignal
    now?: () => number
  } = {},
): AppiumHttpTransport {
  const serverUrl = normalizeServerUrl(options.serverUrl)
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  return {
    async request(request) {
      await options.assertRequest?.(request)
      const cleanup = request.method === 'DELETE' && /^\/session\/[^/]+$/u.test(request.path)
      const ownerSignal = cleanup ? options.cleanupSignal : request.diagnosticSignal === undefined
        ? options.signal
        : options.signal === undefined
        ? request.diagnosticSignal
        : AbortSignal.any([options.signal, request.diagnosticSignal])
      const sessionCreation = request.method === 'POST' && request.path === '/session'
      const timeoutMs = sessionCreation
        ? options.sessionCreationTimeoutMs ?? options.requestTimeoutMs
        : options.requestTimeoutMs
      const budget = timeoutMs === undefined
        ? undefined
        : (dependencies.timeoutSignal ?? AbortSignal.timeout)(timeoutMs)
      const signal = ownerSignal === undefined
        ? budget
        : budget === undefined
        ? ownerSignal
        : AbortSignal.any([ownerSignal, budget])
      const now = dependencies.now ?? Time.nowMs
      const startedAt = now()
      let stage: 'fetch' | 'response' | 'parse' = 'fetch'
      try {
        const response = await fetcher(serverUrl + request.path, {
          method: request.method,
          // The mobile ambient fetch type requires a non-null onabort handler.
          ...(signal === undefined ? {} : { signal: Object.assign(signal, { onabort: () => {} }) }),
          ...(request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body), headers: { 'content-type': 'application/json' } }),
        })
        stage = 'response'
        const text = await boundedResponseText(response, request.responseByteLimit)
        stage = 'parse'
        return { body: text.length === 0 ? {} : parseJson(text, request), status: response.status }
      } catch (error) {
        throw new HostControlError(
          'host',
          stage === 'fetch'
            ? `Appium request ${request.method} ${request.path} could not reach its local server.`
            : error instanceof HostControlError
            ? error.message
            : `Appium response ${request.method} ${request.path} did not complete.`,
          {
            cause: error,
            transportFailure: {
              stage,
              elapsedMs: Math.max(0, Math.round(now() - startedAt)),
              timeoutMs,
              operation: sessionCreation ? 'session-creation' : cleanup ? 'session-deletion' : 'ordinary',
              cancellation: ownerSignal?.aborted ? 'external' : budget?.aborted ? 'timeout' : 'none',
            },
          },
        )
      }
    },
  }
}

/** createAppiumWebDriverClient translates the reusable W3C subset into typed sessions and elements. */
export function createAppiumWebDriverClient(transport: AppiumHttpTransport): AppiumSessionFactory {
  return new AppiumWebDriverClient(transport)
}

function androidMarkerXPath(appId: string): string {
  if (!/^[A-Za-z0-9_.]+$/u.test(appId)) {
    protocolError('Managed Android package identity is invalid.')
  }
  return `//*[@package='${appId}' and starts-with(@resource-id, '${devLoopMobileIdentityId}.')]`
}

/** Only these fixed identity observations may precede mounted-runtime proof. */
export function isManagedRuntimeIdentityRequest(
  request: AppiumHttpRequest,
  platform: 'ios' | 'android',
  appId: string,
): boolean {
  if (request.purpose !== 'managed-identity' || !/^\/session\/[^/]+\//u.test(request.path)) {
    return false
  }
  const suffix = request.path.replace(/^\/session\/[^/]+\//u, '')
  const body = record(request.body)
  if (request.method === 'GET') {
    return request.body === undefined && (platform === 'android' && suffix === 'appium/device/current_package'
      || new RegExp(`^element/[^/]+/attribute/${platform === 'android' ? '(?:resource-id|package)' : 'name'}$`, 'u')
        .test(suffix))
  }
  if (request.method !== 'POST' || body === undefined) {
    return false
  }
  if (platform === 'android' && suffix === 'appium/settings') {
    const settings = record(body['settings'])
    return Object.keys(body).length === 1 && settings !== undefined && Object.keys(settings).length === 2
      && settings['enableMultiWindows'] === true && settings['allowInvisibleElements'] === true
  }
  if (platform === 'ios' && suffix === 'execute/sync') {
    return Object.keys(body).length === 2 && body['script'] === 'mobile: activeAppInfo'
      && Array.isArray(body['args']) && body['args'].length === 0
  }
  return suffix === (platform === 'android' ? 'elements' : 'element') && Object.keys(body).length === 2
    && body['using'] === 'xpath'
    && body['value'] === (platform === 'android'
        ? androidMarkerXPath(appId)
        : `//*[starts-with(@name, '${devLoopMobileIdentityId}.')]`)
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

  async findAll(locator: AppiumLocator, responseByteLimit?: number): Promise<readonly AppiumElement[]> {
    const value = await requestValue<unknown>(this.#transport, {
      method: 'POST',
      path: this.#path('elements'),
      body: locator,
      responseByteLimit,
    })
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

  async readManagedRuntimeIdentity(
    platform: 'ios' | 'android',
    expectedAppId: string,
  ): Promise<Readonly<{ appId: string; label: string }>> {
    const request = async (method: AppiumHttpRequest['method'], suffix: string, body?: unknown): Promise<unknown> =>
      await requestValue(this.#transport, {
        method,
        path: this.#path(suffix),
        body,
        purpose: 'managed-identity',
        responseByteLimit: 32_768,
      })
    const active = platform === 'android'
      ? await request('GET', 'appium/device/current_package')
      : await request('POST', 'execute/sync', { script: 'mobile: activeAppInfo', args: [] })
    const appId = (platform === 'android' ? string(active) : string(record(active)?.['bundleId']))
      ?? protocolError('Appium did not identify the foreground application.')
    let marker: unknown
    if (platform === 'android') {
      if (appId !== expectedAppId) {
        protocolError('The foreground Android package differs from the managed runtime.')
      }
      await request('POST', 'appium/settings', { settings: { enableMultiWindows: true, allowInvisibleElements: true } })
      const markers = await request('POST', 'elements', { using: 'xpath', value: androidMarkerXPath(expectedAppId) })
      if (!Array.isArray(markers) || markers.length !== 1) {
        protocolError('Appium did not identify exactly one mounted managed marker.')
      }
      marker = markers[0]
    } else {
      marker = await request('POST', 'element', {
        using: 'xpath',
        value: `//*[starts-with(@name, '${devLoopMobileIdentityId}.')]`,
      })
    }
    const id = string(record(marker)?.['element-6066-11e4-a52e-4f735466cecf'])
      ?? string(record(marker)?.['ELEMENT']) ?? protocolError('Appium did not identify the mounted managed marker.')
    if (
      platform === 'android'
      && await request('GET', `element/${encodeURIComponent(id)}/attribute/package`) !== expectedAppId
    ) {
      protocolError('The mounted managed marker belongs to a different Android package.')
    }
    const identifier = string(
      await request(
        'GET',
        `element/${encodeURIComponent(id)}/attribute/${platform === 'ios' ? 'name' : 'resource-id'}`,
      ),
    )
      ?? protocolError('Appium did not report the mounted managed identity identifier.')
    const prefix = `${devLoopMobileIdentityId}.`
    if (!identifier.startsWith(prefix) || Buffer.byteLength(identifier, 'utf8') > 16_384) {
      protocolError('Appium returned an unrelated managed identity identifier.')
    }
    let label: string
    try {
      label = decodeURIComponent(identifier.slice(prefix.length))
    } catch {
      return protocolError('Appium returned malformed managed identity encoding.')
    }
    if (Buffer.byteLength(label, 'utf8') > 8_192) {
      protocolError('The mounted managed identity payload is oversized.')
    }
    if (platform === 'android' && await request('GET', 'appium/device/current_package') !== expectedAppId) {
      protocolError('The foreground Android package changed during managed identity observation.')
    }
    return { appId, label }
  }

  async captureManagedHandshakeDiagnostics(
    options: Readonly<{
      expectedAppId: string
      signal: AbortSignal
      assertCurrent: () => Promise<void>
    }>,
  ): Promise<Readonly<{ source: string; screenshot: Uint8Array }>> {
    const assertCurrent = async () => {
      options.signal.throwIfAborted()
      await options.assertCurrent()
      options.signal.throwIfAborted()
    }
    const read = async (suffix: 'appium/device/current_package' | 'source' | 'screenshot', limit: number) => {
      await assertCurrent()
      const value = await requestValue<unknown>(this.#transport, {
        method: 'GET',
        path: this.#path(suffix),
        purpose: 'managed-diagnostic',
        diagnosticSignal: options.signal,
        responseByteLimit: limit,
      })
      await assertCurrent()
      return value
    }
    const assertApp = async () => {
      if (await read('appium/device/current_package', 16_384) !== options.expectedAppId) {
        protocolError('Managed handshake diagnostics refused an unrelated foreground application.')
      }
    }
    await assertApp()
    const source = string(await read('source', 4 * 1024 * 1024))
      ?? protocolError('Appium did not report diagnostic XML.')
    if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024) {
      protocolError('Managed handshake diagnostic XML exceeded its private capture limit.')
    }
    await assertApp()
    const encoded = string(await read('screenshot', 14 * 1024 * 1024))
      ?? protocolError('Appium did not report a diagnostic screenshot.')
    if (encoded.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) {
      protocolError('Managed handshake diagnostic screenshot exceeded its private capture limit.')
    }
    const screenshot = Uint8Array.from(Buffer.from(encoded, 'base64'))
    if (screenshot.byteLength > 10 * 1024 * 1024) {
      protocolError('Managed handshake diagnostic screenshot exceeded its private capture limit.')
    }
    await assertApp()
    return { source, screenshot }
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

  async screenshot(): Promise<Uint8Array> {
    const value = await requestValue<unknown>(this.#transport, {
      method: 'GET',
      path: `/session/${encodeURIComponent(this.#sessionId)}/element/${encodeURIComponent(this.id)}/screenshot`,
      // The encoded 10 MiB PNG plus its W3C JSON envelope fits inside this fixed transport cap.
      responseByteLimit: 14 * 1024 * 1024,
    })
    const encoded = string(value) ?? protocolError('Appium did not report an element screenshot.')
    if (encoded.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) {
      protocolError('Appium element screenshot exceeded its private capture limit.')
    }
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
      protocolError('Appium returned invalid element screenshot encoding.')
    }
    const png = Buffer.from(encoded, 'base64')
    if (png.byteLength > 10 * 1024 * 1024) {
      protocolError('Appium element screenshot exceeded its private capture limit.')
    }
    if (
      png.toString('base64') !== encoded || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      protocolError('Appium returned a non-PNG element screenshot.')
    }
    return Uint8Array.from(png)
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

async function boundedResponseText(response: Response, limit: number | undefined): Promise<string> {
  if (limit === undefined) {
    return await response.text()
  }
  if (response.body === null) {
    return ''
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        return text + decoder.decode()
      }
      bytes += chunk.value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        protocolError('Managed handshake diagnostic HTTP response exceeded its private capture limit.')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
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
