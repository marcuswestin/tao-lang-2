import TR from '@runtime/TR'
import type { StudioDeviceClient, TaoStudioDeviceClientState } from '@runtime/TR-studio-device-client'
import type { TaoStudioDeviceCellIdentity } from '@runtime/TR-studio-device-protocol'
import { Errors } from '@shared/core'
import { render, waitFor } from '@testing-library/react-native'
import { createElement } from 'react'
import { Text } from 'react-native'
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
