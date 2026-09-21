import { type TaoActionFactory, type TaoActionValue, type TaoEvaluable } from './TR-action-values'

/** EnumIdentity is the opaque identity behind one Tao `one of` case. */
type EnumIdentity = Readonly<{ identity: symbol }>

type HapticKindName = 'Error' | 'Heavy' | 'Light' | 'Medium' | 'Selection' | 'Success' | 'Warning'

/** TaoHapticKinds carries the exact declaration-owned identities Haptic is allowed to dispatch. */
export type TaoHapticKinds = Readonly<Record<HapticKindName, TaoEvaluable<EnumIdentity>>>

/** TaoHaptics is the runtime value returned by `@tao/device/haptic`'s `Haptic()`. */
export type TaoHaptics = Readonly<{
  Play: TaoActionValue<[TaoEvaluable<EnumIdentity>]>
}>

/** NativeModulesLike is the narrow optional-module kernel contract Haptic needs. */
type NativeModulesLike = {
  optional<ModuleT>(capability: string, moduleName: 'expo-haptics'): ModuleT | undefined
  platform(): string | undefined
}

/** ExpoHaptics is the supported subset of `expo-haptics`; no vendor type escapes this module. */
type ExpoHaptics = {
  readonly ImpactFeedbackStyle?: Readonly<{
    Heavy?: unknown
    Light?: unknown
    Medium?: unknown
  }>
  readonly NotificationFeedbackType?: Readonly<{
    Error?: unknown
    Success?: unknown
    Warning?: unknown
  }>
  impactAsync?(style: unknown): Promise<unknown>
  notificationAsync?(type: unknown): Promise<unknown>
  selectionAsync?(): Promise<unknown>
}

/**
 * Creates the semantic Haptic value. Module lookup stays inside Play so importing or constructing
 * the stdlib value never touches Expo, and a missing or incomplete implementation is a clean no-op.
 */
export function createHaptic(
  kinds: TaoHapticKinds,
  asAction: TaoActionFactory,
  nativeModules: NativeModulesLike,
): TaoHaptics {
  return Object.freeze({
    Play: asAction(async (kind: TaoEvaluable<EnumIdentity>) => {
      if (nativeModules.platform() === 'web') {
        return
      }
      const haptics = nativeModules.optional<ExpoHaptics>('Haptic', 'expo-haptics')
      if (!haptics) {
        return
      }
      const selected = kind.evaluate().jsValue
      if (isKind(selected, kinds.Selection)) {
        await haptics.selectionAsync?.()
        return
      }
      const impact = impactStyle(haptics, kinds, selected)
      if (impact.matched) {
        if (impact.value !== undefined) {
          await haptics.impactAsync?.(impact.value)
        }
        return
      }
      const notification = notificationType(haptics, kinds, selected)
      if (notification !== undefined) {
        await haptics.notificationAsync?.(notification)
      }
    }),
  })
}

function impactStyle(
  haptics: ExpoHaptics,
  kinds: TaoHapticKinds,
  selected: EnumIdentity,
): { matched: boolean; value?: unknown } {
  if (isKind(selected, kinds.Light)) {
    return { matched: true, value: haptics.ImpactFeedbackStyle?.Light }
  }
  if (isKind(selected, kinds.Medium)) {
    return { matched: true, value: haptics.ImpactFeedbackStyle?.Medium }
  }
  if (isKind(selected, kinds.Heavy)) {
    return { matched: true, value: haptics.ImpactFeedbackStyle?.Heavy }
  }
  return { matched: false }
}

function notificationType(
  haptics: ExpoHaptics,
  kinds: TaoHapticKinds,
  selected: EnumIdentity,
): unknown {
  if (isKind(selected, kinds.Success)) {
    return haptics.NotificationFeedbackType?.Success
  }
  if (isKind(selected, kinds.Warning)) {
    return haptics.NotificationFeedbackType?.Warning
  }
  if (isKind(selected, kinds.Error)) {
    return haptics.NotificationFeedbackType?.Error
  }
  return undefined
}

function isKind(selected: EnumIdentity, expected: TaoEvaluable<EnumIdentity>): boolean {
  return Object.is(selected, expected.evaluate().jsValue)
}
