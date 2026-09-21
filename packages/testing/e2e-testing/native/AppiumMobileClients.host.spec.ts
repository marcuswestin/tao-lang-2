import { AppiumNoSuchAlertError, type AppiumSession, type AppiumSessionFactory } from '@appium-driver'
import { expect, test } from '@playwright/test'
import { Errors } from '@shared'
import { appiumAndroidClient, appiumXcuiTestClient } from './AppiumMobileClients'

test('dispatches an iOS control URL through XCUITest with the explicit target bundle ID', async () => {
  const scripts: Array<{ args: readonly unknown[]; script: string }> = []
  const remote: AppiumSession = {
    actions: async () => {},
    activateApplication: async () => {},
    delete: async () => {},
    executeScript: async <T>(script: string, args: readonly unknown[] = []): Promise<T> => {
      scripts.push({ args, script })
      return undefined as T
    },
    find: async () => Errors.throwUnexpected('This test does not inspect a native element.'),
    findAll: async () => Errors.throwUnexpected('This test does not inspect native elements.'),
    id: 'appium-session',
    screenshot: async () => new Uint8Array(),
    terminateApplication: async () => {},
  }
  const factory: AppiumSessionFactory = { createSession: async () => remote }
  const session = await appiumXcuiTestClient(factory).createSession({})

  await session.openDeepLink!('taohostpoc-run://control?advanceMs=1000', 'dev.tao.target')

  expect(scripts).toEqual([{
    args: [{ bundleId: 'dev.tao.target', url: 'taohostpoc-run://control?advanceMs=1000' }],
    script: 'mobile: deepLink',
  }])
})

test('dismisses a stale iOS system alert but treats an absent alert as already clean', async () => {
  let dismissals = 0
  const remote = stubRemote({
    dismissAlert: async () => {
      dismissals += 1
      if (dismissals === 3) {
        throw new AppiumNoSuchAlertError('no alert open')
      }
    },
  })
  const session = await appiumXcuiTestClient({ createSession: async () => remote }).createSession({})

  await session.dismissAlertIfPresent!()

  expect(dismissals).toBe(3)
})

test('maps Android scroll gestures onto the same dominant axis as XCUITest', async () => {
  const scripts: Array<{ args: readonly unknown[]; script: string }> = []
  const remote = stubRemote({
    executeScript: async <T>(script: string, args: readonly unknown[] = []): Promise<T> => {
      scripts.push({ args, script })
      return undefined as T
    },
  })
  const session = await appiumAndroidClient({ createSession: async () => remote }).createSession({})

  await session.scroll({ deltaX: 12, deltaY: 0 })
  await session.scroll({ deltaX: -12, deltaY: 0 })
  await session.scroll({ deltaX: 3, deltaY: -9 })
  await session.scroll({ deltaX: 9, deltaY: -9 })
  await session.scroll({ deltaX: 0, deltaY: 0 })

  expect(scripts).toEqual([
    { args: [{ direction: 'right', elementId: undefined, percent: 0.75 }], script: 'mobile: scrollGesture' },
    { args: [{ direction: 'left', elementId: undefined, percent: 0.75 }], script: 'mobile: scrollGesture' },
    { args: [{ direction: 'up', elementId: undefined, percent: 0.75 }], script: 'mobile: scrollGesture' },
    { args: [{ direction: 'up', elementId: undefined, percent: 0.75 }], script: 'mobile: scrollGesture' },
    { args: [{ direction: 'down', elementId: undefined, percent: 0.75 }], script: 'mobile: scrollGesture' },
  ])
})

function stubRemote(overrides: Partial<AppiumSession>): AppiumSession {
  return {
    actions: async () => {},
    activateApplication: async () => {},
    delete: async () => {},
    executeScript: async <T>(): Promise<T> => undefined as T,
    find: async () => Errors.throwUnexpected('This test does not inspect a native element.'),
    findAll: async () => Errors.throwUnexpected('This test does not inspect native elements.'),
    id: 'appium-session',
    screenshot: async () => new Uint8Array(),
    terminateApplication: async () => {},
    ...overrides,
  }
}
