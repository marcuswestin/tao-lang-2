const values = new Map<string, string>()

// The subset of AsyncStorage the runtime and provider SDKs call, such as InstantDB's persisted store.
const AsyncStorage = {
  async clear(): Promise<void> {
    values.clear()
  },
  async getAllKeys(): Promise<readonly string[]> {
    return [...values.keys()]
  },
  async getItem(key: string): Promise<string | null> {
    return values.get(key) ?? null
  },
  async removeItem(key: string): Promise<void> {
    values.delete(key)
  },
  async setItem(key: string, value: string): Promise<void> {
    values.set(key, value)
  },
  async multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
    for (const [key, value] of pairs) {
      values.set(key, value)
    }
  },
}

export default AsyncStorage
