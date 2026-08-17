export type TaoActionSheetIOSOptions = {
  cancelButtonIndex?: number
  destructiveButtonIndex?: number | readonly number[]
  disabledButtonIndices?: readonly number[]
  message?: string
  options: readonly string[]
  title?: string
}

export type TaoShareActionSheetIOSOptions = {
  excludedActivityTypes?: readonly string[]
  message?: string
  subject?: string
  url?: string
}

export type TaoActionSheetIOSSelection = {
  buttonIndex: number
  canceled: boolean
}

export type TaoShareActionSheetIOSResult = {
  activityType?: string
  completed: boolean
}

export type TaoActionSheetIOSAction = {
  invoke(): Promise<TaoActionSheetIOSSelection>
}

export type TaoActionSheetIOSChosenAction = {
  invoke(selection: TaoActionSheetIOSSelection): void
}

export type TaoActionSheetIOSDriver = {
  showActionSheetWithOptions(options: TaoActionSheetIOSOptions, callback: (buttonIndex: number) => void): void
  showShareActionSheetWithOptions(
    options: TaoShareActionSheetIOSOptions,
    failureCallback: (error: Error) => void,
    successCallback: (success: boolean, activityType?: string) => void,
  ): void
}

let testDriver: TaoActionSheetIOSDriver | undefined

/** ActionSheetIOS exposes React Native iOS action-sheet helpers. */
export const ActionSheetIOS = {
  /** choose shows an iOS action sheet and resolves the selected button index. */
  choose(options: TaoActionSheetIOSOptions): Promise<TaoActionSheetIOSSelection> {
    return new Promise(resolve => {
      actionSheetIOSDriver().showActionSheetWithOptions(options, buttonIndex => {
        resolve({
          buttonIndex,
          canceled: buttonIndex === options.cancelButtonIndex,
        })
      })
    })
  },

  /** share shows an iOS share action sheet and resolves the completion state. */
  share(options: TaoShareActionSheetIOSOptions): Promise<TaoShareActionSheetIOSResult> {
    return new Promise((resolve, reject) => {
      actionSheetIOSDriver().showShareActionSheetWithOptions(
        options,
        reject,
        (completed, activityType) => resolve({ activityType, completed }),
      )
    })
  },

  /** chooseAction creates a Pressable-compatible iOS action-sheet action. */
  chooseAction(
    options: TaoActionSheetIOSOptions,
    chosen?: TaoActionSheetIOSChosenAction,
  ): TaoActionSheetIOSAction {
    return {
      async invoke() {
        const selection = await ActionSheetIOS.choose(options)
        chosen?.invoke(selection)
        return selection
      },
    }
  },

  /** chosenAction adapts iOS action-sheet selections into an ActionSheetIOS-compatible action. */
  chosenAction(work: (selection: TaoActionSheetIOSSelection) => void): TaoActionSheetIOSChosenAction {
    return {
      invoke(selection) {
        work(selection)
      },
    }
  },

  /** setDriverForTests replaces React Native ActionSheetIOS for deterministic runtime tests. */
  setDriverForTests(driver?: TaoActionSheetIOSDriver): void {
    testDriver = driver
  },
} as const

function actionSheetIOSDriver(): TaoActionSheetIOSDriver {
  if (testDriver) {
    return testDriver
  }

  if (isJestRuntime()) {
    return {
      showActionSheetWithOptions(options, callback) {
        callback(options.cancelButtonIndex ?? -1)
      },
      showShareActionSheetWithOptions(_options, _failureCallback, successCallback) {
        successCallback(false)
      },
    }
  }

  const RN = require('react-native') as { ActionSheetIOS: TaoActionSheetIOSDriver }
  return RN.ActionSheetIOS
}

function isJestRuntime(): boolean {
  return typeof process !== 'undefined'
    && (process.env['JEST_WORKER_ID'] !== undefined || process.env['NODE_ENV'] === 'test')
}
