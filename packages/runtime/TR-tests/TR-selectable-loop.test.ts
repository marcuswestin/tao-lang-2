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
  Test('wraps selectable content in one accessible pressable without moving its test ID', () => {
    const selections: string[] = []
    const content = React.createElement('RowRoot', { testID: 'rows' }, 'One')
    const rows = TR.ForEach(
      TR.Value(['One']),
      () => content,
      value => selections.push(value.jsValue),
    ) as RuntimeElement[]

    const containedItem = rows[0]!.props['children'] as RuntimeElement
    const selectableRow = (containedItem.type as (props: Record<string, unknown>) => RuntimeElement)(
      containedItem.props,
    )
    const wrapper = (selectableRow.type as (props: Record<string, unknown>) => RuntimeElement)(
      selectableRow.props,
    )

    Expect(wrapper.type).toBe('Pressable')
    Expect(wrapper.props['accessible']).toBe(true)
    Expect(wrapper.props['accessibilityRole']).toBe('button')
    Expect(wrapper.props['testID']).toBeUndefined()
    Expect(wrapper.props['children']).toBe(content)
    Expect(content.props['testID']).toBe('rows')

    const onPress = wrapper.props['onPress'] as () => void
    onPress()
    Expect(selections).toEqual(['One'])
  })

  Test('returns non-selectable content directly under the keyed fragment', () => {
    const content = React.createElement('RowRoot', { testID: 'rows' }, 'Static')
    const rows = TR.ForEach(TR.Value(['Static']), () => content) as RuntimeElement[]

    const containedItem = rows[0]!.props['children'] as RuntimeElement
    const rendered = (containedItem.type as (props: Record<string, unknown>) => RuntimeElement)(containedItem.props)

    Expect(rendered).toBe(content)
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
