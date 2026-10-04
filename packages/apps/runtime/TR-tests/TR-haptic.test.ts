import { Describe, Expect, Test } from '@shared/test'
import { createHaptic } from '../TaoRuntime-src/TR-haptic'

type TestIdentity = Readonly<{ identity: symbol }>
type TestValue = { evaluate(): { jsValue: TestIdentity } }
type TestAction<Args extends any[]> = { invoke(...args: Args): void | Promise<void> }

const kindIdentities = {
  Selection: identity('opaque-1'),
  Light: identity('opaque-2'),
  Medium: identity('opaque-3'),
  Heavy: identity('opaque-4'),
  Success: identity('opaque-5'),
  Warning: identity('opaque-6'),
  Error: identity('opaque-7'),
} as const
const kinds = Object.fromEntries(
  Object.entries(kindIdentities).map(([name, kind]) => [name, value(kind)]),
) as Record<keyof typeof kindIdentities, TestValue>

Describe('Haptic', () => {
  Test('loads Expo lazily and normalizes every Tao kind to its vendor operation', async () => {
    const calls: unknown[][] = []
    let loads = 0
    const module = {
      ImpactFeedbackStyle: { Heavy: 'impact-heavy', Light: 'impact-light', Medium: 'impact-medium' },
      NotificationFeedbackType: { Error: 'notice-error', Success: 'notice-success', Warning: 'notice-warning' },
      async impactAsync(style: unknown) {
        calls.push(['impact', style])
      },
      async notificationAsync(type: unknown) {
        calls.push(['notification', type])
      },
      async selectionAsync() {
        calls.push(['selection'])
      },
    }
    const haptic = createHaptic(kinds, asAction, {
      optional<ModuleT>(capability: string, moduleName: string): ModuleT | undefined {
        Expect(capability).toBe('Haptic')
        loads += 1
        Expect(moduleName).toBe('expo-haptics')
        return module as ModuleT
      },
      platform: () => 'ios',
    })

    Expect(loads).toBe(0)
    Expect(calls).toEqual([])

    await haptic.Play.invoke(kinds.Selection)
    await haptic.Play.invoke(kinds.Light)
    await haptic.Play.invoke(kinds.Medium)
    await haptic.Play.invoke(kinds.Heavy)
    await haptic.Play.invoke(kinds.Success)
    await haptic.Play.invoke(kinds.Warning)
    await haptic.Play.invoke(kinds.Error)

    Expect(calls).toEqual([
      ['selection'],
      ['impact', 'impact-light'],
      ['impact', 'impact-medium'],
      ['impact', 'impact-heavy'],
      ['notification', 'notice-success'],
      ['notification', 'notice-warning'],
      ['notification', 'notice-error'],
    ])
  })

  Test('dispatches only the exact declaration-owned case identity', async () => {
    let selections = 0
    const haptic = createHaptic(kinds, asAction, {
      optional<ModuleT>(): ModuleT | undefined {
        return {
          selectionAsync: async () => {
            selections += 1
          },
        } as ModuleT
      },
      platform: () => 'ios',
    })

    await haptic.Play.invoke(value(identity('opaque-1')))
    Expect(selections).toBe(0)

    await haptic.Play.invoke(kinds.Selection)
    Expect(selections).toBe(1)
  })

  Test('does not load or invoke Expo haptics on web', async () => {
    let expoLoads = 0
    const haptic = createHaptic(kinds, asAction, {
      optional<ModuleT>(): ModuleT | undefined {
        expoLoads += 1
        return { selectionAsync: async () => undefined } as ModuleT
      },
      platform: () => 'web',
    })

    await haptic.Play.invoke(kinds.Selection)

    Expect(expoLoads).toBe(0)
  })

  Test('no-ops when expo-haptics is absent or unsupported', async () => {
    const absent = createHaptic(kinds, asAction, optionalModule(undefined))
    const unsupported = createHaptic(kinds, asAction, optionalModule({}))

    await absent.Play.invoke(kinds.Selection)
    await unsupported.Play.invoke(kinds.Selection)
    await unsupported.Play.invoke(kinds.Success)
  })
})

function identity(name: string): TestIdentity {
  return Object.freeze({ identity: Symbol(name) })
}

function value(jsValue: TestIdentity): TestValue {
  return { evaluate: () => ({ jsValue }) }
}

function asAction<Args extends any[]>(body: (...args: Args) => unknown): TestAction<Args> {
  return {
    async invoke(...args) {
      await body(...args)
    },
  }
}

function optionalModule(module: unknown) {
  return {
    optional<ModuleT>(): ModuleT | undefined {
      return module as ModuleT | undefined
    },
    platform: () => 'ios',
  }
}
