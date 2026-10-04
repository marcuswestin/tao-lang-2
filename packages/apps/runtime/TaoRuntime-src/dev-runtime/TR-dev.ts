import React from 'react'
import { Arrays } from '../core/RuntimeCore'
import { runtimeListeners } from '../TR-listeners'

export type TaoDevModeOptions = {
  readonly enabled?: boolean
  readonly layoutBounds?: boolean
}

type TaoDebugStyle = Record<string, number | string>
type TaoDebugStyleInput = TaoDebugStyle | readonly TaoDebugStyleInput[] | null | undefined

type TaoDevModeState = Required<TaoDevModeOptions>

const layoutBoundColors = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#ca8a04',
  '#9333ea',
  '#0891b2',
  '#ea580c',
  '#4f46e5',
  '#be123c',
  '#0d9488',
] as const

// Layout bounds draw with an inward outline, or an inset shadow when the author already set an outline, so they
// never change layout; an element whose author set both keeps its own appearance.
const outlineStyleProperties = new Set(['outlineColor', 'outlineStyle', 'outlineWidth'])
const shadowStyleProperties = new Set([
  'boxShadow',
  'elevation',
  'shadowColor',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',
])

/** Style objects this module appended for the layout-bounds overlay, so a forwarded style that carries one
 * inward (e.g. a component spreading `{...props}` into an inner `createElement` call) is never mistaken for
 * an author-written bounding-box style that should suppress the overlay. */
const injectedDebugStyles = new WeakSet<object>()

let devMode = defaultDevMode()
/**
 * Whether a host above the app already offers the dev options, so the floating menu stays away.
 *
 * The Studio device host is that host: it renders its own draggable affordance over the preview
 * cell, and a second floating button beside it — with one option, over an app the person is
 * inspecting through the first — is two menus for one job.
 */
let menuHidden = false
const listeners = runtimeListeners()

/** Dev configures Tao runtime development-only diagnostics. */
export const Dev = {
  /** getMode returns the current Tao runtime development mode. */
  getMode,
  isDevelopmentBuild,
  hideMenu,
  isEnabled,
  isLayoutBoundsEnabled,
  isMenuHidden,
  processCreateReactElementArgs,
  setMode,
  toggleLayoutBounds,
  useMode,
} as const

/** DevControls exposes public, hook-free Tao runtime diagnostic controls. */
export const DevControls = {
  getMode,
  hideMenu,
  isEnabled,
  isLayoutBoundsEnabled,
  isMenuHidden,
  setMode,
  toggleLayoutBounds,
} as const

/** hideMenu withholds the floating dev menu for a host that presents the same options itself. */
function hideMenu(hidden: boolean): void {
  if (menuHidden === hidden) {
    return
  }
  menuHidden = hidden
  listeners.notify()
}

function isMenuHidden(): boolean {
  return menuHidden
}

function setMode(options?: TaoDevModeOptions): void {
  updateMode(resolveModeOptions(options))
}

function getMode(): TaoDevModeState {
  return devMode
}

function isEnabled(): boolean {
  return devMode.enabled
}

function isDevelopmentBuild(): boolean {
  return isReactNativeDevMode()
}

function toggleLayoutBounds(): void {
  updateMode({
    enabled: true,
    layoutBounds: !devMode.layoutBounds,
  })
}

function useMode(): TaoDevModeState {
  const [mode, setModeSnapshot] = React.useState(getMode)
  React.useEffect(() => listeners.subscribe(() => setModeSnapshot(getMode())), [])
  return mode
}

function normalizeMode(options: TaoDevModeOptions): TaoDevModeState {
  const layoutBounds = options.layoutBounds === true
  return {
    enabled: options.enabled === true || layoutBounds,
    layoutBounds,
  }
}

function resolveModeOptions(options: TaoDevModeOptions | undefined): TaoDevModeState {
  if (!options || (options.enabled === undefined && options.layoutBounds === undefined)) {
    return defaultDevMode()
  }
  return normalizeMode(options)
}

function defaultDevMode(): TaoDevModeState {
  const enabled = isReactNativeDevMode()
  return {
    enabled,
    layoutBounds: false,
  }
}

function isReactNativeDevMode(): boolean {
  return (globalThis as { __DEV__?: unknown }).__DEV__ === true
}

function updateMode(nextMode: TaoDevModeState): void {
  const changed = devMode.enabled !== nextMode.enabled || devMode.layoutBounds !== nextMode.layoutBounds
  devMode = nextMode
  if (!changed) {
    return
  }
  listeners.notify()
}

function isLayoutBoundsEnabled(): boolean {
  return devMode.enabled && devMode.layoutBounds
}

function styleLayoutBounds(color: string, style: TaoDebugStyleInput): TaoDebugStyle | undefined {
  if (!setsAny(style, outlineStyleProperties)) {
    return { outlineColor: color, outlineOffset: -0.5, outlineStyle: 'solid', outlineWidth: 0.5 }
  }
  if (!setsAny(style, shadowStyleProperties)) {
    return { boxShadow: `inset 0 0 0 0.5px ${color}` }
  }
  return undefined
}

function processCreateReactElementArgs(args: any[]): void {
  if (args[0] === React.Fragment) {
    return
  }
  if (!isLayoutBoundsEnabled()) {
    return
  }

  const props = elementProps(args[1])
  const debugStyle = styleLayoutBounds(layoutBoundsColorForArgs(args), styleInput(props['style']))
  if (!debugStyle) {
    return
  }
  injectedDebugStyles.add(debugStyle)
  props['style'] = appendStyle(props['style'], debugStyle)
  args[1] = props
}

function setsAny(style: TaoDebugStyleInput, properties: ReadonlySet<string>): boolean {
  if (!style) {
    return false
  }
  if (Array.isArray(style)) {
    return style.some(item => setsAny(item, properties))
  }
  if (injectedDebugStyles.has(style)) {
    return false
  }
  return Object.entries(style).some(([property, value]) => {
    return value !== undefined
      && value !== null
      && value !== 0
      && properties.has(property)
  })
}

function elementProps(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? { ...value }
    : {}
}

function appendStyle(style: unknown, debugStyle: TaoDebugStyle): unknown[] {
  return Array.isArray(style) ? [...style, debugStyle] : [style, debugStyle]
}

function styleInput(value: unknown): TaoDebugStyleInput {
  if (!value || typeof value === 'object') {
    return value as TaoDebugStyleInput
  }
  return undefined
}

function layoutBoundsColorForArgs(args: readonly unknown[]): string {
  const signature = [
    elementTypeSignature(args[0]),
    valueSignature((args[1] as { style?: unknown } | undefined)?.style),
    ...args.slice(2).map(valueSignature),
  ].join('|')
  return layoutBoundColors[stableHash(signature) % layoutBoundColors.length] ?? layoutBoundColors[0]
}

function elementTypeSignature(type: unknown): string {
  if (typeof type === 'string') {
    return type
  }
  if (typeof type === 'function') {
    const namedType = type as { displayName?: string; name?: string }
    return namedType.displayName ?? namedType.name ?? 'anonymous'
  }
  return valueSignature(type)
}

function valueSignature(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value)
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(valueSignature).join(',')}]`
  }
  if (React.isValidElement(value)) {
    return `<${elementTypeSignature(value.type)}>`
  }
  if (typeof value === 'object') {
    return `{${Arrays.sorted(Object.keys(value)).join(',')}}`
  }
  return typeof value
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) >>> 0
  }
  return hash
}
