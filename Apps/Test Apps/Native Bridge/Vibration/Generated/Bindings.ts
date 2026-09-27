// Generated from public native API declarations. Regenerate instead of editing.

const native = (): typeof import('react-native') => require('react-native')

export function Cancel(): void {
  return native()['Vibration']['cancel']()
}

export function Vibrate(argument0: number | Array<number> | null, argument1: boolean | null): void {
  if (argument0 === null && argument1 === null) {
    return native()['Vibration']['vibrate']()
  }
  if (argument1 === null) {
    return native()['Vibration']['vibrate'](argument0 === null ? undefined : argument0)
  }
  return native()['Vibration']['vibrate'](
    argument0 === null ? undefined : argument0,
    argument1 === null ? undefined : argument1,
  )
}
