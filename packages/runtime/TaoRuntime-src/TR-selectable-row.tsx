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
    onPress: InteractionControls.ActivateIdentity(props.identity, props.onSelect),
    ref: host,
  }
  return React.createElement(
    runtime.Pressable,
    props.identity === undefined ? nativeProps : interactionMeasurements.bind(props.identity, nativeProps),
    props.children,
  )
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
