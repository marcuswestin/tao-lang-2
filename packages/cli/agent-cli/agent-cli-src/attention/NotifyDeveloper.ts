import { Assert, CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'

type NotifyOptions = { id?: string; stop?: boolean }
type NotifyDependencies = {
  root?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  play?: () => Promise<void>
  onSignal?: typeof Platform.onProcessSignal
}

/** Runs one scoped attention alert until acknowledged, superseded, or cancelled. */
export async function notifyDeveloper(
  options: NotifyOptions = {},
  dependencies: NotifyDependencies = {},
): Promise<void> {
  const id = options.id ?? 'default'
  Assert.input(
    /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/.test(id),
    'Alert ID must be 1–128 letters, digits, underscores or dashes and must not start with a dash.',
  )
  const root = dependencies.root ?? Repo.getRoot()
  const state = FS.resolvePath(`.artifacts/notify-developer/${id}.txt`, root)
  const token = Platform.randomUUID()
  const now = dependencies.now ?? Time.nowMs
  const sleep = dependencies.sleep ?? Time.sleep
  const play = dependencies.play ?? playNotificationSound
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
  const unsubscribe = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal =>
    onSignal(signal, () => {
      cancelled = true
    })
  )
  try {
    await mutate(() => FS.writeText(state, token))
    HCI.writeLine(
      `Attention alert '${id}': sounding every five seconds. Acknowledge with ./agent notify-developer --id ${id} --stop.`,
    )
    while (!cancelled && await read() === token) {
      const soundedAt = now()
      await play()
      const nextSoundAt = soundedAt + 5_000
      while (!cancelled && now() < nextSoundAt && await read() === token) {
        await sleep(Math.min(100, nextSoundAt - now()))
      }
    }
  } finally {
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

async function playNotificationSound(): Promise<void> {
  if (Platform.hostPlatform !== 'darwin') {
    Errors.throwHostEnvironment('Attention sounds currently require macOS.')
  }
  const result = await CLI.run('/usr/bin/afplay', {
    args: ['/System/Library/Sounds/Glass.aiff'],
    processPolicy: 'test',
    timeoutMs: 5_000, // budget-ok: a sound must finish before the next five-second tick
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Could not play the attention sound: ${result.stderr.trim() || result.error?.message || result.exitCode}.`,
    )
  }
}
