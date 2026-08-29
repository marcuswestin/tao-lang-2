/**
 * The platform hosts behind `@tao/ui/native`. Each is required lazily and optionally: a bundle that
 * excludes one, a platform that has none, and the Jest harness all keep working, because a missing
 * host resolves to `undefined` and the component that wanted it renders its portable equivalent.
 *
 * Nothing here is Tao semantics — these are the modules a native implementation reaches for.
 */

import type React from 'react'

/** HostComponent is a platform component a native implementation renders directly. */
export type HostComponent = React.ComponentType<any>

type Host = Record<string, unknown> | undefined

const cache = new Map<string, Host>()

function host(moduleName: string): Host {
  if (!cache.has(moduleName)) {
    try {
      cache.set(moduleName, require(moduleName) as Record<string, unknown>)
    } catch {
      cache.set(moduleName, undefined)
    }
  }
  return cache.get(moduleName)
}

function componentFrom(moduleName: string, ...names: readonly string[]): HostComponent | undefined {
  const module = host(moduleName)
  if (!module) {
    return undefined
  }
  for (const name of names) {
    const candidate = module[name]
    if (candidate) {
      return candidate as HostComponent
    }
  }
  return undefined
}

/** NativeHosts resolves each optional platform component, or nothing where it is unavailable. */
export const NativeHosts = {
  /** Slider is the platform's continuous value control. */
  Slider(): HostComponent | undefined {
    return componentFrom('@react-native-community/slider', 'default', 'Slider')
  },

  /** DateTimePicker is the platform's own date and time wheel or calendar. */
  DateTimePicker(): HostComponent | undefined {
    return componentFrom('@react-native-community/datetimepicker', 'default', 'DateTimePicker')
  },

  /** Picker is the platform's selection control: a wheel on iOS, a dropdown on Android. */
  Picker(): { Picker: HostComponent; Item: HostComponent } | undefined {
    const module = host('@react-native-picker/picker')
    const picker = module?.['Picker'] as (HostComponent & { Item?: HostComponent }) | undefined
    return picker?.Item ? { Item: picker.Item, Picker: picker } : undefined
  },

  /** SegmentedControl is the iOS segmented control; Android has no system equivalent. */
  SegmentedControl(): HostComponent | undefined {
    return componentFrom('@react-native-segmented-control/segmented-control', 'default', 'SegmentedControl')
  },
} as const
