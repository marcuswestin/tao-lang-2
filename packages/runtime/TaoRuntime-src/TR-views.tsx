import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { LayoutControls, type TaoLayoutEntry, type TaoResolvedLayoutStyle } from './TR-layout'
import { ParentDirectionContext } from './TR-parent-direction'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import RuntimeSwitch from './TR-switch'
import { TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): unknown
  }
  /** defaultStyle is component chrome applied below mounted design and render-site overrides. */
  defaultStyle?: TaoResolvedLayoutStyle
  disabled?: boolean
  title: string
}

type TaoCheckboxProps = TaoViewProps & {
  disabled?: boolean
  label: string
  onChange?: (value: boolean) => unknown
  value: boolean
}

type TaoImageProps = TaoViewProps & {
  decorative?: boolean
  label?: string
  resizeMode?: 'center' | 'contain' | 'cover' | 'repeat' | 'stretch'
  source: string
}

type TaoProgressProps = TaoViewProps & {
  label?: string
  value: number
}

type TaoSpinnerProps = TaoViewProps & {
  label?: string
  size?: 'large' | 'small'
  visible?: boolean
}

type TaoTextInputProps = TaoViewProps & {
  disabled?: boolean
  id?: string
  label: string
  onChange?: (value: string) => unknown
  onSubmit?: () => unknown
  placeholder?: string
  value: string
}

type TaoPrimitiveKind = 'Image' | 'Pressable' | 'Spinner' | 'Text' | 'View'

type TaoPrimitiveElementProps = {
  readonly defaultStyle?: TaoResolvedLayoutStyle
  readonly kind: TaoPrimitiveKind
  readonly nativePropOverrides?: Record<string, unknown>
  readonly pressableTitle?: string
  readonly providesParentDirection: boolean
  readonly runtimeProps: TaoViewRuntimeProps
  readonly viewProps: TaoViewProps
}

type MergedTaoViewProps = ReturnType<typeof TaoPropsControls.mergeViewProps>

type TaoLayoutEvent = {
  nativeEvent?: {
    layout?: {
      width?: number
    }
  }
}

const minimumPaneWidth = 320
const scrollContentLayoutHeads = new Set<TaoLayoutEntry[0]>(['content', 'gap', 'pad'])

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
      defaultStyle: props.defaultStyle,
      kind: 'Pressable',
      nativePropOverrides: {
        onPress: () => props.disabled === true ? undefined : props.action?.invoke(),
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

  Image(props: TaoImageProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    if (props.decorative !== true && !props.label?.trim()) {
      throw new Error('Informative Image requires a nonempty accessibility label.')
    }
    const accessibilityProps = props.decorative === true
      ? { accessible: false }
      : {
        accessibilityLabel: props.label,
        accessibilityRole: 'image',
        accessible: true,
      }
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Image',
      nativePropOverrides: {
        ...accessibilityProps,
        resizeMode: props.resizeMode,
        source: { uri: props.source },
      },
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  Checkbox(props: TaoCheckboxProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoCheckbox, { props, runtimeProps })
  },

  ScrollView(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoScrollView, { props, runtimeProps })
  },

  Panes(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoPanes, { props, runtimeProps })
  },

  Spinner(props: TaoSpinnerProps = {}, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const visible = props.visible !== false
    return React.createElement(TaoPrimitiveElement, {
      kind: 'Spinner',
      nativePropOverrides: {
        accessibilityLabel: props.label ?? 'Loading',
        accessibilityRole: 'progressbar',
        accessibilityState: { busy: visible },
        animating: visible,
        hidesWhenStopped: true,
        size: props.size,
      },
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  Progress(props: TaoProgressProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return React.createElement(TaoProgress, { props, runtimeProps })
  },
} as const

function TaoCheckbox({ props, runtimeProps }: {
  props: TaoCheckboxProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps, parentDirection)
  const disabled = props.disabled === true
  const checkbox = createReactElement(runtime, runtime.Switch, {
    accessibilityElementsHidden: true,
    accessible: false,
    disabled,
    importantForAccessibility: 'no',
    pointerEvents: 'none',
    value: props.value,
  })
  const label = createReactElement(
    runtime,
    runtime.Text,
    { accessible: false, style: textStyle(merged.props?.style) },
    props.label,
  )
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(merged)
  return createReactElement(
    runtime,
    runtime.Pressable,
    {
      ...wrapperProps,
      accessibilityLabel: props.label,
      accessibilityRole: 'checkbox',
      accessibilityState: { checked: props.value, disabled },
      disabled,
      onPress: disabled ? undefined : () => props.onChange?.(!props.value),
      style: [
        wrapperProps['style'],
        { alignItems: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.55 : 1 },
      ],
    },
    React.createElement(React.Fragment, null, checkbox, label),
  )
}

function TaoScrollView({ props, runtimeProps }: {
  props: TaoViewProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const contentDirection = runtimeProps.direction ?? 'column'
  const merged = TaoPropsControls.mergeViewProps(
    props,
    { ...runtimeProps, direction: contentDirection },
    parentDirection,
  )
  const entries = merged.props?.layout?.entries ?? []
  const contentEntries = entries.filter(entry => scrollContentLayoutHeads.has(entry[0]))
  const viewportEntries = entries.filter(entry => !scrollContentLayoutHeads.has(entry[0]))
  const viewportMerged = mergedWithLayoutEntries(merged, viewportEntries, undefined)
  const nativeProps = TaoPropsControls.nativePropsWithStyle(viewportMerged)
  const { contentContainerStyle, style, ...scrollViewProps } = nativeProps
  const contentLayoutStyle = LayoutControls.resolve({ direction: contentDirection, entries: contentEntries })
  const mergedContentContainerStyle = [{ flexGrow: 1 }, contentLayoutStyle, contentContainerStyle]
  const children = ParentDirectionContext.childrenForLayoutParent(
    merged.children,
    mergedContentContainerStyle,
  )
  return createReactElement(
    runtime,
    runtime.ScrollView,
    {
      ...scrollViewProps,
      contentContainerStyle: mergedContentContainerStyle,
      style: scrollViewportStyle(style),
    },
    children,
  )
}

function scrollViewportStyle(style: unknown): unknown {
  const defaultStyle = { alignSelf: 'stretch' }
  return !style || (typeof style === 'object' && !Array.isArray(style) && Object.keys(style).length === 0)
    ? defaultStyle
    : [defaultStyle, style]
}

function TaoPanes({ props, runtimeProps }: {
  props: TaoViewProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const [measuredWidth, setMeasuredWidth] = React.useState<number>()
  const columnMerged = TaoPropsControls.mergeViewProps(
    props,
    { ...runtimeProps, direction: 'column' },
    parentDirection,
  )
  const childCount = directChildCount(columnMerged.children)
  const gap = layoutGap(columnMerged)
  const availableChildWidth = childCount > 0
    ? (measuredWidth ?? 0) - Math.max(0, childCount - 1) * gap
    : 0
  const direction = measuredWidth !== undefined
      && childCount > 0
      && availableChildWidth / childCount >= minimumPaneWidth
    ? 'row'
    : 'column'
  const merged = direction === 'column'
    ? columnMerged
    : TaoPropsControls.mergeViewProps(props, { ...runtimeProps, direction }, parentDirection)
  const nativeProps = TaoPropsControls.nativePropsWithStyle(merged)
  const { onLayout, ...viewProps } = nativeProps
  const children = ParentDirectionContext.childrenForLayoutParent(merged.children, nativeProps['style'])

  return createReactElement(
    runtime,
    runtime.View,
    {
      ...viewProps,
      onLayout: (event: TaoLayoutEvent) => {
        if (typeof onLayout === 'function') {
          onLayout(event)
        }
        const width = event.nativeEvent?.layout?.width
        if (typeof width === 'number' && Number.isFinite(width) && width >= 0) {
          setMeasuredWidth(current => current === width ? current : width)
        }
      },
    },
    children,
  )
}

function mergedWithLayoutEntries(
  merged: MergedTaoViewProps,
  entries: readonly TaoLayoutEntry[],
  direction: MergedTaoViewProps['direction'],
): MergedTaoViewProps {
  return {
    ...merged,
    direction,
    props: merged.props
      ? {
        ...merged.props,
        layout: entries.length > 0 ? { entries } : undefined,
      }
      : undefined,
  }
}

function layoutGap(merged: MergedTaoViewProps): number {
  const gap = merged.props?.layout?.entries.find(entry => entry[0] === 'gap')
  return gap?.[0] === 'gap' ? gap[1] : 0
}

function directChildCount(children: React.ReactNode): number {
  let count = 0
  React.Children.forEach(children, child => {
    if (child === null || child === undefined || typeof child === 'boolean') {
      return
    }
    if (React.isValidElement(child) && child.type === React.Fragment) {
      count += directChildCount((child.props as { children?: React.ReactNode }).children)
      return
    }
    count += 1
  })
  return count
}

function TaoProgress({ props, runtimeProps }: {
  props: TaoProgressProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps, parentDirection)
  const themedStyle = merged.props?.style
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(withoutVisualStyle(merged))
  const value = normalizedProgress(props.value)
  const fill = createReactElement(runtime, runtime.View, {
    accessible: false,
    style: {
      backgroundColor: themedStyle?.['color'] ?? '#2f6b4f',
      height: '100%',
      width: `${value * 100}%`,
    },
  })
  return createReactElement(
    runtime,
    runtime.View,
    {
      ...wrapperProps,
      accessibilityLabel: props.label ?? 'Progress',
      accessibilityRole: 'progressbar',
      accessibilityValue: { max: 1, min: 0, now: value },
      style: [
        wrapperProps['style'],
        { backgroundColor: '#d9dfda', borderRadius: 999, height: 8, overflow: 'hidden' },
        themedStyle,
      ],
    },
    fill,
  )
}

function normalizedProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function TaoTextInput({ props, runtimeProps }: {
  props: TaoTextInputProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps, parentDirection)
  const themedStyle = merged.props?.style
  const input = createReactElement(runtime, runtime.TextInput, {
    accessibilityLabel: props.label,
    accessibilityState: { disabled: props.disabled === true },
    editable: !props.disabled,
    onChangeText: props.disabled ? undefined : props.onChange,
    onSubmitEditing: props.disabled ? undefined : props.onSubmit,
    placeholder: props.placeholder,
    placeholderTextColor: translucentColor(themedStyle?.['color'], 0.55),
    style: [textInputStyle, themedStyle],
    testID: props.id || undefined,
    value: props.value,
  })
  const label = createReactElement(
    runtime,
    runtime.Text,
    { style: [textInputLabelStyle, textStyle(themedStyle)] },
    props.label,
  )
  const children = React.createElement(React.Fragment, null, label, input)
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(withoutVisualStyle(merged))
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
  if (props.defaultStyle !== undefined) {
    elementProps['style'] = [props.defaultStyle, elementProps['style']]
  }
  const elementChildren = nativeChildren(runtime, props, merged.children, merged.props?.style)
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
  return RuntimeSwitch<TaoPrimitiveKind, React.ElementType>(kind, {
    Image: () => runtime.Image,
    Pressable: () => runtime.Pressable,
    Spinner: () => runtime.ActivityIndicator,
    Text: () => runtime.Text,
    View: () => runtime.View,
  })
}

function nativeChildren(
  runtime: ReactNativeRuntime,
  props: TaoPrimitiveElementProps,
  children: React.ReactNode,
  style: TaoResolvedLayoutStyle | undefined,
): React.ReactNode {
  return props.pressableTitle === undefined
    ? children
    : createReactElement(
      runtime,
      runtime.Text,
      { style: [textStyle(props.defaultStyle), textStyle(style)] },
      props.pressableTitle,
    )
}

function withoutVisualStyle(merged: MergedTaoViewProps): MergedTaoViewProps {
  return merged.props?.style
    ? { ...merged, props: { ...merged.props, style: undefined } }
    : merged
}

function textStyle(style: TaoResolvedLayoutStyle | undefined): TaoResolvedLayoutStyle | undefined {
  if (!style) {
    return undefined
  }
  const text: TaoResolvedLayoutStyle = {}
  const mutableText = text as Record<string, unknown>
  for (const property of ['color', 'fontSize', 'fontWeight', 'lineHeight'] as const) {
    const value = style[property]
    if (value !== undefined) {
      mutableText[property] = value
    }
  }
  return Object.keys(text).length > 0 ? text : undefined
}

function translucentColor(
  color: TaoResolvedLayoutStyle['color'] | undefined,
  opacity: number,
): string | undefined {
  if (typeof color !== 'string') {
    return undefined
  }
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color)
  if (!match) {
    return color
  }
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')
  return `#${match[1]}${alpha}`
}

const textInputStyle = {
  borderColor: '#a8b0aa',
  borderRadius: 8,
  borderWidth: 1,
  color: '#17201a',
  fontSize: 16,
  minHeight: 44,
  paddingHorizontal: 12,
  paddingVertical: 10,
} as const

const textInputLabelStyle = { color: '#314238', fontSize: 14, fontWeight: '600' } as const

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
