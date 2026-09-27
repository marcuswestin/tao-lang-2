import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { accessibilityStateProps, focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { RuntimeAssert } from './TR-assert'
import { createElement } from './TR-create-element'
import { InteractionControls } from './TR-interaction-catalog'
import {
  interactionMeasurements,
  OutlineScope,
  type TaoInteractionOccurrence,
  type TaoOutlineLiveEntry,
  useOutlineNode,
} from './TR-interaction-outline'
import { LayoutControls, type TaoLayoutEntry, type TaoResolvedLayoutStyle } from './TR-layout'
import { ParentDirectionContext } from './TR-parent-direction'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import { catalystPalette, SchemeControls } from './TR-scheme'
import RuntimeSwitch from './TR-switch'
import { TaoPropsControls, type TaoViewProps, type TaoViewRuntimeProps } from './TR-TaoProps'

type TaoButtonProps = TaoViewProps & {
  action?: {
    invoke(): unknown
  }
  /** defaultStyle is component chrome applied below mounted design and render-site overrides. */
  defaultStyle?: TaoResolvedLayoutStyle
  disabled?: boolean
  /** semanticIdentity names a handwritten platform/navigation control absent from generated metadata. */
  semanticIdentity?: string
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

type TaoPlaceholderProps = TaoViewProps & {
  label: string
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
  readonly semanticIdentity?: string
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
    return createElement(TaoPrimitiveElement, {
      kind: 'View',
      providesParentDirection: true,
      runtimeProps,
      viewProps: props,
    })
  },

  Text(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoPrimitiveElement, {
      kind: 'Text',
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  Pressable(props: TaoButtonProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoPrimitiveElement, {
      defaultStyle: props.defaultStyle,
      kind: 'Pressable',
      nativePropOverrides: {
        onPress: props.disabled === true ? undefined : () => props.action?.invoke(),
      },
      pressableTitle: props.title,
      providesParentDirection: true,
      runtimeProps,
      semanticIdentity: props.semanticIdentity,
      viewProps: props,
    })
  },

  TextInput(props: TaoTextInputProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoTextInput, { props, runtimeProps })
  },

  Image(props: TaoImageProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    RuntimeAssert.input(
      props.decorative === true || props.label?.trim(),
      'Informative Image requires a nonempty accessibility label.',
    )
    const accessibilityProps = props.decorative === true
      ? { accessible: false }
      : {
        accessibilityLabel: props.label,
        accessibilityRole: 'image',
        accessible: true,
      }
    return createElement(TaoPrimitiveElement, {
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
    return createElement(TaoCheckbox, { props, runtimeProps })
  },

  ScrollView(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoScrollView, { props, runtimeProps })
  },

  Panes(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoPanes, { props, runtimeProps })
  },

  Placeholder(props: TaoPlaceholderProps, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoPlaceholder, { props, runtimeProps })
  },

  Spacer(props: TaoViewProps = {}, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    return createElement(TaoPrimitiveElement, {
      kind: 'View',
      nativePropOverrides: { accessible: false },
      providesParentDirection: false,
      runtimeProps,
      viewProps: props,
    })
  },

  Spinner(props: TaoSpinnerProps = {}, runtimeProps: TaoViewRuntimeProps = {}): React.JSX.Element {
    const visible = props.visible !== false
    return createElement(TaoPrimitiveElement, {
      kind: 'Spinner',
      nativePropOverrides: {
        accessibilityLabel: props.label ?? 'Loading',
        accessibilityRole: 'progressbar',
        ...accessibilityStateProps({ busy: visible }),
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
    return createElement(TaoProgress, { props, runtimeProps })
  },
} as const

function TaoCheckbox({ props, runtimeProps }: {
  props: TaoCheckboxProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps, parentDirection)
  const occurrence = interactionOccurrence(props, runtimeProps)
  return catalystPalette(undefined)
    ? createElement(TaoCatalystCheckbox, { merged, occurrence, props, runtime })
    : renderCheckboxWithInteraction(props, runtime, merged, occurrence)
}

function TaoCatalystCheckbox({ merged, occurrence, props, runtime }: {
  merged: MergedTaoViewProps
  occurrence: TaoInteractionOccurrence | undefined
  props: TaoCheckboxProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const palette = catalystPalette(SchemeControls.use().resolved)
  const themed = palette
    ? { ...merged, props: { ...merged.props, style: { color: palette.color, ...merged.props?.style } } }
    : merged
  return renderCheckboxWithInteraction(props, runtime, themed, occurrence)
}

function renderCheckboxWithInteraction(
  props: TaoCheckboxProps,
  runtime: ReactNativeRuntime,
  merged: MergedTaoViewProps,
  occurrence: TaoInteractionOccurrence | undefined,
): React.ReactElement {
  return occurrence === undefined
    ? renderTaoCheckbox(props, runtime, merged)
    : createElement(TaoInteractiveCheckbox, { merged, occurrence, props, runtime })
}

function TaoInteractiveCheckbox({ merged, occurrence, props, runtime }: {
  merged: MergedTaoViewProps
  occurrence: TaoInteractionOccurrence
  props: TaoCheckboxProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const host = React.useRef<TaoAccessibilityHost | null>(null)
  if (occurrence.control) {
    occurrence.capabilities.focus = () => focusAccessibilityHost(runtime, host.current)
    occurrence.capabilities.label = () => props.label
  }
  return renderTaoCheckbox(props, runtime, merged, occurrence, host)
}

function renderTaoCheckbox(
  props: TaoCheckboxProps,
  runtime: ReactNativeRuntime,
  merged: MergedTaoViewProps,
  occurrence?: TaoInteractionOccurrence,
  host?: React.RefObject<TaoAccessibilityHost | null>,
): React.ReactElement {
  const disabled = props.disabled === true
  const checkbox = createElement(runtime.Switch, {
    accessibilityElementsHidden: true,
    accessible: false,
    disabled,
    importantForAccessibility: 'no',
    style: { pointerEvents: 'none' },
    value: props.value,
  })
  const label = createElement(
    runtime.Text,
    { accessible: false, style: textStyle(merged.props?.style) },
    props.label,
  )
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(merged)
  return createElement(
    runtime.Pressable,
    {
      ...wrapperProps,
      accessibilityLabel: props.label,
      accessibilityRole: 'checkbox',
      ...accessibilityStateProps({ checked: props.value, disabled }),
      disabled,
      ...(host ? { ref: host } : {}),
      ...semanticPressableProps(
        occurrence,
        disabled,
        disabled ? undefined : () => props.onChange?.(!props.value),
      ),
      style: [
        wrapperProps['style'],
        { alignItems: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.55 : 1 },
      ],
    },
    createElement(React.Fragment, null, checkbox, label),
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
  const outlinedChildren = outlineChildren(children, interactionOccurrence(props, runtimeProps))
  return createElement(
    runtime.ScrollView,
    {
      keyboardDismissMode: runtime.Platform?.OS === 'ios' ? 'interactive' : 'on-drag',
      keyboardShouldPersistTaps: 'handled',
      ...scrollViewProps,
      contentContainerStyle: mergedContentContainerStyle,
      style: scrollViewportStyle(style),
    },
    outlinedChildren,
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
  const outlinedChildren = outlineChildren(children, interactionOccurrence(props, runtimeProps))

  return createElement(
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
    outlinedChildren,
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
  // A `gap none` entry is a cleared slot, which spaces children exactly as no gap clause would.
  return gap?.[0] === 'gap' && gap[1] !== 'none' ? gap[1] : 0
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
  const fill = createElement(runtime.View, {
    accessible: false,
    style: {
      backgroundColor: themedStyle?.['color'] ?? '#2f6b4f',
      height: '100%',
      width: `${value * 100}%`,
    },
  })
  return createElement(
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

function TaoPlaceholder({ props, runtimeProps }: {
  props: TaoPlaceholderProps
  runtimeProps: TaoViewRuntimeProps
}): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  const parentDirection = ParentDirectionContext.use()
  const merged = TaoPropsControls.mergeViewProps(props, runtimeProps, parentDirection)
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(merged)
  const development = Dev.isDevelopmentBuild()
  const children = development
    ? createElement(
      React.Fragment,
      null,
      createElement(runtime.Text, {
        accessible: false,
        style: placeholderHatchStyle,
      }, placeholderHatch(wrapperProps['style'])),
      createElement(runtime.Text, {
        accessible: false,
        style: placeholderLabelStyle,
      }, props.label),
    )
    : undefined
  return createElement(
    runtime.View,
    {
      ...wrapperProps,
      accessibilityElementsHidden: true,
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
      style: [wrapperProps['style'], development ? placeholderDevelopmentStyle : undefined],
    },
    children,
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
  const occurrence = interactionOccurrence(props, runtimeProps)
  return catalystPalette(undefined)
    ? createElement(TaoCatalystTextInput, { merged, occurrence, props, runtime })
    : renderTextInputWithInteraction(props, runtime, merged, occurrence)
}

function TaoCatalystTextInput({ merged, occurrence, props, runtime }: {
  merged: MergedTaoViewProps
  occurrence: TaoInteractionOccurrence | undefined
  props: TaoTextInputProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const palette = catalystPalette(SchemeControls.use().resolved)
  const themed = palette
    ? { ...merged, props: { ...merged.props, style: { ...palette, ...merged.props?.style } } }
    : merged
  return renderTextInputWithInteraction(props, runtime, themed, occurrence)
}

function renderTextInputWithInteraction(
  props: TaoTextInputProps,
  runtime: ReactNativeRuntime,
  merged: MergedTaoViewProps,
  occurrence: TaoInteractionOccurrence | undefined,
): React.ReactElement {
  return occurrence === undefined
    ? renderTaoTextInput(props, runtime, merged)
    : createElement(TaoInteractiveTextInput, { merged, occurrence, props, runtime })
}

function TaoInteractiveTextInput({ merged, occurrence, props, runtime }: {
  merged: MergedTaoViewProps
  occurrence: TaoInteractionOccurrence
  props: TaoTextInputProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const inputRef = React.useRef<{ blur?(): void; focus?(): void } | null>(null)
  if (occurrence.control) {
    occurrence.capabilities.blur = () => inputRef.current?.blur?.()
    occurrence.capabilities.enabled = () => props.disabled !== true
    occurrence.capabilities.engage = () => inputRef.current?.focus?.()
    occurrence.capabilities.label = () => props.label
  }
  return renderTaoTextInput(props, runtime, merged, occurrence, inputRef)
}

function renderTaoTextInput(
  props: TaoTextInputProps,
  runtime: ReactNativeRuntime,
  merged: MergedTaoViewProps,
  occurrence?: TaoInteractionOccurrence,
  inputRef?: React.RefObject<{ blur?(): void; focus?(): void } | null>,
): React.ReactElement {
  const themedStyle = merged.props?.style
  const submit = props.disabled || !props.onSubmit
    ? undefined
    : InteractionControls.Activate(occurrence, props.onSubmit)
  const inputNativeProps = {
    accessibilityLabel: props.label,
    ...accessibilityStateProps({ disabled: props.disabled === true }),
    editable: !props.disabled,
    onBlur: () => InteractionControls.Disengage(occurrence),
    onChangeText: props.disabled || !props.onChange
      ? undefined
      : (value: string) => {
        InteractionControls.Engage(occurrence)
        return props.onChange?.(value)
      },
    onFocus: () => InteractionControls.Engage(occurrence),
    onSubmitEditing: submit,
    placeholder: props.placeholder,
    placeholderTextColor: translucentColor(themedStyle?.['color'], 0.55),
    ref: inputRef,
    style: [textInputStyle, themedStyle],
    testID: props.id || undefined,
    value: props.value,
  }
  const input = createElement(
    runtime.TextInput,
    occurrence?.control === undefined
      ? inputNativeProps
      : interactionMeasurements.bind(occurrence.control, inputNativeProps),
  )
  const label = createElement(
    runtime.Text,
    { accessible: false, style: [textInputLabelStyle, textStyle(themedStyle)] },
    props.label,
  )
  const children = createElement(React.Fragment, null, label, input)
  const wrapperProps = TaoPropsControls.nativePropsWithStyle(withoutVisualStyle(merged))
  return createElement(
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
  return catalystPalette(undefined) && (props.kind === 'Text' || props.kind === 'Pressable')
    ? createElement(TaoCatalystPrimitiveElement, { merged, props, runtime })
    : renderPrimitiveWithInteraction(props, runtime, merged)
}

/** Only mounted Catalyst text mounts a subscriber; element factories remain host-independent. */
function TaoCatalystPrimitiveElement({ merged, props, runtime }: {
  merged: MergedTaoViewProps
  props: TaoPrimitiveElementProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const palette = catalystPalette(SchemeControls.use().resolved)
  return renderPrimitiveWithInteraction(
    {
      ...props,
      defaultStyle: palette ? { color: palette.color, ...props.defaultStyle } : props.defaultStyle,
    },
    runtime,
    merged,
  )
}

function renderPrimitiveWithInteraction(
  props: TaoPrimitiveElementProps,
  runtime: ReactNativeRuntime,
  merged: MergedTaoViewProps,
): React.ReactElement {
  if (props.semanticIdentity !== undefined) {
    return createElement(TaoSemanticPrimitiveElement, { merged, props, runtime })
  }
  const occurrence = interactionOccurrence(props.viewProps, props.runtimeProps)
  return occurrence === undefined
    ? renderTaoPrimitiveElement(props, runtime, merged)
    : createElement(TaoInteractivePrimitiveElement, { merged, occurrence, props, runtime })
}

function TaoInteractivePrimitiveElement({ merged, occurrence, props, runtime }: {
  merged: MergedTaoViewProps
  occurrence: TaoInteractionOccurrence
  props: TaoPrimitiveElementProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const host = React.useRef<TaoAccessibilityHost | null>(null)
  if (occurrence.control) {
    occurrence.capabilities.label = () => props.pressableTitle
  }
  return renderTaoPrimitiveElement(props, runtime, merged, occurrence, host)
}

function TaoSemanticPrimitiveElement({ merged, props, runtime }: {
  merged: MergedTaoViewProps
  props: TaoPrimitiveElementProps
  runtime: ReactNativeRuntime
}): React.ReactElement {
  const handwrittenCapabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const host = React.useRef<TaoAccessibilityHost | null>(null)
  const handwrittenIdentity = useOutlineNode(
    {
      identity: props.semanticIdentity!,
      kind: 'action',
      label: () => props.pressableTitle,
      live: handwrittenCapabilities,
      provenance: { control: props.semanticIdentity! },
    },
  )
  const occurrence = interactionOccurrence(props.viewProps, props.runtimeProps)
    ?? (handwrittenIdentity === undefined
      ? undefined
      : { capabilities: handwrittenCapabilities, control: handwrittenIdentity, scope: handwrittenIdentity })
  if (handwrittenIdentity !== undefined) {
    handwrittenCapabilities.label = () => props.pressableTitle
    handwrittenCapabilities.measure = () => interactionMeasurements.read(handwrittenIdentity)
  }
  return renderTaoPrimitiveElement(props, runtime, merged, occurrence, host)
}

function renderTaoPrimitiveElement(
  props: TaoPrimitiveElementProps,
  runtime: ReactNativeRuntime,
  merged: MergedTaoViewProps,
  occurrence?: TaoInteractionOccurrence,
  host?: React.RefObject<TaoAccessibilityHost | null>,
): React.ReactElement {
  if (props.kind === 'Pressable' && occurrence?.control && host) {
    occurrence.capabilities.focus = () => focusAccessibilityHost(runtime, host.current)
  }
  const unmeasuredElementProps: Record<string, unknown> = {
    ...TaoPropsControls.nativePropsWithStyle(merged),
    ...props.nativePropOverrides,
    ...(props.kind === 'Pressable' && host ? { ref: host } : {}),
  }
  const rawElementProps = occurrence?.control === undefined
    ? unmeasuredElementProps
    : interactionMeasurements.bind(occurrence.control, unmeasuredElementProps)
  const elementProps = props.kind === 'Pressable'
    ? {
      ...accessiblePressableProps(rawElementProps, props.pressableTitle),
      ...semanticPressableProps(
        occurrence,
        rawElementProps['disabled'] === true,
        typeof rawElementProps['onPress'] === 'function' ? rawElementProps['onPress'] as () => unknown : undefined,
        rawElementProps,
      ),
    }
    : rawElementProps
  if (props.defaultStyle !== undefined) {
    elementProps['style'] = [props.defaultStyle, elementProps['style']]
  }
  const elementChildren = nativeChildren(runtime, props, merged.children, merged.props?.style)
  const providedChildren = props.providesParentDirection
    ? ParentDirectionContext.childrenForLayoutParent(elementChildren, elementProps['style'])
    : elementChildren
  const outlinedChildren = outlineChildren(providedChildren, occurrence)
  return createElement(
    nativeComponent(runtime, props.kind),
    elementProps,
    outlinedChildren,
  )
}

function accessiblePressableProps(
  nativeProps: Record<string, unknown>,
  title: string | undefined,
): Record<string, unknown> {
  const state = typeof nativeProps['accessibilityState'] === 'object' && nativeProps['accessibilityState'] !== null
    ? nativeProps['accessibilityState'] as Record<string, unknown>
    : {}
  return {
    ...nativeProps,
    accessible: nativeProps['accessible'] ?? true,
    accessibilityLabel: nativeProps['accessibilityLabel'] ?? title,
    accessibilityRole: nativeProps['accessibilityRole'] ?? 'button',
    ...accessibilityStateProps({ ...state, disabled: nativeProps['disabled'] === true }),
  }
}

/** Wrapper-free sibling regions provide outline ancestry without adding a native layout element. */
function outlineChildren(
  children: React.ReactNode,
  occurrence: TaoInteractionOccurrence | undefined,
): React.ReactNode {
  return occurrence?.region === undefined
    ? children
    : createElement(OutlineScope, { identity: occurrence.region }, children)
}

function interactionOccurrence(
  props: TaoViewProps,
  runtimeProps: TaoViewRuntimeProps,
): TaoInteractionOccurrence | undefined {
  return InteractionControls.FromProps(props.__tao)
    ?? InteractionControls.FromVisualLayout(props.layout)
    ?? InteractionControls.FromProps(runtimeProps)
}

function semanticPressableProps(
  occurrence: TaoInteractionOccurrence | undefined,
  disabled: boolean,
  onPress: (() => unknown) | undefined,
  nativeProps: Record<string, unknown> = {},
): Record<string, unknown> {
  if (occurrence?.control) {
    occurrence.capabilities.enabled = () => !disabled
  }
  const invoke = onPress === undefined ? undefined : InteractionControls.Activate(occurrence, onPress)
  const existingPressIn = functionProp(nativeProps, 'onPressIn')
  const existingPressOut = functionProp(nativeProps, 'onPressOut')
  const existingHoverIn = functionProp(nativeProps, 'onHoverIn')
  const existingHoverOut = functionProp(nativeProps, 'onHoverOut')
  const existingFocus = functionProp(nativeProps, 'onFocus')
  const existingBlur = functionProp(nativeProps, 'onBlur')
  return {
    onBlur: (...arguments_: unknown[]) => {
      InteractionControls.Pressed(occurrence, false)
      existingBlur?.(...arguments_)
    },
    onFocus: (...arguments_: unknown[]) => {
      InteractionControls.Target(occurrence)
      existingFocus?.(...arguments_)
    },
    onHoverIn: (...arguments_: unknown[]) => {
      InteractionControls.Hover(occurrence, true)
      existingHoverIn?.(...arguments_)
    },
    onHoverOut: (...arguments_: unknown[]) => {
      InteractionControls.Hover(occurrence, false)
      existingHoverOut?.(...arguments_)
    },
    onPress: disabled ? undefined : invoke,
    onPressIn: (...arguments_: unknown[]) => {
      InteractionControls.Target(occurrence)
      InteractionControls.Pressed(occurrence, true)
      existingPressIn?.(...arguments_)
    },
    onPressOut: (...arguments_: unknown[]) => {
      InteractionControls.Pressed(occurrence, false)
      existingPressOut?.(...arguments_)
    },
  }
}

function functionProp(
  props: Record<string, unknown>,
  name: string,
): ((...arguments_: unknown[]) => unknown) | undefined {
  const value = props[name]
  return typeof value === 'function' ? value as (...arguments_: unknown[]) => unknown : undefined
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
    : createElement(
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

const placeholderDevelopmentStyle = {
  alignItems: 'center',
  backgroundColor: '#f4f5f2',
  borderColor: '#747b75',
  borderStyle: 'dashed',
  borderWidth: 1,
  justifyContent: 'center',
  overflow: 'hidden',
  position: 'relative',
} as const

const placeholderHatchStyle = {
  bottom: 0,
  color: '#aeb3ae',
  fontSize: 12,
  left: 0,
  lineHeight: 12,
  opacity: 0.55,
  position: 'absolute',
  right: 0,
  top: 0,
} as const

const placeholderLabelStyle = {
  backgroundColor: '#f4f5f2dd',
  color: '#343a35',
  fontSize: 12,
  fontWeight: '600',
  paddingHorizontal: 4,
  paddingVertical: 2,
} as const

function placeholderHatch(style: unknown): string {
  const height = styleProperty(style, 'height')
  const lineCount = typeof height === 'number' && Number.isFinite(height) && height > 0
    ? Math.max(12, Math.ceil(height / placeholderHatchStyle.lineHeight) + 1)
    : 12
  return Array.from({ length: lineCount }, () => '╱   ╱   ╱   ╱   ╱   ╱').join('\n')
}

function styleProperty(style: unknown, property: string): unknown {
  if (Array.isArray(style)) {
    for (let index = style.length - 1; index >= 0; index--) {
      const value = styleProperty(style[index], property)
      if (value !== undefined) {
        return value
      }
    }
    return undefined
  }
  return typeof style === 'object' && style !== null ? (style as Record<string, unknown>)[property] : undefined
}
