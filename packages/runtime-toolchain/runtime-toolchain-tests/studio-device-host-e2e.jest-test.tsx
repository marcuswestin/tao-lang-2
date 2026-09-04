import TR from '@runtime/TR'
import type { StudioDeviceClient, TaoStudioDeviceClientState } from '@runtime/TR-studio-device-client'
import type { TaoStudioDeviceCellIdentity } from '@runtime/TR-studio-device-protocol'
import { Errors } from '@shared/core'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { createElement } from 'react'
import { LogBox, Text } from 'react-native'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

/**
 * The device host decides whether to acknowledge a cell from a ref that `componentDidCatch` writes
 * during commit, before the acknowledging effect reads it. That ordering is a React internals
 * property, so it cannot be pinned by the pure-function tests in `packages/runtime`: removing the
 * boundary's `onError` wiring leaves every one of those green while restoring the whole defect.
 * These tests mount the real host against a stub client instead.
 */

const identity: TaoStudioDeviceCellIdentity = {
  appName: 'Demo',
  cellId: 'states#cell',
  cellRevision: 1,
  compileRevision: 4,
  manifestRevision: 'compile:4',
  previewInstanceId: 'instance-1',
}

const publication = {
  appName: 'Demo',
  compileRevision: 4,
  project: '/project',
  sourceVersions: {},
}

/** A client already holding an assignment, so the host mounts the cell on its first render. */
function stubClient(): {
  applied: TaoStudioDeviceCellIdentity[]
  client: StudioDeviceClient
  reports: { level: string; message: string }[]
} {
  const applied: TaoStudioDeviceCellIdentity[] = []
  const reports: { level: string; message: string }[] = []
  const state: TaoStudioDeviceClientState = {
    assignment: { identity, runtime: { cell: { environment: {} } } },
    attempts: 0,
    phase: 'connected',
    transport: 'lan',
    welcome: {
      appName: 'Demo',
      capabilities: [],
      heartbeatMs: 10_000,
      projectLabel: 'demo',
      sessionId: 'session-1',
    },
  }
  return {
    applied,
    client: {
      applied(cellIdentity) {
        applied.push(cellIdentity)
      },
      async forgetStudio() {},
      reconnect() {},
      report(level, message) {
        reports.push({ level, message })
      },
      selectCell() {},
      log() {},
      selectSource() {},
      setNetwork() {},
      sourceAction: () => 'request-1',
      async start() {},
      state: () => state,
      stop() {},
      subscribe: () => () => {},
    },
    reports,
  }
}

function renderHost(App: React.ComponentType, client: StudioDeviceClient, scenarioKind: 'app' | 'view' = 'app') {
  return render(
    createElement(TR.Studio.DeviceHost, {
      App,
      cellRuntime: () =>
        ({
          environment: {
            network: { mode: 'online' },
            scheme: { requested: 'light', source: 'scenario' },
            version: 1,
          },
          fixture: { accounts: [], creates: [] },
          scenario: { kind: scenarioKind, prepare: [], subjectId: 'Demo' },
        }) as never,
      client,
      manifest: { compileRevision: 4, manifestRevision: 'compile:4', scenarios: [] },
      publication,
    }),
  )
}

type SafeAreaContextTestMock = {
  setSafeAreaInsetsForTests(insets: { bottom: number; left: number; right: number; top: number }): void
}

function safeAreaContextTestMock(): SafeAreaContextTestMock {
  return require('react-native-safe-area-context') as SafeAreaContextTestMock
}

/** Flattens whatever shape a style prop arrived in, so an assertion can read one value. */
function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>((merged, entry) => ({ ...merged, ...flatStyle(entry) }), {})
  }
  return typeof style === 'object' && style !== null ? style as Record<string, unknown> : {}
}

describe('Studio device host acknowledgement', () => {
  let consoleError: typeof console.error

  beforeEach(() => {
    consoleError = console.error
    console.error = () => {}
  })

  afterEach(() => {
    console.error = consoleError
  })

  test('acknowledges a cell that renders', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'rendered'), stub.client)

    await waitFor(() => expect(screen.getByText('rendered')).toBeTruthy())
    await waitFor(() => expect(stub.applied).toHaveLength(1))
    expect(stub.applied[0]).toMatchObject({ cellId: 'states#cell', compileRevision: 4 })
    expect(stub.reports).toEqual([])
  })

  test('reports, and does not acknowledge, a cell whose render throws', async () => {
    const stub = stubClient()
    const screen = renderHost((): never => Errors.throwUnexpected('the cell exploded'), stub.client)

    await waitFor(() => expect(screen.getByText(/Tao Studio preview error/)).toBeTruthy())
    await waitFor(() => expect(stub.reports).toHaveLength(1))
    expect(stub.reports[0]).toMatchObject({ level: 'error' })
    expect(stub.reports[0]?.message).toContain('the cell exploded')
    // The acknowledgement names what is on screen; an error screen is not the assigned revision.
    expect(stub.applied).toEqual([])
  })
})

/**
 * The device is the only place these insets are real, and the rule differs by scenario kind: a
 * `view` cell mounts one Tao view with no navigator to apply insets, so the host applies them; an
 * `app` cell keeps its own navigator chrome and must reach the true screen edges. Both directions
 * were changed structurally and neither was ever rendered, so a regression in either would have been
 * invisible until someone looked at a phone.
 */
describe('Studio device host safe area', () => {
  const insets = { bottom: 34, left: 0, right: 0, top: 59 }

  beforeEach(() => {
    safeAreaContextTestMock().setSafeAreaInsetsForTests(insets)
  })

  afterEach(() => {
    safeAreaContextTestMock().setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
  })

  test('pads a bare view cell out of the status bar and home indicator', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'bare view'), stub.client, 'view')

    await waitFor(() => expect(screen.getByText('bare view')).toBeTruthy())
    expect(flatStyle(screen.getByTestId('tao-studio-device-cell').props['style'])).toMatchObject({
      paddingBottom: insets.bottom,
      paddingTop: insets.top,
    })
  })

  test('leaves an app cell unpadded, because its own navigator owns the screen edges', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'whole app'), stub.client, 'app')

    await waitFor(() => expect(screen.getByText('whole app')).toBeTruthy())
    const style = flatStyle(screen.getByTestId('tao-studio-device-cell').props['style'])
    expect(style['paddingTop']).toBeUndefined()
    expect(style['paddingBottom']).toBeUndefined()
  })

  test('keeps the companion badge clear of the home indicator', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'whole app'), stub.client)

    await waitFor(() => expect(screen.getByTestId('tao-studio-device-badge')).toBeTruthy())
    // The badge is the only way into the companion menu, so an inset it ignores is a menu a thumb
    // has to fight the home indicator to reach. Pinned exactly, not as a lower bound: the margin
    // above the inset is the part that keeps it off the indicator rather than merely level with it.
    expect(flatStyle(screen.getByTestId('tao-studio-device-badge').props['style'])['bottom']).toBe(
      24 + insets.bottom,
    )
  })
})

/**
 * A phone running a Studio cell is a canvas, not a place to read a stack trace — and LogBox is not
 * a passive one. Its window becomes the key window the moment anything is logged and keeps every
 * touch afterwards, so one contained failure froze the badge, the tab bar and the app together
 * while all three still looked alive. The host turns it off and says what happened itself.
 */
describe('Studio device host failure containment', () => {
  test('turns LogBox off, so a logged failure cannot take the screen', async () => {
    const ignoreAllLogs = jest.spyOn(LogBox, 'ignoreAllLogs').mockImplementation(() => {})
    try {
      const stub = stubClient()
      const screen = renderHost(() => createElement(Text, null, 'rendered'), stub.client)

      await waitFor(() => expect(screen.getByText('rendered')).toBeTruthy())
      expect(ignoreAllLogs).toHaveBeenCalledWith(true)
    } finally {
      ignoreAllLogs.mockRestore()
    }
  })

  test('names a failure nobody in the program could observe, and sends it to Studio', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'rendered'), stub.client)
    await waitFor(() => expect(screen.getByText('rendered')).toBeTruthy())

    const failure = new Error("Cannot delete missing Workspace 'Workspace-1'.")
    act(() => {
      TR.Errors.reportUnowned(failure)
    })

    await waitFor(() => expect(screen.getByTestId('tao-studio-device-failure')).toBeTruthy())
    expect(screen.getByText(/Cannot delete missing Workspace 'Workspace-1'\./)).toBeTruthy()
    const [report] = stub.reports
    expect(report?.level).toBe('error')
    expect(report?.message).toContain("Cannot delete missing Workspace 'Workspace-1'.")
    // With frames: a message alone names what went wrong and never where, and where is the whole
    // reason someone reads a phone's failure on their Mac.
    expect(report?.message).toContain('\n  at ')
    // The cell keeps rendering underneath: the notice reports, it does not replace the screen.
    expect(screen.getByText('rendered')).toBeTruthy()

    // A failure a live query reproduces on every revision arrives again and again from the same
    // place. Answering each one with a state update and a frame to Studio is how a contained
    // failure becomes the freeze it was contained to avoid.
    act(() => {
      TR.Errors.reportUnowned(failure)
    })
    expect(stub.reports).toHaveLength(1)

    fireEvent.press(screen.getByTestId('tao-studio-device-failure'))
    expect(screen.queryByTestId('tao-studio-device-failure')).toBeNull()
  })

  test('carries the layout-bounds toggle, so the app needs no floating menu of its own', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'rendered'), stub.client)
    await waitFor(() => expect(screen.getByTestId('tao-studio-device-badge')).toBeTruthy())

    expect(TR.Dev.isMenuHidden()).toBe(true)
    fireEvent.press(screen.getByTestId('tao-studio-device-badge'))
    const toggle = screen.getByTestId('tao-studio-device-menu-layout-bounds')
    expect(screen.getByText('Layout bounds')).toBeTruthy()

    fireEvent.press(toggle)
    expect(TR.Dev.isLayoutBoundsEnabled()).toBe(true)
    fireEvent.press(screen.getByTestId('tao-studio-device-badge'))
    expect(screen.getByText('Layout bounds: on')).toBeTruthy()
    TR.setDevMode()
  })

  test('keeps inspect guidance pointer-transparent without a deprecated native prop', async () => {
    const stub = stubClient()
    const screen = renderHost(() => createElement(Text, null, 'rendered'), stub.client)
    await waitFor(() => expect(screen.getByTestId('tao-studio-device-badge')).toBeTruthy())

    fireEvent.press(screen.getByTestId('tao-studio-device-badge'))
    fireEvent.press(screen.getByTestId('tao-studio-device-menu-inspect'))
    const guidance = screen.getByText('Inspect: tap anything to select its source')

    expect(guidance.props['pointerEvents']).toBeUndefined()
    expect(flatStyle(guidance.props['style'])['pointerEvents']).toBe('none')
  })
})
