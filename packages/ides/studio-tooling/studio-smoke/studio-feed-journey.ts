import { Errors, FS } from '@shared'
import { Expect, until } from '@shared/test'
import { type StudioProjectSession, studioProtocolChannel, studioProtocolVersion } from '@studio'
import type { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

/** Invoked by the simulated-user lane: the real Feed controls drive the real source/compiler session. */
export async function exerciseStudioFeed(
  browser: StudioCdp,
  session: StudioProjectSession,
  projectRoot: string,
  sketchId: string,
  freeRectId: string,
  snappedRectId: string,
): Promise<void> {
  const dataPath = FS.resolvePath('@model/Data.tao', projectRoot)
  await FS.writeText(FS.resolvePath('@views/Package.tao', projectRoot), '// Authored views package.\n')
  await FS.writeText(
    dataPath,
    'public data Playlists / Playlist { Title text, Cover text, Score number, Tracks (owned) }\npublic data Tracks / Track { Name text, Playlist }\n',
  )
  await session.noteWatchChanges([{ path: dataPath }])
  const appFile = await session.readFile('Smoke.tao')
  const seeded = await session.syncDraft({
    ...appFile,
    content: 'use Playlist, Track from @model\n'
      + appFile.content.replace(
        'fixture Empty { }',
        'fixture Empty { Example = create Playlist { Title: "Fixture playlist", Cover: "https://example.com/cover.png", Score: 7 } }',
      )
      + '\nfixture EdgeCases { Long = create Playlist { Title: "Library playlist", Cover: "https://example.com/library.png", Score: 99 } Song = create Track { Name: "Song", Playlist: Long } }\n',
    writeId: 'feed-smoke-seed',
  })
  Expect(seeded.saved).toBe(true)
  if (seeded.compile?.status !== 'compiled') {
    Errors.throwUnexpected(`Feed seed did not compile: ${JSON.stringify(seeded.compile?.diagnostics)}`)
  }
  Expect(session.previewManifest()?.generationDeclarations.some(declaration => declaration.name === 'Playlist')).toBe(
    true,
  )
  const viewPath = FS.resolvePath('@/studio/View1.tao', projectRoot)
  const fixturePath = FS.resolvePath('@/studio/Sketches.tao', projectRoot)
  const setupCatalog = await session.sketchCatalog()
  if (!setupCatalog.sketches[0]?.snapped.some(item => item.rect.id === snappedRectId)) {
    const file = await session.readFile('@/studio/View1.tao')
    await session.applySketchSnap({
      checkpointId: 'feed-browser-leaf',
      expectedCatalogRevision: setupCatalog.revision,
      rectIds: [snappedRectId],
      requestId: 'feed-browser-leaf',
      sketchId,
      sourceVersion: file.sourceVersion,
    })
  }
  const beforeView = await FS.readText(viewPath)
  const beforeCatalog = await session.sketchCatalog()
  const board = `[data-tao-studio-sketch="${sketchId}"]`
  await browser.click('[data-preset="design"]')
  if (await browser.evaluate<boolean>(`document.querySelector('.studio-interaction-mode')?.dataset.mode === 'run'`)) {
    await browser.click('.studio-interaction-mode')
  }
  await browser.waitFor(`document.querySelector('.studio-interaction-mode')?.dataset.mode === 'edit'`)
  await browser.pressShortcut('k')
  await browser.insertText('show data')
  await browser.waitFor(`document.querySelector('.studio-command-result strong')?.textContent === 'Show Data'`)
  await browser.click('.studio-command-result')
  await browser.waitFor(`document.querySelector('[aria-label="Feed entity"]') !== null`)
  await chooseSource(browser, 'Fixture')
  await browser.waitFor(
    `Array.from(document.querySelectorAll('.studio-feed-row')).some(row => row.textContent === 'Example')`,
  )
  await feedDrag(browser, '.studio-feed-row:not(:disabled)', board)
  await waitForKeep(browser)
  Expect(await FS.readText(viewPath)).toBe(beforeView)
  await clickFeedCommand(browser, 'Discard')
  await until(() => session.feedSourceOverrides() === undefined)
  // Source changes refresh the preview; selecting the source requests fresh Feed metadata.
  await chooseSource(browser, 'Generated')
  try {
    await browser.waitFor(`document.querySelectorAll('.studio-feed-row:not(:disabled)').length > 0`)
  } catch (cause) {
    await browser.captureScreenshot('studio-feed-no-rows')
    const panel = await browser.evaluate<string>(`document.querySelector('.studio-drawer-content')?.textContent ?? ''`)
    Errors.throwHostEnvironment(`Feed rows did not load: ${panel}`, { cause })
  }
  await feedDrag(browser, '.studio-feed-row:not(:disabled)', board)
  await waitForKeep(browser)
  Expect(await FS.readText(viewPath)).toBe(beforeView)
  Expect(await FS.exists(fixturePath)).toBe(false)
  Expect(session.feedSourceOverrides()?.[viewPath]).toContain('Playlist')
  await feedDrag(browser, '.studio-feed-drag[title="Title"]', `[data-tao-studio-sketch-rect="${freeRectId}"]`)
  await waitForKeep(browser)
  Expect((await session.sketchCatalog()).sketches[0]?.rects.find(rect => rect.id === freeRectId)?.fieldBinding?.path)
    .toBe('Title')
  Expect(await FS.readText(viewPath)).toBe(beforeView)
  await feedDragToPreview(browser, session, '.studio-feed-drag[title="Title"]', sketchId, snappedRectId)
  await until(() => session.feedSourceOverrides()?.[viewPath]?.includes('Text(Playlist.Title)') === true)
  await waitForKeep(browser)
  Expect(session.feedSourceOverrides()?.[viewPath]).toContain('Text(Playlist.Title)')
  await clickFeedCommand(browser, 'Keep')
  await until(async () =>
    (await session.sketchCatalog()).revision > beforeCatalog.revision && session.feedSourceOverrides() === undefined
  )
  const keptView = await FS.readText(viewPath)
  Expect(keptView).toContain('Playlist')
  Expect(keptView).toContain('fixture Sketches')
  Expect(await FS.readText(fixturePath)).toContain('create Playlist')
  Expect(session.feedSourceOverrides()).toBeUndefined()
  const keptCatalog = await session.sketchCatalog()
  Expect(keptCatalog.revision).toBe(beforeCatalog.revision + 1)
  Expect(keptCatalog.sketches[0]?.snapped.find(item => item.rect.id === snappedRectId)?.target.elementName).toBe('Text')

  await chooseSource(browser, 'Live')
  await browser.waitFor(
    `Array.from(document.querySelectorAll('.studio-feed-drag')).some(field => field.textContent.includes('Live playlist'))`,
  )
  await feedDrag(browser, '.studio-feed-row:not(:disabled)', board)
  await waitForKeep(browser)
  Expect(await FS.readText(viewPath)).toBe(keptView)
  await clickFeedCommand(browser, 'Discard')
  await until(() => session.feedSourceOverrides() === undefined)

  await chooseSource(browser, 'Library')
  await browser.waitFor(
    `Array.from(document.querySelectorAll('.studio-feed-row')).some(row => row.textContent === 'Long')`,
  )
  await feedDrag(browser, '.studio-feed-row:not(:disabled)', board)
  await waitForKeep(browser)
  Expect(await FS.readText(viewPath)).toBe(keptView)
  await clickFeedCommand(browser, 'Discard')
  await until(() => session.feedSourceOverrides() === undefined)
  Expect(await FS.readText(viewPath)).toBe(keptView)
  Expect(session.feedSourceOverrides()).toBeUndefined()
  await feedDrag(
    browser,
    '.studio-feed-drag[title="Tracks (collection)"]',
    `[data-tao-studio-sketch-rect="${freeRectId}"]`,
  )
  await until(() => session.feedSourceOverrides()?.[viewPath]?.includes('loop Playlist.Tracks') === true)
  await waitForKeep(browser)
  await clickFeedCommand(browser, 'Keep')
  await until(async () =>
    (await session.sketchCatalog()).revision > keptCatalog.revision && session.feedSourceOverrides() === undefined
  )
  Expect(await FS.readText(viewPath)).toContain('loop Playlist.Tracks')
  await browser.waitFor(
    `Array.from(document.querySelectorAll('.studio-data button, .studio-drawer-content button')).some(button => button.textContent === 'Undo Keep' && !button.disabled)`,
  )
  await clickFeedCommand(browser, 'Undo Keep')
  await until(async () => await FS.readText(viewPath) === keptView)
  Expect((await session.sketchCatalog()).sketches[0]?.rects.some(rect => rect.id === freeRectId)).toBe(true)
  await browser.captureScreenshot('studio-feed-kept-example')
  await browser.click('.studio-rail-button[data-panel="files"]')
  for (const folder of ['@', 'studio']) {
    const collapsed = `[data-studio-tree-folder="${folder}"] > button[aria-expanded="false"]`
    if (await browser.evaluate<boolean>(`document.querySelector(${JSON.stringify(collapsed)}) !== null`)) {
      await browser.click(collapsed)
    }
  }
  await browser.waitFor(`document.querySelector('button[aria-label="Move View1.tao to package"]') !== null`)
  await browser.click('button[aria-label="Move View1.tao to package"]')
  await browser.waitFor(`document.querySelector('input[aria-label="Target package for View1.tao"]') !== null`)
  Expect(
    await browser.evaluate<boolean>(
      `document.querySelector('form[aria-label="Move View1.tao to package"] input[type="checkbox"]').checked`,
    ),
  ).toBe(true)
  await browser.click('input[aria-label="Target package for View1.tao"]')
  await browser.pressShortcut('a')
  await browser.insertText('@views')
  await browser.waitFor(`document.querySelector('input[aria-label="Target package for View1.tao"]').value === '@views'`)
  await browser.click('button[aria-label="Move to package"]')
  try {
    await until(async () => await FS.isFile(FS.resolvePath('@views/View1.tao', projectRoot)))
  } catch (cause) {
    await browser.captureScreenshot('studio-feed-move-failed')
    const status = await browser.evaluate<string>(`document.body.innerText`)
    Errors.throwHostEnvironment(
      `Feed view Move did not complete: ${JSON.stringify(browser.consoleErrors())}\n${status}`,
      { cause },
    )
  }
  await until(async () => !(await session.sketchCatalog()).sketches.some(sketch => sketch.id === sketchId))
  Expect(await FS.readText(FS.resolvePath('@views/View1.tao', projectRoot))).not.toContain('scenarios View1')
  Expect(await FS.readText(FS.resolvePath('Scenarios.tao', projectRoot))).toContain('scenarios View1')
  Expect(await FS.readText(fixturePath)).toContain('create Playlist')
}

async function feedDragToPreview(
  browser: StudioCdp,
  session: StudioProjectSession,
  selector: string,
  sketchId: string,
  rectId: string,
): Promise<void> {
  const sketch = (await session.sketchCatalog()).sketches.find(sketch => sketch.id === sketchId)!
  const target = sketch.snapped.find(item => item.rect.id === rectId)!.target
  const manifest = session.previewManifest()!
  const subject = manifest.subjects.find(subject => subject.kind === 'view' && subject.viewName === sketch.view)!
  const scenario = manifest.scenarios.find(scenario => scenario.subjectId === subject.subjectId)!
  const cell = manifest.cells.find(cell => cell.scenarioId === scenario.scenarioId)!
  await browser.waitFor(`document.querySelector('[data-tao-studio-cell="${cell.cellId}"]') !== null`)
  await activateSmokePreviews(browser)
  const frameSelector = `[data-tao-studio-cell="${cell.cellId}"] iframe`
  await browser.waitFor(`document.querySelector(${JSON.stringify(frameSelector)}) instanceof HTMLIFrameElement`)
  const url = await browser.evaluate<string>(`document.querySelector(${JSON.stringify(frameSelector)}).src`)
  const payload = await browser.evaluate<string>(`(() => {
    const from = document.querySelector(${JSON.stringify(selector)})
    const dataTransfer = new DataTransfer()
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    return dataTransfer.getData('application/x-tao-studio-feed')
  })()`)
  Expect(payload).not.toBe('')
  const message = {
    channel: studioProtocolChannel,
    protocolVersion: studioProtocolVersion,
    drop: JSON.parse(payload),
    type: 'preview-feed-drop',
    renderId: target.renderId,
    studioRectId: rectId,
    identity: {
      ...session.previewCell(cell.cellId).identity,
      previewInstanceId: new URL(url).searchParams.get('taoStudioPreviewInstanceId'),
      path: FS.resolvePath(target.path, session.projectRoot),
      sourceVersion: target.sourceVersion,
      occurrence: { nodeKind: 'render', renderOwner: sketch.view },
    },
  }
  // The smoke preview is simulated. Runtime tests own native hit-testing; this crosses the real
  // iframe origin/instance boundary with the adapter's actual payload and current render identity.
  await browser.evaluateInFrame(
    url,
    `parent.postMessage(${JSON.stringify(message)}, new URL(location.href).searchParams.get('taoStudioParentOrigin'))`,
  )
}

async function chooseSource(browser: StudioCdp, name: string): Promise<void> {
  const selector = await browser.evaluate<string>(`(() => {
    const group = Array.from(document.querySelectorAll('[aria-label="Feed source"]')).find(element => element.getBoundingClientRect().width > 0)
    const button = group && Array.from(group.querySelectorAll('button')).find(button => button.textContent === ${
    JSON.stringify(name)
  })
    if (!button) return ''
    button.dataset.feedSmokeTarget = 'source'
    return '[data-feed-smoke-target="source"]'
  })()`)
  Expect(selector).not.toBe('')
  await browser.click(selector)
  await browser.evaluate(
    `document.querySelector('[data-feed-smoke-target="source"]')?.removeAttribute('data-feed-smoke-target')`,
  )
}

async function clickFeedCommand(browser: StudioCdp, name: string): Promise<void> {
  const found = await browser.evaluate<boolean>(`(() => {
    for (const old of document.querySelectorAll('[data-feed-smoke-target="command"]')) old.removeAttribute('data-feed-smoke-target')
    const button = Array.from(document.querySelectorAll('.studio-data button, .studio-drawer-content button'))
      .find(button => button.textContent === ${
    JSON.stringify(name)
  } && !button.disabled && button.getBoundingClientRect().width > 0)
    if (!button) return false
    button.dataset.feedSmokeTarget = 'command'
    return true
  })()`)
  Expect(found).toBe(true)
  await browser.click('[data-feed-smoke-target="command"]')
}

async function waitForKeep(browser: StudioCdp): Promise<void> {
  try {
    await browser.waitFor(
      `Array.from(document.querySelectorAll('.studio-data button, .studio-drawer-content button')).some(button => button.textContent === 'Keep' && !button.disabled)`,
      { timeoutMs: 30_000 },
    )
  } catch (cause) {
    const panel = await browser.evaluate<string>(
      `Array.from(document.querySelectorAll('.studio-data, .studio-drawer-content')).map(panel => panel.textContent).join(' | ')`,
    )
    Errors.throwHostEnvironment(`Feed Keep did not become available: ${panel}`, { cause })
  }
  await browser.waitFor(`!document.querySelector('.studio-data')?.textContent?.includes('Applying Feed')`)
}

async function feedDrag(browser: StudioCdp, source: string, target: string): Promise<void> {
  await browser.waitFor(
    `document.querySelector(${JSON.stringify(source)})?.draggable === true && document.querySelector(${
      JSON.stringify(target)
    }) instanceof HTMLElement`,
  )
  // Native drag adapters and DOM drop listeners are the boundary under test. Capture the actual
  // adapter payload; never construct a request or bypass the controller with an API call here.
  const dispatched = await browser.evaluate<boolean>(`(() => {
    const from = document.querySelector(${JSON.stringify(source)})
    const to = document.querySelector(${JSON.stringify(target)})
    if (!(from instanceof HTMLElement) || !(to instanceof HTMLElement)) return false
    const dataTransfer = new DataTransfer()
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    if (!dataTransfer.getData('application/x-tao-studio-feed')) return false
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
    return true
  })()`)
  Expect(dispatched).toBe(true)
}
