import type { ReactNativeRuntime } from './TR-react-native'

export type TaoAccessibilityHost = {
  focus?(): void
}

/** TaoAccessibilityState is the interactive state one Tao surface reports to assistive technology. */
export type TaoAccessibilityState = Readonly<{
  busy?: boolean
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  selected?: boolean
}>

const accessibilityStateAttributes = {
  busy: 'aria-busy',
  checked: 'aria-checked',
  disabled: 'aria-disabled',
  expanded: 'aria-expanded',
  selected: 'aria-selected',
} as const

/**
 * accessibilityStateProps spells one accessibility state both ways a host may read it. React Native
 * reads `accessibilityState`; the web runtime drops that prop entirely and reads the matching
 * `aria-*` props instead, so a surface that spells the state only one way silently loses it on the
 * other platform. Both spellings describe the same state, and modern React Native accepts both.
 */
export function accessibilityStateProps(state: TaoAccessibilityState): Record<string, unknown> {
  return {
    accessibilityState: state,
    ...Object.fromEntries(
      Object.entries(state)
        .filter(([, value]) => value !== undefined)
        .map(([name, value]) => [accessibilityStateAttributes[name as keyof TaoAccessibilityState], value]),
    ),
  }
}

/** focusAccessibilityHost projects Tao attention through the public focus API each host supports. */
export function focusAccessibilityHost(
  runtime: ReactNativeRuntime,
  host: TaoAccessibilityHost | null,
): void {
  if (!host) {
    return
  }
  if (runtime.Platform?.OS === 'web' && typeof host.focus === 'function') {
    host.focus()
    return
  }
  if (runtime.AccessibilityInfo?.sendAccessibilityEvent) {
    runtime.AccessibilityInfo.sendAccessibilityEvent(host, 'focus')
    return
  }
  host.focus?.()
}
