import { LayoutMerge } from './layout-engine/LayoutMerge'
import { LayoutResolve } from './layout-engine/LayoutResolve'
import type {
  TaoLayout,
  TaoLayoutDirection,
  TaoLayoutEntry,
  TaoLayoutMergeSpec,
  TaoResolvedLayoutStyle,
} from './layout-engine/LayoutTypes'
import { RuntimeAssert } from './TR-assert'

export type {
  TaoLayout,
  TaoLayoutDirection,
  TaoLayoutEntry,
  TaoResolvedLayoutStyle,
} from './layout-engine/LayoutTypes'

/** TaoLayoutProps declares Tao-owned props consumed by runtime layout lowering. */
export type TaoLayoutProps = {
  callerProps?: TaoLayoutProps
  /**
   * elementDefaultLayout and elementDefaultStyle hold the resolved stdlib element default of one
   * link. It is the weakest authored layer — a caller's clause overrules the default of the element
   * it reaches — so it is kept apart from the link's own clauses rather than merged into them.
   */
  elementDefaultLayout?: TaoLayout
  elementDefaultStyle?: TaoResolvedLayoutStyle
  layout?: TaoLayout
  parentDirection?: TaoLayoutDirection
  style?: TaoResolvedLayoutStyle
}

export type TaoResolvedLayoutProps = Omit<TaoLayoutProps, 'callerProps'>

/** LayoutControls exposes the generated-code layout runtime surface. */
export const LayoutControls = {
  create,
  merge,
  resolve: LayoutResolve.resolve,
} as const

/** LayoutRuntime exposes internal layout helpers for runtime primitive views. */
export const LayoutRuntime = {
  assertCompatibleEntries: assertEffectiveLayoutCompatibility,
  nativePropsWithStyle,
  resolveProps,
} as const

function create(entries: readonly TaoLayoutEntry[]): TaoLayout {
  return { entries: LayoutMerge.entries(entries) }
}

function merge(
  base: TaoLayout | undefined,
  overlay: TaoLayout | undefined,
  spec: TaoLayoutMergeSpec = {},
): TaoLayout | undefined {
  return LayoutMerge.merge(create, base, overlay, spec)
}

function resolveProps(
  direction: TaoLayoutDirection | undefined,
  runtimeProps: TaoLayoutProps | undefined,
  viewProps: TaoLayoutProps | undefined,
  parentDirectionProps: TaoLayoutProps | undefined,
): TaoResolvedLayoutProps | undefined {
  let layout: TaoLayout | undefined
  let parentDirection: TaoLayoutDirection | undefined
  let style: TaoResolvedLayoutStyle | undefined

  // Each group settles completely before the next one starts, so the foreign implementation's own
  // runtime props stay beneath everything a Tao author wrote.
  for (const props of [runtimeProps, viewProps, parentDirectionProps]) {
    applyElementDefaults(props)
    applyAuthoredClauses(props)
  }

  // Every layer has now met every other one, so this is the first list that is the whole occurrence:
  // the one place a `claim`/`rigid` conflict between an element default and a clause is visible, and
  // the point a cleared visual slot stops being a marker and simply is not there.
  assertEffectiveLayoutCompatibility(layout?.entries ?? [])
  const settled = settledStyle(style)
  if (!layout && !parentDirection && !settled) {
    return undefined
  }
  return { layout, parentDirection, style: settled }

  /** The weakest authored layer: every element default in the chain, under every written clause. */
  function applyElementDefaults(props: TaoLayoutProps | undefined): void {
    if (!props) {
      return
    }
    // parentDirection resolves from the nearest link outward, one defined value overwriting the
    // last, so the outermost definition wins: an enclosing container knows the axis its child is
    // laid out on. It stays on this walk to keep that order exactly as it was.
    parentDirection = props.parentDirection ?? parentDirection
    layout = merge(layout, props.elementDefaultLayout, { direction })
    style = mergeStyle(style, props.elementDefaultStyle)
    applyElementDefaults(props.callerProps)
  }

  /**
   * Written clauses apply from the outermost caller inward, so the occurrence's own clauses land
   * last and win. They are private: a caller may set a slot the occurrence leaves open, but never
   * one it sets itself, so a caller's `bg none` cannot clear the root's own `bg red`.
   */
  function applyAuthoredClauses(props: TaoLayoutProps | undefined): void {
    if (!props) {
      return
    }
    applyAuthoredClauses(props.callerProps)
    layout = merge(layout, props.layout, { direction })
    style = mergeStyle(style, props.style)
  }
}

/** Drops the keys `none` cleared, so the style an element renders with holds only what it sets. */
function settledStyle(style: TaoResolvedLayoutStyle | undefined): TaoResolvedLayoutStyle | undefined {
  if (!style) {
    return undefined
  }
  const settled: TaoResolvedLayoutStyle = {}
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) {
      settled[key] = value
    }
  }
  return Object.keys(settled).length === 0 ? undefined : settled
}

/**
 * A growth clause and a shrink clause that contradict each other are the Tao author's mistake, and
 * the layers they came from do not matter: an element default's `claim` conflicts with an authored
 * `rigid` exactly as two authored clauses would.
 */
function assertEffectiveLayoutCompatibility(entries: readonly TaoLayoutEntry[]): void {
  const growth = entries.findLast(entry => ['fill', 'claim', 'hug'].includes(entry[0]))
  const shrink = entries.findLast(entry => ['compress', 'rigid'].includes(entry[0]))
  RuntimeAssert.input(
    growth?.[0] !== 'claim' || shrink?.[0] !== 'rigid',
    "Design entries 'claim' and 'rigid' cannot remain effective together.",
  )
}

function nativePropsWithStyle(
  nativeProps: Record<string, unknown>,
  props: TaoResolvedLayoutProps | undefined,
  direction: TaoLayoutDirection | undefined,
): Record<string, unknown> {
  const { style, ...restNativeProps } = nativeProps
  return {
    ...restNativeProps,
    style: appendNativeStyle(resolveStyle(props, direction), style),
  }
}

function resolveStyle(
  props: TaoResolvedLayoutProps | undefined,
  direction: TaoLayoutDirection | undefined,
): TaoResolvedLayoutStyle | readonly TaoResolvedLayoutStyle[] {
  const resolvedLayout = LayoutResolve.resolve({
    direction,
    parentDirection: props?.parentDirection,
    entries: props?.layout?.entries ?? [],
  })
  return props?.style ? [resolvedLayout, props.style] : resolvedLayout
}

function appendNativeStyle(
  taoStyle: TaoResolvedLayoutStyle | readonly TaoResolvedLayoutStyle[],
  nativeStyle: unknown,
): unknown {
  return nativeStyle === undefined ? taoStyle : [taoStyle, nativeStyle]
}

function mergeStyle(
  baseStyle: TaoResolvedLayoutProps['style'] | undefined,
  overlayStyle: TaoResolvedLayoutProps['style'] | undefined,
): TaoResolvedLayoutProps['style'] | undefined {
  const merged: NonNullable<TaoResolvedLayoutProps['style']> = {}
  for (const style of [baseStyle, overlayStyle]) {
    if (style) {
      Object.assign(merged, style)
    }
  }
  return Object.keys(merged).length === 0 ? undefined : merged
}
