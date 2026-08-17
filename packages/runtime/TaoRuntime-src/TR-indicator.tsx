import React from 'react'
import { LayoutControls } from './TR-layout'
import { StyleRuntime } from './TR-style'
import { type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'
import { Views } from './TR-views'

export type TaoIndicatorSize = 'large' | 'small'

export type TaoSpinnerProps = {
  color?: string
  hidesWhenStopped?: boolean
  size?: string
  visible?: boolean
}

export type TaoLabeledSpinnerProps = TaoSpinnerProps & TaoViewProps & {
  title: string
}

type ReactNativeIndicatorModule = {
  ActivityIndicator: React.ComponentType<Record<string, unknown>>
}

/** Indicator exposes React Native progress indicator helpers. */
export const Indicator = {
  /** LabeledSpinner renders a Tao row with an ActivityIndicator and accessible label. */
  LabeledSpinner(props: TaoLabeledSpinnerProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return Views.View(
      {
        __tao: props.__tao,
        children: [
          React.createElement(React.Fragment, { key: 'spinner' }, Indicator.Spinner(props)),
          React.createElement(React.Fragment, {
            key: 'label',
          }, Views.Text({ __tao: props.__tao, children: [props.title] })),
        ],
      },
      {
        direction: 'row',
        layout: LayoutControls.create([['content', 'left', 'center'], ['hug']]),
        ...runtimeProps,
        nativeProps: {
          accessibilityLabel: props.title,
          accessibilityRole: 'progressbar',
          ...runtimeProps.nativeProps,
        },
      },
    )
  },

  /** Spinner renders a React Native ActivityIndicator with Tao defaults. */
  Spinner(props: TaoSpinnerProps = {}): React.JSX.Element {
    const RN = requireReactNativeIndicator()
    const palette = StyleRuntime.usePalette()
    const visible = props.visible !== false
    return React.createElement(RN.ActivityIndicator, {
      animating: visible,
      color: props.color ?? palette.accent,
      hidesWhenStopped: props.hidesWhenStopped ?? true,
      size: size(props.size),
    })
  },

  /** size normalizes supported React Native activity-indicator sizes. */
  size,
} as const

function size(value: string | undefined): TaoIndicatorSize {
  return value === 'large' ? 'large' : 'small'
}

function requireReactNativeIndicator(): ReactNativeIndicatorModule {
  return require('react-native') as ReactNativeIndicatorModule
}
