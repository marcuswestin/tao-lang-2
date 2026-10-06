import { Describe, Expect, Test } from '@shared/test'
import { fireEventAsync } from '@testing-library/react-native'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('qualified text rendering', () => {
  Test('mounts qualified members and member calls and updates them with state', async () => {
    await testCompileApp(
      `
        use Button, Col from @tao/ui

        app QualifiedText { id "qualifiedtext" version "1.0.0" name "QualifiedText" view Main }

        type ContentValue is { Content text }
        type Token is text with {
          func Label() fails never -> text { return Token }
        }

        view Main() {
          state TextValue = ""
          state TokenValue is Token = Token ""
          action Reveal() {
            set TextValue = "Visible"
            set TokenValue = Token "Visible"
          }
          action Clear() {
            set TextValue = ""
            set TokenValue = Token ""
          }
          let Content = ContentValue { Content: TextValue }

          render Col() {
            Button("Reveal") { on press -> do Reveal() }
            Button("Clear") { on press -> do Clear() }
            ContentText(Content)
            TokenText(TokenValue)
          }
        }

        view ContentText(Value ContentValue) {
          #fieldText accessible label "Field text"
          render Value.Content [pad 8]
        }

        view TokenText(Value Token) {
          #methodText accessible label "Method text"
          render Value.Label() [pad 12]
        }
      `,
      async screen => {
        Expect(screen.queryByText('Visible')).toBeNull()
        Expect(screen.queryByTestId('fieldText')).toBeNull()
        Expect(screen.queryByTestId('methodText')).toBeNull()

        await fireEventAsync.press(screen.getByText('Reveal'))

        const fieldText = screen.getByTestId('fieldText')
        const methodText = screen.getByTestId('methodText')
        Expect(fieldText.props.children).toEqual(['Visible'])
        Expect(methodText.props.children).toEqual(['Visible'])
        Expect(screen.getAllByText('Visible')).toHaveLength(2)
        Expect(RN.StyleSheet.flatten(fieldText.props.style)).toMatchObject({ padding: 8 })
        Expect(RN.StyleSheet.flatten(methodText.props.style)).toMatchObject({ padding: 12 })

        await fireEventAsync.press(screen.getByText('Clear'))

        Expect(screen.queryByText('Visible')).toBeNull()
        Expect(screen.queryByTestId('fieldText')).toBeNull()
        Expect(screen.queryByTestId('methodText')).toBeNull()
      },
    )
  })
})
