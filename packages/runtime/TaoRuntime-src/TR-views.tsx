import React from 'react'

/** ReactNativeRuntime declares the RN component set TR.Views renders with. */
export type ReactNativeRuntime = {
  View: React.ComponentType<any>
  Text: React.ComponentType<any>
  Pressable: React.ComponentType<any>
}

/** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
export type TaoProps = {
  layout?: unknown
}

type TaoViewProps = {
  __tao?: TaoProps
  children?: React.ReactNode
}

type TaoButtonProps = TaoViewProps & {
  title: string
}

let reactNativeRuntime: ReactNativeRuntime | undefined

/** setReactNativeRuntime sets the runtime RN component set used by Views. */
export function setReactNativeRuntime(runtime: ReactNativeRuntime): void {
  reactNativeRuntime = runtime
}

/** Views declares runtime-backed primitive Tao stdlib view implementations. */
export const Views = {
  Box(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.View, { style: [{ flexDirection: 'row' }, props.__tao?.layout] }, props.children)
  },

  Stack(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.View, { style: [{ flexDirection: 'column' }, props.__tao?.layout] }, props.children)
  },

  Col(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.View, { style: [{ flexDirection: 'column' }, props.__tao?.layout] }, props.children)
  },

  Row(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.View, { style: [{ flexDirection: 'row' }, props.__tao?.layout] }, props.children)
  },

  WrappingRow(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(
      RN.View,
      { style: [{ flexDirection: 'row', flexWrap: 'wrap' }, props.__tao?.layout] },
      props.children,
    )
  },

  Text(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.Text, undefined, props.children)
  },

  TextLabel(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.Text, undefined, props.children)
  },

  MultiLineText(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.Text, undefined, props.children)
  },

  Number(props: TaoViewProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(RN.Text, undefined, props.children)
  },

  Button(props: TaoButtonProps): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    return React.createElement(
      RN.Pressable,
      { accessibilityRole: 'button' },
      React.createElement(RN.Text, undefined, props.title),
    )
  },
} as const

function requireReactNativeRuntime(): ReactNativeRuntime {
  if (!reactNativeRuntime) {
    throw new Error('TR React Native runtime is not set. Generated app modules must call TR.setReactNativeRuntime(RN).')
  }
  return reactNativeRuntime
}
