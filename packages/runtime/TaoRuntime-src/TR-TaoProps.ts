import type React from 'react'
import { DesignControls, type TaoDesign, type TaoDesignSpec } from './TR-design'
import {
  LayoutControls,
  LayoutRuntime,
  type TaoLayoutDirection,
  type TaoLayoutProps,
  type TaoResolvedLayoutProps,
} from './TR-layout'
import type { TaoNavigationValue } from './TR-navigation'
import type { TaoRuntimeApp } from './TR-navigation'
import { ParentDirectionContext } from './TR-parent-direction'

/** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
export type TaoProps = TaoLayoutProps & {
  /** app is private Tao metadata for app-owned transient presentation such as keyed toasts. */
  app?: TaoRuntimeApp
  /** callerProps preserves inherited Tao metadata across generated view boundaries. */
  callerProps?: TaoProps
  /** navigation is private Tao metadata for nearest-container presentation and dismissal. */
  navigation?: TaoNavigationValue
  /** navigationHostActive is private focus metadata propagated separately from host-slot channels. */
  navigationHostActive?: boolean
  /** response is private occurrence-owned ask metadata inherited by nested generated views. */
  response?: TaoResponseOccurrence
  /** designSpec preserves one combined render-site clause list until its mounted app resolves it. */
  designSpec?: TaoDesignSpec
  /** testTag is private Tao metadata lowered to the existing concrete native root. */
  testTag?: string
}

/** TaoAmbientContext is navigation-owned context propagated independently of layout caller props. */
export type TaoAmbientContext = Pick<TaoProps, 'app' | 'navigation' | 'navigationHostActive' | 'response'>

/** TaoResponseOccurrence settles exactly one independently asked view. */
export type TaoResponseOccurrence = {
  respond(value?: { evaluate(): { jsValue: unknown } }): void
}

/** TaoVisualLayout is the public layout-only snapshot exposed to an injected visual implementation. */
export type TaoVisualLayout = TaoResolvedLayoutProps

/** TaoViewProps declares the explicit public props accepted by runtime-backed visual primitives. */
export type TaoViewProps = {
  /** __tao remains private compatibility plumbing for generated components; inject fences never receive it. */
  __tao?: TaoProps
  children?: React.ReactNode
  layout?: TaoVisualLayout
  tag?: string
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
  ambientContext,
  appInChain,
  responseInChain,
  mergeViewProps,
  nativePropsWithStyle,
  navigationInChain,
  visualLayout,
  visualTag,
} as const

/** Copies only ambient presentation context from a generated caller-props chain. */
function ambientContext(props: TaoProps | undefined): TaoAmbientContext {
  const app = appInChain(props)
  const response = responseInChain(props)
  const navigation = navigationInChain(props)
  const navigationHostActive = navigationHostActiveInChain(props)
  return {
    ...(app ? { app } : {}),
    ...(response ? { response } : {}),
    ...(navigation ? { navigation } : {}),
    ...(navigationHostActive === undefined ? {} : { navigationHostActive }),
  }
}

function navigationHostActiveInChain(props: TaoProps | undefined): boolean | undefined {
  if (!props) {
    return undefined
  }
  return props.navigationHostActive ?? navigationHostActiveInChain(props.callerProps)
}

/** Finds the nearest enclosing mounted app accepted by an optional declaration-identity match. */
function appInChain(
  props: TaoProps | undefined,
  matches?: (app: TaoRuntimeApp) => boolean,
): TaoRuntimeApp | undefined {
  if (!props) {
    return undefined
  }
  if (props.app && (!matches || matches(props.app))) {
    return props.app
  }
  return appInChain(props.callerProps, matches)
}

/** Finds the nearest independently asked occurrence through generated caller props. */
function responseInChain(props: TaoProps | undefined): TaoResponseOccurrence | undefined {
  if (!props) {
    return undefined
  }
  return props.response ?? responseInChain(props.callerProps)
}

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
  const explicitLayoutProps = props.layout
    ? { ...props.layout, callerProps: props.__tao }
    : props.__tao
  const mountedApp = appInChain(taoRuntimeProps) ?? appInChain(explicitLayoutProps)
  const design = mountedApp?.design
  return {
    children: props.children,
    direction,
    nativeProps,
    props: LayoutRuntime.resolveProps(
      direction,
      resolveDesignProps(taoRuntimeProps, design),
      resolveDesignProps(explicitLayoutProps, design),
      ParentDirectionContext.propsForDirection(parentDirection),
    ),
    testTag: props.tag ?? testTag ?? testTagInChain(taoRuntimeProps) ?? testTagInChain(props.__tao),
  }
}

function resolveDesignProps(props: TaoProps | undefined, design: TaoDesign | undefined): TaoProps | undefined {
  if (!props) {
    return undefined
  }
  const resolved = DesignControls.resolve(design, props.designSpec)
  const callerProps = resolveDesignProps(props.callerProps, design)
  const style = mergeResolvedStyles(props.style, resolved.style)
  return {
    ...props,
    callerProps,
    designSpec: undefined,
    layout: LayoutControls.merge(props.layout, resolved.layout),
    style,
  }
}

function mergeResolvedStyles(
  base: TaoResolvedLayoutProps['style'],
  overlay: TaoResolvedLayoutProps['style'],
): TaoResolvedLayoutProps['style'] {
  if (!base) {
    return overlay
  }
  if (!overlay) {
    return base
  }
  return { ...base, ...overlay }
}

/** Returns only the occurrence layout and immediate parent direction for an injected visual root. */
function visualLayout(props: TaoProps | undefined): TaoVisualLayout | undefined {
  const mountedDesign = appInChain(props)?.design
  return LayoutRuntime.resolveProps(
    undefined,
    undefined,
    resolveDesignProps(props, mountedDesign),
    ParentDirectionContext.propsForDirection(ParentDirectionContext.use()),
  )
}

/** Returns the nearest concrete occurrence tag without exposing any other Tao-owned metadata. */
function visualTag(props: TaoProps | undefined): string | undefined {
  return testTagInChain(props)
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
