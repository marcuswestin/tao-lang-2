export type TaoShareContent = {
  message?: string
  title?: string
  url?: string
}

export type TaoShareResult = {
  action: string
  activityType?: string
}

export type TaoShareDriver = {
  share(content: TaoShareContent): Promise<TaoShareResult>
}

export type TaoShareAction = {
  invoke(): Promise<void>
}

export type TaoShareResultAction = {
  invoke(result: TaoShareResult): void
}

let testDriver: TaoShareDriver | undefined

/** Share exposes React Native system share-sheet helpers. */
export const Share = {
  /** content opens the native share sheet with message, url, and optional title. */
  async content(content: TaoShareContent): Promise<TaoShareResult> {
    return shareDriver().share(content)
  },

  /** contentAction creates a Pressable-compatible action that opens the native share sheet. */
  contentAction(content: TaoShareContent, shared?: TaoShareResultAction): TaoShareAction {
    return {
      async invoke() {
        const result = await Share.content(content)
        shared?.invoke(result)
      },
    }
  },

  /** text opens the native share sheet for one text message. */
  async text(message: string, title?: string): Promise<TaoShareResult> {
    return Share.content({ message, title })
  },

  /** textAction creates a Pressable-compatible action that shares one text message. */
  textAction(message: string, title?: string, shared?: TaoShareResultAction): TaoShareAction {
    return Share.contentAction({ message, title }, shared)
  },

  /** sharedAction adapts native share results into a Share-compatible action. */
  sharedAction(work: (result: TaoShareResult) => void): TaoShareResultAction {
    return {
      invoke(result) {
        work(result)
      },
    }
  },

  /** setDriverForTests replaces React Native Share for deterministic runtime tests. */
  setDriverForTests(driver?: TaoShareDriver): void {
    testDriver = driver
  },
} as const

function shareDriver(): TaoShareDriver {
  if (testDriver) {
    return testDriver
  }

  const RN = require('react-native') as { Share: TaoShareDriver }
  return RN.Share
}
