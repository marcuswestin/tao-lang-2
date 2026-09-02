import React from 'react'
import { requireReactNativeRuntime } from './TR-react-native'

/**
 * SelectableRow adds one accessible press surface around otherwise untouched loop-row content. The
 * row's derived label is its accessible name: the surface is one accessibility element, so without
 * it the platform would read every descendant text in turn.
 */
export function SelectableRow(props: {
  accessibilityLabel?: string
  children?: React.ReactNode
  onSelect: () => unknown
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return React.createElement(
    runtime.Pressable,
    {
      ...(props.accessibilityLabel === undefined ? {} : { accessibilityLabel: props.accessibilityLabel }),
      accessibilityRole: 'button',
      accessible: true,
      onPress: props.onSelect,
    },
    props.children,
  )
}
