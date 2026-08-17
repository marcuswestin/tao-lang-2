export type TaoViewport = {
  fontScale: number
  height: number
  orientation: 'landscape' | 'portrait'
  scale: number
  width: number
}

type ReactNativeDimensions = {
  fontScale?: number
  height?: number
  scale?: number
  width?: number
}

type ReactNativeDeviceModule = {
  Dimensions?: {
    get(name: string): ReactNativeDimensions
  }
  useWindowDimensions?: () => ReactNativeDimensions
}

let viewportSource: () => TaoViewport = nativeViewport

/** Device exposes React Native device and viewport helpers. */
export const Device = {
  /** viewport reads the current window dimensions and re-renders when React Native reports changes. */
  viewport(): TaoViewport {
    return viewportSource()
  },

  /** setViewportForTests replaces React Native dimensions with deterministic runtime test values. */
  setViewportForTests(viewport?: Partial<TaoViewport>): void {
    viewportSource = viewport ? () => normalizeViewport(viewport) : nativeViewport
  },
} as const

function nativeViewport(): TaoViewport {
  if (isJestRuntime()) {
    return normalizeViewport({ height: 844, width: 390 })
  }

  const RN = require('react-native') as ReactNativeDeviceModule
  const dimensions = RN.useWindowDimensions?.() ?? RN.Dimensions?.get('window') ?? {}
  return normalizeViewport(dimensions)
}

function normalizeViewport(viewport: Partial<TaoViewport>): TaoViewport {
  const width = viewport.width ?? 0
  const height = viewport.height ?? 0
  return {
    fontScale: viewport.fontScale ?? 1,
    height,
    orientation: viewport.orientation ?? (width > height ? 'landscape' : 'portrait'),
    scale: viewport.scale ?? 1,
    width,
  }
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
