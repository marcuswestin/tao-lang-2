import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { ParentDirectionContext } from './TR-parent-direction'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import { TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): void
  }
  title: string
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
      nativePropOverrides: { onPress: () => props.action?.invoke() },
      pressableTitle: props.title,
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },
} as const

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
  switch (kind) {
    case 'Pressable':
      return runtime.Pressable
    case 'Text':
      return runtime.Text
    case 'View':
      return runtime.View
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
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
