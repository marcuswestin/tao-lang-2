import React from 'react'
import { OutlineScope, type TaoOutlineProvenance, useOutlineNode } from './TR-interaction-outline'

/**
 * A region is a structural place attention can rest: a selection item, a split pane, a presented
 * occurrence, or the non-nav sibling subtree of a view that renders a nav. Navigation supplies the
 * first three kinds; the compiler describes the sibling subtree, whose mounted roots coalesce under
 * one owner occurrence without adding a wrapper or layout node.
 */
type TaoOutlineRegionKind = 'occurrence' | 'selection-item' | 'split-pane'

/** TaoOutlinePresentation is how a presented occurrence reached the screen. */
export type TaoOutlinePresentation = 'ask' | 'content' | 'overlay' | 'sheet'

export type TaoOutlineRegion = Readonly<{
  active?(): boolean
  identity: string
  kind: TaoOutlineRegionKind
  label(): string | undefined
  modal?: boolean
  primary?: boolean
  provenance: TaoOutlineProvenance
}>

/** useOutlineRegion registers one mounted region and returns the identity its content hangs under. */
function useOutlineRegion(region: TaoOutlineRegion | undefined): string | undefined {
  return useOutlineNode(
    region
      ? {
        identity: region.identity,
        kind: 'region',
        label: region.label,
        live: {
          active: region.active ?? (() => true),
          ...(region.modal === undefined ? {} : { modal: region.modal }),
          ...(region.primary === undefined ? {} : { primary: region.primary }),
        },
        provenance: region.provenance,
      }
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
  options: { active?: () => boolean; primary?: boolean } = {},
): TaoOutlineRegion {
  return {
    ...(options.active === undefined ? {} : { active: options.active }),
    identity: `occurrence:${navigation}#${instanceId}`,
    kind: 'occurrence',
    label,
    modal: presentation === 'ask' || presentation === 'sheet',
    ...(options.primary === undefined ? {} : { primary: options.primary }),
    provenance: { instanceId, navigation, presentation },
  }
}

/** selectionItemRegion describes one keyed item of a selection navigator, named by its `Label`. */
export function selectionItemRegion(
  navigation: string,
  key: string,
  label: () => string | undefined,
  active?: () => boolean,
): TaoOutlineRegion {
  return {
    ...(active === undefined ? {} : { active }),
    identity: `selection:${navigation}@${key}`,
    kind: 'selection-item',
    label,
    provenance: { key, navigation },
  }
}

/** splitPaneRegion describes one keyed pane of a split navigator; the key is all that names it. */
export function splitPaneRegion(navigation: string, key: string, active?: () => boolean): TaoOutlineRegion {
  return {
    ...(active === undefined ? {} : { active }),
    identity: `split:${navigation}@${key}`,
    kind: 'split-pane',
    label: () => key,
    provenance: { key, navigation },
  }
}
