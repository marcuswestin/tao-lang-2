import { FS, Platform, ProjectIdentity, Repo } from '@shared'
import { Expect, mkTestDir, runCleanups, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  startStudioSessionServer,
  StudioCanvasViewportStore,
  studioProtocolChannel,
  studioProtocolVersion,
  StudioSessionManager,
} from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

const selectedText = 'Text("Selected source")'
const source = `use Stack, Text from @tao/ui
app Smoke { id "tao-studio-source-navigation" version "1.0.0" name "Source navigation smoke" view MainView }
${Array.from({ length: 80 }, (_, index) => `// navigation padding ${index}`).join('\n')}
view MainView() {
  render Stack() {
    ${selectedText}
  }
}
fixture Empty { }
scenarios MainView "states" {
  fixture Empty
  device phone
  scenario "default" { render MainView() }
}
`

Test('one preview press reveals newly opened source after its language connection arrives', async () => {
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? Repo.resolvePath('.artifacts/studio-smoke/source-navigation')
  let browser: StudioCdp | undefined
  let preview: ReturnType<typeof startPreview> | undefined
  let previewSession: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let studio: Awaited<ReturnType<typeof startStudioSessionServer>> | undefined
  let manager: StudioSessionManager | undefined
  let projectRoot: string | undefined
  let previewRuntimeRoot: string | undefined
  let primaryFailure: unknown
  try {
    await FS.mkdir(artifactRoot)
    projectRoot = await mkTestDir('tao-studio-source-navigation-', { location: 'host' })
    await FS.writeJson(FS.resolvePath('project-fixture.json', artifactRoot), {
      cleanup: 'removed in test cleanup',
      owner: 'preview source navigation regression',
      path: projectRoot,
    })
    previewRuntimeRoot = await Repo.mkScratchDir('tao-studio-source-navigation-runtime-')
    const sourcePath = FS.resolvePath('Smoke.tao', projectRoot)
    await FS.writeText(sourcePath, source)
    await FS.mkdir(FS.resolvePath('.tao', projectRoot))
    await ProjectIdentity.ensure(projectRoot)
    preview = startPreview()
    previewSession = await openStudioPreviewSession({ entryPath: sourcePath, previewRuntimeRoot, projectRoot })
    previewSession.session.setCanvasViewportStore(
      new StudioCanvasViewportStore(FS.resolvePath('legacy-viewports', artifactRoot)),
    )
    const compiled = await previewSession.session.compileInitial()
    Expect(compiled.status).toBe('compiled')
    manager = new StudioSessionManager()
    const current = manager.add({ previewUrl: preview.url, session: previewSession.session })
    studio = await startStudioSessionServer(manager, {
      hostname: '127.0.0.1',
      port: Number(Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_SERVER_PORT'] ?? 0),
    })
    browser = await StudioCdp.launchChrome({ artifactRoot })
    await browser.setViewport(1_440, 900)
    // Hold readiness, not the source request: the press selects before LSP rebuilds the view.
    await browser.addInitScript(`(() => {
      const NativeWebSocket = window.WebSocket
      window.taoSmokePendingLsp = []
      window.WebSocket = class extends NativeWebSocket {
        addEventListener(type, listener, options) {
          if (type !== 'open' || !this.url.includes('/api/language/lsp')) {
            return super.addEventListener(type, listener, options)
          }
          super.addEventListener(type, event => {
            window.taoSmokePendingLsp.push(() => listener.call(this, event))
          }, options)
        }
      }
    })()`)
    await browser.goto(`${studio.url}/sessions/${encodeURIComponent(current.sessionId)}`)
    await browser.waitFor('document.querySelector(\'[data-preset="code"]\') !== null')
    await browser.click('[data-preset="code"]')
    await activateSmokePreviews(browser)
    await browser.waitForInFrame(preview.url, "document.querySelector('#select-source')?.disabled === false")
    await browser.waitFor('window.taoSmokePendingLsp.length === 1')
    await browser.click('.studio-editor-tab-close[aria-label="Close Smoke.tao"]')
    await browser.waitFor("document.querySelector('.studio-editor .cm-editor') === null")
    // The closed tab's socket was cancelled; release only the one the preview press opens.
    await browser.evaluate('window.taoSmokePendingLsp.length = 0')

    await browser.clickInFrame(preview.url, '#select-source')
    const selectedLineVisible = `(() => {
      const scroller = document.querySelector('.studio-editor .cm-scroller')
      const line = [...document.querySelectorAll('.studio-editor .cm-line')]
        .find(line => line.textContent.includes(${JSON.stringify(selectedText)}))
      if (!(scroller instanceof HTMLElement) || !(line instanceof HTMLElement)) return false
      const viewport = scroller.getBoundingClientRect()
      const rect = line.getBoundingClientRect()
      return scroller.scrollTop > 0 && rect.top >= viewport.top && rect.bottom <= viewport.bottom
    })()`
    await browser.waitFor(selectedLineVisible)
    await browser.waitFor('window.taoSmokePendingLsp.length === 1')
    await browser.evaluate(`window.taoSmokeEditorBeforeLsp = document.querySelector('.studio-editor .cm-editor')`)
    await browser.evaluate('window.taoSmokePendingLsp.splice(0).forEach(deliver => deliver())')
    await browser.waitFor(`document.querySelector('.studio-editor .cm-editor') !== window.taoSmokeEditorBeforeLsp`)
    // A real view replacement must retain the visible selection without any second press.
    await browser.waitFor(selectedLineVisible)
    // Focusing reads the preserved range; it does not select text or press the preview again.
    await browser.evaluate("document.querySelector('.studio-editor .cm-content')?.focus()")
    await browser.waitFor(`window.getSelection()?.toString() === ${JSON.stringify(selectedText)}`)
    Expect(await browser.evaluate<string>('window.getSelection()?.toString()')).toBe('Text("Selected source")')
    Expect(await browser.evaluateInFrame<string>(preview.url, "document.querySelector('#state')?.textContent"))
      .toBe('selection sent 1')
    await browser.captureScreenshot('one-press-source-reveal')
    Expect(browser.browserFailures()).toEqual([])
    Expect(browser.consoleErrors().map(entry => entry.text)).toEqual([])
  } catch (error) {
    primaryFailure = error
    if (browser !== undefined) {
      await FS.writeJson(FS.resolvePath('failure.json', artifactRoot), {
        browserErrors: browser.consoleErrors(),
        status: await browser.evaluate("document.querySelector('.studio-status')?.textContent"),
      })
      await browser.captureScreenshot('one-press-source-reveal-failure')
    }
    throw error
  } finally {
    await runCleanups(primaryFailure, [
      { label: 'close browser', run: () => browser?.close() },
      { label: 'stop Studio', run: () => studio?.stop() },
      { label: 'close sessions', run: () => manager?.closeAll() },
      { label: 'close preview session', run: () => previewSession?.close() },
      { label: 'stop preview server', run: () => preview?.stop() },
      { label: 'remove project', run: () => projectRoot === undefined ? undefined : FS.remove(projectRoot) },
      {
        label: 'remove preview runtime',
        run: () => previewRuntimeRoot === undefined ? undefined : FS.remove(previewRuntimeRoot),
      },
    ], { channel: 'studio-smoke-cleanup', subject: 'Studio source navigation' })
  }
}, 90_000)

/** A preview-origin press sends the compiled source identity through the real Studio bridge. */
function startPreview(): { stop(): void; url: string } {
  const range = { end: source.indexOf(selectedText) + selectedText.length, start: source.indexOf(selectedText) }
  const html =
    `<!doctype html><button id="select-source" disabled>Select source</button><output id="state">ready</output>
    <script>
      const query = new URLSearchParams(location.search)
      const parentOrigin = query.get('taoStudioParentOrigin')
      const previewInstanceId = query.get('taoStudioPreviewInstanceId')
      const studioBase = parentOrigin + '/sessions/' + encodeURIComponent(query.get('taoStudioSessionId'))
      let identity
      let presses = 0
      window.addEventListener('message', event => {
        if (event.source !== parent || event.origin !== parentOrigin) return
        const message = event.data
        if (message?.channel !== ${JSON.stringify(studioProtocolChannel)}
          || message.protocolVersion !== ${studioProtocolVersion}
          || message.identity?.previewInstanceId !== previewInstanceId) return
        if (message.type === 'highlight-source' || message.type === 'set-canvas-gestures') {
          identity = message.identity
          document.querySelector('#select-source').disabled = false
        }
      })
      document.querySelector('#select-source').addEventListener('click', async () => {
        const runtime = await fetch(studioBase + '/api/preview/cell/bootstrap?previewInstanceId='
          + encodeURIComponent(previewInstanceId)).then(response => response.json())
        parent.postMessage({
          channel: ${JSON.stringify(studioProtocolChannel)},
          identity: { ...identity, ...runtime.identity,
            occurrence: { nodeKind: 'render', renderOwner: 'MainView' } },
          protocolVersion: ${studioProtocolVersion},
          range: ${JSON.stringify(range)},
          type: 'preview-select-source',
        }, parentOrigin)
        document.querySelector('#state').textContent = 'selection sent ' + ++presses
      })
    </script>`
  const server = Bun.serve({
    fetch: () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    hostname: '127.0.0.1',
    port: Number(Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_PREVIEW_PORT'] ?? 0),
  })
  return { stop: () => server.stop(true), url: `http://127.0.0.1:${server.port}` }
}
