import React from 'react'
import { allocateInteractionKeys, type TaoInteractionKeyAssignments } from './TR-interaction-allocation'
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

type InteractionSurfaceRow = Readonly<{
  bounds?: TaoInteractionBounds
  enabled?: boolean
  identity: string
  key?: string
  label: string
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
  const explicitKeys = commandCatalog.explicitKeys()
  const previous = React.useRef<Record<string, TaoInteractionKeyAssignments>>({})
  const visible = interactionKeyboardPresence.read()
    && (attention.mode === 'hints'
      || attention.mode === 'overview'
      || attention.mode === 'verbs'
      || attention.mode === 'palette')
  let heading: string | undefined
  let kind: 'Hint' | 'Overview' = 'Overview'
  let rows: readonly InteractionSurfaceRow[] = []

  if (visible && attention.mode === 'hints') {
    heading = 'Interaction hints'
    kind = 'Hint'
    rows = allocatedRows(
      attention.candidates.flatMap(identity => {
        const node = nodes.find(candidate => candidate.identity === identity)
        const label = node?.label()
        return !node || !label ? [] : [{ bounds: node.live?.measure?.(), identity, label }]
      }),
      explicitKeys,
      previous.current,
      'hints',
    )
  } else if (visible && attention.mode === 'overview') {
    heading = 'Interaction overview'
    rows = allocatedRows(
      nodes.filter(node => node.kind === 'region' && active(node, nodes)).flatMap(node => {
        const label = node.label()
        return label === undefined
          ? []
          : [{ bounds: regionBounds(node.identity, nodes), identity: node.identity, label }]
      }),
      explicitKeys,
      previous.current,
      'overview',
    )
  } else if (visible && attention.mode === 'verbs') {
    heading = `Actions for ${attention.targetLabel ?? 'target'}`
    rows = keyedRows(attention.verbs, explicitKeys, previous.current, 'verbs')
  } else if (visible && attention.mode === 'palette') {
    heading = 'Command palette'
    rows = keyedRows(attention.palette, explicitKeys, previous.current, 'palette')
  }

  const runtime = requireReactNativeRuntime()
  const hidden = !visible || heading === undefined
  const anchored = attention.mode === 'hints' || attention.mode === 'overview'
  const rowElements = rows.map(row =>
    React.createElement(
      runtime.View,
      {
        accessibilityLabel: `${displayKey(row.key)} — ${row.label}`,
        accessibilityRole: 'text',
        accessibilityState: row.enabled === false ? { disabled: true } : undefined,
        accessible: true,
        key: row.identity,
        style: [
          rowStyle,
          mountedDesignStyle(props.taoProps, kind),
          row.bounds === undefined ? undefined : anchoredStyle(row.bounds),
        ],
        testID: `tao-interaction-row:${row.identity}`,
      },
      attention.mode === 'palette'
        ? React.createElement(
          React.Fragment,
          null,
          React.createElement(runtime.Text, { accessible: false }, `${displayKey(row.key)} — `),
          React.createElement(runtime.Text, { accessible: false }, row.label),
        )
        : React.createElement(
          runtime.Text,
          { accessible: false },
          `${displayKey(row.key)} — ${row.label}`,
        ),
    )
  )
  return React.createElement(
    runtime.View,
    {
      accessibilityElementsHidden: hidden,
      accessible: false,
      // The full-screen positioning host is never an accessibility stop. Its visible semantic
      // heading and rows remain traversable while the hidden state removes every descendant.
      importantForAccessibility: hidden ? 'no-hide-descendants' : 'no',
      // Generated rows are keyboard affordances, not pointer controls. Let taps continue through
      // both the full-screen host and its visible descendants to the semantic control underneath.
      pointerEvents: 'none',
      style: interactionLayerHostStyle,
      testID: 'tao-interaction-layers',
    },
    hidden
      ? null
      : React.createElement(
        React.Fragment,
        null,
        React.createElement(
          runtime.View,
          {
            accessible: false,
            style: [surfaceStyle, mountedDesignStyle(props.taoProps, 'Overview')],
          },
          React.createElement(runtime.Text, {
            accessibilityLabel: heading,
            accessibilityRole: 'header',
            style: headingStyle,
          }, heading),
          ...(anchored ? [] : rowElements),
        ),
        ...(anchored ? rowElements : []),
      ),
  )
}

function allocatedRows(
  candidates: readonly Omit<InteractionSurfaceRow, 'key'>[],
  explicitKeys: readonly string[],
  previous: Record<string, TaoInteractionKeyAssignments>,
  surface: string,
): readonly InteractionSurfaceRow[] {
  const assignments = allocateInteractionKeys(candidates, { explicitKeys, previous: previous[surface] })
  previous[surface] = assignments
  return candidates.map(candidate => ({ ...candidate, key: assignments[candidate.identity] }))
}

function keyedRows(
  candidates: readonly Readonly<{ enabled: boolean; identity: string; key?: string; label: string }>[],
  explicitKeys: readonly string[],
  previous: Record<string, TaoInteractionKeyAssignments>,
  surface: string,
): readonly InteractionSurfaceRow[] {
  const generated = candidates.filter(candidate => candidate.key === undefined)
  const assignments = allocateInteractionKeys(generated, { explicitKeys, previous: previous[surface] })
  previous[surface] = assignments
  return candidates.map(candidate => ({ ...candidate, key: candidate.key ?? assignments[candidate.identity] }))
}

function displayKey(key: string | undefined): string {
  return key?.toLocaleUpperCase() ?? '—'
}

function active(node: TaoOutlineLiveNode, nodes: readonly TaoOutlineLiveNode[]): boolean {
  let current: TaoOutlineLiveNode | undefined = node
  while (current) {
    if (current.live?.active?.() === false) {
      return false
    }
    current = nodes.find(candidate => candidate.identity === current?.parent)
  }
  return true
}

function regionBounds(identity: string, nodes: readonly TaoOutlineLiveNode[]): TaoInteractionBounds | undefined {
  const measured = nodes
    .filter(node => node.identity === identity || descendantOf(node, identity, nodes))
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

function descendantOf(node: TaoOutlineLiveNode, ancestor: string, nodes: readonly TaoOutlineLiveNode[]): boolean {
  let parent = node.parent
  while (parent) {
    if (parent === ancestor) {
      return true
    }
    parent = nodes.find(candidate => candidate.identity === parent)?.parent
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
  pointerEvents: 'box-none',
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 4,
} as const

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
const rowStyle = { backgroundColor: '#ffffff', borderRadius: 6, flexDirection: 'row', padding: 6 } as const
