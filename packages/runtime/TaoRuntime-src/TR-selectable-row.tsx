import React from 'react'
import { requireReactNativeRuntime } from './TR-react-native'

/** SelectableRow adds one accessible press surface around otherwise untouched loop-row content. */
export function SelectableRow(props: {
  children?: React.ReactNode
  onSelect: () => unknown
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return React.createElement(
    runtime.Pressable,
    {
      accessibilityRole: 'button',
      accessible: true,
      onPress: props.onSelect,
    },
    props.children,
  )
}
