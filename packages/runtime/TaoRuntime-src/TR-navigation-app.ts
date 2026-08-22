import React from 'react'
import type { TaoDesign } from './TR-design'
import type {
  TaoAppDeclaration,
  TaoAppDefinition,
  TaoConfiguredNavigation,
  TaoNavigationArguments,
  TaoNavigationInput,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import {
  createAppDeclaration,
  isConfiguredNavigation,
  mountConfiguredNavigation,
} from './TR-navigation-configuration'
import type { PresentableEntry, Subscription } from './TR-navigation-state'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'

type ToastEntry = PresentableEntry & {
  key: string
  timeout: ReturnType<typeof setTimeout>
}

/** RuntimeAppDefinition lazily resolves app nav factories after generated module initialization. */
export class RuntimeAppDefinition implements Subscription {
  private auxiliariesValue: Record<string, TaoNavigationValue> | undefined
  private descriptorMounts = new Map<TaoConfiguredNavigation, TaoNavigationValue>()
  private designValue: TaoDesign | undefined
  private listeners = new Set<() => void>()
  private nextToastEntryId = 1
  private navigatorValue: TaoNavigationValue | undefined
  private replacement: TaoNavigationValue | undefined
  private toastEntries = new Map<string, ToastEntry>()
  private version = 0

  readonly declaration: TaoAppDeclaration

  constructor(readonly definition: TaoAppDefinition) {
    this.declaration = definition.declaration ?? createAppDeclaration(definition.name)
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  get navigator(): TaoNavigationValue {
    return this.replacement ?? (this.navigatorValue ??= this.mount(this.definition.navigator()))
  }

  get auxiliaries(): Record<string, TaoNavigationValue> {
    return this.auxiliariesValue ??= Object.fromEntries(
      Object.entries(this.definition.auxiliaries()).map(([key, value]) => [key, this.mount(value)]),
    )
  }

  /** design lazily resolves this mounted app's declaration-local design without a global registry. */
  get design(): TaoDesign | undefined {
    return this.designValue ??= this.definition.design?.()
  }

  replace(navigator: TaoNavigationInput): void {
    this.replacement = this.mount(navigator)
    this.emit()
  }

  /** resolve returns the mounted occurrence owned by this app for one descriptor identity. */
  resolve(configured: TaoConfiguredNavigation): TaoNavigationValue | undefined {
    // Force lazy app configuration before resolving a target nested in its root or auxiliaries.
    void this.navigator
    void this.auxiliaries
    return this.descriptorMounts.get(configured)
  }

  presentToast(
    key: string,
    durationSeconds: number,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    const existing = this.toastEntries.get(key)
    if (existing) {
      clearTimeout(existing.timeout)
    }
    const entry: ToastEntry = {
      arguments: { ...arguments_ },
      instanceId: this.nextToastEntryId++,
      key,
      presentable,
      timeout: setTimeout(() => this.expireToast(key, entry), durationSeconds * 1000),
    }
    this.toastEntries.set(key, entry)
    this.emit()
  }

  renderToasts(taoProps?: TaoProps): React.ReactNode {
    const runtime = requireReactNativeRuntime()
    return [...this.toastEntries.values()].map(entry =>
      // A toast is transient, so it carries its own surface rather than relying on the app's
      // background: bare text over arbitrary content is not reliably legible.
      React.createElement(
        runtime.View,
        { key: entry.instanceId, style: toastSurfaceStyle },
        entry.presentable.render(entry.arguments, { ...taoProps, app: this }),
      )
    )
  }

  back(): boolean {
    for (const auxiliary of Object.values(this.auxiliaries).toReversed()) {
      if (auxiliary.back()) {
        return true
      }
    }
    return this.navigator.back()
  }

  get canGoBack(): boolean {
    return Object.values(this.auxiliaries).some(auxiliary => auxiliary.canGoBack)
      || this.navigator.canGoBack
  }

  reset(): void {
    this.replacement = undefined
    for (const entry of this.toastEntries.values()) {
      clearTimeout(entry.timeout)
    }
    this.toastEntries.clear()
    this.navigatorValue?.reset()
    for (const auxiliary of Object.values(this.auxiliariesValue ?? {})) {
      auxiliary.reset()
    }
    this.emit()
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }

  private mount(input: TaoNavigationInput): TaoNavigationValue {
    return isConfiguredNavigation(input)
      ? mountConfiguredNavigation(input, (configured, mount) => this.descriptorMounts.set(configured, mount))
      : input
  }

  private expireToast(key: string, entry: ToastEntry): void {
    if (this.toastEntries.get(key) !== entry) {
      return
    }
    this.toastEntries.delete(key)
    this.emit()
  }
}

const toastSurfaceStyle = {
  alignSelf: 'center',
  backgroundColor: '#121826',
  borderRadius: 10,
  elevation: 6,
  marginTop: 8,
  maxWidth: 480,
  paddingHorizontal: 16,
  paddingVertical: 12,
  shadowColor: '#000000',
  shadowOffset: { height: 4, width: 0 },
  shadowOpacity: 0.3,
  shadowRadius: 12,
} as const
