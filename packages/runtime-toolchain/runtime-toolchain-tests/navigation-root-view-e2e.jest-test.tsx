import TR from '@runtime/TR'
import {
  type NavigationRestorationDiagnostic,
  subscribeNavigationRestorationDiagnostics,
} from '@runtime/TR-navigation-restoration'
import { Describe, Expect, Test } from '@shared/test'
import { fireEventAsync } from '@testing-library/react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

type RuntimeAppCapture = {
  name: string
  state: { payload: { navigator: { descriptor: string } } }
}

const rootViewApp = `
  use Col, FormButton, Text from @tao/ui

  app RootViewCaptureApp {
    Name "Root view capture"
    view Main
  }

  view Main() {
    render Col() {
      Text("Root view content")

      FormButton("Open detail") {
        on press -> { present Detail() }
      }
    }
  }

  view Detail() {
    render Text("Root view detail")
  }
`

/**
 * `app X { view Y }` mounts Y in a navigator Tao synthesizes rather than one the source names. The
 * runtime holds that navigator to the same contract as a written one, so this suite drives the
 * compiled app rather than a hand-built definition: only the generated code says whether the sugar
 * hands the navigator the canonical identity restoration needs.
 */
Describe('root-view app restoration surface', () => {
  Test('navigates and captures a root-view app without failing on its synthesized navigator', async () => {
    const diagnostics: NavigationRestorationDiagnostic[] = []
    const stopDiagnostics = subscribeNavigationRestorationDiagnostics(diagnostic => diagnostics.push(diagnostic))
    try {
      await testCompileApp(rootViewApp, async screen => {
        ExpectScreen(screen).toHaveText('Root view content')
        await fireEventAsync.press(screen.getByText('Open detail'))
        ExpectScreen(screen).toHaveText('Root view detail')

        // TR.Capture walks every registered app and takes a restoration snapshot per lane with no
        // containment of its own, so a navigator missing its identity takes the whole capture down.
        const artifact = await TR.Capture.capture()
        const navigation = artifact.domains.find(domain => domain.domain === 'navigation')?.value
        // Each app is keyed by its own canonical declaration identity, which carries the `app` kind.
        const captured = Object.entries((navigation ?? {}) as Record<string, RuntimeAppCapture>)
          .filter(([identity]) => identity.includes('"app","RootViewCaptureApp"'))

        Expect(captured.length).toBe(1)
        Expect(captured[0]?.[1].name).toBe('Root view capture')
        Expect(captured[0]?.[1].state.payload.navigator.descriptor).toContain('app-root-view-nav')
      })
    } finally {
      stopDiagnostics()
    }

    // Persisting the position the press moved to is what the synthesized navigator failed at, and
    // failing reported this warning before writing a deliberately invalid envelope to the device.
    Expect(diagnostics).toEqual([])
  })
})
