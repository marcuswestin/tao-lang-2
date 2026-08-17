export type TaoImpactFeedback = 'heavy' | 'light' | 'medium' | 'rigid' | 'soft'
export type TaoNotificationFeedback = 'error' | 'success' | 'warning'

export type TaoFeedbackDriver = {
  ImpactFeedbackStyle: Record<'Heavy' | 'Light' | 'Medium' | 'Rigid' | 'Soft', unknown>
  NotificationFeedbackType: Record<'Error' | 'Success' | 'Warning', unknown>
  impactAsync(style: unknown): Promise<void>
  notificationAsync(type: unknown): Promise<void>
  selectionAsync(): Promise<void>
}

export type TaoFeedbackAction = {
  invoke(): Promise<void>
}

export type TaoFeedbackCompleteAction = {
  invoke(): void
}

let testDriver: TaoFeedbackDriver | undefined

/** Feedback exposes Expo Haptics-backed tactile feedback helpers. */
export const Feedback = {
  /** impact plays impact haptic feedback. */
  async impact(style: TaoImpactFeedback = 'medium'): Promise<void> {
    const driver = feedbackDriver()
    await driver.impactAsync(impactStyle(driver, style))
  },

  /** impactAction creates a Pressable-compatible impact feedback action. */
  impactAction(style?: TaoImpactFeedback, feedback?: TaoFeedbackCompleteAction): TaoFeedbackAction {
    return {
      async invoke() {
        await Feedback.impact(style)
        feedback?.invoke()
      },
    }
  },

  /** notification plays success, warning, or error haptic feedback. */
  async notification(type: TaoNotificationFeedback = 'success'): Promise<void> {
    const driver = feedbackDriver()
    await driver.notificationAsync(notificationType(driver, type))
  },

  /** notificationAction creates a Pressable-compatible notification feedback action. */
  notificationAction(type?: TaoNotificationFeedback, feedback?: TaoFeedbackCompleteAction): TaoFeedbackAction {
    return {
      async invoke() {
        await Feedback.notification(type)
        feedback?.invoke()
      },
    }
  },

  /** selection plays selection-change haptic feedback. */
  async selection(): Promise<void> {
    await feedbackDriver().selectionAsync()
  },

  /** selectionAction creates a Pressable-compatible selection feedback action. */
  selectionAction(feedback?: TaoFeedbackCompleteAction): TaoFeedbackAction {
    return {
      async invoke() {
        await Feedback.selection()
        feedback?.invoke()
      },
    }
  },

  /** feedbackAction adapts feedback completion into a Feedback-compatible action. */
  feedbackAction(work: () => void): TaoFeedbackCompleteAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** setDriverForTests replaces Expo Haptics for deterministic runtime tests. */
  setDriverForTests(driver?: TaoFeedbackDriver): void {
    testDriver = driver
  },
} as const

function feedbackDriver(): TaoFeedbackDriver {
  if (testDriver) {
    return testDriver
  }

  return require('expo-haptics') as TaoFeedbackDriver
}

function impactStyle(driver: TaoFeedbackDriver, style: TaoImpactFeedback): unknown {
  return {
    heavy: driver.ImpactFeedbackStyle.Heavy,
    light: driver.ImpactFeedbackStyle.Light,
    medium: driver.ImpactFeedbackStyle.Medium,
    rigid: driver.ImpactFeedbackStyle.Rigid,
    soft: driver.ImpactFeedbackStyle.Soft,
  }[style]
}

function notificationType(driver: TaoFeedbackDriver, type: TaoNotificationFeedback): unknown {
  return {
    error: driver.NotificationFeedbackType.Error,
    success: driver.NotificationFeedbackType.Success,
    warning: driver.NotificationFeedbackType.Warning,
  }[type]
}
