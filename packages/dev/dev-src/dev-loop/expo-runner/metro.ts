import { Errors, Time } from '@shared'
import { TUI } from '../TUI'
import { ExpoConfig, type ExpoPlatform } from './expo-config'
import { Ports } from './Ports'

type OpenEndpointResponse = {
  appId?: unknown
  platform?: unknown
  runtime?: unknown
  url?: unknown
}

/** ExpoMetro groups Metro status, reload, and Expo URL endpoint helpers. */
export const ExpoMetro = {
  endpointUrl,
  ensureMetroPortFree,
  expoLink,
  expoOpenEndpoint,
  formatOpenedRuntime,
  reloadExpoApps,
  waitForMetro,
}

/** reloadExpoApps asks Metro to reload connected Expo runtimes. */
async function reloadExpoApps(): Promise<void> {
  await waitForMetro()
  const response = await fetch(`${ExpoConfig.EXPO_ORIGIN}/message?method=reload`)
  if (response.ok) {
    TUI.logDevLoop('dev', 'sent Expo reload')
  } else {
    TUI.logDevLoop('dev', `Expo reload failed: ${response.status} ${await response.text()}`, 'warn')
  }
}

/** ensureMetroPortFree fails when another Metro server already owns the dev-loop port. */
async function ensureMetroPortFree(): Promise<void> {
  if (await Ports.ensureFree(ExpoConfig.EXPO_PORT)) {
    return
  }

  try {
    const response = await fetch(ExpoConfig.EXPO_STATUS_URL)
    Errors.throwUserInput(
      `Expo Metro already appears to be running at ${ExpoConfig.EXPO_STATUS_URL} with status ${response.status}. Stop it before starting ./dev.`,
    )
  } catch (error) {
    if (error instanceof Errors.UserInputError) {
      throw error
    }
  }
}

/** waitForMetro waits until the Expo Metro status endpoint is ready. */
async function waitForMetro(shouldStop: () => boolean = () => false): Promise<boolean> {
  const deadline = Date.now() + ExpoConfig.EXPO_START_TIMEOUT_MS
  while (!shouldStop() && Date.now() < deadline) {
    try {
      const response = await fetch(ExpoConfig.EXPO_STATUS_URL)
      if (response.ok && (await response.text()).includes('running')) {
        return true
      }
    } catch {
      // Metro is still starting.
    }
    await Time.sleep(ExpoConfig.EXPO_START_POLL_MS)
  }
  if (shouldStop()) {
    return false
  }
  Errors.throwUserInput(`Expo Metro did not start at ${ExpoConfig.EXPO_STATUS_URL}.`)
}

async function expoOpenEndpoint(platform: ExpoPlatform): Promise<OpenEndpointResponse | undefined> {
  const url = `${ExpoConfig.EXPO_OPEN_URL}?platform=${platform}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Origin: ExpoConfig.EXPO_ORIGIN },
    })
    const responseText = await response.text()
    const body = parseResponseJson(response.headers.get('content-type'), responseText)
    if (response.ok && isOpenEndpointResponse(body)) {
      return body
    }

    if (!response.ok && response.status !== 404) {
      TUI.logDevLoop('dev', `could not resolve Expo URL for ${platform}: ${response.status} ${responseText}`, 'warn')
    }
  } catch (error) {
    TUI.logDevLoop('dev', `could not resolve Expo URL for ${platform}: ${Errors.formatForUser(error)}`, 'warn')
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

async function expoLink(platform: Exclude<ExpoPlatform, 'web'>): Promise<string | undefined> {
  const response = await fetch(`${ExpoConfig.EXPO_ORIGIN}/_expo/link?platform=${platform}`, { redirect: 'manual' })
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
