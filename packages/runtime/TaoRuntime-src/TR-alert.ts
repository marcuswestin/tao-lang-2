export type TaoAlertButton = {
  onPress?: () => void
  style?: 'cancel' | 'default' | 'destructive'
  text: string
}

export type TaoAlertOptions = {
  cancelable?: boolean
}

export type TaoAlertDriver = {
  alert(title: string, message?: string, buttons?: TaoAlertButton[], options?: TaoAlertOptions): void
}

export type TaoAlertAction = {
  invoke(): void
}

export type TaoAlertConfirmAction = {
  invoke(): void
}

let testDriver: TaoAlertDriver | undefined

/** Alert exposes React Native app alert helpers. */
export const Alert = {
  /** confirm shows a native confirmation alert with cancel and confirm buttons. */
  confirm(
    title: string,
    message: string,
    confirm: TaoAlertConfirmAction,
    options?: { cancelText?: string; confirmText?: string; destructive?: boolean },
  ): void {
    alertDriver().alert(title, message, [
      { text: options?.cancelText ?? 'Cancel', style: 'cancel' },
      {
        text: options?.confirmText ?? 'OK',
        style: options?.destructive ? 'destructive' : 'default',
        onPress: () => confirm.invoke(),
      },
    ])
  },

  /** confirmAction creates a Pressable-compatible action that shows a confirmation alert. */
  confirmAction(
    title: string,
    message: string,
    confirm: TaoAlertConfirmAction,
    options?: { cancelText?: string; confirmText?: string; destructive?: boolean },
  ): TaoAlertAction {
    return {
      invoke() {
        Alert.confirm(title, message, confirm, options)
      },
    }
  },

  /** confirmedAction adapts alert confirmation into an Alert-compatible action. */
  confirmedAction(work: () => void): TaoAlertConfirmAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** message shows a native informational alert. */
  message(title: string, message?: string): void {
    alertDriver().alert(title, message)
  },

  /** messageAction creates a Pressable-compatible action that shows an informational alert. */
  messageAction(title: string, message?: string): TaoAlertAction {
    return {
      invoke() {
        Alert.message(title, message)
      },
    }
  },

  /** setDriverForTests replaces React Native Alert for deterministic runtime tests. */
  setDriverForTests(driver?: TaoAlertDriver): void {
    testDriver = driver
  },
} as const

function alertDriver(): TaoAlertDriver {
  if (testDriver) {
    return testDriver
  }

  const RN = require('react-native') as { Alert: TaoAlertDriver }
  return RN.Alert
}
