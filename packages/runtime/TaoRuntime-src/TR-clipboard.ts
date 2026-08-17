export type TaoClipboardDriver = {
  getStringAsync(): Promise<string>
  setStringAsync(text: string): Promise<boolean>
}

export type TaoClipboardAction = {
  invoke(): Promise<void>
}

export type TaoClipboardCopiedAction = {
  invoke(copied: boolean): void
}

let testDriver: TaoClipboardDriver | undefined

/** Clipboard exposes Expo Clipboard-backed text copy/paste helpers. */
export const Clipboard = {
  /** copyText writes text to the native clipboard. */
  async copyText(text: string): Promise<boolean> {
    return clipboardDriver().setStringAsync(text)
  },

  /** copyTextAction creates a Pressable-compatible action that copies text asynchronously. */
  copyTextAction(text: string, copied?: TaoClipboardCopiedAction): TaoClipboardAction {
    return {
      async invoke() {
        const result = await Clipboard.copyText(text)
        copied?.invoke(result)
      },
    }
  },

  /** copiedAction adapts copy results into a Clipboard-compatible action. */
  copiedAction(work: (copied: boolean) => void): TaoClipboardCopiedAction {
    return {
      invoke(copied) {
        work(copied)
      },
    }
  },

  /** readText reads plain text from the native clipboard. */
  async readText(): Promise<string> {
    return clipboardDriver().getStringAsync()
  },

  /** setDriverForTests replaces Expo Clipboard for deterministic runtime tests. */
  setDriverForTests(driver?: TaoClipboardDriver): void {
    testDriver = driver
  },
} as const

function clipboardDriver(): TaoClipboardDriver {
  if (testDriver) {
    return testDriver
  }

  return require('expo-clipboard') as TaoClipboardDriver
}
