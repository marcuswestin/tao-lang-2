import type React from 'react'
import type { Evaluable } from './TR-action-values'
import {
  DesignControls,
  type TaoDesign,
  type TaoDesignCondition,
  type TaoDesignSource,
  type TaoDesignSpec,
} from './TR-design'
import type {
  TaoInteractionOccurrence,
  TaoOutlineControlNode,
  TaoOutlineRowRoot,
  TaoOutlineSiblingRegionNode,
} from './TR-interaction-outline'
import {
  LayoutControls,
  LayoutRuntime,
  type TaoLayoutDirection,
  type TaoLayoutProps,
  type TaoResolvedLayoutProps,
} from './TR-layout'
import type { TaoNavigationValue } from './TR-navigation'
import type { TaoRuntimeApp } from './TR-navigation'
import type { RuntimeHostReadChannel } from './TR-navigation-host-slots'
import { ParentDirectionContext } from './TR-parent-direction'
import type { TaoScheme } from './TR-scheme'
import { studioInspectRef } from './TR-studio-device-inspect'

/** TaoStudioIdentity locates one concrete render occurrence in Tao source. */
export type TaoStudioIdentity = {
  elementName?: string
  end: number
  kind: 'render'
  ownerName?: string
  sourcePath: string
  start: number
  studioRectId?: string
}

/**
 * TaoInteractionProps is the outline metadata one render site carries: the control the occurrence
 * is, from its module's generated table, and the loop row whose sole root it renders. It is its own
 * field, never `studio`, because Studio identity lowers a DOM marker that stays Studio-only.
 */
type TaoInteractionProps = {
  control?: TaoOutlineControlNode
  region?: TaoOutlineSiblingRegionNode
  row?: TaoOutlineRowRoot
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
  /**
   * navigationChrome is the bar an enclosing navigator draws in place of a stack's header. A stack
   * that receives one hides its own header and publishes its visible scene's chrome into it.
   */
  navigationChrome?: RuntimeHostReadChannel
  /** navigationBottomInset is the height of chrome floating over the content's bottom edge. */
  navigationBottomInset?: number
  /** response is private occurrence-owned ask metadata inherited by nested generated views. */
  response?: TaoResponseOccurrence
  /** scheme is the resolved read-only appearance environment propagated independently of layout. */
  scheme?: TaoScheme
  /** studio is private occurrence identity lowered only onto the concrete native root. */
  studio?: TaoStudioIdentity
  /** journeyObservation is test-only source identity read from the live mounted check tree. */
  journeyObservation?: TaoJourneyRenderObservation
  /** designSpec preserves one combined render-site clause list until its mounted app resolves it. */
  designSpec?: TaoDesignSpec
  /** designSource locates the concrete clause occurrence without changing Design.Spec's flat ABI. */
  designSource?: TaoDesignSource
  /** designDefault names the linked stdlib element bundle applied before render-site clauses. */
  designDefault?: string
  /**
   * selected marks the element its host names as the current choice, such as the active navigation
   * tab. The `when selected` design condition reads it on this link alone; it never inherits.
   */
  selected?: boolean
  /**
   * declarationSpec holds the public style defaults a view or scene declares in its header clause.
   * It applies to the occurrence root of every render branch, above the element default and below
   * the caller's own clauses at the same link.
   */
  declarationSpec?: TaoDesignSpec
  /** interaction is private outline metadata lowered onto the concrete native root as its accessible name. */
  interaction?: TaoInteractionProps
  /** testTag is private Tao metadata lowered to the existing concrete native root. */
  testTag?: string
  /** viewDepth counts generated Tao view frames without inspecting argument identity. */
  viewDepth?: number
}

type TaoJourneyRenderObservation = Readonly<{
  end: number
  renderId: string
  sourcePath: string
  sourceVersion: string
  start: number
}>

/** TaoAmbientContext is navigation-owned context propagated independently of layout caller props. */
export type TaoAmbientContext = Pick<TaoProps, 'app' | 'navigation' | 'navigationHostActive' | 'response' | 'scheme'>

/** TaoResponseOccurrence settles exactly one independently asked view. */
export type TaoResponseOccurrence = {
  respond(value?: Evaluable): void
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
  readonly interaction: TaoInteractionProps | undefined
  readonly nativeProps: Record<string, unknown>
  readonly props: TaoResolvedLayoutProps | undefined
  readonly studio: TaoStudioIdentity | undefined
  readonly testTag: string | undefined
}

type PrivateVisualMetadata = {
  interaction?: TaoInteractionProps
  occurrence?: TaoInteractionOccurrence
  studio?: TaoStudioIdentity
}

// Injected visual implementations receive a deliberately layout-only value. Studio occurrence
// identity and outline metadata follow that exact object through a private side table so
// standard-library wrappers do not need a new language-visible ambient channel or access to the
// complete private __tao bag.
const privateMetadataByVisualLayout = new WeakMap<object, PrivateVisualMetadata>()
const occurrenceByTaoProps = new WeakMap<
  TaoProps,
  Readonly<{
    condition: TaoDesignCondition
    occurrence: TaoInteractionOccurrence
  }>
>()
const interactionOwnerByTaoProps = new WeakMap<TaoProps, TaoInteractionOccurrence>()

/** TaoPropsControls exposes runtime Tao props merging for generated views. */
export const TaoPropsControls = {
  ambientContext,
  appInChain,
  responseInChain,
  interactionOccurrence,
  interactionOwner,
  inheritInteractionOwner,
  mergeViewProps,
  nativePropsWithStyle,
  navigationInChain,
  schemeInChain,
  setInteractionOccurrence,
  visualNativeProps,
  visualInteractionOccurrence,
  visualLayout,
  visualTag,
} as const

function setInteractionOccurrence(
  props: TaoProps | undefined,
  occurrence: TaoInteractionOccurrence,
  condition: (subject: string, value: string | undefined, occurrence: TaoInteractionOccurrence | undefined) => boolean,
): void {
  if (props) {
    occurrenceByTaoProps.set(props, {
      condition: (subject, value) => condition(subject, value, occurrence),
      occurrence,
    })
  }
}

function interactionOccurrence(props: TaoProps | undefined): TaoInteractionOccurrence | undefined {
  if (!props) {
    return undefined
  }
  return occurrenceByTaoProps.get(props)?.occurrence ?? interactionOccurrence(props.callerProps)
}

/** Preserves only private outline ownership when a generated child intentionally drops caller props. */
function inheritInteractionOwner(props: TaoProps, callerProps: TaoProps | undefined): void {
  const owner = interactionOccurrence(callerProps)
  if (owner) {
    interactionOwnerByTaoProps.set(props, owner)
  }
}

/** Returns the generated child's inherited owner without confusing it with its own prior render. */
function interactionOwner(props: TaoProps | undefined): TaoInteractionOccurrence | undefined {
  return props === undefined
    ? undefined
    : interactionOwnerByTaoProps.get(props) ?? interactionOccurrence(props.callerProps)
}

function interactionCondition(props: TaoProps | undefined): TaoDesignCondition | undefined {
  if (!props) {
    return undefined
  }
  return occurrenceByTaoProps.get(props)?.condition ?? interactionCondition(props.callerProps)
}

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
    interaction: interactionInChain(props.__tao)
      ?? privateMetadataForVisualLayout(props.layout)?.interaction
      ?? interactionInChain(taoRuntimeProps),
    studio: studioIdentityInChain(props.__tao)
      ?? privateMetadataForVisualLayout(props.layout)?.studio
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
  const condition = DesignControls.withSelected(interactionCondition(props), props.selected)
  // The stdlib element default resolves on its own because it is the weakest authored layer: a
  // caller's clause overrules the default of the element it reaches. The declaration header and
  // this link's own clauses resolve together, header first, at this link's own strength.
  const elementDefault = DesignControls.resolve(design, undefined, props.designDefault, scheme, condition)
  const resolved = DesignControls.resolve(design, designSpec, undefined, scheme, condition, props.declarationSpec)
  const callerProps = resolveDesignProps(props.callerProps, design, scheme)
  const style = mergeResolvedStyles(props.style, resolved.style)
  return {
    ...props,
    callerProps,
    declarationSpec: undefined,
    designDefault: undefined,
    designSource: undefined,
    designSpec: undefined,
    elementDefaultLayout: elementDefault.layout,
    elementDefaultStyle: elementDefault.style,
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
  const interaction = interactionInChain(props)
  const occurrence = interactionOccurrence(props)
  if (studio === undefined && interaction === undefined && occurrence === undefined) {
    return resolved
  }
  const visualLayout = resolved ?? {}
  privateMetadataByVisualLayout.set(visualLayout, {
    ...(interaction === undefined ? {} : { interaction }),
    ...(occurrence === undefined ? {} : { occurrence }),
    ...(studio === undefined ? {} : { studio }),
  })
  return visualLayout
}

function visualInteractionOccurrence(layout: TaoVisualLayout | undefined): TaoInteractionOccurrence | undefined {
  return privateMetadataForVisualLayout(layout)?.occurrence
}

function privateMetadataForVisualLayout(layout: TaoVisualLayout | undefined): PrivateVisualMetadata | undefined {
  return layout === undefined ? undefined : privateMetadataByVisualLayout.get(layout)
}

/** Returns the nearest concrete occurrence tag without exposing any other Tao-owned metadata. */
function visualTag(props: TaoProps | undefined): string | undefined {
  return testTagInChain(props)
}

/** Lowers private Studio identity and the public test tag onto an injected native root. */
function visualNativeProps(layout: TaoVisualLayout | undefined, tag?: string): Record<string, unknown> {
  const metadata = privateMetadataForVisualLayout(layout)
  const nativeProps = nativePropsWithStudioIdentity({}, metadata?.studio)
  return tag ? { ...nativeProps, testID: tag } : nativeProps
}

function nativePropsWithStyle(merged: MergedTaoViewProps): Record<string, unknown> {
  const nativeProps = LayoutRuntime.nativePropsWithStyle(merged.nativeProps, merged.props, merged.direction)
  const nativePropsWithStudio = nativePropsWithStudioIdentity(nativeProps, merged.studio)
  return merged.testTag ? { ...nativePropsWithStudio, testID: merged.testTag } : nativePropsWithStudio
}

/**
 * Merges the outline metadata of a caller chain: the innermost control and the nearest row root,
 * which one concrete root may carry at once when a row's sole render is itself a control.
 */
function interactionInChain(props: TaoProps | undefined): TaoInteractionProps | undefined {
  if (!props) {
    return undefined
  }
  const outer = interactionInChain(props.callerProps)
  const control = props.interaction?.control ?? outer?.control
  const region = props.interaction?.region ?? outer?.region
  const row = props.interaction?.row ?? outer?.row
  if (control === undefined && region === undefined && row === undefined) {
    return undefined
  }
  return {
    ...(control === undefined ? {} : { control }),
    ...(region === undefined ? {} : { region }),
    ...(row === undefined ? {} : { row }),
  }
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
    // The browser canvas reads the identity above out of the DOM; a device has no DOM, so the same
    // occurrence also gets a measurable handle. The ref is stable per occurrence and registers
    // nothing for a node without `measureInWindow`, which is every node under react-native-web.
    // A caller-supplied ref wins: overwriting one would break the app to inspect it.
    ...(nativeProps['ref'] === undefined ? { ref: studioInspectRef(studio) } : {}),
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
