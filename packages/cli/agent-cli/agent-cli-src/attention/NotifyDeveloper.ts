import { Assert, CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'

/** macOS sounds accepted by the CLI and host policy; the first is the default. */
export const NOTIFICATION_SOUNDS = [
  'Bottle',
  'Basso',
  'Blow',
  'Frog',
  'Funk',
  'Glass',
  'Hero',
  'Morse',
  'Ping',
  'Pop',
  'Purr',
  'Sosumi',
  'Submarine',
  'Tink',
] as const

type NotifyOptions = {
  shutdownId?: string
  stop?: boolean
  sound?: string
  flashScreen?: boolean
  message?: string
  context?: string
}
type NotifyDependencies = {
  root?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  play?: (sound: string, volume: number, signal: AbortSignal) => Promise<void>
  flash?: (signal: AbortSignal) => Promise<void>
  notify?: (message: string, context: string, signal: AbortSignal) => Promise<void>
  onSignal?: typeof Platform.onProcessSignal
}

/** Runs one scoped attention alert until acknowledged, superseded, or cancelled. */
export async function notifyDeveloper(
  options: NotifyOptions = {},
  dependencies: NotifyDependencies = {},
): Promise<void> {
  const id = options.shutdownId ?? 'default'
  Assert.input(
    /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/.test(id),
    'Shutdown ID must be 1–128 letters, digits, underscores or dashes and must not start with a dash.',
  )
  const sound = NOTIFICATION_SOUNDS.find(name =>
    name.toLowerCase() === (options.sound ?? NOTIFICATION_SOUNDS[0]).toLowerCase()
  )
  Assert.input(sound !== undefined, `Choose a notification sound: ${NOTIFICATION_SOUNDS.join(', ')}.`)
  const root = dependencies.root ?? Repo.getRoot()
  const message = options.message ?? 'An agent is waiting for your attention. Return to the task to reply.'
  const context = options.context ?? `${FS.basename(root)} · ${id}`
  Assert.input(isNotificationText(message, 2_000), 'Notification message must be 1–2000 characters on one line.')
  Assert.input(isNotificationText(context, 256), 'Notification context must be 1–256 characters on one line.')
  const state = FS.resolvePath(`.artifacts/notify-developer/${id}.txt`, root)
  const token = Platform.randomUUID()
  const now = dependencies.now ?? Time.nowMs
  const sleep = dependencies.sleep ?? Time.sleep
  const play = dependencies.play ?? playNotificationSound
  const flash = dependencies.flash ?? flashScreen
  const notify = dependencies.notify ?? postNotification
  const onSignal = dependencies.onSignal ?? Platform.onProcessSignal
  const read = async (): Promise<string | undefined> => {
    try {
      return await FS.readText(state)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }
      throw cause
    }
  }
  const mutate = async (work: () => Promise<void>): Promise<void> => {
    await FS.withFileMutationLock(state, root, work)
  }
  if (options.stop) {
    await mutate(() => FS.remove(state))
    HCI.writeLine(`Acknowledged attention alert '${id}'.`)
    return
  }

  let cancelled = false
  let playback: Promise<void> | undefined
  let flashing: Promise<void> | undefined
  let notification: Promise<void> | undefined
  let notificationFailure: unknown
  let effectFailure: unknown
  const effects = new AbortController()
  const unsubscribe = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal =>
    onSignal(signal, () => {
      cancelled = true
      effects.abort()
    })
  )
  try {
    await mutate(() => FS.writeText(state, token))
    HCI.writeLine(
      `Attention alert '${id}': ${sound} every four seconds${
        options.flashScreen ? ', flashing immediately' : ', flashing after 30 seconds'
      }. Acknowledge with ./agent notify-developer --shutdown-id ${id} --stop.`,
    )
    notification = Promise.resolve().then(() => notify(message, context, effects.signal)).catch(cause => {
      notificationFailure = cause
      HCI.logProcessWarn('notify-developer', `${Errors.formatForUser(cause)} Sound and screen alerts will continue.`)
    })
    const startedAt = now()
    let nextSoundAt = startedAt
    let nextFlashAt = nextSoundAt + (options.flashScreen ? 0 : 30_000)
    while (!cancelled && effectFailure === undefined && await read() === token) {
      if (now() >= nextSoundAt && playback === undefined) {
        const volume = 0.2 + 0.8 * Math.min(1, Math.max(0, (now() - startedAt) / 120_000))
        nextSoundAt = now() + 4_000
        playback = Promise.resolve().then(() => play(sound, volume, effects.signal)).catch(cause => {
          effectFailure ??= cause
        }).finally(() => {
          playback = undefined
        })
      }
      if (!cancelled && now() >= nextFlashAt && flashing === undefined && await read() === token) {
        nextFlashAt = now() + 4_000
        flashing = Promise.resolve().then(() => flash(effects.signal)).catch(cause => {
          effectFailure ??= cause
        }).finally(() => {
          flashing = undefined
        })
      }
      if (!cancelled && effectFailure === undefined && await read() === token) {
        await sleep(Math.max(1, Math.min(100, nextSoundAt - now(), nextFlashAt - now())))
      }
    }
    if (effectFailure !== undefined) {
      throw effectFailure
    }
  } finally {
    effects.abort()
    await Promise.all([playback, flashing, notification])
    for (const remove of unsubscribe) {
      remove()
    }
    await mutate(async () => {
      if (await read() === token) {
        await FS.remove(state)
      }
    })
  }
  if (notificationFailure !== undefined) {
    throw notificationFailure
  }
}

/** Notification text stays data in argv, never executable script or shell text. */
export function isNotificationText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value) && !value.startsWith('-')
}

async function postNotification(message: string, context: string, signal: AbortSignal): Promise<void> {
  if (Platform.hostPlatform !== 'darwin') {
    Errors.throwHostEnvironment('Attention notifications currently require macOS.')
  }
  await runAttentionEffect(
    '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      "function run(argv) { var app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayNotification(argv[0], {withTitle: 'Tao: developer attention', subtitle: argv[1]}); }",
      message,
      context,
    ],
    signal,
    'post the attention notification',
    30_000,
  )
}

async function playNotificationSound(sound: string, volume: number, signal: AbortSignal): Promise<void> {
  if (Platform.hostPlatform !== 'darwin') {
    Errors.throwHostEnvironment('Attention sounds currently require macOS.')
  }
  await runAttentionEffect(
    '/usr/bin/afplay',
    ['--volume', String(volume), `/System/Library/Sounds/${sound}.aiff`],
    signal,
    'play the attention sound',
    4_000,
  )
}

async function flashScreen(signal: AbortSignal): Promise<void> {
  await runAttentionEffect(
    '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      "ObjC.import('AudioToolbox'); $.AudioServicesPlayAlertSound($.kSystemSoundID_FlashScreen); delay(0.2)",
    ],
    signal,
    'flash the screen',
    4_000,
  )
}

async function runAttentionEffect(
  command: string,
  args: string[],
  signal: AbortSignal,
  action: string,
  timeoutMs: number,
): Promise<void> {
  if (signal.aborted) {
    return
  }
  let stderr = ''
  const child = CLI.start(command, {
    args,
    processPolicy: 'test',
    timeoutMs,
    onOutput: (stream, chunk) => {
      if (stream === 'stderr') {
        stderr += chunk.toString()
      }
    },
  })
  const stop = () => {
    child.kill('SIGKILL')
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    const result = await child.waitForClose()
    if (!signal.aborted && (child.error !== undefined || result.exitCode !== 0)) {
      Errors.throwHostEnvironment(`Could not ${action}: ${stderr.trim() || child.error?.message || result.exitCode}.`)
    }
  } finally {
    signal.removeEventListener('abort', stop)
    await child.closeOutput()
    child.dispose()
  }
}
