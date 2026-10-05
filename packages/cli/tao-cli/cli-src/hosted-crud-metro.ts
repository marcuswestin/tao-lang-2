import { type ExpoFetch, fetchExpoOpenEndpoint } from '@expo-host/dev-loop/expo-runner/metro'
import { Ports } from '@expo-host/dev-loop/expo-runner/Ports'
import {
  startStudioProcessTree,
  stopStudioProcessTree,
} from '@expo-host/dev-loop/StudioProcessTree'
import { Errors, FS, HCI, Json, Platform, ProjectLocal, Text, Time } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { renderTerminalQr } from './hosted-crud-qr'
import METRO_EVENTS_PRELOAD from './metro-events-preload.cjs.txt'

/** MetroProcess is a running headless Expo CLI: its exit, and a stop that takes its whole process tree down. */
type MetroProcess = { exited: Promise<number | null>; output(): string; stop(): Promise<void> }

/** MetroStarter launches Expo CLI with the given `node` arguments; a test hands in a scripted one. */
export type MetroStarter = (spec: { args: readonly string[]; cwd: string; env: Record<string, string> }) => MetroProcess

export type MetroSessionOptions = {
  expo: string
  project: string
  /** Gives physical-device setup guidance only when the person requests it. */
  deviceGuidance?: (signal: AbortSignal) => Promise<readonly string[]>
  input?: Readable
  interactive?: boolean
  output?: Writable
  fetch?: ExpoFetch
  metro?: MetroStarter
  pollMs?: number
  port?: number
}

/** MetroEvent is one Metro reporter event as the preload writes it; only the fields this screen reads are named. */
type MetroEvent = {
  type?: unknown
  buildID?: unknown
  bundleDetails?: { platform?: unknown }
  transformedFileCount?: unknown
  totalFileCount?: unknown
  error?: { message?: unknown; filename?: unknown; lineNumber?: unknown; column?: unknown }
  level?: unknown
  data?: unknown
}

type Build = { platform: string; started: number; status: string; total: number }

const METRO_PORT = 8081
const START_TIMEOUT_MS = 120_000
const OUTPUT_TAIL_CHARS = 20_000

/**
 * runMetroSession runs Expo CLI without its terminal UI and draws Tao's own screen over it: Expo's
 * Expo Go address as a QR code, bundling progress, bundling errors, device logs, and single keys to
 * reload, open the iOS Simulator, or stop. It returns once the person stops it.
 */
export async function runMetroSession(options: MetroSessionOptions): Promise<void> {
  // Another checkout's dev loop often holds 8081 already; Expo Go reads the port from the code, so any port works.
  const port = options.port ?? await Ports.findAvailable(METRO_PORT)
  const origin = `http://localhost:${port}`
  const fetchImpl = options.fetch ?? fetch
  const out = { output: options.output }
  const screen = createScreen(options.output)

  if (await metroAnswers(fetchImpl, origin)) {
    Errors.throwUserInput(`Something already serves ${origin}. Stop that Metro server first.`)
  }
  const directory = ProjectLocal.cacheResolve('connect-run', options.project)
  await ProjectLocal.prepare(options.project)
  await FS.mkdirWithinBoundary(directory, options.project)
  const preload = FS.resolvePath('metro-events.cjs', directory)
  const events = FS.resolvePath('metro-events.jsonl', directory)
  await FS.writeText(preload, METRO_EVENTS_PRELOAD)
  await FS.writeText(events, '')

  const metro = (options.metro ?? startMetro)({
    args: ['--require', preload, options.expo, 'start', '--go', '--port', String(port)],
    cwd: options.project,
    env: { TAO_METRO_EVENTS: events },
  })
  let stopping = false
  const actions = new AbortController()
  let stopPromise: Promise<void> | undefined
  let exitCode: number | null | undefined
  void metro.exited.then(code => (exitCode = code))
  const stop = (announce = false): Promise<void> => {
    if (!stopping) {
      stopping = true
      actions.abort()
      if (announce) {
        screen.status(undefined)
        screen.line('Shutting down… stopping Metro and its child processes.')
      }
    }
    return stopPromise ??= metro.stop()
  }

  try {
    screen.status('Starting Metro…')
    const ready = await Time.pollUntil(
      async () => exitCode === undefined && await metroAnswers(fetchImpl, origin),
      { intervalMs: 250, stop: () => exitCode !== undefined, timeoutMs: START_TIMEOUT_MS },
    )
    if (!ready) {
      const headline = exitCode === undefined
        ? `Metro did not answer at ${origin} within ${START_TIMEOUT_MS / 1000} seconds.`
        : `Expo CLI stopped with code ${exitCode}.`
      await stop()
      screen.status(undefined)
      throwMetroExited(metro, directory, headline)
    }
    const probe = await fetchExpoOpenEndpoint(origin, 'ios', fetchImpl)
    const url = typeof probe.body?.url === 'string' ? probe.body.url : undefined
    if (!url) {
      await stop()
      Errors.throwHostEnvironment(`Expo did not report its Expo Go address (${probe.status} ${probe.text.trim()}).`)
    }
    screen.status(undefined)
    let deviceChosen = false
    showConnection(url, out, screen, deviceChosen)

    const showActions = () =>
      screen.line(
        'Actions: r reload · i iOS Simulator · a Android emulator · c Show connection · d Device (Android/iPhone) · ? show this again · q quit',
      )
    const pendingActions = new Set<Promise<void>>()
    const onKey = async (key: string) => {
      if (stopping || actions.signal.aborted) {
        return
      }
      if (key === 'q' || key === HCI.RawKey.interrupt) {
        await stop(true)
      } else if (key === 'r') {
        const message = await abortable(reload(fetchImpl, origin, actions.signal), actions.signal)
        if (stopping || actions.signal.aborted) {
          return
        }
        if (message !== undefined) {
          screen.line(message)
        }
      } else if (key === 'i') {
        screen.line('Opening Expo Go in the iOS Simulator…')
        const message = await abortable(
          openSimulator(fetchImpl, origin, 'ios', 'iOS Simulator', actions.signal),
          actions.signal,
        )
        if (stopping || actions.signal.aborted) {
          return
        }
        if (message !== undefined) {
          screen.line(message)
        }
      } else if (key === 'a') {
        screen.line('Opening Expo Go in the Android emulator…')
        const message = await abortable(
          openSimulator(fetchImpl, origin, 'android', 'Android emulator', actions.signal),
          actions.signal,
        )
        if (stopping || actions.signal.aborted) {
          return
        }
        if (message !== undefined) {
          screen.line(message)
        }
      } else if (key === 'd') {
        deviceChosen = true
        const guidance = await abortable(
          options.deviceGuidance?.(actions.signal) ?? Promise.resolve([]),
          actions.signal,
        )
        if (stopping || actions.signal.aborted) {
          return
        }
        for (const line of guidance ?? []) {
          screen.line(line)
        }
        showConnection(url, out, screen, deviceChosen)
      } else if (key === 'c' || key === '?') {
        showConnection(url, out, screen, deviceChosen)
      }
      if (!stopping && !actions.signal.aborted && ['r', 'i', 'a', 'd', 'c', '?'].includes(key)) {
        showActions()
      }
    }
    const keys = HCI.isInteractive(options)
      ? HCI.startRawKeys(key => {
        const action = onKey(key)
        pendingActions.add(action)
        void action.then(() => pendingActions.delete(action), () => pendingActions.delete(action))
      }, { input: options.input })
      : undefined
    if (keys) {
      showActions()
    }
    const stopSignal = Platform.onProcessSignal('SIGINT', () => void stop(true))
    try {
      await followEvents(events, screen, () => stopping || exitCode !== undefined, options.pollMs ?? 150)
    } finally {
      keys?.stop()
      stopSignal()
      // Metro can exit without a quit key; release any pending account lookup or request.
      actions.abort()
      await Promise.allSettled([...pendingActions])
    }
    if (!stopping) {
      screen.status(undefined)
      throwMetroExited(metro, directory, `Expo CLI stopped with code ${exitCode}.`)
    }
    screen.status(undefined)
  } finally {
    try {
      await stop()
    } finally {
      await FS.writeText(FS.resolvePath('expo.log', directory), metro.output())
    }
  }
}

/** An action can be abandoned after quit even when a supplied test runner or fetch ignores AbortSignal. */
async function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) {
    return undefined
  }
  let onAbort = () => {}
  const aborted = new Promise<undefined>(resolve => {
    onAbort = () => resolve(undefined)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([task, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Bun's RequestInit and DOM AbortController describe onabort differently, but use the same native signal. */
function requestSignal(signal: AbortSignal): RequestInit['signal'] {
  return signal as unknown as RequestInit['signal']
}

function throwMetroExited(metro: MetroProcess, directory: string, headline: string): never {
  const tail = Text.stripAnsi(metro.output()).trim().split('\n').slice(-15).join('\n')
  Errors.throwHostEnvironment(
    `${headline} Its output is in ${FS.displayPath(FS.resolvePath('expo.log', directory))}:\n${tail}`,
  )
}

function showConnection(url: string, out: HCI.OutputOptions, screen: Screen, deviceChosen: boolean): void {
  if (!deviceChosen) {
    screen.line(`Expo Go address: ${HCI.bold(url)}`)
    return
  }
  const output = out.output ?? Platform.runtimeProcess.stdout
  const columns = (output as Writable & { columns?: number }).columns
  const qr = renderTerminalQr(url, columns)
  screen.line([
    '',
    qr ?? 'Terminal is too narrow for the QR code. Widen it to scan, or open the address below in Expo Go.',
    `Expo Go address: ${HCI.bold(url)}`,
    qr === undefined
      ? 'Open the address in Expo Go on your device.'
      : 'Scan in Expo Go on Android, or with the iPhone camera.',
    '',
  ].join('\n'))
}

/** followEvents shows each new Metro event line until `done`, reading only whole lines the preload has finished writing. */
async function followEvents(file: string, screen: Screen, done: () => boolean, pollMs: number): Promise<void> {
  const builds = new Map<string, Build>()
  let consumed = 0
  while (true) {
    if (done()) {
      return
    }
    const text = await FS.readText(file)
    if (done()) {
      return
    }
    const end = text.lastIndexOf('\n') + 1
    for (const line of text.slice(consumed, end).split('\n')) {
      if (line.trim() !== '') {
        showEvent(parseEvent(line), builds, screen)
      }
    }
    consumed = Math.max(consumed, end)
    await Time.sleep(pollMs)
  }
}

function parseEvent(line: string): MetroEvent {
  try {
    const event = JSON.parse(line) as unknown
    return Json.isRecord(event) ? event as MetroEvent : {}
  } catch {
    return {}
  }
}

/** showEvent turns one Metro reporter event into the screen's progress line or a printed line. */
function showEvent(event: MetroEvent, builds: Map<string, Build>, screen: Screen): void {
  const id = String(event.buildID ?? '')
  const build = builds.get(id)
  const showActiveBuild = () => screen.status([...builds.values()].at(-1)?.status)
  const handlers: Record<string, () => void> = {
    bundle_build_started() {
      const platform = platformName(event.bundleDetails?.platform)
      builds.set(id, { platform, started: Date.now(), status: `${platform}: bundling…`, total: 0 })
      showActiveBuild()
    },
    bundle_transform_progressed_throttled() {
      const done = Number(event.transformedFileCount)
      const total = Number(event.totalFileCount)
      if (build && Number.isFinite(done) && total > 0) {
        build.total = total
        build.status = `${build.platform}: bundling ${Math.floor(done / total * 100)}% (${done}/${total} files)`
        showActiveBuild()
      }
    },
    bundle_build_done() {
      if (build) {
        const seconds = ((Date.now() - build.started) / 1000).toFixed(1)
        builds.delete(id)
        showActiveBuild()
        screen.line(
          HCI.green(`${build.platform} bundled in ${seconds}s${build.total ? ` (${build.total} files)` : ''}`),
        )
      }
    },
    bundle_build_failed() {
      builds.delete(id)
      showActiveBuild()
    },
    bundling_error() {
      const error = event.error ?? {}
      const where = typeof error.filename === 'string'
        ? ` in ${error.filename}${typeof error.lineNumber === 'number' ? `:${error.lineNumber}` : ''}${
          typeof error.column === 'number' ? `:${error.column}` : ''
        }`
        : ''
      screen.line(HCI.red(`Bundling failed${where}. Fix the file and save; the app reloads by itself.`))
      screen.line(typeof error.message === 'string' ? error.message : 'Metro gave no message.')
    },
    client_log() {
      screen.line(`${HCI.dim(`app ${String(event.level ?? 'log')}:`)} ${formatLogData(event.data)}`)
    },
  }
  // Metro reports many more event kinds; this screen shows only these.
  if (typeof event.type === 'string' && Object.hasOwn(handlers, event.type)) {
    handlers[event.type]!()
  }
}

function formatLogData(data: unknown): string {
  const values = Array.isArray(data) ? data : [data]
  return values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
}

function platformName(platform: unknown): string {
  return platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform === 'web' ? 'Web' : 'App'
}

async function metroAnswers(fetchImpl: ExpoFetch, origin: string): Promise<boolean> {
  try {
    const response = await fetchImpl(`${origin}/status`)
    return response.ok && (await response.text()).includes('running')
  } catch {
    return false // Nothing listens yet.
  }
}

async function reload(fetchImpl: ExpoFetch, origin: string, signal: AbortSignal): Promise<string> {
  try {
    const response = await fetchImpl(`${origin}/message?method=reload`, { signal: requestSignal(signal) })
    return response.ok ? 'Reloading connected apps.' : `Reload failed: ${response.status} ${await response.text()}`
  } catch (error) {
    return `Reload failed: ${Errors.formatForUser(error)}`
  }
}

/** openSimulator asks Expo's same-device endpoint to open the app on the selected emulator or simulator. */
async function openSimulator(
  fetchImpl: ExpoFetch,
  origin: string,
  platform: 'ios' | 'android',
  target: 'iOS Simulator' | 'Android emulator',
  signal: AbortSignal,
): Promise<string> {
  try {
    const response = await fetchImpl(`${origin}/_expo/open?platform=${platform}`, {
      method: 'POST',
      headers: { Origin: origin },
      signal: requestSignal(signal),
    })
    if (response.ok) {
      return `Opened Expo Go in the ${target}.`
    }
    const text = await response.text()
    const body = parseJson(text)
    const reason = [body?.['error'], body?.['details']].filter(part => typeof part === 'string').join(' ')
    return `Could not open the ${target}: ${reason || `${response.status} ${text}`}`
  } catch (error) {
    return `Could not open the ${target}: ${Errors.formatForUser(error)}`
  }
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return Json.isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Screen prints lines above one progress line that a terminal redraws in place. */
type Screen = { line(text: string): void; status(text: string | undefined): void }

function createScreen(output: Writable | undefined): Screen {
  const out = { output }
  const terminal = HCI.isOutputTerminal(out)
  let current: string | undefined
  const clear = () => {
    if (terminal && current !== undefined) {
      HCI.write('\r\u001b[2K', out)
    }
  }
  return {
    line(text) {
      clear()
      HCI.writeLine(text, out)
      if (terminal && current !== undefined) {
        HCI.write(current, out)
      }
    },
    status(text) {
      if (!terminal) {
        return
      }
      clear()
      current = text
      if (text !== undefined) {
        HCI.write(text, out)
      }
    },
  }
}

function startMetro(spec: { args: readonly string[]; cwd: string; env: Record<string, string> }): MetroProcess {
  let output = ''
  const tree = startStudioProcessTree('node', {
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    onOutput: (_stream, chunk) => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_TAIL_CHARS)
    },
    // Without a terminal on stdin Expo CLI skips its interactive screen but keeps watching files.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = tree.waitForClose().then(result => result.exitCode)
  let stopping: Promise<void> | undefined
  return {
    exited,
    output: () => output,
    stop: () => (stopping ??= stopStudioProcessTree(tree)),
  }
}
