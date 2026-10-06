import { Errors, Json, Time } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { companionLaunchUrl } from '../prebuilt-host/CompanionIdentity'
import { ExpoConfig, type ExpoPlatform, type ExpoSessionConfig } from './expo-config'
import { Ports } from './Ports'

/** OpenEndpointResponse is the JSON an Expo CLI `/_expo/open` endpoint answers, where one exists. */
export type OpenEndpointResponse = {
  appId?: unknown
  platform?: unknown
  runtime?: unknown
  url?: unknown
}

/** ExpoOpenProbe is one `/_expo/open` answer: the parsed body when it was JSON, plus the raw status. */
export type ExpoOpenProbe = {
  body?: OpenEndpointResponse
  status: number
  text: string
}

/** ExpoFetch is the callable part of `fetch`, so a test can hand in a scripted one. */
export type ExpoFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** ExpoRuntimeLinkOptions selects which runtime `/_expo/link` should redirect to. */
export type ExpoRuntimeLinkOptions = {
  /** Ask for the development-client (custom runtime) link instead of the Expo Go link. */
  devClient?: boolean
  fetch?: ExpoFetch
  platform: Exclude<ExpoPlatform, 'web'>
}

export type ExpoMetroSession = ReturnType<typeof createExpoMetro>

/** createExpoMetro binds Metro status, reload, and URL helpers to one Expo session. */
export function createExpoMetro(config: ExpoSessionConfig) {
  return {
    endpointUrl,
    ensureMetroPortFree: () => ensureMetroPortFree(config),
    expoLink: (platform: Exclude<ExpoPlatform, 'web'>) => expoLink(config, platform),
    expoOpenEndpoint: (platform: ExpoPlatform) => expoOpenEndpoint(config, platform),
    formatOpenedRuntime,
    reloadExpoApps: (shouldStop?: () => boolean) => reloadExpoApps(config, shouldStop),
    waitForMetro: (shouldStop?: () => boolean) => waitForMetro(config, shouldStop),
  }
}

/** ExpoMetro is the fixed default Metro session used by explicit single-session commands. */
export const ExpoMetro = createExpoMetro(ExpoConfig)

/** reloadExpoApps asks Metro to reload connected Expo runtimes. */
async function reloadExpoApps(config: ExpoSessionConfig, shouldStop: () => boolean = () => false): Promise<void> {
  if (!await waitForMetro(config, shouldStop) || shouldStop()) {
    Errors.throwUserInput('Expo reload was cancelled because the dev loop is stopping.')
  }
  const response = await fetch(`${config.EXPO_ORIGIN}/message?method=reload`)
  if (response.ok) {
    DevLoopOutput.logDevLoop('dev', 'sent Expo reload')
  } else {
    Errors.throwHostEnvironment(`Expo reload failed: ${response.status} ${await response.text()}`)
  }
}

/** ensureMetroPortFree fails when another Metro server already owns the dev-loop port. */
async function ensureMetroPortFree(config: ExpoSessionConfig): Promise<void> {
  if (await Ports.ensureFree(config.EXPO_PORT)) {
    return
  }

  try {
    const response = await fetch(config.EXPO_STATUS_URL)
    Errors.throwUserInput(
      `Expo Metro already appears to be running at ${config.EXPO_STATUS_URL} with status ${response.status}. Stop it before starting ./dev.`,
    )
  } catch (error) {
    if (error instanceof Errors.UserInputError) {
      throw error
    }
  }
}

/** waitForMetro waits until the Expo Metro status endpoint is ready. */
async function waitForMetro(
  config: ExpoSessionConfig,
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  const running = await Time.pollUntil(async () => {
    try {
      const response = await fetch(config.EXPO_STATUS_URL)
      return response.ok && (await response.text()).includes('running')
    } catch {
      return false // Metro is still starting.
    }
  }, { intervalMs: config.EXPO_START_POLL_MS, stop: shouldStop, timeoutMs: config.EXPO_START_TIMEOUT_MS })
  if (running) {
    return true
  }
  if (shouldStop()) {
    return false
  }
  Errors.throwUserInput(`Expo Metro did not start at ${config.EXPO_STATUS_URL}.`)
}

async function expoOpenEndpoint(
  config: ExpoSessionConfig,
  platform: ExpoPlatform,
): Promise<OpenEndpointResponse | undefined> {
  try {
    const probe = await fetchExpoOpenEndpoint(config.EXPO_ORIGIN, platform)
    const ok = probe.status >= 200 && probe.status < 300
    if (ok && probe.body !== undefined) {
      return probe.body
    }

    if (!ok && probe.status !== 404) {
      DevLoopOutput.logDevLoop(
        'dev',
        `could not resolve Expo URL for ${platform}: ${probe.status} ${probe.text}`,
        'warn',
      )
    }
  } catch (error) {
    DevLoopOutput.logDevLoop(
      'dev',
      `could not resolve Expo URL for ${platform}: ${Errors.formatForUser(error)}`,
      'warn',
    )
  }
  return undefined
}

/**
 * fetchExpoOpenEndpoint asks Metro's `/_expo/open` for a runtime URL. Expo CLI versions that do not
 * serve the endpoint answer 404; callers treat that as absent and use `expoRuntimeLink`.
 * A network failure rejects, so a caller can tell "Metro is down" from "Expo has no such route".
 */
export async function fetchExpoOpenEndpoint(
  origin: string,
  platform: ExpoPlatform,
  fetchImpl: ExpoFetch = fetch,
): Promise<ExpoOpenProbe> {
  const response = await fetchImpl(`${origin}/_expo/open?platform=${platform}`, {
    method: 'GET',
    headers: { Origin: origin },
  })
  const text = await response.text()
  const body = parseResponseJson(response.headers.get('content-type'), text)
  return { body: isOpenEndpointResponse(body) ? body : undefined, status: response.status, text }
}

function endpointUrl(body: OpenEndpointResponse | undefined): string | undefined {
  return typeof body?.url === 'string' ? body.url : undefined
}

function formatOpenedRuntime(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('runtime' in body)) {
    return ''
  }
  return ` (${String((body as { runtime?: unknown }).runtime)})`
}

async function expoLink(
  config: ExpoSessionConfig,
  platform: Exclude<ExpoPlatform, 'web'>,
): Promise<string | undefined> {
  return await expoRuntimeLink(config.EXPO_ORIGIN, { platform })
}

/**
 * expoRuntimeLink follows Metro's `/_expo/link` redirect to a runtime deep link: the Expo Go link by
 * default, or the development-client link when `devClient` is set. Undefined when Expo answers
 * without a redirect (404: no dev-client scheme, or an unknown platform); rejects when Metro is down.
 */
export async function expoRuntimeLink(origin: string, options: ExpoRuntimeLinkOptions): Promise<string | undefined> {
  const fetchImpl = options.fetch ?? fetch
  const choice = options.devClient === true ? '&choice=expo-dev-client' : ''
  const response = await fetchImpl(`${origin}/_expo/link?platform=${options.platform}${choice}`, {
    redirect: 'manual',
  })
  if (response.status >= 300 && response.status < 400) {
    const link = response.headers.get('location') ?? undefined
    return options.devClient === true && link !== undefined ? companionLaunchUrl(link) : link
  }
  return undefined
}

function parseResponseJson(contentType: string | null, text: string): unknown {
  if (!contentType?.includes('application/json')) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isOpenEndpointResponse(body: unknown): body is OpenEndpointResponse {
  return Json.isRecord(body) && 'url' in body
}
