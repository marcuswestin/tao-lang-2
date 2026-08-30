import { Errors, Time } from '@shared'
import { DevLoopTUI } from '../DevLoopTUI'
import { ExpoConfig, type ExpoPlatform, type ExpoSessionConfig } from './expo-config'
import { Ports } from './Ports'

type OpenEndpointResponse = {
  appId?: unknown
  platform?: unknown
  runtime?: unknown
  url?: unknown
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
    reloadExpoApps: () => reloadExpoApps(config),
    waitForMetro: (shouldStop?: () => boolean) => waitForMetro(config, shouldStop),
  }
}

/** ExpoMetro is the ordinary dev loop's port-8081 Metro session. */
export const ExpoMetro = createExpoMetro(ExpoConfig)

/** reloadExpoApps asks Metro to reload connected Expo runtimes. */
async function reloadExpoApps(config: ExpoSessionConfig): Promise<void> {
  await waitForMetro(config)
  const response = await fetch(`${config.EXPO_ORIGIN}/message?method=reload`)
  if (response.ok) {
    DevLoopTUI.logDevLoop('dev', 'sent Expo reload')
  } else {
    DevLoopTUI.logDevLoop('dev', `Expo reload failed: ${response.status} ${await response.text()}`, 'warn')
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
  const deadline = Date.now() + config.EXPO_START_TIMEOUT_MS
  while (!shouldStop() && Date.now() < deadline) {
    try {
      const response = await fetch(config.EXPO_STATUS_URL)
      if (response.ok && (await response.text()).includes('running')) {
        return true
      }
    } catch {
      // Metro is still starting.
    }
    await Time.sleep(config.EXPO_START_POLL_MS)
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
  const url = `${config.EXPO_OPEN_URL}?platform=${platform}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Origin: config.EXPO_ORIGIN },
    })
    const responseText = await response.text()
    const body = parseResponseJson(response.headers.get('content-type'), responseText)
    if (response.ok && isOpenEndpointResponse(body)) {
      return body
    }

    if (!response.ok && response.status !== 404) {
      DevLoopTUI.logDevLoop(
        'dev',
        `could not resolve Expo URL for ${platform}: ${response.status} ${responseText}`,
        'warn',
      )
    }
  } catch (error) {
    DevLoopTUI.logDevLoop('dev', `could not resolve Expo URL for ${platform}: ${Errors.formatForUser(error)}`, 'warn')
  }
  return undefined
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
  const response = await fetch(`${config.EXPO_ORIGIN}/_expo/link?platform=${platform}`, { redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    return response.headers.get('location') ?? undefined
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
  return typeof body === 'object' && body !== null && 'url' in body
}
