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

      const typedSource = initialSource.replace('Text("First")', 'Text("First typed")')
      await browser.click('.cm-content')
      await browser.pressShortcut('a')
      await browser.insertText(typedSource)
      await browser.waitFor(
        `document.querySelector('.cm-content')?.textContent.includes('Text("First typed")')`,
      )
      Expect(await FS.readText(sourcePath)).toBe(initialSource)
      await browser.pressShortcut('s')
      await waitForSource(sourcePath, source => source === typedSource)

      await browser.click('[data-panel="components"]')
      await browser.waitFor(
        `document.querySelector('[data-tao-studio-component="Text"]') instanceof HTMLButtonElement`,
      )
      await browser.drag('[data-tao-studio-component="Text"]', '.cm-content', { steps: 12 })
      await browser.waitFor("document.querySelector('.cm-content')?.textContent.includes('New text')")
      await browser.pressShortcut('z')
      await browser.waitFor("!document.querySelector('.cm-content')?.textContent.includes('New text')")
      Expect(await FS.readText(sourcePath)).toBe(typedSource)

      await browser.clickInFrame(preview.url, '#select-first')
      await browser.waitFor(
        `document.querySelector('[data-studio-tao-inspector-context="Layout"] .studio-inspector-summary')
          && document.querySelector('[data-studio-tao-inspector-context="Layout"] .studio-inspector-field input:not(:disabled)')`,
      )
      // Raw `Error`: this string is evaluated by Chrome, so it runs in the page with no module
      // system and no reach into Tao's error taxonomy.
      await browser.evaluate(`(() => {
        const root = document.querySelector('[data-studio-tao-inspector-context="Layout"]')
        const mode = root?.querySelector('[data-inspector-field="Width mode"] select')
        const value = root?.querySelector('[data-inspector-field="Width value"] input')
        if (!(mode instanceof HTMLSelectElement) || !(value instanceof HTMLInputElement)) {
          throw new Error('Studio Width inspector control is missing.')
        }
        mode.value = 'fixed'
        mode.dispatchEvent(new Event('change', { bubbles: true }))
        value.value = '240'
        value.dispatchEvent(new Event('input', { bubbles: true }))
        value.dispatchEvent(new Event('change', { bubbles: true }))
        const apply = [...(root?.querySelectorAll('button') ?? [])]
          .find(candidate => candidate.textContent === 'Apply width')
        if (!(apply instanceof HTMLButtonElement)) {
          throw new Error('Studio Apply width action is missing.')
        }
        apply.click()
        return true
      })()`)
      await waitForSource(sourcePath, source => source.includes('Text("First typed") [width 240]'))
      await browser.waitFor(
        `document.querySelector('[data-studio-tao-inspector-context="Layout"] [data-tao-studio-undo] button')?.disabled === false`,
      )
      await browser.click('[data-studio-tao-inspector-context="Layout"] [data-tao-studio-undo] button')
      await waitForSource(sourcePath, source => source === typedSource)

      await browser.clickInFrame(preview.url, '#select-first')
      await browser.waitFor(
        `document.querySelector('[data-studio-tao-inspector-context="Layout"] .studio-inspector-summary') !== null`,
      )
      await browser.drag(
        '[data-tao-studio-component="Text"]',
        '.studio-preview-group-label',
        { steps: 12 },
      )
      await waitForSource(sourcePath, source => source.includes('Text("New text")'))
      await browser.waitFor(
        `document.querySelector('[data-studio-tao-inspector-context="Layout"] [data-tao-studio-undo] button')?.disabled === false`,
      )
      await browser.click('[data-studio-tao-inspector-context="Layout"] [data-tao-studio-undo] button')
      await waitForSource(sourcePath, source => source === typedSource)

      await browser.clickInFrame(preview.url, '#move-third')
      await waitForSource(sourcePath, source => ordered(source, ['First typed', 'Third', 'Second']))
      await browser.waitFor("document.querySelector('[data-tao-studio-undo] button')?.disabled === false")
      await browser.click('[data-tao-studio-undo] button')
      await waitForSource(sourcePath, source => source === typedSource)
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
    const renderRange = (path, content, label) => {
      const source = 'Text("' + label + '")'
      const start = content.indexOf(source)
      if (start < 0) throw new Error('Missing render: ' + label)
      return { end: start + source.length, id: path + ':' + start + ':' + (start + source.length), start }
    }
    const context = async () => {
      const protocol = await fetch(studioBase + '/api/protocol').then(response => response.json())
      const file = await fetch(studioBase + '/api/file?path=' + encodeURIComponent(protocol.entryPath))
        .then(response => response.json())
      const project = protocol.identity.project.endsWith('/')
        ? protocol.identity.project.slice(0, -1)
        : protocol.identity.project
      const path = project + '/' + file.path
      const runtime = query.get('taoStudioCell') === '1'
        ? await fetch(studioBase + '/api/preview/cell/bootstrap?previewInstanceId=' + encodeURIComponent(previewInstanceId))
          .then(response => response.json())
        : undefined
      return {
        file,
        identity: {
          ...protocol.identity,
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
      document.querySelector('#state').textContent = 'selection sent'
    })
    document.querySelector('#move-third').addEventListener('click', async () => {
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
      document.querySelector('#state').textContent = 'move sent'
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

function ordered(source: string, labels: readonly string[]): boolean {
  const offsets = labels.map(label => source.indexOf(`Text("${label}")`))
  return offsets.every(offset => offset >= 0)
    && offsets.every((offset, index) => index === 0 || offsets[index - 1]! < offset)
}
