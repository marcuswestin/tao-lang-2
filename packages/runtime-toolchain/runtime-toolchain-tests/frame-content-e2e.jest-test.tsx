import { Describe, Expect, Test } from '@shared/test'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('frame content runtime', () => {
  Test('renders unnamed content, named fills, explicit ambient channels, and frame intrinsic layout', async () => {
    await testCompileApp(
      `
        use Col, FormButton, Row, Text from @tao/ui

        layout Toolbar() {
          render Row() [gap 8, content right] {
            @@content
          }
        }

        frame Card(Title text) {
          @actions = empty

          render Col() [gap 8, pad 12] {
            Row() [content spread center] {
              Text(Title)
              @actions
            }
            Col() [gap 6] {
              @@content
            }
          }
        }

        view WordBadge(Total number) {
          render inject Total, Suffix " words", Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.Text({ children: [\`${'${Total}${Suffix}'}\`], layout: Layout, tag: Tag })
          \`\`\`
        }

        layout Scroller() {
          render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
            return TR.Views.View({
              children: <RN.ScrollView contentContainerStyle={{ flexGrow: 1 }}>{Content}</RN.ScrollView>,
              layout: Layout,
              tag: Tag,
            })
          \`\`\`
        }

        view Main() {
          render Col() {
            #wordBadge
            WordBadge(3) [margin top 5]
            Card("Draft") [claim 2] {
              Text("Unsaved changes")
              @actions FormButton("Reset to signed out") {
                #resetSignedOut
                on press -> { }
              }
            }
            Card("No actions") {
              Text("Default slot is empty")
            }
            #scroller
            Scroller() {
              Text("Scrolled content")
            }
            Toolbar() {
              Text("Toolbar content")
            }
          }
        }

        app FrameContentApp { view Main }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('3 words')
        ExpectScreen(screen).toHaveText('Draft')
        ExpectScreen(screen).toHaveText('Unsaved changes')
        ExpectScreen(screen).toHaveText('Default slot is empty')
        ExpectScreen(screen).toHaveText('Scrolled content')
        ExpectScreen(screen).toHaveText('Toolbar content')
        Expect(screen.getAllByText('Reset to signed out')).toHaveLength(1)
        Expect(screen.getByTestId('wordBadge')).toBeDefined()
        Expect(screen.getByTestId('resetSignedOut')).toBeDefined()
        Expect(screen.getByTestId('scroller')).toBeDefined()
        Expect(RN.StyleSheet.flatten(screen.getByTestId('wordBadge').props.style)).toMatchObject({ marginTop: 5 })

        const frameRootStyles = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .filter(style => style?.gap === 8 && style?.padding === 12 && style?.flexShrink === 0)
        const claimedFrameStyle = frameRootStyles.find(style => style?.flexGrow === 2)
        const defaultFrameStyle = frameRootStyles.find(style => style?.flexGrow === 0)

        Expect(claimedFrameStyle).toMatchObject({
          alignSelf: 'stretch',
          flexDirection: 'column',
          flexGrow: 2,
          flexShrink: 0,
          gap: 8,
          padding: 12,
        })
        Expect(defaultFrameStyle).toMatchObject({
          alignSelf: 'stretch',
          flexGrow: 0,
          flexShrink: 0,
        })
      },
    )
  })
})
