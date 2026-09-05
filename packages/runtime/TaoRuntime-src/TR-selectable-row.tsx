import React from 'react'
import { focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import { InteractionControls, type TaoInteractionVerb } from './TR-interaction-catalog'
import { interactionMeasurements, type TaoOutlineLiveEntry } from './TR-interaction-outline'
import { requireReactNativeRuntime } from './TR-react-native'

type AccessibilityActionEvent = Readonly<{
  nativeEvent?: Readonly<{ actionName?: string }>
}>

let cachedOutlineRevision = -1
let cachedLiveNodes: ReturnType<typeof InteractionControls.Outline.liveNodes> = []
let cachedLiveNodesByIdentity = new Map<string, (typeof cachedLiveNodes)[number]>()

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
  const host = React.useRef<TaoAccessibilityHost | null>(null)
  React.useSyncExternalStore(
    InteractionControls.Catalog.subscribe,
    InteractionControls.Catalog.snapshot,
    InteractionControls.Catalog.snapshot,
  )
  React.useSyncExternalStore(
    InteractionControls.Outline.subscribe,
    InteractionControls.Outline.snapshot,
    InteractionControls.Outline.snapshot,
  )
  if (props.capabilities) {
    props.capabilities.focus = () => focusAccessibilityHost(runtime, host.current)
  }
  const verbs = accessibilityVerbs(props.identity)
  const accessibilityActions = verbs.map(verb => ({
    label: verb.label,
    name: accessibilityActionName(verb.identity),
  }))
  const activate = InteractionControls.ActivateIdentity(props.identity, props.onSelect)
  const nativeProps = {
    ...(props.accessibilityLabel === undefined ? {} : { accessibilityLabel: props.accessibilityLabel }),
    ...(accessibilityActions.length === 0 ? {} : { accessibilityActions }),
    accessibilityRole: 'button',
    accessible: true,
    ...(accessibilityActions.length === 0
      ? {}
      : {
        onAccessibilityAction: (event: AccessibilityActionEvent) => {
          const actionName = event.nativeEvent?.actionName
          const verb = verbs.find(candidate => accessibilityActionName(candidate.identity) === actionName)
          if (props.identity !== undefined && verb !== undefined) {
            InteractionControls.InvokeVerb(props.identity, verb.identity)
          }
        },
      }),
    // `focusin` bubbles on web, so a nested control's own focus arrives here as the row's. Taking
    // attention then would move it off that control and pull DOM focus back to the row.
    onFocus: (event?: TaoRowFocusEvent) => {
      if (event !== undefined && event.target !== event.currentTarget) {
        return
      }
      InteractionControls.TargetIdentity(props.identity)
    },
    onPress: activate,
    ref: host,
  }
  if (runtime.Platform?.OS === 'web') {
    const { accessibilityRole: _accessibilityRole, accessible: _accessible, onPress: _onPress, ...webProps } =
      nativeProps
    const selectableProps = webSelectableRowProps(webProps, activate)
    return React.createElement(
      runtime.View,
      props.identity === undefined ? selectableProps : interactionMeasurements.bind(props.identity, selectableProps),
      props.children,
    )
  }
  return React.createElement(
    runtime.Pressable,
    props.identity === undefined ? nativeProps : interactionMeasurements.bind(props.identity, nativeProps),
    props.children,
  )
}

type TaoWebClickEvent = Readonly<{
  currentTarget?: unknown
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
): Record<string, unknown> {
  return {
    ...nativeProps,
    onClick: (event: TaoWebClickEvent) => {
      const nestedControl = event.target?.closest?.(
        'button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), '
          + '[role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="switch"]',
      )
      if (nestedControl === undefined || nestedControl === null || nestedControl === event.currentTarget) {
        activate()
      }
    },
    role: 'group',
    tabIndex: -1,
  }
}

function accessibilityVerbs(identity: string | undefined): readonly TaoInteractionVerb[] {
  if (identity === undefined) {
    return []
  }
  const { nodes, nodesByIdentity } = accessibilityNodes()
  const target = nodesByIdentity.get(identity)
  return InteractionControls.Catalog.verbsFor(target, InteractionControls.Outline, nodes)
    .filter(verb => verb.enabled && directlyInvokable(verb))
}

function accessibilityNodes(): {
  nodes: typeof cachedLiveNodes
  nodesByIdentity: typeof cachedLiveNodesByIdentity
} {
  const revision = InteractionControls.Outline.liveSnapshot()
  if (revision !== cachedOutlineRevision) {
    cachedOutlineRevision = revision
    cachedLiveNodes = InteractionControls.Outline.liveNodes()
    cachedLiveNodesByIdentity = new Map(cachedLiveNodes.map(node => [node.identity, node]))
  }
  return { nodes: cachedLiveNodes, nodesByIdentity: cachedLiveNodesByIdentity }
}

function directlyInvokable(verb: TaoInteractionVerb): boolean {
  const unfilled = new Set(verb.command?.unfilledSlots() ?? [])
  return !verb.slots?.some(slot => slot.required && unfilled.has(slot.name))
}

function accessibilityActionName(identity: string): string {
  return `tao:${identity}`
}
