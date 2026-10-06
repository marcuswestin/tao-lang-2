import { Describe, Expect, Test } from '@shared/test'
import { fireEventAsync } from '@testing-library/react-native'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

type NativeHostNode = Readonly<{ type: unknown; props: Readonly<{ testID?: unknown }> }>

registerRuntimeE2ELifecycle()

Describe('bare text-valued render targets', () => {
  Test('updates state, aliases, and child parameters while omitting only bare empty values', async () => {
    await testCompileApp(
      `
        use Button, Col, Text from @tao/ui

        app BareTextValues { id "baretextvalues" version "1.0.0" name "BareTextValues" view Main }

        view Main() {
          state Message = ""
          let CurrentMessage = Message

          action Reveal() { set Message = "Pending" }
          action Clear() { set Message = "" }

          render Col() {
            Button("Reveal") { on press -> do Reveal() then { done -> { set Message = "Visible" } } }
            Button("Clear") { on press -> do Clear() }
            #surface Col() {
              #bareState accessible label CurrentMessage
              render Message[pad 8]
              #bareAlias
              render CurrentMessage[pad 8]
              #explicitAlias
              render Text(CurrentMessage)[pad 8]
              #parameter
              TextParameter(CurrentMessage)
              #quotedEmpty
              render ""
              #stdlibEmpty
              render Text("")
              #anchor
              render Text("Anchor")
            }
          }
        }

        view TextParameter(Value text) {
          render Value
        }
      `,
      async screen => {
        const surface = screen.getByTestId('surface')
        const nativeHostNodes = () => surface.findAll((node: NativeHostNode) => typeof node.type === 'string')
        const nativeHostPath = () =>
          nativeHostNodes()
            .map((node: NativeHostNode) => `${String(node.type)}#${String(node.props.testID ?? '')}`)
        const emptyHostPath = nativeHostPath()
        const emptyHostCount = nativeHostNodes().length
        const visibleNativeTextTags = () =>
          surface
            .findAll((node: NativeHostNode) => node.type === 'Text')
            .map((node: NativeHostNode) => node.props.testID)

        Expect(screen.queryByTestId('bareState')).toBeNull()
        Expect(screen.queryByTestId('bareAlias')).toBeNull()
        Expect(screen.queryByTestId('parameter')).toBeNull()
        Expect(screen.getByTestId('quotedEmpty')).toBeDefined()
        Expect(screen.getByTestId('stdlibEmpty')).toBeDefined()
        Expect(emptyHostPath).toEqual([
          'View#surface',
          'Text#explicitAlias',
          'Text#quotedEmpty',
          'Text#stdlibEmpty',
          'Text#anchor',
        ])
        Expect(visibleNativeTextTags()).toEqual(['explicitAlias', 'quotedEmpty', 'stdlibEmpty', 'anchor'])

        await fireEventAsync.press(screen.getByText('Reveal'))

        const bareState = screen.getByTestId('bareState')
        Expect(screen.getAllByText('Visible')).toHaveLength(4)
        Expect(screen.queryByText('Pending')).toBeNull()
        Expect(screen.getByLabelText('Visible')).toBe(bareState)
        Expect(bareState.props.accessibilityLabel).toBe('Visible')
        Expect(screen.getByTestId('bareAlias').props.children).toEqual(['Visible'])
        Expect(screen.getByTestId('parameter').props.children).toEqual(['Visible'])
        Expect(nativeHostNodes()).toHaveLength(emptyHostCount + 3)

        const nativeTextProps = (tag: string) => {
          const { style, numberOfLines, ellipsizeMode } = screen.getByTestId(tag).props
          return { style: RN.StyleSheet.flatten(style), numberOfLines, ellipsizeMode }
        }
        Expect(nativeTextProps('bareAlias')).toEqual(nativeTextProps('explicitAlias'))
        Expect(visibleNativeTextTags()).toEqual([
          'bareState',
          'bareAlias',
          'explicitAlias',
          'parameter',
          'quotedEmpty',
          'stdlibEmpty',
          'anchor',
        ])

        await fireEventAsync.press(screen.getByText('Clear'))

        Expect(screen.queryByTestId('bareState')).toBeNull()
        Expect(screen.queryByTestId('bareAlias')).toBeNull()
        Expect(screen.queryByTestId('parameter')).toBeNull()
        Expect(screen.queryByText('Visible')).toBeNull()
        Expect(screen.getByTestId('quotedEmpty')).toBeDefined()
        Expect(screen.getByTestId('stdlibEmpty')).toBeDefined()
        Expect(nativeHostNodes()).toHaveLength(emptyHostCount)
        Expect(nativeHostPath()).toEqual(emptyHostPath)
        Expect(visibleNativeTextTags()).toEqual(['explicitAlias', 'quotedEmpty', 'stdlibEmpty', 'anchor'])
      },
    )
  })

  Test('keeps standard bare text rendering distinct from a lexical Text view', async () => {
    await testCompileApp(
      `
        use Col from @tao/ui

        app LexicalText { id "lexicaltext" version "1.0.0" name "LexicalText" view Main }

        view Main() {
          let Caption = "Standard text"
          render Col() {
            #standard
            render Caption
            #lexical
            render Text(Caption)
          }
        }

        view Text(Value text) {
          render inject Value, Tag @@tag \`\`\`ts
            return TR.Views.Text({ children: ["Local " + Value], tag: Tag })
          \`\`\`
        }
      `,
      screen => {
        Expect(screen.getByTestId('standard').props.children).toEqual(['Standard text'])
        Expect(screen.getByTestId('lexical').props.children).toEqual(['Local Standard text'])
      },
    )
  })

  Test('renders an app-root value without a UI import or a containing view', async () => {
    await testCompileApp(
      `
        app RootText { id "roottext" version "1.0.0" name "RootText" view Main }

        view Main() {
          let Heading = "Root value"
          render Heading
        }
      `,
      screen => {
        const text = screen.getByText('Root value')
        Expect(text.type).toBe('Text')
        Expect(text.props.children).toEqual(['Root value'])
      },
    )
  })
})
