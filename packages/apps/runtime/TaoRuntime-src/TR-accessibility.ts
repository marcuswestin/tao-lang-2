import type { ReactNativeRuntime } from './TR-react-native'

export type TaoAccessibilityHost = {
  focus?(): void
}

type TaoAccessibilityActionEvent = Readonly<{ nativeEvent?: Readonly<{ actionName?: string }> }>
type TaoAccessibilityVerb = Readonly<{ identity: string; label: string }>

/** Merge generated verbs with actions a host control already exposes. */
export function accessibilityVerbProps(
  nativeProps: Record<string, unknown>,
  verbs: readonly TaoAccessibilityVerb[],
  invoke: (identity: string) => void,
): Record<string, unknown> {
  if (verbs.length === 0) {
    return nativeProps
  }
  const existingActions = Array.isArray(nativeProps['accessibilityActions'])
    ? nativeProps['accessibilityActions'] as readonly unknown[]
    : []
  const existingHandler = nativeProps['onAccessibilityAction']
  return {
    ...nativeProps,
    accessibilityActions: [
      ...existingActions,
      ...verbs.map(verb => ({ label: verb.label, name: `tao:${verb.identity}` })),
    ],
    onAccessibilityAction: (event: TaoAccessibilityActionEvent) => {
      const verb = verbs.find(candidate => `tao:${candidate.identity}` === event.nativeEvent?.actionName)
      if (verb) {
        invoke(verb.identity)
      } else if (typeof existingHandler === 'function') {
        ;(existingHandler as (event: TaoAccessibilityActionEvent) => void)(event)
      }
    },
  }
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
