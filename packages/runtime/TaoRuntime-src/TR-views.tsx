import { Switch } from '@shared/core'
import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { ParentDirectionContext } from './TR-parent-direction'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import { TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): void
  }
  disabled?: boolean
  title: string
}

type TaoTextInputProps = TaoViewProps & {
  disabled?: boolean
  id?: string
  label: string
  onChange?: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  value: string
}

type TaoPrimitiveKind = 'Pressable' | 'Text' | 'View'

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
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Pressable',
      nativePropOverrides: {
        onPress: () => {
          if (props.disabled !== true) {
            props.action?.invoke()
          }
        },
      },
      pressableTitle: props.title,
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  TextInput(props: TaoTextInputProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoTextInput, { props, runtimeProps })
  },
} as const

function TaoTextInput({ props, runtimeProps }: {
  props: TaoTextInputProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps, parentDirection)
  const input = createReactElement(runtime, runtime.TextInput, {
    accessibilityLabel: props.label,
    accessibilityState: { disabled: props.disabled === true },
    editable: !props.disabled,
    onChangeText: props.disabled ? undefined : props.onChange,
    onSubmitEditing: props.disabled ? undefined : props.onSubmit,
    placeholder: props.placeholder,
    style: {
      borderColor: '#a8b0aa',
      borderRadius: 8,
      borderWidth: 1,
      color: '#17201a',
      fontSize: 16,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    testID: props.id || undefined,
    value: props.value,
  })
  const label = createReactElement(
    runtime,
    runtime.Text,
    { style: { color: '#314238', fontSize: 14, fontWeight: '600' } },
    props.label,
  )
  const children = React.createElement(React.Fragment, null, label, input)
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(merged)
  return createReactElement(
    runtime,
    runtime.View,
    {
      ...wrapperProps,
      style: [wrapperProps['style'], { gap: 6, opacity: props.disabled ? 0.55 : 1 }],
    },
    children,
  )
}

function TaoPrimitiveElement(props: TaoPrimitiveElementProps): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props.viewProps, props.runtimeProps, parentDirection)
  const elementProps = {
    ...TaoPropsControls.nativePropsWithStyle(merged),
    ...props.nativePropOverrides,
  }
  const elementChildren = nativeChildren(runtime, props, merged.children)
  const providedChildren = props.providesParentDirection
    ? ParentDirectionContext.childrenForLayoutParent(elementChildren, elementProps['style'])
    : elementChildren
  return createReactElement(
    runtime,
    nativeComponent(runtime, props.kind),
    elementProps,
    providedChildren,
  )
}

function nativeComponent(runtime: ReactNativeRuntime, kind: TaoPrimitiveKind): React.ElementType {
  return Switch<TaoPrimitiveKind, React.ElementType>(kind, {
    Pressable: () => runtime.Pressable,
    Text: () => runtime.Text,
    View: () => runtime.View,
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
