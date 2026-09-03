import { registerRuntimeCaptureDomain, type TaoRuntimeCaptureArtifact } from '@runtime/TR-runtime-capture'
import { StudioPreview } from '@runtime/TR-studio-preview'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

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
