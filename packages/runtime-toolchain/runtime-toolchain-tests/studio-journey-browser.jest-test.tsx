/** @jest-environment jsdom */
/// <reference lib="dom" />

import { afterEach, describe, expect, test } from '@jest/globals'
import {
  replayStudioJourney,
  type StudioPreviewHost,
} from '@runtime/TR-studio-preview'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type * as ReactNative from 'react-native'

// Exercise the web implementation directly; this package intentionally has no bundled declarations.
const { Pressable, Text, TextInput } = require('react-native-web') as typeof ReactNative

const roots: Root[] = []

describe('Studio scenario browser journey', () => {
  test('delivers phase, hover, and focus through a real React Native Web Pressable without activating it', async () => {
    const observed: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(createElement(
        'div',
        { onMouseEnter: () => observed.push('delegatedHover') },
        createElement(
          Pressable,
          {
            onFocus: () => observed.push('focus'),
            onHoverIn: () => observed.push('hoverIn'),
            onPress: () => observed.push('press'),
            onPressIn: () => observed.push('pressIn'),
            onPressOut: () => observed.push('pressOut'),
            testID: 'target',
          },
          createElement(Text, null, 'Target'),
        ),
        createElement(TextInput, {
          accessibilityLabel: 'Name',
          onChangeText: value => observed.push(`enter:${value}`),
          onSubmitEditing: () => observed.push('submit'),
          testID: 'name',
          value: '',
        }),
      ))
    })

    await act(async () => {
      await replayStudioJourney([
        { kind: 'pressDown', selector: 'tag', target: 'target' },
        { kind: 'pressUp', selector: 'tag', target: 'target' },
        { kind: 'hover', selector: 'tag', target: 'target' },
        { kind: 'focus', tag: 'target' },
        { kind: 'enter', selector: 'tag', target: 'name', value: 'Tao' },
        { kind: 'submit', selector: 'tag', target: 'name' },
      ], browserHost())
    })

    expect(observed).toEqual([
      'pressIn',
      'pressOut',
      'delegatedHover',
      'hoverIn',
      'focus',
      'enter:Tao',
      'submit',
    ])
  })
})

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount())
  }
  document.body.replaceChildren()
})

function browserHost(): StudioPreviewHost {
  return {
    document,
    parent: { postMessage() {} },
    window,
  } as unknown as StudioPreviewHost
}
