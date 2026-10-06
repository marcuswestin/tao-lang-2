import { Errors, FS, HCI, Platform, Repo, Time, VerificationTimeouts } from '@shared'
import { Expect, runCleanups, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  startStudioSessionServer,
  StudioCanvasViewportStore,
  studioProtocolChannel,
  studioProtocolVersion,
  StudioSessionManager,
  studioSourceActionVersion,
} from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { StudioNativeTestRun } from '../studio-tooling-src/StudioNativeTestRun'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'
import { exerciseStudioFeed } from './studio-feed-journey'

const scrollingTail = Array.from({ length: 80 }, (_, index) => `// scroll proof ${index + 1}`).join('\n')

const initialSource = `use Stack, Text from @tao/ui
app Smoke { id "smoke" version "1.0.0" name "Smoke" view MainView }
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
${scrollingTail}
`

const typedSource = initialSource.replace('Text("First")', 'Text("First typed")')

// REMOVAL CANDIDATE: Static fixture-origin fence; dropping it permits a simulated preview to bypass the message boundary the journey claims to prove.
Test('simulated preview stays within the preview-origin API boundary', () => {
  const html = previewHtml()
  Expect(html).toContain("message.type === 'highlight-source'")
  Expect(html).toContain("message.type === 'set-canvas-gestures'")
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

// The full editor/preview journey in the `verify-full` graph. The unattended native capability probe
// belongs to `studio-canary`, which launches real native Studio and also proves its shutdown.
Test('simulated user exercises the browser editor', async () => {
  const artifactParent = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? Repo.resolvePath('.artifacts/studio-smoke')
  const { root: artifactRoot } = await StudioNativeTestRun.create(artifactParent)
  let browser: StudioCdp | undefined
  let preview: ReturnType<typeof startPreviewServer> | undefined
  let previewRuntimeRoot: string | undefined
  let previewSession: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let projectRoot: string | undefined
  let studio: Awaited<ReturnType<typeof startStudioSessionServer>> | undefined
  let manager: StudioSessionManager | undefined
  let primaryFailure: unknown
  const pendingShutdown = new Set<string>()
  const directoryStates = new Map<string, 'owned' | 'retained' | 'removed'>()
  const writeDirectoryLedger = async () => {
    await FS.writeJson(FS.resolvePath('external-directories.json', artifactRoot), {
      directories: [...directoryStates].map(([path, state]) => ({
        cleanupCondition: 'Remove only after every resource owned by this invocation has confirmed shutdown.',
        owner: artifactRoot,
        path,
        purpose: path === projectRoot ? 'Disposable simulated-user source project.' : 'Disposable preview runtime.',
        state,
      })),
      pendingShutdown: [...pendingShutdown],
      version: 1,
    })
  }
  const stopResource = async (label: string, run: () => unknown | Promise<unknown>) => {
    await run()
    pendingShutdown.delete(label)
  }
  const removeDirectory = async (path: string | undefined) => {
    if (path === undefined) {
      return
    }
    if (pendingShutdown.size > 0) {
      directoryStates.set(path, 'retained')
      await writeDirectoryLedger()
      HCI.logProcessWarn(
        'studio-smoke-cleanup',
        `Retained ${path}; shutdown is unproved for: ${[...pendingShutdown].join(', ')}.`,
      )
      return
    }
    await FS.remove(path)
    directoryStates.set(path, 'removed')
    await writeDirectoryLedger()
  }
  try {
    // Explicit scratch projects remain discoverable. Caller-owned scratch has no automatic test/exit
    // removal, so uncertain shutdown can retain this project with its existing ownership receipt.
    projectRoot = await Repo.mkScratchDir('tao-studio-simulated-user-')
    directoryStates.set(projectRoot, 'owned')
    await writeDirectoryLedger()
    const canonicalProjectRoot = await FS.realPath(projectRoot)
    if (canonicalProjectRoot !== projectRoot) {
      directoryStates.delete(projectRoot)
      projectRoot = canonicalProjectRoot
      directoryStates.set(projectRoot, 'owned')
      await writeDirectoryLedger()
    }
    // Generated runtime state is disposable; durable screenshots and browser logs use artifactRoot.
    previewRuntimeRoot = await Repo.mkScratchDir('tao-studio-simulated-runtime-')
    directoryStates.set(previewRuntimeRoot, 'owned')
    await writeDirectoryLedger()
    const sourcePath = FS.resolvePath('Smoke.tao', projectRoot)
    await FS.writeText(sourcePath, initialSource)
    await FS.mkdir(FS.resolvePath('.tao', projectRoot))
    preview = startPreviewServer(smokePort('TAO_STUDIO_SMOKE_PREVIEW_PORT', 42_001))
    pendingShutdown.add('preview server')
    // The scenario canvas and inspector only exist once a preview manifest is published, and only
    // the real compile lane publishes one. A stubbed compile leaves `previewManifest()` undefined,
    // so `scenarioRows()` returns nothing and no scenario UI can render.
    pendingShutdown.add('preview session')
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
    pendingShutdown.add('Studio sessions')
    const current = manager.add({ previewUrl: preview.url, session })
    pendingShutdown.add('Studio server')
    studio = await startStudioSessionServer(manager, {
      canvasViewportStore: new StudioCanvasViewportStore(FS.resolvePath('legacy-viewports', artifactRoot)),
      hostname: '127.0.0.1',
      port: smokePort('TAO_STUDIO_SMOKE_SERVER_PORT', 42_000),
    })
    const projectUrl = `${studio.url}/sessions/${encodeURIComponent(current.sessionId)}`
    pendingShutdown.add('browser')
    browser = await StudioCdp.launchChrome({ artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(projectUrl)
    await activateSmokePreviews(browser)
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
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
    // Expanded, the agent panel floats over the inspector and the lower half of every divider.
    // Studio opens it minimized; the journey confirms that before reaching for the workbench.
    await browser.waitFor(
      `document.querySelector('.studio-agent-panel [data-tao-studio-agent-collapse], .studio-agent-collapse')
        instanceof HTMLButtonElement`,
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
    if (
      await browser.evaluate<boolean>(
        `document.querySelector('.studio-agent-panel')?.getAttribute('data-minimized') !== 'true'`,
      )
    ) {
      await browser.click('.studio-agent-collapse')
    }
    await browser.waitFor(
      `document.querySelector('.studio-agent-panel')?.getAttribute('data-minimized') === 'true'`,
    )
    await browser.waitFor("document.querySelector('.cm-content')?.textContent.includes('Text(\"First\")')", {
      timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity,
    })
    Expect(
      await browser.evaluate<number>(
        "document.querySelectorAll('.studio-editor .cm-editor').length",
      ),
    ).toBe(1)
    await browser.waitFor(
      `document.querySelector('.studio-preview-group-label')?.textContent === 'states'`,
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
    await browser.waitFor(
      `document.querySelector('[data-studio-tao-scenario="true"] .studio-scenario-inspector-label')?.textContent === 'default'`,
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
    await browser.captureScreenshot('studio-wide-desktop')
    await browser.setViewport(1_024, 768)
    await browser.waitFor(
      "document.querySelector('.studio-shell')?.getBoundingClientRect().width === window.innerWidth",
    )
    await browser.captureScreenshot('studio-narrow-desktop')
    await browser.setViewport(1_440, 900)

    await browser.click('[data-preset="design"]')
    await browser.waitFor(`document.querySelector('.studio-pane-left')?.hasAttribute('hidden') === true`)
    await browser.waitFor(`document.querySelector('[data-tao-studio-canvas-zoom]')?.textContent === '100%'`)
    await browser.waitForInFrame(
      preview.url,
      `document.documentElement.dataset.studioCanvasGestures === 'owned'`,
    )
    await browser.wheel('.studio-preview-cell iframe', { x: 0, y: -180 }, { primary: true })
    await browser.waitFor(`document.querySelector('[data-tao-studio-canvas-zoom]')?.textContent !== '100%'`)
    Expect(
      await browser.evaluate<string>(
        "document.querySelector('.studio-preview > .studio-preview-grid')?.style.transform ?? ''",
      ),
    ).not.toBe('')
    const transformedFrame = await browser.evaluate<{ height: number; width: number }>(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      if (!(frame instanceof HTMLIFrameElement)) throw new Error('Missing transformed preview frame')
      const rect = frame.getBoundingClientRect()
      return { height: rect.height, width: rect.width }
    })()`)
    await browser.clickAtOffset('.studio-preview-cell .studio-preview-focus-shield', {
      x: transformedFrame.width * 0.72,
      y: transformedFrame.height * 0.62,
    })
    await browser.waitFor(`document.querySelector('.studio-preview-cell')?.dataset.previewInteractive === 'true'`)
    await browser.clickAtOffset('.studio-preview-cell iframe', {
      x: transformedFrame.width * 0.72,
      y: transformedFrame.height * 0.62,
    })
    await browser.waitForInFrame(
      preview.url,
      `document.querySelector('#state')?.textContent === 'zoom hit 1 / background 0'`,
    )
    await browser.click('[data-tao-studio-canvas-zoom]')
    await browser.click('[data-tao-studio-canvas-zoom-action="1"]')
    await browser.waitFor(`document.querySelector('[data-tao-studio-canvas-zoom]')?.textContent === '100%'`)

    await browser.click('.studio-rail-button[data-panel="files"]')
    await browser.waitFor(`document.querySelector('.studio-pane-left')?.hasAttribute('hidden') === false`)
    await browser.waitFor(`document.querySelector('[data-studio-panel="files"]')?.hasAttribute('hidden') === false`)
    const designPreviewWide = await browser.evaluate<number>(
      "Number(document.querySelector('[data-divider=\"preview\"]')?.getAttribute('aria-valuenow'))",
    )
    Expect(Number.isFinite(designPreviewWide)).toBe(true)
    await browser.setViewport(1_024, 768)
    await browser.waitFor(
      `Number(document.querySelector('[data-divider="preview"]')?.getAttribute('aria-valuenow')) !== ${designPreviewWide}`,
    )
    const designPreviewNarrow = await browser.evaluate<number>(
      "Number(document.querySelector('[data-divider=\"preview\"]')?.getAttribute('aria-valuenow'))",
    )
    Expect(Number.isFinite(designPreviewNarrow)).toBe(true)
    await browser.setViewport(1_440, 900)
    await browser.waitFor(
      `Number(document.querySelector('[data-divider="preview"]')?.getAttribute('aria-valuenow')) !== ${designPreviewNarrow}`,
    )
    Expect(
      await browser.evaluate<number>(
        "Number(document.querySelector('[data-divider=\"preview\"]')?.getAttribute('aria-valuenow'))",
      ),
    ).toBe(designPreviewWide)
    // Both dividers are dragged in the workbench layout, which is the only one that mounts them:
    // the Run preset hands the whole window to the preview. A divider runs the full height of the
    // body and the floating agent panel covers its lower half, so each is grabbed near its top,
    // where it is exposed and where a person reaching for it would take hold.
    const dividerGrip = { x: 2, y: 24 }
    // Design gives the canvas all the width the editor's floor leaves, so a drag can only narrow it.
    // The preview is the right-hand pane, so moving its left divider right decreases its width.
    const initialPreview = await dividerSize(browser, 'preview')
    await browser.dragBy('[data-divider="preview"]', { x: 40, y: 0 }, { offset: dividerGrip })
    await browser.waitFor(
      `Number(document.querySelector('[data-divider="preview"]')?.getAttribute('aria-valuenow')) === ${
        initialPreview - 40
      }`,
    )
    const initialLeft = await dividerSize(browser, 'left')
    await browser.dragBy('[data-divider="left"]', { x: 48, y: 0 }, { offset: dividerGrip })
    await browser.waitFor(
      `Number(document.querySelector('[data-divider="left"]')?.getAttribute('aria-valuenow')) === ${initialLeft + 48}`,
    )
    await browser.captureScreenshot('studio-resized-workbench')

    await browser.click('[data-preset="run"]')
    await browser.waitFor(
      `document.querySelector('.tao-studio-product-host')?.getAttribute('data-layout-preset') === 'run'`,
    )
    // Run leaves nothing but the preview, so the rest of the journey — editing, the lens, the
    // canvas — needs the workbench back.
    await browser.click('[data-preset="design"]')
    await browser.waitFor(
      `document.querySelector('.tao-studio-product-host')?.getAttribute('data-layout-preset') === 'design'`,
    )

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

    // An edit typed back out leaves nothing unsaved: the tab drops its dot, so it can close again.
    const activeTabLabel =
      `document.querySelector('.studio-editor-tab-item[aria-current="page"] .studio-editor-tab')?.textContent ?? ''`
    await browser.insertText('x')
    await browser.waitFor(`(${activeTabLabel}).startsWith('● ')`)
    await browser.pressKey('Backspace')
    await browser.waitFor(`!(${activeTabLabel}).startsWith('● ')`)
    Expect(await browser.evaluate<string>(`document.querySelector('.studio-status')?.textContent ?? ''`))
      .toBe('No unsaved changes.')
    Expect(await FS.readText(sourcePath)).toBe(typedSource)

    // The outline lens folds every declaration to its head. Both ways of reaching hidden syntax
    // reveal the one region involved and leave every other fold alone, and neither changes the
    // file: an edit beside a folded region is cancelled in favour of showing it, and a caret that
    // lands on its edge opens it rather than sitting in text the person cannot see.
    const revealedHead = 'app Smoke { id "smoke" version "1.0.0" name "Smoke" view MainView }'
    await browser.click('[data-testid="studio-lens-preset-outline"]')
    await browser.waitFor(`document.querySelector('.cm-line:has(.cm-lens-glyph)') instanceof HTMLElement`)
    const outlineFolds = await foldedRegions(browser)
    Expect(outlineFolds).toBeGreaterThan(1)
    await browser.click('.cm-line:has(.cm-lens-glyph)')
    await browser.pressKey('End')
    await browser.pressKey('Backspace')
    await browser.waitFor(`document.querySelectorAll('.cm-lens-glyph').length === ${outlineFolds - 1}`)
    Expect(await browser.evaluate<string>("document.querySelector('.cm-content')?.textContent ?? ''"))
      .toContain(revealedHead)
    await browser.pressShortcut('s')
    await browser.waitFor(`document.querySelector('.studio-status')?.textContent === 'No unsaved changes.'`)
    Expect(await FS.readText(sourcePath)).toBe(typedSource)
    await browser.click('[data-testid="studio-lens-refold"]')
    await browser.waitFor(`document.querySelectorAll('.cm-lens-glyph').length === ${outlineFolds}`)
    await browser.click('.cm-line:has(.cm-lens-glyph)')
    await browser.pressKey('End')
    await browser.pressKey('ArrowLeft')
    await browser.waitFor(`document.querySelectorAll('.cm-lens-glyph').length === ${outlineFolds - 1}`)
    Expect(await browser.evaluate<string>("document.querySelector('.cm-content')?.textContent ?? ''"))
      .toContain(revealedHead)
    await browser.waitFor(`document.querySelector('.studio-status')?.textContent === 'No unsaved changes.'`)
    Expect(await FS.readText(sourcePath)).toBe(typedSource)
    // Back to the whole file: the steps after this one read and edit source the outline hides.
    await browser.click('[data-testid="studio-lens-preset-all"]')
    await browser.waitFor("document.querySelector('.cm-lens-glyph') === null")

    const selectedText = 'Text("First typed")'
    const currentFile = await session.readFile('Smoke.tao')
    const selectedStart = currentFile.content.indexOf(selectedText)
    const selectedRenderId = FS.resolvePath(currentFile.path, projectRoot)
      + ':' + selectedStart + ':' + (selectedStart + selectedText.length)
    const selectedInspection = await session.inspectRender({
      path: currentFile.path,
      renderId: selectedRenderId,
      sourceVersion: currentFile.sourceVersion,
    })
    if (selectedInspection.owner === undefined) {
      Errors.throwUnexpected('The smoke selection must have an owning view render.')
    }
    // The preview republishes after the save above. Install the identity only once it has settled,
    // or the reload that follows drops the global the measurement reads.
    await waitForPreviewSourceIdentity(browser, preview.url)
    // The preview's own handler reads this global, so it has to be written in the page's world
    // rather than the isolated one every other probe uses.
    await browser.evaluateInFrame(
      preview.url,
      `window.taoSmokeOwnerRenderId = ${JSON.stringify(selectedInspection.owner.renderId)}`,
      { world: 'page' },
    )
    await clickPreviewAndWaitForState(browser, preview.url, '#measure-owner', 'measurement sent')
    const measuredIdentity = await browser.evaluateInFrame<Record<string, unknown>>(
      preview.url,
      `window.taoSmokeMeasuredIdentity`,
      { world: 'page' },
    )
    const measured = await Time.pollUntil(async () => {
      const inspection = await session.inspectRender({
        identity: measuredIdentity as never,
        path: currentFile.path,
        renderId: selectedRenderId,
        sourceVersion: currentFile.sourceVersion,
      })
      return inspection.owner?.rect?.width === 241.2 && inspection.owner.rect.height === 121.6
    }, { intervalMs: 50, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
    Expect(measured).toBe(true)

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
    await browser.waitFor(`document.querySelector('.studio-canvas-focus')?.textContent === 'Focus MainView'`)

    await browser.wheel('.cm-scroller', { x: 0, y: 8_000 })
    await browser.waitFor(`(document.querySelector('.cm-scroller')?.scrollTop ?? 0) > 0`)
    const away = await browser.evaluate<number>("document.querySelector('.cm-scroller')?.scrollTop ?? 0")
    await clickPreviewAndWaitForState(browser, preview.url, '#select-first', 'selection sent')
    await browser.waitFor(
      `(document.querySelector('.cm-scroller')?.scrollTop ?? 0) < ${away}`,
    )

    // Focus frames the group's cells at the measured size of the selected element's view. The
    // measurement reaches the client with the preview's inspection, so leaving and re-entering is
    // what a person does when the frame has not arrived yet.
    await focusCanvasUntilFramed(browser)
    await browser.click('[data-tao-studio-canvas-back="true"]')
    await browser.waitFor(`document.querySelector('[data-tao-studio-canvas-back="true"]') === null`)
    await browser.waitFor(
      `(() => {
      const viewport = document.querySelector('.studio-preview-cell-viewport')
      return viewport instanceof HTMLElement
        && viewport.getBoundingClientRect().width === 390
        && viewport.getBoundingClientRect().height === 844
    })()`,
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
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
    const sketchCatalogPath = FS.resolvePath('.tao/store/studio/sketches.jsonc', projectRoot)
    // A 360-pixel board needs a canvas column wider than the Design preset leaves at 1440; a
    // designer's display gives the sketch room, and the pointer gesture below is checked against it.
    await browser.setViewport(1_920, 1_080)
    await browser.waitFor(
      "document.querySelector('.studio-shell')?.getBoundingClientRect().width === window.innerWidth",
    )
    await enterDrawPreset(browser)
    await browser.waitFor(
      `document.querySelector('[data-tao-studio-sketch-workspace]') instanceof HTMLElement`,
    )
    // V is the Draw canvas's resting tool; R draws the frame, then a rectangle inside it.
    await browser.click(rectangleTool)
    await browser.dragBy('[data-tao-studio-sketch-workspace]', { x: 360, y: 76 }, { steps: 12 })
    await waitForSketchFile(browser, generatedSketchPath)
    await waitForFile(sketchCatalogPath)
    await waitForSketchReady(browser)
    const generatedBeforeRect = await FS.readText(generatedSketchPath)
    const catalogBeforeRect = await FS.readText(sketchCatalogPath)
    const createdCatalog = smokeSketchCatalog(catalogBeforeRect)
    Expect(createdCatalog.sketches).toHaveLength(1)
    Expect(createdCatalog.sketches[0]).toMatchObject({ height: 76, name: 'View1', rects: [], width: 360 })
    const createdSketchId = createdCatalog.sketches[0]!.id

    // The first draw is a real pointer gesture through Chrome. Mark the board first so a timeout
    // can say whether the pointer never reached it or a re-render replaced it mid-gesture.
    const drawingBrowser = browser
    const boardGenerationBeforeDraw = await markSketchBoard(drawingBrowser, createdSketchId)
    const firstDraw = { x: 64, y: 24 }
    // Draw the free rectangle against the board's right edge. An incremental Snap can only fold a
    // new rectangle into an existing flow from one end of it, so a rectangle drawn in the middle
    // of the board would leave the two groups interleaved and Snap would rightly refuse.
    const firstDrawOrigin = { x: 288, y: 40 }
    await expectPointerReachesBoard(
      drawingBrowser,
      createdSketchId,
      boardGenerationBeforeDraw,
      firstDraw,
      firstDrawOrigin,
    )
    await drawingBrowser.click(rectangleTool)
    await drawingBrowser.dragBy(`[data-tao-studio-sketch="${createdSketchId}"]`, firstDraw, {
      offset: firstDrawOrigin,
      steps: 8,
    })
    const persistedCatalog = await waitForSketchRect(
      sketchCatalogPath,
      createdCatalog.revision,
      async () => {
        await drawingBrowser.captureScreenshot('studio-sketch-draw-failure')
        return await sketchBoardDiagnostics(drawingBrowser, createdSketchId, boardGenerationBeforeDraw)
      },
    )
    await waitForSketchBoardRefresh(browser, createdSketchId, boardGenerationBeforeDraw)
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
    await enterDrawPreset(browser)
    await browser.waitFor(
      `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${persistedSketch.id}"]`)})
        ?.querySelector(${
        JSON.stringify(`[data-tao-studio-sketch-rect="${persistedRect.id}"]`)
      }) instanceof HTMLElement`,
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
    const reloadedRect = await browser.evaluate<{ height: number; width: number }>(`(() => {
      const element = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-rect="${persistedRect.id}"]`)})
      if (!(element instanceof HTMLElement)) return { height: 0, width: 0 }
      const bounds = element.getBoundingClientRect()
      return { height: bounds.height, width: bounds.width }
    })()`)
    Expect(reloadedRect).toEqual({ height: 24, width: 64 })

    // Preserve the original free rectangle, then build the clean playlist-row projection beside it.
    // Left of the free rectangle, so the projection's children run existing-then-new in one step.
    const playlistRects = [
      { height: 52, width: 52, x: 12, y: 8 },
      { height: 20, width: 100, x: 76, y: 8 },
      { height: 20, width: 100, x: 76, y: 40 },
      { height: 20, width: 36, x: 188, y: 28 },
    ] as const
    let drawCatalog = persistedCatalog
    const playlistRectIds: string[] = []
    for (const rectangle of playlistRects) {
      const boardGeneration = await drawSketchRectangle(browser, persistedSketch.id, rectangle)
      drawCatalog = await waitForSketchCatalog(
        sketchCatalogPath,
        catalog =>
          catalog.revision > drawCatalog.revision && catalog.sketches[0]?.rects.length === playlistRectIds.length + 2,
      )
      await waitForSketchBoardRefresh(browser, persistedSketch.id, boardGeneration)
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
    const snappedCatalog = await clickSketchWhenSettled(
      browser,
      persistedSketch.id,
      `[data-tao-studio-sketch-snap="${persistedSketch.id}"]`,
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
    await enterDrawPreset(browser)
    await browser.waitFor(
      `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)})
        instanceof HTMLButtonElement
        && document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`)})
          ?.disabled === false`,
      { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
    )
    const reloadedSnapCatalog = smokeSketchCatalog(await FS.readText(sketchCatalogPath))
    Expect(reloadedSnapCatalog.sketches[0]?.snapped.map(item => item.rect.id)).toEqual(playlistRectIds)
    Expect(await FS.readText(generatedSketchPath)).toBe(snappedSource)

    // Snap the one remaining free rectangle into the existing flow, then undo that incremental Snap.
    await browser.click(`[data-tao-studio-sketch-rect="${persistedRect.id}"]`)
    await browser.waitFor(
      `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)})
        instanceof HTMLButtonElement
        && document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap="${persistedSketch.id}"]`)})
          ?.disabled === false`,
    )
    const incrementalSnapBrowser = browser
    const incrementalSnapGeneration = await markSketchBoard(incrementalSnapBrowser, persistedSketch.id)
    const incrementallySnappedCatalog = await clickSketchWhenSettled(
      browser,
      persistedSketch.id,
      `[data-tao-studio-sketch-snap="${persistedSketch.id}"]`,
      sketchCatalogPath,
      catalog =>
        catalog.revision > reloadedSnapCatalog.revision
        && catalog.sketches[0]?.rects.length === 0
        && catalog.sketches[0]?.snapped.length === 5,
      {
        diagnose: async () => {
          await incrementalSnapBrowser.captureScreenshot('studio-sketch-incremental-snap-failure')
          return await sketchBoardDiagnostics(incrementalSnapBrowser, persistedSketch.id, incrementalSnapGeneration)
        },
      },
    )
    Expect(await FS.readText(generatedSketchPath)).toContain(studioRectTag(persistedRect.id))
    await browser.waitFor(
      `document.querySelector(${JSON.stringify(`[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`)})
        ?.disabled === false`,
    )
    const incrementalUndoCatalog = await clickSketchWhenSettled(
      browser,
      persistedSketch.id,
      `[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`,
      sketchCatalogPath,
      catalog =>
        catalog.revision > incrementallySnappedCatalog.revision
        && catalog.sketches[0]?.rects.map(rect => rect.id).join(',') === persistedRect.id
        && catalog.sketches[0]?.snapped.length === 4,
    )
    Expect(incrementalUndoCatalog.sketches[0]?.rectOrder).toEqual(reloadedSnapCatalog.sketches[0]?.rectOrder)
    Expect(await FS.readText(generatedSketchPath)).toBe(snappedSource)

    // Unsnap one rectangle rather than the whole tree, which is what the same button does when
    // nothing is selected. The selection is therefore made inside the settled moment that presses
    // the button, never before it: an authoritative render replaces the board and its selector,
    // and a selection made across one is silently an instruction to unsnap everything.
    const retained = incrementalUndoCatalog.sketches[0]!.snapped[0]!.rect
    const selectRetained = `(() => {
      const select = document.querySelector(${
      JSON.stringify(
        `[data-tao-studio-sketch-snap-controls="${persistedSketch.id}"] select[aria-label="Snapped rectangles"]`,
      )
    })
      if (!(select instanceof HTMLSelectElement)) return false
      const option = [...select.options].find(candidate => candidate.value === ${JSON.stringify(retained.id)})
      if (!(option instanceof HTMLOptionElement)) return false
      for (const candidate of select.options) candidate.selected = candidate === option
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return [...select.selectedOptions].map(entry => entry.value).join(',') === ${JSON.stringify(retained.id)}
    })()`
    const unsnappedCatalog = await clickSketchWhenSettled(
      browser,
      persistedSketch.id,
      `[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`,
      sketchCatalogPath,
      catalog =>
        catalog.revision > incrementalUndoCatalog.revision
        && catalog.sketches[0]?.rects.some(rect => rect.id === retained.id) === true
        && catalog.sketches[0]?.snapped.length === 3,
      { prepare: selectRetained },
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
    const fullyUnsnappedCatalog = await clickSketchWhenSettled(
      browser,
      persistedSketch.id,
      `[data-tao-studio-sketch-unsnap="${persistedSketch.id}"]`,
      sketchCatalogPath,
      // The catalog's revision does not advance on every write (see the revision race recorded in
      // the remediation roadmap), so this waits on the state itself. Nothing but this press can
      // produce it: the step above leaves three rectangles snapped.
      catalog => catalog.sketches[0]?.rects.length === 5 && catalog.sketches[0]?.snapped.length === 0,
    )
    Expect(await FS.readText(generatedSketchPath)).toContain(`Placeholder("View1")`)

    const firstOverlap = { height: 30, width: 40, x: 200, y: 4 }
    const firstOverlapGeneration = await drawSketchRectangle(browser, persistedSketch.id, firstOverlap)
    const overlapOne = await waitForSketchCatalog(
      sketchCatalogPath,
      catalog => catalog.revision > fullyUnsnappedCatalog.revision && catalog.sketches[0]?.rects.length === 6,
    )
    await waitForSketchBoardRefresh(browser, persistedSketch.id, firstOverlapGeneration)
    const firstOverlapId = overlapOne.sketches[0]!.rects.at(-1)!.id
    const secondOverlapGeneration = await drawSketchRectangle(
      browser,
      persistedSketch.id,
      { height: 20, width: -30, x: 250, y: 14 },
    )
    const overlapTwo = await waitForSketchCatalog(
      sketchCatalogPath,
      catalog => catalog.revision > overlapOne.revision && catalog.sketches[0]?.rects.length === 7,
    )
    await waitForSketchBoardRefresh(browser, persistedSketch.id, secondOverlapGeneration)
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
    const undoneCatalog = await clickSketchWhenSettled(
      browser,
      persistedSketch.id,
      `[data-tao-studio-sketch-snap-undo="${persistedSketch.id}"]`,
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
    await exerciseStudioFeed(
      browser,
      session,
      projectRoot,
      persistedSketch.id,
      persistedRect.id,
      playlistRectIds.at(-1)!,
    )
    Expect(browser.browserFailures()).toEqual([])
    // A blank or broken Studio usually reports itself only in the browser console, so the run
    // fails on any page error and keeps the evidence beside the run's other artifacts.
    await browser.captureScreenshot('simulated-user')
    const consoleErrors = browser.consoleErrors()
    await FS.writeJson(FS.resolvePath('logs/browser-console.json', artifactRoot), consoleErrors)
    Expect(consoleErrors.map(entry => entry.text)).toEqual([])
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    await runCleanups(primaryFailure, [
      {
        label: 'close browser',
        run: () => browser === undefined ? undefined : stopResource('browser', () => browser!.close()),
      },
      {
        label: 'stop Studio server',
        run: () => studio === undefined ? undefined : stopResource('Studio server', () => studio!.stop()),
      },
      {
        label: 'close Studio sessions',
        run: () => manager === undefined ? undefined : stopResource('Studio sessions', () => manager!.closeAll()),
      },
      {
        label: 'close preview session',
        run: () =>
          previewSession === undefined
            ? undefined
            : stopResource('preview session', () => previewSession!.close()),
      },
      {
        label: 'stop preview server',
        run: () => preview === undefined ? undefined : stopResource('preview server', () => preview!.stop()),
      },
      { label: 'remove project root', run: () => removeDirectory(projectRoot) },
      {
        label: 'remove preview runtime',
        run: () => removeDirectory(previewRuntimeRoot),
      },
    ], { channel: 'studio-smoke-cleanup', subject: 'Studio smoke' })
  }
}, 600_000)

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
<html><head><style>
  html, body { height: 100%; margin: 0; }
  body { position: relative; }
  #controls { position: relative; z-index: 1; }
  #zoom-hit-target { height: 40px; left: calc(72% - 20px); position: absolute; top: calc(62% - 20px); width: 40px; z-index: 0; }
</style></head><body>
  <div id="zoom-hit-target" aria-label="Zoom hit target"></div>
  <div id="controls">
  <button id="measure-owner">Measure Owner</button>
  <button id="select-first">Select First</button>
  <button id="move-third">Move Third between First and Second</button>
  <output id="state">ready</output>
  </div>
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
    let ownsCanvasGestures = false
    let zoomHits = 0
    let backgroundHits = 0
    let measurementDispatches = 0
    let selectionDispatches = 0
    let moveDispatches = 0
    window.addEventListener('message', event => {
      const message = event.data
      if (event.source !== parent
        || event.origin !== parentOrigin
        || message?.channel !== ${JSON.stringify(studioProtocolChannel)}
        || message?.protocolVersion !== ${studioProtocolVersion}
        || message.identity?.previewInstanceId !== previewInstanceId) {
        return
      }
      if (message.type === 'highlight-source') {
        sourceIdentity = message.identity
        document.documentElement.dataset.studioSourceIdentity = 'ready'
      } else if (message.type === 'set-canvas-gestures') {
        sourceIdentity = message.identity
        ownsCanvasGestures = message.owned
        document.documentElement.dataset.studioCanvasGestures = message.owned ? 'owned' : 'released'
      } else if (message.type === 'capture-runtime') {
        parent.postMessage({
          channel: ${JSON.stringify(studioProtocolChannel)},
          protocolVersion: ${studioProtocolVersion},
          type: 'preview-runtime-captured',
          identity: message.identity,
          requestId: message.requestId,
          capture: { version: 1, capturedAt: 1, domains: [{ domain: 'data', version: 1,
            value: { entries: [{ key: 'fixture:Smoke', snapshot: JSON.stringify({ rows: {
              Playlist: [{ Title: 'Live playlist', Cover: 'https://example.com/live.png', Score: 42 }],
            } }) }] },
          }] },
        }, parentOrigin)
      }
    })
    window.addEventListener('wheel', event => {
      if (!ownsCanvasGestures || sourceIdentity === undefined) return
      event.preventDefault()
      parent.postMessage({
        channel: ${JSON.stringify(studioProtocolChannel)},
        clientX: event.clientX,
        clientY: event.clientY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        identity: sourceIdentity,
        protocolVersion: ${studioProtocolVersion},
        type: 'preview-canvas-gesture',
        zoom: event.ctrlKey || event.metaKey,
      }, parentOrigin)
    }, { passive: false })
    document.body.addEventListener('click', event => {
      if (event.target === document.querySelector('#zoom-hit-target')) return
      backgroundHits += 1
      document.querySelector('#state').textContent = 'zoom hit ' + zoomHits + ' / background ' + backgroundHits
    })
    document.querySelector('#zoom-hit-target').addEventListener('click', event => {
      event.stopPropagation()
      zoomHits += 1
      document.querySelector('#state').textContent = 'zoom hit ' + zoomHits + ' / background ' + backgroundHits
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
    document.querySelector('#measure-owner').addEventListener('click', async () => {
      const state = document.querySelector('#state')
      state.textContent = 'measuring'
      try {
        const current = await context()
        if (typeof window.taoSmokeOwnerRenderId !== 'string') {
          throw new Error('Studio smoke owner render identity was not installed')
        }
        window.taoSmokeMeasuredIdentity = current.identity
        parent.postMessage({
          channel: ${JSON.stringify(studioProtocolChannel)},
          identity: current.identity,
          measurements: [{
            elementName: 'Stack',
            rect: { x: 8, y: 12, width: 241.2, height: 121.6 },
            renderId: window.taoSmokeOwnerRenderId,
          }],
          protocolVersion: ${studioProtocolVersion},
          type: 'preview-layout-measurements',
        }, parentOrigin)
        measurementDispatches += 1
        state.textContent = 'measurement sent ' + measurementDispatches
      } catch (error) {
        state.textContent = 'measurement failed: ' + (error instanceof Error ? error.message : String(error))
        throw error
      }
    })
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
        selectionDispatches += 1
        state.textContent = 'selection sent ' + selectionDispatches
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
        moveDispatches += 1
        state.textContent = 'move sent ' + moveDispatches
      } catch (error) {
        state.textContent = 'move failed: ' + (error instanceof Error ? error.message : String(error))
        throw error
      }
    })
  </script>
</body></html>`
}

async function waitForSource(path: string, predicate: (source: string) => boolean): Promise<void> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(20_000) ?? Infinity)
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
  const deadline = Date.now() + (VerificationTimeouts.resolve(30_000) ?? Infinity)
  while (Date.now() < deadline) {
    if (await FS.isFile(path)) {
      return
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio to write ${path}.`)
}

async function waitForSketchFile(browser: StudioCdp, path: string): Promise<void> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(30_000) ?? Infinity)
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

type SmokeSketchReadiness = Readonly<{
  browserFailures: readonly string[]
  groupLabels: readonly string[]
  hostErrors: readonly string[]
  sketchCount: number
  status: string
}>

async function waitForSketchReady(browser: StudioCdp): Promise<void> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(30_000) ?? Infinity)
  let readiness: SmokeSketchReadiness | undefined
  while (Date.now() < deadline) {
    readiness = await browser.evaluate<SmokeSketchReadiness>(`(() => ({
      browserFailures: [],
      groupLabels: [...document.querySelectorAll('.studio-preview-group-label')]
        .map(label => label.textContent ?? ''),
      hostErrors: [...document.querySelectorAll('[data-tao-studio-sketch-error]')]
        .map(host => host.getAttribute('data-tao-studio-sketch-error') ?? '')
        .filter(Boolean),
      sketchCount: document.querySelectorAll('[data-tao-studio-sketch]').length,
      status: document.querySelector('.studio-status')?.textContent ?? '',
    }))()`)
    readiness = { ...readiness, browserFailures: browser.browserFailures().map(event => event.text) }
    // Generated sketch boards live beside scenario cells, not inside one. Their readiness contract
    // is the sketch matrix group plus its mounted board; scenario-inspector copy is unrelated.
    if (readiness.groupLabels.includes('sketch') && readiness.sketchCount > 0) {
      return
    }
    if (readiness.hostErrors.length > 0 || readiness.browserFailures.length > 0) {
      break
    }
    await Time.sleep(100)
  }
  await browser.captureScreenshot('studio-sketch-readiness-failure')
  Errors.throwHostEnvironment(`Studio sketch did not become ready: ${JSON.stringify(readiness)}`)
}

async function waitForSketchRect(
  path: string,
  previousRevision: number,
  diagnose?: () => Promise<unknown>,
): Promise<SmokeSketchCatalog> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(20_000) ?? Infinity)
  let catalog: SmokeSketchCatalog | undefined
  while (Date.now() < deadline) {
    catalog = smokeSketchCatalog(await FS.readText(path))
    if (catalog.revision > previousRevision && catalog.sketches[0]?.rects.length === 1) {
      return catalog
    }
    await Time.sleep(100)
  }
  const board = diagnose === undefined ? undefined : await diagnose()
  Errors.throwHostEnvironment(
    `Timed out waiting for a persisted Studio rectangle; board=${JSON.stringify(board)} last=${
      JSON.stringify(catalog)
    }`,
  )
}

type SmokeSketchBoardDiagnostics = Readonly<{
  bounds?: Readonly<{ height: number; left: number; top: number; width: number }>
  centerOnBoard: boolean
  elementAtCenter?: string
  error?: string
  gesture?: string
  hostError?: string
  proposalOpen: boolean
  present: boolean
  rectElements: number
  replaced: boolean
  status: string
  viewport: Readonly<{ height: number; scrollX: number; scrollY: number; width: number }>
}>

/** markSketchBoard stamps the mounted board so a later read can tell whether it was replaced. */
async function markSketchBoard(browser: StudioCdp, sketchId: string): Promise<string> {
  return await browser.evaluate<string>(`(() => {
    const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    if (!(board instanceof HTMLElement)) throw new Error('Missing Studio sketch board')
    const generation = crypto.randomUUID()
    board.dataset.taoStudioSmokeGeneration = generation
    return generation
  })()`)
}

/**
 * The action boundary for a real pointer gesture: the board's centre must be inside the viewport
 * and hit-test to the board itself, otherwise Chrome would deliver the drag to whatever covers it.
 */
/** `origin` is where in the board the gesture starts, when it is not the board's centre. */
async function expectPointerReachesBoard(
  browser: StudioCdp,
  sketchId: string,
  generation: string,
  delta: Readonly<{ x: number; y: number }>,
  origin?: Readonly<{ x: number; y: number }>,
): Promise<void> {
  await browser.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    if (!(element instanceof HTMLElement)) throw new Error('Missing Studio sketch board')
    element.scrollIntoView({ block: 'center', inline: 'center' })
    return true
  })()`)
  const diagnostics = await sketchBoardDiagnostics(browser, sketchId, generation)
  const bounds = diagnostics.bounds
  const start = bounds === undefined
    ? undefined
    : origin === undefined
    ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    : { x: bounds.left + origin.x, y: bounds.top + origin.y }
  const inView = (point: Readonly<{ x: number; y: number }>): boolean =>
    point.x >= 0 && point.y >= 0 && point.x < diagnostics.viewport.width && point.y < diagnostics.viewport.height
  const reachable = start !== undefined
    && inView(start)
    && inView({ x: start.x + delta.x, y: start.y + delta.y })
    && diagnostics.centerOnBoard
  if (!reachable) {
    await browser.captureScreenshot('studio-sketch-board-covered')
    Errors.throwHostEnvironment(
      `The Studio sketch board is not the element a pointer would reach at its centre: ${JSON.stringify(diagnostics)}`,
    )
  }
}

/**
 * The Draw preset is a workbench: code on the left, the sketch canvas in the middle column, and the
 * inspector on the right. The canvas holds at least its 320px floor between them. Run keeps the live
 * preview and hides that canvas.
 */
async function enterDrawPreset(browser: StudioCdp): Promise<void> {
  await browser.waitFor(`document.querySelector('[data-preset="draw"]') instanceof HTMLButtonElement`, {
    timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity,
  })
  await browser.click('[data-preset="draw"]')
  await browser.waitFor(`(() => {
    const host = document.querySelector('.tao-studio-product-host')
    const canvas = document.querySelector('.studio-draw-canvas')
    return host instanceof HTMLElement && host.dataset.layoutPreset === 'draw'
      && canvas instanceof HTMLElement && canvas.getBoundingClientRect().width >= 320
  })()`)
}

async function sketchBoardDiagnostics(
  browser: StudioCdp,
  sketchId: string,
  generation: string,
): Promise<SmokeSketchBoardDiagnostics> {
  return await browser.evaluate<SmokeSketchBoardDiagnostics>(`(() => {
    const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    const present = board instanceof HTMLElement
    const bounds = present ? board.getBoundingClientRect() : undefined
    const describe = element => element === null
      ? 'none'
      : element.tagName.toLowerCase() + '.' + element.className + ' ' + JSON.stringify(Object.keys(element.dataset))
    const center = bounds === undefined
      ? undefined
      : document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
    return {
      bounds: bounds === undefined
        ? undefined
        : { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width },
      centerOnBoard: present && center !== undefined && center !== null && board.contains(center),
      elementAtCenter: center === undefined ? undefined : describe(center),
      error: present ? board.dataset.taoStudioSketchError : undefined,
      gesture: present ? board.dataset.taoStudioSketchGesture : undefined,
      hostError: document.querySelector('[data-tao-studio-draw-canvas][data-tao-studio-sketch-error]')
        ?.getAttribute('data-tao-studio-sketch-error') ?? undefined,
      present,
      proposalOpen: document.querySelector('[data-tao-studio-sketch-snap-proposal]') !== null,
      rectElements: present ? board.querySelectorAll('[data-tao-studio-sketch-rect]').length : 0,
      replaced: !present || board.dataset.taoStudioSmokeGeneration !== ${JSON.stringify(generation)},
      status: document.querySelector('.studio-status')?.textContent ?? '',
      viewport: {
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        width: window.innerWidth,
      },
    }
  })()`)
}

/**
 * focusCanvasUntilFramed enters canvas focus and waits for the group's cells to take the focused
 * view's measured size, re-entering if the measurement had not reached the client yet.
 */
async function focusCanvasUntilFramed(browser: StudioCdp): Promise<void> {
  const framed = `(() => {
    const viewport = document.querySelector('.studio-preview-cell-viewport')
    return viewport instanceof HTMLElement
      && viewport.getBoundingClientRect().width === 242
      && viewport.getBoundingClientRect().height === 122
  })()`
  const deadline = Date.now() + (VerificationTimeouts.resolve(40_000) ?? Infinity)
  while (Date.now() < deadline) {
    await browser.click('.studio-canvas-focus')
    await browser.waitFor(
      `document.querySelector('[data-tao-studio-canvas-back="true"]') instanceof HTMLButtonElement`,
    )
    const attemptDeadline = Math.min(deadline, Date.now() + 10_000)
    while (Date.now() < attemptDeadline) {
      if (await browser.evaluate<boolean>(framed)) {
        return
      }
      await Time.sleep(100)
    }
    // Leave, so the next iteration is a fresh entry rather than a second click that would leave.
    await browser.click('.studio-canvas-focus')
    await browser.waitFor(`document.querySelector('[data-tao-studio-canvas-back="true"]') === null`)
  }
  Errors.throwHostEnvironment('Canvas focus never framed the selected view at its measured size.')
}

/**
 * A sketch control clicked while a compile is replacing the board reaches an element on its way out
 * and is lost. Pressing again is not a remedy: each of these controls consumes one unit of work, so
 * a second press after a merely slow first one snaps or unsnaps something else. The board is marked
 * and given a quiet moment instead, and pressed once when it is still the board that was marked.
 *
 * `prepare` is for a press whose meaning depends on state the board carries rather than on the
 * press alone, and it exists because an authoritative render replaces the whole board: a selection
 * made before the quiet moment is gone by the end of it, and Unsnap with nothing selected unsnaps
 * everything. It is a page expression returning whether the preparation holds, evaluated in the
 * same round trip that confirms the board is still the marked one, so the press cannot follow a
 * render that discarded what it was told to act on.
 */
// REMOVAL CANDIDATE: A fixed quiet pause approximates renderer settlement; simplifying it needs a host-visible completion signal to preserve one-press semantics.
async function clickSketchWhenSettled(
  browser: StudioCdp,
  sketchId: string,
  selector: string,
  path: string,
  predicate: (catalog: SmokeSketchCatalog) => boolean,
  options: { diagnose?: () => Promise<unknown>; prepare?: string } = {},
): Promise<SmokeSketchCatalog> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(20_000) ?? Infinity)
  while (Date.now() < deadline) {
    const generation = await markSketchBoard(browser, sketchId)
    await Time.sleep(300)
    const ready = await browser.evaluate<boolean>(`(() => {
      const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
      if (!(board instanceof HTMLElement)
        || board.dataset.taoStudioSmokeGeneration !== ${JSON.stringify(generation)}) {
        return false
      }
      return ${options.prepare ?? 'true'}
    })()`)
    if (ready) {
      await browser.click(selector)
      return await waitForSketchCatalog(path, predicate, options.diagnose)
    }
  }
  Errors.throwHostEnvironment(`The Studio sketch board never settled long enough to press ${selector}`)
}

async function waitForSketchCatalog(
  path: string,
  predicate: (catalog: SmokeSketchCatalog) => boolean,
  diagnose?: () => Promise<unknown>,
): Promise<SmokeSketchCatalog> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(30_000) ?? Infinity)
  let catalog: SmokeSketchCatalog | undefined
  while (Date.now() < deadline) {
    catalog = smokeSketchCatalog(await FS.readText(path))
    if (predicate(catalog)) {
      return catalog
    }
    await Time.sleep(100)
  }
  const board = diagnose === undefined ? undefined : await diagnose()
  Errors.throwHostEnvironment(
    `Timed out waiting for a Studio sketch catalog transition; board=${JSON.stringify(board)} last=${
      JSON.stringify(catalog)
    }`,
  )
}

/** The Draw strip's R tool; drawing hands back to V, so every draw picks it again. */
const rectangleTool = '[data-tao-studio-draw-tool="rect"]'

async function drawSketchRectangle(
  browser: StudioCdp,
  sketchId: string,
  rectangle: Readonly<{ height: number; width: number; x: number; y: number }>,
): Promise<string> {
  return await browser.evaluate<string>(`(() => {
    const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    if (!(board instanceof HTMLElement)) throw new Error('Missing Studio sketch board')
    const tool = document.querySelector(${JSON.stringify(rectangleTool)})
    if (tool instanceof HTMLElement) tool.click()
    const generation = crypto.randomUUID()
    board.dataset.taoStudioSmokeGeneration = generation
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
    return generation
  })()`)
}

async function waitForSketchBoardRefresh(browser: StudioCdp, sketchId: string, generation: string): Promise<void> {
  await browser.waitFor(`(() => {
    const board = document.querySelector(${JSON.stringify(`[data-tao-studio-sketch="${sketchId}"]`)})
    return board instanceof HTMLElement && board.dataset.taoStudioSmokeGeneration !== ${JSON.stringify(generation)}
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
  const deadline = Date.now() + (VerificationTimeouts.resolve(20_000) ?? Infinity)
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
  const deadline = Date.now() + (VerificationTimeouts.resolve(30_000) ?? Infinity)
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
  selector: '#measure-owner' | '#move-third' | '#select-first',
  expected: 'measurement sent' | 'move sent' | 'selection sent',
): Promise<void> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(15_000) ?? Infinity)
  let last = ''
  const previous = await browser.evaluateInFrame<string>(
    previewUrl,
    "document.querySelector('#state')?.textContent ?? ''",
  )
  const previousSequence = previous.startsWith(`${expected} `)
    ? Number(previous.slice(expected.length + 1))
    : 0
  // A context can disappear after the click has dispatched. Never repeat the user action merely
  // because its response was lost; the CDP layer resolves a stable frame before dispatch instead.
  await browser.clickInFrame(previewUrl, selector)
  while (Date.now() < deadline) {
    last = await browser.evaluateInFrame<string>(
      previewUrl,
      "document.querySelector('#state')?.textContent ?? ''",
    )
    if (last === `${expected} ${previousSequence + 1}`) {
      return
    }
    await Time.sleep(100)
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
  const deadline = Date.now() + (VerificationTimeouts.resolve(15_000) ?? Infinity)
  let lastSource = ''
  let lastStatus = ''
  while (Date.now() < deadline) {
    try {
      await browser.clickInFrame(previewUrl, selector)
    } catch (error) {
      lastStatus = Errors.messageOf(error)
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

/** dividerSize reads one pane divider's reported size, which is the pane width the shell applied. */
async function dividerSize(browser: StudioCdp, pane: string): Promise<number> {
  return await browser.evaluate<number>(
    `Number(document.querySelector('[data-divider="${pane}"]')?.getAttribute('aria-valuenow'))`,
  )
}

/** foldedRegions counts the syntax regions the lens currently collapses behind a glyph. */
async function foldedRegions(browser: StudioCdp): Promise<number> {
  return await browser.evaluate<number>("document.querySelectorAll('.cm-lens-glyph').length")
}

async function waitForPreviewSourceIdentity(browser: StudioCdp, previewUrl: string): Promise<void> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(15_000) ?? Infinity)
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
      last = Errors.messageOf(error)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio to publish source identity to the preview; last=${last}`)
}

async function waitForInspectorReady(browser: StudioCdp): Promise<void> {
  const deadline = Date.now() + (VerificationTimeouts.resolve(15_000) ?? Infinity)
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
