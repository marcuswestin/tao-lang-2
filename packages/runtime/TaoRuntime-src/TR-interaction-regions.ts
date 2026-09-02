import React from 'react'
import { OutlineScope, type TaoOutlineProvenance, useOutlineNode } from './TR-interaction-outline'

/**
 * A region is a structural place attention can rest: a selection item, a split pane, or a
 * presented occurrence. Nothing declares one; the navigation runtime knows where each is because it
 * mounted it, and hands the outline the identity and the name a person would read.
 *
 * Deliberately not a region yet: the non-nav content of a view that renders a nav, such as the
 * focus bar beside WordFlower's navigator. The runtime has no handle for it — the hosted nav is
 * wrapped in one view, but its siblings are ordinary occurrences with no grouping node — so naming
 * it needs either a compile-time descriptor of "the siblings of a rendered nav" or a new wrapper.
 * The attention tranche decides what it needs to address; this one does not invent it.
 */
export type TaoOutlineRegionKind = 'occurrence' | 'selection-item' | 'split-pane'

/** TaoOutlinePresentation is how a presented occurrence reached the screen. */
export type TaoOutlinePresentation = 'ask' | 'content' | 'overlay' | 'sheet'

export type TaoOutlineRegion = Readonly<{
  identity: string
  kind: TaoOutlineRegionKind
  label(): string | undefined
  provenance: TaoOutlineProvenance
}>

/** useOutlineRegion registers one mounted region and returns the identity its content hangs under. */
export function useOutlineRegion(region: TaoOutlineRegion | undefined): string | undefined {
  return useOutlineNode(
    region
      ? { identity: region.identity, kind: 'region', label: region.label, provenance: region.provenance }
      : undefined,
  )
}

/**
 * OutlineRegionScope registers a region and makes it the parent of everything rendered inside it,
 * without adding a native element: the host that mounts the region owns the native root and puts
 * the group role on it.
 */
export function OutlineRegionScope(props: {
  children?: React.ReactNode
  region: TaoOutlineRegion | undefined
}): React.ReactNode {
  const identity = useOutlineRegion(props.region)
  return React.createElement(OutlineScope, { identity }, props.children)
}

/** regionNativeProps is the accessibility a region's native root carries: a named group. */
export function regionNativeProps(region: TaoOutlineRegion | undefined): Record<string, unknown> {
  if (!region) {
    return {}
  }
  const label = region.label()
  return { ...(label === undefined ? {} : { accessibilityLabel: label }), role: 'group' }
}

/** occurrenceRegion describes one presented occurrence: a scene or view a navigator put on screen. */
export function occurrenceRegion(
  navigation: string,
  instanceId: number,
  presentation: TaoOutlinePresentation,
  label: () => string | undefined,
): TaoOutlineRegion {
  return {
    identity: `occurrence:${navigation}#${instanceId}`,
    kind: 'occurrence',
    label,
    provenance: { instanceId, navigation, presentation },
  }
}

/** selectionItemRegion describes one keyed item of a selection navigator, named by its `Label`. */
export function selectionItemRegion(
  navigation: string,
  key: string,
  label: () => string | undefined,
): TaoOutlineRegion {
  return {
    identity: `selection:${navigation}@${key}`,
    kind: 'selection-item',
    label,
    provenance: { key, navigation },
  }
}

/** splitPaneRegion describes one keyed pane of a split navigator; the key is all that names it. */
export function splitPaneRegion(navigation: string, key: string): TaoOutlineRegion {
  return {
    identity: `split:${navigation}@${key}`,
    kind: 'split-pane',
    label: () => key,
    provenance: { key, navigation },
  }
}
