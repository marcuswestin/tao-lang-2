import React from 'react'
import { LayoutControls } from './TR-layout'
import { StyleRuntime } from './TR-style'
import { type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'
import { Views } from './TR-views'

export type TaoToggleAction = {
  invoke(value: boolean): void
}

export type TaoToggleProps = {
  disabled?: boolean
  falseColor?: string
  onChange?: TaoToggleAction
  thumbColor?: string
  trueColor?: string
  value?: boolean
}

export type TaoLabeledToggleProps = TaoToggleProps & TaoViewProps & {
  title: string
}

type ReactNativeToggleModule = {
  Switch: React.ComponentType<Record<string, unknown>>
}

/** Toggle exposes React Native Switch helpers. */
export const Toggle = {
  /** LabeledControl renders an accessible Tao row with a native Switch and label. */
  LabeledControl(props: TaoLabeledToggleProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const checked = value(props.value)
    const disabled = props.disabled === true
    return Views.View(
      {
        __tao: props.__tao,
        children: [
          React.createElement(React.Fragment, { key: 'toggle' }, Toggle.Control(props)),
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
          accessibilityRole: 'switch',
          accessibilityState: {
            checked,
            disabled,
            ...accessibilityState(runtimeProps.nativeProps?.['accessibilityState']),
          },
          ...runtimeProps.nativeProps,
        },
      },
    )
  },

  /** Control renders a React Native Switch with Tao defaults. */
  Control(props: TaoToggleProps = {}): React.JSX.Element {
    const RN = requireReactNativeToggle()
    const palette = StyleRuntime.usePalette()
    return React.createElement(RN.Switch, {
      disabled: props.disabled === true,
      onValueChange: callback(props.onChange),
      thumbColor: props.thumbColor,
      trackColor: {
        false: props.falseColor ?? palette.border,
        true: props.trueColor ?? palette.accent,
      },
      value: value(props.value),
    })
  },

  /** action adapts switch value changes into a Toggle-compatible action. */
  action(change: (value: boolean) => void): TaoToggleAction {
    return {
      invoke(value) {
        change(value)
      },
    }
  },

  /** value normalizes toggle checked state. */
  value,
} as const

function value(next: unknown): boolean {
  return next === true
}

function callback(action: TaoToggleProps['onChange']): ((next: boolean) => void) | undefined {
  if (!action) {
    return undefined
  }
  return next => action.invoke(value(next))
}

function accessibilityState(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function requireReactNativeToggle(): ReactNativeToggleModule {
  return require('react-native') as ReactNativeToggleModule
}
