/** HostSessionTarget is the machine resource a host driver serializes when it mutates a shared target. */
export type HostSessionTarget =
  | Readonly<{ id: string; kind: 'androidEmulator' }>
  | Readonly<{ id: string; kind: 'browserContext' }>
  | Readonly<{ id: string; kind: 'iosDevice' }>
  | Readonly<{ id: string; kind: 'iosSimulator' }>

/** hostSessionTargetLeaseName gives every driver the same machine-wide lease namespace for its target. */
export function hostSessionTargetLeaseName(target: HostSessionTarget): string {
  return Switch.kind<HostSessionTarget, string>(target, {
    androidEmulator: next => `android-emulator:${next.id}`,
    browserContext: next => `browser-context:${next.id}`,
    iosDevice: next => `ios-device:${next.id}`,
    iosSimulator: next => `ios-simulator:${next.id}`,
  })
}
import { Switch } from '@shared'
