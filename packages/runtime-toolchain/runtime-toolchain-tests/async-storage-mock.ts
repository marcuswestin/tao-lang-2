const values = new Map<string, string>()

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return values.get(key) ?? null
  },
  async removeItem(key: string): Promise<void> {
    values.delete(key)
  },
  async setItem(key: string, value: string): Promise<void> {
    values.set(key, value)
  },
}

export default AsyncStorage
