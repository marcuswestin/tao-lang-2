import React from 'react'

export type TaoDevModeOptions = {
  readonly enabled?: boolean
  readonly layoutBounds?: boolean
}

export type TaoDebugStyle = Record<string, number | string>
export type TaoDebugStyleInput = TaoDebugStyle | readonly TaoDebugStyleInput[] | null | undefined
export type TaoCreateElementDevOptions = {
  readonly platformOS?: string
}

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

const boundingBoxStyleProperties = new Set([
  'backgroundColor',
  'borderBottomWidth',
  'borderColor',
  'borderEndWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderStartWidth',
  'borderTopWidth',
  'borderWidth',
  'boxShadow',
  'elevation',
  'filter',
  'outlineColor',
  'outlineWidth',
  'shadowColor',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',
])

let devMode = defaultDevMode()
const listeners = new Set<() => void>()

/** Dev configures Tao runtime development-only diagnostics. */
export const Dev = {
  /** getMode returns the current Tao runtime development mode. */
  getMode,
  isEnabled,
  isLayoutBoundsEnabled,
  processCreateReactElementArgs,
  setMode,
  toggleLayoutBounds,
  useMode,
} as const

/** DevControls exposes public, hook-free Tao runtime diagnostic controls. */
export const DevControls = {
  getMode,
  isEnabled,
  isLayoutBoundsEnabled,
  setMode,
  toggleLayoutBounds,
} as const

function setMode(options?: TaoDevModeOptions): void {
  updateMode(resolveModeOptions(options))
}

function getMode(): TaoDevModeState {
  return devMode
}

function isEnabled(): boolean {
  return devMode.enabled
}

function toggleLayoutBounds(): void {
  updateMode({
    enabled: true,
    layoutBounds: !devMode.layoutBounds,
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useMode(): TaoDevModeState {
  const [mode, setModeSnapshot] = React.useState(getMode)
  React.useEffect(() => subscribe(() => setModeSnapshot(getMode())), [])
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
    layoutBounds: enabled,
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
  for (const listener of listeners) {
    listener()
  }
}

function isLayoutBoundsEnabled(): boolean {
  return devMode.enabled && devMode.layoutBounds
}

function styleLayoutBounds(color: string, platformOS?: string): TaoDebugStyle {
  if (platformOS === 'android' || platformOS === 'ios') {
    return {
      borderColor: color,
      borderWidth: 0.5,
    }
  }
  return {
    boxShadow: `inset 0 0 0 0.5px ${color}`,
    outlineColor: color,
    outlineOffset: -0.5,
    outlineStyle: 'solid',
    outlineWidth: 0.5,
  }
}

function processCreateReactElementArgs(args: any[], options: TaoCreateElementDevOptions = {}): void {
  if (!isLayoutBoundsEnabled()) {
    return
  }

  const props = elementProps(args[1])
  const style = styleInput(props['style'])
  if (hasBoundingBoxAppearance(style)) {
    return
  }

  props['style'] = appendStyle(props['style'], styleLayoutBounds(layoutBoundsColorForArgs(args), options.platformOS))
  args[1] = props
}

function hasBoundingBoxAppearance(style: TaoDebugStyleInput): boolean {
  if (!style) {
    return false
  }
  if (Array.isArray(style)) {
    return style.some(hasBoundingBoxAppearance)
  }
  return Object.entries(style).some(([property, value]) => {
    return value !== undefined
      && value !== null
      && value !== 0
      && boundingBoxStyleProperties.has(property)
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
    return `{${Object.keys(value).sort().join(',')}}`
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
