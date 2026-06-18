import React from 'react'
import { LayoutControls, type TaoLayout, type TaoLayoutDirection, type TaoResolvedLayoutStyle } from './TR-layout'

/** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
export type TaoProps = {
  callerProps?: TaoProps
  layout?: TaoLayout
  parentDirection?: TaoLayoutDirection
  style?: TaoResolvedLayoutStyle
}

type ResolvedTaoProps = Omit<TaoProps, 'callerProps'>

/** TaoViewProps declares React props generated Tao views receive. */
export type TaoViewProps = {
  __tao?: TaoProps
  children?: React.ReactNode
}

/** TaoViewRuntimeProps declares runtime props passed alongside generated Tao view props. */
export type TaoViewRuntimeProps = TaoProps & {
  direction?: TaoLayoutDirection
  nativeProps?: Record<string, unknown>
}

type MergedTaoViewProps = {
  readonly children?: React.ReactNode
  readonly direction?: TaoLayoutDirection
  readonly nativeProps: Record<string, unknown>
  readonly props: ResolvedTaoProps | undefined
}

/** TaoPropsControls exposes runtime Tao props merging for generated views. */
export const TaoPropsControls = {
  mergeViewProps,
  nativePropsWithStyle,
} as const

function mergeViewProps(props: TaoViewProps, runtimeProps: TaoViewRuntimeProps): MergedTaoViewProps {
  const { direction, nativeProps = {}, ...taoRuntimeProps } = runtimeProps
  return {
    children: withParentDirection(props.children, direction),
    direction,
    nativeProps,
    props: resolveTaoProps(taoRuntimeProps, props.__tao),
  }
}

function nativePropsWithStyle(merged: MergedTaoViewProps): Record<string, unknown> {
  const { style, ...nativeProps } = merged.nativeProps
  return {
    ...nativeProps,
    style: appendNativeStyle(resolveTaoStyle(merged.props, merged.direction), style),
  }
}

function resolveTaoStyle(
  taoProps: ResolvedTaoProps | undefined,
  direction: TaoLayoutDirection | undefined,
): TaoResolvedLayoutStyle | readonly TaoResolvedLayoutStyle[] {
  const resolvedLayout = LayoutControls.resolve({
    direction,
    parentDirection: taoProps?.parentDirection,
    entries: taoProps?.layout ?? [],
  })
  return taoProps?.style ? [resolvedLayout, taoProps.style] : resolvedLayout
}

function appendNativeStyle(
  taoStyle: TaoResolvedLayoutStyle | readonly TaoResolvedLayoutStyle[],
  nativeStyle: unknown,
): unknown {
  return nativeStyle === undefined ? taoStyle : [taoStyle, nativeStyle]
}

function withParentDirection(
  children: React.ReactNode,
  parentDirection: TaoLayoutDirection | undefined,
): React.ReactNode {
  if (!parentDirection) {
    return children
  }
  return React.Children.map(children, child => withChildParentDirection(child, parentDirection))
}

function withChildParentDirection(
  child: React.ReactNode,
  parentDirection: TaoLayoutDirection,
): React.ReactNode {
  if (!React.isValidElement(child)) {
    return child
  }
  const childProps = child.props as { __tao?: TaoProps; children?: React.ReactNode }
  if (child.type === React.Fragment) {
    return React.cloneElement(
      child,
      undefined,
      withParentDirection(childProps.children, parentDirection),
    )
  }
  return React.cloneElement(child as React.ReactElement<{ __tao?: TaoProps }>, {
    __tao: { ...childProps.__tao, callerProps: { parentDirection } },
  })
}

function resolveTaoProps(
  ...propsList: Array<TaoProps | undefined>
): ResolvedTaoProps | undefined {
  let layout: TaoLayout | undefined
  let parentDirection: TaoLayoutDirection | undefined
  let style: TaoResolvedLayoutStyle | undefined

  for (const props of propsList) {
    applyTaoPropsChain(props)
  }

  if (!layout && !parentDirection && !style) {
    return undefined
  }
  return { layout, parentDirection, style }

  function applyTaoPropsChain(props: TaoProps | undefined): void {
    if (!props) {
      return
    }
    layout = props.layout ?? layout
    parentDirection = props.parentDirection ?? parentDirection
    style = mergeTaoStyle(style, props.style)
    applyTaoPropsChain(props.callerProps)
  }
}

function mergeTaoStyle(
  localStyle: ResolvedTaoProps['style'] | undefined,
  callerStyle: ResolvedTaoProps['style'] | undefined,
): ResolvedTaoProps['style'] | undefined {
  const merged: NonNullable<ResolvedTaoProps['style']> = {}
  for (const style of [localStyle, callerStyle]) {
    if (style) {
      Object.assign(merged, style)
    }
  }
  return Object.keys(merged).length === 0 ? undefined : merged
}
