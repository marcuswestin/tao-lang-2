import {
  type AppiumElement,
  AppiumNoSuchAlertError,
  type AppiumSession,
  type AppiumSessionFactory,
} from '@appium-driver'
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

for (const platform of ['ios', 'android'] as const) {
  test(`${platform} adaptation keeps scoped element identity local while forwarding common operations`, async () => {
    const events: string[] = []
    const rect = { x: 1, y: 2, width: 3, height: 4 }
    const child = wireElement('child', events)
    const parent = wireElement('shared-id', events, {
      find: async locator => {
        events.push(`within:${locator.value}`)
        return child
      },
      findAll: async locator => {
        events.push(`all-within:${locator.value}`)
        return [child]
      },
      getRect: async () => rect,
    })
    const remote = stubRemote({
      find: async () => parent,
      findAll: async () => [parent],
      activateApplication: async appId => {
        events.push(`activate:${appId}`)
      },
      terminateApplication: async appId => {
        events.push(`terminate:${appId}`)
      },
      delete: async () => {
        events.push('delete')
      },
      screenshot: async () => new Uint8Array([1, 2]),
    })
    const factory = { createSession: async () => remote }
    const makeSession = () =>
      platform === 'ios'
        ? appiumXcuiTestClient(factory).createSession({})
        : appiumAndroidClient(factory).createSession({})
    const session = await makeSession()
    const other = await makeSession()
    const locator = { using: 'accessibility id', value: 'parent' } as const
    const observed = await session.findElement(locator)
    const foreign = await other.findElement(locator)
    const within = 'findElementWithin' in session ? session.findElementWithin : session.findElementFrom!
    const allWithin = 'findElementsWithin' in session ? session.findElementsWithin : session.findElementsFrom!
    expect(observed.id).toBe(foreign.id)
    await expect(within(foreign, locator)).rejects.toThrow('lost WebDriver element')
    await expect(allWithin(foreign, locator)).rejects.toThrow('lost WebDriver element')
    expect(events).toEqual([])
    expect((await within(observed, { ...locator, value: 'child' })).id).toBe('child')
    expect((await allWithin(observed, { ...locator, value: 'children' })).map(element => element.id)).toEqual(['child'])
    expect((await session.findElements(locator)).map(element => element.id)).toEqual(['shared-id'])
    expect(await observed.getRect!()).toEqual(rect)
    expect(await observed.getText!()).toBe('')
    expect(await observed.getAttribute!('label')).toBe('label')
    expect(await observed.isDisplayed()).toBe(true)
    await observed.click()
    await observed.sendKeys('input')
    expect(await session.screenshot!()).toEqual(new Uint8Array([1, 2]))
    await session.activateApp!('application')
    await session.terminateApp!('application')
    await session.deleteSession()
    expect(events).toEqual([
      'within:child',
      'all-within:children',
      'click:shared-id',
      'type:input',
      'activate:application',
      'terminate:application',
      'delete',
    ])
  })

  test(`${platform} adaptation refuses missing native element bounds`, async () => {
    const remote = stubRemote({ find: async () => wireElement('unbounded', []) })
    const session = await (platform === 'ios' ? appiumXcuiTestClient : appiumAndroidClient)({
      createSession: async () => remote,
    }).createSession({})
    const observed = await session.findElement({ using: 'accessibility id', value: 'unbounded' })
    await expect(observed.getRect!()).rejects.toThrow("Appium did not return bounds for WebDriver element 'unbounded'.")
  })
}

function wireElement(id: string, events: string[], overrides: Partial<AppiumElement> = {}): AppiumElement {
  return {
    id,
    click: async () => {
      events.push(`click:${id}`)
    },
    find: async () => Errors.throwUnexpected('Unexpected element query.'),
    findAll: async () => [],
    getAttribute: async name => name,
    getRect: async () => undefined,
    getText: async () => undefined,
    observe: async () => ({ visible: true }),
    sendKeys: async text => {
      events.push(`type:${text}`)
    },
    visible: async () => true,
    ...overrides,
  }
}

test('Android Back invokes the native keycode instead of typing the word into an input', async () => {
  const scripts: Array<{ args: readonly unknown[]; script: string }> = []
  let keyboardActions = 0
  const remote = stubRemote({
    actions: async () => {
      keyboardActions += 1
    },
    executeScript: async <T>(script: string, args: readonly unknown[] = []): Promise<T> => {
      scripts.push({ args, script })
      return undefined as T
    },
  })
  const session = await appiumAndroidClient({ createSession: async () => remote }).createSession({})
  await session.pressKey('Back')
  expect(scripts).toEqual([{ script: 'mobile: pressKey', args: [{ keycode: 4 }] }])
  expect(keyboardActions).toBe(0)
})

test('iOS target reveal delegates container and direction to XCTest using the exact observed element', async () => {
  const scripts: Array<{ args: readonly unknown[]; script: string }> = []
  const element = { id: 'clipboard-result' } as AppiumElement
  const remote = stubRemote({
    find: async () => element,
    executeScript: async <T>(script: string, args: readonly unknown[] = []): Promise<T> => {
      scripts.push({ args, script })
      return undefined as T
    },
  })
  const session = await appiumXcuiTestClient({ createSession: async () => remote }).createSession({})
  const observed = await session.findElement({ using: 'accessibility id', value: 'Clipboard result' })
  await session.revealElement!(observed)
  expect(scripts).toEqual([{
    script: 'mobile: scrollToElement',
    args: [{ elementId: 'clipboard-result' }],
  }])
})
