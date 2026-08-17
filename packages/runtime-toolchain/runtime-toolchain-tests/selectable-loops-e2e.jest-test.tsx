import { Describe, Expect, Test } from '@shared/test'
import { act, fireEvent, within } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('selectable loop runtime', () => {
  Test('presses row content through an accessible wrapper while preserving tagged row roots', async () => {
    await testCompileApp(
      `
        use Col, Text from @tao/ui

        app SelectableLoopApp { view Main }
        view Main() {
          state Selected = "Nothing selected"
          state SelectionCount = 0
          render Col() {
            Text(Selected)
            Text("Selections: { SelectionCount }")

            #selectableRows
            loop ["First", "Second"] / Row {
              Col() { Text(Row) }
              on select -> {
                set Selected = "Selected { Row }"
                set SelectionCount += 1
              }
            }

            #staticRows
            loop ["Static"] / Row {
              Col() { Text(Row) }
            }
          }
        }
      `,
      async screen => {
        const selectableRoots = screen.getAllByTestId('selectableRows')
        const staticRoot = screen.getByTestId('staticRows')
        const rowButtons = selectableRoots.map(root => {
          let ancestor = root.parent
          while (ancestor && ancestor.props.accessibilityRole !== 'button') {
            ancestor = ancestor.parent
          }
          Expect(ancestor).not.toBeNull()
          return ancestor!
        })

        Expect(selectableRoots).toHaveLength(2)
        Expect(new Set(rowButtons).size).toBe(2)
        for (const [index, rowButton] of rowButtons.entries()) {
          Expect(rowButton.props.accessible).toBe(true)
          Expect(rowButton.props.accessibilityRole).toBe('button')
          Expect(rowButton.props.testID).toBeUndefined()
          Expect(within(rowButton).getByTestId('selectableRows')).toBe(selectableRoots[index])
          Expect(within(rowButton).queryByTestId('staticRows')).toBeNull()
        }
        Expect(selectableRoots[0]!.type).toBe(staticRoot.type)

        await act(async () => {
          fireEvent.press(screen.getByText('Second'))
        })

        Expect(screen.getByText('Selected Second')).toBeDefined()
        Expect(screen.getByText('Selections: 1')).toBeDefined()
      },
    )
  })
})
