import { Describe, Expect, Test } from '@shared/test'
import { fireEvent } from '@testing-library/react-native'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime adaptive layout', () => {
  Test('measures Panes, preserves source order, and separates ScrollView viewport layout', async () => {
    await testCompileApp(
      `
        use Col, Panes, ScrollView, Text from @tao/ui

        app AdaptiveLayoutApp { view MainView }
        view MainView() {
          render Panes() [gap 16] {
            #primaryPane
            ScrollView() [claim 2, gap 7, pad 9] {
              #readableColumn
              Col() [width max 720] {
                Text("Primary pane")
              }
            }
            #secondaryPane
            Col() [claim 1] {
              Text("Secondary pane")
            }
          }
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Primary pane')
        ExpectScreen(screen).toHaveText('Secondary pane')
        Expect(screen.getAllByText(/pane$/).map(node => String(node.props.children))).toEqual([
          'Primary pane',
          'Secondary pane',
        ])

        const panes = screen.UNSAFE_getAllByType(RN.View).find(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.gap === 16 && style.flexDirection === 'column'
        })
        Expect(panes).toBeDefined()

        fireEvent(panes!, 'layout', { nativeEvent: { layout: { width: 655 } } })
        Expect(RN.StyleSheet.flatten(panes!.props.style)?.flexDirection).toBe('column')

        fireEvent(panes!, 'layout', { nativeEvent: { layout: { width: 656 } } })
        Expect(RN.StyleSheet.flatten(panes!.props.style)?.flexDirection).toBe('row')

        const primary = screen.getByTestId('primaryPane')
        const primaryViewportStyle = RN.StyleSheet.flatten(primary.props.style)
        const primaryContentStyle = RN.StyleSheet.flatten(primary.props.contentContainerStyle)
        Expect(primaryViewportStyle).toMatchObject({ alignSelf: 'stretch', flexGrow: 2 })
        Expect(primaryContentStyle).toMatchObject({ flexDirection: 'column', flexGrow: 1, gap: 7, padding: 9 })
        Expect(primaryContentStyle?.flexGrow).not.toBe(2)

        const readable = screen.getByTestId('readableColumn')
        Expect(RN.StyleSheet.flatten(readable.props.style)).toMatchObject({ maxWidth: 720, width: '100%' })

        const secondary = screen.getByTestId('secondaryPane')
        Expect(RN.StyleSheet.flatten(secondary.props.style)).toMatchObject({ flexGrow: 1 })
      },
    )
  })
})
