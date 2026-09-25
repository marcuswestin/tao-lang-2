import { Errors } from '@shared/core'
import { Expect, Test, until } from '@shared/test'
import { StudioApiError, type StudioHandshake } from '../studio-src/client/StudioApiClient'
import { StudioDeviceCapture } from '../studio-src/client/StudioDeviceCapture'
import {
  createStudioDevicePanel,
  type StudioDevicePanelApi,
  StudioDevicePanelModel,
  StudioDeviceQr,
} from '../studio-src/client/StudioDevicePanel'
import { studioShellMarkup } from '../studio-src/client/StudioShell'
import type { StudioDeviceLaunchInfo } from '../studio-src/device/StudioDeviceLauncher'
import type { StudioDeviceStatus } from '../studio-src/device/StudioDeviceStatus'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { cellEnvironment } from './test-studio-fixtures'

const phone = { model: 'iPhone 16 Pro', name: 'the Developer’s iPhone', os: 'iOS 19.1' }
const phoneKey = 'ZGV2aWNlLXB1YmxpYy1rZXk='
const tabletKey = 'dGFibGV0LXB1YmxpYy1rZXk='
const deviceUrl = 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.4.20%3A8081'

const idleStatus: StudioDeviceStatus = {
  gateway: { hosts: ['192.168.4.20', '169.254.7.9'], port: 8765, studioFingerprint: 'AB12 CD34 EF56' },
  pairing: { open: false },
  sessionId: 'session-1',
  trusted: [],
}

const launchInfo: StudioDeviceLaunchInfo = {
  bundleIdentifier: 'com.devtao.studio.companion',
  candidates: ['192.168.4.20'],
  diagnostics: [],
  hosts: [{ id: 'host-1', installed: true, kind: 'device', name: 'the Developer’s iPhone' }],
  installCommand: 'just studio-companion-install device="the Developer’s iPhone"',
  metroPort: 8081,
  scheme: 'taostudiocompanion',
  url: deviceUrl,
}

const manifest = {
  cells: [
    { args: {}, cellId: 'cell-home', cellRevision: 1, environment: {}, scenarioId: 'home', stateLayers: [] },
    { args: {}, cellId: 'cell-settings', cellRevision: 1, environment: {}, scenarioId: 'settings', stateLayers: [] },
  ],
  scenarios: [
    { group: 'Home', label: 'Home · signed in', scenarioId: 'home' },
    { group: 'Settings', label: 'Settings', scenarioId: 'settings' },
  ],
} as unknown as StudioPreviewManifestV2

const handshake: Pick<StudioHandshake, 'compile' | 'previewManifest'> = {
  compile: { appliedRevision: 5, compileRevision: 5, diagnostics: [], message: 'Compiled.', status: 'compiled' },
  previewManifest: manifest,
}

const unusedCaptureApi = {
  deviceCapture: async () => ({ error: 'Capture is not available in this test.' }),
  previewCell: async () => Errors.throwUnexpected('Preview cell is not available in this test.'),
  reconfigureCell: async () => Errors.throwUnexpected('Reconfigure is not available in this test.'),
}

Test('Studio device panel model explains a missing gateway and hides device facts', () => {
  const model = StudioDevicePanelModel.fromStatus(undefined, undefined, { unavailable: 'Device gateway is off.' })
  Expect(model.buttonLabel).toBe('Device')
  Expect(model.buttonState).toBe('unavailable')
  Expect(model.unavailable).toBe('Device gateway is off.')
  Expect(model.connection).toBeUndefined()
  Expect(model.gateway).toBeUndefined()
  Expect(model.install.unavailable).toBe('Checking connected devices…')
  Expect(model.trusted).toEqual([])
  Expect(StudioDevicePanelModel.gatewayUnavailableMessage(new StudioApiError('Not Implemented', 501))).toBe(
    'Device gateway is unavailable in this Studio build.',
  )
  Expect(StudioDevicePanelModel.gatewayUnavailableMessage(new StudioApiError('Session is gone.', 404))).toBe(
    'Session is gone.',
  )
})

Test('Studio device panel model counts down an open pairing window and formats the pending code', () => {
  const now = Date.parse('2026-09-02T10:00:00.000Z')
  const open = StudioDevicePanelModel.fromStatus(
    {
      ...idleStatus,
      pairing: { expiresAt: '2026-09-02T10:01:30.500Z', open: true },
    },
    launchInfo,
    { now },
  )
  Expect(open.buttonLabel).toBe('Device · pairing')
  Expect(open.pairing).toEqual({ open: true, pending: undefined, remainingSeconds: 91 })
  Expect(open.url).toBe(deviceUrl)

  const expired = StudioDevicePanelModel.fromStatus(
    {
      ...idleStatus,
      pairing: { expiresAt: '2026-09-02T09:59:00.000Z', open: true },
    },
    undefined,
    { now },
  )
  Expect(expired.pairing.remainingSeconds).toBe(0)

  const pending = StudioDevicePanelModel.fromStatus(
    {
      ...idleStatus,
      connection: { device: phone, fingerprint: 'F1', state: 'pairing', transport: 'lan' },
      pairing: {
        expiresAt: '2026-09-02T10:02:00.000Z',
        open: true,
        pending: { code: '042917', device: phone, devicePublicKey: phoneKey, fingerprint: 'F1' },
      },
    },
    undefined,
    { now },
  )
  Expect(pending.buttonLabel).toBe('Device · pairing')
  Expect(pending.pairing.pending).toEqual({
    code: '042 917',
    deviceLabel: 'the Developer’s iPhone (iPhone 16 Pro)',
    devicePublicKey: phoneKey,
    fingerprint: 'F1',
  })
  Expect(pending.pairing.remainingSeconds).toBe(120)
  Expect(StudioDevicePanelModel.fromStatus(idleStatus, undefined, { now }).pairing.remainingSeconds).toBeUndefined()
})

Test('Studio device panel model marks a connected device applied or behind the Studio compile revision', () => {
  const connected: StudioDeviceStatus = {
    ...idleStatus,
    connection: {
      appliedRevision: 5,
      cellId: 'cell-home',
      device: phone,
      fingerprint: 'F1',
      lastReport: { level: 'info', message: 'Rendered Home.' },
      remoteAddress: '192.168.4.31',
      scenarioLabel: 'Home · signed in',
      state: 'connected',
      transport: 'lan',
    },
  }
  const applied = StudioDevicePanelModel.fromStatus(connected, launchInfo, { compileRevision: 5 })
  Expect(applied.buttonLabel).toBe('Device · the Developer’s iPhone')
  Expect(applied.buttonState).toBe('connected')
  Expect(applied.connection).toEqual({
    appliedRevision: 5,
    cellId: 'cell-home',
    compileRevision: 5,
    lastError: undefined,
    lastReport: 'info: Rendered Home.',
    model: 'iPhone 16 Pro',
    name: 'the Developer’s iPhone',
    os: 'iOS 19.1',
    remoteAddress: '192.168.4.31',
    revision: 'applied',
    revisionLabel: 'applied ✓ (5)',
    scenarioLabel: 'Home · signed in',
    state: 'connected',
    transport: 'LAN',
  })
  Expect(applied.install.hosts).toEqual([{
    canOpen: true,
    id: 'host-1',
    installed: 'installed',
    kind: 'device',
    name: 'the Developer’s iPhone',
  }])
  Expect(applied.install.installCommand).toBeUndefined()

  const behind = StudioDevicePanelModel.fromStatus(connected, undefined, { compileRevision: 7 })
  Expect(behind.buttonLabel).toBe('Device · behind')
  Expect(behind.buttonState).toBe('behind')
  Expect(behind.connection?.revision).toBe('behind')
  Expect(behind.connection?.revisionLabel).toBe('behind — device 5, Studio 7')

  const unreported = StudioDevicePanelModel.fromStatus(
    {
      ...connected,
      connection: { ...connected.connection!, appliedRevision: undefined, lastError: 'Bundle failed to load.' },
    },
    undefined,
    { compileRevision: 7 },
  )
  Expect(unreported.connection?.revision).toBe('unknown')
  Expect(unreported.connection?.revisionLabel).toBe('not reported — Studio 7')
  Expect(unreported.connection?.lastError).toBe('Bundle failed to load.')
  Expect(unreported.buttonLabel).toBe('Device · the Developer’s iPhone')

  const handshaking = StudioDevicePanelModel.fromStatus({
    ...idleStatus,
    connection: { device: phone, fingerprint: 'F1', state: 'handshaking', transport: 'lan' },
  })
  Expect(handshaking.buttonLabel).toBe('Device · the Developer’s iPhone')
})

Test('Studio device panel model lists trusted devices, the gateway, and install facts for uninstalled hosts', () => {
  const model = StudioDevicePanelModel.fromStatus({
    ...idleStatus,
    trusted: [
      {
        device: phone,
        devicePublicKey: phoneKey,
        fingerprint: 'F1',
        lastSeenAt: '2026-09-02T09:58:00.000Z',
        pairedAt: '2026-09-01T18:00:00.000Z',
      },
      {
        device: { model: 'iPad Air', name: 'Studio iPad', os: 'iPadOS 19' },
        devicePublicKey: tabletKey,
        fingerprint: 'F2',
        pairedAt: '2026-08-30T08:00:00.000Z',
      },
    ],
  }, {
    ...launchInfo,
    diagnostics: [{ layer: 'devicectl', message: 'Xcode command line tools are not selected.' }],
    hosts: [{ id: 'host-1', installed: false, kind: 'device', name: 'the Developer’s iPhone' }, {
      id: 'host-2',
      kind: 'simulator',
      name: 'iPhone 17 Pro (iOS 26.5 Simulator)',
    }],
    url: undefined,
  })
  Expect(model.buttonLabel).toBe('Device')
  Expect(model.buttonState).toBe('idle')
  Expect(model.trusted).toEqual([
    {
      devicePublicKey: phoneKey,
      fingerprint: 'F1',
      label: 'the Developer’s iPhone (iPhone 16 Pro)',
      lastSeenAt: '2026-09-02T09:58:00.000Z',
      pairedAt: '2026-09-01T18:00:00.000Z',
    },
    {
      devicePublicKey: tabletKey,
      fingerprint: 'F2',
      label: 'Studio iPad (iPad Air)',
      lastSeenAt: undefined,
      pairedAt: '2026-08-30T08:00:00.000Z',
    },
  ])
  Expect(model.gateway).toEqual({
    hosts: ['192.168.4.20', '169.254.7.9'],
    port: 8765,
    studioFingerprint: 'AB12 CD34 EF56',
  })
  Expect(model.install.hosts).toEqual([
    { canOpen: false, id: 'host-1', installed: 'not installed', kind: 'device', name: 'the Developer’s iPhone' },
    {
      canOpen: true,
      id: 'host-2',
      installed: 'unknown',
      kind: 'simulator',
      name: 'iPhone 17 Pro (iOS 26.5 Simulator)',
    },
  ])
  Expect(model.install.installCommand).toBe('just studio-companion-install device="the Developer’s iPhone"')
  Expect(model.install.diagnostics).toEqual([{
    layer: 'devicectl',
    message: 'Xcode command line tools are not selected.',
  }])
  Expect(model.url).toBeUndefined()
})

Test('Studio shell places the Device button before Beta ship and a hidden popover outside every portal target', () => {
  const markup = studioShellMarkup()
  Expect(markup.indexOf('class="studio-device"')).toBeGreaterThan(markup.indexOf('studio-toolbar-actions'))
  Expect(markup.indexOf('class="studio-device"')).toBeLessThan(markup.indexOf('class="studio-beta-ship"'))
  Expect(markup).toContain('<section class="studio-device-popover" hidden role="dialog"')
  Expect(markup.indexOf('studio-device-popover')).toBeLessThan(markup.indexOf('class="studio-body"'))
})

Test('Studio device capture saves an app-bound artifact and restores through a fresh cell identity', async () => {
  const dom = installFakeDocument()
  try {
    const captureManifest = {
      ...manifest,
      cells: [{ ...manifest.cells[0]!, environment: cellEnvironment() }],
      project: { appName: 'Garden', entryPath: 'Garden.tao', root: '/tmp/garden' },
    } as StudioPreviewManifestV2
    const artifact = { capturedAt: 42, domains: [], version: 1 as const }
    const downloads: { name: string; content: string }[] = []
    const requests: unknown[] = []
    const identity = {
      appName: 'Garden',
      cellId: 'cell-home',
      cellRevision: 7,
      compileRevision: 9,
      manifestRevision: 'latest',
      project: '/tmp/garden',
    }
    const api: StudioDevicePanelApi = {
      ...unusedCaptureApi,
      deviceCapture: async () => ({ capture: artifact }),
      deviceConfirmPairing: async () => ({ accepted: true }),
      deviceDeclinePairing: async () => ({ declined: true }),
      deviceLaunch: async () => launchInfo,
      deviceLaunchOpen: async () => ({ hostName: 'the Developer’s iPhone', launched: true, url: deviceUrl }),
      deviceOpenPairing: async () => ({ expiresAt: new Date().toISOString() }),
      deviceReconnect: async () => ({ requested: true }),
      deviceRevoke: async () => ({ revoked: true }),
      deviceSelectCell: async () => ({ requested: true }),
      previewCell: async () => ({ cell: captureManifest.cells[0]!, identity }),
      reconfigureCell: async body => {
        requests.push(body)
        return { cell: captureManifest.cells[0]!, identity }
      },
    }
    const button = dom.element('button') as unknown as HTMLButtonElement
    const popover = dom.element('section') as unknown as HTMLElement
    popover.hidden = true
    const panel = createStudioDevicePanel({
      api,
      button,
      handshake: { ...handshake, previewManifest: captureManifest },
      popover,
      downloadCapture: (name, content) => downloads.push({ name, content }),
    })
    panel.setStatus({
      ...idleStatus,
      connection: { cellId: 'cell-home', device: phone, fingerprint: 'F1', state: 'connected', transport: 'lan' },
    })
    panel.open()
    dom.click(dom.find(popover, 'studio-device-capture')!)
    await until(() => downloads.length === 1)
    Expect(downloads[0]!.name).toContain('Garden-home-42.json')
    const saved = StudioDeviceCapture.parse(JSON.parse(downloads[0]!.content))
    Expect(saved).toMatchObject({ appName: 'Garden', project: '/tmp/garden', scenarioId: 'home' })
    await until(() => dom.find(popover, 'studio-device-restore')?.disabled === false)
    dom.click(dom.find(popover, 'studio-device-restore')!)
    await until(() => requests.length === 1)
    Expect(requests[0]).toMatchObject({ ...identity, replay: { capturedAt: 42, version: 1 } })
    await until(() => dom.find(popover, 'studio-device-remount')?.disabled === false)
    dom.click(dom.find(popover, 'studio-device-remount')!)
    await until(() => requests.length === 2)
    Expect(requests[1]).toEqual(identity)
    const file = dom.find(popover, 'studio-device-capture-file')!
    Object.defineProperty(file, 'files', {
      configurable: true,
      value: [{ text: async () => JSON.stringify({ ...saved, appName: 'Other' }) }],
    })
    file.dispatchEvent({ target: file, type: 'change' })
    await until(() =>
      dom.find(popover, 'studio-device-status')?.textContent
        === 'Choose a device cell from the same app and scenario as this capture.'
    )
    Expect(requests).toHaveLength(2)
    panel.dispose()
  } finally {
    dom.restore()
  }
})

Test('Studio device panel drives pairing, launch, scenario, and revoke requests through the API', async () => {
  const dom = installFakeDocument()
  try {
    const calls: string[] = []
    let launchDescriptions = 0
    const api: StudioDevicePanelApi = {
      async deviceCapture() {
        calls.push('capture')
        return { error: 'The device is not ready to capture.' }
      },
      async deviceConfirmPairing(key) {
        calls.push(`confirm:${key}`)
        return { accepted: true }
      },
      async deviceDeclinePairing(key) {
        calls.push(`decline:${key}`)
        return { declined: true }
      },
      async deviceLaunch() {
        launchDescriptions += 1
        return launchInfo
      },
      async deviceLaunchOpen(hostId, route) {
        calls.push(`open:${hostId}:${route}`)
        return { hostName: 'the Developer’s iPhone', launched: true, url: deviceUrl }
      },
      async deviceOpenPairing() {
        calls.push('pair')
        return { expiresAt: new Date(Date.now() + 120_000).toISOString() }
      },
      async deviceReconnect() {
        calls.push('reconnect')
        return { requested: true }
      },
      async deviceRevoke(key) {
        calls.push(`revoke:${key}`)
        return { revoked: true }
      },
      async deviceSelectCell(cellId) {
        calls.push(`select:${cellId}`)
        return { requested: true }
      },
      async previewCell() {
        Errors.throwUnexpected('No capture selected.')
      },
      async reconfigureCell() {
        Errors.throwUnexpected('No capture selected.')
      },
    }
    const button = dom.element('button') as unknown as HTMLButtonElement
    const popover = dom.element('section') as unknown as HTMLElement
    popover.hidden = true
    const panel = createStudioDevicePanel({ api, button, handshake, popover })
    panel.setStatus({
      ...idleStatus,
      connection: {
        appliedRevision: 5,
        cellId: 'cell-home',
        device: phone,
        fingerprint: 'F1',
        state: 'connected',
        transport: 'lan',
      },
      pairing: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        open: true,
        pending: { code: '123456', device: phone, devicePublicKey: phoneKey, fingerprint: 'F1' },
      },
      trusted: [{ device: phone, devicePublicKey: tabletKey, fingerprint: 'F2', pairedAt: '2026-09-01T18:00:00.000Z' }],
    })
    Expect(button.textContent).toBe('Device · the Developer’s iPhone')
    Expect(popover.hidden).toBe(true)
    Expect(launchDescriptions).toBe(0)

    dom.click(button)
    Expect(popover.hidden).toBe(false)
    Expect(button.getAttribute('aria-expanded')).toBe('true')
    await until(() => launchDescriptions === 1)
    await until(() => dom.find(popover, 'studio-device-open') !== undefined)
    Expect(dom.find(popover, 'studio-device-code')?.textContent).toBe('123 456')
    Expect(dom.find(popover, 'studio-device-url')?.textContent).toBe(deviceUrl)
    Expect(dom.find(popover, 'studio-device-install-command')).toBeUndefined()
    Expect(dom.find(popover, 'studio-device-countdown')?.textContent).toMatch(/^Pairing open · (59|60)s left$/)
    Expect(dom.find(popover, 'studio-device-revision')?.textContent).toBe('applied ✓ (5)')

    dom.click(dom.find(popover, 'studio-device-trust')!)
    await until(() => calls.includes(`confirm:${phoneKey}`))
    await until(() =>
      dom.find(popover, 'studio-device-status')?.textContent === 'Trusted the Developer’s iPhone (iPhone 16 Pro).'
    )
    const lanOpen = dom.find(popover, 'studio-device-open')!
    Expect(lanOpen.textContent).toBe('Open this app on device · LAN')
    Expect(lanOpen.parent?.children.find(child => child.dataset['route'] === 'cable')?.textContent).toBe(
      'Open this app on device · cable',
    )
    dom.click(lanOpen)
    await until(() => calls.includes('open:host-1:auto'))
    await until(() =>
      dom.find(popover, 'studio-device-status')?.textContent
        === 'Opened Tao Companion on the Developer’s iPhone over LAN.'
    )
    const cableOpen = dom.find(popover, 'studio-device-open')!.parent?.children.find(
      child => child.dataset['route'] === 'cable',
    )
    dom.click(cableOpen!)
    await until(() => calls.includes('open:host-1:cable'))
    dom.click(dom.find(popover, 'studio-device-revoke')!)
    await until(() => calls.includes(`revoke:${tabletKey}`))
    dom.click(dom.find(popover, 'studio-device-reconnect')!)
    await until(() => calls.includes('reconnect'))

    const scenario = dom.find(popover, 'studio-device-scenario')!
    Expect(scenario.children.map(option => option.textContent)).toEqual([
      'Home · signed in — Home',
      'Settings — Settings',
    ])
    Expect(scenario.value).toBe('cell-home')
    scenario.value = 'cell-settings'
    scenario.dispatchEvent({ target: scenario, type: 'change' })
    await until(() => calls.includes('select:cell-settings'))
    await until(() =>
      dom.find(popover, 'studio-device-status')?.textContent === 'Requested Settings — Settings on the device.'
    )

    panel.setCompileState({ compileRevision: 6 })
    Expect(dom.find(popover, 'studio-device-revision')?.textContent).toBe('behind — device 5, Studio 6')
    Expect(button.textContent).toBe('Device · behind')

    Expect(calls).toEqual([
      `confirm:${phoneKey}`,
      'open:host-1:auto',
      'open:host-1:cable',
      `revoke:${tabletKey}`,
      'reconnect',
      'select:cell-settings',
    ])
    panel.dispose()
  } finally {
    dom.restore()
  }
})

Test(
  'Studio device panel shows request failures inline, follows device-state events, and releases listeners',
  async () => {
    const dom = installFakeDocument()
    try {
      let pairAttempts = 0
      const api: StudioDevicePanelApi = {
        ...unusedCaptureApi,
        deviceConfirmPairing: async () => ({ accepted: true }),
        deviceDeclinePairing: async () => ({ declined: true }),
        deviceLaunch: async () => {
          throw new StudioApiError('Not Implemented', 501)
        },
        deviceLaunchOpen: async () => {
          throw new StudioApiError('devicectl: the Developer’s iPhone is locked.', 500)
        },
        deviceOpenPairing: async () => {
          pairAttempts += 1
          throw new StudioApiError('Pairing needs a running gateway.', 409)
        },
        deviceReconnect: async () => ({ requested: true }),
        deviceRevoke: async () => ({ revoked: true }),
        deviceSelectCell: async () => ({ requested: true }),
      }
      const button = dom.element('button') as unknown as HTMLButtonElement
      const popover = dom.element('section') as unknown as HTMLElement
      popover.hidden = true
      const panel = createStudioDevicePanel({ api, button, handshake, popover })
      panel.setGatewayUnavailable('Device gateway is unavailable in this Studio build.')
      Expect(button.textContent).toBe('Device')
      Expect(button.dataset['state']).toBe('unavailable')
      Expect(dom.documentListenerCount()).toBe(2)

      panel.open()
      await until(() =>
        dom.find(popover, 'studio-device-note')?.textContent
          === 'Install and open need the host launcher; start Studio through ./dev studio.'
      )
      Expect((dom.find(popover, 'studio-device-pair') as unknown as HTMLButtonElement).disabled).toBe(true)
      Expect(dom.find(popover, 'studio-device-status')?.hidden).toBe(true)

      panel.setStatus(idleStatus)
      Expect(button.dataset['state']).toBe('idle')
      const pair = dom.find(popover, 'studio-device-pair')!
      Expect((pair as unknown as HTMLButtonElement).disabled).toBe(false)
      dom.click(pair)
      await until(() => dom.find(popover, 'studio-device-status')?.textContent === 'Pairing needs a running gateway.')
      Expect(dom.find(popover, 'studio-device-status')?.dataset['state']).toBe('error')
      Expect(dom.find(popover, 'studio-device-status')?.hidden).toBe(false)
      Expect(pairAttempts).toBe(1)

      // A gateway event re-renders the open popover without another launch description.
      panel.setStatus({
        ...idleStatus,
        pairing: {
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          open: true,
          pending: { code: '987654', device: phone, devicePublicKey: phoneKey, fingerprint: 'F1' },
        },
      })
      Expect(button.textContent).toBe('Device · pairing')
      Expect(dom.find(popover, 'studio-device-code')?.textContent).toBe('987 654')
      Expect(dom.find(popover, 'studio-device-status')?.textContent).toBe('Pairing needs a running gateway.')

      dom.dispatchDocument('keydown', { key: 'Escape' })
      Expect(popover.hidden).toBe(true)
      Expect(button.getAttribute('aria-expanded')).toBe('false')

      panel.dispose()
      Expect(dom.documentListenerCount()).toBe(0)
      Expect(popover.children).toEqual([])
      dom.click(button)
      Expect(popover.hidden).toBe(true)
      panel.setStatus(idleStatus)
      Expect(popover.children).toEqual([])
    } finally {
      dom.restore()
    }
  },
)

Test('Studio device panel renders the dev-client URL as an SVG QR and copies it through the clipboard', async () => {
  const svg = await StudioDeviceQr.svg(deviceUrl)
  Expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  Expect(svg).toContain('viewBox="0 0 39 39"')
  Expect(svg).toContain('<path')

  const dom = installFakeDocument()
  try {
    const copied: string[] = []
    const api: StudioDevicePanelApi = {
      ...unusedCaptureApi,
      deviceConfirmPairing: async () => ({ accepted: true }),
      deviceDeclinePairing: async () => ({ declined: true }),
      deviceLaunch: async () => launchInfo,
      deviceLaunchOpen: async () => ({ hostName: 'the Developer’s iPhone', launched: true, url: deviceUrl }),
      deviceOpenPairing: async () => ({ expiresAt: new Date().toISOString() }),
      deviceReconnect: async () => ({ requested: true }),
      deviceRevoke: async () => ({ revoked: true }),
      deviceSelectCell: async () => ({ requested: true }),
    }
    const button = dom.element('button') as unknown as HTMLButtonElement
    const popover = dom.element('section') as unknown as HTMLElement
    popover.hidden = true
    const panel = createStudioDevicePanel({
      api,
      button,
      clipboard: {
        async writeText(text) {
          copied.push(text)
        },
      },
      handshake,
      popover,
    })
    panel.setStatus(idleStatus)
    panel.open()
    await until(() => dom.find(popover, 'studio-device-qr') !== undefined)
    Expect(dom.find(popover, 'studio-device-qr-box')).toBeUndefined()

    dom.click(dom.find(popover, 'studio-device-qr')!)
    await until(() => dom.find(popover, 'studio-device-qr-box') !== undefined)
    Expect(dom.find(popover, 'studio-device-qr-box')?.innerHTML).toBe(svg)
    Expect(dom.find(popover, 'studio-device-qr')?.textContent).toBe('Hide QR')
    dom.click(dom.find(popover, 'studio-device-qr')!)
    Expect(dom.find(popover, 'studio-device-qr-box')).toBeUndefined()

    dom.click(dom.find(popover, 'studio-device-copy-url')!)
    await until(() => copied.length === 1)
    Expect(copied).toEqual([deviceUrl])
    await until(() => dom.find(popover, 'studio-device-status')?.textContent === 'Device URL copied.')
    panel.dispose()
  } finally {
    dom.restore()
  }
})

type FakeListener = (event: unknown) => void

/** The repository runs client tests without a DOM library, so the panel is exercised against a small DOM stand-in. */
class FakeElement {
  readonly attributes = new Map<string, string>()
  children: FakeElement[] = []
  className = ''
  readonly dataset: Record<string, string | undefined> = {}
  disabled = false
  hidden = false
  innerHTML = ''
  readonly listeners = new Map<string, Set<FakeListener>>()
  parent: FakeElement | undefined
  selected = false
  tabIndex = -1
  title = ''
  type = ''
  #text = ''
  #value = ''

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.children.length === 0 ? this.#text : this.children.map(child => child.textContent).join('')
  }

  set textContent(value: string) {
    this.children = []
    this.#text = value
  }

  get value(): string {
    if (this.tagName !== 'select') {
      return this.#value
    }
    return this.children.find(option => option.selected)?.value ?? this.children[0]?.value ?? ''
  }

  set value(next: string) {
    this.#value = next
    if (this.tagName === 'select') {
      for (const option of this.children) {
        option.selected = option.value === next
      }
    }
  }

  addEventListener(type: string, listener: FakeListener): void {
    let set = this.listeners.get(type)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      const child = typeof node === 'string' ? Object.assign(new FakeElement('#text'), { textContent: node }) : node
      child.parent = this
      this.children.push(child)
    }
  }

  contains(node: FakeElement): boolean {
    return node === this || this.children.some(child => child.contains(node))
  }

  dispatchEvent(event: { target?: unknown; type: string }): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event)
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children = []
    this.append(...nodes)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

function installFakeDocument(): {
  click(element: FakeElement | HTMLElement): void
  dispatchDocument(type: string, event: Record<string, unknown>): void
  documentListenerCount(): number
  element(tag: string): FakeElement
  find(root: FakeElement | HTMLElement, className: string): FakeElement | undefined
  restore(): void
} {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const listeners = new Map<string, Set<FakeListener>>()
  const document = {
    addEventListener(type: string, listener: FakeListener) {
      let set = listeners.get(type)
      if (set === undefined) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    createElement: (tag: string) => new FakeElement(tag),
    removeEventListener(type: string, listener: FakeListener) {
      listeners.get(type)?.delete(listener)
    },
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document, writable: true })
  const find = (root: FakeElement, className: string): FakeElement | undefined => {
    if (root.className.split(' ').includes(className)) {
      return root
    }
    for (const child of root.children) {
      const found = find(child, className)
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }
  return {
    click(element) {
      ;(element as unknown as FakeElement).dispatchEvent({ target: element, type: 'click' })
    },
    dispatchDocument(type, event) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ type, ...event })
      }
    },
    documentListenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    element: tag => new FakeElement(tag),
    find: (root, className) => find(root as unknown as FakeElement, className),
    restore() {
      if (previous === undefined) {
        delete (globalThis as { document?: unknown }).document
      } else {
        Object.defineProperty(globalThis, 'document', previous)
      }
    },
  }
}
