import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'

const numberType = { kind: 'primitive', name: 'number' } as const
const identity = TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'Shared', 'app', 'Workspace'])

Describe('persisted app ID bindings', () => {
  Test('isolates simultaneous app actions and leaves the old canonical store untouched', async () => {
    const legacyKey = `tao.persisted-state.v1:${identity.canonical}:Width`
    const legacyValue = JSON.stringify({ formatVersion: 1, type: numberType, value: 700 })
    const storage = memoryKeyValueStorage(new Map([[legacyKey, legacyValue]]))
    const restore = TR.Persisted.setStorageForTests(storage)
    try {
      const first = TR.PersistedState(() => TR.Value(320), identity, 'Width', numberType, 'com.tao.first')
      const second = TR.PersistedState(() => TR.Value(320), identity, 'Width', numberType, 'com.tao.second')
      const firstScope = { Width: first }
      await Promise.all([first.load(), second.load()])
      Expect(first.evaluate().jsValue).toBe(320)
      Expect(second.evaluate().jsValue).toBe(320)

      const incrementFirst = TR.Action(() => TR.Set(firstScope.Width, () => TR.Value(410)), { name: 'IncrementFirst' })
      await TR.Do(incrementFirst)
      Expect(first.evaluate().jsValue).toBe(410)
      Expect(second.evaluate().jsValue).toBe(320)
      await TR.Persisted.beginLaunch()
      Expect(storage.values.get(first.key)).toBe(JSON.stringify({ formatVersion: 1, type: numberType, value: 410 }))
      Expect(storage.values.get(second.key)).toBeUndefined()
      Expect(storage.values.get(legacyKey)).toBe(legacyValue)
      Expect(first.key).not.toBe(second.key)
      Expect(first.key).toContain('com.tao.first')
    } finally {
      restore()
    }
  })

  Test('rehydrates the same app ID after a launch even when its version changes', async () => {
    const storage = memoryKeyValueStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    try {
      const versionOne = TR.PersistedState(() => TR.Value(320), identity, 'Width', numberType, 'com.tao.same')
      await versionOne.load()
      versionOne.set(TR.Value(480))
      await TR.Persisted.beginLaunch()

      const versionTwo = TR.PersistedState(() => TR.Value(320), identity, 'Width', numberType, 'com.tao.same')
      await versionTwo.load()
      Expect(versionTwo.key).toBe(versionOne.key)
      Expect(versionTwo.evaluate().jsValue).toBe(480)
    } finally {
      restore()
    }
  })
})
