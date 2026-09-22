import React from 'react'
import { createElement } from './TR-create-element'
import { requireReactNativeRuntime } from './TR-react-native'

/**
 * A window layer is the edge-to-edge layer one window keeps above its own content. The app host
 * keeps one for the root window and a native Modal keeps one for the window it presents, so the
 * nearest layer is always the window a surface is actually shown in. A surface that must cover that
 * whole window — an ask, whose scrim dims everything behind the asked view — renders through the
 * nearest layer rather than in place: in place may be inside a scroll frame that already padded the
 * window edges away, where an absolutely positioned view covers the padded content box and not the
 * window. Rendering through the layer moves the React subtree, not just its pixels, so a surface
 * placed here reads the layer's context — no enclosing frame, the window's own safe-area provider —
 * rather than its presenter's.
 */
export class WindowLayerRegistry {
  private readonly entries = new Map<string, React.ReactNode>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  /** set places or replaces one surface; a replaced surface keeps its place in the stacking order. */
  set(id: string, node: React.ReactNode): void {
    this.entries.set(id, node)
    this.emit()
  }

  remove(id: string): void {
    if (this.entries.delete(id)) {
      this.emit()
    }
  }

  /** contents lists the placed surfaces in stacking order, the first placed at the bottom. */
  contents(): React.ReactNode[] {
    return [...this.entries].map(([id, node]) => createElement(React.Fragment, { key: id }, node))
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const ReactWindowLayerContext = React.createContext<WindowLayerRegistry | undefined>(undefined)

/** WindowLayerProvider makes one window's layer the nearest one for everything rendered inside it. */
export function WindowLayerProvider(props: {
  children?: React.ReactNode
  registry: WindowLayerRegistry
}): React.ReactElement {
  return createElement(ReactWindowLayerContext.Provider, { value: props.registry }, props.children)
}

/**
 * WindowLayer draws the placed surfaces over the window. The window's host renders it as a sibling
 * of its content, at the height in the stacking order the window gives such surfaces. It draws
 * nothing while no surface is placed, so it never stands between a touch and the content.
 */
export function WindowLayer(props: { registry: WindowLayerRegistry }): React.ReactNode {
  const runtime = requireReactNativeRuntime()
  React.useSyncExternalStore(props.registry.subscribe, props.registry.snapshot, props.registry.snapshot)
  const children = props.registry.contents()
  return children.length === 0 ? null : createElement(runtime.View, { children, style: windowLayerStyle })
}

/**
 * WindowLayerPortal renders its children in the nearest window layer, and in place when there is
 * none — a navigator rendered without an app host keeps its surfaces where they are. Placement is a
 * layout effect, so the layer shows the surface in the frame the presenter first rendered it in.
 */
export function WindowLayerPortal(props: { children: React.ReactNode }): React.ReactNode {
  const registry = React.useContext(ReactWindowLayerContext)
  const id = React.useId()
  React.useLayoutEffect(() => {
    registry?.set(id, props.children)
  }, [id, props.children, registry])
  React.useLayoutEffect(() => () => registry?.remove(id), [id, registry])
  return registry ? null : props.children
}

const windowLayerStyle = {
  bottom: 0,
  left: 0,
  pointerEvents: 'box-none',
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 1,
} as const
