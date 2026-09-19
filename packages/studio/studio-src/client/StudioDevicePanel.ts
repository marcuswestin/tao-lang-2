import * as QRCode from 'qrcode'
import type { StudioDeviceLaunchDiagnostic, StudioDeviceLaunchInfo } from '../device/StudioDeviceLauncher'
import type { StudioDeviceConnectionState, StudioDeviceStatus } from '../device/StudioDeviceStatus'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import { type StudioApiClient, StudioApiError, type StudioCompileState, type StudioHandshake } from './StudioApiClient'

/** The loopback device routes the panel calls; a test substitutes a fake with the same shape. */
export type StudioDevicePanelApi = Pick<
  typeof StudioApiClient,
  | 'deviceConfirmPairing'
  | 'deviceDeclinePairing'
  | 'deviceLaunch'
  | 'deviceLaunchOpen'
  | 'deviceOpenPairing'
  | 'deviceReconnect'
  | 'deviceRevoke'
  | 'deviceSelectCell'
>

export type StudioDevicePanelOptions = {
  api: StudioDevicePanelApi
  button: HTMLButtonElement
  /** Defaults to `navigator.clipboard`; the panel falls back to selecting the URL text without one. */
  clipboard?: Pick<Clipboard, 'writeText'>
  handshake: Pick<StudioHandshake, 'compile' | 'previewManifest'>
  onStatusMessage?: (message: string) => void
  popover: HTMLElement
}

export type StudioDevicePanelController = {
  close(): void
  dispose(): void
  model(): StudioDevicePanelModel
  open(): void
  setCompileState(state: Pick<StudioCompileState, 'compileRevision'>): void
  /** The gateway answered 501 or failed: the panel explains instead of rendering an empty snapshot. */
  setGatewayUnavailable(message: string): void
  setManifest(manifest: StudioPreviewManifestV2 | undefined): void
  setStatus(status: StudioDeviceStatus): void
}

type StudioDevicePanelButtonState = 'behind' | 'connected' | 'idle' | 'pairing' | 'unavailable'

type StudioDevicePanelRevision = 'applied' | 'behind' | 'unknown'

type StudioDevicePanelHost = {
  canOpen: boolean
  id: string
  installed: 'installed' | 'not installed' | 'unknown'
  kind: 'device' | 'simulator'
  name: string
}

export type StudioDevicePanelModel = {
  buttonLabel: string
  buttonState: StudioDevicePanelButtonState
  connection?: {
    appliedRevision?: number
    cellId?: string
    compileRevision?: number
    lastError?: string
    lastReport?: string
    model: string
    name: string
    os: string
    remoteAddress?: string
    revision: StudioDevicePanelRevision
    revisionLabel: string
    scenarioLabel?: string
    state: StudioDeviceConnectionState
    transport: 'LAN'
  }
  gateway?: { hosts: readonly string[]; port: number; studioFingerprint: string }
  install: {
    diagnostics: readonly StudioDeviceLaunchDiagnostic[]
    hosts: readonly StudioDevicePanelHost[]
    installCommand?: string
    /** The launcher is only injected by `runStudioDev`; a packaged Studio has no install or open facts. */
    unavailable?: string
  }
  pairing: {
    open: boolean
    pending?: { code: string; deviceLabel: string; devicePublicKey: string; fingerprint: string }
    remainingSeconds?: number
  }
  trusted: readonly {
    devicePublicKey: string
    fingerprint: string
    label: string
    lastSeenAt?: string
    pairedAt: string
  }[]
  unavailable?: string
  url?: string
}

type StudioDevicePanelContext = {
  compileRevision?: number
  launchUnavailable?: string
  now?: number
  unavailable?: string
}

/** StudioDevicePanelModel turns the gateway snapshot and launch facts into exactly what the popover shows. */
export const StudioDevicePanelModel = {
  /** Mirrors `StudioDeviceTrust.formatCode` without pulling the trust module and its crypto into the browser. */
  formatCode(code: string): string {
    return `${code.slice(0, 3)} ${code.slice(3)}`
  },
  /** A packaged Studio answers 501 for the gateway routes; anything else is a real failure worth its message. */
  gatewayUnavailableMessage(error: unknown): string {
    return error instanceof StudioApiError && error.status === 501
      ? 'Device gateway is unavailable in this Studio build.'
      : errorMessage(error)
  },
  fromStatus(
    status: StudioDeviceStatus | undefined,
    launch?: StudioDeviceLaunchInfo,
    context: StudioDevicePanelContext = {},
  ): StudioDevicePanelModel {
    const install = installModel(launch, context.launchUnavailable)
    if (status === undefined) {
      return {
        buttonLabel: 'Device',
        buttonState: 'unavailable',
        install,
        pairing: { open: false },
        trusted: [],
        unavailable: context.unavailable ?? 'Device gateway status is not available yet.',
        url: launch?.url,
      }
    }
    const connection = connectionModel(status, context.compileRevision)
    const pending = status.pairing.pending
    const pairing: StudioDevicePanelModel['pairing'] = {
      open: status.pairing.open,
      pending: pending === undefined ? undefined : {
        code: StudioDevicePanelModel.formatCode(pending.code),
        deviceLabel: deviceLabel(pending.device),
        devicePublicKey: pending.devicePublicKey,
        fingerprint: pending.fingerprint,
      },
      remainingSeconds: remainingSeconds(status.pairing.expiresAt, status.pairing.open, context.now ?? Date.now()),
    }
    const pairingActive = pending !== undefined || status.pairing.open || connection?.state === 'pairing'
    const buttonState: StudioDevicePanelButtonState = connection?.state === 'connected'
      ? (connection.revision === 'behind' ? 'behind' : 'connected')
      : pairingActive
      ? 'pairing'
      : connection === undefined
      ? 'idle'
      : 'connected'
    const buttonLabel = buttonState === 'behind'
      ? 'Device · behind'
      : buttonState === 'pairing'
      ? 'Device · pairing'
      : buttonState === 'connected' && connection !== undefined
      ? `Device · ${connection.name}`
      : 'Device'
    return {
      buttonLabel,
      buttonState,
      connection,
      gateway: {
        hosts: status.gateway.hosts,
        port: status.gateway.port,
        studioFingerprint: status.gateway.studioFingerprint,
      },
      install,
      pairing,
      trusted: status.trusted.map(device => ({
        devicePublicKey: device.devicePublicKey,
        fingerprint: device.fingerprint,
        label: deviceLabel(device.device),
        lastSeenAt: device.lastSeenAt,
        pairedAt: device.pairedAt,
      })),
      url: launch?.url,
    }
  },
} as const

/** StudioDeviceQr renders the dev-client URL as an inline SVG so a phone camera can open it. */
export const StudioDeviceQr = {
  async svg(url: string): Promise<string> {
    return await QRCode.toString(url, { margin: 1, type: 'svg' })
  },
} as const

export function createStudioDevicePanel(options: StudioDevicePanelOptions): StudioDevicePanelController {
  const { api, button, popover } = options
  let status: StudioDeviceStatus | undefined
  let unavailable: string | undefined
  let launch: StudioDeviceLaunchInfo | undefined
  let launchUnavailable: string | undefined
  let compileRevision = options.handshake.compile.compileRevision
  let manifest = options.handshake.previewManifest
  let busy = false
  let disposed = false
  let qrVisible = false
  let qrSvg: { svg: string; url: string } | undefined
  let countdown: HTMLElement | undefined
  let countdownTimer: ReturnType<typeof setInterval> | undefined
  const statusElement = document.createElement('p')
  statusElement.className = 'studio-device-status'
  statusElement.setAttribute('role', 'status')
  statusElement.hidden = true

  const model = (): StudioDevicePanelModel =>
    StudioDevicePanelModel.fromStatus(status, launch, { compileRevision, launchUnavailable, unavailable })

  const showMessage = (message: string, state: 'error' | 'info'): void => {
    statusElement.hidden = false
    statusElement.dataset['state'] = state
    statusElement.textContent = message
    if (state === 'info') {
      options.onStatusMessage?.(message)
    }
  }

  const run = async (action: () => Promise<string | undefined>): Promise<void> => {
    if (busy || disposed) {
      return
    }
    busy = true
    render()
    try {
      const message = await action()
      if (message !== undefined) {
        showMessage(message, 'info')
      }
    } catch (error) {
      showMessage(errorMessage(error), 'error')
    } finally {
      busy = false
      if (!disposed) {
        render()
      }
    }
  }

  const refreshLaunch = (): void => {
    void api.deviceLaunch().then(info => {
      launch = info
      launchUnavailable = undefined
    }).catch(error => {
      launch = undefined
      launchUnavailable = error instanceof StudioApiError && error.status === 501
        ? 'Install and open need the host launcher; start Studio through ./dev studio.'
        : errorMessage(error)
    }).finally(() => {
      if (!disposed) {
        render()
      }
    })
  }

  const showQr = async (url: string): Promise<void> => {
    if (qrSvg?.url === url) {
      return
    }
    const svg = await StudioDeviceQr.svg(url)
    qrSvg = { svg, url }
  }

  const syncCountdown = (): void => {
    const current = model()
    if (countdown !== undefined) {
      countdown.textContent = countdownLabel(current.pairing)
    }
    if (current.pairing.open && current.pairing.remainingSeconds !== undefined && countdownTimer === undefined) {
      countdownTimer = setInterval(() => {
        const next = model()
        if (countdown !== undefined) {
          countdown.textContent = countdownLabel(next.pairing)
        }
        if (!next.pairing.open || next.pairing.remainingSeconds === 0) {
          stopCountdown()
        }
      }, 1_000)
    } else if (!current.pairing.open) {
      stopCountdown()
    }
  }

  const stopCountdown = (): void => {
    if (countdownTimer !== undefined) {
      clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  }

  function render(): void {
    const current = model()
    button.textContent = current.buttonLabel
    button.dataset['state'] = current.buttonState
    button.setAttribute('aria-expanded', popover.hidden ? 'false' : 'true')
    if (popover.hidden) {
      return
    }
    countdown = undefined
    popover.replaceChildren(
      renderInstall(current),
      renderUrl(current),
      renderPairing(current),
      renderConnection(current),
      renderTrusted(current),
      renderGateway(current),
      statusElement,
    )
    syncCountdown()
  }

  function renderInstall(current: StudioDevicePanelModel): HTMLElement {
    const body: Node[] = []
    if (current.install.unavailable !== undefined) {
      body.push(note(current.install.unavailable))
    }
    for (const host of current.install.hosts) {
      const open = (route: 'auto' | 'cable', label: string): HTMLButtonElement => {
        const openButton = actionButton('studio-device-open', label, () =>
          void run(async () => {
            const result = await api.deviceLaunchOpen(host.id, route)
            return `Opened Tao Companion on ${result.hostName} over ${route === 'cable' ? 'cable' : 'LAN'}.`
          }))
        openButton.dataset['hostId'] = host.id
        openButton.dataset['route'] = route
        openButton.disabled = busy || !host.canOpen
        return openButton
      }
      const openButton = host.kind === 'simulator'
        ? open('auto', 'Open in simulator')
        : actions(open('auto', 'Open over LAN'), open('cable', 'Open over cable'))
      body.push(row(host.name, host.installed, openButton))
    }
    if (current.install.unavailable === undefined && current.install.hosts.length === 0) {
      body.push(note('No physical device is connected to this Mac.'))
    }
    if (current.install.installCommand !== undefined) {
      body.push(note('Install the companion build once, then open it from here:'))
      body.push(codeBlock('studio-device-install-command', current.install.installCommand))
    }
    if (current.install.diagnostics.length > 0) {
      const list = document.createElement('ul')
      list.className = 'studio-device-diagnostics'
      for (const diagnostic of current.install.diagnostics) {
        const item = document.createElement('li')
        item.className = 'studio-device-diagnostic'
        item.dataset['layer'] = diagnostic.layer
        item.textContent = `${diagnostic.layer}: ${diagnostic.message}`
        list.append(item)
      }
      body.push(list)
    }
    return section('Install & open', body)
  }

  function renderUrl(current: StudioDevicePanelModel): HTMLElement {
    const url = current.url
    if (url === undefined) {
      qrVisible = false
      return section('Device URL', [note('The dev-client URL appears once the host launcher describes this project.')])
    }
    const code = codeBlock('studio-device-url', url)
    const copy = actionButton('studio-device-copy-url', 'Copy URL', () => {
      const clipboard = options.clipboard ?? globalThis.navigator?.clipboard
      if (clipboard === undefined) {
        selectText(code)
        showMessage('Clipboard is unavailable; the URL is selected for copying.', 'info')
        return
      }
      void clipboard.writeText(url).then(() => showMessage('Device URL copied.', 'info')).catch(error => {
        selectText(code)
        showMessage(errorMessage(error), 'error')
      })
    })
    const qrButton = actionButton('studio-device-qr', qrVisible ? 'Hide QR' : 'Show QR', () => {
      qrVisible = !qrVisible
      if (!qrVisible) {
        render()
        return
      }
      void showQr(url).then(() => render()).catch(error => {
        qrVisible = false
        showMessage(errorMessage(error), 'error')
        render()
      })
    })
    qrButton.setAttribute('aria-pressed', qrVisible ? 'true' : 'false')
    const body: Node[] = [code, actions(copy, qrButton)]
    if (qrVisible && qrSvg?.url === url) {
      const box = document.createElement('div')
      box.className = 'studio-device-qr-box'
      box.setAttribute('aria-label', 'QR code for the device URL')
      box.innerHTML = qrSvg.svg
      body.push(box)
    }
    return section('Device URL', body)
  }

  function renderPairing(current: StudioDevicePanelModel): HTMLElement {
    const body: Node[] = []
    const pair = actionButton('studio-device-pair', 'Pair a device', () =>
      void run(async () => {
        const result = await api.deviceOpenPairing()
        if (status !== undefined) {
          status = { ...status, pairing: { ...status.pairing, expiresAt: result.expiresAt, open: true } }
        }
        return 'Pairing is open; launch Tao Companion on the phone.'
      }))
    pair.disabled = busy || current.unavailable !== undefined || current.pairing.pending !== undefined
    countdown = document.createElement('span')
    countdown.className = 'studio-device-countdown'
    countdown.textContent = countdownLabel(current.pairing)
    body.push(actions(pair, countdown))
    const pending = current.pairing.pending
    if (pending !== undefined) {
      const code = document.createElement('strong')
      code.className = 'studio-device-code'
      code.textContent = pending.code
      body.push(note('Compare this code with the phone, then trust it:'))
      body.push(code)
      body.push(row(pending.deviceLabel, pending.fingerprint))
      const trust = actionButton('studio-device-trust', 'Trust', () =>
        void run(async () => {
          await api.deviceConfirmPairing(pending.devicePublicKey)
          return `Trusted ${pending.deviceLabel}.`
        }))
      const decline = actionButton('studio-device-decline', 'Decline', () =>
        void run(async () => {
          await api.deviceDeclinePairing(pending.devicePublicKey)
          return `Declined ${pending.deviceLabel}.`
        }))
      trust.disabled = busy
      decline.disabled = busy
      body.push(actions(trust, decline))
    }
    return section('Pairing', body)
  }

  function renderConnection(current: StudioDevicePanelModel): HTMLElement {
    const body: Node[] = []
    const connection = current.connection
    if (connection === undefined) {
      body.push(note(current.unavailable ?? 'No device is connected.'))
    } else {
      body.push(row('Device', `${connection.name} · ${connection.model} · ${connection.os}`))
      body.push(row('Transport', connection.transport))
      if (connection.remoteAddress !== undefined) {
        body.push(row('Address', connection.remoteAddress))
      }
      body.push(row('State', connection.state))
      if (connection.scenarioLabel !== undefined) {
        body.push(row('Scenario', connection.scenarioLabel))
      }
      const revision = document.createElement('span')
      revision.className = 'studio-device-revision'
      revision.dataset['revision'] = connection.revision
      revision.textContent = connection.revisionLabel
      body.push(row('Revision', revision))
      if (connection.lastReport !== undefined) {
        body.push(row('Last report', connection.lastReport))
      }
      if (connection.lastError !== undefined) {
        body.push(row('Last error', connection.lastError))
      }
    }
    const reconnect = actionButton('studio-device-reconnect', 'Reconnect', () =>
      void run(async () => {
        await api.deviceReconnect()
        return 'Reconnect requested; the device dials again.'
      }))
    reconnect.disabled = busy || connection === undefined
    const scenario = document.createElement('select')
    scenario.className = 'studio-device-scenario'
    scenario.setAttribute('aria-label', 'Scenario on device')
    const cells = manifest?.cells ?? []
    for (const cell of cells) {
      const option = document.createElement('option')
      option.value = cell.cellId
      option.textContent = scenarioOptionLabel(manifest, cell.scenarioId, cell.cellId)
      option.selected = cell.cellId === connection?.cellId
      scenario.append(option)
    }
    if (connection?.cellId !== undefined) {
      scenario.value = connection.cellId
    }
    scenario.disabled = busy || connection === undefined || cells.length === 0
    scenario.addEventListener('change', () => {
      const cellId = scenario.value
      void run(async () => {
        await api.deviceSelectCell(cellId)
        return `Requested ${scenarioOptionLabel(manifest, cellFor(cellId)?.scenarioId, cellId)} on the device.`
      })
    })
    body.push(actions(reconnect, scenario))
    return section('Connection', body)
  }

  function renderTrusted(current: StudioDevicePanelModel): HTMLElement {
    const body: Node[] = []
    if (current.trusted.length === 0) {
      body.push(note('No trusted devices yet.'))
    }
    for (const device of current.trusted) {
      const revoke = actionButton('studio-device-revoke', 'Revoke', () =>
        void run(async () => {
          await api.deviceRevoke(device.devicePublicKey)
          return `Revoked ${device.label}.`
        }))
      revoke.dataset['devicePublicKey'] = device.devicePublicKey
      revoke.disabled = busy
      const seen = device.lastSeenAt === undefined ? '' : ` · seen ${shortTime(device.lastSeenAt)}`
      body.push(row(device.label, `${device.fingerprint} · paired ${shortTime(device.pairedAt)}${seen}`, revoke))
    }
    return section('Trusted devices', body)
  }

  function renderGateway(current: StudioDevicePanelModel): HTMLElement {
    const gateway = current.gateway
    if (gateway === undefined) {
      return section('Gateway', [note(current.unavailable ?? 'Gateway status is not available.')])
    }
    return section('Gateway', [
      row('Port', String(gateway.port)),
      row('Hosts', gateway.hosts.length === 0 ? 'none' : gateway.hosts.join(', ')),
      row('Studio fingerprint', gateway.studioFingerprint),
    ])
  }

  function cellFor(cellId: string): StudioPreviewManifestV2['cells'][number] | undefined {
    return manifest?.cells.find(cell => cell.cellId === cellId)
  }

  const toggle = (): void => {
    if (popover.hidden) {
      controller.open()
    } else {
      controller.close()
    }
  }
  const outsidePointer = (event: Event): void => {
    if (popover.hidden) {
      return
    }
    const target = event.target as Node | null
    if (target !== null && (popover.contains(target) || button.contains(target))) {
      return
    }
    controller.close()
  }
  const escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !popover.hidden) {
      controller.close()
    }
  }
  button.addEventListener('click', toggle)
  document.addEventListener('pointerdown', outsidePointer)
  document.addEventListener('keydown', escape)

  const controller: StudioDevicePanelController = {
    close() {
      if (popover.hidden) {
        return
      }
      popover.hidden = true
      stopCountdown()
      countdown = undefined
      render()
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      button.removeEventListener('click', toggle)
      document.removeEventListener('pointerdown', outsidePointer)
      document.removeEventListener('keydown', escape)
      stopCountdown()
      popover.hidden = true
      popover.replaceChildren()
      button.setAttribute('aria-expanded', 'false')
    },
    model,
    open() {
      if (disposed || !popover.hidden) {
        return
      }
      popover.hidden = false
      render()
      refreshLaunch()
    },
    setCompileState(state) {
      compileRevision = state.compileRevision
      render()
    },
    setGatewayUnavailable(message) {
      status = undefined
      unavailable = message
      render()
    },
    setManifest(next) {
      manifest = next
      render()
    },
    setStatus(next) {
      status = next
      unavailable = undefined
      render()
    },
  }
  render()
  return controller
}

function installModel(
  launch: StudioDeviceLaunchInfo | undefined,
  unavailable?: string,
): StudioDevicePanelModel['install'] {
  if (launch === undefined) {
    return { diagnostics: [], hosts: [], unavailable: unavailable ?? 'Checking connected devices…' }
  }
  const hosts = launch.hosts.map(host => ({
    canOpen: host.installed !== false,
    id: host.id,
    installed: host.installed === undefined
      ? 'unknown' as const
      : host.installed
      ? 'installed' as const
      : 'not installed' as const,
    kind: host.kind,
    name: host.name,
  }))
  const anyInstalled = hosts.some(host => host.installed === 'installed')
  return {
    diagnostics: launch.diagnostics,
    hosts,
    installCommand: anyInstalled ? undefined : launch.installCommand,
  }
}

function connectionModel(
  status: StudioDeviceStatus,
  compileRevision: number | undefined,
): StudioDevicePanelModel['connection'] {
  const connection = status.connection
  if (connection === undefined) {
    return undefined
  }
  const applied = connection.appliedRevision
  const revision: StudioDevicePanelRevision = applied === undefined || compileRevision === undefined
    ? 'unknown'
    : applied >= compileRevision
    ? 'applied'
    : 'behind'
  const revisionLabel = revision === 'applied'
    ? `applied ✓ (${applied})`
    : revision === 'behind'
    ? `behind — device ${applied}, Studio ${compileRevision}`
    : compileRevision === undefined
    ? 'not reported'
    : `not reported — Studio ${compileRevision}`
  return {
    appliedRevision: applied,
    cellId: connection.cellId,
    compileRevision,
    lastError: connection.lastError,
    lastReport: connection.lastReport === undefined
      ? undefined
      : `${connection.lastReport.level}: ${connection.lastReport.message}`,
    model: connection.device.model,
    name: connection.device.name,
    os: connection.device.os,
    remoteAddress: connection.remoteAddress,
    revision,
    revisionLabel,
    scenarioLabel: connection.scenarioLabel,
    state: connection.state,
    transport: 'LAN',
  }
}

function remainingSeconds(expiresAt: string | undefined, open: boolean, now: number): number | undefined {
  if (!open || expiresAt === undefined) {
    return undefined
  }
  const expiry = Date.parse(expiresAt)
  if (Number.isNaN(expiry)) {
    return undefined
  }
  return Math.max(0, Math.ceil((expiry - now) / 1_000))
}

function countdownLabel(pairing: StudioDevicePanelModel['pairing']): string {
  if (!pairing.open) {
    return 'Pairing closed'
  }
  return pairing.remainingSeconds === undefined ? 'Pairing open' : `Pairing open · ${pairing.remainingSeconds}s left`
}

function deviceLabel(device: { model: string; name: string }): string {
  return `${device.name} (${device.model})`
}

function scenarioOptionLabel(
  manifest: StudioPreviewManifestV2 | undefined,
  scenarioId: string | undefined,
  cellId: string,
): string {
  const scenario = manifest?.scenarios.find(candidate => candidate.scenarioId === scenarioId)
  return scenario === undefined ? cellId : `${scenario.label} — ${scenario.group}`
}

function shortTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

/** A rejected fetch or a DOM event carries no `message`, so name the value rather than print `[object Object]`. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (typeof error === 'object' && error !== null) {
    const carried = (error as { message?: unknown }).message
    return typeof carried === 'string' && carried.trim().length > 0
      ? carried
      : `${error.constructor?.name ?? 'object'} (no message)`
  }
  return String(error)
}

function section(title: string, body: readonly Node[]): HTMLElement {
  const element = document.createElement('section')
  element.className = 'studio-device-section'
  const heading = document.createElement('h3')
  heading.textContent = title
  element.append(heading, ...body)
  return element
}

function row(label: string, value: string | Node, action?: HTMLElement): HTMLElement {
  const element = document.createElement('div')
  element.className = 'studio-device-row'
  const key = document.createElement('span')
  key.className = 'studio-device-row-label'
  key.textContent = label
  const content = document.createElement('span')
  content.className = 'studio-device-row-value'
  content.append(value)
  element.append(key, content)
  if (action !== undefined) {
    element.append(action)
  }
  return element
}

function note(text: string): HTMLElement {
  const element = document.createElement('p')
  element.className = 'studio-device-note'
  element.textContent = text
  return element
}

function codeBlock(className: string, text: string): HTMLElement {
  const element = document.createElement('code')
  element.className = `studio-device-code-block ${className}`
  element.textContent = text
  element.tabIndex = 0
  return element
}

function actions(...children: readonly Node[]): HTMLElement {
  const element = document.createElement('div')
  element.className = 'studio-device-actions'
  element.append(...children)
  return element
}

function actionButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button')
  element.className = className
  element.type = 'button'
  element.textContent = label
  element.addEventListener('click', onClick)
  return element
}

function selectText(element: HTMLElement): void {
  const selection = globalThis.getSelection?.()
  if (selection === null || selection === undefined || typeof document.createRange !== 'function') {
    return
  }
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}
