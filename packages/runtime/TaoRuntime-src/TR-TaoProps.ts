import type React from 'react'
import { LayoutRuntime, type TaoLayoutDirection, type TaoLayoutProps, type TaoResolvedLayoutProps } from './TR-layout'
import { ParentDirectionContext } from './TR-parent-direction'

/** TaoEventHandler declares a runtime Tao action bound to an interaction. */
export type TaoEventHandler = { invoke(...args: unknown[]): void }

/** TaoEvents declares the interaction handlers a render site binds with `on` clauses. */
export type TaoEvents = {
  press?: TaoEventHandler
  change?: TaoEventHandler
  submit?: TaoEventHandler
}

/** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
export type TaoProps = TaoLayoutProps & { events?: TaoEvents }

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
  readonly props: TaoResolvedLayoutProps | undefined
}

/** TaoPropsControls exposes runtime Tao props merging for generated views. */
export const TaoPropsControls = {
  eventsOf,
  mergeViewProps,
  nativePropsWithStyle,
} as const

// A view invoked through another view forwards its caller's handlers, so the nearest binding wins.
function eventsOf(props: TaoProps | undefined): TaoEvents {
  if (!props) {
    return {}
  }
  return { ...eventsOf(props.callerProps as TaoProps | undefined), ...props.events }
}

function mergeViewProps(
  props: TaoViewProps,
  runtimeProps: TaoViewRuntimeProps,
  parentDirection?: TaoLayoutDirection,
): MergedTaoViewProps {
  const { direction, nativeProps = {}, ...taoRuntimeProps } = runtimeProps
  return {
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
  return LayoutRuntime.nativePropsWithStyle(merged.nativeProps, merged.props, merged.direction)
}
