import { Errors, FS, Platform, Repo } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { StudioCdp } from '@studio-tooling/StudioCdp'
import { type DevLoopReceipt, readDevLoopReceipt } from './DevLoopStore'

export function managedChromePageMatches(expected: string, actual: string): boolean {
  try {
    const target = new URL(expected)
    const page = new URL(actual)
    return target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port !== ''
      && page.origin === target.origin && page.pathname === target.pathname
      && page.username === '' && page.password === ''
  } catch {
    return false
  }
}

const inputSelector = '[data-testid="workspaceName"] input, input[data-testid="workspaceName"]'

/** Revalidate exact origin/path and fixture controls immediately before every page mutation. */
export async function assertManagedChromePage(cdp: Pick<StudioCdp, 'evaluate'>, expected: string): Promise<void> {
  const page = await cdp.evaluate<{ url: string; bounded: boolean }>(`({
    url: location.href,
    bounded: document.querySelectorAll(${JSON.stringify(inputSelector)}).length === 1
      && document.querySelectorAll('[data-testid="addWorkspace"]').length === 1
      && document.body.innerText.includes('Data MVP')
  })`)
  if (!managedChromePageMatches(expected, page.url) || !page.bounded) {
    Errors.throwHostEnvironment('The attached Chrome page or bounded fixture controls do not match the managed target.')
  }
}

/** The awaited page inspection can revoke ownership; check it again before performing the action. */
export async function runCurrentManagedChromeAction<T>(
  cdp: Pick<StudioCdp, 'evaluate'>,
  expected: string,
  assertCurrent: () => Promise<void>,
  perform: () => Promise<T>,
): Promise<T> {
  await assertManagedChromePage(cdp, expected)
  await assertCurrent()
  return perform()
}

/** Attach only to the Chrome published by this ready generation; the CDP client never owns it. */
export async function runManagedLoopChromeInteraction(options: {
  receipt: DevLoopReceipt
  artifactRoot: string
  phase: string
  assertCurrent: () => Promise<void>
  attach?: typeof StudioCdp.attach
}): Promise<{ screenshotPaths: string[]; rowName: string; consoleErrors: unknown; browserPreserved: boolean }> {
  const receipt = options.receipt
  const browser = receipt.targets?.find(target => target.target === 'web' && target.dispatched)?.browser
  if (
    browser?.process === undefined || receipt.controller === undefined || receipt.selection === undefined
    || receipt.url === undefined
  ) {
    Errors.throwHostEnvironment(
      'Managed Chrome did not publish its exact process/profile/target identity; attachment is blocked.',
    )
  }
  if (!managedChromePageMatches(receipt.url, receipt.url)) {
    Errors.throwHostEnvironment('The managed Chrome app URL must be a bounded loopback HTTP target.')
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(browser.devToolsUrl)) {
    Errors.throwHostEnvironment('Managed Chrome DevTools must be the published loopback endpoint.')
  }
  const profile = await FS.realPath(browser.profile)
  const boundaries = [FS.resolvePath('.tao', receipt.selection.projectRoot), Repo.resolvePath('.artifacts/dev/chrome')]
  if (!boundaries.some(boundary => FS.pathIsWithin(profile, boundary) && profile !== boundary)) {
    Errors.throwHostEnvironment('Managed Chrome profile is outside the selected project launch boundary.')
  }
  const process = browser.process
  const controller = receipt.controller
  const assertCurrent = async (): Promise<void> => {
    const port = Number((await FS.readText(FS.resolvePath('DevToolsActivePort', profile))).split(/\r?\n/u)[0])
    if (browser.devToolsUrl !== `http://127.0.0.1:${port}`) {
      Errors.throwHostEnvironment('Managed Chrome profile does not publish the recorded DevTools endpoint.')
    }
    await options.assertCurrent()
    const current = await readDevLoopReceipt(receipt.session)
    if (
      current.state !== 'ready' || current.generation !== receipt.generation
      || !ProcessTree.sameProcess(current.controller, controller)
    ) {
      Errors.throwHostEnvironment('Managed Chrome generation/controller changed; attachment is revoked.')
    }
    // No await follows this final kernel inspection before the guarded CDP action.
    const kernel = ProcessTree.identities([process.pid, controller.pid])
    if (
      !ProcessTree.sameProcess(kernel.get(process.pid), process)
      || !ProcessTree.sameProcess(kernel.get(controller.pid), controller)
    ) {
      Errors.throwHostEnvironment('Managed Chrome kernel identity changed; attachment is revoked.')
    }
    const launch = ProcessTree.processTable().find(entry => entry.pid === process.pid)
    if (launch === undefined || !launch.command.includes(`--user-data-dir=${profile}`)) {
      Errors.throwHostEnvironment('The published Chrome process does not own the recorded profile launch argument.')
    }
  }
  await assertCurrent()
  const source = await FS.readText(receipt.selection.appPath)
  const fixture = await FS.readText(Repo.resolvePath('Apps/Test Apps/Data MVP/Data MVP.tao'))
  if (receipt.selection.appName !== 'DataMVPApp' || source !== fixture) {
    Errors.throwHostEnvironment('The finite Chrome interaction requires the unchanged DataMVPApp Memory fixture.')
  }
  await assertCurrent()
  const cdp = await (options.attach ?? StudioCdp.attach)({
    artifactRoot: options.artifactRoot,
    baseUrl: browser.devToolsUrl,
    // StudioCdp's selector uses startsWith; a complete origin plus slash cannot match another port.
    targetUrlPrefix: `${new URL(receipt.url).origin}/`,
  })
  const action = <T>(perform: () => Promise<T>): Promise<T> =>
    runCurrentManagedChromeAction(cdp, receipt.url!, assertCurrent, perform)
  const screenshotPaths: string[] = []
  const rowName = `Managed acceptance ${receipt.session.slice(0, 8)} ${options.phase} ${
    Platform.randomUUID().slice(0, 8)
  }`
  // Source tags decorate the Tao field wrapper; address the actual editable web control.
  let created = false
  try {
    await assertCurrent()
    await cdp.waitFor(`document.querySelector(${JSON.stringify(inputSelector)}) !== null`, { timeoutMs: 30_000 })
    screenshotPaths.push(await action(() => cdp.captureScreenshot(`${options.phase}-before`)))
    await action(() => cdp.click(inputSelector))
    await action(() => cdp.pressShortcut('a'))
    await action(() => cdp.insertText(rowName))
    created = true
    await action(() => cdp.click('[data-testid="addWorkspace"]'))
    await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(rowName)})`, { timeoutMs: 30_000 })
    screenshotPaths.push(await action(() => cdp.captureScreenshot(`${options.phase}-after`)))
    const consoleErrors = cdp.browserFailures()
    if (consoleErrors.length > 0) {
      Errors.throwHostEnvironment('Managed Chrome reported browser console/runtime failures during fixture input.')
    }
    await removeRow()
    return { screenshotPaths, rowName, consoleErrors, browserPreserved: true }
  } finally {
    try {
      if (created) {
        await removeRow()
      }
    } finally {
      await cdp.close()
      await assertCurrent()
    }
  }

  async function removeRow(): Promise<void> {
    // Give only the unique created row a disposable selector; clicking still uses physical CDP input.
    const found = await action(() =>
      cdp.evaluate<boolean>(`(() => {
      const buttons = [...document.querySelectorAll('[data-testid="deleteWorkspace"]')]
      const button = buttons.find(candidate => candidate.parentElement?.textContent.includes(${
        JSON.stringify(rowName)
      }))
      if (!button) return false
      button.setAttribute('data-managed-acceptance-row', ${JSON.stringify(rowName)})
      return true
    })()`)
    )
    if (!found) {
      Errors.throwHostEnvironment('The created workspace row could not be uniquely located for cleanup.')
    }
    await action(() => cdp.click(`[data-managed-acceptance-row=${JSON.stringify(rowName)}]`))
    await cdp.waitFor(`!document.body.innerText.includes(${JSON.stringify(rowName)})`, { timeoutMs: 30_000 })
    created = false
  }
}
