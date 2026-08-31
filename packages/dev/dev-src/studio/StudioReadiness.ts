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
  fetchUrl?: (url: string, timeoutMs: number) => Promise<{ ok: boolean }>
  now?: () => number
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
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS
  // A wall-clock deadline, not an attempt count: a server that accepts the connection and never
  // answers would otherwise hold this open forever, and the launch's Ctrl+C handler with it.
  const deadline = (options.now ?? Time.nowMs)() + timeoutMs
  const now = options.now ?? Time.nowMs
  while (now() < deadline) {
    if ((await fetchUrl(url, pollMs * 2).catch(() => ({ ok: false }))).ok) {
      return true
    }
    await sleep(pollMs)
  }
  return false
}

async function defaultFetch(url: string, timeoutMs: number): Promise<{ ok: boolean }> {
  // Each attempt gets its own deadline, and the body is consumed so the socket is not left open.
  const abort = new AbortController()
  const abortTimer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const response = await fetch(url, { redirect: 'follow', signal: abort.signal } as RequestInit)
    await response.arrayBuffer().catch(() => undefined)
    return { ok: response.ok }
  } finally {
    clearTimeout(abortTimer)
  }
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
