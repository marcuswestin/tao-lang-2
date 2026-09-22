import { Describe, Expect, Test } from '@shared/test'
import * as RN from 'react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
  Test('forwards content layout through wrapper views', async () => {
    await testCompileApp(
      `
        app WrapperLayout {
            view MainView
        }

        use Col, Text from @tao/ui

        view Screen() {
            render Col(){
                Text("Wrapped center")
                @@content
            }
        }

        view MainView() {
            render Screen()[content center]
        }
      `,
      screen => {
        const centeredView = screen.UNSAFE_getAllByType(RN.View).find(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.alignItems === 'center' && style.justifyContent === 'center'
        })

        ExpectScreen(screen).toHaveText('Wrapped center')
        Expect(centeredView).toBeDefined()
      },
    )
  })

  Test('does not forward caller layout into nested render statements', async () => {
    await testCompileApp(
      `
        app NestedRenderLayout {
            view MainView
        }

        use Col, Row, Text from @tao/ui

        view Card() {
            render Col(){
                render Row(){
                    Text("Nested render layout")
                }
                @@content
            }
        }

        view MainView() {
            render Card()[gap 9]
        }
      `,
      screen => {
        const gapNineViews = screen.UNSAFE_getAllByType(RN.View).filter(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.gap === 9
        })

        ExpectScreen(screen).toHaveText('Nested render layout')
        Expect(gapNineViews).toHaveLength(1)
      },
    )
  })

  Test("lets caller layout override a header default but never a wrapper root's own layout", async () => {
    await testCompileApp(
      `
        app WrapperLayoutOverride {
            view MainView
        }

        use Col, Row, Text from @tao/ui

        // The header is the declaration's public default; the root's own clause is private (R9).
        view Public() [gap 12] {
            render Row()[content spread center] {
                Text("Public gap")
                @@content
            }
        }

        view Private() {
            render Row()[gap 12, content spread center] {
                Text("Private gap")
                @@content
            }
        }

        view MainView() {
            render Col() {
                Public()[gap 8]
                Private()[gap 8]
            }
        }
      `,
      screen => {
        const gapOf = (label: string): number | undefined => {
          for (let current = screen.getByText(label).parent; current; current = current.parent) {
            const gap = RN.StyleSheet.flatten(current.props.style)?.gap
            if (gap !== undefined) {
              return gap
            }
          }
          return undefined
        }

        ExpectScreen(screen).toHaveText('Public gap')
        Expect(gapOf('Public gap')).toBe(8)
        Expect(gapOf('Private gap')).toBe(12)
      },
    )
  })

  Test('overlays compiled layout clauses over stdlib layout defaults', async () => {
    await testCompileApp(
      `
        app ExplicitRowLayout {
            view MainView
        }

        use Row, Text from @tao/ui

        view MainView() {
            render Row()[content right, gap 4, claim 2] {
                Text("Explicit row")
            }
        }
      `,
      screen => {
        const rowStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style => style?.gap === 4)

        ExpectScreen(screen).toHaveText('Explicit row')
        Expect(rowStyle).toMatchObject({
          alignItems: 'baseline',
          alignSelf: 'stretch',
          flexDirection: 'row',
          flexGrow: 2,
          gap: 4,
          justifyContent: 'flex-end',
        })
      },
    )
  })

  Test('applies axis-relative fill through wrapper view root layout clauses', async () => {
    await testCompileApp(
      `
        app WrapperLayoutFill {
            view MainView
        }

        use Box, Row, Text from @tao/ui

        view Screen() {
            render Box()[fill] {
                Text("Root fill")
                @@content
            }
        }

        view MainView() {
            render Row()[gap 3] {
                Screen()
            }
        }
      `,
      screen => {
        const boxStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style =>
            style?.gap === undefined
            && style?.flexDirection === 'row'
            && style?.flexGrow === 1
            && style?.alignSelf === 'stretch'
          )

        ExpectScreen(screen).toHaveText('Root fill')
        Expect(boxStyle).toBeDefined()
      },
    )
  })

  Test('does not apply stdlib layout identity to local stdlib-named views', async () => {
    await testCompileApp(
      `
        app LocalRowIdentity {
            view MainView
        }

        view Row() {
            render inject Content @@content, Layout @@layout \`\`\`ts
                return TR.Views.View({ children: Content, layout: Layout })
            \`\`\`
        }

        view Text(Value text) {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }

        view MainView() {
            render Row()[gap 4] {
                Text("Local row")
            }
        }
      `,
      screen => {
        const localRowStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style => style?.gap === 4)

        ExpectScreen(screen).toHaveText('Local row')
        Expect(localRowStyle).toMatchObject({ gap: 4 })
        Expect(localRowStyle?.flexDirection).toBeUndefined()
      },
    )
  })
})
