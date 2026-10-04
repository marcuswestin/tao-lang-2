import { Describe, Expect, Test } from '@shared/test'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

// A Tao check cannot observe a resolved style, so the one seam a package test cannot reach — the
// compiler's emitted header spec meeting the runtime's merge order — is proven here on rendered output.
Describe('Expo runtime: declaration style defaults', () => {
  Test('applies a header default, lets the caller replace or clear it, and keeps the root private', async () => {
    await testCompileApp(
      `
        use Col, Text from @tao/ui

        project design Theme {
          paper #fff
          ink #111
        }

        app DefaultsApp { id "defaultsapp" version "1.0.0" name "Defaults"
          Design Theme
          view Screen
        }

        view Screen() {
          render Col() {
            #plain
            Card("Plain")
            #cleared
            Card("Cleared") [pad 0, bg none]
            #private
            Card("Private") [gap 0, fg ink]
          }
        }

        view Card(Title text) [pad 12, bg paper] {
          render Col() [gap 8] {
            Text(Title)
          }
        }
      `,
      screen => {
        // The header's defaults reach the occurrence root; the root's own gap sits beside them.
        Expect(RN.StyleSheet.flatten(screen.getByTestId('plain').props.style)).toMatchObject({
          backgroundColor: '#fff',
          gap: 8,
          padding: 12,
        })

        // `pad 0` replaces the header's value (two spacing values merge per side); `bg none` removes
        // the clause altogether.
        const cleared = RN.StyleSheet.flatten(screen.getByTestId('cleared').props.style)
        Expect(cleared).toMatchObject({ gap: 8, paddingBottom: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0 })
        Expect(cleared.padding).toBeUndefined()
        Expect(cleared.backgroundColor).toBeUndefined()

        // The root's private `gap 8` beats the caller's `gap 0`; a clause the header never
        // declared (`fg`) still applies, since the root does not set it.
        Expect(RN.StyleSheet.flatten(screen.getByTestId('private').props.style)).toMatchObject({
          color: '#111',
          gap: 8,
        })
      },
    )
  })
})
