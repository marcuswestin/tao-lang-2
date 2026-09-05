import { Describe, Expect, Test } from '@shared/test'
import { mock } from 'bun:test'
import React from 'react'

mock.module('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}))

const { default: TR } = await import('@runtime/TR')

type RuntimeElement = React.ReactElement<Record<string, unknown>>

Describe('TR.ForEach selectable rows', () => {
  Test('hands every row to one item element with its selection callback and stable key', () => {
    const selections: string[] = []
    const content = React.createElement('RowRoot', { testID: 'rows' }, 'One')
    const select = (value: { jsValue: string }) => selections.push(value.jsValue)
    const collection = TR.ForEach(TR.Value(['One']), () => content, select) as RuntimeElement

    const rows = collection.props['items'] as RuntimeElement[]
    Expect(rows).toHaveLength(1)
    const item = rows[0]!.props['children'] as RuntimeElement
    const itemProps = item.props as { itemKey: unknown; runtimeValue: { jsValue: unknown }; select?: unknown }

    Expect(rows[0]!.key).toBe('0')
    Expect(itemProps.itemKey).toBe(0)
    Expect(itemProps.runtimeValue.jsValue).toBe('One')
    Expect(itemProps.select).toBe(select)
    // The row's press surface and its accessible name are proved where the row actually mounts:
    // the selectable-loop and interaction-outline runtime suites render it.
    Expect(selections).toEqual([])
  })

  Test('leaves a non-selectable row without a selection callback', () => {
    const content = React.createElement('RowRoot', { testID: 'rows' }, 'Static')
    const collection = TR.ForEach(TR.Value(['Static']), () => content) as RuntimeElement

    const rows = collection.props['items'] as RuntimeElement[]
    const item = rows[0]!.props['children'] as RuntimeElement

    Expect((item.props as { select?: unknown }).select).toBeUndefined()
    Expect((item.props as { render: unknown }).render).toBeDefined()
  })

  Test('does not capture healthy list-item arguments before a failure', () => {
    let capturedReads = 0
    const value = Object.defineProperty({}, 'Title', {
      enumerable: true,
      get: () => {
        capturedReads += 1
        return 'Draft'
      },
    })

    TR.ForEach(TR.Value([value]), () => null)

    Expect(capturedReads).toBe(0)
  })

  Test('does not evaluate healthy screen arguments only for diagnostics', () => {
    let evaluations = 0
    const screen = TR.Navigation.View({
      name: 'LazyDiagnosticsScreen',
      render: () => null,
    })

    screen.render({
      Value: {
        evaluate: () => {
          evaluations += 1
          return { jsValue: 'Draft' }
        },
      },
    })

    Expect(evaluations).toBe(0)
  })
})
