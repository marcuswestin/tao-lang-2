import type {
  AppiumCapabilities,
  AppiumElement as WireElement,
  AppiumSession as WireSession,
  AppiumSessionFactory,
} from '@appium-driver'
import { AppiumNoSuchAlertError } from '@appium-driver'
import { Errors } from '@shared'
import type {
  AppiumAndroidClient,
  AppiumAndroidElement,
  AppiumAndroidWebDriverSession,
} from './appium-android/AppiumAndroidController'
import type {
  AppiumElement,
  AppiumWebDriverSession,
  AppiumXcuiTestClient,
} from './appium/AppiumXcuiTestController'

/** Adapts the shared W3C transport to the platform policy kept in the iOS proof controller. */
export function appiumXcuiTestClient(factory: AppiumSessionFactory): AppiumXcuiTestClient {
  return {
    async createSession(capabilities) {
      return iosSession(await factory.createSession(capabilities as AppiumCapabilities))
    },
  }
}

/** Adapts the shared W3C transport to the platform policy kept in the Android proof controller. */
export function appiumAndroidClient(factory: AppiumSessionFactory): AppiumAndroidClient {
  return {
    async createSession(capabilities) {
      return androidSession(await factory.createSession(capabilities as AppiumCapabilities))
    },
  }
}

function iosSession(remote: WireSession): AppiumWebDriverSession {
  const elements = new Map<string, WireElement>()
  const wrap = (element: WireElement): AppiumElement => {
    elements.set(element.id, element)
    return {
      click: async () => await element.click(),
      getAttribute: async name => await element.getAttribute(name),
      getRect: async () => requiredRect(await element.getRect(), element.id),
      getText: async () => await element.getText() ?? '',
      id: element.id,
      isDisplayed: async () => await element.visible(),
      sendKeys: async text => await element.sendKeys(text),
    }
  }
  const wire = (element: AppiumElement): WireElement => elements.get(element.id) ?? unknownElement(element.id)
  return {
    activateApp: async appId => await remote.activateApplication(appId),
    deleteSession: async () => await remote.delete(),
    dismissAlertIfPresent: async () => {
      if (remote.dismissAlert === undefined) {
        return
      }
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        try {
          await remote.dismissAlert()
        } catch (error) {
          if (error instanceof AppiumNoSuchAlertError) {
            return
          }
          throw error
        }
      }
      Errors.throwHostEnvironment(
        'Appium XCUITest could not drain the pre-existing system alert queue after 10 dismissals.',
      )
    },
    findElement: async locator => wrap(await remote.find(locator)),
    findElementFrom: async (scope, locator) => wrap(await wire(scope).find(locator)),
    findElements: async locator =>
      await Promise.all((await remote.findAll(locator)).map(async element => wrap(element))),
    findElementsFrom: async (scope, locator) =>
      await Promise.all((await wire(scope).findAll(locator)).map(async element => wrap(element))),
    id: remote.id,
    openDeepLink: async (url, appId) => await remote.executeScript('mobile: deepLink', [{ bundleId: appId, url }]),
    pressKey: async key => await remote.actions(keyActions(key)),
    screenshot: async () => await remote.screenshot(),
    scroll: async input =>
      await remote.executeScript('mobile: scroll', [{
        ...(input.element === undefined ? {} : { elementId: wire(input.element).id }),
        direction: Math.abs(input.deltaY) >= Math.abs(input.deltaX)
          ? input.deltaY >= 0 ? 'down' : 'up'
          : input.deltaX >= 0
          ? 'right'
          : 'left',
      }]),
    terminateApp: async appId => await remote.terminateApplication(appId),
  }
}

function androidSession(remote: WireSession): AppiumAndroidWebDriverSession {
  const elements = new Map<string, WireElement>()
  const wrap = (element: WireElement): AppiumAndroidElement => {
    elements.set(element.id, element)
    return {
      click: async () => await element.click(),
      getAttribute: async name => await element.getAttribute(name),
      getRect: async () => requiredRect(await element.getRect(), element.id),
      getText: async () => await element.getText() ?? '',
      id: element.id,
      isDisplayed: async () => await element.visible(),
      sendKeys: async text => await element.sendKeys(text),
    }
  }
  const wire = (element: AppiumAndroidElement): WireElement => elements.get(element.id) ?? unknownElement(element.id)
  return {
    activateApp: async appId => await remote.activateApplication(appId),
    deleteSession: async () => await remote.delete(),
    findElement: async locator => wrap(await remote.find(locator)),
    findElementWithin: async (scope, locator) => wrap(await wire(scope).find(locator)),
    findElements: async locator =>
      await Promise.all((await remote.findAll(locator)).map(async element => wrap(element))),
    findElementsWithin: async (scope, locator) =>
      await Promise.all((await wire(scope).findAll(locator)).map(async element => wrap(element))),
    id: remote.id,
    pressKey: async key => await remote.actions(keyActions(key)),
    screenshot: async () => await remote.screenshot(),
    scroll: async input =>
      await remote.executeScript('mobile: scrollGesture', [{
        direction: input.deltaY >= 0 ? 'down' : 'up',
        elementId: input.element === undefined ? undefined : wire(input.element).id,
        percent: 0.75,
      }]),
    terminateApp: async appId => await remote.terminateApplication(appId),
  }
}

function keyActions(key: string): readonly Readonly<Record<string, unknown>>[] {
  return [{
    actions: [
      { duration: 0, type: 'keyDown', value: key },
      { duration: 0, type: 'keyUp', value: key },
    ],
    id: 'keyboard',
    type: 'key',
  }]
}

function unknownElement(id: string): never {
  return Errors.throwUnexpected(`Appium platform adapter lost WebDriver element '${id}'.`)
}

function requiredRect(rect: Awaited<ReturnType<WireElement['getRect']>>, id: string): NonNullable<typeof rect> {
  return rect ?? Errors.throwUnexpected(`Appium did not return bounds for WebDriver element '${id}'.`)
}
