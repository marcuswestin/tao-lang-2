import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import * as TaoReactNative from '@runtime/TR-react-native'
import { Describe, Expect, Test } from '@shared/test'
import { fireEvent, render } from '@testing-library/react-native'
import { createElement } from 'react'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime adaptive layout', () => {
  Test('keeps handled taps available beside an editable child and preserves explicit keyboard props', () => {
    const restoreRuntime = jest.spyOn(TaoReactNative, 'requireReactNativeRuntime')
    try {
      for (const [os, dismissMode] of [['ios', 'interactive'], ['android', 'on-drag']] as const) {
        restoreRuntime.mockReturnValue({
          ActivityIndicator: RN.ActivityIndicator,
          Image: RN.Image,
          KeyboardAvoidingView: RN.KeyboardAvoidingView,
          ScrollView: RN.ScrollView,
          Switch: RN.Switch,
          TextInput: RN.TextInput,
          View: RN.View,
          Text: RN.Text,
          Pressable: RN.Pressable,
          Platform: { OS: os },
        })
        let draft = ''
        const submissions: string[] = []
        const children = createElement(
          RN.View,
          null,
          createElement(RN.TextInput, {
            accessibilityLabel: 'Draft',
            autoFocus: true,
            onChangeText: (value: string) => {
              draft = value
            },
          }),
          createElement(RN.Pressable, {
            accessibilityLabel: 'Open detail',
            onPress: () => submissions.push(draft),
          }),
        )
        const screen = render(TR.Views.ScrollView({ children }))
        const scroll = screen.UNSAFE_getByType(RN.ScrollView)
        Expect(scroll.props.keyboardShouldPersistTaps).toBe('handled')
        Expect(scroll.props.keyboardDismissMode).toBe(dismissMode)
        fireEvent.changeText(screen.getByLabelText('Draft'), 'Keep this draft')
        fireEvent.press(screen.getByLabelText('Open detail'))
        Expect(submissions).toEqual(['Keep this draft'])
        screen.rerender(TR.Views.ScrollView({ children }, {
          nativeProps: { keyboardShouldPersistTaps: 'always', keyboardDismissMode: 'none' },
        }))
        Expect(screen.UNSAFE_getByType(RN.ScrollView).props.keyboardShouldPersistTaps).toBe('always')
        Expect(screen.UNSAFE_getByType(RN.ScrollView).props.keyboardDismissMode).toBe('none')
        screen.unmount()
      }
    } finally {
      restoreRuntime.mockRestore()
    }
  })

  Test('measures Panes, preserves source order, and separates ScrollView viewport layout', async () => {
    await testCompileApp(
      `
        use Col, Panes, ScrollView, Text from @tao/ui

        app AdaptiveLayoutApp { id "adaptivelayoutapp" version "1.0.0" name "AdaptiveLayoutApp" view MainView }
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
