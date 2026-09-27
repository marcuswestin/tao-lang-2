// Generated from public native API declarations. Regenerate instead of editing.

import { AndroidHaptics, ImpactFeedbackStyle, NotificationFeedbackType } from './Bindings.tao'

const native = (): typeof import('expo-haptics') => require('expo-haptics')

function toAndroidHaptics(value: unknown): import('expo-haptics').AndroidHaptics {
  if (Object.is(value, AndroidHaptics.Confirm.evaluate().jsValue)) {
    return native().AndroidHaptics.Confirm
  }
  if (Object.is(value, AndroidHaptics.Reject.evaluate().jsValue)) {
    return native().AndroidHaptics.Reject
  }
  if (Object.is(value, AndroidHaptics.Gesture_Start.evaluate().jsValue)) {
    return native().AndroidHaptics.Gesture_Start
  }
  if (Object.is(value, AndroidHaptics.Gesture_End.evaluate().jsValue)) {
    return native().AndroidHaptics.Gesture_End
  }
  if (Object.is(value, AndroidHaptics.Toggle_On.evaluate().jsValue)) {
    return native().AndroidHaptics.Toggle_On
  }
  if (Object.is(value, AndroidHaptics.Toggle_Off.evaluate().jsValue)) {
    return native().AndroidHaptics.Toggle_Off
  }
  if (Object.is(value, AndroidHaptics.Clock_Tick.evaluate().jsValue)) {
    return native().AndroidHaptics.Clock_Tick
  }
  if (Object.is(value, AndroidHaptics.Context_Click.evaluate().jsValue)) {
    return native().AndroidHaptics.Context_Click
  }
  if (Object.is(value, AndroidHaptics.Drag_Start.evaluate().jsValue)) {
    return native().AndroidHaptics.Drag_Start
  }
  if (Object.is(value, AndroidHaptics.Keyboard_Tap.evaluate().jsValue)) {
    return native().AndroidHaptics.Keyboard_Tap
  }
  if (Object.is(value, AndroidHaptics.Keyboard_Press.evaluate().jsValue)) {
    return native().AndroidHaptics.Keyboard_Press
  }
  if (Object.is(value, AndroidHaptics.Keyboard_Release.evaluate().jsValue)) {
    return native().AndroidHaptics.Keyboard_Release
  }
  if (Object.is(value, AndroidHaptics.Long_Press.evaluate().jsValue)) {
    return native().AndroidHaptics.Long_Press
  }
  if (Object.is(value, AndroidHaptics.Virtual_Key.evaluate().jsValue)) {
    return native().AndroidHaptics.Virtual_Key
  }
  if (Object.is(value, AndroidHaptics.Virtual_Key_Release.evaluate().jsValue)) {
    return native().AndroidHaptics.Virtual_Key_Release
  }
  if (Object.is(value, AndroidHaptics.No_Haptics.evaluate().jsValue)) {
    return native().AndroidHaptics.No_Haptics
  }
  if (Object.is(value, AndroidHaptics.Segment_Tick.evaluate().jsValue)) {
    return native().AndroidHaptics.Segment_Tick
  }
  if (Object.is(value, AndroidHaptics.Segment_Frequent_Tick.evaluate().jsValue)) {
    return native().AndroidHaptics.Segment_Frequent_Tick
  }
  if (Object.is(value, AndroidHaptics.Text_Handle_Move.evaluate().jsValue)) {
    return native().AndroidHaptics.Text_Handle_Move
  }
  throw new TypeError('Expected a declared AndroidHaptics case.')
}

function toImpactFeedbackStyle(value: unknown): import('expo-haptics').ImpactFeedbackStyle {
  if (Object.is(value, ImpactFeedbackStyle.Light.evaluate().jsValue)) {
    return native().ImpactFeedbackStyle.Light
  }
  if (Object.is(value, ImpactFeedbackStyle.Medium.evaluate().jsValue)) {
    return native().ImpactFeedbackStyle.Medium
  }
  if (Object.is(value, ImpactFeedbackStyle.Heavy.evaluate().jsValue)) {
    return native().ImpactFeedbackStyle.Heavy
  }
  if (Object.is(value, ImpactFeedbackStyle.Soft.evaluate().jsValue)) {
    return native().ImpactFeedbackStyle.Soft
  }
  if (Object.is(value, ImpactFeedbackStyle.Rigid.evaluate().jsValue)) {
    return native().ImpactFeedbackStyle.Rigid
  }
  throw new TypeError('Expected a declared ImpactFeedbackStyle case.')
}

function toNotificationFeedbackType(value: unknown): import('expo-haptics').NotificationFeedbackType {
  if (Object.is(value, NotificationFeedbackType.Success.evaluate().jsValue)) {
    return native().NotificationFeedbackType.Success
  }
  if (Object.is(value, NotificationFeedbackType.Warning.evaluate().jsValue)) {
    return native().NotificationFeedbackType.Warning
  }
  if (Object.is(value, NotificationFeedbackType.Error.evaluate().jsValue)) {
    return native().NotificationFeedbackType.Error
  }
  throw new TypeError('Expected a declared NotificationFeedbackType case.')
}

export function ImpactAsync(argument0: unknown | null): Promise<void> {
  if (argument0 === null) {
    return native()['impactAsync']()
  }
  return native()['impactAsync'](argument0 === null ? undefined : toImpactFeedbackStyle(argument0))
}

export function NotificationAsync(argument0: unknown | null): Promise<void> {
  if (argument0 === null) {
    return native()['notificationAsync']()
  }
  return native()['notificationAsync'](argument0 === null ? undefined : toNotificationFeedbackType(argument0))
}

export function PerformAndroidHapticsAsync(argument0: unknown): Promise<void> {
  return native()['performAndroidHapticsAsync'](toAndroidHaptics(argument0))
}

export function SelectionAsync(): Promise<void> {
  return native()['selectionAsync']()
}
