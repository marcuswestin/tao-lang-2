import { Switch } from '@shared/core'
import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { Image } from './TR-image'
import { LayoutControls } from './TR-layout'
import { ParentDirectionContext } from './TR-parent-direction'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import { StyleRuntime } from './TR-style'
import { TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): void
  }
  disabled?: boolean
  loading?: boolean
  loadingTitle?: string
  title: string
}

type TaoTextInputProps = TaoViewProps & {
  onBlur?: TaoTextInputBlurAction
  onChangeText?: TaoTextInputChangeAction
  placeholder?: string
  value: string
}

type TaoImageProps = TaoViewProps & {
  alt?: string
  resizeMode?: string
  source: string
}

type TaoScrollViewProps = TaoViewProps & {
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never'
  showsVerticalScrollIndicator?: boolean
}

type TaoKeyboardAvoidingViewProps = TaoViewProps & {
  behavior?: 'height' | 'padding' | 'position'
  keyboardVerticalOffset?: number
}

type SafeAreaContextModule = {
  SafeAreaView: React.ComponentType<any>
}

export type RuntimeTextInputValue = {
  evaluate(): RuntimeTextInputValue
  jsValue: string
}

export type TaoTextInputBlurAction = {
  invoke(): void
}

export type TaoTextInputChangeAction = {
  invoke(value: RuntimeTextInputValue): void
}

type TaoPrimitiveKind =
  | 'Image'
  | 'KeyboardAvoidingView'
  | 'Pressable'
  | 'SafeAreaView'
  | 'ScrollView'
  | 'Text'
  | 'TextInput'
  | 'View'

type TaoPrimitiveElementProps = {
  readonly kind: TaoPrimitiveKind
  readonly nativePropOverrides?: Record<string, unknown>
  readonly pressableTitle?: string
  readonly providesParentDirection: boolean
  readonly runtimeProps: TaoViewRuntimeProps
  readonly viewProps: TaoViewProps
}

type TaoScreenElementProps = {
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

  TextInput(props: TaoTextInputProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPrimitiveElement, {
      kind: 'TextInput',
      nativePropOverrides: {
        onBlur: () => invokeBlur(props.onBlur),
        onChangeText: (value: string) => props.onChangeText?.invoke(runtimeTextInputValue(value)),
        placeholder: props.placeholder,
        value: props.value,
      },
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  /** textInputAction adapts a Tao text action into a TextInput-compatible change action. */
  textInputAction(action: TaoTextInputChangeAction): TaoTextInputChangeAction {
    return {
      invoke(value) {
        action.invoke(value)
      },
    }
  },

  Image(props: TaoImageProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Image',
      nativePropOverrides: {
        ...(props.alt === undefined ? {} : { accessibilityLabel: props.alt }),
        resizeMode: Image.resizeMode(props.resizeMode),
        source: Image.remote(props.source),
      },
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  KeyboardAvoidingView(
    props: TaoKeyboardAvoidingViewProps,
    runtimeProps: TaoViewRuntimeProps = {},
  ): React.JSX.Element {
    const runtime = requireReactNativeRuntime()
    return React.createElement(TaoPrimitiveElement, {
      kind: 'KeyboardAvoidingView',
      nativePropOverrides: {
        behavior: props.behavior ?? (runtime.Platform?.OS === 'ios' ? 'padding' : undefined),
        keyboardVerticalOffset: props.keyboardVerticalOffset,
      },
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  Pressable(props: TaoButtonProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const disabled = props.disabled === true || props.loading === true
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Pressable',
      nativePropOverrides: {
        accessibilityState: accessibilityState(runtimeProps.nativeProps?.['accessibilityState'], {
          busy: props.loading === true,
          disabled,
        }),
        disabled,
        onPress: disabled ? undefined : () => props.action?.invoke(),
      },
      pressableTitle: props.loading === true ? props.loadingTitle ?? props.title : props.title,
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  SafeAreaView(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPrimitiveElement, {
      kind: 'SafeAreaView',
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  Screen(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoScreenElement, {
      runtimeProps,
      viewProps: props,
    })
  },

  ScrollView(props: TaoScrollViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPrimitiveElement, {
      kind: 'ScrollView',
      nativePropOverrides: {
        keyboardShouldPersistTaps: props.keyboardShouldPersistTaps ?? 'handled',
        showsVerticalScrollIndicator: props.showsVerticalScrollIndicator,
      },
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },
} as const

function TaoScreenElement(props: TaoScreenElementProps): React.JSX.Element {
  const frameProps = {
    direction: 'column',
    layout: LayoutControls.create([['fill']]),
  } satisfies TaoViewRuntimeProps
  return Views.SafeAreaView(
    {
      __tao: props.viewProps.__tao,
      children: Views.KeyboardAvoidingView(
        {
          children: Views.ScrollView({ children: props.viewProps.children }, props.runtimeProps),
        },
        frameProps,
      ),
    },
    frameProps,
  )
}

function accessibilityState(
  inherited: unknown,
  state: { busy?: boolean; disabled?: boolean },
): Record<string, unknown> {
  return {
    ...(isRecord(inherited) ? inherited : {}),
    ...(state.busy ? { busy: true } : {}),
    ...(state.disabled ? { disabled: true } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function TaoPrimitiveElement(props: TaoPrimitiveElementProps): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const palette = StyleRuntime.usePalette()
  const merged = TaoPropsControls.mergeViewProps(props.viewProps, props.runtimeProps, parentDirection)
  const elementProps = StyleRuntime.primitiveNativeProps(props.kind, {
    ...TaoPropsControls.nativePropsWithStyle(merged),
    ...props.nativePropOverrides,
  }, palette)
  const nativeProps = props.kind === 'ScrollView' ? scrollViewNativeProps(elementProps) : elementProps
  const elementChildren = nativeChildren(runtime, props, merged.children, palette)
  const providedChildren = props.providesParentDirection
    ? ParentDirectionContext.childrenForLayoutParent(elementChildren, layoutParentStyle(nativeProps, props.kind))
    : elementChildren
  return createReactElement(
    runtime,
    nativeComponent(runtime, props.kind),
    nativeProps,
    providedChildren,
  )
}

function invokeBlur(onBlur: TaoTextInputProps['onBlur']): void {
  if (!onBlur) {
    return
  }
  onBlur.invoke()
}

function nativeComponent(runtime: ReactNativeRuntime, kind: TaoPrimitiveKind): React.ElementType {
  return Switch<TaoPrimitiveKind, React.ElementType>(kind, {
    Image: () => runtime.Image,
    KeyboardAvoidingView: () => runtime.KeyboardAvoidingView,
    Pressable: () => runtime.Pressable,
    SafeAreaView: () => safeAreaContext().SafeAreaView,
    ScrollView: () => runtime.ScrollView,
    Text: () => runtime.Text,
    TextInput: () => runtime.TextInput,
    View: () => runtime.View,
  })
}

function safeAreaContext(): SafeAreaContextModule {
  return require('react-native-safe-area-context') as SafeAreaContextModule
}

function scrollViewNativeProps(props: Record<string, unknown>): Record<string, unknown> {
  const { contentContainerStyle, style, ...rest } = props
  return {
    ...rest,
    contentContainerStyle: [contentContainerStyle, style],
    style: [{ alignSelf: 'stretch' }, rest['style']],
  }
}

function layoutParentStyle(props: Record<string, unknown>, kind: TaoPrimitiveKind): unknown {
  return kind === 'ScrollView' ? props['contentContainerStyle'] : props['style']
}

function runtimeTextInputValue(value: string): RuntimeTextInputValue {
  return {
    evaluate() {
      return this
    },
    jsValue: value,
  }
}

function nativeChildren(
  runtime: ReactNativeRuntime,
  props: TaoPrimitiveElementProps,
  children: React.ReactNode,
  palette: ReturnType<typeof StyleRuntime.usePalette>,
): React.ReactNode {
  return props.pressableTitle === undefined
    ? children
    : createReactElement(
      runtime,
      runtime.Text,
      StyleRuntime.primitiveNativeProps('PressableLabel', {}, palette),
      props.pressableTitle,
    )
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
