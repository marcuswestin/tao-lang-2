import { Assert, FS, Repo, Time, VerificationTimeouts } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

const source = `use Text from @tao/ui

app CanvasEditing { id "canvasediting" version "1.0.0" name "CanvasEditing" view MainView }

view MainView() { render Text("Canvas editing") }

fixture Empty { }
scenarios MainView "states" {
   fixture Empty
   device phone
   scenario "default" { render MainView() }
}
`

type Catalog = Readonly<{
  revision: number
  sketches: readonly Readonly<{
    rects: readonly Readonly<
      { content?: string; height: number; id: string; kind: string; width: number; x: number; y: number }
    >[]
  }>[]
}>

Test(
  'Studio physically double-clicks free Text, saves Enter once, and cancels Escape without persistence',
  async () => {
    const projectRoot = await mkTestDir('tao-studio-canvas-editing-')
    const catalogPath = FS.resolvePath('.tao/store/studio/sketches.jsonc', projectRoot)
    let browser: StudioCdp | undefined
    let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
    try {
      await FS.writeText(FS.resolvePath('CanvasEditing.tao', projectRoot), source)
      await FS.mkdir(FS.resolvePath('.tao', projectRoot))
      studio = await startStudioSmokeLaunch({ appName: 'CanvasEditing', projectRoot, repositoryRoot: Repo.getRoot() })
      browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
      await browser.setViewport(1_920, 1_080)
      await browser.goto(studio.readiness.sessionUrl)
      await browser.waitFor(`document.querySelector('[data-preset="draw"]') !== null`)
      await browser.click('[data-preset="draw"]')
      const seeded = await browser.evaluate<{ ok: boolean; body: unknown }>(`(async () => {
      const base = ${JSON.stringify(`/sessions/${studio.readiness.sessionId}`)}
      const protocol = await (await fetch(base + '/api/protocol')).json()
      const response = await fetch(base + '/api/sketches/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: 'canvas-editing-seed',
          expectedRevision: protocol.sketchCatalog.revision,
          action: {
            kind: 'create-sketch', id: 'canvas-editing', project: protocol.identity.project,
            width: 360, height: 180, x: 24, y: 24,
            rects: [
              { id: 'editable-text', kind: 'Text', content: 'Original\\ntitle', x: 20, y: 20, width: 240, height: 40 },
              { id: 'plain-box', kind: 'Box', x: 20, y: 90, width: 160, height: 40 },
            ],
          },
        }),
      })
      return { ok: response.ok, body: await response.json() }
    })()`)
      Expect(seeded).toMatchObject({ ok: true })
      await browser.evaluate(`(() => {
      const fetch = window.fetch.bind(window)
      window.__taoCanvasWrites = 0
      window.fetch = (input, init) => {
        if (typeof input === 'string' && input.endsWith('/api/sketches/action')) window.__taoCanvasWrites += 1
        return fetch(input, init)
      }
      return true
    })()`)
      const rectSelector = '[data-tao-studio-sketch-rect="editable-text"]'
      const editorSelector = '[data-tao-studio-sketch-text-editor="editable-text"]'
      await browser.waitFor(`document.querySelector(${JSON.stringify(rectSelector)}) !== null`)
      await browser.doubleClick('[data-tao-studio-sketch-rect="plain-box"]')
      Expect(await browser.evaluate(`document.querySelector('[data-tao-studio-sketch-text-editor]') === null`)).toBe(
        true,
      )
      const initial = await readCatalog(catalogPath)
      await browser.doubleClick(rectSelector)
      await browser.waitFor(`document.activeElement?.matches(${JSON.stringify(editorSelector)}) === true`)
      Expect(
        await browser.evaluate(`(() => {
      const input = document.activeElement
      return { value: input.value, start: input.selectionStart, end: input.selectionEnd }
    })()`),
      ).toEqual({ end: 14, start: 0, value: 'Original\ntitle' })
      await browser.pressKey('Enter')
      await browser.waitFor(`document.querySelector(${JSON.stringify(editorSelector)}) === null`)
      Expect(await readCatalog(catalogPath)).toEqual(initial)
      Expect(await browser.evaluate('window.__taoCanvasWrites')).toBe(0)
      await browser.doubleClick(rectSelector)
      await browser.waitFor(`document.activeElement?.matches(${JSON.stringify(editorSelector)}) === true`)
      await browser.insertText('Saved title')
      await browser.pressKey('Enter')
      const saved = await Time.pollUntil(async () => {
        const catalog = await readCatalog(catalogPath)
        return catalog.sketches[0]?.rects[0]?.content === 'Saved title' ? catalog : undefined
      }, { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
      Assert.defined(saved, 'Enter persists inline Text content')
      Expect(saved.revision).toBe(initial.revision + 1)
      Expect(saved.sketches[0]?.rects).toEqual([
        { id: 'editable-text', kind: 'Text', content: 'Saved title', x: 20, y: 20, width: 240, height: 40 },
        { id: 'plain-box', kind: 'Box', x: 20, y: 90, width: 160, height: 40 },
      ])
      await browser.waitFor(`document.querySelector(${JSON.stringify(editorSelector)}) === null`)
      await browser.doubleClick(rectSelector)
      await browser.waitFor(`document.activeElement?.matches(${JSON.stringify(editorSelector)}) === true`)
      await browser.insertText('Discard this')
      await browser.pressKey('Escape')
      await browser.waitFor(`document.querySelector(${JSON.stringify(editorSelector)}) === null`)
      Expect(await readCatalog(catalogPath)).toEqual(saved)
      Expect(await browser.evaluate('window.__taoCanvasWrites')).toBe(1)
      Expect(await browser.evaluate(`document.querySelector(${JSON.stringify(rectSelector)})?.textContent`)).toBe(
        'Saved title',
      )
      Expect(browser.browserFailures()).toEqual([])
      await browser.captureScreenshot('canvas-inline-text-complete')
    } catch (error) {
      await browser?.captureScreenshot('canvas-inline-text-failure')
      throw error
    } finally {
      await browser?.close()
      await studio?.stop()
      await FS.remove(projectRoot)
    }
  },
  240_000,
)

async function readCatalog(path: string): Promise<Catalog> {
  return JSON.parse(await FS.readText(path)) as Catalog
}
