import { Switch } from '@shared/core'

export type TaoAccessibilityEntry =
  | readonly ['id', string]
  | readonly ['label', string]
  | readonly ['role', string]

export type TaoAccessibilityProps = {
  readonly entries: readonly TaoAccessibilityEntry[]
}

/** AccessibilityControls exposes generated-code accessibility metadata helpers. */
export const AccessibilityControls = {
  create,
} as const

/** AccessibilityRuntime exposes native prop lowering for Tao accessibility metadata. */
export const AccessibilityRuntime = {
  nativeProps,
} as const

function create(entries: readonly TaoAccessibilityEntry[]): TaoAccessibilityProps {
  return { entries }
}

function nativeProps(accessibility: TaoAccessibilityProps | undefined): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [head, value] of accessibility?.entries ?? []) {
    Object.assign(props, nativePropsForEntry(head, value))
  }
  return props
}

function nativePropsForEntry(head: TaoAccessibilityEntry[0], value: string): Record<string, unknown> {
  return Switch(head, {
    id: () => ({ nativeID: value, testID: value }),
    label: () => ({ accessibilityLabel: value }),
    role: () => ({ accessibilityRole: value }),
  })
}
