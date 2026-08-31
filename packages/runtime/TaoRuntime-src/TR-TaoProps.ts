import type React from 'react'
import { DesignControls, type TaoDesign, type TaoDesignSource, type TaoDesignSpec } from './TR-design'
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
import type { TaoScheme } from './TR-scheme'

/** TaoStudioIdentity locates one concrete render occurrence in Tao source. */
export type TaoStudioIdentity = {
  end: number
  kind: 'render'
  ownerName?: string
  sourcePath: string
  start: number
}

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
  /** scheme is the resolved read-only appearance environment propagated independently of layout. */
  scheme?: TaoScheme
  /** studio is private occurrence identity lowered only onto the concrete native root. */
  studio?: TaoStudioIdentity
  /** designSpec preserves one combined render-site clause list until its mounted app resolves it. */
  designSpec?: TaoDesignSpec
  /** designSource locates the concrete clause occurrence without changing Design.Spec's flat ABI. */
  designSource?: TaoDesignSource
  /** designDefault names the linked stdlib element bundle applied before render-site clauses. */
  designDefault?: string
  /** testTag is private Tao metadata lowered to the existing concrete native root. */
  testTag?: string
  /** viewDepth counts generated Tao view frames without inspecting argument identity. */
  viewDepth?: number
}

/** TaoAmbientContext is navigation-owned context propagated independently of layout caller props. */
export type TaoAmbientContext = Pick<TaoProps, 'app' | 'navigation' | 'navigationHostActive' | 'response' | 'scheme'>

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
  readonly studio: TaoStudioIdentity | undefined
  readonly testTag: string | undefined
}

// Injected visual implementations receive a deliberately layout-only value. Studio occurrence
// identity follows that exact object through a private side table so standard-library wrappers do
// not need a new language-visible ambient channel or access to the complete private __tao bag.
const studioIdentityByVisualLayout = new WeakMap<object, TaoStudioIdentity>()

/** TaoPropsControls exposes runtime Tao props merging for generated views. */
export const TaoPropsControls = {
  ambientContext,
  appInChain,
  responseInChain,
  mergeViewProps,
  nativePropsWithStyle,
  navigationInChain,
  schemeInChain,
  visualNativeProps,
  visualLayout,
  visualTag,
} as const

/** Copies only ambient presentation context from a generated caller-props chain. */
function ambientContext(props: TaoProps | undefined): TaoAmbientContext {
  const app = appInChain(props)
  const response = responseInChain(props)
  const navigation = navigationInChain(props)
  const navigationHostActive = navigationHostActiveInChain(props)
  const scheme = schemeInChain(props)
  return {
    ...(app ? { app } : {}),
    ...(response ? { response } : {}),
    ...(navigation ? { navigation } : {}),
    ...(navigationHostActive === undefined ? {} : { navigationHostActive }),
    ...(scheme === undefined ? {} : { scheme }),
  }
}

function navigationHostActiveInChain(props: TaoProps | undefined): boolean | undefined {
  if (!props) {
    return undefined
  }
  return props.navigationHostActive ?? navigationHostActiveInChain(props.callerProps)
}

function schemeInChain(props: TaoProps | undefined): TaoScheme | undefined {
  if (!props) {
    return undefined
  }
  return props.scheme ?? schemeInChain(props.callerProps)
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
  const scheme = schemeInChain(taoRuntimeProps) ?? schemeInChain(explicitLayoutProps) ?? 'light'
  return {
    children: props.children,
    direction,
    nativeProps,
    props: LayoutRuntime.resolveProps(
      direction,
      resolveDesignProps(taoRuntimeProps, design, scheme),
      resolveDesignProps(explicitLayoutProps, design, scheme),
      ParentDirectionContext.propsForDirection(parentDirection),
    ),
    studio: studioIdentityInChain(props.__tao)
      ?? studioIdentityForVisualLayout(props.layout)
      ?? studioIdentityInChain(taoRuntimeProps),
    testTag: props.tag ?? testTag ?? testTagInChain(taoRuntimeProps) ?? testTagInChain(props.__tao),
  }
}

function resolveDesignProps(
  props: TaoProps | undefined,
  design: TaoDesign | undefined,
  scheme: TaoScheme,
): TaoProps | undefined {
  if (!props) {
    return undefined
  }
  const designSpec = props.designSpec === undefined || props.designSource === undefined
    ? props.designSpec
    : DesignControls.Source(props.designSpec, props.designSource)
  const resolved = DesignControls.resolve(design, designSpec, props.designDefault, scheme)
  const callerProps = resolveDesignProps(props.callerProps, design, scheme)
  const style = mergeResolvedStyles(props.style, resolved.style)
  return {
    ...props,
    callerProps,
    designDefault: undefined,
    designSource: undefined,
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
  const resolved = LayoutRuntime.resolveProps(
    undefined,
    undefined,
    resolveDesignProps(props, mountedDesign, schemeInChain(props) ?? 'light'),
    ParentDirectionContext.propsForDirection(ParentDirectionContext.use()),
  )
  const studio = studioIdentityInChain(props)
  if (studio === undefined) {
    return resolved
  }
  const visualLayout = resolved ?? {}
  studioIdentityByVisualLayout.set(visualLayout, studio)
  return visualLayout
}

function studioIdentityForVisualLayout(layout: TaoVisualLayout | undefined): TaoStudioIdentity | undefined {
  return layout === undefined ? undefined : studioIdentityByVisualLayout.get(layout)
}

/** Returns the nearest concrete occurrence tag without exposing any other Tao-owned metadata. */
function visualTag(props: TaoProps | undefined): string | undefined {
  return testTagInChain(props)
}

/** Lowers private Studio occurrence identity and the public test tag onto an injected native root. */
function visualNativeProps(layout: TaoVisualLayout | undefined, tag?: string): Record<string, unknown> {
  const nativeProps = nativePropsWithStudioIdentity({}, studioIdentityForVisualLayout(layout))
  return tag ? { ...nativeProps, testID: tag } : nativeProps
}

function nativePropsWithStyle(merged: MergedTaoViewProps): Record<string, unknown> {
  const nativeProps = LayoutRuntime.nativePropsWithStyle(merged.nativeProps, merged.props, merged.direction)
  const nativePropsWithStudio = nativePropsWithStudioIdentity(nativeProps, merged.studio)
  return merged.testTag ? { ...nativePropsWithStudio, testID: merged.testTag } : nativePropsWithStudio
}

function nativePropsWithStudioIdentity(
  nativeProps: Record<string, unknown>,
  studio: TaoStudioIdentity | undefined,
): Record<string, unknown> {
  if (!studio) {
    return nativeProps
  }
  const dataSet = nativeProps['dataSet']
  const existingDataSet = typeof dataSet === 'object' && dataSet !== null && !Array.isArray(dataSet)
    ? dataSet as Record<string, unknown>
    : {}
  return {
    ...nativeProps,
    dataSet: {
      ...existingDataSet,
      taoStudio: JSON.stringify(studio),
    },
  }
}

/** Finds the outermost caller occurrence represented by one concrete runtime root. */
function studioIdentityInChain(props: TaoProps | undefined): TaoStudioIdentity | undefined {
  if (!props) {
    return undefined
  }
  return studioIdentityInChain(props.callerProps) ?? props.studio
}

function testTagInChain(props: TaoProps | undefined): string | undefined {
  if (!props) {
    return undefined
  }
  return props.testTag ?? testTagInChain(props.callerProps)
}
