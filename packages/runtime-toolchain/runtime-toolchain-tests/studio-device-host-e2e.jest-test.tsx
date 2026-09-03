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
      selectSource() {},
      sourceAction: () => 'request-1',
      async start() {},
      state: () => state,
      stop() {},
      subscribe: () => () => {},
    },
    reports,
  }
}

function renderHost(App: React.ComponentType, client: StudioDeviceClient) {
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
          scenario: { kind: 'app', prepare: [], subjectId: 'Demo' },
        }) as never,
      client,
      manifest: { compileRevision: 4, manifestRevision: 'compile:4', scenarios: [] },
      publication,
    }),
  )
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
