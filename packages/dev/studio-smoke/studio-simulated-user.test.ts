import { FS, Platform, Time } from '@shared'
import { Expect, Test } from '@shared/test'
import {
  startStudioServer,
  StudioProjectSession,
  studioProtocolChannel,
  studioProtocolVersion,
  studioSourceActionVersion,
} from '@studio'
import { StudioCdp } from '../dev-src/studio/StudioCdp'
import { type StartedStudioNative, StudioNative } from '../dev-src/studio/StudioNative'

const initialSource = `app Smoke { view MainView }
view MainView() {
  render Stack() {
    Text("First")
    Text("Second")
    Text("Third")
  }
}
`

Test('simulated user edits, moves, and undoes through the real Studio browser shell', async () => {
  const artifactParent = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT'] ?? FS.tmpdir()
  await FS.mkdir(artifactParent)
  const projectRoot = await FS.mkTmpDir(FS.resolvePath('simulated-user-', artifactParent))
  const sourcePath = FS.resolvePath('Smoke.tao', projectRoot)
  let browser: StudioCdp | undefined
  let native: StartedStudioNative | undefined
  let preview: ReturnType<typeof startPreviewServer> | undefined
  let studio: Awaited<ReturnType<typeof startStudioServer>> | undefined
  try {
    await FS.writeText(sourcePath, initialSource)
    preview = startPreviewServer(smokePort('TAO_STUDIO_SMOKE_PREVIEW_PORT', 42_001))
    const session = await StudioProjectSession.open({
      async compile(request) {
        return { message: `Stub preview compiled revision ${request.compileRevision}.` }
      },
      entryPath: sourcePath,
      projectRoot,
    })
    studio = await startStudioServer(session, {
      allowedOrigins: [preview.url],
      hostname: '127.0.0.1',
      port: smokePort('TAO_STUDIO_SMOKE_SERVER_PORT', 42_000),
      previewUrl: preview.url,
    })
    if (Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_NATIVE'] === 'true') {
      const remoteDebuggingPort = smokePort('TAO_STUDIO_SMOKE_ELECTRON_DEBUGGING_PORT', 42_002)
      native = await StudioNative.start({
        artifactRoot: FS.resolvePath('electron', artifactParent),
        remoteDebuggingPort,
        showWindow: false,
        studioUrl: studio.url,
      })
      browser = await StudioCdp.attach({
        baseUrl: `http://127.0.0.1:${remoteDebuggingPort}`,
        targetUrlPrefix: studio.url,
      })
    } else {
      browser = await StudioCdp.launchChrome()
    }
    await browser.goto(studio.url)
    await browser.waitFor("document.querySelector('.cm-content')?.textContent.includes('Text(\"First\")')", {
      timeoutMs: 30_000,
    })

    const typedSource = initialSource.replace('Text("First")', 'Text("First typed")')
    await browser.click('.cm-content')
    await browser.pressShortcut('a')
    await browser.insertText(typedSource)
    await waitForSource(sourcePath, source => source === typedSource)

    await browser.clickInFrame(preview.url, '#move-third')
    await waitForSource(sourcePath, source => ordered(source, ['First typed', 'Third', 'Second']))
    await browser.waitFor("document.querySelector('[data-tao-studio-undo]')?.disabled === false")
    await browser.click('[data-tao-studio-undo]')
    await waitForSource(sourcePath, source => source === typedSource)
    Expect(await FS.readText(sourcePath)).toBe(typedSource)
  } finally {
    await browser?.close()
    await native?.stop()
    studio?.stop()
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
    throw new Error(`${name} must be a valid TCP port.`)
  }
  return value
}

function previewHtml(): string {
  return `<!doctype html>
<html><body>
  <button id="move-third">Move Third between First and Second</button>
  <output id="state">ready</output>
  <script>
    const query = new URLSearchParams(location.search)
    const parentOrigin = query.get('taoStudioParentOrigin')
    const previewInstanceId = query.get('taoStudioPreviewInstanceId')
    const renderId = (path, content, label) => {
      const source = 'Text("' + label + '")'
      const start = content.indexOf(source)
      if (start < 0) throw new Error('Missing render: ' + label)
      return path + ':' + start + ':' + (start + source.length)
    }
    document.querySelector('#move-third').addEventListener('click', async () => {
      const protocol = await fetch(parentOrigin + '/api/protocol').then(response => response.json())
      const file = await fetch(parentOrigin + '/api/file?path=' + encodeURIComponent(protocol.entryPath))
        .then(response => response.json())
      const project = protocol.identity.project.endsWith('/')
        ? protocol.identity.project.slice(0, -1)
        : protocol.identity.project
      const path = project + '/' + file.path
      const firstLabel = file.content.includes('First typed') ? 'First typed' : 'First'
      parent.postMessage({
        action: {
          afterId: renderId(path, file.content, firstLabel),
          beforeId: renderId(path, file.content, 'Second'),
          draggedId: renderId(path, file.content, 'Third'),
          kind: 'move-render',
        },
        channel: ${JSON.stringify(studioProtocolChannel)},
        checkpoint: { id: 'smoke-move', phase: 'single' },
        identity: {
          ...protocol.identity,
          path,
          previewInstanceId,
          sourceVersion: file.sourceVersion,
        },
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
  throw new Error(`Timed out waiting for Studio source change. Last source:\n${source}`)
}

function ordered(source: string, labels: readonly string[]): boolean {
  const offsets = labels.map(label => source.indexOf(`Text("${label}")`))
  return offsets.every(offset => offset >= 0)
    && offsets.every((offset, index) => index === 0 || offsets[index - 1]! < offset)
}
