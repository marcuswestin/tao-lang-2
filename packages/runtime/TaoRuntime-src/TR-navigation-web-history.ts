import React from 'react'
import type { RuntimeAppDefinition } from './TR-navigation-app'
import { requireReactNativeRuntime } from './TR-react-native'

type WebHistory = {
  go(delta: number): void
  pushState(data: unknown, unused: string): void
  replaceState(data: unknown, unused: string): void
}

type WebNavigationHost = {
  activate(): void
  token: symbol
}

type PopStateEvent = { state?: unknown }

const mountedHosts: WebNavigationHost[] = []
let activeHost: symbol | undefined

/** useWebNavigationHistory mirrors semantic app depth into same-URL browser entries. */
export function useWebNavigationHistory(app: RuntimeAppDefinition): void {
  const token = React.useRef(Symbol('Tao web navigation host'))
  const depth = app.historyDepth()
  const currentDepth = React.useRef(depth)
  currentDepth.current = depth
  const previousDepth = React.useRef(depth)
  const suppressedPopCount = React.useRef(0)
  const global_ = globalThis as {
    addEventListener?: (name: string, listener: (event: PopStateEvent) => void) => void
    history?: WebHistory
    removeEventListener?: (name: string, listener: (event: PopStateEvent) => void) => void
  }
  const enabled = requireReactNativeRuntime().Platform?.OS === 'web' && global_.history !== undefined

  React.useEffect(() => {
    if (!enabled || !global_.history) {
      return
    }
    const host: WebNavigationHost = {
      activate: () => {
        suppressedPopCount.current = 0
        previousDepth.current = currentDepth.current
        global_.history?.replaceState(historyState(currentDepth.current), '')
      },
      token: token.current,
    }
    mountedHosts.push(host)
    activateHost(host)
    const onPopState = (event: PopStateEvent) => {
      if (activeHost !== token.current) {
        return
      }
      if (suppressedPopCount.current > 0) {
        suppressedPopCount.current -= 1
        return
      }
      const targetDepth = stateDepth(event.state)
      const appDepth = app.historyDepth()
      if (targetDepth !== undefined && targetDepth > appDepth) {
        // Tao intentionally has no restoration/redo contract yet. A browser Forward therefore
        // returns to the current semantic cursor instead of incorrectly dispatching another Back.
        suppressedPopCount.current += 1
        global_.history?.go(appDepth - targetDepth)
        return
      }
      const backCount = targetDepth === undefined ? 1 : Math.max(0, appDepth - targetDepth)
      for (let index = 0; index < backCount && app.back(); index++) {
        // Consume the semantic entries represented by the browser cursor's target depth.
      }
      previousDepth.current = app.historyDepth()
      global_.history?.replaceState(historyState(previousDepth.current), '')
    }
    global_.addEventListener?.('popstate', onPopState)
    return () => {
      global_.removeEventListener?.('popstate', onPopState)
      unregisterHost(host)
    }
  }, [app, enabled])

  React.useEffect(() => {
    const history = global_.history
    if (!enabled || !history || activeHost !== token.current) {
      previousDepth.current = depth
      return
    }
    const delta = depth - previousDepth.current
    if (delta > 0) {
      for (let index = 0; index < delta; index++) {
        history.pushState(historyState(previousDepth.current + index + 1), '')
      }
    } else if (delta < 0) {
      // A Tao/header/hardware Back happened first. Move the browser cursor over its stale entries,
      // and suppress the resulting popstate because semantics have already been reduced.
      suppressedPopCount.current += 1
      history.go(delta)
    } else {
      history.replaceState(historyState(depth), '')
    }
    previousDepth.current = depth
  }, [depth, enabled])
}

function historyState(depth: number): Readonly<{ __taoNavigationDepth: number }> {
  return Object.freeze({ __taoNavigationDepth: depth })
}

function stateDepth(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null) {
    return undefined
  }
  const depth = (state as { __taoNavigationDepth?: unknown }).__taoNavigationDepth
  return typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 0 ? depth : undefined
}

function activateHost(host: WebNavigationHost): void {
  activeHost = host.token
  host.activate()
}

function unregisterHost(host: WebNavigationHost): void {
  const index = mountedHosts.indexOf(host)
  if (index >= 0) {
    mountedHosts.splice(index, 1)
  }
  if (activeHost !== host.token) {
    return
  }
  const next = mountedHosts.at(-1)
  if (next) {
    activateHost(next)
  } else {
    activeHost = undefined
  }
}
