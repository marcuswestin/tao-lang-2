import TR from '@runtime/TR'
import { HapticKind } from './Haptic.tao'

/** The TypeScript side of `@tao/device/haptic`; Tao owns the complete public contract. */
export const Haptic = (): TR.Haptics => TR.Haptic(HapticKind)
