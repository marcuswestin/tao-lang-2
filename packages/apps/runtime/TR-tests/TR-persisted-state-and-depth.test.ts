import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoKeyValueStorage } from '../TaoRuntime-src/TR-data'
import { memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import { TaoViewDepthError, UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'State', 'app', name])
}

const numberType = { kind: 'primitive', name: 'number' } as const
const testAppId = 'com.tao.test.persisted'

function memoryStorage(initial: Record<string, string> = {}): ReturnType<typeof memoryKeyValueStorage> {
  return memoryKeyValueStorage(new Map(Object.entries(initial)))
}

/** unhurriedStorage is a device whose write takes a few turns to land, as a real one does. */
function unhurriedStorage(values: Map<string, string>): TaoKeyValueStorage {
  return {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      values.set(key, value)
    },
  }
}

function envelope(value: number): string {
  return JSON.stringify({ formatVersion: 1, type: numberType, value })
}

Describe('persisted app state and recursive view depth', () => {
  Test('loads asynchronously over the declared default and resets to that default', async () => {
    const storage = memoryStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    try {
      const state = TR.PersistedState(() => TR.Value(280), identity('Loaded'), 'SidebarWidth', numberType, testAppId)
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
      const state = TR.PersistedState(() => TR.Value(280), identity('WriteWins'), 'SidebarWidth', numberType, testAppId)
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
      const state = TR.PersistedState(() => TR.Value(280), identity('Ordered'), 'SidebarWidth', numberType, testAppId)
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
      const corrupt = TR.PersistedState(() => TR.Value(280), identity('Corrupt'), 'SidebarWidth', numberType, testAppId)
      storage.values.set(corrupt.key, '{bad json')
      await corrupt.load()
      Expect(corrupt.evaluate().jsValue).toBe(280)

      const mistyped = TR.PersistedState(
        () => TR.Value(320),
        identity('Mistyped'),
        'SidebarWidth',
        numberType,
        testAppId,
      )
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
        testAppId,
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

  Test('persists enum case names and restores the current declaration-owned runtime token', async () => {
    const storage = memoryStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    const declaration = identity('DocumentStatus')
    const enumType = {
      cases: ['Draft', 'Published'],
      declaration: declaration.canonical,
      kind: 'enum',
    } as const
    try {
      const Status = TR.Enum(declaration, enumType.cases)
      const state = TR.PersistedState(() => Status['Draft']!, identity('EnumOwner'), 'Status', enumType, testAppId)
      await state.load()
      state.set(Status['Published']!)
      await Promise.resolve()

      const persisted = JSON.parse(storage.values.get(state.key)!)
      Expect(persisted.value).toEqual({
        caseName: 'Published',
        declaration: declaration.canonical,
      })

      const RecompiledStatus = TR.Enum(declaration, enumType.cases)
      const restoredState = TR.PersistedState(
        () => RecompiledStatus['Draft']!,
        identity('EnumOwner'),
        'Status',
        enumType,
        testAppId,
      )
      await restoredState.load()
      Expect(restoredState.evaluate().jsValue).toBe(RecompiledStatus['Published']!.evaluate().jsValue)
    } finally {
      restore()
    }
  })

  Test('keeps the enum default when the persisted case name is unknown', async () => {
    const storage = memoryStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    const declaration = identity('SafeStatus')
    const enumType = {
      cases: ['Draft', 'Published'],
      declaration: declaration.canonical,
      kind: 'enum',
    } as const
    const Status = TR.Enum(declaration, enumType.cases)
    const warn = console.warn
    console.warn = () => {}
    try {
      const state = TR.PersistedState(() => Status['Draft']!, identity('SafeEnumOwner'), 'Status', enumType, testAppId)
      storage.values.set(
        state.key,
        JSON.stringify({
          formatVersion: 1,
          type: enumType,
          value: { caseName: 'Removed', declaration: declaration.canonical },
        }),
      )
      await state.load()
      Expect(state.evaluate().jsValue).toBe(Status['Draft']!.evaluate().jsValue)
    } finally {
      console.warn = warn
      restore()
    }
  })

  // A generated app declares its persisted state at module scope, so an instance outlives every
  // mount and every check. These three cover the check boundary that gives one journey a device
  // nobody has used, without weakening the relaunch inside a journey, which keeps the same device.
  Test('resets an unmounted state to its declared default and hides the check behind its own store', async () => {
    const device = memoryStorage()
    const restoreDevice = TR.Persisted.setStorageForTests(device)
    try {
      const state = TR.PersistedState(
        () => TR.Value(280),
        identity('CheckBoundary'),
        'SidebarWidth',
        numberType,
        testAppId,
      )
      device.values.set(state.key, envelope(360))
      await state.load()
      Expect(state.evaluate().jsValue).toBe(360)

      TR.Persisted.beginTest()
      // Nothing is mounted here, which is exactly the state a check boundary runs in: the previous
      // check unmounted its app before the next one begins.
      Expect(state.evaluate().jsValue).toBe(280)
      state.set(TR.Value(420))
      for (let turn = 0; turn < 5; turn += 1) {
        await Promise.resolve()
      }
      Expect(state.evaluate().jsValue).toBe(420)
      // The check wrote 420, but into its own store; the surrounding device still holds 360.
      Expect(device.values.get(state.key)).toBe(envelope(360))

      TR.Persisted.endTest()
      Expect(device.values.get(state.key)).toBe(envelope(360))
    } finally {
      TR.Persisted.endTest()
      restoreDevice()
    }
  })

  Test('clears the load memo so a check re-reads its device instead of replaying an earlier read', async () => {
    const device = memoryStorage()
    const restoreDevice = TR.Persisted.setStorageForTests(device)
    let restoreSeeded: (() => void) | undefined
    try {
      const state = TR.PersistedState(() => TR.Value(280), identity('LoadMemo'), 'SidebarWidth', numberType, testAppId)
      device.values.set(state.key, envelope(360))
      await state.load()
      Expect(state.evaluate().jsValue).toBe(360)

      TR.Persisted.beginTest()
      // Point the check at a seeded store: a state that still remembered its earlier load would
      // hand back that resolved read and stay at 280. Hold the restore: an install left on the
      // slot's stack outlives this file and hands every later restore the seeded store back.
      restoreSeeded = TR.Persisted.setStorageForTests(memoryStorage({ [state.key]: envelope(500) }))
      await state.load()
      Expect(state.evaluate().jsValue).toBe(500)
    } finally {
      restoreSeeded?.()
      TR.Persisted.endTest()
      restoreDevice()
    }
  })

  Test('hands the surrounding device back on endTest even after a repeated beginTest', async () => {
    const device = memoryStorage()
    const restoreDevice = TR.Persisted.setStorageForTests(device)
    try {
      const state = TR.PersistedState(
        () => TR.Value(280),
        identity('DeviceHandback'),
        'SidebarWidth',
        numberType,
        testAppId,
      )
      device.values.set(state.key, envelope(360))

      TR.Persisted.beginTest()
      TR.Persisted.beginTest()
      TR.Persisted.endTest()

      await state.load()
      Expect(state.evaluate().jsValue).toBe(360)
    } finally {
      TR.Persisted.endTest()
      restoreDevice()
    }
  })

  // The launch boundary keeps the device and drops what the launched instance held, so a relaunch
  // reads its width back out of storage instead of inheriting the module-scope value. Without that
  // a journey asserting a width across a relaunch would pass even with the round trip broken.
  Test('re-reads the device on a relaunch instead of keeping the value the last launch held', async () => {
    // A device whose write takes a few turns, as a real one does: the read the relaunched instance
    // performs is not ordered behind a write that is still in flight, so the boundary settles it.
    const values = new Map<string, string>()
    const restoreDevice = TR.Persisted.setStorageForTests(unhurriedStorage(values))
    try {
      const state = TR.PersistedState(
        () => TR.Value(280),
        identity('LaunchHydration'),
        'SidebarWidth',
        numberType,
        testAppId,
      )
      await state.load()
      state.set(TR.Value(360))

      await TR.Persisted.beginLaunch()
      // The queued write landed before anything read, and the value the instance held is gone.
      Expect(values.get(state.key)).toBe(envelope(360))
      Expect(state.evaluate().jsValue).toBe(280)

      // Seeding the device behind the state's back is what proves the next launch really reads it:
      // an instance replaying its memoized load would stay at 360.
      values.set(state.key, envelope(500))
      await state.load()
      Expect(state.evaluate().jsValue).toBe(500)
    } finally {
      restoreDevice()
    }
  })

  Test('leaves the device untouched across a relaunch, so a value with no launch of its own survives', async () => {
    const device = memoryStorage()
    const restoreDevice = TR.Persisted.setStorageForTests(device)
    try {
      const state = TR.PersistedState(
        () => TR.Value(280),
        identity('LaunchKeepsDevice'),
        'SidebarWidth',
        numberType,
        testAppId,
      )
      device.values.set(state.key, envelope(360))

      // Nothing mounted this state, so it never loaded and has nothing of its own to write. The
      // boundary must not put its declared default onto the device on the way past.
      await TR.Persisted.beginLaunch()
      Expect(device.values.get(state.key)).toBe(envelope(360))
      await state.load()
      Expect(state.evaluate().jsValue).toBe(360)
    } finally {
      restoreDevice()
    }
  })

  Test('accepts exactly 256 view frames and fails frame 257 without argument inspection', () => {
    Expect(() => TR.AssertViewDepth({ viewDepth: 256 }, 'Recursive')).not.toThrow()
    try {
      TR.AssertViewDepth({ viewDepth: 257 }, 'Recursive')
      throw new UnexpectedBehaviorError('Expected the depth guard to fail.')
    } catch (error) {
      Expect(error).toBeInstanceOf(TaoViewDepthError)
      Expect((error as TaoViewDepthError).depth).toBe(257)
      Expect((error as TaoViewDepthError).view).toBe('Recursive')
    }
  })
})
