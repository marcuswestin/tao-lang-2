import React from 'react'
import { revision as dataRevision, subscribeAll as subscribeAllData } from './TR-data'
import { requireReactNativeRuntime } from './TR-react-native'
import { Views } from './TR-views'

/** TaoScreen declares one presented screen: a generated view and the props it was presented with. */
export type TaoScreen = {
  view: React.ComponentType<Record<string, unknown>>
  props: Record<string, unknown>
}

/**
 * Tao owns navigation state, not the platform: one stack of presented screens, updated only by
 * `present` and `dismiss`. Native back reports the same intent instead of keeping its own model.
 */
const listeners = new Set<() => void>()
let stack: readonly TaoScreen[] = []

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** present pushes one screen onto the app's stack. */
export function present(
  view: React.ComponentType<Record<string, unknown>>,
  props: Record<string, unknown> = {},
): void {
  stack = [...stack, { view, props }]
  notify()
}

/** dismiss pops the top screen, and does nothing at the app root. */
export function dismiss(): void {
  if (stack.length === 0) {
    return
  }
  stack = stack.slice(0, -1)
  notify()
}

/** depth returns how many screens are presented above the app root. */
export function depth(): number {
  return stack.length
}

/** reset clears presented screens; the test harness calls it between checks. */
export function reset(): void {
  stack = []
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useStack(): readonly TaoScreen[] {
  return React.useSyncExternalStore(subscribe, () => stack, () => stack)
}

// A screen presented with an entity re-renders when that entity changes, without running a query.
function useDataRevision(): number {
  return React.useSyncExternalStore(subscribeAllData, dataRevision, dataRevision)
}

/**
 * Host renders the app's root view with any presented screens above it. Screens below the top stay
 * mounted but hidden, so returning to a screen finds the state it had when it was covered.
 */
export function Host(
  props: { root: React.ComponentType<Record<string, unknown>>; __tao?: unknown },
): React.ReactElement {
  const screens = useStack()
  useDataRevision()
  useAndroidBack(screens.length > 0)
  const Root = props.root
  // The app shell hands its child the root Tao props; every screen is an app root, so each level
  // receives them too.
  const rootProps = props.__tao === undefined ? {} : { __tao: props.__tao }
  const levels: React.ReactNode[] = [
    React.createElement(Root, { ...rootProps }),
    ...screens.map(screen => React.createElement(screen.view, { ...rootProps, ...screen.props })),
  ]
  // Every level sits in its own container so covering a screen only changes styling, never the
  // element tree; a remounted screen would silently lose its state.
  return React.createElement(
    React.Fragment,
    null,
    screens.length > 0 ? React.createElement(BackAffordance, { key: 'tao-back' }) : null,
    ...levels.map((level, index) =>
      React.createElement(Level, {
        key: `tao-level-${index}`,
        hidden: index !== levels.length - 1,
        children: level,
      })
    ),
  )
}

// A covered screen keeps its state but leaves the accessibility tree, so tests and screen readers
// only see the screen the user is actually on.
function Level(props: { hidden: boolean; children?: React.ReactNode }): React.ReactElement {
  const runtime = requireReactNativeRuntime()
  return React.createElement(runtime.View, {
    accessibilityElementsHidden: props.hidden,
    importantForAccessibility: props.hidden ? 'no-hide-descendants' : 'auto',
    style: props.hidden ? { display: 'none' } : undefined,
    children: props.children,
  })
}

// Every presented screen gets a back control, so `dismiss` is never the only way out.
function BackAffordance(): React.ReactElement {
  return Views.Pressable({ title: 'Back', action: { invoke: dismiss } }, {
    nativeProps: { accessibilityRole: 'button' },
  })
}

function useAndroidBack(enabled: boolean): void {
  React.useEffect(() => {
    const runtime = requireReactNativeRuntime()
    const backHandler = runtime.BackHandler
    if (!enabled || !backHandler) {
      return
    }
    const subscription = backHandler.addEventListener('hardwareBackPress', () => {
      dismiss()
      return true
    })
    return () => subscription?.remove?.()
  }, [enabled])
}

/** NavControls exposes the generated-code navigation runtime surface. */
export const NavControls = {
  depth,
  dismiss,
  Host,
  present,
  reset,
} as const
