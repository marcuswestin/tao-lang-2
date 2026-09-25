import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { applyDeviceViewport } from '@expo-host/testing/test-runner'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

const panesApp = `
  use Col, Panes, Text from @tao/ui

  app AdaptiveDeviceApp { view MainView }
  view MainView() {
    render Panes() [gap 16] {
      #primaryPane
      Col() [claim 2] { Text("Primary pane") }
      #secondaryPane
      Col() [claim 1] { Text("Secondary pane") }
    }
  }
`

Describe('Expo runtime `on <device>` and `with <fixture>` test clauses', () => {
  // The test language selects by visible text, label, placeholder, or #tag — it has no selector for a
  // chosen layout direction (Tao Testing.md's non-goals). `applyDeviceViewport` is the harness seam
  // `on <device>` runs through before a check's first step, so this proves the device by reading the
  // same rendered style the harness itself produced, rather than through a Tao test assertion.
  Test('gives a phone viewport a stacked Panes and a tablet viewport a side-by-side one', async () => {
    await testCompileApp(panesApp, screen => {
      ExpectScreen(screen).toHaveText('Primary pane')
      ExpectScreen(screen).toHaveText('Secondary pane')
      const panes = screen.UNSAFE_getAllByType(RN.View).find(view => {
        const style = RN.StyleSheet.flatten(view.props.style)
        return style?.gap === 16 && (style.flexDirection === 'column' || style.flexDirection === 'row')
      })
      Expect(panes).toBeDefined()

      applyDeviceViewport(screen, { device: 'phone', height: 844, width: 390 })
      Expect(RN.StyleSheet.flatten(panes!.props.style)?.flexDirection).toBe('column')

      applyDeviceViewport(screen, { device: 'tablet', height: 1024, width: 768 })
      Expect(RN.StyleSheet.flatten(panes!.props.style)?.flexDirection).toBe('row')
    })
  })

  // The Tao-authored proof lives beside the app it drives: `Apps/Test Apps/Test Device and Fixture`.
  // This package-level run exercises the same grammar-to-runtime pipeline `tao test` uses, so a
  // regression here fails a fast package suite rather than only the slower Test App journey.
  Test('starts a `with <fixture>` check with the fixture rows visible, inherited by a nested test', async () => {
    await withTaoFiles(
      'tao-test-fixture-runtime-',
      {
        'Main.test.tao': `
          use WordFlowerFixtureApp, Workspaces from ./

          fixture StarterWorkspace {
            Home = create Workspace { Name: "Home" }
          }

          test "WordFlower" with StarterWorkspace {
            test "shows the starter workspace with no interaction" {
              run WordFlowerFixtureApp
              expect text "Home"
            }
            test "a nested test inherits the fixture" {
              run WordFlowerFixtureApp
              expect text "Home"
            }
          }
        `,
        'Main.tao': `
          use Col, Text from @tao/ui
          use Memory from @tao/data/providers/memory
          workspace data Workspaces / Workspace { Name text }
          app WordFlowerFixtureApp { view MainView Datasource Memory { } }
          view MainView() {
            query Workspaces { }
            render Col() {
              when Workspaces {
                empty -> { Text("No workspaces yet") }
                otherwise -> {
                  loop Workspaces / Workspace {
                    Text(Workspace.Name)
                  }
                }
              }
            }
          }
        `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })
})
