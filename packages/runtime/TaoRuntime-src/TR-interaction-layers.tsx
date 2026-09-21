import React from 'react'
import { accessibilityStateProps } from './TR-accessibility'
import { createElement } from './TR-create-element'
import { DataControls } from './TR-data'
import { runtimeInteractionValue } from './TR-interaction-attention'
import {
  commandCatalog,
  interactionAttention,
} from './TR-interaction-catalog'
import { interactionKeyboardPresence } from './TR-interaction-keys'
import {
  interactionMeasurements,
  interactionOutline,
  type TaoInteractionBounds,
  type TaoOutlineLiveNode,
} from './TR-interaction-outline'
import { mountedDesignStyle } from './TR-mounted-design'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

/** One render's identity index over the mounted outline. */
type OutlineIndex = ReadonlyMap<string, TaoOutlineLiveNode>

type InteractionSurfaceRow = Readonly<{
  bounds?: TaoInteractionBounds
  enabled?: boolean
  identity: string
  key?: string
  label: string
  selected?: boolean
}>

/** InteractionLayersHost is the one snapshot-derived visual projection mounted by the app host. */
export function InteractionLayersHost(props: { taoProps?: TaoProps }): React.JSX.Element {
  React.useSyncExternalStore(
    interactionAttention.subscribe,
    interactionAttention.snapshot,
    interactionAttention.snapshot,
  )
  React.useSyncExternalStore(interactionOutline.subscribe, interactionOutline.snapshot, interactionOutline.snapshot)
  React.useSyncExternalStore(commandCatalog.subscribe, commandCatalog.snapshot, commandCatalog.snapshot)
  React.useSyncExternalStore(DataControls.subscribeAll, DataControls.revision, DataControls.revision)
  React.useSyncExternalStore(
    interactionKeyboardPresence.subscribe,
    interactionKeyboardPresence.snapshot,
    interactionKeyboardPresence.snapshot,
  )
  React.useSyncExternalStore(
    interactionMeasurements.subscribe,
    interactionMeasurements.snapshot,
    interactionMeasurements.snapshot,
  )

  const attention = interactionAttention.read()
  const nodes = interactionOutline.liveNodes()
  // One index per render. Every surface below resolves identities against it rather than scanning
  // the mounted outline once per candidate on every keystroke.
  const nodesByIdentity = new Map(nodes.map(node => [node.identity, node]))
  const visible = interactionKeyboardPresence.read()
    && (attention.mode === 'hints'
      || attention.mode === 'overview'
      || attention.mode === 'narrowing'
      || attention.mode === 'verbs'
      || attention.mode === 'palette'
      || attention.mode === 'verb-pending')
  let heading: string | undefined
  let kind: 'Hint' | 'Overview' = 'Overview'
  let rows: readonly InteractionSurfaceRow[] = []

  if (visible && attention.mode === 'hints') {
    heading = 'Interaction hints'
    kind = 'Hint'
    rows = assignedRows(
      attention.candidates.flatMap(identity => {
        const node = nodesByIdentity.get(identity)
        const label = node?.label()
        return !node || !label ? [] : [{ bounds: node.live?.measure?.(), identity, label }]
      }),
      interactionAttention.keyAssignments('hints'),
    )
  } else if (visible && attention.mode === 'overview') {
    heading = 'Interaction overview'
    rows = assignedRows(
      nodes.filter(node => node.kind === 'region' && active(node, nodesByIdentity)).flatMap(node => {
        const label = node.label()
        return label === undefined
          ? []
          : [{ bounds: regionBounds(node.identity, nodes, nodesByIdentity), identity: node.identity, label }]
      }),
      interactionAttention.keyAssignments('overview'),
    )
  } else if (visible && attention.mode === 'narrowing') {
    heading = `Narrowing “${attention.narrowing}”`
    rows = attention.candidates.flatMap(identity => {
      const node = nodesByIdentity.get(identity)
      const label = node?.label()
      return !node || !label ? [] : [{ identity, label }]
    })
    if (rows.length === 0) {
      rows = [{ identity: '@tao/narrowing/no-match', label: 'No matching targets' }]
    }
  } else if (visible && attention.mode === 'verbs') {
    heading = `Actions for ${attention.targetLabel ?? 'target'}`
    rows = assignedRows(attention.verbs, interactionAttention.keyAssignments('verbs'))
  } else if (visible && attention.mode === 'palette') {
    heading = 'Command palette'
    rows = attention.palette.map(candidate => ({
      ...candidate,
      selected: candidate.identity === attention.target,
    }))
  } else if (visible && attention.mode === 'verb-pending' && attention.verbPending !== undefined) {
    heading = pendingHeading(attention.verbPending)
    if (attention.verbPending.request === 'targets') {
      rows = attention.candidates.flatMap(identity => {
        const node = nodesByIdentity.get(identity)
        const label = node?.label()
        return !node || !label
          ? []
          : [{ identity, label, selected: identity === attention.target }]
      })
    } else if (attention.verbPending.request === 'search') {
      rows = interactionAttention.pendingSearchResults().map(result => ({
        identity: result.identity,
        label: result.label,
        selected: result.identity === attention.target,
      }))
    }
  }

  const runtime = requireReactNativeRuntime()
  const hidden = !visible || heading === undefined
  const anchored = attention.mode === 'hints' || attention.mode === 'overview'
  const rowElements = rows.map(row => {
    const pending = attention.mode === 'verb-pending' ? attention.verbPending : undefined
    const searchResult = pending?.request === 'search'
      ? interactionAttention.pendingSearchResults().find(result => result.identity === row.identity)
      : undefined
    const onPress = pending === undefined
      ? undefined
      : searchResult === undefined
      ? () => interactionAttention.choosePendingTarget(row.identity)
      : () => interactionAttention.choosePendingSearchResult(searchResult.value)
    return (
      createElement(
        pending === undefined ? runtime.View : runtime.Pressable,
        {
          accessibilityLabel: rowText(attention.mode, row),
          accessibilityRole: pending === undefined ? 'text' : 'button',
          ...(row.enabled === false || row.selected === true
            ? accessibilityStateProps({
              ...(row.enabled === false ? { disabled: true } : {}),
              ...(row.selected === true ? { selected: true } : {}),
            })
            : {}),
          accessible: true,
          key: row.identity,
          ...(onPress === undefined ? {} : { onPress }),
          style: [
            rowStyle,
            mountedDesignStyle(props.taoProps, kind),
            row.bounds === undefined ? undefined : anchoredStyle(row.bounds),
          ],
          testID: `tao-interaction-row:${row.identity}`,
        },
        createElement(
          runtime.Text,
          { accessible: false },
          rowText(attention.mode, row),
        ),
      )
    )
  })
  const pendingControls = attention.mode !== 'verb-pending' || attention.verbPending === undefined
    ? []
    : pendingSurfaceControls(runtime, attention.verbPending)
  return createElement(
    runtime.View,
    {
      accessibilityElementsHidden: hidden,
      accessible: false,
      // The full-screen positioning host is never an accessibility stop. Its visible semantic
      // heading and rows remain traversable while the hidden state removes every descendant.
      importantForAccessibility: hidden ? 'no-hide-descendants' : 'no',
      // Ordinary generated rows are keyboard affordances; pending rows become pointer controls so
      // entity and scalar slots can be completed without leaving the interaction surface.
      style: attention.mode === 'verb-pending'
        ? [interactionLayerHostStyle, interactiveLayerHostStyle]
        : interactionLayerHostStyle,
      testID: 'tao-interaction-layers',
    },
    hidden
      ? null
      : createElement(
        React.Fragment,
        null,
        createElement(
          runtime.View,
          {
            accessible: false,
            // `box-none` on the host lets touches fall through to the app on native, but the web
            // runtime renders it as a plain `pointer-events: none` that descendants inherit. The
            // pending surface therefore re-enables pointer input on itself, so its search control
            // and chooser rows stay clickable while the rest of the overlay stays transparent.
            style: attention.mode === 'verb-pending'
              ? [surfaceStyle, mountedDesignStyle(props.taoProps, 'Overview'), interactiveSurfaceStyle]
              : [surfaceStyle, mountedDesignStyle(props.taoProps, 'Overview')],
          },
          createElement(runtime.Text, {
            accessibilityLabel: heading,
            accessibilityRole: 'header',
            style: headingStyle,
          }, heading),
          ...pendingControls,
          ...(anchored ? [] : rowElements),
        ),
        ...(anchored ? rowElements : []),
      ),
  )
}

function assignedRows(
  candidates: readonly InteractionSurfaceRow[],
  assignments: Readonly<Record<string, string>>,
): readonly InteractionSurfaceRow[] {
  return candidates.map(candidate => ({ ...candidate, key: candidate.key ?? assignments[candidate.identity] }))
}

function displayKey(key: string | undefined): string {
  return key?.toLocaleUpperCase() ?? '—'
}

function rowText(mode: string, row: InteractionSurfaceRow): string {
  return mode === 'narrowing' || mode === 'palette' || mode === 'verb-pending'
    ? row.label
    : `${displayKey(row.key)} — ${row.label}`
}

function pendingHeading(pending: NonNullable<ReturnType<typeof interactionAttention.read>['verbPending']>): string {
  return pending.request === 'input'
    ? `${pending.label}: enter ${pending.slot}`
    : `Choose ${pending.slot} for ${pending.label}`
}

function pendingSurfaceControls(
  runtime: ReturnType<typeof requireReactNativeRuntime>,
  pending: NonNullable<ReturnType<typeof interactionAttention.read>['verbPending']>,
): React.ReactElement[] {
  if (pending.request === 'input') {
    return [createElement(PendingScalarInput, { key: 'pending-input', pending, runtime })]
  }
  if (pending.request === 'targets') {
    return [createElement(
      runtime.Pressable,
      {
        accessibilityLabel: `Search stores for ${pending.type}`,
        accessibilityRole: 'button',
        key: 'pending-search',
        onPress: () => interactionAttention.searchPendingStore(),
        style: pendingControlStyle,
        testID: 'tao-interaction-pending-search',
      },
      createElement(runtime.Text, { accessible: false }, `Search all ${pending.type}`),
    )]
  }
  return []
}

function PendingScalarInput({ pending, runtime }: {
  pending: NonNullable<ReturnType<typeof interactionAttention.read>['verbPending']>
  runtime: ReturnType<typeof requireReactNativeRuntime>
}): React.JSX.Element {
  const [value, setValue] = React.useState('')
  React.useEffect(() => setValue(''), [pending.identity, pending.slot])
  const submit = () => {
    const scalar = pendingScalarValue(pending.type, value)
    if (scalar !== undefined) {
      interactionAttention.providePendingValue(runtimeInteractionValue(scalar))
    }
  }
  return createElement(runtime.TextInput, {
    accessibilityLabel: `${pending.slot} for ${pending.label}`,
    autoFocus: true,
    onChangeText: setValue,
    onSubmitEditing: submit,
    placeholder: pending.type === 'duration' ? 'Seconds' : pending.slot,
    style: pendingInputStyle,
    testID: 'tao-interaction-pending-input',
    value,
  })
}

function pendingScalarValue(type: string, value: string): string | number | undefined {
  if (type !== 'duration') {
    return value
  }
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e9 : undefined
}

function active(node: TaoOutlineLiveNode, nodesByIdentity: OutlineIndex): boolean {
  let current: TaoOutlineLiveNode | undefined = node
  while (current) {
    if (current.live?.active?.() === false) {
      return false
    }
    current = current.parent === undefined ? undefined : nodesByIdentity.get(current.parent)
  }
  return true
}

function regionBounds(
  identity: string,
  nodes: readonly TaoOutlineLiveNode[],
  nodesByIdentity: OutlineIndex,
): TaoInteractionBounds | undefined {
  const measured = nodes
    .filter(node => node.identity === identity || descendantOf(node, identity, nodesByIdentity))
    .flatMap(node => {
      const bounds = node.live?.measure?.()
      return bounds === undefined ? [] : [bounds]
    })
  if (measured.length === 0) {
    return undefined
  }
  const left = Math.min(...measured.map(bounds => bounds.x))
  const top = Math.min(...measured.map(bounds => bounds.y))
  const right = Math.max(...measured.map(bounds => bounds.x + bounds.width))
  const bottom = Math.max(...measured.map(bounds => bounds.y + bounds.height))
  return { height: bottom - top, width: right - left, x: left, y: top }
}

function descendantOf(node: TaoOutlineLiveNode, ancestor: string, nodesByIdentity: OutlineIndex): boolean {
  let parent = node.parent
  while (parent) {
    if (parent === ancestor) {
      return true
    }
    parent = nodesByIdentity.get(parent)?.parent
  }
  return false
}

function anchoredStyle(bounds: TaoInteractionBounds): Record<string, number | string> {
  return {
    left: bounds.x,
    minHeight: bounds.height,
    minWidth: bounds.width,
    position: 'absolute',
    top: bounds.y,
  }
}

const interactionLayerHostStyle = {
  bottom: 0,
  left: 0,
  pointerEvents: 'none',
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 4,
} as const
const interactiveLayerHostStyle = { pointerEvents: 'box-none' } as const
const interactiveSurfaceStyle = { pointerEvents: 'auto' } as const

const surfaceStyle = {
  alignSelf: 'center',
  backgroundColor: '#ffffff',
  borderColor: '#1f2937',
  borderRadius: 12,
  borderWidth: 1,
  gap: 8,
  margin: 16,
  maxWidth: 560,
  padding: 12,
} as const

const headingStyle = { fontSize: 16, fontWeight: '600' } as const
const pendingControlStyle = { padding: 6 } as const
const pendingInputStyle = { borderWidth: 1, minWidth: 240, padding: 8 } as const
const rowStyle = { backgroundColor: '#ffffff', borderRadius: 6, flexDirection: 'row', padding: 6 } as const
