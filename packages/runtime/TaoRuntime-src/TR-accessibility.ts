import type { ReactNativeRuntime } from './TR-react-native'

export type TaoAccessibilityHost = {
  focus?(): void
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
