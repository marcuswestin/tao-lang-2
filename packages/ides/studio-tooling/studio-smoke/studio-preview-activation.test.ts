import { FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir, runCleanups, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  startStudioSessionServer,
  StudioCanvasViewportStore,
  StudioSessionManager,
} from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'

const appSource = `use Text from @tao/ui
app ActivationSmoke { view MainView }
view MainView() { render Text("Active") }
`
const scenarioSource = `fixture Empty { }
scenarios MainView "states" {
  fixture Empty
  device phone
  scenario "phone" { render MainView() }
}
`

for (const kind of ['scenario', 'whole-app'] as const) {
  Test(`${kind} preview activation accepts keyboard input and ignores a second pending control press`, async () => {
    const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
      ?? Repo.resolvePath('.artifacts/studio-smoke/activation')
    let projectRoot: string | undefined
    let runtimeRoot: string | undefined
    let preview: ReturnType<typeof Bun.serve> | undefined
    let session: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
    let manager: StudioSessionManager | undefined
    let server: Awaited<ReturnType<typeof startStudioSessionServer>> | undefined
    let browser: StudioCdp | undefined
    let primaryFailure: unknown
    try {
      projectRoot = await mkTestDir('tao-studio-activation-', { location: 'host' })
      await FS.writeJson(FS.resolvePath(`project-fixture-${kind}.json`, artifactRoot), {
        owner: 'preview activation browser regression',
        path: projectRoot,
        cleanup: 'removed after servers stop',
      })
      const sourcePath = FS.resolvePath('ActivationSmoke.tao', projectRoot)
      await FS.writeText(sourcePath, appSource + (kind === 'scenario' ? scenarioSource : ''))
      await FS.writeText(
        FS.resolvePath('Project.tao', projectRoot),
        'project { id "tao-studio-activation" name "Activation smoke" }\n',
      )
      runtimeRoot = await Repo.mkScratchDir('tao-studio-activation-runtime-')
      session = await openStudioPreviewSession({ entryPath: sourcePath, previewRuntimeRoot: runtimeRoot, projectRoot })
      session.session.setCanvasViewportStore(new StudioCanvasViewportStore(FS.resolvePath('legacy', artifactRoot)))
      Expect((await session.session.compileInitial()).status).toBe('compiled')
      preview = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response('<h1>Active</h1>', { headers: { 'content-type': 'text/html' } }),
      })
      manager = new StudioSessionManager()
      const current = manager.add({ previewUrl: `http://127.0.0.1:${preview.port}`, session: session.session })
      server = await startStudioSessionServer(manager, { hostname: '127.0.0.1', port: 0 })
      browser = await StudioCdp.launchChrome({ artifactRoot })
      await browser.setViewport(1_440, 900)
      await browser.goto(`${server.url}/sessions/${encodeURIComponent(current.sessionId)}`)
      await browser.waitFor("document.querySelector('.studio-preview-inactive-activate') !== null")
      Expect(await browser.evaluate("document.querySelectorAll('.studio-preview-cell iframe').length")).toBe(0)
      await browser.evaluate(`(() => {
        const nativeFetch = window.fetch
        window.taoActivationWrites = []
        window.fetch = function(...args) {
          if (String(args[0]).endsWith('/api/studio/session') && typeof args[1]?.body === 'string') {
            const body = JSON.parse(args[1].body)
            if (body.field === 'activatedCellIds') {
              window.taoActivationWrites.push(body.value)
              if (window.taoActivationWrites.length === 1) {
                return new Promise(resolve => {
                  window.taoReleaseActivation = () => resolve(nativeFetch(...args))
                })
              }
            }
          }
          return nativeFetch(...args)
        }
      })()`)
      await browser.click('.studio-preview-inactive-activate')
      await browser.waitFor('typeof window.taoReleaseActivation === "function"')
      Expect(await browser.evaluate("document.querySelector('.studio-preview-activation-toggle')?.disabled")).toBe(true)
      // A real second control press during the held write must not queue the inverse action.
      await browser.evaluate("document.querySelector('.studio-preview-activation-toggle').click()")
      await browser.evaluate('window.taoReleaseActivation()')
      await browser.waitFor("document.querySelector('.studio-preview-cell iframe') !== null")
      await browser.waitFor("document.querySelector('.studio-preview-activation-toggle')?.disabled === false")
      // Context refresh can repeat the same persistence write; none may request deactivation.
      Expect(await browser.evaluate('window.taoActivationWrites.every(ids => ids.length === 1)')).toBe(true)

      Expect(
        await browser.evaluate(`(() => {
        const button = document.querySelector('.studio-preview-activation-toggle')
        button.focus()
        return document.activeElement === button
      })()`),
      ).toBe(true)
      await browser.pressKey(' ')
      await browser.waitFor("document.querySelector('.studio-preview-inactive-activate') !== null")
      Expect(await browser.evaluate("document.querySelectorAll('.studio-preview-cell iframe').length")).toBe(0)
      await browser.waitFor("document.querySelector('.studio-preview-inactive-activate')?.disabled === false")
      await browser.evaluate("document.querySelector('.studio-preview-inactive-activate').focus()")
      await browser.pressKey('Enter')
      await browser.waitFor("document.querySelector('.studio-preview-cell iframe') !== null")
      await browser.waitFor("document.querySelector('.studio-preview-activation-toggle')?.disabled === false")
      Expect(
        await browser.evaluate(`window.taoActivationWrites.map(ids => ids.length)
        .filter((count, index, counts) => index === 0 || count !== counts[index - 1])`),
      ).toEqual([1, 0, 1])
      Expect(
        await browser.evaluate(
          "document.querySelector('.studio-preview-activation-toggle')?.getAttribute('aria-pressed')",
        ),
      )
        .toBe('true')
      Expect(browser.browserFailures()).toEqual([])
      Expect(browser.consoleErrors().map(entry => entry.text)).toEqual([])
    } catch (error) {
      primaryFailure = error
      if (browser !== undefined) {
        await FS.writeJson(FS.resolvePath(`activation-${kind}-failure.json`, artifactRoot), {
          writes: await browser.evaluate('window.taoActivationWrites'),
          status: await browser.evaluate("document.querySelector('.studio-status')?.textContent"),
        })
      }
      await browser?.captureScreenshot(`activation-${kind}-failure`)
      throw error
    } finally {
      await runCleanups(primaryFailure, [
        { label: 'close browser', run: () => browser?.close() },
        { label: 'stop Studio', run: () => server?.stop() },
        { label: 'close sessions', run: () => manager?.closeAll() },
        { label: 'close preview session', run: () => session?.close() },
        { label: 'stop preview server', run: () => preview?.stop(true) },
        { label: 'remove project', run: () => projectRoot === undefined ? undefined : FS.remove(projectRoot) },
        { label: 'remove runtime', run: () => runtimeRoot === undefined ? undefined : FS.remove(runtimeRoot) },
      ], { channel: 'studio-smoke-cleanup', subject: 'preview activation' })
    }
  }, 90_000)
}
