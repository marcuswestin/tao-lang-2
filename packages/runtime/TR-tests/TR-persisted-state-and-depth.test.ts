import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoKeyValueStorage } from '../TaoRuntime-src/TR-data'
import { TaoViewDepthError } from '../TaoRuntime-src/TR-errors'

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'State', 'app', name])
}

const numberType = { kind: 'primitive', name: 'number' } as const

function memoryStorage(initial: Record<string, string> = {}): TaoKeyValueStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => Promise.resolve(values.get(key) ?? null),
    setItem: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    values,
  }
}

Describe('persisted app state and recursive view depth', () => {
  Test('loads asynchronously over the declared default and resets to that default', async () => {
    const storage = memoryStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    try {
      const state = TR.PersistedState(() => TR.Value(280), identity('Loaded'), 'SidebarWidth', numberType)
      storage.values.set(state.key, JSON.stringify({ formatVersion: 1, type: numberType, value: 360 }))
      Expect(state.evaluate().jsValue).toBe(280)
      await state.load()
      Expect(state.evaluate().jsValue).toBe(360)
      state.reset()
      Expect(state.evaluate().jsValue).toBe(280)
      await Promise.resolve()
      Expect(storage.values.get(state.key)).toBe(JSON.stringify({ formatVersion: 1, type: numberType, value: 280 }))
    } finally {
      restore()
    }
  })

  Test('does not let a late async load replace a local write', async () => {
    let resolveLoad: ((value: string | null) => void) | undefined
    const storage: TaoKeyValueStorage = {
      getItem: () =>
        new Promise(resolve => {
          resolveLoad = resolve
        }),
      setItem: () => Promise.resolve(),
    }
    const restore = TR.Persisted.setStorageForTests(storage)
    try {
      const state = TR.PersistedState(() => TR.Value(280), identity('WriteWins'), 'SidebarWidth', numberType)
      const loading = state.load()
      state.set(TR.Value(420))
      resolveLoad?.(JSON.stringify({ formatVersion: 1, type: numberType, value: 360 }))
      await loading
      Expect(state.evaluate().jsValue).toBe(420)
    } finally {
      restore()
    }
  })

  Test('serializes writes so an older asynchronous save cannot win', async () => {
    const writes: Array<{ resolve(): void; value: string }> = []
    const storage: TaoKeyValueStorage = {
      getItem: () => Promise.resolve(null),
      setItem: (_key, value) => new Promise(resolve => writes.push({ resolve, value })),
    }
    const restore = TR.Persisted.setStorageForTests(storage)
    try {
      const state = TR.PersistedState(() => TR.Value(280), identity('Ordered'), 'SidebarWidth', numberType)
      await state.load()
      state.set(TR.Value(300))
      state.set(TR.Value(420))
      await Promise.resolve()
      Expect(writes.map(write => JSON.parse(write.value).value)).toEqual([300])
      writes[0]!.resolve()
      for (let turn = 0; turn < 10 && writes.length < 2; turn += 1) {
        await Promise.resolve()
      }
      Expect(writes.map(write => JSON.parse(write.value).value)).toEqual([300, 420])
      writes[1]!.resolve()
      await Promise.resolve()
    } finally {
      restore()
    }
  })

  Test('keeps the declared default when persisted JSON is corrupt or has the wrong runtime type', async () => {
    const storage = memoryStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    const warn = console.warn
    console.warn = () => {}
    try {
      const corrupt = TR.PersistedState(() => TR.Value(280), identity('Corrupt'), 'SidebarWidth', numberType)
      storage.values.set(corrupt.key, '{bad json')
      await corrupt.load()
      Expect(corrupt.evaluate().jsValue).toBe(280)

      const mistyped = TR.PersistedState(() => TR.Value(320), identity('Mistyped'), 'SidebarWidth', numberType)
      storage.values.set(mistyped.key, JSON.stringify({ formatVersion: 1, type: numberType, value: 'wide' }))
      await mistyped.load()
      Expect(mistyped.evaluate().jsValue).toBe(320)
    } finally {
      console.warn = warn
      restore()
    }
  })

  Test('rejects undeclared item fields during hydration', async () => {
    const storage = memoryStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    const warn = console.warn
    console.warn = () => {}
    const itemType = {
      kind: 'item',
      properties: { Width: { optional: false, type: numberType } },
    } as const
    try {
      const state = TR.PersistedState(
        () => TR.Value({ Width: 280 }),
        identity('ExtraField'),
        'Pane',
        itemType,
      )
      storage.values.set(
        state.key,
        JSON.stringify({
          formatVersion: 1,
          type: itemType,
          value: { Credential: { opaque: true }, Width: 420 },
        }),
      )
      await state.load()
      Expect(state.evaluate().jsValue).toEqual({ Width: 280 })
    } finally {
      console.warn = warn
      restore()
    }
  })

  Test('accepts exactly 256 view frames and fails frame 257 without argument inspection', () => {
    Expect(() => TR.AssertViewDepth({ viewDepth: 256 }, 'Recursive')).not.toThrow()
    try {
      TR.AssertViewDepth({ viewDepth: 257 }, 'Recursive')
      throw new Error('Expected the depth guard to fail.')
    } catch (error) {
      Expect(error).toBeInstanceOf(TaoViewDepthError)
      Expect((error as TaoViewDepthError).depth).toBe(257)
      Expect((error as TaoViewDepthError).view).toBe('Recursive')
    }
  })
})
