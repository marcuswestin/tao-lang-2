import type {
  AppiumCapabilities,
  AppiumElement as WireElement,
  AppiumSession as WireSession,
  AppiumSessionFactory,
} from '@appium-driver'
import { AppiumNoSuchAlertError } from '@appium-driver'
import { Errors, FS } from '@shared'
import type { DevLoopMobilePublication } from '@shared/DevLoopControl'
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
import type { ManagedMobileGrant } from './ManagedMobileGrant'

/** Only an invocation-owned target can supply this assertion before identity is observed. */
export type ManagedHandshakeDiagnostics = Readonly<{
  artifactRoot: string
  assertOwnedTargetCurrent: () => Promise<void>
}>

/** Adapts the shared W3C transport to the platform policy kept in the iOS proof controller. */
export function appiumXcuiTestClient(
  factory: AppiumSessionFactory,
  managed?: ManagedMobileGrant,
): AppiumXcuiTestClient {
  return {
    async createSession(capabilities) {
      const remote = await factory.createSession(capabilities as AppiumCapabilities)
      if (managed !== undefined) {
        await bindManagedRuntime(remote, managed)
      }
      return iosSession(remote)
    },
  }
}

/** Adapts the shared W3C transport to the platform policy kept in the Android proof controller. */
export function appiumAndroidClient(
  factory: AppiumSessionFactory,
  managed?: ManagedMobileGrant,
  diagnostics?: ManagedHandshakeDiagnostics,
): AppiumAndroidClient {
  return {
    async createSession(capabilities) {
      const remote = await factory.createSession(capabilities as AppiumCapabilities)
      if (managed !== undefined) {
        await bindManagedRuntime(remote, managed, diagnostics)
      }
      const adapted = androidSession(remote)
      return managed?.identity.runtime.kind === 'expo-go'
        ? { ...adapted, prepareManagedRuntime: async () => await prepareManagedExpoTutorial(remote, managed) }
        : adapted
    },
  }
}

async function bindManagedRuntime(
  remote: WireSession,
  grant: ManagedMobileGrant,
  diagnostics?: ManagedHandshakeDiagnostics,
): Promise<void> {
  const observe = async () => {
    if (remote.readManagedRuntimeIdentity === undefined) {
      Errors.throwHostEnvironment('The attached mobile driver cannot identify its foreground runtime.')
    }
    const { appId, label } = await remote.readManagedRuntimeIdentity(
      grant.identity.target.platform,
      grant.identity.runtime.appId,
    )
    if (appId !== grant.identity.runtime.appId) {
      Errors.throwHostEnvironment('The attached mobile runtime does not match the dispatched application identifier.')
    }
    let mounted: (DevLoopMobilePublication & { devUrl?: string }) | undefined
    try {
      mounted = JSON.parse(label ?? '') as typeof mounted
    } catch { /* Missing marker fails below. */ }
    const expected = grant.identity.runtime
    if (mounted?.devUrl === undefined || devServerOrigin(mounted.devUrl) !== devServerOrigin(expected.devUrl)) {
      Errors.throwHostEnvironment('The mounted managed mobile runtime has a different development server URL.')
    }
    for (
      const field of [
        'session',
        'checkout',
        'loopGeneration',
        'projectRoot',
        'appName',
        'sourceRevision',
        'compiledRevision',
        'nonce',
      ] as const
    ) {
      if (mounted?.[field] !== expected[field]) {
        Errors.throwHostEnvironment(`The mounted managed mobile runtime has a different ${field}.`)
      }
    }
  }
  // The controller verifies this observer after recording the created session, so a failed
  // handshake follows its ordinary fenced deletion and port-retention path.
  if (diagnostics === undefined) {
    grant.bindRuntimeObserver(observe)
  } else {
    let initial = true
    grant.bindRuntimeObserver(async () => {
      const first = initial
      initial = false
      try {
        await observe()
      } catch (error) {
        if (first) {
          // A failed diagnostic never replaces the original handshake failure or its cleanup path.
          try {
            await captureHandshakeFailure(remote, grant, diagnostics)
          } catch { /* Refused, cancelled, oversized or unavailable diagnostics remain unproved. */ }
        }
        throw error
      }
    })
  }
}

/** A known Expo tutorial may be dismissed only after the mounted runtime has been proved. */
async function prepareManagedExpoTutorial(remote: WireSession, grant: ManagedMobileGrant): Promise<void> {
  const appId = grant.identity.runtime.appId
  if (!/^[A-Za-z0-9_.]+$/u.test(appId)) {
    Errors.throwHostEnvironment('Managed Expo package identity is invalid.')
  }
  const compose = `//androidx.compose.ui.platform.ComposeView[@package='${appId}' and @displayed='true']`
  const content = `//*[@package='${appId}' and @resource-id='android:id/content']`
  const tutorialText = 'This is the developer menu. It gives you access to useful tools in your development builds.'
  const instructionText = 'You can press ⌘ + m on macOS or Ctrl + m on other platforms to get back to it at any time.'
  const tutorial = `${compose}//android.view.View[android.widget.TextView[@text='Tao Runtime']]`
    + `[android.widget.TextView[starts-with(@text, 'SDK version: ')]]`
    + `[android.widget.ScrollView//android.widget.TextView[@text='${tutorialText}']]`
    + `[android.widget.ScrollView//android.widget.TextView[@text='${instructionText}']]`
    + `/android.widget.ScrollView/android.view.View/android.view.View[@clickable='true' and @displayed='true']`
    + `[android.widget.TextView[@text='Continue']][android.widget.Button]`
  // The captured tutorial uses a displayed FrameLayout directly beneath hierarchy.
  // Other visible roots must contain the mounted marker, rather than merely a content node.
  const roots = `/hierarchy/*[@displayed='true']`
  const ownRoot = `${roots}[self::android.widget.FrameLayout and @package='${appId}']`
  const runtimeRoot = `${ownRoot}[.//*[@package='${appId}' and @resource-id='android:id/content']]`
    + `[.//*[@package='${appId}' and starts-with(@resource-id, 'tao-managed-loop-identity.')]]`
  const tutorialRoot = `${ownRoot}[${tutorial.replace(/^\/\//u, './/')}]`
  const systemId = (name: string) => `@resource-id='com.android.systemui:id/${name}'`
  const statusBar = `/android.widget.FrameLayout[${systemId('status_bar_container')}]`
    + `/android.widget.FrameLayout[${systemId('status_bar')}]`
  // The captured animation container is a direct sibling of the container/bar/contents chain.
  // A system package alone never recognizes a window: every node must be non-input and the
  // one captured bar must occupy the same thin origin strip as its root.
  const statusRoot = `${roots}[self::android.widget.FrameLayout and @package='com.android.systemui']`
    + `[@clickable='false' and @focusable='false']`
    + `[not(.//*[not(@package='com.android.systemui' and @clickable='false' and @focusable='false')])]`
    + `[count(android.widget.FrameLayout[${systemId('status_bar_launch_animation_container')}])=1]`
    + `[count(.//*[${systemId('status_bar')}])=1]`
    + `[${statusBar.slice(1)}/android.widget.LinearLayout[${systemId('status_bar_contents')}]]`
  const inspect = async (value: string, maximum = 2) => {
    await grant.assertCurrent()
    const elements = await remote.findAll({ using: 'xpath', value }, 32_768)
    await grant.assertCurrent()
    if (elements.length > maximum) {
      Errors.throwHostEnvironment('Managed Expo window inspection is ambiguous.')
    }
    return elements
  }
  const inspectRoots = async () => {
    const visible = await inspect(roots, 3)
    const runtime = await inspect(runtimeRoot)
    const recognizedTutorial = await inspect(tutorialRoot)
    const status = await inspect(statusRoot, 1)
    if (status.length === 1) {
      const bars = await inspect(`${statusRoot}${statusBar}`, 1)
      if (bars.length !== 1) {
        Errors.throwHostEnvironment('Managed Expo preparation refused an ambiguous system status bar.')
      }
      await grant.assertCurrent()
      const rootBounds = await status[0]!.getAttribute('bounds')
      const barBounds = await bars[0]!.getAttribute('bounds')
      await grant.assertCurrent()
      const bounds = /^\[0,0\]\[([1-9]\d*),([1-9]\d*)\]$/u.exec(rootBounds ?? '')
      const width = Number(bounds?.[1])
      const height = Number(bounds?.[2])
      // No viewport API is available here. The captured 1080x63 bar fits this conservative
      // physical-pixel cap; taller strips or a height above one eighth of width stay unknown.
      if (
        bounds === null || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || height > 96 || height * 8 > width || rootBounds !== barBounds
      ) {
        Errors.throwHostEnvironment('Managed Expo preparation refused an unproved system status bar strip.')
      }
    }
    const recognized = new Set([...runtime, ...recognizedTutorial, ...status].map(element => element.id))
    const actual = new Set(visible.map(element => element.id))
    if (
      visible.length < 1 || actual.size !== visible.length || runtime.length !== 1
      || recognizedTutorial.length > 1 || actual.size !== recognized.size
      || visible.some(element => !recognized.has(element.id))
    ) {
      Errors.throwHostEnvironment('Managed Expo preparation refused an unrecognized visible window root.')
    }
  }
  await inspectRoots()
  const windows = await inspect(content)
  const overlays = await inspect(compose)
  if (overlays.length === 0 && windows.length === 1) {
    return
  }
  if (overlays.length !== 1 || windows.length < 1 || windows.length > 2) {
    Errors.throwHostEnvironment('Managed Expo preparation refused an unknown overlay.')
  }
  const controls = await inspect(tutorial)
  if (controls.length !== 1 || !await controls[0]!.visible()) {
    Errors.throwHostEnvironment('Managed Expo preparation did not identify one recognized tutorial control.')
  }
  await inspectRoots()
  await grant.assertCurrent()
  await controls[0]!.click()
  await grant.assertCurrent()
  await inspectRoots()
  if ((await inspect(compose)).length !== 0 || (await inspect(content)).length !== 1) {
    Errors.throwHostEnvironment('Managed Expo tutorial dismissal did not prove an unobstructed runtime.')
  }
}

async function captureHandshakeFailure(
  remote: WireSession,
  grant: ManagedMobileGrant,
  diagnostics: ManagedHandshakeDiagnostics,
): Promise<void> {
  if (grant.identity.target.platform !== 'android' || remote.captureManagedHandshakeDiagnostics === undefined) {
    return
  }
  const cancellation = new AbortController()
  const signal = AbortSignal.any([grant.signal, cancellation.signal])
  const timeout = setTimeout(() => cancellation.abort(), 10_000)
  let onAbort: (() => void) | undefined
  const assertCurrent = async () => {
    signal.throwIfAborted()
    await grant.assertRequestCurrent()
    await diagnostics.assertOwnedTargetCurrent()
    signal.throwIfAborted()
  }
  try {
    const capture = async () => {
      await assertCurrent()
      const result = await remote.captureManagedHandshakeDiagnostics!({
        expectedAppId: grant.identity.runtime.appId,
        signal,
        assertCurrent,
      })
      await assertCurrent()
      // Recheck bounds even for an injected session implementation before making any files.
      if (
        Buffer.byteLength(result.source, 'utf8') > 2 * 1024 * 1024 || result.screenshot.byteLength > 10 * 1024 * 1024
      ) {
        Errors.throwHostEnvironment('Managed handshake diagnostics exceeded their private artifact limits.')
      }
      const directory = await FS.mkTmpDir(FS.resolvePath('managed-handshake-', diagnostics.artifactRoot))
      await assertCurrent()
      await FS.writeExclusiveFile(
        FS.resolvePath('diagnostic.json', directory),
        JSON.stringify({
          classification: 'runtime-identity-unproved',
          sourceIdentityProved: false,
          inputPerformed: false,
          captures: ['handshake.xml', 'handshake.png'],
        }),
        { mode: 0o600 },
      )
      await assertCurrent()
      await FS.writeExclusiveFile(FS.resolvePath('handshake.xml', directory), result.source, { mode: 0o600 })
      await assertCurrent()
      await FS.writeExclusiveFile(FS.resolvePath('handshake.png', directory), result.screenshot, { mode: 0o600 })
    }
    await Promise.race([
      capture(),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Errors.HostEnvironmentError('Managed handshake diagnostics were cancelled.'))
        if (signal.aborted) {
          onAbort()
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }),
    ])
  } finally {
    clearTimeout(timeout)
    cancellation.abort()
    if (onAbort !== undefined) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

function devServerOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    const nested = parsed.searchParams.get('url')
    if (nested !== null) {
      return devServerOrigin(nested)
    }
    if (parsed.protocol === 'exp:' || parsed.protocol === 'exps:') {
      return new URL(url.replace(/^exp(s?):/u, (_match, secure: string) => secure === 's' ? 'https:' : 'http:')).origin
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin
    }
  } catch { /* Refuse an unidentifiable dispatch URL. */ }
  return Errors.throwHostEnvironment('The managed mobile development server URL is unidentifiable.')
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
    revealElement: async element =>
      await remote.executeScript('mobile: scrollToElement', [{ elementId: wire(element).id }]),
    scroll: async input =>
      await remote.executeScript('mobile: scroll', [{
        ...(input.element === undefined ? {} : { elementId: wire(input.element).id }),
        direction: scrollDirection(input),
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
    pressKey: async key =>
      key === 'Back'
        ? await remote.executeScript('mobile: pressKey', [{ keycode: 4 }])
        : await remote.actions(keyActions(key)),
    screenshot: async () => await remote.screenshot(),
    scroll: async input =>
      await remote.executeScript('mobile: scrollGesture', [{
        direction: scrollDirection(input),
        elementId: input.element === undefined ? undefined : wire(input.element).id,
        percent: 0.75,
      }]),
    terminateApp: async appId => await remote.terminateApplication(appId),
  }
}

/** Both Appium backends choose the dominant axis; vertical wins a tie, including a zero gesture. */
function scrollDirection(input: Readonly<{ deltaX: number; deltaY: number }>): 'down' | 'left' | 'right' | 'up' {
  if (Math.abs(input.deltaY) >= Math.abs(input.deltaX)) {
    return input.deltaY >= 0 ? 'down' : 'up'
  }
  return input.deltaX >= 0 ? 'right' : 'left'
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
