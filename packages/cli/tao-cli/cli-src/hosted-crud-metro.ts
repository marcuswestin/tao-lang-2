import { type ExpoFetch, fetchExpoOpenEndpoint } from '@expo-host/dev-loop/expo-runner/metro'
import { Ports } from '@expo-host/dev-loop/expo-runner/Ports'
import {
  startStudioProcessTree,
  stopStudioProcessTree,
} from '@expo-host/dev-loop/StudioProcessTree'
import { Errors, FS, HCI, Json, Platform, Text, Time } from '@shared'
import type { Readable, Writable } from 'node:stream'
import QRCode from 'qrcode'
import METRO_EVENTS_PRELOAD from './metro-events-preload.cjs.txt'

/** MetroProcess is a running headless Expo CLI: its exit, and a stop that takes its whole process tree down. */
type MetroProcess = { exited: Promise<number | null>; output(): string; stop(): Promise<void> }

/** MetroStarter launches Expo CLI with the given `node` arguments; a test hands in a scripted one. */
export type MetroStarter = (spec: { args: readonly string[]; cwd: string; env: Record<string, string> }) => MetroProcess

export type MetroSessionOptions = {
  expo: string
  project: string
  /** Opens the app in the iOS Simulator as soon as Metro is ready. */
  openSimulator: boolean
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

type Build = { platform: string; started: number; total: number }

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
  const directory = FS.resolvePath('.tao/connect-run', options.project)
  await FS.mkdir(directory)
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
  let exitCode: number | null | undefined
  void metro.exited.then(code => (exitCode = code))
  const stop = async () => {
    stopping = true
    await metro.stop()
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
    await showConnection(url, options.openSimulator, out)

    const onKey = async (key: string) => {
      if (key === 'q' || key === HCI.RawKey.interrupt) {
        await stop()
      } else if (key === 'r') {
        screen.line(await reload(fetchImpl, origin))
      } else if (key === 'i') {
        screen.line('Opening Expo Go in the iOS Simulator…')
        screen.line(await openSimulator(fetchImpl, origin))
      } else if (key === '?') {
        await showConnection(url, options.openSimulator, out)
      }
    }
    const keys = HCI.isInteractive(options)
      ? HCI.startRawKeys(key => void onKey(key), { input: options.input })
      : undefined
    const stopSignal = Platform.onProcessSignal('SIGINT', () => void stop())
    try {
      if (options.openSimulator) {
        void onKey('i')
      }
      await followEvents(events, screen, () => stopping || exitCode !== undefined, options.pollMs ?? 150)
    } finally {
      keys?.stop()
      stopSignal()
    }
    if (!stopping) {
      screen.status(undefined)
      throwMetroExited(metro, directory, `Expo CLI stopped with code ${exitCode}.`)
    }
    screen.status(undefined)
    HCI.writeLine('Stopped Metro.', out)
  } finally {
    if (!stopping) {
      await stop()
    }
    await FS.writeText(FS.resolvePath('expo.log', directory), metro.output())
  }
}

function throwMetroExited(metro: MetroProcess, directory: string, headline: string): never {
  const tail = Text.stripAnsi(metro.output()).trim().split('\n').slice(-15).join('\n')
  Errors.throwHostEnvironment(
    `${headline} Its output is in ${FS.displayPath(FS.resolvePath('expo.log', directory))}:\n${tail}`,
  )
}

async function showConnection(url: string, simulator: boolean, out: HCI.OutputOptions): Promise<void> {
  HCI.writeLine('', out)
  HCI.writeLine(await QRCode.toString(url, { type: 'terminal', small: true }), out)
  HCI.writeLine(`Expo Go address: ${HCI.bold(url)}`, out)
  HCI.writeLine(
    simulator
      ? 'Opening the iOS Simulator; to use an iPhone instead, scan the code with its camera.'
      : 'Scan the code with the iPhone camera, then open it in Expo Go.',
    out,
  )
  HCI.writeLine(HCI.dim('Keys: r reload · i iOS Simulator · ? show this again · q quit'), out)
  HCI.writeLine('', out)
}

/** followEvents shows each new Metro event line until `done`, reading only whole lines the preload has finished writing. */
async function followEvents(file: string, screen: Screen, done: () => boolean, pollMs: number): Promise<void> {
  const builds = new Map<string, Build>()
  let consumed = 0
  while (true) {
    const finished = done()
    const text = await FS.readText(file)
    const end = text.lastIndexOf('\n') + 1
    for (const line of text.slice(consumed, end).split('\n')) {
      if (line.trim() !== '') {
        showEvent(parseEvent(line), builds, screen)
      }
    }
    consumed = Math.max(consumed, end)
    if (finished) {
      return
    }
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
  const handlers: Record<string, () => void> = {
    bundle_build_started() {
      builds.set(id, { platform: platformName(event.bundleDetails?.platform), started: Date.now(), total: 0 })
      screen.status(`${platformName(event.bundleDetails?.platform)}: bundling…`)
    },
    bundle_transform_progressed_throttled() {
      const done = Number(event.transformedFileCount)
      const total = Number(event.totalFileCount)
      if (build && Number.isFinite(done) && total > 0) {
        build.total = total
        screen.status(`${build.platform}: bundling ${Math.floor(done / total * 100)}% (${done}/${total} files)`)
      }
    },
    bundle_build_done() {
      if (build) {
        const seconds = ((Date.now() - build.started) / 1000).toFixed(1)
        screen.line(
          HCI.green(`${build.platform} bundled in ${seconds}s${build.total ? ` (${build.total} files)` : ''}`),
        )
        builds.delete(id)
      }
    },
    bundle_build_failed() {
      builds.delete(id)
      screen.status(undefined)
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

async function reload(fetchImpl: ExpoFetch, origin: string): Promise<string> {
  try {
    const response = await fetchImpl(`${origin}/message?method=reload`)
    return response.ok ? 'Reloading connected apps.' : `Reload failed: ${response.status} ${await response.text()}`
  } catch (error) {
    return `Reload failed: ${Errors.formatForUser(error)}`
  }
}

/** openSimulator asks Expo to open its app in the iOS Simulator, which also installs Expo Go there when needed. */
async function openSimulator(fetchImpl: ExpoFetch, origin: string): Promise<string> {
  try {
    const response = await fetchImpl(`${origin}/_expo/open?platform=ios`, {
      method: 'POST',
      headers: { Origin: origin },
    })
    if (response.ok) {
      return 'Opened Expo Go in the iOS Simulator.'
    }
    const text = await response.text()
    const body = parseJson(text)
    const reason = [body?.['error'], body?.['details']].filter(part => typeof part === 'string').join(' ')
    return `Could not open the iOS Simulator: ${reason || `${response.status} ${text}`}`
  } catch (error) {
    return `Could not open the iOS Simulator: ${Errors.formatForUser(error)}`
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
