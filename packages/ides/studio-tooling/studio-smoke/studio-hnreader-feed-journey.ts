import { Errors, FS, HCI, Repo } from '@shared'
import { Expect, mkTestDir, runCleanups, until } from '@shared/test'
import type { StudioSketchCatalogSnapshot } from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

/** The manual Feed review, driven through Chrome against an isolated HNReader Metro preview. */
export async function exerciseHnreaderFeed(): Promise<void> {
  // Discovery honors Git ignores; a project in .artifacts would hide newly drawn views.
  const projectRoot = await mkTestDir('tao-studio-hnreader-feed-', { location: 'host' })
  const ownershipPath = Repo.resolvePath(`.artifacts/tests/studio-smoke/${FS.basename(projectRoot)}.json`)
  await FS.writeJson(ownershipPath, {
    owner: 'HNReader Feed smoke',
    path: projectRoot,
    purpose: 'Isolated authored project for Metro discovery',
    cleanup: 'Removed in the journey finally block after Studio stops',
  })
  const fixtureRoot = Repo.resolvePath('Apps/HNReader')
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  let failure: unknown
  let previewUrl: string | undefined
  try {
    // Copy authored inputs only: never inherit or modify somebody's saved Studio review.
    for (const name of await FS.listDir(fixtureRoot)) {
      if (/\.(tao|ts)$/.test(name) && await FS.isFile(FS.resolvePath(name, fixtureRoot))) {
        await FS.copyFile(FS.resolvePath(name, fixtureRoot), FS.resolvePath(name, projectRoot))
      }
    }
    await FS.copyDirectory(FS.resolvePath('@model', fixtureRoot), FS.resolvePath('@model', projectRoot))
    studio = await startStudioSmokeLaunch({ appName: 'HNReaderStub', projectRoot, repositoryRoot: Repo.getRoot() })
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    const driver = browser
    await driver.setViewport(1_920, 1_080)
    await driver.goto(studio.readiness.sessionUrl)
    HCI.logProcessInfo('HNReader Feed', 'draw board and rectangles')
    await driver.waitFor(`document.querySelector('[data-preset="draw"]') !== null`)
    await driver.click('[data-preset="draw"]')
    await driver.waitFor(`document.querySelector('.tao-studio-product-host')?.dataset.layoutPreset === 'draw'`)
    await driver.waitFor(`document.querySelector('[data-tao-studio-sketch-workspace]') instanceof HTMLElement`)
    await driver.click(rectangleTool)
    await driver.dragBy('[data-tao-studio-sketch-workspace]', { x: 360, y: 110 }, { steps: 12 })
    const catalogPath = FS.resolvePath('.tao-project/studio/sketches.jsonc', projectRoot)
    const viewPath = FS.resolvePath('@/studio/View1.tao', projectRoot)
    const fixturePath = FS.resolvePath('@/studio/Sketches.tao', projectRoot)
    await until(async () => await FS.isFile(catalogPath) && await FS.isFile(viewPath))
    const catalog = async () => await FS.readJson<StudioSketchCatalogSnapshot>(catalogPath)
    const created = await catalog()
    Expect(created.sketches).toHaveLength(1)
    const sketchId = created.sketches[0]!.id
    const board = `[data-tao-studio-sketch="${sketchId}"]`
    await driver.waitFor(`document.querySelector(${JSON.stringify(board)}) !== null`)
    await drawRect(driver, board, { x: 225, y: 60 }, { x: 110, y: 30 })
    await until(async () => (await catalog()).sketches[0]?.rects.length === 1)
    await waitForCompiledPreview(driver)
    const freeId = (await catalog()).sketches[0]!.rects[0]!.id
    await drawRect(driver, board, { x: 15, y: 15 }, { x: 180, y: 32 })
    await until(async () => (await catalog()).sketches[0]?.rects.length === 2)
    await waitForCompiledPreview(driver)
    const snappedId = (await catalog()).sketches[0]!.rects[1]!.id
    // The second gesture selects the rectangle it just drew; Snap leaves the first one free.
    await driver.waitFor(`document.querySelector('[data-tao-studio-sketch-rect="${snappedId}"]') !== null`)
    await driver.click(`[data-tao-studio-sketch-rect="${snappedId}"]`)
    await driver.waitFor(
      `document.querySelector(${JSON.stringify(board)})?.dataset.taoStudioSketchGesture === undefined`,
    )
    Expect(
      await driver.evaluate<string[]>(
        `[...document.querySelectorAll('${board} [data-tao-studio-sketch-rect][data-selected="true"]')].map(rect => rect.dataset.taoStudioSketchRect)`,
      ),
    ).toEqual([snappedId])
    const snap = `[data-tao-studio-sketch-snap="${sketchId}"]`
    await driver.waitFor(`document.querySelector(${JSON.stringify(snap)})?.disabled === false`)
    Expect(
      await driver.evaluate<string[]>(
        `[...document.querySelectorAll('${board} [data-tao-studio-sketch-rect][data-selected="true"]')].map(rect => rect.dataset.taoStudioSketchRect)`,
      ),
    ).toEqual([snappedId])
    await driver.click(snap)
    await until(async () => (await catalog()).sketches[0]?.snapped.length === 1)
    const beforePanCatalog = await FS.readText(catalogPath)
    const drawTransform = () =>
      driver.evaluate<{ x: number; y: number }>(`(() => {
      const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.studio-draw-canvas')).transform)
      return { x: matrix.e, y: matrix.f }
    })()`)
    const beforePan = await drawTransform()
    await driver.withKeyHeld(' ', async () => {
      await driver.dragBy(board, { x: 40, y: 20 })
      Expect(await drawTransform()).toEqual({ x: beforePan.x + 30, y: beforePan.y + 15 })
      await driver.dragBy(board, { x: -40, y: -20 })
      Expect(await drawTransform()).toEqual(beforePan)
    })
    Expect(await FS.readText(catalogPath)).toBe(beforePanCatalog)
    const beforeCatalog = await catalog()
    Expect(beforeCatalog.sketches[0]?.rects.map(rect => rect.id)).toEqual([freeId])
    const beforeView = await FS.readText(viewPath)
    const beforeCatalogText = await FS.readText(catalogPath)
    Expect(await FS.exists(fixturePath)).toBe(false)
    await driver.click('[data-preset="design"]')
    await driver.click('.studio-interaction-mode[data-mode="run"]')
    const currentFrame = await sketchFrame(driver, 'View1')
    await driver.evaluate(`document.querySelector(${JSON.stringify(currentFrame)}).scrollIntoView({block:'center'})`)
    previewUrl = await driver.evaluate<string>(`document.querySelector(${JSON.stringify(currentFrame)}).src`)
    const livePreviewUrl = previewUrl
    await driver.waitForInFrame(livePreviewUrl, `Boolean(${renderedRect(snappedId)})`, { timeoutMs: 30_000 })
    await waitForCompiledPreview(driver)
    HCI.logProcessInfo('HNReader Feed', 'Generated Story and Title drops')
    await driver.click('.studio-agent-collapse')
    await driver.click('.studio-rail-button[data-panel="data"]')
    await driver.waitFor(`document.querySelector('${feedPanel} [aria-label="Feed entity"]') !== null`)
    await driver.waitFor(`document.querySelector('${feedPanel} [aria-label="Feed entity"]')?.value === 'Story'`)
    await clickText(driver, `${feedPanel} [aria-label="Feed source"] button`, 'Generated')
    const bind = async () => {
      await driver.click('[data-preset="draw"]')
      await driver.waitFor(`document.querySelector('.tao-studio-product-host')?.dataset.layoutPreset === 'draw'`)
      await driver.waitFor(`document.querySelector(${JSON.stringify(board)}) !== null`)
      await driver.evaluate(
        `document.querySelector(${JSON.stringify(board)}).scrollIntoView({block:'center',inline:'center'})`,
      )
      await waitForVisibleTarget(driver, board)
      const typical = await markText(driver, `${feedPanel} .studio-feed-row`, 'StoryTypical', 'row')
      await driver.drag(typical, board)
      await waitForKeep(driver)
      const freeRect = `[data-tao-studio-sketch-rect="${freeId}"]`
      await driver.waitFor(`document.querySelector(${JSON.stringify(freeRect)}) !== null`)
      await driver.evaluate(
        `document.querySelector(${JSON.stringify(freeRect)}).scrollIntoView({block:'center',inline:'center'})`,
      )
      await waitForVisibleTarget(driver, freeRect)
      await driver.drag(await titleChip(driver), freeRect)
      await waitForKeep(driver)
      await driver.waitFor(
        `document.querySelector('[data-tao-studio-sketch-rect="${freeId}"]')?.textContent.includes('Example item') === true`,
      )
      await driver.click('[data-preset="design"]')
      await driver.click('.studio-rail-button[data-panel="data"]')
      await driver.pressShortcut('0')
      await waitForCompiledPreview(driver)
      await dropTitleInFrame(driver, await titleChip(driver), currentFrame, livePreviewUrl, snappedId)
      await waitForKeep(driver)
      await waitForRenderedTitle(driver, livePreviewUrl, snappedId)
    }
    await bind()
    Expect(await FS.readText(viewPath)).toBe(beforeView)
    Expect(await FS.readText(catalogPath)).toBe(beforeCatalogText)
    Expect(await FS.exists(fixturePath)).toBe(false)
    await clickText(driver, feedButtons, 'Discard')
    await waitForNoKeep(driver)
    Expect(await FS.readText(viewPath)).toBe(beforeView)
    Expect(await FS.readText(catalogPath)).toBe(beforeCatalogText)
    Expect(await FS.exists(fixturePath)).toBe(false)

    await bind()
    HCI.logProcessInfo('HNReader Feed', 'Keep and Undo Keep')
    await clickText(driver, feedButtons, 'Keep')
    await until(async () => await FS.exists(fixturePath) && (await FS.readText(viewPath)).includes('Text(Story.Title)'))
    await markText(driver, feedButtons, 'Undo Keep', 'saved')
    const keptView = await FS.readText(viewPath)
    const keptFixture = await FS.readText(fixturePath)
    Expect(keptView).toContain('use Story from @model')
    Expect(keptView).toContain('fixture Sketches')
    Expect(keptFixture).toContain('create Story')
    const keptCatalog = await catalog()
    const keptSketchRevision = keptCatalog.revision
    const keptSketch = keptCatalog.sketches[0]!
    Expect(keptSketch.rects.find(rect => rect.id === freeId)?.fieldBinding).toEqual({
      parameter: 'Story',
      path: 'Title',
      presentation: { kind: 'text' },
    })
    Expect(keptSketch.snapped.find(item => item.rect.id === snappedId)?.rect.fieldBinding).toEqual({
      parameter: 'Story',
      path: 'Title',
      presentation: { kind: 'text' },
    })
    await clickText(driver, feedButtons, 'Undo Keep')
    await until(async () =>
      await FS.readText(viewPath) === beforeView && !await FS.exists(fixturePath)
      && (await catalog()).revision > keptSketchRevision
    )
    Expect(await FS.readText(viewPath)).toBe(beforeView)
    const undone = await catalog()
    // Undo advances the revision while restoring the complete authored geometry and bindings.
    Expect(undone.sketches).toEqual(beforeCatalog.sketches)
    Expect(undone.nextViewNumber).toBe(beforeCatalog.nextViewNumber)
    await bind()
    await clickText(driver, feedButtons, 'Keep')
    await until(async () => await FS.exists(fixturePath) && await FS.readText(viewPath) === keptView)
    await markText(driver, feedButtons, 'Undo Keep', 'saved')
    Expect(await FS.readText(fixturePath)).toBe(keptFixture)
    const finalCatalog = await FS.readText(catalogPath)
    await driver.captureScreenshot('hnreader-feed-kept')
    // Reopen both the browser page and the project session, so persistence cannot come from client state.
    await studio.stop()
    HCI.logProcessInfo('HNReader Feed', 'reopen persisted project')
    studio = await startStudioSmokeLaunch({ appName: 'HNReaderStub', projectRoot, repositoryRoot: Repo.getRoot() })
    await driver.goto(studio.readiness.sessionUrl)
    const reopenedFrame = await sketchFrame(driver, 'View1')
    previewUrl = await driver.evaluate<string>(`document.querySelector(${JSON.stringify(reopenedFrame)}).src`)
    await waitForRenderedTitle(driver, previewUrl, snappedId)
    Expect(await FS.readText(viewPath)).toBe(keptView)
    Expect(await FS.readText(fixturePath)).toBe(keptFixture)
    Expect(await FS.readText(catalogPath)).toBe(finalCatalog)
    await driver.captureScreenshot('hnreader-feed-reopened')
    Expect(driver.browserFailures()).toEqual([])
  } catch (error) {
    failure = error
    if (browser !== undefined && studio !== undefined) {
      await browser.captureScreenshot('hnreader-feed-failure').catch(() => undefined)
      const body = await browser.evaluate<string>('document.body.innerText').catch(Errors.messageOf)
      const preview = previewUrl === undefined
        ? undefined
        : await browser.evaluateInFrame<string>(previewUrl, 'document.body.innerText').catch(Errors.messageOf)
      const previewDiagnostics = previewUrl === undefined
        ? undefined
        : await browser.evaluateInFrame(previewUrl, 'window.__taoStudioPreviewDiagnostics', { world: 'page' })
          .catch(Errors.messageOf)
      const manifest = await browser.evaluate(
        `fetch(location.pathname + '/api/preview/manifest').then(response => response.json())`,
      ).catch(Errors.messageOf)
      const frames = await browser.evaluate(
        `(() => [...document.querySelectorAll('.studio-preview-cell')].map(cell => ({
        cellId: cell.dataset.taoStudioCell,
        status: cell.dataset.status,
        iframe: cell.querySelector('iframe')?.src,
      })))()`,
      ).catch(Errors.messageOf)
      await FS.writeJson(FS.resolvePath('hnreader-feed-failure.json', studio.readiness.artifactRoot), {
        body,
        browserEvents: browser.browserEvents(),
        documentState: await browser.evaluate(
          `({
            url: location.href,
            readyState: document.readyState,
            html: document.documentElement.outerHTML.slice(0, 400),
            scripts: [...document.scripts].map(script => ({ src: script.src, type: script.type })),
            resources: performance.getEntriesByType('resource').map(entry => ({
              name: entry.name,
              duration: entry.duration,
              responseEnd: entry.responseEnd,
            })),
            hasConfig: Boolean(window.TaoStudioConfig),
            rootChildren: document.getElementById('tao-studio-root')?.childElementCount,
          })`,
        ).catch(Errors.messageOf),
        catalog: await FS.readJson(FS.resolvePath('.tao-project/studio/sketches.jsonc', projectRoot)).catch(
          Errors.messageOf,
        ),
        error: Errors.messageOf(error),
        frames,
        manifest,
        preview,
        previewDiagnostics,
        titleDrop: previewUrl === undefined
          ? undefined
          : await browser.evaluateInFrame(previewUrl, 'window.__hnFeedTitleDrop', { world: 'page' })
            .catch(Errors.messageOf),
        view: await FS.readText(FS.resolvePath('@/studio/View1.tao', projectRoot)).catch(Errors.messageOf),
        fixtureExists: await FS.exists(FS.resolvePath('@/studio/Sketches.tao', projectRoot)),
        launch: studio.output(),
      })
    }
    throw error
  } finally {
    await runCleanups(failure, [
      { label: 'close Feed browser', run: () => browser?.close() },
      { label: 'stop Feed Studio', run: () => studio?.stop() },
      { label: 'remove Feed project copy', run: () => FS.remove(projectRoot) },
    ], { channel: 'studio-smoke-cleanup', subject: 'HNReader Feed smoke' })
  }
}

const feedPanel = '.studio-sidebar [data-studio-panel="data"]'
const feedButtons = `${feedPanel} button`

/** The Draw strip's R tool; drawing hands back to V, so every draw picks it again. */
const rectangleTool = '[data-tao-studio-draw-tool="rect"]'

async function waitForCompiledPreview(browser: StudioCdp): Promise<void> {
  await browser.waitFor(
    `(() => {
      const status = document.querySelector('.studio-status')
      const revisions = /^compiled (\\d+) · applied (\\d+) —/.exec(status?.textContent ?? '')
      return status?.dataset.state === 'compiled' && revisions !== null && revisions[1] === revisions[2]
    })()`,
    { timeoutMs: 30_000 },
  )
}

async function drawRect(
  browser: StudioCdp,
  board: string,
  offset: { x: number; y: number },
  delta: { x: number; y: number },
): Promise<void> {
  await browser.waitFor(`document.querySelector(${JSON.stringify(board)}) !== null`)
  await browser.click(rectangleTool)
  await browser.waitFor(
    `document.querySelector('[data-tao-studio-sketch-workspace]')?.dataset.taoStudioSketchTool === 'rect'`,
  )
  await browser.dragBy(board, delta, { offset, steps: 8 })
  await browser.waitFor(
    `document.querySelector(${JSON.stringify(board)})?.dataset.taoStudioSketchGesture === undefined`,
  )
}

async function markText(browser: StudioCdp, selector: string, text: string, marker: string): Promise<string> {
  const expression = `(() => {
    for (const previous of document.querySelectorAll('[data-hn-feed-target="${marker}"]')) previous.removeAttribute('data-hn-feed-target')
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(element => element.textContent.trim() === ${
    JSON.stringify(text)
  } && !element.disabled && element.getBoundingClientRect().width > 0)
    if (!element) return false
    element.dataset.hnFeedTarget = ${JSON.stringify(marker)}
    return true
  })()`
  await browser.waitFor(expression)
  return `[data-hn-feed-target="${marker}"]`
}

async function waitForVisibleTarget(browser: StudioCdp, selector: string): Promise<void> {
  const visible = `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
    return rect && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
  })()`
  await browser.waitFor(visible)
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await browser.waitFor(visible)
}

async function clickText(browser: StudioCdp, selector: string, text: string): Promise<void> {
  const target = await markText(browser, selector, text, 'command')
  await browser.evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'center'})`)
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await markText(browser, selector, text, 'command')
  await browser.evaluate(`(() => {
    window.__hnFeedClick = false
    document.querySelector(${JSON.stringify(target)})
      .addEventListener('click', () => { window.__hnFeedClick = true }, {once:true})
  })()`)
  await browser.click(target)
  await browser.waitFor('window.__hnFeedClick === true', { timeoutMs: 10_000 })
}

async function titleChip(browser: StudioCdp): Promise<string> {
  await browser.waitFor(`(() => {
    const row = [...document.querySelectorAll('${feedPanel} .studio-feed-row')].find(row => row.textContent === 'StoryTypical')
    const field = row?.parentElement?.querySelector('.studio-feed-drag[title="Title"]')
    if (!field?.draggable || field.getBoundingClientRect().width === 0) return false
    field.dataset.hnFeedTitle = 'true'
    return true
  })()`)
  return '[data-hn-feed-title="true"]'
}

async function waitForKeep(browser: StudioCdp): Promise<void> {
  await browser.waitFor(
    `([...document.querySelectorAll(${
      JSON.stringify(feedButtons)
    })]).some(button => button.textContent === 'Keep' && !button.disabled)`,
    { timeoutMs: 30_000 },
  )
}

async function waitForNoKeep(browser: StudioCdp): Promise<void> {
  await browser.waitFor(
    `!([...document.querySelectorAll(${
      JSON.stringify(feedButtons)
    })]).some(button => button.textContent === 'Keep' && !button.disabled)`,
    { timeoutMs: 30_000 },
  )
}

async function sketchFrame(browser: StudioCdp, view: string): Promise<string> {
  const expression =
    `fetch(location.pathname + '/api/preview/manifest').then(response => response.json()).then(manifest => {
    const subject = manifest.subjects.find(subject => subject.kind === 'view' && subject.viewName === ${
      JSON.stringify(view)
    })
    const scenario = manifest.scenarios.find(scenario => scenario.subjectId === subject?.subjectId)
    const cell = manifest.cells.find(cell => cell.scenarioId === scenario?.scenarioId)
    return cell ? '[data-tao-studio-cell="' + cell.cellId + '"] iframe' : ''
  })`
  await browser.waitFor(
    `(${expression}).then(selector => selector !== '' && document.querySelector(selector) !== null)`,
    { timeoutMs: 30_000 },
  )
  return await browser.evaluate<string>(expression)
}

async function dropTitleInFrame(
  browser: StudioCdp,
  title: string,
  frame: string,
  url: string,
  rectId: string,
): Promise<void> {
  const target = renderedRect(rectId)
  await browser.waitForInFrame(url, `Boolean(${target})`, { timeoutMs: 30_000 })
  // Scrolling precedes measurement: the final CDP drag must use the same viewport coordinates.
  await browser.evaluate(`document.querySelector(${JSON.stringify(title)}).scrollIntoView({block:'center'})`)
  await browser.evaluate(
    `document.querySelector(${JSON.stringify(frame)}).scrollIntoView({block:'center',inline:'center'})`,
  )
  const local = await browser.evaluateInFrame<{ x: number; y: number }>(
    url,
    `(() => {
    const rect = (${target}).getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`,
  )
  const point = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const frame = document.querySelector(${JSON.stringify(frame)})
    const rect = frame.getBoundingClientRect()
    const scale = rect.width / frame.clientWidth
    return { x: rect.left + ${local.x} * scale, y: rect.top + ${local.y} * scale }
  })()`)
  await browser.evaluateInFrame(
    url,
    `(() => {
    window.__hnFeedTitleDrop = 'none'
    document.addEventListener('drop', event => {
      window.__hnFeedTitleDrop = event.target?.outerHTML?.slice(0, 300) ?? 'unknown'
    }, {capture:true, once:true})
  })()`,
    { world: 'page' },
  )
  await browser.dragToPoint(title, point)
}

function renderedRect(rectId: string): string {
  return `[...document.querySelectorAll('[data-tao-studio]')].find(element => {
    try { return JSON.parse(element.getAttribute('data-tao-studio')).studioRectId === ${JSON.stringify(rectId)} }
    catch { return false }
  })`
}

async function waitForRenderedTitle(browser: StudioCdp, url: string, rectId: string): Promise<void> {
  await browser.waitForInFrame(url, `(${renderedRect(rectId)})?.textContent.trim() === 'Example item'`, {
    timeoutMs: 30_000,
  })
}
