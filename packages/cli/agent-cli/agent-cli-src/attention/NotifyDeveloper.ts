import { Assert, CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { AttentionState } from './AttentionState'

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
  stop?: boolean
  sound?: string
  flashScreen?: boolean
  message?: string
  context?: string
}
type NotifyDependencies = {
  root?: string
  stateDirectory?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  play?: (sound: string, volume: number, signal: AbortSignal) => Promise<void>
  flash?: (signal: AbortSignal) => Promise<void>
  notify?: (message: string, context: string, signal: AbortSignal) => Promise<void>
  onSignal?: typeof Platform.onProcessSignal
}

/** Runs the one machine-wide attention loop; another caller reuses it without queuing a loop. */
export async function notifyDeveloper(
  options: NotifyOptions = {},
  dependencies: NotifyDependencies = {},
): Promise<void> {
  const state = new AttentionState(dependencies.stateDirectory)
  if (options.stop) {
    await state.stop()
    HCI.writeLine('Stop requested for the machine-wide attention alert.')
    return
  }
  const sound = NOTIFICATION_SOUNDS.find(name =>
    name.toLowerCase() === (options.sound ?? NOTIFICATION_SOUNDS[0]).toLowerCase()
  )
  Assert.input(sound !== undefined, `Choose a notification sound: ${NOTIFICATION_SOUNDS.join(', ')}.`)
  const root = dependencies.root ?? Repo.getRoot()
  const message = options.message ?? 'An agent is waiting for your attention. Return to the task to reply.'
  const context = options.context ?? FS.basename(root)
  Assert.input(isNotificationText(message, 2_000), 'Notification message must be 1–2000 characters on one line.')
  Assert.input(isNotificationText(context, 256), 'Notification context must be 1–256 characters on one line.')
  const now = dependencies.now ?? Time.nowMs
  const sleep = dependencies.sleep ?? Time.sleep
  const play = dependencies.play ?? playNotificationSound
  const flash = dependencies.flash ?? flashScreen
  const notify = dependencies.notify ?? postNotification
  const onSignal = dependencies.onSignal ?? Platform.onProcessSignal
  const token = await state.claim(root)
  if (token === undefined) {
    HCI.writeLine('The machine-wide attention loop is already running. Stop it from any worktree with just stop.')
    const effects = new AbortController()
    const currentToken = await state.currentToken()
    if (currentToken === undefined) {
      return
    }
    let finished = false
    let failure: unknown
    const unsubscribe = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal =>
      onSignal(signal, () => effects.abort())
    )
    const posting = Promise.resolve().then(() => notify(message, context, effects.signal)).catch(cause => {
      failure = cause
    }).finally(() => {
      finished = true
    })
    try {
      while (!finished && !effects.signal.aborted && await state.active(currentToken)) {
        await sleep(100)
      }
    } finally {
      effects.abort()
      await posting
      for (const remove of unsubscribe) {
        remove()
      }
    }
    if (failure !== undefined) {
      throw failure
    }
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
    HCI.writeLine(
      `Attention alert: ${sound} every four seconds${
        options.flashScreen ? ', flashing immediately' : ', flashing after 30 seconds'
      }. Stop from any worktree with just stop (agents: ./agent unsandboxed stop).`,
    )
    notification = Promise.resolve().then(() => notify(message, context, effects.signal)).catch(cause => {
      notificationFailure = cause
      HCI.logProcessWarn('notify-developer', `${Errors.formatForUser(cause)} Sound and screen alerts will continue.`)
    })
    const startedAt = now()
    let nextSoundAt = startedAt
    let nextFlashAt = nextSoundAt + (options.flashScreen ? 0 : 30_000)
    while (!cancelled && effectFailure === undefined && await state.active(token)) {
      if (now() >= nextSoundAt && playback === undefined) {
        const volume = 0.2 + 0.8 * Math.min(1, Math.max(0, (now() - startedAt) / 120_000))
        nextSoundAt = now() + 4_000
        playback = Promise.resolve().then(() => play(sound, volume, effects.signal)).catch(cause => {
          effectFailure ??= cause
        }).finally(() => {
          playback = undefined
        })
      }
      if (!cancelled && now() >= nextFlashAt && flashing === undefined && await state.active(token)) {
        nextFlashAt = now() + 4_000
        flashing = Promise.resolve().then(() => flash(effects.signal)).catch(cause => {
          effectFailure ??= cause
        }).finally(() => {
          flashing = undefined
        })
      }
      if (!cancelled && effectFailure === undefined && await state.active(token)) {
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
    await state.release(token)
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
