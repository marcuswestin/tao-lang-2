import React from 'react'
import { accessibilityVerbProps, focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { createElement } from './TR-create-element'
import { InteractionControls, useAccessibilityVerbs } from './TR-interaction-catalog'
import { interactionMeasurements, type TaoOutlineLiveEntry } from './TR-interaction-outline'
import { InteractionScrollContext, type Measurable } from './TR-interaction-scroll'
import { requireReactNativeRuntime } from './TR-react-native'

/**
 * SelectableRow adds one accessible press surface around otherwise untouched loop-row content. The
 * row's derived label is its accessible name: the surface is one accessibility element, so without
 * it the platform would read every descendant text in turn.
 */
export function SelectableRow(props: {
  accessibilityLabel?: string
  capabilities?: TaoOutlineLiveEntry
  children?: React.ReactNode
  identity?: string
  onSelect: () => unknown
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const host = React.useRef<(TaoAccessibilityHost & Measurable) | null>(null)
  const reveal = React.useContext(InteractionScrollContext)
  const longPressed = React.useRef(false)
  if (props.capabilities) {
    props.capabilities.focus = () => focusAccessibilityHost(runtime, host.current)
    props.capabilities.scrollIntoView = () => reveal?.(host.current)
  }
  const verbs = useAccessibilityVerbs(props.identity)
  const activate = InteractionControls.ActivateIdentity(props.identity, props.onSelect)
  const openVerbs = () => InteractionControls.OpenVerbsForIdentity(props.identity)
  const nativeProps = {
    ...(props.accessibilityLabel === undefined ? {} : { accessibilityLabel: props.accessibilityLabel }),
    accessibilityRole: 'button',
    accessible: true,
    // `focusin` bubbles on web, so a nested control's own focus arrives here as the row's. Taking
    // attention then would move it off that control and pull DOM focus back to the row.
    onFocus: (event?: TaoRowFocusEvent) => {
      if (event !== undefined && event.target !== event.currentTarget) {
        return
      }
      InteractionControls.TargetIdentity(props.identity)
    },
    onPress: () => {
      if (!longPressed.current) {
        activate()
      }
    },
    onPressIn: () => {
      longPressed.current = false
    },
    onLongPress: () => {
      longPressed.current = true
      openVerbs()
    },
    ref: host,
  }
  const actionProps = accessibilityVerbProps(nativeProps, verbs, identity => {
    if (props.identity !== undefined) {
      InteractionControls.InvokeVerb(props.identity, identity)
    }
  })
  if (runtime.Platform?.OS === 'web') {
    const { accessibilityRole: _accessibilityRole, accessible: _accessible, onPress: _onPress, ...webProps } =
      actionProps
    const selectableProps = webSelectableRowProps(webProps, activate, openVerbs)
    return createElement(
      runtime.View,
      props.identity === undefined ? selectableProps : interactionMeasurements.bind(props.identity, selectableProps),
      props.children,
    )
  }
  return createElement(
    runtime.Pressable,
    props.identity === undefined ? actionProps : interactionMeasurements.bind(props.identity, actionProps),
    props.children,
  )
}

type TaoWebClickEvent = Readonly<{
  button?: number
  currentTarget?: unknown
  preventDefault?(): void
  stopPropagation?(): void
  target?: Readonly<{ closest?(selector: string): unknown }>
}>

/** A native focus event carries neither field, so the row keeps taking attention off the platform. */
type TaoRowFocusEvent = Readonly<{
  currentTarget?: unknown
  target?: unknown
}>

/** A web row is a named group, not a button containing every button rendered by the row. */
function webSelectableRowProps(
  nativeProps: Record<string, unknown>,
  activate: () => unknown,
  openVerbs: () => void,
): Record<string, unknown> {
  return {
    ...nativeProps,
    onClick: (event: TaoWebClickEvent) => {
      if (event.button !== undefined && event.button !== 0) {
        return
      }
      const nestedControl = event.target?.closest?.(
        'button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), '
          + '[role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="switch"]',
      )
      if (nestedControl === undefined || nestedControl === null || nestedControl === event.currentTarget) {
        activate()
      }
    },
    onContextMenu: (event: TaoWebClickEvent) => {
      event.preventDefault?.()
      event.stopPropagation?.()
      openVerbs()
    },
    role: 'group',
    tabIndex: -1,
  }
}
