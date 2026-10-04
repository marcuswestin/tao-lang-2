import { FS, HCI, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

const cellCount = 6
const source = `use Text from @tao/ui

app LoadingSmoke { view MainView }
view MainView() { render Text("LoadProbe") }
fixture Empty { }
scenarios MainView "loading" {
   fixture Empty
   device phone
${Array.from({ length: cellCount }, (_, index) => `   scenario "cell${index + 1}" { render MainView() }`).join('\n')}
}
`

/** Records each restored frame's first DOM and paint marker after a fresh browser opens. */
const loadingProbe = `(() => {
  const now = () => performance.timeOrigin + performance.now()
  if (location.search.includes('taoStudioPreviewInstanceId=')) {
    let reported = false
    const check = () => {
      if (reported || !document.body?.textContent?.includes('LoadProbe')) return
      reported = true
      const domAt = now()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        parent.postMessage({ type: 'tao-loading-probe', domAt, paintAt: now() }, '*')
      }))
    }
    new MutationObserver(check).observe(document, { characterData: true, childList: true, subtree: true })
    return
  }
  window.__taoLoading = { start: now(), cells: {}, loads: [] }
  addEventListener('message', event => {
    if (event.data?.type !== 'tao-loading-probe') return
    const frame = [...document.querySelectorAll('.studio-preview-cell iframe')]
      .find(frame => frame.contentWindow === event.source && new URL(frame.src).origin === event.origin)
    const card = frame?.closest('.studio-preview-cell')
    const id = card?.dataset.taoStudioCell ?? card?.dataset.cellId
    if (id) window.__taoLoading.cells[id] = { domAt: event.data.domAt, paintAt: event.data.paintAt }
  })
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLIFrameElement && event.target.src.startsWith('http')) {
      window.__taoLoading.loads.push({ at: now(), src: event.target.src })
    }
  }, true)
  // Keep every phone visible so background-frame animation throttling cannot hide a missing paint.
  const observer = new MutationObserver(() => {
    if (!document.head) return
    const style = document.createElement('style')
    style.textContent = '.studio-preview-grid { transform: scale(.25) !important; transform-origin: top left !important; }'
    document.head.append(style)
    observer.disconnect()
  })
  observer.observe(document, { childList: true, subtree: true })
})()`

type LoadingCapture = {
  start: number
  cells: Record<string, { domAt: number; paintAt: number }>
  loads: Array<{ at: number; src: string }>
}

Test('Studio restores and paints all six activated previews on browser reopen', async () => {
  const projectRoot = await mkTestDir('tao-studio-loading-')
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    await FS.writeText(
      FS.resolvePath('Project.tao', projectRoot),
      'project { id "tao-studio-loading" name "Loading measurement" }\n',
    )
    await FS.writeText(FS.resolvePath('LoadingSmoke.tao', projectRoot), source)
    studio = await startStudioSmokeLaunch({ appName: 'LoadingSmoke', projectRoot })
    const open = async (): Promise<StudioCdp> => {
      const fresh = await StudioCdp.launchChrome({ artifactRoot: studio!.readiness.artifactRoot })
      await fresh.addInitScript(loadingProbe)
      await fresh.setViewport(2_400, 1_600)
      await fresh.goto(studio!.readiness.sessionUrl)
      await fresh.waitFor(
        '[...document.querySelectorAll("[data-preset]")].some(button => button.dataset.preset === "run")',
      )
      await fresh.click('[data-preset="run"]')
      return fresh
    }
    // Seed activation through the normal controls, then prove those same cells survive a fresh browser.
    browser = await open()
    await activateSmokePreviews(browser)
    // budget-ok: real Metro and six browser frames can take longer than an in-memory condition on a busy host.
    await browser.waitFor(`Object.keys(window.__taoLoading.cells).length === ${cellCount}`, { timeoutMs: 90_000 })
    const activeIds = `Array.from(document.querySelectorAll('.studio-preview-cell[data-tao-studio-cell]'))
      .filter(card => card.querySelector('.studio-preview-activation-toggle[aria-pressed="true"]'))
      .map(card => card.dataset.taoStudioCell).sort()`
    const seededIds = await browser.evaluate<string[]>(activeIds)
    Expect(seededIds).toHaveLength(cellCount)
    await browser.close()
    browser = undefined

    browser = await open()
    // budget-ok: the regression waits for six real Metro-backed paints after a fresh browser opens.
    await browser.waitFor(`Object.keys(window.__taoLoading.cells).length === ${cellCount}`, { timeoutMs: 90_000 })
    const restoredIds = await browser.evaluate<string[]>(activeIds)
    const capture = await browser.evaluate<LoadingCapture>('window.__taoLoading')
    const paintedIds = Object.keys(capture.cells).sort()
    const paints = Object.values(capture.cells).map(cell => cell.paintAt - capture.start).sort((a, b) => a - b)
    Expect(restoredIds).toEqual(seededIds)
    Expect(paintedIds).toEqual(seededIds)
    Expect(capture.loads).toHaveLength(cellCount)
    Expect(browser.consoleErrors()).toEqual([])
    const summary = {
      activeCellIds: restoredIds,
      firstPaintMs: Math.round(paints[0]!),
      lastPaintMs: Math.round(paints.at(-1)!),
    }
    const path = Repo.resolvePath(`.artifacts/tests/studio-smoke/preview-latency/loading-${Date.now()}.json`)
    await FS.writeJson(path, { capture, summary })
    HCI.writeLine(`Restored preview loading: ${JSON.stringify(summary)}; ${path}`)
  } catch (error) {
    if (browser !== undefined) {
      await FS.writeJson(
        Repo.resolvePath(`.artifacts/tests/studio-smoke/preview-latency/loading-failure-${Date.now()}.json`),
        {
          capture: await browser.evaluate('window.__taoLoading'),
          frames: await browser.evaluate(`Array.from(document.querySelectorAll('iframe')).map(frame => ({
          src: frame.src, rect: frame.getBoundingClientRect().toJSON(), card: frame.closest('.studio-preview-cell')?.dataset,
        }))`),
          events: browser.browserEvents(),
        },
      )
      await browser.captureScreenshot('loading-failure')
    }
    throw error
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 180_000)
