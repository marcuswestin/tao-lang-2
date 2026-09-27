import { Errors, HCI } from '@shared'
import type { StudioDeviceGateway, StudioDeviceLauncher, StudioDeviceStatus } from '@studio'

type DeviceGateway = Pick<
  StudioDeviceGateway,
  'openPairing' | 'status' | 'subscribe' | 'confirmPairing' | 'declinePairing'
>
type Options = {
  device: string
  gateway: DeviceGateway
  launcher: StudioDeviceLauncher
  metroOrigin: string
  sessionId: string
  sessionUrl: string
  signal: AbortSignal
  stop: () => void
}
type Environment = {
  confirm: (message: string, signal: AbortSignal, onCancel: () => void) => Promise<boolean>
  interactive: () => boolean
  write: (message: string) => void
}

/** Launch an explicitly selected physical device and retain code-checked pairing in the terminal. */
export async function startStudioDeviceCli(
  options: Options,
  environment: Environment = {
    confirm: async (message, signal, onCancel) =>
      await HCI.askConfirm({ message, defaultValue: false, signal, onCancel }),
    interactive: HCI.isInteractive,
    write: message => HCI.logProcessInfo('studio-device', message),
  },
): Promise<{ stop: () => Promise<void> }> {
  const { device, gateway, launcher, metroOrigin, sessionId, signal } = options
  if (device.trim() === '') {
    Errors.throwUserInput('--device requires a physical device name or UDID.')
  }
  signal.throwIfAborted()
  const info = await launcher.describe({ metroOrigin })
  signal.throwIfAborted()
  const physical = info.hosts.filter(host => host.kind === 'device')
  const byId = physical.find(host => host.id === device)
  const matches = byId === undefined ? physical.filter(host => host.name === device) : [byId]
  if (matches.length !== 1) {
    const choices = physical.map(host => `${host.name} (${host.id})`).join(', ') || 'none'
    Errors.throwUserInput(
      `${
        matches.length === 0 ? 'No connected physical device matches' : 'More than one physical device matches'
      } "${device}". `
        + `Use an exact name or UDID. Connected devices: ${choices}.`,
    )
  }
  const host = matches[0]!
  let stopped = false
  let latestIdentity: string | undefined
  let prompt: AbortController | undefined
  let work = Promise.resolve()
  const identity = (pending: StudioDeviceStatus['pairing']['pending']) =>
    pending === undefined ? undefined : `${pending.devicePublicKey}:${pending.code}`
  const observe = (status: StudioDeviceStatus): void => {
    const pending = status.pairing.pending
    const next = identity(pending)
    if (stopped || signal.aborted || next === latestIdentity) {
      return
    }
    latestIdentity = next
    prompt?.abort()
    if (pending === undefined) {
      return
    }
    work = work.then(async () => {
      if (stopped || signal.aborted || latestIdentity !== next) {
        return
      }
      environment.write(`Pairing code for ${pending.device.name}: ${pending.code}. Compare it with your phone.`)
      if (!environment.interactive()) {
        environment.write(`Trust was not granted. Confirm the matching code in Device at ${options.sessionUrl}.`)
        return
      }
      const currentPrompt = new AbortController()
      prompt = currentPrompt
      try {
        const accepted = await environment.confirm(
          'Do both screens show this code? Trust this device?',
          currentPrompt.signal,
          options.stop,
        )
        if (
          stopped || signal.aborted || currentPrompt.signal.aborted
          || identity(gateway.status(sessionId).pairing.pending) !== next
        ) {
          return
        }
        if (accepted) {
          await gateway.confirmPairing(sessionId, pending.devicePublicKey)
          environment.write('Device trusted. Tao Companion will open the app.')
        } else {
          gateway.declinePairing(sessionId, pending.devicePublicKey)
          environment.write('Pairing declined. Restart with --device to try again.')
        }
      } catch {
        if (!stopped && !signal.aborted && !currentPrompt.signal.aborted) {
          environment.write(`Pairing could not finish. Open Device at ${options.sessionUrl} to retry.`)
        }
      } finally {
        if (prompt === currentPrompt) {
          prompt = undefined
        }
      }
    })
  }
  const unsubscribe = gateway.subscribe(sessionId, observe)
  const abort = () => {
    if (stopped) {
      return
    }
    stopped = true
    prompt?.abort()
    unsubscribe()
  }
  signal.addEventListener('abort', abort, { once: true })
  const stop = async () => {
    abort()
    signal.removeEventListener('abort', abort)
    await work
  }
  try {
    signal.throwIfAborted()
    gateway.openPairing(sessionId)
    observe(gateway.status(sessionId))
    await launcher.open({ hostId: host.id, metroOrigin, route: 'auto', signal })
    signal.throwIfAborted()
    environment.write(
      `Opened Tao Companion on ${host.name}. Keep the phone unlocked; confirm pairing below if requested.`,
    )
    return { stop }
  } catch (error) {
    await stop()
    throw error
  }
}
