import { AppiumNoSuchAlertError, type AppiumSession, type AppiumSessionFactory } from '@host-control/appium'
import { expect, test } from '@playwright/test'
import { Errors } from '@shared'
import { appiumXcuiTestClient } from './AppiumMobileClients'

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
