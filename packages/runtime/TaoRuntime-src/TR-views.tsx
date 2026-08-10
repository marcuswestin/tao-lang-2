import { Switch } from '@shared/core'
import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { ParentDirectionContext } from './TR-parent-direction'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import { type TaoEvents, TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'
import { runtimeValue } from './TR-value'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): void
  }
  disabled?: boolean
  title: string
}

type TaoTextInputProps = TaoViewProps & {
  value: string
  label?: string
  placeholder?: string
}

type TaoPrimitiveKind = 'Pressable' | 'Text' | 'TextInput' | 'View'

type TaoPrimitiveElementProps = {
  readonly kind: TaoPrimitiveKind
  readonly nativePropOverrides?: Record<string, unknown>
  readonly pressableTitle?: string
  readonly providesParentDirection: boolean
  readonly runtimeProps: TaoViewRuntimeProps
  readonly viewProps: TaoViewProps
}

/** Views declares runtime-backed primitive Tao stdlib view implementations. */
export const Views = {
  View(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPrimitiveElement, {
      kind: 'View',
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  Text(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Text',
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  Pressable(props: TaoButtonProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const events = TaoPropsControls.eventsOf(props.__tao)
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Pressable',
      nativePropOverrides: {
        accessibilityLabel: props.title,
        disabled: props.disabled === true,
        onPress: () => {
          if (props.disabled === true) {
            return
          }
          props.action?.invoke()
          events.press?.invoke()
        },
      },
      pressableTitle: props.title,
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  TextInput(props: TaoTextInputProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const events = TaoPropsControls.eventsOf(props.__tao)
    return React.createElement(TaoPrimitiveElement, {
      kind: 'TextInput',
      nativePropOverrides: {
        accessibilityLabel: props.label === '' ? undefined : props.label,
        onChangeText: (text: string) => events.change?.invoke(runtimeValue(text)),
        onSubmitEditing: () => events.submit?.invoke(),
        placeholder: props.placeholder === '' ? undefined : props.placeholder,
        value: props.value,
      },
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },
} as const

function TaoPrimitiveElement(props: TaoPrimitiveElementProps): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props.viewProps, props.runtimeProps, parentDirection)
  const events = TaoPropsControls.eventsOf(props.viewProps.__tao)
  const elementProps = {
    ...TaoPropsControls.nativePropsWithStyle(merged),
    ...pressProps(props, events),
    ...props.nativePropOverrides,
  }
  const elementChildren = nativeChildren(runtime, props, merged.children)
  const providedChildren = props.providesParentDirection
    ? ParentDirectionContext.childrenForLayoutParent(elementChildren, elementProps['style'])
    : elementChildren
  return createReactElement(
    runtime,
    nativeComponent(runtime, props.kind, events.press !== undefined),
    elementProps,
    providedChildren,
  )
}

// A container with a bound `on press` becomes pressable; text handles presses natively.
function pressProps(props: TaoPrimitiveElementProps, events: TaoEvents): Record<string, unknown> {
  if (props.kind === 'Pressable' || !events.press) {
    return {}
  }
  return { accessibilityRole: 'button', onPress: () => events.press?.invoke() }
}

function nativeComponent(
  runtime: ReactNativeRuntime,
  kind: TaoPrimitiveKind,
  pressable: boolean,
): React.ElementType {
  return Switch<TaoPrimitiveKind, React.ElementType>(kind, {
    Pressable: () => runtime.Pressable,
    Text: () => runtime.Text,
    TextInput: () => runtime.TextInput,
    View: () => pressable ? runtime.Pressable : runtime.View,
  })
}

function nativeChildren(
  runtime: ReactNativeRuntime,
  props: TaoPrimitiveElementProps,
  children: React.ReactNode,
): React.ReactNode {
  return props.pressableTitle === undefined
    ? children
    : createReactElement(runtime, runtime.Text, {}, props.pressableTitle)
}

function createReactElement(
  runtime: ReactNativeRuntime,
  component: React.ElementType,
  elementProps: Record<string, unknown>,
  children?: React.ReactNode,
): React.ReactElement {
  const args = [component, elementProps, children]
  Dev.processCreateReactElementArgs(args, {
    platformOS: runtime.Platform?.OS,
  })
  return React.createElement.apply(React, args as any)
}
