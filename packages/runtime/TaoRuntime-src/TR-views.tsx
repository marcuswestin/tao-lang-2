import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import { TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): void
  }
  title: string
}

/** Views declares runtime-backed primitive Tao stdlib view implementations. */
export const Views = {
  View(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return createReactElement(RN, RN.View, props, runtimeProps)
  },

  Text(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return createReactElement(RN, RN.Text, props, runtimeProps)
  },

  Pressable(props: TaoButtonProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return createReactElement(
      RN,
      RN.Pressable,
      props,
      runtimeProps,
      { onPress: () => props.action?.invoke() },
      createReactElement(RN, RN.Text, {}, {}, undefined, props.title),
    )
  },
} as const

function createReactElement(
  runtime: ReactNativeRuntime,
  component: React.ElementType,
  props: TaoViewProps,
  runtimeProps: TaoViewRuntimeProps = {},
  nativePropOverrides?: Record<string, unknown>,
  children?: React.ReactNode,
): React.ReactElement {
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps)
  const elementProps = {
    ...TaoPropsControls.nativePropsWithStyle(merged),
    ...nativePropOverrides,
  }
  const elementChildren = children ?? merged.children
  const args = [component, elementProps, elementChildren]
  Dev.processCreateReactElementArgs(args, {
    platformOS: runtime.Platform?.OS,
  })
  return React.createElement.apply(React, args as any)
}
