import { LayoutMerge } from './layout-engine/LayoutMerge'
import { LayoutResolve } from './layout-engine/LayoutResolve'
import type {
  TaoLayout,
  TaoLayoutDirection,
  TaoLayoutEntry,
  TaoLayoutMergeSpec,
  TaoResolvedLayoutStyle,
} from './layout-engine/LayoutTypes'

export type {
  TaoLayout,
  TaoLayoutDirection,
  TaoLayoutEntry,
  TaoLayoutMergeSpec,
  TaoLayoutSpec,
  TaoLayoutStyleValue,
  TaoLayoutTermValue,
  TaoResolvedLayoutStyle,
} from './layout-engine/LayoutTypes'

/** TaoLayoutProps declares Tao-owned props consumed by runtime layout lowering. */
export type TaoLayoutProps = {
  callerProps?: TaoLayoutProps
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
  nativePropsWithStyle,
  resolveProps,
} as const

function create(entries: readonly TaoLayoutEntry[]): TaoLayout {
  return { entries }
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

  for (const props of [runtimeProps, viewProps, parentDirectionProps]) {
    applyTaoPropsChain(props)
  }

  if (!layout && !parentDirection && !style) {
    return undefined
  }
  return { layout, parentDirection, style }

  function applyTaoPropsChain(props: TaoLayoutProps | undefined): void {
    if (!props) {
      return
    }
    layout = merge(layout, props.layout, { direction })
    parentDirection = props.parentDirection ?? parentDirection
    style = mergeStyle(style, props.style)
    applyTaoPropsChain(props.callerProps)
  }
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
  localStyle: TaoResolvedLayoutProps['style'] | undefined,
  callerStyle: TaoResolvedLayoutProps['style'] | undefined,
): TaoResolvedLayoutProps['style'] | undefined {
  const merged: NonNullable<TaoResolvedLayoutProps['style']> = {}
  for (const style of [localStyle, callerStyle]) {
    if (style) {
      Object.assign(merged, style)
    }
  }
  return Object.keys(merged).length === 0 ? undefined : merged
}
