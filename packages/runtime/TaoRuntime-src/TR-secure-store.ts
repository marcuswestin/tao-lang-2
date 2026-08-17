export type TaoSecureStoreDriver = {
  deleteItemAsync(key: string): Promise<void>
  getItemAsync(key: string): Promise<string | null>
  isAvailableAsync(): Promise<boolean>
  setItemAsync(key: string, value: string): Promise<void>
}

export type TaoSecureStoreAction = {
  invoke(): Promise<void>
}

export type TaoSecureStoreCompleteAction = {
  invoke(): void
}

let testDriver: TaoSecureStoreDriver | undefined

/** SecureStore exposes Expo SecureStore-backed secret persistence helpers. */
export const SecureStore = {
  /** available reports whether secure storage is available on the current platform. */
  async available(): Promise<boolean> {
    return secureStoreDriver().isAvailableAsync()
  },

  /** deleteText deletes one secret text value. */
  async deleteText(key: string): Promise<void> {
    await secureStoreDriver().deleteItemAsync(key)
  },

  /** deleteTextAction creates a Pressable-compatible action that deletes one secret value. */
  deleteTextAction(key: string, deleted?: TaoSecureStoreCompleteAction): TaoSecureStoreAction {
    return {
      async invoke() {
        await SecureStore.deleteText(key)
        deleted?.invoke()
      },
    }
  },

  /** readText reads one secret text value. */
  async readText(key: string): Promise<string | null> {
    return secureStoreDriver().getItemAsync(key)
  },

  /** saveText writes one secret text value. */
  async saveText(key: string, value: string): Promise<void> {
    await secureStoreDriver().setItemAsync(key, value)
  },

  /** saveTextAction creates a Pressable-compatible action that writes one secret value. */
  saveTextAction(key: string, value: string, saved?: TaoSecureStoreCompleteAction): TaoSecureStoreAction {
    return {
      async invoke() {
        await SecureStore.saveText(key, value)
        saved?.invoke()
      },
    }
  },

  /** completeAction adapts secure-store completion into a SecureStore-compatible action. */
  completeAction(work: () => void): TaoSecureStoreCompleteAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** setDriverForTests replaces Expo SecureStore for deterministic runtime tests. */
  setDriverForTests(driver?: TaoSecureStoreDriver): void {
    testDriver = driver
  },
} as const

function secureStoreDriver(): TaoSecureStoreDriver {
  if (testDriver) {
    return testDriver
  }

  return require('expo-secure-store') as TaoSecureStoreDriver
}
