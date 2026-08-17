import type React from 'react'
import { AccessibilityRuntime, type TaoAccessibilityProps } from './TR-accessibility'
import { LayoutRuntime, type TaoLayoutDirection, type TaoLayoutProps, type TaoResolvedLayoutProps } from './TR-layout'
import { ParentDirectionContext } from './TR-parent-direction'

/** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
export type TaoProps = Omit<TaoLayoutProps, 'callerProps'> & TaoAccessibilityViewProps & {
  callerProps?: TaoProps
}

/** TaoAccessibilityViewProps declares Tao-owned native accessibility metadata. */
export type TaoAccessibilityViewProps = {
  accessibility?: TaoAccessibilityProps
}

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
  readonly accessibility?: TaoAccessibilityProps
  readonly children?: React.ReactNode
  readonly direction?: TaoLayoutDirection
  readonly nativeProps: Record<string, unknown>
  readonly props: TaoResolvedLayoutProps | undefined
}

/** TaoPropsControls exposes runtime Tao props merging for generated views. */
export const TaoPropsControls = {
  mergeViewProps,
  nativePropsWithStyle,
} as const

function mergeViewProps(
  props: TaoViewProps,
  runtimeProps: TaoViewRuntimeProps,
  parentDirection?: TaoLayoutDirection,
): MergedTaoViewProps {
  const { direction, nativeProps = {}, ...taoRuntimeProps } = runtimeProps
  return {
    accessibility: resolveAccessibilityProps(
      runtimeProps,
      props.__tao,
      ParentDirectionContext.propsForDirection(parentDirection) as TaoProps | undefined,
    ),
    children: props.children,
    direction,
    nativeProps,
    props: LayoutRuntime.resolveProps(
      direction,
      taoRuntimeProps,
      props.__tao,
      ParentDirectionContext.propsForDirection(parentDirection),
    ),
  }
}

function nativePropsWithStyle(merged: MergedTaoViewProps): Record<string, unknown> {
  return LayoutRuntime.nativePropsWithStyle(
    { ...merged.nativeProps, ...AccessibilityRuntime.nativeProps(merged.accessibility) },
    merged.props,
    merged.direction,
  )
}

function resolveAccessibilityProps(
  runtimeProps: TaoAccessibilityViewProps | undefined,
  viewProps: TaoAccessibilityViewProps | undefined,
  parentDirectionProps: TaoAccessibilityViewProps | undefined,
): TaoAccessibilityProps | undefined {
  const entries = [runtimeProps, viewProps, parentDirectionProps]
    .flatMap(props => accessibilityEntriesInChain(props))
  return entries.length === 0 ? undefined : { entries }
}

function accessibilityEntriesInChain(props: TaoAccessibilityViewProps | undefined): TaoAccessibilityProps['entries'] {
  if (!props) {
    return []
  }
  return [
    ...(props.accessibility?.entries ?? []),
    ...accessibilityEntriesInChain((props as TaoProps).callerProps),
  ]
}
