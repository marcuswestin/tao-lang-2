import TR from '@runtime/TR'
import { captureArguments, TaoErrorBoundary } from '@runtime/TR-error-containment'
import {
  mountStudioPreviewBridge,
  type StudioPreviewConfig,
  type StudioPreviewHost,
} from '@runtime/TR-studio-preview'
import { Errors } from '@shared/core'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApps } from './test-compile-app'

registerRuntimeE2ELifecycle()

const config: StudioPreviewConfig = {
  appName: 'Containment',
  compileRevision: 3,
  parentOrigin: 'http://127.0.0.1:4400',
  previewInstanceId: 'containment-preview',
  project: '/project',
  sourceVersions: { '/project/App.tao': 'v3' },
}

describe('runtime failure containment and Studio capture', () => {
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    originalConsoleError = console.error
    console.error = () => {}
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  test('isolates one failing ForEach item while preserving its siblings', async () => {
    const screen = render(
      <>
        {TR.ForEach(
          TR.Value(['first', 'broken', 'third']),
          value => {
            if (value.jsValue === 'broken') {
              Errors.throwUnexpected('Broken row')
            }
            return <Text>{value.jsValue}</Text>
          },
          undefined,
          { declaration: 'Rows', source: { end: 42, path: '/project/App.tao', start: 20 } },
        )}
      </>,
    )

    await waitFor(() => expect(screen.getByLabelText('item error')).toBeTruthy())
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByText('third')).toBeTruthy()
    expect(screen.getByText('Broken row')).toBeTruthy()
  })

  test('publishes a diagnostic capture to Studio and stops a deterministic retry loop', async () => {
    const posted: Array<{ message: any; targetOrigin: string }> = []
    const cleanup = mountStudioPreviewBridge(config, previewHost(posted))
    const Failing = (): never => Errors.throwUnexpected('Always fails')
    const screen = render(
      <TaoErrorBoundary
        boundaryId="app:containment"
        frame={{ boundary: 'app', declaration: 'Containment', source: { end: 18, path: '/project/App.tao', start: 4 } }}
        stateKey="same-state"
      >
        <Failing />
      </TaoErrorBoundary>,
    )

    await waitFor(() => expect(screen.getByLabelText('app error')).toBeTruthy())
    await waitFor(() => expect(posted.some(entry => entry.message.type === 'preview-runtime-failure')).toBe(true))
    const report = posted.find(entry => entry.message.type === 'preview-runtime-failure')!
    expect(report.targetOrigin).toBe(config.parentOrigin)
    expect(report.message).toMatchObject({
      capture: {
        failure: {
          boundaryId: 'app:containment',
          error: { message: 'Always fails' },
          frame: { boundary: 'app', declaration: 'Containment', source: { path: '/project/App.tao' } },
          retryEligible: true,
        },
        version: 1,
      },
      channel: 'tao-studio',
      protocolVersion: 1,
      type: 'preview-runtime-failure',
    })

    fireEvent.press(screen.getByLabelText('Try again'))
    await waitFor(() => expect(screen.getByLabelText('App error retry stopper')).toBeTruthy())
    expect(screen.queryByLabelText('Try again')).toBeNull()
    cleanup()
  })

  test('Restart app remounts the failed subtree without resetting app data', async () => {
    let shouldFail = true
    let resets = 0
    const MaybeFailing = () => {
      if (shouldFail) {
        Errors.throwUnexpected('Transient render')
      }
      return <Text>Recovered app</Text>
    }
    const screen = render(
      <TaoErrorBoundary
        app={{
          reset: () => {
            resets += 1
          },
        } as any}
        boundaryId="app:restart"
        frame={{ boundary: 'app', declaration: 'Restartable' }}
        stateKey="restart-state"
      >
        <MaybeFailing />
      </TaoErrorBoundary>,
    )

    await waitFor(() => expect(screen.getByLabelText('Restart app')).toBeTruthy())
    shouldFail = false
    fireEvent.press(screen.getByLabelText('Restart app'))
    await waitFor(() => expect(screen.getByText('Recovered app')).toBeTruthy())
    expect(resets).toBe(1)
  })

  test('requires portable confirmation before resetting data and keeps a recovery backup', async () => {
    let shouldFail = true
    let resets = 0
    TR.Data.Schema({
      name: 'ResettableContainmentData',
      entities: { Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } } },
    }, {
      load: () => undefined,
      reset: () => {
        resets += 1
      },
      save: () => {},
    })
    const MaybeFailing = () => {
      if (shouldFail) {
        Errors.throwUnexpected('Resettable failure')
      }
      return <Text>Reset recovered</Text>
    }
    const screen = render(
      <TaoErrorBoundary
        app={{ reset: () => {} } as any}
        boundaryId="app:reset"
        frame={{ boundary: 'app', declaration: 'Resettable' }}
        stateKey="reset-state"
      >
        <MaybeFailing />
      </TaoErrorBoundary>,
    )

    await waitFor(() => expect(screen.getByLabelText('Reset app data')).toBeTruthy())
    fireEvent.press(screen.getByLabelText('Reset app data'))
    expect(resets).toBe(0)
    expect(screen.getByLabelText('Confirm reset app data')).toBeTruthy()
    shouldFail = false
    fireEvent.press(screen.getByLabelText('Confirm reset app data'))
    await waitFor(() => expect(screen.getByText('Reset recovered')).toBeTruthy())
    expect(resets).toBe(1)
    expect(TR.Capture.recoveryBackup()).toBeDefined()
  })

  test('publishes a minimal report when capture fails and isolates throwing listeners', async () => {
    const stopDomain = TR.Capture.register({ capture: () => Number.NaN, domain: 'broken-capture-test', version: 1 })
    const received: TR.RuntimeCaptureArtifact[] = []
    const stopThrowing = TR.Capture.onFailure(() => {
      Errors.throwUnexpected('listener failed')
    })
    const stopReceiving = TR.Capture.onFailure(artifact => received.push(artifact))
    const warn = console.warn
    console.warn = () => {}
    const Failing = (): never => Errors.throwUnexpected('Capture fallback')
    try {
      render(
        <TaoErrorBoundary
          boundaryId="app:capture-fallback"
          frame={{ boundary: 'app' }}
          stateKey="capture-fallback"
        >
          <Failing />
        </TaoErrorBoundary>,
      )
      await waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({
        domains: [],
        failure: { error: { message: 'Capture fallback' } },
        version: 1,
      })
    } finally {
      console.warn = warn
      stopReceiving()
      stopThrowing()
      stopDomain()
    }
  })

  test('bounds captured argument depth, width, and strings while redacting credentials', () => {
    const cyclic: any = {
      password: 'private',
      text: 'x'.repeat(5_000),
      values: Array.from({ length: 120 }, (_, index) => index),
    }
    cyclic.self = cyclic
    let deep = cyclic
    for (let index = 0; index < 12; index += 1) {
      deep = { child: deep }
    }
    const captured = captureArguments(deep) as any
    let cursor = captured
    for (let index = 0; index < 9; index += 1) {
      cursor = cursor.child
    }
    expect(cursor).toBe('[truncated]')
    const inner = captured.child.child.child.child.child.child.child.child
    expect(JSON.stringify(captured)).not.toContain('private')
    expect(JSON.stringify(captured).length).toBeLessThan(12_000)
    expect(inner).toBeDefined()
  })

  test('renders exactly 256 generated Tao view frames and contains frame 257', async () => {
    await testCompileApps(
      `
        use StackNav from @tao/nav

        app WithinLimit { id "withinlimit" version "1.0.0" name "Within" Navigator StackNav { Initial WithinRoot } }
        app BeyondLimit { id "beyondlimit" version "1.0.0" name "Beyond" Navigator StackNav { Initial BeyondRoot } }

        scene WithinRoot() { Title "Within" render Recursive(253) }
        scene BeyondRoot() { Title "Beyond" render Recursive(254) }

        view Recursive(Depth number) {
          render Frame(Depth) {
            if Depth > 0 { render Recursive(Depth - 1) }
          }
        }

        view Frame(Depth number) {
          render inject Depth, Content @@content \`\`\`ts
            return Depth === 0 ? TR.Views.Text({ children: ["Reached frame 256"] }) : Content
          \`\`\`
        }
      `,
      ['WithinLimit', 'BeyondLimit'],
      async screens => {
        expect(screens['WithinLimit']!.getByText('Reached frame 256')).toBeTruthy()
        await waitFor(() =>
          expect(screens['BeyondLimit']!.getByText(
            "View 'Frame' exceeded Tao's maximum render depth of 256.",
          )).toBeTruthy()
        )
      },
    )
  })
})

function previewHost(posted: Array<{ message: any; targetOrigin: string }>): StudioPreviewHost {
  const overlay = {
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    remove() {},
    setAttribute() {},
    style: {},
  }
  return {
    document: {
      addEventListener() {},
      body: { appendChild() {} },
      createElement: () => overlay,
      querySelectorAll: () => [],
      removeEventListener() {},
    },
    parent: { postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }) },
    window: {
      addEventListener() {},
      removeEventListener() {},
    },
  }
}
