import React from 'react'
import { InteractionControls } from './TR-interaction-catalog'
import { interactionMeasurements } from './TR-interaction-outline'
import { requireReactNativeRuntime } from './TR-react-native'

/**
 * SelectableRow adds one accessible press surface around otherwise untouched loop-row content. The
 * row's derived label is its accessible name: the surface is one accessibility element, so without
 * it the platform would read every descendant text in turn.
 */
export function SelectableRow(props: {
  accessibilityLabel?: string
  children?: React.ReactNode
  identity?: string
  onSelect: () => unknown
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const nativeProps = {
    ...(props.accessibilityLabel === undefined ? {} : { accessibilityLabel: props.accessibilityLabel }),
    accessibilityRole: 'button',
    accessible: true,
    onPress: InteractionControls.ActivateIdentity(props.identity, props.onSelect),
  }
  return React.createElement(
    runtime.Pressable,
    props.identity === undefined ? nativeProps : interactionMeasurements.bind(props.identity, nativeProps),
    props.children,
  )
}
