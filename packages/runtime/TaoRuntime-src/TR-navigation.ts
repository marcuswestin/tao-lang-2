import React from 'react'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

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
}

const stacks = new Set<RuntimeNavigationStack>()

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

  Back(stack: RuntimeNavigationStack): void {
    stack.back()
  },

  /** beginTest resets cached generated stacks before each Tao behavior check. */
  beginTest(): void {
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
  private version = 0

  constructor(readonly definition: TaoNavigationStackDefinition) {
    if (!definition.destinations[definition.initial]) {
      throw new Error(`Navigation stack ${definition.name} has no initial destination '${definition.initial}'.`)
    }
    this.entries = [initialEntry(definition)]
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
    this.entries.push({ destination, arguments: { ...arguments_ } })
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
    this.entries = [initialEntry(this.definition)]
    this.emit()
  }

  render(taoProps?: TaoProps): React.ReactNode {
    const entry = this.currentEntry()
    return this.definition.destinations[entry.destination]!.render(entry.arguments, taoProps)
  }

  private currentEntry(): NavigationEntry {
    return this.entries[this.entries.length - 1]!
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
  React.useEffect(() => {
    const subscription = requireReactNativeRuntime().BackHandler?.addEventListener(
      'hardwareBackPress',
      () => props.stack.back(),
    )
    return () => subscription?.remove()
  }, [props.stack])
  return React.createElement(React.Fragment, null, props.stack.render(props.__tao))
}

function initialEntry(definition: TaoNavigationStackDefinition): NavigationEntry {
  return { destination: definition.initial, arguments: {} }
}
