import { Errors, FS, HCI, Platform, ProjectIdentity, ProjectLocal, Repo, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  StudioInspector,
} from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'
import { exerciseHnreaderFeed } from './studio-hnreader-feed-journey'

Test(
  'Studio feeds, keeps, discards, and undoes generated HNReader Stories through real browser drags',
  exerciseHnreaderFeed,
  600_000,
)

async function canvasTranslation(browser: StudioCdp): Promise<{ x: number; y: number }> {
  return await browser.evaluate(`(() => {
    const grid = document.querySelector('.studio-preview > .studio-preview-grid')
    if (!(grid instanceof HTMLElement)) throw new TypeError('Missing Studio canvas grid')
    const matrix = new DOMMatrix(getComputedStyle(grid).transform)
    return { x: matrix.e, y: matrix.f }
  })()`)
}

const fastRefreshSource = `use Button, Col, Number, Text from @tao/ui

app RefreshSmoke { id "refreshsmoke" version "1.0.0" name "RefreshSmoke" view MainView }

view MainView() {
   state Count = 0
   action Increment() {
      set Count += 1
   }
   render Col() {
      Button("Increment") {
         on press Increment
      }
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

// REMOVAL CANDIDATE: Repeats session insertion/undo/publication with real HNReader inputs; dropping it trades this app/compiler integration.
Test('Studio compiles, applies insertion and undo, and publishes the real HNReader app', async () => {
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-smoke/real-app', Repo.getRoot())
  const projectRoot = await mkTestDir('tao-studio-hnreader-')
  const previewRuntimeRoot = FS.resolvePath('runtime', artifactRoot)
  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  try {
    await FS.remove(previewRuntimeRoot)
    await FS.copyDirectory(Repo.resolvePath('Apps/HNReader'), projectRoot)
    await FS.remove(ProjectLocal.cacheResolve('typescript/outputs.json', projectRoot))
    await FS.remove(FS.resolvePath('.tao-ts', projectRoot))
    preview = await openStudioPreviewSession({
      appName: 'HNReaderStub',
      entryPath: FS.resolvePath('HNReader.tao', projectRoot),
      previewRuntimeRoot,
      projectRoot,
    })
    preview.session.registerPreview({ previewInstanceId: 'real-app-preview' })
    const initialCompile = await preview.session.compileInitial()
    if (initialCompile.status !== 'compiled') {
      Errors.throwUnexpected(`Initial HNReader compile failed: ${JSON.stringify(initialCompile.diagnostics)}`)
    }
    // HNReader.tao holds the app shell; the front page's views live beside it.
    const initial = await preview.session.readFile('Feed.tao')
    const identity = {
      ...preview.session.identity(),
      path: initial.path,
      previewInstanceId: 'real-app-preview',
      sourceVersion: initial.sourceVersion,
    }
    const applied = await preview.session.applySourceAction(StudioInspector.singleAction({
      action: { component: 'Text', kind: 'insert-component' },
      checkpointId: 'real-app-visual-edit',
      identity,
      requestId: 'real-app-insert-text',
    }))
    const undone = await preview.session.undoSourceAction(StudioInspector.undo({
      checkpointId: 'real-app-visual-edit',
      identity: { ...identity, sourceVersion: applied.sourceVersion },
      requestId: 'real-app-undo',
    }))
    const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
    const stableRoot = await FS.readText(FS.resolvePath('App.tsx', generatedRoot))
    const publication = await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))

    Expect(initialCompile.compileRevision).toBe(1)
    Expect(applied.compile.compileRevision).toBe(2)
    Expect(applied.content).toContain('Text("New text")')
    Expect(undone.compile.compileRevision).toBe(3)
    Expect(undone.content).toBe(initial.content)
    Expect(await FS.readText(FS.resolvePath('Feed.tao', projectRoot))).toBe(initial.content)
    Expect(stableRoot).toContain('TR.Studio.PreviewBridge')
    Expect(publication).toContain('"appName":"HNReaderStub"')
    Expect(publication).toContain('"compileRevision":3')
    Expect(publication).toContain(FS.resolvePath('Feed.tao', projectRoot))
    Expect(publication).toContain(initial.sourceVersion)
  } finally {
    await preview?.close()
    await FS.remove(projectRoot)
  }
}, 600_000)

Test('Studio drag refreshes the real Metro preview without blanking, reloading, or losing state', async () => {
  const repositoryRoot = Repo.getRoot()
  const projectRoot = await mkTestDir('tao-studio-fast-refresh-')
  const sourcePath = FS.resolvePath('RefreshSmoke.tao', projectRoot)
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    await FS.writeText(sourcePath, fastRefreshSource)
    await FS.mkdir(FS.resolvePath('.tao', projectRoot))
    studio = await startStudioSmokeLaunch({
      appName: 'RefreshSmoke',
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
    await browser.waitFor("document.querySelector('.studio-preview-activation-toggle') !== null")
    Expect(await browser.evaluate("document.querySelectorAll('.studio-preview-cell iframe').length")).toBe(0)
    Expect(await browser.evaluate("document.querySelector('.studio-preview-inactive-activate')?.textContent"))
      .toBe('activate')
    Expect(
      await browser.evaluate(`(() => {
      const viewport = document.querySelector('.studio-preview-cell-viewport')
      const canvas = document.querySelector('.studio-preview')
      const cell = document.querySelector('.studio-preview-cell')
      if (!viewport || !canvas || !cell) throw new TypeError('Missing inactive preview surfaces')
      return {
        background: getComputedStyle(viewport).backgroundColor,
        canvasCursor: getComputedStyle(canvas).cursor,
        previewCursor: getComputedStyle(cell).cursor,
        panel: getComputedStyle(document.documentElement).getPropertyValue('--studio-panel').trim(),
      }
    })()`),
    ).toMatchObject({ canvasCursor: 'grab', previewCursor: 'pointer' })
    Expect(
      await browser.evaluate(`(() => {
      const viewport = document.querySelector('.studio-preview-cell-viewport')
      const swatch = document.createElement('div')
      swatch.style.backgroundColor = 'var(--studio-panel)'
      document.body.append(swatch)
      const matches = viewport && getComputedStyle(viewport).backgroundColor === getComputedStyle(swatch).backgroundColor
      swatch.remove()
      return matches
    })()`),
    ).toBe(true)
    Expect(
      await browser.evaluate(`(() => {
      const header = document.querySelector('.studio-preview-cell-label')
      const toggle = header?.querySelector('.studio-preview-activation-toggle')
      const name = toggle?.nextElementSibling
      return header instanceof HTMLElement && toggle instanceof HTMLButtonElement && name instanceof HTMLElement
        && toggle.getBoundingClientRect().left <= header.getBoundingClientRect().left + 1
        && toggle.getBoundingClientRect().right <= name.getBoundingClientRect().left
    })()`),
    ).toBe(true)
    await browser.captureScreenshot('preview-inactive')
    await browser.click('.studio-preview-inactive-activate')
    await browser.waitFor(
      `document.querySelector('.studio-preview-cell iframe') instanceof HTMLIFrameElement`,
      { timeoutMs: 30_000 },
    )
    // The native button renders its title uppercase on web, and innerText reports the transformed text.
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('Increment') === true`)
    Expect(await browser.evaluate(`getComputedStyle(document.querySelector('.studio-preview-focus-shield')).cursor`))
      .toBe('pointer')
    Expect(await browser.evaluate("document.querySelector('.studio-preview-inactive-activate')")).toBe(null)
    Expect(
      await browser.evaluate(
        "document.querySelector('.studio-preview-activation-toggle')?.getAttribute('aria-pressed')",
      ),
    )
      .toBe('true')
    // Keep the header's active bolt visible even when waiting for the tall iframe scrolled it away.
    await browser.evaluate("document.querySelector('.studio-preview-cell-label')?.scrollIntoView({ block: 'nearest' })")
    await browser.captureScreenshot('preview-active')

    await browser.click('[data-preset="design"]')
    await browser.waitFor(`document.querySelector('.studio-canvas-zoom') !== null`)
    await focusFirstPreview(browser)
    await browser.withKeyHeld(' ', async () => {
      await browser!.waitFor(`document.querySelector('.studio-preview')?.dataset.canvasPanReady === 'true'`)
      const before = await canvasTranslation(browser!)
      // Start over an embedded app, then drag again over the canvas with Space still held.
      await browser!.dragBy('.studio-preview-cell iframe', { x: 40, y: 20 })
      Expect(await canvasTranslation(browser!)).toEqual({ x: before.x + 30, y: before.y + 15 })
      Expect(
        await browser!.evaluate<string>(
          `document.querySelector('.studio-preview')?.dataset.canvasPanReady ?? ''`,
        ),
      ).toBe('true')
      await browser!.dragBy('.studio-preview', { x: -20, y: -10 }, { offset: { x: 20, y: 20 } })
      Expect(await canvasTranslation(browser!)).toEqual({ x: before.x + 15, y: before.y + 7.5 })
    })
    await browser.waitFor(`document.querySelector('.studio-preview')?.dataset.canvasPanReady === undefined`)
    Expect(
      await browser.evaluate<string>(
        `document.querySelector('.studio-preview')?.dataset.canvasPanning ?? ''`,
      ),
    ).toBe('')
    const heldPan = await canvasTranslation(browser)
    await browser.wheel('.studio-preview-cell iframe', { x: 20, y: 30 })
    Expect(await canvasTranslation(browser)).toEqual(heldPan)
    await browser.wheel('.studio-canvas-zoom', { x: 20, y: 30 })
    await browser.waitFor(
      `new DOMMatrix(getComputedStyle(document.querySelector('.studio-preview-grid')).transform).f === ${
        heldPan.y - 22.5
      }`,
    )
    Expect(await canvasTranslation(browser)).toEqual({ x: heldPan.x - 15, y: heldPan.y - 22.5 })
    // A focused iframe forwards zoom shortcuts without moving focus back to the host.
    await browser.clickAtOffset('.studio-preview-cell iframe', { x: 100, y: 250 })
    await browser.pressShortcut('+')
    await browser.waitFor(`document.querySelector('.studio-canvas-zoom')?.textContent === '150%'`)
    const savedCamera = await browser.evaluate<string>(`document.querySelector('.studio-preview-grid').style.transform`)
    await browser.waitFor(
      `fetch(location.pathname + '/api/protocol').then(r => r.json()).then(h => h.canvasViewport?.z === 1.5)`,
    )
    await browser.goto(studio.readiness.sessionUrl)
    await activateSmokePreviews(browser)
    await browser.waitFor(
      `document.querySelector('.studio-preview-grid')?.style.transform === ${JSON.stringify(savedCamera)}`,
    )
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('Increment') === true`)
    await browser.click('[data-preset="design"]')
    await browser.clickAtOffset('.studio-canvas-zoom', { x: 10, y: 10 })
    await browser.clickAtOffset('[data-tao-studio-canvas-zoom-action="1"]', { x: 10, y: 10 })
    await browser.waitFor(`document.querySelector('.studio-canvas-zoom')?.textContent === '100%'`)

    await browser.evaluate(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      if (!(frame instanceof HTMLIFrameElement)) throw new TypeError('Missing Studio preview iframe')
      window.__taoFastRefreshFrameProbe = { loads: 0 }
      frame.addEventListener('load', () => { window.__taoFastRefreshFrameProbe.loads += 1 })
      return true
    })()`)
    await browser.evaluateInFrame(
      previewUrl,
      `(() => {
      const probe = window.__taoFastRefreshProbe = {
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

    // Edit mode gives Studio every click for selection, so the press happens in Run mode, the way a
    // person would press it, and the drag after it happens back in Edit mode.
    await setInteractionMode(browser, 'run')
    await exerciseUnfocusedPreview(browser, previewUrl)
    await pressIncrementOnce(browser, previewUrl)
    await exercisePreviewFocusRelease(browser, previewUrl)
    await browser.evaluateInFrame(
      previewUrl,
      `(() => {
      window.__taoPointerEvents = []
      for (const type of ['pointerover', 'pointermove', 'pointerdown', 'pointerup', 'mouseover',
        'mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'dragstart']) {
        document.addEventListener(type, () => window.__taoPointerEvents.push(type), true)
      }
      return true
    })()`,
    )
    // The app button now has focus: Space must cross the iframe boundary, and must not press it.
    await browser.withKeyHeld(' ', async () => {
      await browser!.waitFor(`document.querySelector('.studio-preview')?.dataset.canvasPanReady === 'true'`)
      const before = await canvasTranslation(browser!)
      await browser!.dragBy('.studio-preview-cell iframe', { x: 30, y: 15 })
      Expect(await canvasTranslation(browser!)).toEqual({ x: before.x + 22.5, y: before.y + 11.25 })
      // Between drags the preview remains a neutral surface: no hover, press or wheel reaches it.
      await browser!.hover('.studio-canvas-zoom')
      await browser!.hover('.studio-preview-cell iframe')
      await browser!.click('.studio-preview-cell iframe')
      await browser!.wheel('.studio-preview-cell iframe', { x: 0, y: 10 })
      await browser!.waitFor(`new DOMMatrix(getComputedStyle(
        document.querySelector('.studio-preview > .studio-preview-grid')).transform).f === ${before.y + 3.75}`)
      Expect(await browser!.evaluateInFrame(previewUrl, 'window.__taoPointerEvents')).toEqual([])
    })
    await browser.waitFor(`document.querySelector('.studio-preview')?.dataset.canvasPanReady === undefined`)
    await browser.pressShortcut('1')
    await browser.hover('.studio-canvas-zoom')
    await browser.hover('.studio-preview-cell iframe')
    await browser.clickAtOffset('.studio-preview-cell iframe', { x: 100, y: 250 })
    const resumedEvents = await browser.evaluateInFrame<string[]>(previewUrl, 'window.__taoPointerEvents')
    Expect(resumedEvents).toContain('pointermove')
    Expect(resumedEvents).toContain('mousedown')
    Expect(resumedEvents).toContain('click')
    await browser.evaluateInFrame(
      previewUrl,
      `(() => {
      // Observe message delivery before attempting a synthetic edit drag.
      window.__taoSmokeMode = 'pending'
      window.addEventListener('message', event => {
        if (event.data?.type === 'set-interaction-mode') window.__taoSmokeMode = event.data.mode
      })
      return true
    })()`,
    )
    await setInteractionMode(browser, 'edit')
    await browser.waitForInFrame(previewUrl, `window.__taoSmokeMode === 'edit'`)

    const compileRevision = await waitForCompileAfter(browser, -1)
    await focusFirstPreview(browser)
    await dragThirdBetweenFirstAndSecond(browser, previewUrl)
    await waitForSourceOrder(sourcePath, ['Text("First")', 'Text("Third")', 'Text("Second")'])
    const movedRevision = await waitForCompileAfter(browser, compileRevision)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `document.body?.innerText.indexOf('First') < document.body?.innerText.indexOf('Third')
        && document.body?.innerText.indexOf('Third') < document.body?.innerText.indexOf('Second')`,
    )
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1')`,
    )

    const movedSource = await FS.readText(sourcePath)
    await replaceEditorSource(browser, 'view Broken( {\n', { requireInsertedSource: true })
    await waitForStudioStatus(browser, 'error')
    Expect(await FS.readText(sourcePath)).toBe(movedSource)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1')`,
    )
    await replaceEditorSource(browser, `${movedSource.trimEnd()}\n\n// recovered after invalid draft\n`)
    const recoveredRevision = await waitForCompileAfter(browser, movedRevision)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1')`,
    )

    const frameProbe = await browser.evaluate<Readonly<{ loads: number }>>(
      'window.__taoFastRefreshFrameProbe',
    )
    const previewProbe = await browser.evaluateInFrame<
      Readonly<{
        countPreserved: boolean
        sawEmptyRoot: boolean
        sawPending: boolean
        token?: string
      }>
    >(
      previewUrl,
      `(() => ({
      countPreserved: [...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1'),
      sawEmptyRoot: window.__taoFastRefreshProbe?.sawEmptyRoot === true,
      sawPending: window.__taoFastRefreshProbe?.sawPending === true,
      token: window.__taoFastRefreshProbe?.token,
    }))()`,
    )
    Expect(frameProbe.loads).toBe(0)
    Expect(previewProbe).toEqual({
      countPreserved: true,
      sawEmptyRoot: false,
      sawPending: false,
      token: 'retained-preview-realm',
    })
    // Adding a scenario changes the cell contract. Unlike a compatible render edit above, it
    // deliberately resets every retained preview so old interaction state cannot cross it.
    const expandedSource = movedSource.replace(
      /scenario "default" \{\s*render MainView\(\)\s*\}/,
      '$&\n   scenario "second" { render MainView() }',
    )
    Expect(expandedSource).not.toBe(movedSource)
    await replaceEditorSource(
      browser,
      expandedSource,
    )
    await waitForCompileAfter(browser, recoveredRevision)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '0')`,
    )
    const afterReset = await browser.evaluate<Readonly<{ loads: number }>>('window.__taoFastRefreshFrameProbe')
    Expect(afterReset.loads).toBeGreaterThan(0)
    await exerciseExclusivePreviewSelection(browser)
    Expect(browser.browserFailures()).toEqual([])
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 600_000)

async function waitForPreview(
  browser: StudioCdp,
  studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>>,
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
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready) {
    const diagnostics = await writePreviewDiagnostics(browser, studio, previewUrl, 'preview-timeout')
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio preview expression: ${expression}; last=${last}; diagnostics=${diagnostics}`,
    )
  }
}

async function writePreviewDiagnostics(
  browser: StudioCdp,
  studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>>,
  previewUrl: string,
  step: string,
): Promise<string> {
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
    const body = await response.json() as { compileRevision?: number; manifestRevision?: string; cells?: unknown[] }
    return {
      status: response.status,
      compileRevision: body.compileRevision,
      manifestRevision: body.manifestRevision,
      cells: body.cells,
    }
  })
  const iframe = await read(() =>
    browser.evaluate<{ src?: string }>(`(() => {
    const frame = document.querySelector('.studio-preview-cell iframe')
    const status = document.querySelector('.studio-status')
    return { exists: frame instanceof HTMLIFrameElement, src: frame?.src,
      connected: frame?.isConnected, loads: window.__taoFastRefreshFrameProbe?.loads,
      status: status?.textContent, statusState: status?.getAttribute('data-state') }
  })()`)
  )
  const bootstrap = await read(async () => {
    if ('error' in iframe || iframe.src === undefined) {
      return { unavailable: 'iframe source missing' }
    }
    const previewInstanceId = new URL(iframe.src).searchParams.get('taoStudioPreviewInstanceId')
    if (previewInstanceId === null) {
      return { unavailable: 'preview instance id missing' }
    }
    const url = new URL(`${studio.readiness.sessionUrl}/api/preview/cell/bootstrap`)
    url.searchParams.set('previewInstanceId', previewInstanceId)
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) } as RequestInit)
    const body = await response.json() as { identity?: unknown; replay?: { domains?: { domain: string }[] } }
    return {
      status: response.status,
      identity: body.identity,
      replayDomains: body.replay?.domains?.map(domain => domain.domain),
    }
  })
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
  const diagnostics = {
    step,
    manifest,
    iframe,
    bootstrap,
    preview,
    browserEvents: browser.browserEvents().slice(-80),
    metroOutput: studio.output().slice(-30_000),
  }
  const path = FS.resolvePath(
    `preview-readiness-${studio.readiness.launchId}-${step}.json`,
    studio.readiness.artifactRoot,
  )
  await FS.writeJson(path, diagnostics)
  if (step === 'preview-timeout') {
    HCI.writeErrorLine(`Studio preview ${step} diagnostics: ${path}`)
    HCI.writeErrorLine(`Studio preview stage summary: ${
      JSON.stringify({
        manifest: 'error' in manifest ? manifest : {
          status: manifest.status,
          compileRevision: manifest.compileRevision,
          manifestRevision: manifest.manifestRevision,
          cells: manifest.cells?.length,
        },
        iframe,
        bootstrap,
        preview,
      })
    }`)
  }
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
  }, { intervalMs: 100, timeoutMs: 30_000 })
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

/**
 * The native button answers pointer input rather than a synthetic `click()`, so the press is real
 * mouse input at the button's centre, mapped out of the preview frame and through the canvas zoom.
 *
 * The mode reaches the preview by message, so a press sent before it lands is still Studio's. Press
 * only while the count still reads 0, and give each press time to render before looking again, so a
 * press that did land is never repeated.
 */
// REMOVAL CANDIDATE: Retried physical press uses a fixed render pause; simplifying it needs host evidence that one acknowledged press preserves the state proof.
async function pressIncrementOnce(browser: StudioCdp, previewUrl: string): Promise<void> {
  const counted =
    `[...document.querySelectorAll('[data-tao-studio]')].some(element => element.textContent?.trim() === '1')`
  const ready = await Time.pollUntil(async () => {
    if (await browser.evaluateInFrame<boolean>(previewUrl, counted)) {
      return true
    }
    const inFrame = await browser.evaluateInFrame<Readonly<{ x: number; y: number }>>(
      previewUrl,
      `(() => {
      const increment = [...document.querySelectorAll('[data-tao-studio]')]
        .filter(element => element.textContent?.trim() === 'Increment')
        .toSorted((left, right) => left.querySelectorAll('[data-tao-studio]').length
          - right.querySelectorAll('[data-tao-studio]').length)[0]
      if (!(increment instanceof HTMLElement)) throw new TypeError('Missing Increment control')
      const rect = increment.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`,
    )
    const point = await browser.evaluate<Readonly<{ x: number; y: number }>>(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      if (!(frame instanceof HTMLIFrameElement)) throw new TypeError('Missing Studio preview iframe')
      const rect = frame.getBoundingClientRect()
      const scale = frame.clientWidth === 0 ? 1 : rect.width / frame.clientWidth
      return { x: rect.left + ${inFrame.x} * scale, y: rect.top + ${inFrame.y} * scale }
    })()`)
    await browser.clickAt(point)
    await Time.sleep(300)
    return await browser.evaluateInFrame<boolean>(previewUrl, counted)
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready) {
    const diagnostics = await browser.evaluate(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      const rect = frame.getBoundingClientRect()
      return { frame: {x:rect.x,y:rect.y,width:rect.width,height:rect.height}, mode: document.querySelector('.studio-interaction-mode')?.dataset.mode,
        canvas: document.querySelector('.studio-preview')?.dataset, transform: document.querySelector('.studio-preview-grid')?.style.transform,
        hit: document.elementFromPoint(rect.left+50,rect.top+30)?.outerHTML.slice(0,400) }
    })()`)
    const text = await browser.evaluateInFrame<string>(previewUrl, 'document.body.innerText')
    Errors.throwHostEnvironment(`Timed out pressing Increment in Run mode: ${JSON.stringify(diagnostics)}; app=${text}`)
  }
}

async function waitForStudioStatus(browser: StudioCdp, expected: string): Promise<void> {
  let last: Readonly<{ state: string; text: string }> = { state: '', text: '' }
  const ready = await Time.pollUntil(async () => {
    last = await browser.evaluate<Readonly<{ state: string; text: string }>>(`(() => {
      const status = document.querySelector('.studio-status')
      return { state: status?.getAttribute('data-state') ?? '', text: status?.textContent ?? '' }
    })()`)
    return last.state === expected
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready) {
    Errors.throwHostEnvironment(`Timed out waiting for Studio status ${expected}; last=${JSON.stringify(last)}`)
  }
}

async function replaceEditorSource(
  browser: StudioCdp,
  source: string,
  options: { requireInsertedSource?: boolean } = {},
): Promise<void> {
  await browser.clickAtOffset('.studio-editor .cm-scroller', { x: 120, y: 60 })
  await browser.waitFor("document.querySelector('.cm-content')?.contains(document.activeElement) === true")
  await browser.pressShortcut('a')
  await browser.insertText(source)
  if (options.requireInsertedSource === true) {
    const inserted = await browser.evaluate<string>("document.querySelector('.cm-content')?.textContent ?? ''")
    if (inserted.trim() !== source.trim()) {
      Errors.throwHostEnvironment(
        `Studio editor did not contain the invalid draft before save: ${JSON.stringify(inserted)}`,
      )
    }
  }
  await browser.pressShortcut('s')
}

async function waitForSourceOrder(path: string, ordered: readonly string[]): Promise<void> {
  let source = ''
  const updated = await Time.pollUntil(async () => {
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
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!updated) {
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio source order ${ordered.join(', ')}. Last source:\n${source}`,
    )
  }
}

async function dragThirdBetweenFirstAndSecond(browser: StudioCdp, previewUrl: string): Promise<void> {
  await dragRenderBetween(browser, previewUrl, 'Third', 'First', 'Second')
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
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
    }))
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: end.x,
      clientY: end.y,
    }))
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: end.x,
      clientY: end.y,
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

async function exerciseUnfocusedPreview(browser: StudioCdp, previewUrl: string): Promise<void> {
  await browser.waitFor(`(() => {
    const frame = document.querySelector('.studio-preview-cell iframe')
    const shield = document.querySelector('.studio-preview-cell .studio-preview-focus-shield')
    return frame !== null && shield !== null && !shield.hidden
      && getComputedStyle(frame).pointerEvents === 'none'
      && document.querySelectorAll('[data-preview-interactive="true"]').length === 0
  })()`)
  await browser.evaluateInFrame(
    previewUrl,
    `(() => {
    window.__taoUnfocusedEvents = []
    for (const type of ['pointermove', 'pointerdown', 'click', 'wheel']) {
      document.addEventListener(type, () => window.__taoUnfocusedEvents.push(type), true)
    }
  })()`,
  )
  const before = await canvasTranslation(browser)
  await browser.hover('.studio-preview-cell iframe')
  await browser.wheel('.studio-preview-cell iframe', { x: 0, y: 20 })
  await browser.waitFor(
    `new DOMMatrix(getComputedStyle(document.querySelector('.studio-preview-grid')).transform).f === ${before.y - 15}`,
  )
  await browser.dragBy('.studio-preview-cell iframe', { x: 40, y: 20 })
  Expect(await canvasTranslation(browser)).toEqual({ x: before.x + 30, y: before.y })
  Expect(await browser.evaluate(`document.querySelectorAll('[data-preview-interactive="true"]').length`)).toBe(0)
  Expect(await browser.evaluateInFrame(previewUrl, 'window.__taoUnfocusedEvents')).toEqual([])
  // Click directly over Increment: selecting the preview must not also press its button.
  const point = await browser.evaluateInFrame<{ x: number; y: number }>(
    previewUrl,
    `(() => {
    const button = [...document.querySelectorAll('[data-tao-studio]')]
      .filter(node => node.textContent.trim() === 'Increment')
      .toSorted((a,b) => a.querySelectorAll('[data-tao-studio]').length - b.querySelectorAll('[data-tao-studio]').length)[0]
    const r = button.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`,
  )
  await browser.clickAtOffset('.studio-preview-cell .studio-preview-focus-shield', point)
  await browser.waitFor(`document.querySelector('.studio-preview-cell')?.dataset.previewInteractive === 'true'`)
  Expect(await browser.evaluateInFrame(previewUrl, 'window.__taoUnfocusedEvents.includes("click")')).toBe(false)
  Expect(
    await browser.evaluateInFrame(
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')].some(node => node.textContent.trim() === '0')`,
    ),
  ).toBe(true)
}

async function exerciseExclusivePreviewSelection(browser: StudioCdp): Promise<void> {
  await browser.waitFor(`document.querySelectorAll('.studio-preview-cell').length === 2`)
  await activateSmokePreviews(browser)
  await browser.waitFor(`document.querySelectorAll('.studio-preview-cell iframe').length === 2`)
  await browser.pressShortcut('0')
  const frames = await browser.evaluate<string[]>(
    `[...document.querySelectorAll('.studio-preview-cell')].map(frame => frame.dataset.taoStudioCell)`,
  )
  for (const id of frames) {
    await browser.click(`[data-tao-studio-cell="${id}"] iframe`)
    Expect(
      await browser.evaluate(
        `([...document.querySelectorAll('.studio-preview-cell[data-preview-interactive="true"]')]).map(frame => frame.dataset.taoStudioCell)`,
      ),
    ).toEqual([id])
    Expect(
      await browser.evaluate(
        `([...document.querySelectorAll('.studio-preview-cell iframe')]).filter(frame => getComputedStyle(frame).pointerEvents !== 'none').length`,
      ),
    ).toBe(1)
  }
  const outside = await browser.evaluate<{ x: number; y: number } | null>(`(() => {
    const host = document.querySelector('.studio-preview')
    const rect = host.getBoundingClientRect()
    for (let y = rect.top + 5; y < rect.bottom; y += 20) {
      for (let x = rect.left + 5; x < rect.right; x += 20) {
        const target = document.elementFromPoint(x,y)
        if (target && host.contains(target) && !target.closest('.studio-preview-cell, button, input')) return {x,y}
      }
    }
    return null
  })()`)
  Expect(outside).not.toBeNull()
  await browser.clickAt(outside!)
  Expect(await browser.evaluate(`document.querySelectorAll('[data-preview-interactive="true"]').length`)).toBe(0)
  Expect(
    await browser.evaluate(
      `([...document.querySelectorAll('.studio-preview-cell iframe')]).every(frame => getComputedStyle(frame).pointerEvents === 'none')`,
    ),
  ).toBe(true)
}

async function exercisePreviewFocusRelease(browser: StudioCdp, previewUrl: string): Promise<void> {
  Expect(await browser.evaluate(`document.activeElement === document.querySelector('.studio-preview-cell iframe')`))
    .toBe(true)
  await browser.evaluateInFrame(
    previewUrl,
    `(() => {
    window.__taoInactiveKeys = []
    document.addEventListener('keydown', event => window.__taoInactiveKeys.push(event.key), true)
  })()`,
  )
  await browser.evaluate(
    `document.querySelector('.studio-canvas-zoom').addEventListener('pointerdown', event => event.preventDefault(), {once:true})`,
  )
  await browser.click('.studio-canvas-zoom')
  Expect(await browser.evaluate(`document.activeElement === document.querySelector('.studio-preview-cell iframe')`))
    .toBe(false)
  Expect(await browser.evaluate(`document.querySelectorAll('[data-preview-interactive="true"]').length`)).toBe(0)
  await browser.pressShortcut('1')
  Expect(await browser.evaluateInFrame(previewUrl, 'window.__taoInactiveKeys')).toEqual([])
  await browser.click('.studio-canvas-zoom')
  await focusFirstPreview(browser)
  await browser.clickAtOffset('.studio-preview-cell iframe', { x: 100, y: 250 })
}

Test('Studio publication-off preview renders edits without reloading its frame', async () => {
  const repositoryRoot = Repo.getRoot()
  const projectRoot = await mkTestDir('tao-studio-publication-off-')
  const sourcePath = FS.resolvePath('RefreshSmoke.tao', projectRoot)
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    await FS.writeText(sourcePath, fastRefreshSource)
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
    Expect(new URL(previewUrl).searchParams.get('taoStudioPublication')).toBe('off')
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    await activateSmokePreviews(browser)
    await browser.waitFor(`document.querySelector('.studio-preview-cell iframe') instanceof HTMLIFrameElement`)
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('First') === true`)
    await browser.click('[data-preset="design"]')
    await browser.evaluate(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      window.__taoPublicationOffLoads = 0
      frame.addEventListener('load', () => { window.__taoPublicationOffLoads += 1 })
      return true
    })()`)
    await browser.evaluateInFrame(
      previewUrl,
      `(() => {
      window.__taoPublicationOffMode = 'pending'
      window.addEventListener('message', event => {
        if (event.data?.type === 'set-interaction-mode') window.__taoPublicationOffMode = event.data.mode
      })
      return true
    })()`,
    )
    await setInteractionMode(browser, 'edit')
    await browser.waitForInFrame(previewUrl, `window.__taoPublicationOffMode === 'edit'`)
    await focusFirstPreview(browser)
    await browser.evaluate(`(() => {
      window.__taoPublicationOffActions = []
      window.addEventListener('message', event => {
        if (event.data?.type === 'source-action') window.__taoPublicationOffActions.push(event.data)
      })
      return true
    })()`)
    await dragThirdBetweenFirstAndSecond(browser, previewUrl)
    const sent = await Time.pollUntil(
      async () => await browser!.evaluate<number>('window.__taoPublicationOffActions.length') > 0,
      {
        intervalMs: 100,
        timeoutMs: 10_000,
      },
    )
    if (!sent) {
      const diagnostics = await browser.evaluateInFrame(previewUrl, 'window.__taoStudioPreviewDiagnostics', {
        world: 'page',
      })
      Errors.throwHostEnvironment(
        `The publication-off preview emitted no Draw source action: ${JSON.stringify(diagnostics)}`,
      )
    }
    try {
      await waitForSourceOrder(sourcePath, ['Text("First")', 'Text("Third")', 'Text("Second")'])
    } catch (error) {
      const actions = await browser.evaluate('window.__taoPublicationOffActions')
      const status = await browser.evaluate(`document.querySelector('.studio-status')?.textContent`)
      Errors.throwHostEnvironment(`Draw action was not saved: ${JSON.stringify({ actions, status })}`, { cause: error })
    }
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `document.body?.innerText.indexOf('First') < document.body?.innerText.indexOf('Third')
        && document.body?.innerText.indexOf('Third') < document.body?.innerText.indexOf('Second')`,
    )
    const initialRevision = await waitForCompileAfter(browser, -1)
    const movedSource = await FS.readText(sourcePath)
    await replaceEditorSource(
      browser,
      movedSource.replace('Text("Third")', 'Text("Third")\n      Text("Updated")'),
    )
    const saved = await Time.pollUntil(async () => (await FS.readText(sourcePath)).includes('Text("Updated")'), {
      intervalMs: 100,
      timeoutMs: 10_000,
    })
    Expect(saved).toBe(true)
    await browser.waitFor(`fetch(location.pathname + '/api/preview/manifest')
      .then(response => response.json())
      .then(manifest => manifest.compileRevision > ${initialRevision})`)
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('Updated') === true`)
    // Draw after Code: the Code save's Metro refresh re-bootstraps the cell, which must keep the
    // saved source's version rather than the byte-stable marker's first one.
    await Time.sleep(500)
    await dragRenderBetween(browser, previewUrl, 'Updated', 'First', 'Third')
    try {
      await waitForSourceOrder(sourcePath, ['Text("First")', 'Text("Updated")', 'Text("Third")'])
    } catch (error) {
      const actions = await browser.evaluate('window.__taoPublicationOffActions')
      const status = await browser.evaluate(`document.querySelector('.studio-status')?.textContent`)
      Errors.throwHostEnvironment(`Draw after Code was not saved: ${JSON.stringify({ actions, status })}`, {
        cause: error,
      })
    }
    Expect(await browser.evaluate<number>('window.__taoPublicationOffLoads')).toBe(0)
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 600_000)
