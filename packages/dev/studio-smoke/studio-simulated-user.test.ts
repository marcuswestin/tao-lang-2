import { Errors, FS, Platform, Time } from '@shared'
import { Expect, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  startStudioSessionServer,
  studioProtocolChannel,
  studioProtocolVersion,
  StudioSessionManager,
  studioSourceActionVersion,
} from '@studio'
import { StudioCdp } from '../dev-src/studio/StudioCdp'
import { type StartedStudioNative, StudioNative } from '../dev-src/studio/StudioNative'

const initialSource = `use Stack, Text from @tao/ui
app Smoke { view MainView }
view MainView() {
  render Stack() {
    Text("First")
    Text("Second")
    Text("Third")
  }
}
fixture Empty { }
scenarios MainView "states" {
  fixture Empty
  device phone
  scenario "default" { render MainView() }
}
`

const typedSource = initialSource.replace('Text("First")', 'Text("First typed")')

Test('simulated preview stays within the preview-origin API boundary', () => {
  const html = previewHtml()
  Expect(html).toContain("message.type !== 'highlight-source'")
  Expect(html).toContain('/api/preview/cell/bootstrap')
  Expect(html).not.toContain('/api/protocol')
  Expect(html).not.toContain('/api/file?')
})

Test('sketch persistence evidence requires catalog-only rectangle mutation', () => {
  const before = smokeSketchCatalog(JSON.stringify({
    revision: 1,
    sketches: [{ height: 76, id: 'sketch-1', name: 'View1', rectOrder: [], rects: [], snapped: [], width: 360 }],
  }))
  const after = smokeSketchCatalog(JSON.stringify({
    revision: 2,
    sketches: [{
      height: 76,
      id: 'sketch-1',
      name: 'View1',
      rectOrder: ['rect-1'],
      rects: [{ height: 24, id: 'rect-1', kind: 'Placeholder', width: 64, x: 0, y: 0 }],
      snapped: [],
      width: 360,
    }],
  }))

  Expect(sketchPersistenceObserved(before, after, 'generated source', 'generated source')).toBe(true)
  Expect(sketchPersistenceObserved(before, after, 'generated source', 'rewritten source')).toBe(false)
})

// The browser branch is the full editor/preview journey in the `full-verify` graph. The native branch
// validates the unattended Electrobun capability probe; it does not repeat the browser journey.
Test('simulated user exercises the browser editor or the native Electrobun shell', async () => {
  const artifactParent = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT'] ?? FS.tmpdir()
  await FS.mkdir(artifactParent)
  // The smoke artifact root normally lives under the repository's ignored `.artifacts` tree.
  // Project discovery intentionally honors Git ignores, so keep the synthetic project outside it.
  const projectRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-simulated-user-', FS.tmpdir()))
  const sourcePath = FS.resolvePath('Smoke.tao', projectRoot)
  let browser: StudioCdp | undefined
  let native: StartedStudioNative | undefined
  let preview: ReturnType<typeof startPreviewServer> | undefined
  let previewSession: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let studio: Awaited<ReturnType<typeof startStudioSessionServer>> | undefined
  let manager: StudioSessionManager | undefined
  try {
    await FS.writeText(sourcePath, initialSource)
    // The real compile lane refuses a project without checked-in identity.
    await FS.writeText(
      FS.resolvePath('Project.tao', projectRoot),
      'project { id "tao-studio-simulated-user-smoke" name "Simulated user smoke" }\n',
    )
    preview = startPreviewServer(smokePort('TAO_STUDIO_SMOKE_PREVIEW_PORT', 42_001))
    // The scenario canvas and inspector only exist once a preview manifest is published, and only
    // the real compile lane publishes one. A stubbed compile leaves `previewManifest()` undefined,
    // so `scenarioRows()` returns nothing and no scenario UI can render.
    const previewRuntimeRoot = FS.resolvePath('runtime', artifactParent)
    await FS.remove(previewRuntimeRoot)
    previewSession = await openStudioPreviewSession({
      entryPath: sourcePath,
      previewRuntimeRoot,
      projectRoot,
    })
    const session = previewSession.session
    const initialCompile = await session.compileInitial()
    if (initialCompile.status !== 'compiled') {
      Errors.throwUnexpected(`The smoke fixture must compile for this lane to mean anything: ${initialCompile.message}`)
    }
    manager = new StudioSessionManager()
    const current = manager.add({ previewUrl: preview.url, session })
    studio = await startStudioSessionServer(manager, {
      hostname: '127.0.0.1',
      port: smokePort('TAO_STUDIO_SMOKE_SERVER_PORT', 42_000),
    })
    const projectUrl = `${studio.url}/sessions/${encodeURIComponent(current.sessionId)}`
    if (Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_NATIVE'] === 'true') {
      native = await StudioNative.start({
        artifactRoot: FS.resolvePath('electrobun', artifactParent),
        previewUrl: preview.url,
        projectUrl,
        probe: true,
        showWindow: false,
        studioUrl: studio.url,
      })
      const result = await native.waitForProbe()
      Expect(result.passed).toBe(true)
      Expect(Object.values(result.capabilities).every(capability => capability.passed)).toBe(true)
    } else {
      browser = await StudioCdp.launchChrome({ artifactRoot: artifactParent })
      await browser.setViewport(1_440, 900)
      await browser.goto(projectUrl)
      await browser.waitFor(
        `(() => {
        const shell = document.querySelector('.studio-shell')
        const viewport = document.querySelector('#tao-studio-viewport')
        if (!(shell instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return false
        const shellRect = shell.getBoundingClientRect()
        const viewportRect = viewport.getBoundingClientRect()
        return shellRect.top === 0
          && shellRect.height === viewportRect.height
          && shellRect.height === window.innerHeight
          && shellRect.width === window.innerWidth
      })()`,
        { timeoutMs: 30_000 },
      )
      await browser.waitFor("document.querySelector('.cm-content')?.textContent.includes('Text(\"First\")')", {
        timeoutMs: 30_000,
      })
      Expect(
        await browser.evaluate<number>(
          "document.querySelectorAll('.studio-editor .cm-editor').length",
        ),
      ).toBe(1)
      await browser.waitFor(
        `document.querySelector('.studio-preview-group-label')?.textContent === 'states'`,
        { timeoutMs: 30_000 },
      )
      await browser.waitFor(
        `document.querySelector('[data-studio-tao-scenario="true"] .studio-scenario-inspector-label')?.textContent === 'default'`,
        { timeoutMs: 30_000 },
      )
      await browser.captureScreenshot('studio-wide-desktop')
      await browser.setViewport(1_024, 768)
      await browser.waitFor(
        "document.querySelector('.studio-shell')?.getBoundingClientRect().width === window.innerWidth",
      )
      await browser.captureScreenshot('studio-narrow-desktop')
      await browser.setViewport(1_440, 900)

      const initialPaneSizes = await browser.evaluate<{ left: number; preview: number }>(`(() => ({
        left: Number(document.querySelector('[data-divider="left"]')?.getAttribute('aria-valuenow')),
        preview: Number(document.querySelector('[data-divider="preview"]')?.getAttribute('aria-valuenow')),
      }))()`)
      await browser.dragBy('[data-divider="left"]', { x: 48, y: 0 })
      await browser.waitFor(
        `Number(document.querySelector('[data-divider="left"]')?.getAttribute('aria-valuenow')) === ${
          initialPaneSizes.left + 48
        }`,
      )
      // The preview is the right-hand pane, so moving its left divider left increases its width.
      await browser.dragBy('[data-divider="preview"]', { x: -40, y: 0 })
      await browser.waitFor(
        `Number(document.querySelector('[data-divider="preview"]')?.getAttribute('aria-valuenow')) === ${
          initialPaneSizes.preview + 40
        }`,
      )
      await browser.captureScreenshot('studio-resized-workbench')

      await browser.pressShortcut('k')
      await browser.waitFor(
        `document.querySelector('.studio-command-overlay')?.hidden === false
          && document.activeElement === document.querySelector('.studio-command-overlay input')`,
      )
      await browser.insertText('show compile')
      await browser.waitFor(
        `document.querySelector('.studio-command-result strong')?.textContent === 'Show Compile'`,
      )
      await browser.click('.studio-command-result')
      await browser.waitFor(
        `document.querySelector('[data-drawer-tab="Compile"]')?.getAttribute('aria-current') === 'true'`,
      )
      await browser.waitFor(
        `document.querySelector('.studio-drawer-content')?.textContent?.includes('Compile:') === true`,
      )
      Expect(await browser.evaluate<boolean>(`document.querySelector('[data-studio-tao-drawer]') === null`)).toBe(true)

      let compileRevision = await waitForCompileAfter(browser, -1)
      await browser.click('.cm-content')
      await browser.pressShortcut('a')
      await browser.insertText(typedSource)
      await browser.waitFor(
        `document.querySelector('.cm-content')?.textContent.includes('Text("First typed")')`,
      )
      Expect(await FS.readText(sourcePath)).toBe(initialSource)
      await browser.pressShortcut('s')
      await waitForSource(sourcePath, source => source === typedSource)
      compileRevision = await waitForCompileAfter(browser, compileRevision)
      Expect(await browser.evaluate<string>("document.querySelector('.cm-content')?.textContent ?? ''"))
        .toContain('Text("First typed")')

      await browser.click('[data-panel="components"]')
      await browser.waitFor(
        `document.querySelector('[data-tao-studio-component="Text"]') instanceof HTMLButtonElement`,
      )
      await browser.drag('[data-tao-studio-component="Text"]', '.cm-content', { steps: 12 })
      await browser.waitFor("document.querySelector('.cm-content')?.textContent.includes('New text')")
      await browser.pressShortcut('z')
      await browser.waitFor("!document.querySelector('.cm-content')?.textContent.includes('New text')")
      Expect(await browser.evaluate<string>("document.querySelector('.cm-content')?.textContent ?? ''"))
        .toContain('Text("First typed")')
      Expect(await FS.readText(sourcePath)).toBe(typedSource)

      await waitForPreviewSourceIdentity(browser, preview.url)
      await clickPreviewAndWaitForState(browser, preview.url, '#select-first', 'selection sent')
      await waitForInspectorReady(browser)
      await browser.drag(
        '[data-tao-studio-component="Text"]',
        '.studio-preview-group-label',
        { steps: 12 },
      )
      await waitForSourceOrStudioError(browser, sourcePath, source => source.includes('Text("New text")'))
      compileRevision = await waitForCompileAfter(browser, compileRevision)
      await browser.waitFor(
        `document.querySelector('[data-studio-tao-inspector-context="Layout"] [data-tao-studio-undo] button')?.disabled === false`,
      )
      await browser.click('[data-studio-tao-inspector-context="Layout"] [data-tao-studio-undo] button')
      await waitForSourceOrStudioError(browser, sourcePath, source => source === typedSource)
      compileRevision = await waitForCompileAfter(browser, compileRevision)

      await waitForPreviewSourceIdentity(browser, preview.url)
      await clickPreviewUntilSource(
        browser,
        preview.url,
        '#move-third',
        sourcePath,
        source => ordered(source, ['First typed', 'Third', 'Second']),
      )
      compileRevision = await waitForCompileAfter(browser, compileRevision)
      await browser.waitFor("document.querySelector('[data-tao-studio-undo] button')?.disabled === false")
      await browser.click('[data-tao-studio-undo] button')
      await waitForSource(sourcePath, source => source === typedSource)
      await waitForCompileAfter(browser, compileRevision)

      const generatedSketchPath = FS.resolvePath('@/studio/View1.tao', projectRoot)
      const sketchCatalogPath = FS.resolvePath('.tao-project/studio/sketches.jsonc', projectRoot)
      await browser.waitFor(
        `document.querySelector('[data-tao-studio-sketch-workspace]') instanceof HTMLElement`,
      )
      await browser.dragBy('[data-tao-studio-sketch-workspace]', { x: 360, y: 76 }, { steps: 12 })
      await waitForSketchFile(browser, generatedSketchPath)
      await waitForFile(sketchCatalogPath)
      await browser.waitFor(
        `[...document.querySelectorAll('.studio-preview-group-label')].some(label => label.textContent === 'sketch')
          && [...document.querySelectorAll('[data-studio-tao-scenario="true"] .studio-scenario-inspector-label')]
            .some(label => label.textContent === 'draft')
          && document.querySelector('[data-tao-studio-sketch]') instanceof HTMLElement`,
        { timeoutMs: 30_000 },
      )
      const generatedBeforeRect = await FS.readText(generatedSketchPath)
      const catalogBeforeRect = await FS.readText(sketchCatalogPath)
      const createdCatalog = smokeSketchCatalog(catalogBeforeRect)
      Expect(createdCatalog.sketches).toHaveLength(1)
      Expect(createdCatalog.sketches[0]).toMatchObject({ height: 76, name: 'View1', rects: [], width: 360 })

      await browser.dragBy('[data-tao-studio-sketch]', { x: 64, y: 24 }, { steps: 8 })
      const persistedCatalog = await waitForSketchRect(sketchCatalogPath, createdCatalog.revision)
      const persistedSketch = persistedCatalog.sketches[0]!
      const persistedRect = persistedSketch.rects[0]!
      Expect(persistedRect).toMatchObject({ height: 24, kind: 'Placeholder', width: 64 })
      Expect(sketchPersistenceObserved(
        createdCatalog,
        persistedCatalog,
        generatedBeforeRect,
        await FS.readText(generatedSketchPath),
      )).toBe(true)

      await browser.goto(projectUrl)
      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${persistedSketch.id}"]`)})
          ?.querySelector(${
          JSON.stringify(`[data-tao-studio-sketch-rect="${persistedRect.id}"]`)
        }) instanceof HTMLElement`,
        { timeoutMs: 30_000 },
      )
      const reloadedRect = await browser.evaluate<{ height: number; width: number }>(`(() => {
        const element = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-rect="${persistedRect.id}"]`)})
        if (!(element instanceof HTMLElement)) return { height: 0, width: 0 }
        const bounds = element.getBoundingClientRect()
        return { height: bounds.height, width: bounds.width }
      })()`)
      Expect(reloadedRect).toEqual({ height: 24, width: 64 })

      // Preserve the original free rectangle, then build the clean playlist-row projection beside it.
      const playlistRects = [
        { height: 52, width: 52, x: 12, y: 8 },
        { height: 20, width: 100, x: 76, y: 8 },
        { height: 20, width: 100, x: 76, y: 40 },
        { height: 20, width: 36, x: 300, y: 28 },
      ] as const
      let drawCatalog = persistedCatalog
      const playlistRectIds: string[] = []
      for (const rectangle of playlistRects) {
        await drawSketchRectangle(browser, persistedSketch.id, rectangle)
        drawCatalog = await waitForSketchCatalog(
          sketchCatalogPath,
          catalog =>
            catalog.revision > drawCatalog.revision && catalog.sketches[0]?.rects.length === playlistRectIds.length + 2,
        )
        playlistRectIds.push(drawCatalog.sketches[0]!.rects.at(-1)!.id)
      }
      for (const rectId of playlistRectIds.slice(0, -1)) {
        await shiftSelectSketchRectangle(browser, persistedSketch.id, rectId)
      }
      await browser.waitFor(
        `document.querySelectorAll(${
          JSON.stringify(
            `[data-tao-studio-sketch="${persistedSketch.id}"] [data-tao-studio-sketch-rect][data-selected="true"]`,
          )
        }).length === 4`,
      )
      const sourceBeforeSnap = await FS.readText(generatedSketchPath)
      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)})
          instanceof HTMLButtonElement
          && document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)})
            ?.disabled === false`,
      )
      await browser.click(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)
      const snappedCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > drawCatalog.revision
          && catalog.sketches[0]?.rects.length === 1
          && catalog.sketches[0]?.snapped.length === 4,
      )
      const snappedSource = await FS.readText(generatedSketchPath)
      Expect(snappedSource).not.toBe(sourceBeforeSnap)
      Expect(snappedSource).toContain('render Row()')
      Expect(snappedSource).toContain('Col()')
      for (const rectId of playlistRectIds) {
        Expect(snappedSource).toContain(studioRectTag(rectId))
      }
      Expect(snappedCatalog.sketches[0]?.rects.map(rect => rect.id)).toEqual([persistedRect.id])
      Expect(snappedCatalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(playlistRectIds)
      Expect(snappedCatalog.sketches[0]?.rectOrder).toEqual([persistedRect.id, ...playlistRectIds])

      await browser.goto(projectUrl)
      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)})
          instanceof HTMLButtonElement
          && document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)})
            ?.disabled === false`,
        { timeoutMs: 30_000 },
      )
      const reloadedSnapCatalog = smokeSketchCatalog(await FS.readText(sketchCatalogPath))
      Expect(reloadedSnapCatalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(playlistRectIds)
      Expect(await FS.readText(generatedSketchPath)).toBe(snappedSource)

      // Drag the one remaining free rectangle into the existing flow, then undo that incremental Snap.
      Expect(
        await browser.evaluate<boolean>(
          `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-gap-indicator]`)}) instanceof HTMLElement`,
        ),
      ).toBe(true)
      await browser.drag(
        `[data-tao-studio-sketch-rect="${persistedRect.id}"]`,
        `[data-tao-studio-sketch="${persistedSketch.id}"]`,
        { steps: 12 },
      )
      const incrementallySnappedCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > reloadedSnapCatalog.revision
          && catalog.sketches[0]?.rects.length === 0
          && catalog.sketches[0]?.snapped.length === 5,
      )
      Expect(await FS.readText(generatedSketchPath)).toContain(studioRectTag(persistedRect.id))
      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`)})
          ?.disabled === false`,
      )
      await browser.click(`[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`)
      const incrementalUndoCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > incrementallySnappedCatalog.revision
          && catalog.sketches[0]?.rects.map(rect => rect.id).join(',') === persistedRect.id
          && catalog.sketches[0]?.snapped.length === 4,
      )
      Expect(incrementalUndoCatalog.sketches[0]?.rectOrder).toEqual(reloadedSnapCatalog.sketches[0]?.rectOrder)
      Expect(await FS.readText(generatedSketchPath)).toBe(snappedSource)

      const retained = incrementalUndoCatalog.sketches[0]!.snapped[0]!.rect
      await browser.evaluate(`(() => {
        const select = document.querySelector(${
        JSON.stringify(
          `[data-tao-studio-sketch="${persistedSketch.id}"] select[aria-label="Snapped rectangles"]`,
        )
      })
        if (!(select instanceof HTMLSelectElement)) throw new Error('Missing snapped rectangle selector')
        const option = [...select.options].find(candidate => candidate.value === ${JSON.stringify(retained.id)})
        if (!(option instanceof HTMLOptionElement)) throw new Error('Missing retained snapped rectangle option')
        option.selected = true
      })()`)
      await browser.click(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)
      const unsnappedCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > incrementalUndoCatalog.revision
          && catalog.sketches[0]?.rects.some(rect => rect.id === retained.id) === true
          && catalog.sketches[0]?.snapped.length === 3,
      )
      Expect(unsnappedCatalog.sketches[0]?.rects.find(rect => rect.id === retained.id)).toEqual(retained)
      Expect(unsnappedCatalog.sketches[0]?.rectOrder).toEqual([persistedRect.id, ...playlistRectIds])
      const unsnappedSource = await FS.readText(generatedSketchPath)
      Expect(unsnappedSource).not.toContain(studioRectTag(retained.id))
      Expect(unsnappedSource).toContain('render Row()')

      // Clear the remaining snapped tree before the isolated overlap/confirmation transaction.
      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)})
          ?.disabled === false`,
      )
      await browser.click(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)
      const fullyUnsnappedCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > unsnappedCatalog.revision
          && catalog.sketches[0]?.rects.length === 5
          && catalog.sketches[0]?.snapped.length === 0,
      )
      Expect(await FS.readText(generatedSketchPath)).toContain(`Placeholder("View1")`)

      const firstOverlap = { height: 30, width: 40, x: 200, y: 4 }
      await drawSketchRectangle(browser, persistedSketch.id, firstOverlap)
      const overlapOne = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog => catalog.revision > fullyUnsnappedCatalog.revision && catalog.sketches[0]?.rects.length === 6,
      )
      const firstOverlapId = overlapOne.sketches[0]!.rects.at(-1)!.id
      await drawSketchRectangle(browser, persistedSketch.id, { height: 20, width: -30, x: 250, y: 14 })
      const overlapTwo = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog => catalog.revision > overlapOne.revision && catalog.sketches[0]?.rects.length === 7,
      )
      const secondOverlapId = overlapTwo.sketches[0]!.rects.at(-1)!.id
      await shiftSelectSketchRectangle(browser, persistedSketch.id, firstOverlapId)
      const beforeOverlapSource = await FS.readText(generatedSketchPath)
      const beforeOverlapCatalog = smokeSketchCatalog(await FS.readText(sketchCatalogPath))
      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)})
          ?.disabled === false`,
      )
      await browser.click(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)
      await browser.waitFor(
        `document.querySelector(${
          JSON.stringify(
            `[data-tao-studio-sketch-snap-proposal="${persistedSketch.id}"]`,
          )
        }) instanceof HTMLElement`,
      )
      Expect(
        await browser.evaluate<string>(
          `document.querySelector(${
            JSON.stringify(
              `[data-tao-studio-sketch-snap-diff]`,
            )
          })?.textContent ?? ''`,
        ),
      ).toContain('+++')
      await clickProposalButton(browser, persistedSketch.id, 'Cancel')
      await browser.waitFor(
        `document.querySelector(${
          JSON.stringify(
            `[data-tao-studio-sketch-snap-proposal="${persistedSketch.id}"]`,
          )
        }) === null`,
      )
      Expect(await FS.readText(generatedSketchPath)).toBe(beforeOverlapSource)
      Expect(smokeSketchCatalog(await FS.readText(sketchCatalogPath))).toEqual(beforeOverlapCatalog)

      await browser.click(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)
      await browser.waitFor(
        `document.querySelector(${
          JSON.stringify(
            `[data-tao-studio-sketch-snap-proposal="${persistedSketch.id}"]`,
          )
        }) instanceof HTMLElement`,
      )
      await clickProposalButton(browser, persistedSketch.id, 'Apply')
      const overlapAppliedCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > beforeOverlapCatalog.revision
          && catalog.sketches[0]?.snapped.some(item => item.rect.id === firstOverlapId) === true
          && catalog.sketches[0]?.snapped.some(item => item.rect.id === secondOverlapId) === true,
      )
      const overlapAppliedSource = await FS.readText(generatedSketchPath)
      Expect(overlapAppliedSource).not.toBe(beforeOverlapSource)
      Expect(overlapAppliedSource).toContain(studioRectTag(firstOverlapId))
      Expect(overlapAppliedSource).toContain(studioRectTag(secondOverlapId))

      await browser.waitFor(
        `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`)})
          ?.disabled === false`,
      )
      await browser.click(`[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`)
      const undoneCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > overlapAppliedCatalog.revision
          && catalog.sketches[0]?.rects.some(rect => rect.id === firstOverlapId) === true
          && catalog.sketches[0]?.rects.some(rect => rect.id === secondOverlapId) === true,
      )
      Expect(await FS.readText(generatedSketchPath)).toBe(beforeOverlapSource)
      Expect(undoneCatalog.sketches[0]?.rectOrder).toEqual(beforeOverlapCatalog.sketches[0]?.rectOrder)
      Expect(undoneCatalog.sketches[0]?.rects).toEqual(beforeOverlapCatalog.sketches[0]?.rects)
      Expect(undoneCatalog.sketches[0]?.snapped).toEqual(beforeOverlapCatalog.sketches[0]?.snapped)
      await browser.captureScreenshot('studio-completed-interactions')
      Expect(await FS.readText(sourcePath)).toBe(typedSource)
      Expect(browser.browserFailures()).toEqual([])
      // A blank or broken Studio usually reports itself only in the browser console, so the run
      // fails on any page error and keeps the evidence beside the run's other artifacts.
      await browser.captureScreenshot('simulated-user')
      const consoleErrors = browser.consoleErrors()
      await FS.writeJson(FS.resolvePath('logs/browser-console.json', artifactParent), consoleErrors)
      Expect(consoleErrors.map(entry => entry.text)).toEqual([])
    }
  } finally {
    await browser?.close()
    await native?.stop()
    studio?.stop()
    await manager?.closeAll()
    await previewSession?.close()
    preview?.stop()
    await FS.remove(projectRoot)
  }
  Expect(await FS.exists(projectRoot)).toBe(false)
}, 180_000)

function startPreviewServer(port: number): { stop(): void; url: string } {
  const server = Bun.serve({
    fetch: () => new Response(previewHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    hostname: '127.0.0.1',
    port,
  })
  return {
    stop: () => server.stop(true),
    url: `http://127.0.0.1:${port}`,
  }
}

function smokePort(name: string, fallback: number): number {
  const value = Number(Platform.runtimeProcess.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    Errors.throwUserInput(`${name} must be a valid TCP port.`)
  }
  return value
}

/**
 * Raw `Error`: the throw below lives in the `<script>` of the fake preview page this helper serves.
 * It is never bundled and has no import graph, so Tao's error taxonomy is unreachable from it.
 */
function previewHtml(): string {
  return `<!doctype html>
<html><body>
  <button id="select-first">Select First</button>
  <button id="move-third">Move Third between First and Second</button>
  <output id="state">ready</output>
  <script>
    const query = new URLSearchParams(location.search)
    const parentOrigin = query.get('taoStudioParentOrigin')
    const previewInstanceId = query.get('taoStudioPreviewInstanceId')
    const requestedSessionId = query.get('taoStudioSessionId')
    const sessionId = requestedSessionId && /^[A-Za-z0-9_-]{1,128}$/.test(requestedSessionId)
      ? requestedSessionId
      : undefined
    const studioBase = sessionId === undefined
      ? parentOrigin
      : parentOrigin + '/sessions/' + encodeURIComponent(sessionId)
    const compiledSource = ${JSON.stringify(typedSource)}
    let sourceIdentity
    window.addEventListener('message', event => {
      const message = event.data
      if (event.source !== parent
        || event.origin !== parentOrigin
        || message?.channel !== ${JSON.stringify(studioProtocolChannel)}
        || message?.protocolVersion !== ${studioProtocolVersion}
        || message.type !== 'highlight-source'
        || message.identity?.previewInstanceId !== previewInstanceId) {
        return
      }
      sourceIdentity = message.identity
      document.documentElement.dataset.studioSourceIdentity = 'ready'
    })
    const renderRange = (path, content, label) => {
      const source = 'Text("' + label + '")'
      const start = content.indexOf(source)
      if (start < 0) throw new Error('Missing render: ' + label)
      return { end: start + source.length, id: path + ':' + start + ':' + (start + source.length), start }
    }
    const context = async () => {
      if (sourceIdentity === undefined) {
        throw new Error('Studio did not publish the active source identity to the preview')
      }
      const runtime = query.get('taoStudioCell') === '1'
        ? await fetch(studioBase + '/api/preview/cell/bootstrap?previewInstanceId=' + encodeURIComponent(previewInstanceId))
          .then(response => {
            if (!response.ok) throw new Error('Preview bootstrap failed: ' + response.status)
            return response.json()
          })
        : undefined
      const path = sourceIdentity.path
      const file = { content: compiledSource, path, sourceVersion: sourceIdentity.sourceVersion }
      return {
        file,
        identity: {
          ...sourceIdentity,
          ...(runtime?.identity ?? {}),
          occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
          path,
          previewInstanceId,
          sourceVersion: file.sourceVersion,
        },
        path,
      }
    }
    document.querySelector('#select-first').addEventListener('click', async () => {
      const state = document.querySelector('#state')
      state.textContent = 'selecting'
      try {
        const current = await context()
        const firstLabel = current.file.content.includes('First typed') ? 'First typed' : 'First'
        const range = renderRange(current.path, current.file.content, firstLabel)
        parent.postMessage({
          channel: ${JSON.stringify(studioProtocolChannel)},
          identity: current.identity,
          protocolVersion: ${studioProtocolVersion},
          range: { end: range.end, start: range.start },
          type: 'preview-select-source',
        }, parentOrigin)
        state.textContent = 'selection sent'
      } catch (error) {
        state.textContent = 'selection failed: ' + (error instanceof Error ? error.message : String(error))
        throw error
      }
    })
    document.querySelector('#move-third').addEventListener('click', async () => {
      const state = document.querySelector('#state')
      state.textContent = 'moving'
      try {
        const current = await context()
        const file = current.file
        const path = current.path
        const firstLabel = file.content.includes('First typed') ? 'First typed' : 'First'
        parent.postMessage({
          action: {
            afterId: renderRange(path, file.content, firstLabel).id,
            beforeId: renderRange(path, file.content, 'Second').id,
            draggedId: renderRange(path, file.content, 'Third').id,
            kind: 'move-render',
          },
          channel: ${JSON.stringify(studioProtocolChannel)},
          checkpoint: { id: 'smoke-move', phase: 'single' },
          identity: current.identity,
          protocolVersion: ${studioProtocolVersion},
          requestId: 'smoke-move-request',
          sourceActionVersion: ${studioSourceActionVersion},
          type: 'source-action',
        }, parentOrigin)
        state.textContent = 'move sent'
      } catch (error) {
        state.textContent = 'move failed: ' + (error instanceof Error ? error.message : String(error))
        throw error
      }
    })
  </script>
</body></html>`
}

async function waitForSource(path: string, predicate: (source: string) => boolean): Promise<void> {
  const deadline = Date.now() + 20_000
  let source = ''
  while (Date.now() < deadline) {
    source = await FS.readText(path)
    if (predicate(source)) {
      return
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio source change. Last source:\n${source}`)
}

type SmokeSketchRect = Readonly<{
  content?: string
  height: number
  id: string
  kind: string
  width: number
  x: number
  y: number
}>

type SmokeSketchCatalog = Readonly<{
  revision: number
  sketches: readonly Readonly<{
    height: number
    id: string
    name: string
    rectOrder: readonly string[]
    rects: readonly SmokeSketchRect[]
    snapped: readonly Readonly<{ rect: SmokeSketchRect }>[]
    width: number
  }>[]
}>

function smokeSketchCatalog(content: string): SmokeSketchCatalog {
  return JSON.parse(content) as SmokeSketchCatalog
}

function sketchPersistenceObserved(
  before: SmokeSketchCatalog,
  after: SmokeSketchCatalog,
  generatedBefore: string,
  generatedAfter: string,
): boolean {
  const beforeSketch = before.sketches[0]
  const afterSketch = after.sketches[0]
  return beforeSketch !== undefined
    && afterSketch?.id === beforeSketch.id
    && after.revision > before.revision
    && afterSketch.rects.length === beforeSketch.rects.length + 1
    && generatedAfter === generatedBefore
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await FS.isFile(path)) {
      return
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio to write ${path}.`)
}

async function waitForSketchFile(browser: StudioCdp, path: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await FS.isFile(path)) {
      return
    }
    const error = await browser.evaluate<string>(`(() =>
      [...document.querySelectorAll('[data-tao-studio-sketch-error]')]
        .map(element => element.getAttribute('data-tao-studio-sketch-error') ?? '')
        .find(Boolean) ?? ''
    )()`)
    if (error !== '') {
      Errors.throwHostEnvironment(`Studio sketch creation failed: ${error}`)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio to write ${path} after dispatching the sketch gesture.`)
}

async function waitForSketchRect(path: string, previousRevision: number): Promise<SmokeSketchCatalog> {
  const deadline = Date.now() + 20_000
  let catalog: SmokeSketchCatalog | undefined
  while (Date.now() < deadline) {
    catalog = smokeSketchCatalog(await FS.readText(path))
    if (catalog.revision > previousRevision && catalog.sketches[0]?.rects.length === 1) {
      return catalog
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for a persisted Studio rectangle; last=${JSON.stringify(catalog)}`)
}

async function waitForSketchCatalog(
  path: string,
  predicate: (catalog: SmokeSketchCatalog) => boolean,
): Promise<SmokeSketchCatalog> {
  const deadline = Date.now() + 30_000
  let catalog: SmokeSketchCatalog | undefined
  while (Date.now() < deadline) {
    catalog = smokeSketchCatalog(await FS.readText(path))
    if (predicate(catalog)) {
      return catalog
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(
    `Timed out waiting for a Studio sketch catalog transition; last=${JSON.stringify(catalog)}`,
  )
}

async function drawSketchRectangle(
  browser: StudioCdp,
  sketchId: string,
  rectangle: Readonly<{ height: number; width: number; x: number; y: number }>,
): Promise<void> {
  await browser.evaluate(`(() => {
    const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    if (!(board instanceof HTMLElement)) throw new Error('Missing Studio sketch board')
    const bounds = board.getBoundingClientRect()
    const pointerId = 71
    const event = (type, x, y) => new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: bounds.left + x,
      clientY: bounds.top + y,
      isPrimary: true,
      pointerId,
    })
    const capture = board.setPointerCapture
    const release = board.releasePointerCapture
    board.setPointerCapture = () => {}
    board.releasePointerCapture = () => {}
    try {
      board.dispatchEvent(event('pointerdown', ${rectangle.x}, ${rectangle.y}))
      board.dispatchEvent(event('pointermove', ${rectangle.x + rectangle.width}, ${rectangle.y + rectangle.height}))
      board.dispatchEvent(event('pointerup', ${rectangle.x + rectangle.width}, ${rectangle.y + rectangle.height}))
    } finally {
      board.setPointerCapture = capture
      board.releasePointerCapture = release
    }
  })()`)
}

async function shiftSelectSketchRectangle(browser: StudioCdp, sketchId: string, rectId: string): Promise<void> {
  await browser.evaluate(`(() => {
    const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    const rect = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-rect="${rectId}"]`)})
    if (!(board instanceof HTMLElement) || !(rect instanceof HTMLElement)) {
      throw new Error('Missing Studio sketch selection target')
    }
    const bounds = rect.getBoundingClientRect()
    rect.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
      isPrimary: true,
      pointerId: 72,
      shiftKey: true,
    }))
  })()`)
}

async function clickProposalButton(browser: StudioCdp, sketchId: string, label: 'Apply' | 'Cancel'): Promise<void> {
  await browser.evaluate(`(() => {
    const proposal = document.querySelector(${
    JSON.stringify(
      `[data-tao-studio-sketch-snap-proposal="${sketchId}"]`,
    )
  })
    const button = proposal instanceof HTMLElement
      ? [...proposal.querySelectorAll('button')].find(candidate => candidate.textContent === ${JSON.stringify(label)})
      : undefined
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing Studio Snap proposal ${label} button')
    button.click()
  })()`)
}

function studioRectTag(rectId: string): string {
  let encoded = ''
  for (let index = 0; index < rectId.length; index += 1) {
    encoded += rectId.charCodeAt(index).toString(16).padStart(4, '0')
  }
  return `#studio_rect_${encoded}`
}

async function waitForSourceOrStudioError(
  browser: StudioCdp,
  path: string,
  predicate: (source: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + 20_000
  let source = ''
  let status: Readonly<{ state: string; text: string }> = { state: '', text: '' }
  while (Date.now() < deadline) {
    source = await FS.readText(path)
    if (predicate(source)) {
      return
    }
    status = await browser.evaluate<Readonly<{ state: string; text: string }>>(`(() => {
      const element = document.querySelector('.studio-status')
      return { state: element?.getAttribute('data-state') ?? '', text: element?.textContent ?? '' }
    })()`)
    if (status.state === 'error') {
      Errors.throwHostEnvironment(`Studio preview drop failed: ${status.text}`)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(
    `Timed out waiting for Studio source change. Last status=${JSON.stringify(status)}; last source:\n${source}`,
  )
}

async function waitForCompileAfter(browser: StudioCdp, previousRevision: number): Promise<number> {
  const deadline = Date.now() + 30_000
  let last = ''
  while (Date.now() < deadline) {
    last = await browser.evaluate<string>("document.querySelector('.studio-status')?.textContent ?? ''")
    const state = await browser.evaluate<string>(
      "document.querySelector('.studio-status')?.getAttribute('data-state') ?? ''",
    )
    const revision = /^compiled (\d+) · applied \d+ —/.exec(last)?.[1]
    if (state === 'compiled' && revision !== undefined && Number(revision) > previousRevision) {
      return Number(revision)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(
    `Timed out waiting for Studio compile revision after ${previousRevision}; last status=${JSON.stringify(last)}`,
  )
}

async function clickPreviewAndWaitForState(
  browser: StudioCdp,
  previewUrl: string,
  selector: '#move-third' | '#select-first',
  expected: 'move sent' | 'selection sent',
): Promise<void> {
  const deadline = Date.now() + 15_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      await browser.clickInFrame(previewUrl, selector)
      const attemptDeadline = Math.min(deadline, Date.now() + 1_000)
      while (Date.now() < attemptDeadline) {
        last = await browser.evaluateInFrame<string>(
          previewUrl,
          "document.querySelector('#state')?.textContent ?? ''",
        )
        if (last === expected) {
          return
        }
        await Time.sleep(100)
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
  }
  Errors.throwHostEnvironment(
    `Timed out waiting for Studio smoke preview state ${JSON.stringify(expected)}; last=${JSON.stringify(last)}`,
  )
}

async function clickPreviewUntilSource(
  browser: StudioCdp,
  previewUrl: string,
  selector: '#move-third',
  sourcePath: string,
  predicate: (source: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastSource = ''
  let lastStatus = ''
  while (Date.now() < deadline) {
    try {
      await browser.clickInFrame(previewUrl, selector)
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    const attemptDeadline = Math.min(deadline, Date.now() + 5_000)
    while (Date.now() < attemptDeadline) {
      lastSource = await FS.readText(sourcePath)
      if (predicate(lastSource)) {
        return
      }
      const status = await browser.evaluate<Readonly<{ state: string; text: string }>>(`(() => {
        const element = document.querySelector('.studio-status')
        return { state: element?.getAttribute('data-state') ?? '', text: element?.textContent ?? '' }
      })()`)
      lastStatus = status.text
      if (status.state === 'error') {
        Errors.throwHostEnvironment(`Studio preview interaction failed: ${status.text}`)
      }
      await Time.sleep(100)
    }
  }
  Errors.throwHostEnvironment(
    `Timed out applying the Studio preview interaction; last status=${JSON.stringify(lastStatus)}; `
      + `last source:\n${lastSource}`,
  )
}

async function waitForPreviewSourceIdentity(browser: StudioCdp, previewUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = await browser.evaluateInFrame<string>(
        previewUrl,
        "document.documentElement.dataset.studioSourceIdentity ?? ''",
      )
      if (last === 'ready') {
        return
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio to publish source identity to the preview; last=${last}`)
}

async function waitForInspectorReady(browser: StudioCdp): Promise<void> {
  const deadline = Date.now() + 15_000
  let last:
    | Readonly<{
      ready: boolean
      status: string
      summary: string
    }>
    | undefined
  while (Date.now() < deadline) {
    const snapshot = await browser.evaluate<
      Readonly<{
        ready: boolean
        status: string
        summary: string
      }>
    >(`(() => {
      const summary = document.querySelector('.studio-inspector-summary')?.textContent ?? ''
      return {
        ready: summary.includes('Element: Text'),
        status: document.querySelector('.studio-status')?.textContent ?? '',
        summary,
      }
    })()`)
    last = snapshot
    if (snapshot.ready) {
      return
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(
    `Timed out waiting for the Studio inspector to become editable; last=${JSON.stringify(last)}`,
  )
}

function ordered(source: string, labels: readonly string[]): boolean {
  const offsets = labels.map(label => source.indexOf(`Text("${label}")`))
  return offsets.every(offset => offset >= 0)
    && offsets.every((offset, index) => index === 0 || offsets[index - 1]! < offset)
}
