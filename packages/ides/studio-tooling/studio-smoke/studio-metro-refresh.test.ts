import { Errors, FS, HCI, ProjectIdentity, Repo, Time, VerificationTimeouts } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

// The three claims only a live Metro can prove, in one Studio launch and one browser: a file created
// after Metro started is discovered and served, Fast Refresh applies a source edit without
// remounting, and a Draw action after a Code save's refresh carries the saved source's version.

type StudioLaunch = Awaited<ReturnType<typeof startStudioSmokeLaunch>>

const mainSource = `use Col, Number, Text from @tao/ui

app RefreshSmoke { id "refreshsmoke" version "1.0.0" name "RefreshSmoke" view MainView }

view MainView() {
   state Count = 0
   render Col() {
      Number(Count)
      Text("First")
      Text("Second")
      Text("Third")
}  }

fixture Empty { }
scenarios MainView "states" {
   fixture Empty
   device phone
   scenario "default" { render MainView() }
}
`

const addedModuleSource = `use Text from @tao/ui

folder view AddedNote() {
   render Text("Added module")
}
`

const countText = (count: number) =>
  `[...document.querySelectorAll('[data-tao-studio]')].some(element => element.textContent?.trim() === '${count}')`

Test('Studio Metro serves new modules, fast-refreshes edits, and draws after a Code save', async () => {
  const repositoryRoot = Repo.getRoot()
  const projectRoot = await mkTestDir('tao-studio-metro-refresh-')
  const sourcePath = FS.resolvePath('RefreshSmoke.tao', projectRoot)
  let browser: StudioCdp | undefined
  let studio: StudioLaunch | undefined
  try {
    await FS.writeText(sourcePath, mainSource)
    await FS.mkdir(FS.resolvePath('.tao', projectRoot))
    await ProjectIdentity.ensure(projectRoot)
    studio = await startStudioSmokeLaunch({
      appName: 'RefreshSmoke',
      previewPublication: 'off',
      projectRoot,
      repositoryRoot,
    })
    const previewUrl = studio.readiness.previewUrl
    if (previewUrl === undefined) {
      Errors.throwUnexpected('The browser Studio launch did not advertise its Metro preview URL.')
    }
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    await activateSmokePreviews(browser)
    await browser.waitFor(`document.querySelector('.studio-preview-cell iframe') instanceof HTMLIFrameElement`)
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('First') === true`)
    await browser.click('[data-preset="design"]')
    const initialRevision = await waitForCompileAfter(browser, -1)

    // Claim 1: a module file created after Metro started is discovered and served. The file lands on
    // disk first; an editor save then references it from the main view.
    await FS.writeText(FS.resolvePath('AddedNote.tao', projectRoot), addedModuleSource)
    await replaceEditorSource(
      browser,
      mainSource
        .replace('use Col, Number, Text from @tao/ui', 'use Col, Number, Text from @tao/ui\nuse AddedNote from ./')
        .replace('Text("Third")', 'Text("Third")\n      AddedNote()'),
    )
    await waitForSaved(browser, sourcePath, 'AddedNote()')
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('Added module') === true`)
    const addedRevision = await waitForCompileAfter(browser, initialRevision)

    // Claim 2: Fast Refresh applies an edit without remounting. The edit changes Count's initial
    // value, so a remount would show 5; the retained component still holds the 0 it mounted with.
    await installRemountProbes(browser, previewUrl)
    Expect(await browser.evaluateInFrame<boolean>(previewUrl, countText(0))).toBe(true)
    const addedSource = await FS.readText(sourcePath)
    await replaceEditorSource(
      browser,
      addedSource
        .replace('state Count = 0', 'state Count = 5')
        .replace('Text("Third")', 'Text("Third")\n      Text("Updated")'),
    )
    await waitForSaved(browser, sourcePath, 'Text("Updated")')
    await waitForCompileAfter(browser, addedRevision)
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('Updated') === true`)
    Expect(await browser.evaluateInFrame<boolean>(previewUrl, countText(0))).toBe(true)
    Expect(await browser.evaluateInFrame<boolean>(previewUrl, countText(5))).toBe(false)
    Expect(await browser.evaluateInFrame(previewUrl, 'window.__taoMetroRefreshProbe')).toEqual({
      sawEmptyRoot: false,
      sawPending: false,
      token: 'retained-preview-realm',
    })
    Expect(await browser.evaluate<number>('window.__taoMetroRefreshFrameLoads')).toBe(0)

    // Claim 3: Draw after Code. The Code save's Metro refresh re-bootstraps the cell, which must keep
    // the saved source's version rather than the byte-stable marker's first one.
    await browser.evaluateInFrame(
      previewUrl,
      `(() => {
      window.__taoMetroRefreshMode = 'pending'
      window.addEventListener('message', event => {
        if (event.data?.type === 'set-interaction-mode') window.__taoMetroRefreshMode = event.data.mode
      })
      return true
    })()`,
    )
    await setInteractionMode(browser, 'edit')
    await browser.waitForInFrame(previewUrl, `window.__taoMetroRefreshMode === 'edit'`)
    await focusFirstPreview(browser)
    await browser.evaluate(`(() => {
      window.__taoMetroRefreshActions = []
      window.addEventListener('message', event => {
        if (event.data?.type === 'source-action') window.__taoMetroRefreshActions.push(event.data)
      })
      return true
    })()`)
    await Time.sleep(500)
    await dragRenderBetween(browser, previewUrl, 'Updated', 'First', 'Second')
    const order = await waitForSourceOrder(sourcePath, ['Text("First")', 'Text("Updated")', 'Text("Second")'])
    if (!order.inOrder) {
      // The server refuses a Draw carrying a stale source version, so the order never changes: that is
      // a product regression, so it fails as an assertion, carrying what the page sent and showed.
      const actions = await browser.evaluate('window.__taoMetroRefreshActions')
      const status = await browser.evaluate(`document.querySelector('.studio-status')?.textContent`)
      Expect({ drawSaved: false, actions, status, source: order.source })
        .toEqual({ drawSaved: true, actions, status, source: order.source })
    }
    Expect(await browser.evaluate<number>('window.__taoMetroRefreshFrameLoads')).toBe(0)
    Expect(browser.browserFailures()).toEqual([])
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 300_000)

/**
 * Counts host iframe loads and marks the preview realm, watching its root for the pending scenario
 * text or an emptied root: a reload, remount, or re-bootstrap trips at least one of them.
 */
async function installRemountProbes(browser: StudioCdp, previewUrl: string): Promise<void> {
  await browser.evaluate(`(() => {
    const frame = document.querySelector('.studio-preview-cell iframe')
    if (!(frame instanceof HTMLIFrameElement)) throw new TypeError('Missing Studio preview iframe')
    window.__taoMetroRefreshFrameLoads = 0
    frame.addEventListener('load', () => { window.__taoMetroRefreshFrameLoads += 1 })
    return true
  })()`)
  await browser.evaluateInFrame(
    previewUrl,
    `(() => {
    const probe = window.__taoMetroRefreshProbe = {
      sawEmptyRoot: false,
      sawPending: document.body?.innerText.includes('Loading scenario') === true,
      token: 'retained-preview-realm',
    }
    const root = document.querySelector('#root') ?? document.body
    new MutationObserver(records => {
      probe.sawPending ||= records.some(record => [...record.addedNodes].some(node =>
        node.textContent?.includes('Loading scenario') === true
      ))
      probe.sawEmptyRoot ||= root.childElementCount === 0
    }).observe(root, { childList: true, subtree: true })
    return true
  })()`,
  )
}

async function waitForSaved(browser: StudioCdp, path: string, text: string): Promise<void> {
  const saved = await Time.pollUntil(async () => (await FS.readText(path)).includes(text), {
    intervalMs: 100,
    timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity,
  })
  if (!saved) {
    const editor = await browser.evaluate(`({
      status: document.querySelector('.studio-status')?.textContent,
      editor: document.querySelector('.cm-content')?.textContent?.slice(0, 600),
      focused: document.activeElement?.className,
    })`)
    Errors.throwHostEnvironment(`Timed out waiting for the Studio editor to save ${text}: ${JSON.stringify(editor)}`)
  }
}

async function waitForPreview(
  browser: StudioCdp,
  studio: StudioLaunch,
  previewUrl: string,
  expression: string,
): Promise<void> {
  let last = ''
  const ready = await Time.pollUntil(async () => {
    try {
      return await browser.evaluateInFrame<boolean>(previewUrl, expression)
    } catch (error) {
      last = Errors.messageOf(error)
      return false
    }
  }, { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
  if (!ready) {
    const diagnostics = await writePreviewDiagnostics(browser, studio, previewUrl)
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio preview expression: ${expression}; last=${last}; diagnostics=${diagnostics}`,
    )
  }
}

async function writePreviewDiagnostics(browser: StudioCdp, studio: StudioLaunch, previewUrl: string): Promise<string> {
  const read = async <T>(action: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await action()
    } catch (error) {
      return { error: Errors.messageOf(error) }
    }
  }
  const manifest = await read(async () => {
    const response = await fetch(`${studio.readiness.sessionUrl}/api/preview/manifest`, {
      signal: AbortSignal.timeout(2_000),
    } as RequestInit)
    return await response.json() as unknown
  })
  const status = await read(() => browser.evaluate<string>(`document.querySelector('.studio-status')?.textContent`))
  const preview = await read(() =>
    browser.evaluateInFrame(
      previewUrl,
      `(() => ({
    href: location.href, readyState: document.readyState, text: document.body?.innerText?.slice(0, 2000),
    stages: window.__taoStudioPreviewDiagnostics ?? [],
  }))()`,
      { world: 'page' },
    )
  )
  const path = FS.resolvePath(
    `preview-readiness-${studio.readiness.launchId}-metro-refresh.json`,
    studio.readiness.artifactRoot,
  )
  await FS.writeJson(path, {
    manifest,
    status,
    preview,
    browserEvents: browser.browserEvents().slice(-80),
    metroOutput: studio.output().slice(-30_000),
  })
  HCI.writeErrorLine(`Studio preview timeout diagnostics: ${path}`)
  return path
}

async function waitForCompileAfter(browser: StudioCdp, previousRevision: number): Promise<number> {
  let last = ''
  let revision: number | undefined
  const ready = await Time.pollUntil(async () => {
    last = await browser.evaluate<string>("document.querySelector('.studio-status')?.textContent ?? ''")
    const state = await browser.evaluate<string>(
      "document.querySelector('.studio-status')?.getAttribute('data-state') ?? ''",
    )
    const match = /^compiled (\d+) · applied \d+ —/.exec(last)?.[1]
    revision = match === undefined ? undefined : Number(match)
    return state === 'compiled' && revision !== undefined && revision > previousRevision
  }, { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
  if (!ready || revision === undefined) {
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio compile revision after ${previousRevision}; last=${JSON.stringify(last)}`,
    )
  }
  return revision
}

async function setInteractionMode(browser: StudioCdp, mode: 'edit' | 'run'): Promise<void> {
  await browser.evaluate(`(() => {
    const button = document.querySelector('.studio-interaction-mode')
    if (!(button instanceof HTMLButtonElement)) throw new TypeError('Missing Studio interaction mode control')
    if (button.dataset.mode !== ${JSON.stringify(mode)}) button.click()
    return button.dataset.mode
  })()`)
}

async function replaceEditorSource(browser: StudioCdp, source: string): Promise<void> {
  await browser.clickAtOffset('.studio-editor .cm-scroller', { x: 120, y: 60 })
  await browser.waitFor("document.querySelector('.cm-content')?.contains(document.activeElement) === true")
  await browser.pressShortcut('a')
  await browser.insertText(source)
  await browser.pressShortcut('s')
}

/** Waits for the source to hold `ordered` in that order; reports whether it did, with the last source read. */
async function waitForSourceOrder(
  path: string,
  ordered: readonly string[],
): Promise<{ inOrder: boolean; source: string }> {
  let source = ''
  const inOrder = await Time.pollUntil(async () => {
    source = await FS.readText(path)
    let previous = -1
    for (const text of ordered) {
      const index = source.indexOf(text)
      if (index <= previous) {
        return false
      }
      previous = index
    }
    return true
  }, { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
  return { inOrder: inOrder === true, source }
}

/** Drops the render reading `moved` midway between the renders reading `before` and `after`. */
async function dragRenderBetween(
  browser: StudioCdp,
  previewUrl: string,
  moved: string,
  before: string,
  after: string,
): Promise<void> {
  await browser.evaluateInFrame(
    previewUrl,
    `(() => {
    const exactRender = text => [...document.querySelectorAll('[data-tao-studio]')]
      .filter(element => element.textContent?.trim() === text)
      .toSorted((left, right) => left.querySelectorAll('[data-tao-studio]').length
        - right.querySelectorAll('[data-tao-studio]').length)[0]
    const first = exactRender(${JSON.stringify(before)})
    const second = exactRender(${JSON.stringify(after)})
    const third = exactRender(${JSON.stringify(moved)})
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement) || !(third instanceof HTMLElement)) {
      throw new TypeError('Missing draggable Studio render targets')
    }
    const firstRect = first.getBoundingClientRect()
    const secondRect = second.getBoundingClientRect()
    const thirdRect = third.getBoundingClientRect()
    const start = { x: thirdRect.left + thirdRect.width / 2, y: thirdRect.top + thirdRect.height / 2 }
    const end = {
      x: firstRect.left + firstRect.width / 2,
      y: (firstRect.top + firstRect.height / 2 + secondRect.top + secondRect.height / 2) / 2,
    }
    third.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, buttons: 1, clientX: start.x, clientY: start.y,
    }))
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, button: 0, buttons: 1, clientX: end.x, clientY: end.y,
    }))
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, button: 0, buttons: 0, clientX: end.x, clientY: end.y,
    }))
    return true
  })()`,
  )
}

async function focusFirstPreview(browser: StudioCdp): Promise<void> {
  if (
    !await browser.evaluate<boolean>(
      `document.querySelector('.studio-preview-cell')?.dataset.previewInteractive === 'true'`,
    )
  ) {
    await browser.clickAtOffset('.studio-preview-cell .studio-preview-focus-shield', { x: 100, y: 250 })
  }
  await browser.waitFor(`document.querySelector('.studio-preview-cell')?.dataset.previewInteractive === 'true'`)
}
