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

// The browser branch is temporarily quarantined from `_full-verify-studio`; keep this test and the
// `_studio-verify-simulated` recipe intact so the end-to-end journey remains directly reproducible.
// The native branch below validates the unattended Electrobun capability probe; it does not repeat
// the browser editor journey.
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

      await browser.click('[data-panel="components"]')
      await browser.waitFor(
        `document.querySelector('[data-tao-studio-component="Text"]') instanceof HTMLButtonElement`,
      )
      await browser.drag('[data-tao-studio-component="Text"]', '.cm-content', { steps: 12 })
      await browser.waitFor("document.querySelector('.cm-content')?.textContent.includes('New text')")
      await browser.pressShortcut('z')
      await browser.waitFor("!document.querySelector('.cm-content')?.textContent.includes('New text')")
      Expect(await FS.readText(sourcePath)).toBe(typedSource)

      await waitForPreviewSourceIdentity(browser, preview.url)
      await browser.clickInFrame(preview.url, '#select-first')
      await waitForPreviewState(browser, preview.url, 'selection sent')
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
      await waitForSource(sourcePath, source => source === typedSource)
      compileRevision = await waitForCompileAfter(browser, compileRevision)

      await browser.clickInFrame(preview.url, '#move-third')
      await waitForPreviewState(browser, preview.url, 'move sent')
      await waitForSource(sourcePath, source => ordered(source, ['First typed', 'Third', 'Second']))
      compileRevision = await waitForCompileAfter(browser, compileRevision)
      await browser.waitFor("document.querySelector('[data-tao-studio-undo] button')?.disabled === false")
      await browser.click('[data-tao-studio-undo] button')
      await waitForSource(sourcePath, source => source === typedSource)
      await waitForCompileAfter(browser, compileRevision)
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
}, 120_000)

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

async function waitForSourceOrStudioError(
  browser: StudioCdp,
  path: string,
  predicate: (source: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + 20_000
  let source = ''
  while (Date.now() < deadline) {
    source = await FS.readText(path)
    if (predicate(source)) {
      return
    }
    const status = await browser.evaluate<string>(
      "document.querySelector('.studio-status[data-state=\"error\"]')?.textContent ?? ''",
    )
    if (status !== '') {
      Errors.throwHostEnvironment(`Studio preview drop failed: ${status}`)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(`Timed out waiting for Studio source change. Last source:\n${source}`)
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

async function waitForPreviewState(
  browser: StudioCdp,
  previewUrl: string,
  expected: 'move sent' | 'selection sent',
): Promise<void> {
  const deadline = Date.now() + 15_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = await browser.evaluateInFrame<string>(
        previewUrl,
        "document.querySelector('#state')?.textContent ?? ''",
      )
      if (last === expected) {
        return
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (last.includes(' failed: ')) {
      Errors.throwHostEnvironment(`Studio smoke preview interaction failed: ${last}`)
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(
    `Timed out waiting for Studio smoke preview state ${JSON.stringify(expected)}; last=${JSON.stringify(last)}`,
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
