import React from 'react'
import { DataControls } from './TR-data'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

type Evaluable = {
  evaluate(): { jsValue: unknown }
}

export type TaoNavigationArguments = Record<string, Evaluable>

export type TaoNavigationDestination = {
  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode
}

export type TaoNavigationStackDefinition = {
  destinations: Record<string, TaoNavigationDestination>
  initial: string
  name: string
}

type NavigationEntry = {
  arguments: TaoNavigationArguments
  destination: string
  instanceId: number
}

const stacks = new Set<RuntimeNavigationStack>()
let activeStack: RuntimeNavigationStack | undefined

/** NavigationControls is the deterministic generated-code API for Tao stack navigation. */
export const NavigationControls = {
  Stack(definition: TaoNavigationStackDefinition): RuntimeNavigationStack {
    const stack = new RuntimeNavigationStack(definition)
    stacks.add(stack)
    return stack
  },

  Host: NavigationHost,

  Present(
    stack: RuntimeNavigationStack,
    destination: string,
    arguments_: TaoNavigationArguments,
  ): void {
    stack.present(destination, arguments_)
  },

  Back(stack?: RuntimeNavigationStack): boolean {
    return (stack ?? activeStack)?.back() ?? false
  },

  /** beginTest resets cached generated stacks before each Tao behavior check. */
  beginTest(): void {
    activeStack = undefined
    for (const stack of stacks) {
      stack.reset()
    }
  },
} as const

export type TaoNavigationStack = RuntimeNavigationStack

/** RuntimeNavigationStack owns one ordered navigation history. */
class RuntimeNavigationStack {
  private entries: NavigationEntry[]
  private listeners = new Set<() => void>()
  private nextEntryId = 1
  private version = 0

  constructor(readonly definition: TaoNavigationStackDefinition) {
    if (!definition.destinations[definition.initial]) {
      throw new Error(`Navigation stack ${definition.name} has no initial destination '${definition.initial}'.`)
    }
    this.entries = [this.initialEntry()]
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  get currentDestination(): string {
    return this.currentEntry().destination
  }

  get depth(): number {
    return this.entries.length
  }

  present(destination: string, arguments_: TaoNavigationArguments): void {
    if (!this.definition.destinations[destination]) {
      throw new Error(`Navigation stack ${this.definition.name} has no destination '${destination}'.`)
    }
    this.entries.push({
      arguments: { ...arguments_ },
      destination,
      instanceId: this.nextEntryId++,
    })
    this.emit()
  }

  /** back pops one entry and reports whether the platform back event was consumed. */
  back(): boolean {
    if (this.entries.length === 1) {
      return false
    }
    this.entries.pop()
    this.emit()
    return true
  }

  reset(): void {
    this.entries = [this.initialEntry()]
    this.emit()
  }

  render(taoProps?: TaoProps): React.ReactNode {
    return this.entries.map((entry, index) =>
      React.createElement(NavigationLevel, {
        children: this.definition.destinations[entry.destination]!.render(entry.arguments, taoProps),
        hidden: index !== this.entries.length - 1,
        key: entry.instanceId,
      })
    )
  }

  private currentEntry(): NavigationEntry {
    return this.entries[this.entries.length - 1]!
  }

  private initialEntry(): NavigationEntry {
    return {
      arguments: {},
      destination: this.definition.initial,
      instanceId: this.nextEntryId++,
    }
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function NavigationHost(props: { stack: RuntimeNavigationStack; __tao?: TaoProps }): React.JSX.Element {
  React.useSyncExternalStore(props.stack.subscribe, props.stack.snapshot, props.stack.snapshot)
  React.useSyncExternalStore(DataControls.subscribeAll, DataControls.revision, DataControls.revision)
  React.useEffect(() => {
    activeStack = props.stack
    const subscription = requireReactNativeRuntime().BackHandler?.addEventListener(
      'hardwareBackPress',
      () => NavigationControls.Back(props.stack),
    )
    return () => {
      subscription?.remove()
      if (activeStack === props.stack) {
        activeStack = undefined
      }
    }
  }, [props.stack])
  return React.createElement(
    React.Fragment,
    null,
    props.stack.depth > 1
      ? React.createElement(NavigationBackAffordance, { stack: props.stack })
      : null,
    props.stack.render(props.__tao),
  )
}

/** NavigationLevel hides covered entries without unmounting their local React state. */
function NavigationLevel(props: { children?: React.ReactNode; hidden: boolean }): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return React.createElement(runtime.View, {
    accessibilityElementsHidden: props.hidden,
    children: props.children,
    importantForAccessibility: props.hidden ? 'no-hide-descendants' : 'auto',
    style: props.hidden ? { display: 'none' } : undefined,
  })
}

/** NavigationBackAffordance exposes the same root-safe reducer through an accessible control. */
function NavigationBackAffordance(props: { stack: RuntimeNavigationStack }): React.JSX.Element {
  return Views.Pressable(
    { action: { invoke: () => NavigationControls.Back(props.stack) }, title: 'Back' },
    { nativeProps: { accessibilityLabel: 'Back', accessibilityRole: 'button' } },
  )
}
