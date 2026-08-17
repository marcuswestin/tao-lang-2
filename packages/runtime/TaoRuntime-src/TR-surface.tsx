import React from 'react'
import { requireReactNativeRuntime } from './TR-react-native'
import { StyleRuntime } from './TR-style'

type TaoSurfaceAction = {
  invoke(): void
  title: string
}

type TaoSurfaceLoadingProps = {
  message?: string
}

type TaoSurfaceEmptyProps = {
  action?: TaoSurfaceAction
  message?: string
  title: string
}

type TaoSurfaceErrorProps = {
  action?: TaoSurfaceAction
  message?: string
  title?: string
}

/** Surface exposes default loading, empty, and error-state UI helpers. */
export const Surface = {
  Empty(props: TaoSurfaceEmptyProps): React.JSX.Element {
    return createSurface({
      action: props.action,
      message: props.message,
      title: props.title,
    })
  },

  Error(props: TaoSurfaceErrorProps): React.JSX.Element {
    return createSurface({
      action: props.action,
      message: props.message,
      title: props.title ?? 'Something went wrong',
    })
  },

  Loading(props: TaoSurfaceLoadingProps = {}): React.JSX.Element {
    const RN = requireReactNativeRuntime()
    const palette = StyleRuntime.usePalette()
    return React.createElement(
      RN.View,
      { accessibilityRole: 'summary', style: StyleRuntime.surfaceStyle(palette) },
      React.createElement(RN.ActivityIndicator, { color: palette.accent }),
      React.createElement(RN.Text, { style: StyleRuntime.surfaceMessageStyle(palette) }, props.message ?? 'Loading'),
    )
  },
} as const

function createSurface(props: Required<Pick<TaoSurfaceEmptyProps, 'title'>> & Omit<TaoSurfaceEmptyProps, 'title'>) {
  const RN = requireReactNativeRuntime()
  const palette = StyleRuntime.usePalette()
  return React.createElement(
    RN.View,
    { accessibilityRole: 'summary', style: StyleRuntime.surfaceStyle(palette) },
    React.createElement(RN.Text, { style: StyleRuntime.surfaceTitleStyle(palette) }, props.title),
    props.message
      ? React.createElement(RN.Text, { style: StyleRuntime.surfaceMessageStyle(palette) }, props.message)
      : null,
    props.action
      ? React.createElement(
        RN.Pressable,
        {
          accessibilityRole: 'button',
          onPress: () => props.action?.invoke(),
          style: StyleRuntime.surfaceActionStyle(palette),
        },
        React.createElement(RN.Text, { style: StyleRuntime.surfaceActionTextStyle(palette) }, props.action.title),
      )
      : null,
  )
}

export type { TaoSurfaceAction, TaoSurfaceEmptyProps, TaoSurfaceErrorProps, TaoSurfaceLoadingProps }
