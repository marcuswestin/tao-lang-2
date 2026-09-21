import {
  registerRuntimeCaptureDomain,
  restoreRuntimeCapture,
  type TaoRuntimeCaptureArtifact,
} from '@runtime/TR-runtime-capture'
import { StudioPreview } from '@runtime/TR-studio-preview'
import { Errors } from '@shared'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

describe('resetting a mounted Studio preview error boundary', () => {
  test('keeps healthy children mounted and retries a failed child only for a new reset key', () => {
    let mounts = 0
    let unmounts = 0
    function Preview({ fails }: { fails: boolean }): React.ReactElement {
      React.useEffect(() => {
        mounts += 1
        return () => {
          unmounts += 1
        }
      }, [])
      if (fails) {
        return Errors.throwUnexpected('The preview failed to render.')
      }
      return React.createElement(Text, null, 'healthy preview')
    }
    const preview = (resetKey: string, fails: boolean): React.ReactElement =>
      React.createElement(
        StudioPreview.ErrorBoundary,
        { resetKey },
        React.createElement(Preview, { fails }),
      )
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const screen = render(preview('revision-1', false))
      expect(screen.getByText('healthy preview')).toBeTruthy()
      expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 })

      screen.rerender(preview('revision-2', false))
      expect(screen.getByText('healthy preview')).toBeTruthy()
      expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 })

      screen.rerender(preview('revision-2', true))
      expect(screen.getByText('Tao Studio preview error')).toBeTruthy()
      expect(screen.getByText('The preview failed to render.')).toBeTruthy()
      expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 1 })

      screen.rerender(preview('revision-2', false))
      expect(screen.getByText('Tao Studio preview error')).toBeTruthy()
      expect(screen.queryByText('healthy preview')).toBeNull()
      expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 1 })

      screen.rerender(preview('revision-3', false))
      expect(screen.getByText('healthy preview')).toBeTruthy()
      expect({ mounts, unmounts }).toEqual({ mounts: 2, unmounts: 1 })
    } finally {
      consoleError.mockRestore()
    }
  })
})

/**
 * A cell that carries a replay used to spin until React gave up with "Maximum update depth
 * exceeded" — on the phone and in the browser canvas alike. `ReplayHost` keyed its restore on the
 * replay artifact's object identity, and the generated preview roots rebuild that artifact on every
 * render: each render restarted the restore, restarting set state, and setting state rendered again.
 *
 * No test held `ReplayHost` to anything, so nothing noticed. These do, by re-rendering it the way a
 * generated root does: with an artifact that is equal every time and never the same object.
 */
describe('replaying a capture into a mounted preview', () => {
  const restored: unknown[] = []
  let unregister: (() => void) | undefined
  let domain = 'replay-host-test'
  let testIndex = 0

  beforeEach(() => {
    restored.length = 0
    // A domain registers exactly once, and registering replays any pending capture into it, so
    // each test uses its own name and gives it back.
    domain = `replay-host-test-${++testIndex}`
    unregister = registerRuntimeCaptureDomain({
      capture: () => ({ note: 'captured' }),
      domain,
      restore: value => {
        restored.push(value)
      },
      version: 1,
    })
  })

  afterEach(() => {
    unregister?.()
    unregister = undefined
  })

  function artifact(note: string): TaoRuntimeCaptureArtifact {
    // A fresh object every call, equal in content — exactly what a generated root produces.
    return { capturedAt: 1, domains: [{ domain, value: { note }, version: 1 }], version: 1 }
  }

  function replayHost(note: string): React.ReactElement {
    return React.createElement(
      StudioPreview.ReplayHost,
      { replay: artifact(note) },
      React.createElement(Text, null, 'restored cell'),
    )
  }

  test('restores once no matter how often its parent re-renders', async () => {
    const screen = render(replayHost('captured'))
    // The restore is asynchronous; let it settle before asking what is on screen.
    await act(async () => {})

    expect(restored).toEqual([{ note: 'captured' }])

    for (let pass = 0; pass < 5; pass++) {
      screen.rerender(replayHost('captured'))
    }
    await act(async () => {})

    // Identity changed six times; the content never did, so there was only ever one state to put back.
    expect(restored).toEqual([{ note: 'captured' }])
    expect(screen.getByText('restored cell')).toBeTruthy()
  })

  test('restores again when the artifact actually carries different state', async () => {
    const screen = render(replayHost('first'))
    await act(async () => {})
    expect(restored).toEqual([{ note: 'first' }])

    screen.rerender(replayHost('second'))
    await act(async () => {})

    expect(restored).toEqual([{ note: 'first' }, { note: 'second' }])
  })
})

/**
 * A domain that registers from inside a React effect — `TR-scheme.ts` does — used to be restored
 * again on every re-registration. Its restore sets state, that state changes the effect's
 * dependencies, and the effect re-registers: every replayed cell spun until React gave up. A replay
 * is a one-time seed, so it is put back once per domain and no more.
 */
describe('a replay is a seed, not a subscription', () => {
  test('re-registering a domain does not put the same replay back again', async () => {
    const restored: unknown[] = []
    const domain = 'replay-seed-test'
    const register = (): () => void =>
      registerRuntimeCaptureDomain({
        capture: () => ({ note: 'ignored' }),
        domain,
        restore: value => {
          restored.push(value)
        },
        version: 1,
      })

    const first = register()
    await restoreRuntimeCapture({
      capturedAt: 1,
      domains: [{ domain, value: { note: 'seeded' }, version: 1 }],
      version: 1,
    })
    expect(restored).toEqual([{ note: 'seeded' }])

    // The churn an effect produces: release, re-register, release, re-register.
    first()
    const second = register()
    second()
    register()()

    expect(restored).toEqual([{ note: 'seeded' }])
  })

  test('a domain registering after a newer artifact arrives is seeded from that newer one', async () => {
    const restored: unknown[] = []
    const domain = 'replay-seed-test-2'
    const register = (): () => void =>
      registerRuntimeCaptureDomain({
        capture: () => ({ note: 'ignored' }),
        domain,
        restore: value => {
          restored.push(value)
        },
        version: 1,
      })

    const first = register()
    await restoreRuntimeCapture({
      capturedAt: 1,
      domains: [{ domain, value: { note: 'first' }, version: 1 }],
      version: 1,
    })
    expect(restored).toEqual([{ note: 'first' }])

    // The cell is reconfigured with a different capture while this domain happens to be unmounted.
    first()
    await restoreRuntimeCapture({
      capturedAt: 2,
      domains: [{ domain, value: { note: 'second' }, version: 1 }],
      version: 1,
    })

    // Registering again must pick up the newer seed, not be told it has already had one.
    register()()
    expect(restored).toEqual([{ note: 'first' }, { note: 'second' }])
  })
})
