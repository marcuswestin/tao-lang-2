import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEvent, within } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

const catalog = `
  use Col, FormButton, Text from @tao/ui
  use Memory from @tao/data/providers/memory

  data Documents / Document {
    Title text (title)
    Body text (default "")
  }
`

function nodes(kind?: TR.OutlineNode['kind']): readonly TR.OutlineNode[] {
  return TR.Interaction.Outline.read().nodes.filter(node => kind === undefined || node.kind === kind)
}

Describe('interaction outline runtime', () => {
  Test('labels a selectable row on its press surface and registers it as an item', async () => {
    await testCompileApp(
      `${catalog}
        app OutlineApp {
          view Main
          Datasource Memory { }
        }
        view Main() {
          query Documents { }
          state Selected = "Nothing selected"
          action Seed() {
            create Document { Title: "Chapter one" }
            create Document { Title: "Chapter two" }
          }
          render Col() {
            Text(Selected)
            #seed
            FormButton("Seed") { on press Seed }
            #rows
            loop Documents / Document {
              Col() { Text(Document.Title) }
              on select -> { set Selected = "Selected { Document.Title }" }
            }
          }
        }
      `,
      async screen => {
        await act(async () => {
          fireEvent.press(screen.getByTestId('seed'))
        })

        const rows = screen.getAllByTestId('rows')
        Expect(rows).toHaveLength(2)
        const surfaces = screen.getAllByLabelText(/Chapter/)
        Expect(surfaces.map(surface => surface.props.accessibilityLabel)).toEqual(['Chapter one', 'Chapter two'])
        Expect(surfaces.every(surface => surface.props.accessibilityRole === 'button')).toBe(true)
        Expect(within(surfaces[0]!).getByTestId('rows')).toBe(rows[0])

        const items = nodes('item')
        Expect(items.map(item => item.label)).toEqual(['Chapter one', 'Chapter two'])
        Expect(items.map(item => item.provenance['entity'])).toEqual(['Document', 'Document'])
        Expect(new Set(items.map(item => item.parent)).size).toBe(1)
        const collection = nodes('collection')[0]
        Expect(collection?.identity).toBe(items[0]?.parent)
        Expect(collection?.label).toBe('Documents')
      },
    )
  })

  Test('labels a non-selectable single-root row on its root and withdraws the row when it unmounts', async () => {
    await testCompileApp(
      `${catalog}
        app OutlineApp {
          view Main
          Datasource Memory { }
        }
        view Main() {
          query Documents { }
          action Seed() {
            create Document { Title: "Chapter one", Body: "It began at sea." }
          }
          render Col() {
            #seed
            FormButton("Seed") { on press Seed }
            #rows
            loop Documents / Document {
              DocumentRow(Document)
            }
          }
        }
        view DocumentRow(Document) {
          render Col() {
            Text(Document.Body)
            Text(Document.Title)
            #remove
            FormButton("Remove") { on press -> { delete Document } }
          }
        }
      `,
      async screen => {
        Expect(nodes('item')).toHaveLength(0)
        await act(async () => {
          fireEvent.press(screen.getByTestId('seed'))
        })

        // The rendered `(title)` field outranks the body the row renders first, and lands on the
        // row's one root: the same native element that carries the loop's tag.
        const root = screen.getByTestId('rows')
        Expect(root.props.accessibilityLabel).toBe('Chapter one')
        Expect(root.props.accessible).toBeUndefined()
        Expect(screen.getByLabelText('Chapter one')).toBe(root)

        const [item] = nodes('item')
        Expect(item?.label).toBe('Chapter one')
        Expect(item?.corpus).toEqual(['Chapter one', 'It began at sea.'])
        const controls = nodes('action').filter(control => control.parent === item?.identity)
        Expect(controls.map(control => control.label)).toEqual(['Remove'])

        await act(async () => {
          fireEvent.press(screen.getByTestId('remove'))
        })
        Expect(nodes('item')).toHaveLength(0)
        Expect(nodes('collection')).toHaveLength(1)
      },
    )
  })

  Test('registers a multi-root row without a row-level label', async () => {
    await testCompileApp(
      `${catalog}
        app OutlineApp {
          view Main
          Datasource Memory { }
        }
        view Main() {
          query Documents { }
          action Seed() {
            create Document { Title: "Chapter one" }
          }
          render Col() {
            #seed
            FormButton("Seed") { on press Seed }
            loop Documents / Document {
              Text(Document.Title)
              Text(Document.Body)
            }
          }
        }
      `,
      async screen => {
        await act(async () => {
          fireEvent.press(screen.getByTestId('seed'))
        })

        Expect(screen.queryByLabelText('Chapter one')).toBeNull()
        Expect(nodes('item').map(item => item.label)).toEqual(['Chapter one'])
      },
    )
  })

  Test('registers controls under their view and regions for what a navigator presents', async () => {
    await testCompileApp(
      `
        use Col, FormButton, Text, TextInput from @tao/ui
        use StackNav from @tao/nav

        app OutlineApp {
          Name "Outline"
          Navigator StackNav { Initial Home }
        }
        scene Home() {
          Title "Home"
          state Draft = ""
          render Col() {
            #draft
            TextInput(Value: Draft, Label: "Draft title") { on submit -> { } }
            #open
            FormButton("Open detail") { on press -> { present Detail() } }
          }
        }
        scene Detail() {
          Title "Detail"
          render Text("Detail content")
        }
      `,
      async screen => {
        Expect(nodes().length).toBeGreaterThan(0)
        Expect(nodes('region').map(region => region.label)).toEqual(['Home'])
        Expect(nodes('input').map(control => control.label)).toEqual(['Draft title'])
        Expect(nodes('action').map(control => control.label)).toEqual(['Open detail'])
        const [home] = nodes('region')
        Expect(nodes('input')[0]?.parent).toBe(home?.identity)

        await act(async () => {
          fireEvent.press(screen.getByTestId('open'))
        })
        Expect(nodes('region').map(region => region.label)).toEqual(['Home', 'Detail'])
        Expect(nodes('region').map(region => region.provenance['presentation'])).toEqual(['content', 'content'])

        // A capture carries the outline as plain JSON under its own domain.
        const captured = await TR.Capture.capture()
        const domain = captured.domains.find(candidate => candidate.domain === 'interaction')
        Expect(domain?.version).toBe(1)
        Expect(domain?.value).toEqual(JSON.parse(JSON.stringify(TR.Interaction.Outline.read())))

        // The check boundary hands the next check an empty outline, whatever the last one mounted.
        TR.Navigation.beginTest()
        Expect(nodes()).toHaveLength(0)
      },
    )
  })

  Test('tells a subscriber when a row label changes and only then', async () => {
    await testCompileApp(
      `${catalog}
        app OutlineApp {
          view Main
          Datasource Memory { }
        }
        view Main() {
          query Documents { }
          state Count = 0
          action Seed() {
            create Document { Title: "Chapter one" }
          }
          render Col() {
            Text("Count: { Count }")
            #seed
            FormButton("Seed") { on press Seed }
            #count
            FormButton("Count") { on press -> { set Count += 1 } }
            #rows
            loop Documents / Document {
              Col() {
                Text(Document.Title)
                #rename
                FormButton("Rename") { on press -> { update Document { Title: "Chapter two" } } }
              }
            }
          }
        }
      `,
      async screen => {
        await act(async () => {
          fireEvent.press(screen.getByTestId('seed'))
        })
        let notifications = 0
        const unsubscribe = TR.Interaction.Outline.subscribe(() => {
          notifications += 1
        })

        // A re-render that changes nothing a reader sees is not a notification.
        await act(async () => {
          fireEvent.press(screen.getByTestId('count'))
        })
        await act(async () => {
          await Promise.resolve()
        })
        Expect(notifications).toBe(0)

        await act(async () => {
          fireEvent.press(screen.getByTestId('rename'))
        })
        await act(async () => {
          await Promise.resolve()
        })
        Expect(notifications).toBe(1)
        Expect(screen.getByTestId('rows').props.accessibilityLabel).toBe('Chapter two')
        unsubscribe()
      },
    )
  })
})
