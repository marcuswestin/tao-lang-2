import { Describe, Expect, Test } from '@shared/test'
import TR from '../TaoRuntime-src/TR'
import type { TaoKeyValueStorage } from '../TaoRuntime-src/TR-data'
import { memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import type { TaoDeclarationIdentityTuple } from '../TaoRuntime-src/TR-navigation-identity'
import { RuntimeStackNav } from '../TaoRuntime-src/TR-navigation-mounts'
import { setNavigationRestorationStorageForTests } from '../TaoRuntime-src/TR-navigation-restoration'
import { configuredStack } from './TR-navigation-test-fixtures'

function identity(variant: string, kind: string, name: string) {
  return TR.Navigation.Identity([
    'tao.declaration',
    1,
    'navigation-relaunch-test',
    '@workspace',
    variant,
    kind,
    name,
  ] as TaoDeclarationIdentityTuple)
}

/**
 * moduleScopeApp is the shape the compiler emits: one app definition, created once and reused by
 * every launch of it. That is what makes the two seams necessary — a definition that outlives a
 * launch also outlives its memoized load — and it is what the restoration suite next door, which
 * builds a second definition per launch, deliberately does not exercise.
 */
function moduleScopeApp(variant: string) {
  const home = TR.Navigation.View({ identity: identity(variant, 'view', 'Home'), name: 'Home', render: () => null })
  const detail = TR.Navigation.View({
    identity: identity(variant, 'view', 'Detail'),
    name: 'Detail',
    render: () => null,
  })
  const stack = TR.Navigation.Declaration('Stack', TR.NavKind.Stack(), identity(variant, 'nav', 'Stack'))
  const app = TR.Navigation.App({
    auxiliaries: () => ({}),
    declaration: TR.Navigation.AppDeclaration('RelaunchApp', identity(variant, 'app', 'RelaunchApp')),
    name: 'RelaunchApp',
    navigator: () => TR.Navigation.Configure(stack, { Initial: home }),
    restoration: { exclusions: [], mode: 'automatic', variant },
  })
  return { app, detail }
}

function depth(app: ReturnType<typeof moduleScopeApp>['app']): number {
  return (app.navigator as RuntimeStackNav).depth
}

/**
 * persistedWidth is the device-local value an abandoned action would publish if the launch boundary
 * let it: it is transactional, so it stays private until the root commits, and it writes through to
 * the device, so the store shows whether anything reached it.
 */
function persistedWidth(name: string) {
  return TR.PersistedState<number>(
    () => TR.Value(280),
    identity(name, 'app', 'RelaunchApp'),
    'SidebarWidth',
    { kind: 'primitive', name: 'number' },
  )
}

Describe('navigation across a relaunch', () => {
  Test('re-reads the device on a relaunch instead of replaying the load the last launch memoized', async () => {
    const device = memoryKeyValueStorage()
    const restoreDevice = setNavigationRestorationStorageForTests(device)
    try {
      const { app, detail } = moduleScopeApp('LoadMemo')
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, { Message: TR.Value('restored') })
      await drainMicrotasks()
      detach()

      await TR.Navigation.beginLaunch()
      const relaunched = await app.attachRestoration()
      Expect(depth(app)).toBe(2)
      relaunched()
    } finally {
      restoreDevice()
    }
  })

  Test('a fresh relaunch opens where a first launch opens, and records that as the stored position', async () => {
    const device = memoryKeyValueStorage()
    const restoreDevice = setNavigationRestorationStorageForTests(device)
    try {
      const { app, detail } = moduleScopeApp('FreshOptOut')
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, {})
      await drainMicrotasks()
      detach()

      await TR.Navigation.beginLaunch({ fresh: true })
      const freshDetach = await app.attachRestoration()
      Expect(depth(app)).toBe(1)
      await drainMicrotasks()
      freshDetach()

      // The fresh instance recorded where it opened, so the ordinary relaunch after it returns to
      // the initial screen rather than to the position the run before it left behind.
      await TR.Navigation.beginLaunch()
      const ordinary = await app.attachRestoration()
      Expect(depth(app)).toBe(1)
      ordinary()
    } finally {
      restoreDevice()
    }
  })

  Test('hides a position behind the check boundary and hands the surrounding device back', async () => {
    const device = memoryKeyValueStorage()
    const restoreDevice = setNavigationRestorationStorageForTests(device)
    try {
      const { app, detail } = moduleScopeApp('CheckBoundary')
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, {})
      await drainMicrotasks()
      detach()
      const deviceContents = [...device.values.entries()]
      Expect(deviceContents.length).toBe(1)

      TR.Navigation.beginTest()
      const checkDetach = await app.attachRestoration()
      Expect(depth(app)).toBe(1)
      app.present(app.navigator, detail, {})
      await drainMicrotasks()
      checkDetach()
      // The check navigated, but into its own store; the surrounding device is untouched.
      Expect([...device.values.entries()]).toEqual(deviceContents)

      TR.Navigation.endTest()
      await TR.Navigation.beginLaunch()
      const afterCheck = await app.attachRestoration()
      Expect(depth(app)).toBe(2)
      afterCheck()
    } finally {
      TR.Navigation.endTest()
      restoreDevice()
    }
  })

  /**
   * A check boundary swaps the store out from under whatever the process is holding. A snapshot the
   * previous check took belongs to the device it was taken on, so the write carrying it has to
   * settle there even when it is still queued when the boundary arrives — otherwise one check's
   * position lands in the next check's private store and reappears where nothing put it.
   */
  Test('settles a write queued before a check boundary on the device it was queued against', async () => {
    const device = memoryKeyValueStorage()
    const restoreDevice = setNavigationRestorationStorageForTests(device)
    try {
      const { app, detail } = moduleScopeApp('QueuedWriteDevice')
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, {})
      // Queued behind the coalescing microtask that takes the snapshot and ahead of the write that
      // microtask hands to the persist queue: exactly the window a check boundary can land in.
      queueMicrotask(() => TR.Navigation.beginTest())
      await drainMicrotasks()
      detach()
      TR.Navigation.endTest()

      Expect([...device.values.keys()].length).toBe(1)
      // And it is a device an ordinary launch reads back, not just bytes that reached a Map.
      await TR.Navigation.beginLaunch()
      const relaunched = await app.attachRestoration()
      Expect(depth(app)).toBe(2)
      relaunched()
    } finally {
      TR.Navigation.endTest()
      restoreDevice()
    }
  })

  // An action root outlives the instance that started it. A launch boundary is therefore also an
  // action boundary: what the ending launch was in the middle of belongs to the app the person
  // quit, and must reach neither the device nor the instance that opened in its place.
  Test('parks an action suspended on an ask instead of resuming it into the launch that replaced it', async () => {
    const device = memoryKeyValueStorage()
    const restoreStorage = TR.Persisted.setStorageForTests(device)
    const failures: unknown[] = []
    const unowned: unknown[] = []
    const stopFailures = TR.Errors.onFailure(failure => failures.push(failure))
    const stopUnowned = TR.Errors.onUnowned(failure => unowned.push(failure))
    try {
      const width = persistedWidth('AskAcrossLaunch')
      const resumed: string[] = []
      const home = TR.Navigation.View({ name: 'AskHome', render: () => null })
      const confirm = TR.Navigation.View({ name: 'AskConfirm', render: () => null })
      const stack = configuredStack('Ask relaunch host', home)
      const asking = TR.Action(async () => {
        width.set(TR.Value(360))
        await TR.Navigation.Ask({ navigation: stack }, confirm, {})
        resumed.push('after ask')
      }, { name: 'WidenThenConfirm' })

      void asking.jsValue.invoke()
      await drainMicrotasks()
      Expect(stack.canGoBack).toBe(true)

      await TR.Navigation.beginLaunch()
      await drainMicrotasks()

      // The body never continued past the ask, so nothing it would have done to the instance that
      // replaced its own happened, and the widening it was holding never reached the device.
      Expect(resumed).toEqual([])
      Expect(width.evaluate().jsValue).toBe(280)
      Expect([...device.values.keys()]).toEqual([])
      // The app is gone; that is not a failure, so nothing is reported to a Tao developer.
      Expect(failures).toEqual([])
      Expect(unowned).toEqual([])

      // The parked root does not hold the next launch's roots behind it in the serialization queue.
      const afterRelaunch = TR.Action(() => {
        width.set(TR.Value(420))
      }, { name: 'WidenAgain' })
      await afterRelaunch.jsValue.invoke()
      Expect(width.evaluate().jsValue).toBe(420)
    } finally {
      stopUnowned()
      stopFailures()
      restoreStorage()
    }
  })

  Test('abandons a detached async root that outlived its launch instead of committing after it', async () => {
    const device = memoryKeyValueStorage()
    const restoreStorage = TR.Persisted.setStorageForTests(device)
    const failures: unknown[] = []
    const stopFailures = TR.Errors.onFailure(failure => failures.push(failure))
    try {
      const width = persistedWidth('AsyncAcrossLaunch')
      let release!: () => void
      const slowWork = new Promise<void>(resolve => {
        release = resolve
      })
      const start = TR.Action(() => {
        TR.Async(async () => {
          await slowWork
          width.set(TR.Value(360))
        })
      }, { name: 'StartBackgroundWiden' })

      await start.jsValue.invoke()
      await drainMicrotasks()

      await TR.Navigation.beginLaunch()
      // The work finishes after the relaunch, which is the whole point: an async root has no ask to
      // park on, so it resumes and must find that its transaction publishes nothing.
      release()
      await drainMicrotasks()

      Expect(width.evaluate().jsValue).toBe(280)
      Expect([...device.values.keys()]).toEqual([])
      Expect(failures).toEqual([])
    } finally {
      stopFailures()
      restoreStorage()
    }
  })

  Test('settles a coalesced write before the relaunched instance reads the device', async () => {
    const values = new Map<string, string>()
    const restoreDevice = setNavigationRestorationStorageForTests(unhurriedStorage(values))
    try {
      const { app, detail } = moduleScopeApp('WriteSettle')
      const detach = await app.attachRestoration()
      app.present(app.navigator, detail, {})
      // Deliberately undrained: the coalesced write the navigation scheduled is still in flight
      // when the relaunch begins, and settling it is the launch boundary's job, not the caller's.
      detach()

      await TR.Navigation.beginLaunch()
      const relaunched = await app.attachRestoration()
      Expect(depth(app)).toBe(2)
      relaunched()
    } finally {
      restoreDevice()
    }
  })
})

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

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>(resolve => queueMicrotask(resolve))
}
