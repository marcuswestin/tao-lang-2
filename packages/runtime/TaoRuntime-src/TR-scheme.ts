import React from 'react'
import { UserInputError } from './TR-errors'
import { requireReactNativeRuntime } from './TR-react-native'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'

const schemeCaptureVersion = 1 as const

export type TaoAppearance = 'dark' | 'light' | 'system'
export type TaoScheme = 'dark' | 'light'
export type TaoSchemeCapability = 'fixed-light-native' | 'pinned-native' | 'reactive-browser'
export type TaoSchemeSource = 'native-fixed' | 'preference' | 'scenario' | 'system'

export type TaoSchemeSnapshot = Readonly<{
  capability: TaoSchemeCapability
  requested: TaoAppearance
  resolved: TaoScheme
  source: TaoSchemeSource
}>

export type TaoSchemeRequest = Readonly<{
  appearance?: TaoAppearance
  replay?: TaoSchemeSnapshot
  scenario?: TaoScheme
}>

export type TaoSchemeResolutionEnvironment = Readonly<{
  platform: 'native' | 'web'
  system: TaoScheme
}>

type TaoSchemeProviderProps =
  & TaoSchemeRequest
  & Readonly<{
    children?: React.ReactNode
    environment?: TaoSchemeResolutionEnvironment
  }>

const SchemeContext = React.createContext<TaoSchemeSnapshot | undefined>(undefined)

/** SchemeControls owns the real environment value used by design conditions and Studio capture. */
export const SchemeControls = {
  /** appearancePin promotes the resolved frame, never a host-dependent System request. */
  appearancePin(snapshot: TaoSchemeSnapshot): TaoScheme {
    return snapshot.resolved
  },
  Provider: SchemeProvider,
  resolve: resolveScheme,
  use: useScheme,
} as const

function resolveScheme(
  request: TaoSchemeRequest,
  environment: TaoSchemeResolutionEnvironment,
): TaoSchemeSnapshot {
  if (request.replay !== undefined) {
    validateSnapshot(request.replay)
    return request.replay
  }
  const requested = request.scenario ?? request.appearance ?? 'system'
  const requestSource: Exclude<TaoSchemeSource, 'native-fixed'> = request.scenario !== undefined
    ? 'scenario'
    : request.appearance !== undefined && request.appearance !== 'system'
    ? 'preference'
    : 'system'
  if (environment.platform === 'native') {
    // A scenario's appearance is part of the scenario, so it travels to a device. `fixed-light-native`
    // says this runtime cannot follow the device's own appearance; it never said the runtime cannot
    // render dark, and a Studio cell asking for dark is asking for exactly that. Only a preview cell
    // ever sets `scenario`, so a shipped app resolves the way it always has.
    if (request.scenario !== undefined) {
      return Object.freeze({
        capability: 'pinned-native',
        requested: request.scenario,
        resolved: request.scenario,
        source: 'scenario',
      })
    }
    return Object.freeze({
      capability: 'fixed-light-native',
      requested,
      resolved: 'light',
      source: 'native-fixed',
    })
  }
  return Object.freeze({
    capability: 'reactive-browser',
    requested,
    resolved: requested === 'system' ? environment.system : requested,
    source: requestSource,
  })
}

function SchemeProvider(props: TaoSchemeProviderProps): React.JSX.Element {
  const liveEnvironment = useSchemeEnvironment()
  const [replay, setReplay] = React.useState<TaoSchemeSnapshot | undefined>(props.replay)
  const environment = props.environment ?? liveEnvironment
  const snapshot = React.useMemo(() =>
    resolveScheme({
      ...(props.appearance === undefined ? {} : { appearance: props.appearance }),
      ...(replay === undefined ? {} : { replay }),
      ...(props.scenario === undefined ? {} : { scenario: props.scenario }),
    }, environment), [environment, props.appearance, props.scenario, replay])
  React.useEffect(() =>
    registerRuntimeCaptureDomain({
      capture: () => snapshot,
      domain: 'scheme',
      restore(value) {
        setReplay(decodeSnapshot(value))
      },
      version: schemeCaptureVersion,
    }), [snapshot])
  return React.createElement(SchemeContext.Provider, { value: snapshot }, props.children)
}

function useScheme(): TaoSchemeSnapshot {
  const provided = React.useContext(SchemeContext)
  const environment = useSchemeEnvironment()
  return provided ?? resolveScheme({}, environment)
}

function useSchemeEnvironment(): TaoSchemeResolutionEnvironment {
  const system = React.useSyncExternalStore<TaoScheme>(subscribeSystemScheme, readSystemScheme, () => 'light')
  const platform = requireReactNativeRuntime().Platform?.OS === 'web' ? 'web' : 'native'
  return React.useMemo(() => ({ platform, system }), [platform, system])
}

function subscribeSystemScheme(changed: () => void): () => void {
  const media = browserSchemeMedia()
  if (media === undefined) {
    return () => {}
  }
  if (typeof media.addEventListener === 'function') {
    const add = media.addEventListener
    const remove = media.removeEventListener
    add.call(media, 'change', changed)
    return () => remove?.call(media, 'change', changed)
  }
  media.addListener?.(changed)
  return () => media.removeListener?.(changed)
}

function readSystemScheme(): TaoScheme {
  return browserSchemeMedia()?.matches === true ? 'dark' : 'light'
}

type SchemeMedia = {
  addEventListener?(type: 'change', changed: () => void): void
  addListener?(changed: () => void): void
  matches: boolean
  removeEventListener?(type: 'change', changed: () => void): void
  removeListener?(changed: () => void): void
}

function browserSchemeMedia(): SchemeMedia | undefined {
  const matchMedia = (globalThis as { matchMedia?: (query: string) => SchemeMedia }).matchMedia
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
}

function decodeSnapshot(value: TaoRuntimeJson): TaoSchemeSnapshot {
  const record = value as Readonly<Record<string, TaoRuntimeJson>>
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || !['fixed-light-native', 'pinned-native', 'reactive-browser'].includes(String(record['capability']))
    || (record['requested'] !== 'dark' && record['requested'] !== 'light' && record['requested'] !== 'system')
    || (record['resolved'] !== 'dark' && record['resolved'] !== 'light')
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(String(record['source']))
  ) {
    throw new UserInputError('Tao Scheme capture must record requested, resolved, source, and capability.')
  }
  const snapshot = record as TaoSchemeSnapshot
  validateSnapshot(snapshot)
  return Object.freeze({ ...snapshot })
}

function validateSnapshot(snapshot: TaoSchemeSnapshot): void {
  if (
    !['fixed-light-native', 'pinned-native', 'reactive-browser'].includes(snapshot.capability)
    || (snapshot.requested !== 'dark' && snapshot.requested !== 'light' && snapshot.requested !== 'system')
    || (snapshot.resolved !== 'dark' && snapshot.resolved !== 'light')
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(snapshot.source)
    || (snapshot.source === 'system' && snapshot.requested !== 'system')
    || (snapshot.source === 'preference' && snapshot.requested === 'system')
    || (snapshot.source === 'scenario' && snapshot.requested === 'system')
    || (snapshot.source === 'native-fixed' && snapshot.capability !== 'fixed-light-native')
    || (snapshot.capability === 'fixed-light-native'
      && (snapshot.resolved !== 'light' || snapshot.source !== 'native-fixed'))
    // A pin is only a pin if the host actually took it: resolved is what was asked for, and the only
    // thing that asks is a scenario.
    || (snapshot.capability === 'pinned-native'
      && (snapshot.source !== 'scenario' || snapshot.resolved !== snapshot.requested))
  ) {
    throw new UserInputError('Tao Scheme snapshot is invalid.', { snapshot })
  }
}
