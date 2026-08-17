export type TaoLinkingDriver = {
  canOpenURL(url: string): Promise<boolean>
  openURL(url: string): Promise<unknown>
}

export type TaoOpenURLAction = {
  invoke(): Promise<void>
}

export type TaoOpenURLOpenedAction = {
  invoke(opened: boolean): void
}

let testDriver: TaoLinkingDriver | undefined

/** Linking exposes Expo Linking-backed external URL helpers. */
export const Linking = {
  /** canOpenURL asks the native runtime whether a URL can be opened. */
  async canOpenURL(url: string): Promise<boolean> {
    return linkingDriver().canOpenURL(url)
  },

  /** openURL opens an external or deep-link URL through the native runtime. */
  async openURL(url: string): Promise<boolean> {
    const driver = linkingDriver()
    const canOpen = await driver.canOpenURL(url)
    if (!canOpen) {
      return false
    }
    await driver.openURL(url)
    return true
  },

  /** openURLAction creates a Pressable-compatible async action that opens a URL. */
  openURLAction(url: string, opened?: TaoOpenURLOpenedAction): TaoOpenURLAction {
    return {
      async invoke() {
        const result = await Linking.openURL(url)
        opened?.invoke(result)
      },
    }
  },

  /** openedAction adapts URL open results into a Linking-compatible action. */
  openedAction(work: (opened: boolean) => void): TaoOpenURLOpenedAction {
    return {
      invoke(opened) {
        work(opened)
      },
    }
  },

  /** setDriverForTests replaces Expo Linking for deterministic runtime tests. */
  setDriverForTests(driver?: TaoLinkingDriver): void {
    testDriver = driver
  },
} as const

function linkingDriver(): TaoLinkingDriver {
  if (testDriver) {
    return testDriver
  }

  return require('expo-linking') as TaoLinkingDriver
}
