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

type NotifyOptions = { shutdownId?: string; stop?: boolean; sound?: string; flashScreen?: boolean }
type NotifyDependencies = {
  root?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  play?: (sound: string, volume: number) => Promise<void>
  flash?: () => Promise<void>
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
  const state = FS.resolvePath(`.artifacts/notify-developer/${id}.txt`, root)
  const token = Platform.randomUUID()
  const now = dependencies.now ?? Time.nowMs
  const sleep = dependencies.sleep ?? Time.sleep
  const play = dependencies.play ?? playNotificationSound
  const flash = dependencies.flash ?? flashScreen
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
  let effectFailure: unknown
  const unsubscribe = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal =>
    onSignal(signal, () => {
      cancelled = true
    })
  )
  try {
    await mutate(() => FS.writeText(state, token))
    HCI.writeLine(
      `Attention alert '${id}': ${sound} every four seconds${
        options.flashScreen ? ', flashing immediately' : ', flashing after 30 seconds'
      }. Acknowledge with ./agent notify-developer --shutdown-id ${id} --stop.`,
    )
    const startedAt = now()
    let nextSoundAt = startedAt
    let nextFlashAt = nextSoundAt + (options.flashScreen ? 0 : 30_000)
    while (!cancelled && effectFailure === undefined && await read() === token) {
      if (now() >= nextSoundAt && playback === undefined) {
        const volume = 0.2 + 0.8 * Math.min(1, Math.max(0, (now() - startedAt) / 120_000))
        nextSoundAt = now() + 4_000
        playback = Promise.resolve().then(() => play(sound, volume)).catch(cause => {
          effectFailure ??= cause
        }).finally(() => {
          playback = undefined
        })
      }
      if (!cancelled && now() >= nextFlashAt && flashing === undefined && await read() === token) {
        nextFlashAt = now() + 4_000
        flashing = Promise.resolve().then(flash).catch(cause => {
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
    await Promise.all([playback, flashing])
    for (const remove of unsubscribe) {
      remove()
    }
    await mutate(async () => {
      if (await read() === token) {
        await FS.remove(state)
      }
    })
  }
}

async function playNotificationSound(sound: string, volume: number): Promise<void> {
  if (Platform.hostPlatform !== 'darwin') {
    Errors.throwHostEnvironment('Attention sounds currently require macOS.')
  }
  const result = await CLI.run('/usr/bin/afplay', {
    args: ['--volume', String(volume), `/System/Library/Sounds/${sound}.aiff`],
    processPolicy: 'test',
    timeoutMs: 4_000, // budget-ok: a sound must finish before the next four-second tick
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Could not play the attention sound: ${result.stderr.trim() || result.error?.message || result.exitCode}.`,
    )
  }
}

async function flashScreen(): Promise<void> {
  const result = await CLI.run('/usr/bin/osascript', {
    args: [
      '-l',
      'JavaScript',
      '-e',
      "ObjC.import('AudioToolbox'); $.AudioServicesPlayAlertSound($.kSystemSoundID_FlashScreen); delay(0.2)",
    ],
    processPolicy: 'test',
    timeoutMs: 4_000, // budget-ok: a flash must finish before the next four-second tick
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Could not flash the screen: ${result.stderr.trim() || result.error?.message || result.exitCode}.`,
    )
  }
}
