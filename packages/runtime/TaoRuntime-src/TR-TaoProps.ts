import type React from 'react'
import { LayoutRuntime, type TaoLayoutDirection, type TaoLayoutProps, type TaoResolvedLayoutProps } from './TR-layout'
import type { TaoNavigationValue } from './TR-navigation'
import { ParentDirectionContext } from './TR-parent-direction'

/** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
export type TaoProps = TaoLayoutProps & {
  /** callerProps preserves inherited Tao metadata across generated view boundaries. */
  callerProps?: TaoProps
  /** navigation is private Tao metadata for nearest-container presentation and dismissal. */
  navigation?: TaoNavigationValue
  /** testTag is private Tao metadata lowered to the existing concrete native root. */
  testTag?: string
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
  readonly children?: React.ReactNode
  readonly direction?: TaoLayoutDirection
  readonly nativeProps: Record<string, unknown>
  readonly props: TaoResolvedLayoutProps | undefined
  readonly testTag: string | undefined
}

/** TaoPropsControls exposes runtime Tao props merging for generated views. */
export const TaoPropsControls = {
  mergeViewProps,
  nativePropsWithStyle,
  navigationInChain,
} as const

/** Finds the nearest enclosing navigation metadata through generated view caller props. */
function navigationInChain(props: TaoProps | undefined): TaoNavigationValue | undefined {
  if (!props) {
    return undefined
  }
  return props.navigation ?? navigationInChain(props.callerProps)
}

function mergeViewProps(
  props: TaoViewProps,
  runtimeProps: TaoViewRuntimeProps,
  parentDirection?: TaoLayoutDirection,
): MergedTaoViewProps {
  const { direction, nativeProps = {}, testTag, ...taoRuntimeProps } = runtimeProps
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
    testTag: testTag ?? testTagInChain(taoRuntimeProps) ?? testTagInChain(props.__tao),
  }
}

function nativePropsWithStyle(merged: MergedTaoViewProps): Record<string, unknown> {
  const nativeProps = LayoutRuntime.nativePropsWithStyle(merged.nativeProps, merged.props, merged.direction)
  return merged.testTag ? { ...nativeProps, testID: merged.testTag } : nativeProps
}

function testTagInChain(props: TaoProps | undefined): string | undefined {
  if (!props) {
    return undefined
  }
  return props.testTag ?? testTagInChain(props.callerProps)
}
