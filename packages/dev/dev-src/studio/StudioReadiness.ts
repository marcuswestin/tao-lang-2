import { HCI, Time } from '@shared'

/**
 * The one machine-readable answer to "is Studio up, and what is its address?". Smoke lanes and
 * scripts read this instead of scraping logs, which is why it is emitted only after the URL it
 * advertises has actually answered: a readiness line that arrives before the page loads is worse
 * than no readiness line at all.
 */

/** How long a readiness probe waits, and how often it retries, before giving up. */
const READY_TIMEOUT_MS = 60_000
const READY_POLL_MS = 100

/** StudioReadiness is the versioned `--json` payload one launch prints when it is usable. */
export type StudioReadiness = {
  appName?: string
  artifactRoot: string
  launchId: string
  lifecycleLogPath: string
  manifestPath: string
  mode: 'browser' | 'native'
  previewUrl?: string
  projectRoot: string
  /** The exact page to open. Never the server root when the usable page is session-prefixed. */
  sessionUrl: string
  sessionId: string
  /** The server root, for callers that need the origin rather than the page. */
  studioUrl: string
  version: 1
}

/** writeReadiness prints the readiness payload on stdout, where a caller can parse it alone. */
export function writeReadiness(readiness: StudioReadiness): void {
  HCI.writeLine(JSON.stringify(readiness))
}

export type ProbeOptions = {
  fetchUrl?: (url: string) => Promise<{ ok: boolean }>
  pollMs?: number
  sleep?: (milliseconds: number) => Promise<void>
  timeoutMs?: number
}

/**
 * waitForReadyUrl polls until the advertised page answers. It resolves false rather than
 * throwing, so a launch that never became usable reports that instead of printing an address
 * nothing is listening on.
 */
export async function waitForReadyUrl(url: string, options: ProbeOptions = {}): Promise<boolean> {
  const fetchUrl = options.fetchUrl ?? defaultFetch
  const sleep = options.sleep ?? Time.sleep
  const pollMs = options.pollMs ?? READY_POLL_MS
  const attempts = Math.max(1, Math.ceil((options.timeoutMs ?? READY_TIMEOUT_MS) / pollMs))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await fetchUrl(url).catch(() => ({ ok: false }))).ok) {
      return true
    }
    await sleep(pollMs)
  }
  return false
}

async function defaultFetch(url: string): Promise<{ ok: boolean }> {
  const response = await fetch(url, { redirect: 'follow' })
  return { ok: response.ok }
}

/**
 * openTarget decides what a launch should open, if anything. `--no-browser` opens nothing, in
 * either mode; otherwise exactly the session page opens, exactly once.
 */
export function openTarget(options: {
  browser?: boolean
  opened: boolean
  sessionUrl: string
}): string | undefined {
  if (options.browser === false || options.opened) {
    return undefined
  }
  return options.sessionUrl
}
