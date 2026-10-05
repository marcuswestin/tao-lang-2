import { Errors, FS, Platform, readFirebaseConnections, Repo, Time } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { StudioCdp } from '@studio-tooling/StudioCdp'
import type { ManagedFirebaseWeb } from '../../../../testing/e2e-testing/native/ManagedFirebaseFixture'
import { type DevLoopReceipt, readDevLoopReceipt } from './DevLoopStore'
import { managedChromePageMatches } from './ManagedLoopAcceptanceChrome'

// This finite authorization names reviewed source bytes; comments cannot vouch for changed actions or namespaces.
const reviewedFirebaseSources = [
  ['App.tao', '9766c64ca4fb02585633dc9c9457748e6f9b02416935e3a49d0b9e7e3ac6ff52'],
  ['Auth.tao', 'a54f7eefe96df2633cf420be934f970b9dc179c071c10ee0d9a9937f33712b59'],
  ['Items/Items.tao', '6a312988e845c1b03e38a5bae2923ecf53477443a2f5523b0581407d38267fe9'],
  ['Data.tao', '51640ffc436f98f4186f40e93719e548a6357ac9f888edd23c2c7bb4e904a46c'],
] as const
const reviewedFirebaseConnection = '19023f690abce9270fbce5b3ebaf78be7106cc5ffbcdf31d9213317a0762e591'

/** This proof may use only the fresh, task-authored Firebase app and its existing public test project. */
export async function assertManagedFirebaseSubject(
  receipt: Pick<DevLoopReceipt, 'checkout' | 'selection'>,
): Promise<void> {
  const projectRoot = FS.resolvePath('Apps/Firebase Live Acceptance', receipt.checkout)
  const selection = receipt.selection
  if (
    selection?.appName !== 'FirebaseLiveAcceptance' || selection.projectRoot !== projectRoot
    || selection.appPath !== FS.resolvePath('App.tao', projectRoot)
  ) {
    Errors.throwHostEnvironment(
      'Firebase sync is restricted to Apps/Firebase Live Acceptance / FirebaseLiveAcceptance.',
    )
  }
  const sourceMatches = await Promise.all(
    reviewedFirebaseSources.map(async ([path, hash]) =>
      Platform.sha256Hex(await FS.readText(FS.resolvePath(path, projectRoot))) === hash
    ),
  )
  const connection = await readFirebaseConnections(projectRoot)
  if (
    !sourceMatches.every(Boolean) || connection === undefined
    || Platform.sha256Hex(JSON.stringify({
        apiKey: connection.apiKey,
        appId: connection.appId,
        projectId: connection.projectId,
      })) !== reviewedFirebaseConnection
  ) {
    Errors.throwHostEnvironment(
      'The fixed Firebase acceptance subject, provider, namespace or sample shortcuts changed.',
    )
  }
}

/** Attach to this generation's Chrome only; never launch, navigate, or supply authentication values. */
export async function openManagedFirebaseWeb(options: {
  receipt: DevLoopReceipt
  artifactRoot: string
  assertCurrent: () => Promise<void>
  attach?: typeof StudioCdp.attach
}, observations: {
  receipt?: typeof readDevLoopReceipt
  identities?: typeof ProcessTree.identities
  processTable?: typeof ProcessTree.processTable
} = {}): Promise<ManagedFirebaseWeb> {
  const { receipt } = options
  await assertManagedFirebaseSubject(receipt)
  const browser = receipt.targets?.find(target => target.target === 'web' && target.dispatched)?.browser
  if (
    browser?.process === undefined || receipt.controller === undefined || receipt.url === undefined
    || !managedChromePageMatches(receipt.url, receipt.url)
    || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(browser.devToolsUrl)
  ) {
    Errors.throwHostEnvironment('Firebase sync requires this ready generation’s exact managed Chrome identity.')
  }
  const profile = await FS.realPath(browser.profile)
  const boundaries = [FS.resolvePath('.tao', receipt.selection!.projectRoot), Repo.resolvePath('.artifacts/dev/chrome')]
  if (!boundaries.some(boundary => FS.pathIsWithin(profile, boundary) && profile !== boundary)) {
    Errors.throwHostEnvironment('Firebase Chrome profile is outside its managed launch boundary.')
  }
  const process = browser.process
  const controller = receipt.controller
  const assertCurrent = async (): Promise<void> => {
    const port = Number((await FS.readText(FS.resolvePath('DevToolsActivePort', profile))).split(/\r?\n/u)[0])
    if (browser.devToolsUrl !== `http://127.0.0.1:${port}`) {
      Errors.throwHostEnvironment('Firebase Chrome DevTools identity changed.')
    }
    await options.assertCurrent()
    const current = await (observations.receipt ?? readDevLoopReceipt)(receipt.session)
    if (
      current.state !== 'ready' || current.generation !== receipt.generation
      || !ProcessTree.sameProcess(current.controller, controller)
      || current.selection?.projectRoot !== receipt.selection!.projectRoot
      || current.selection?.appName !== receipt.selection!.appName
    ) {
      Errors.throwHostEnvironment('Firebase sync loop generation or selection changed.')
    }
    await assertManagedFirebaseSubject(receipt)
    const kernel = (observations.identities ?? ProcessTree.identities)([process.pid, controller.pid])
    const launch = (observations.processTable ?? ProcessTree.processTable)().find(entry => entry.pid === process.pid)
    if (
      !ProcessTree.sameProcess(kernel.get(process.pid), process)
      || !ProcessTree.sameProcess(kernel.get(controller.pid), controller)
      || launch === undefined || !launch.command.includes(`--user-data-dir=${profile}`)
    ) {
      Errors.throwHostEnvironment('Firebase Chrome or controller process identity changed.')
    }
  }
  await assertCurrent()
  const cdp = await (options.attach ?? StudioCdp.attach)({
    artifactRoot: options.artifactRoot,
    baseUrl: browser.devToolsUrl,
    targetUrlPrefix: `${new URL(receipt.url).origin}/`,
  })
  const guard = async (): Promise<void> => {
    const page = await cdp.evaluate<{ url: string; bounded: boolean }>(`({
      url: location.href,
      bounded: document.body.innerText.includes('Firebase Live Acceptance')
        && (document.querySelectorAll('[data-testid="fillMainAccount"]').length === 1
          || document.querySelectorAll('[data-testid="addItem"]').length === 1
          || document.querySelectorAll('[data-testid="signOut"]').length === 1)
    })`)
    if (!managedChromePageMatches(receipt.url!, page.url) || !page.bounded) {
      Errors.throwHostEnvironment('The attached page is not the bounded Firebase acceptance app.')
    }
    await assertCurrent()
  }
  const action = async <T>(perform: () => Promise<T>): Promise<T> => {
    await guard()
    return await perform()
  }
  const waitTag = async (tag: 'itemTitle' | 'fillMainAccount'): Promise<void> => {
    const found = await Time.pollUntil(async () => {
      await assertCurrent()
      const page = await cdp.evaluate<{ url: string; found: boolean }>(`({
        url: location.href, found: document.querySelectorAll('[data-testid="${tag}"]').length === 1
      })`)
      if (!managedChromePageMatches(receipt.url!, page.url)) {
        Errors.throwHostEnvironment('Firebase acceptance page changed while observing readiness.')
      }
      return page.found ? true : undefined
    }, { timeoutMs: 30_000, intervalMs: 250 })
    if (found === undefined) {
      Errors.throwHostEnvironment('Firebase account creation or sign-in did not reach the expected page.')
    }
  }
  const click = async (
    tag: 'signOut' | 'fillCrudAccount' | 'fillMainAccount' | 'createAccount' | 'signIn' | 'addItem',
  ) => {
    await action(() => cdp.click(`[data-testid="${tag}"]`))
  }
  const signOut = async (): Promise<void> => {
    const present = await action(() =>
      cdp.evaluate<boolean>("document.querySelector('[data-testid=signOut]') !== null")
    )
    if (present) {
      await click('signOut')
    }
    await waitTag('fillMainAccount')
  }
  const input = '[data-testid="itemTitle"] input, input[data-testid="itemTitle"]'
  return {
    createCrudAccount: async () => {
      await signOut()
      await click('fillCrudAccount')
      await click('createAccount')
      const result = await Time.pollUntil(async () => {
        await guard()
        return await cdp.evaluate<'created' | 'existing-account-signin' | undefined>(`(() => {
          if (document.querySelector('[data-testid="itemTitle"]')) return 'created'
          if (document.body.innerText.includes('An account with this email already exists. Sign in instead.')) {
            return 'existing-account-signin'
          }
        })()`)
      }, { timeoutMs: 30_000, intervalMs: 250 })
      if (result === undefined) {
        Errors.throwHostEnvironment(
          'Firebase web signup reached neither account data nor the explicit existing-account notice.',
        )
      }
      if (result === 'existing-account-signin') {
        await click('signIn')
        await waitTag('itemTitle')
      }
      return result
    },
    signInMainAccount: async () => {
      await signOut()
      await click('fillMainAccount')
      await click('signIn')
      await waitTag('itemTitle')
    },
    createItem: async marker => {
      await action(() => cdp.click(input))
      await action(() => cdp.pressShortcut('a'))
      await action(() => cdp.insertText(marker))
      await click('addItem')
    },
    observeItem: async marker => {
      const text = await Time.pollUntil(async () => {
        await guard()
        return await cdp.evaluate<string | undefined>(`(() => {
          const scope = document.querySelector('[data-testid="items"]')
          const row = [...(scope?.querySelectorAll('*') ?? [])].find(node => node.textContent === ${
          JSON.stringify(marker)
        })
          return row?.textContent ?? undefined
        })()`)
      }, { timeoutMs: 30_000, intervalMs: 250 })
      if (text !== marker) {
        Errors.throwHostEnvironment('Firebase web did not render the exact native-created item marker.')
      }
      return text
    },
    screenshot: name => action(() => cdp.captureScreenshot(name)),
    close: async () => {
      const failures = cdp.browserFailures()
      await cdp.close()
      await assertCurrent()
      if (failures.length > 0) {
        Errors.throwHostEnvironment('Firebase web reported browser runtime failures during the sync proof.')
      }
    },
  }
}
