import { Errors, FS, HCI, Repo, Time, VerificationTimeouts } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

/**
 * Editing the file that declares HNReader's datasources re-runs those declarations under Fast
 * Refresh, which binds every store to a new connection whose cell overlay starts empty. A cell that
 * reads a fixture row must still show it once the hot update lands, without its frame reloading.
 *
 * Run it explicitly: `./agent unsandboxed studio-smoke <this file>`.
 */

const hnreaderRoot = Repo.resolvePath('Apps/HNReader')
const probeTitle = 'Datasource probe row'
const probeSource = `use Col, Text from @tao/ui
use Story from @model

public
view DatasourceProbe(Story) {
   render Col() {
      Text(Story.Title)
}  }

fixture ProbeRows {
   Probe = create Story {
      HnId: 501,
      Title: "${probeTitle}",
      Score: 1,
      Author: "probe",
      CommentCount: 0,
      Rank: 1
}  }

scenarios DatasourceProbe "datasource" {
   fixture ProbeRows
   device phone
   scenario "probe" {
      render (Story: Probe)
}  }
`

/** Counts the preview's completed Metro hot updates. */
const hmrProbeScript = `(() => {
  if (!location.search.includes('taoStudioPreviewInstanceId=')) return
  const probe = window.__taoHmrProbe = { done: 0 }
  const NativeSocket = window.WebSocket
  function ProbedSocket(...args) {
    const socket = new NativeSocket(...args)
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string' && event.data.includes('"type":"update-done"')) probe.done += 1
    })
    return socket
  }
  ProbedSocket.prototype = NativeSocket.prototype
  Object.assign(ProbedSocket, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 })
  window.WebSocket = ProbedSocket
})()`

Test('a fixture row stays on screen after the datasource file is edited', async () => {
  const projectRoot = await mkTestDir('tao-studio-datasource-edit-')
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    for (const name of await FS.listDir(hnreaderRoot)) {
      if (/\.(tao|ts)$/.test(name) && await FS.isFile(FS.resolvePath(name, hnreaderRoot))) {
        await FS.copyFile(FS.resolvePath(name, hnreaderRoot), FS.resolvePath(name, projectRoot))
      }
    }
    await FS.copyDirectory(FS.resolvePath('@model', hnreaderRoot), FS.resolvePath('@model', projectRoot))
    // Studio lists scenarios for `@/studio` views without the app importing them.
    const probePath = FS.resolvePath('@/studio/DatasourceProbe.tao', projectRoot)
    await FS.mkdir(FS.dirname(probePath))
    await FS.writeText(probePath, probeSource)

    studio = await startStudioSmokeLaunch({ appName: 'HNReaderStub', projectRoot })
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.addInitScript(hmrProbeScript)
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    await activateSmokePreviews(browser)
    const selector = '.studio-preview-cell iframe[title*="DatasourceProbe"]'
    const previewUrl = await loadedPreviewUrl(browser, selector)
    const showsProbe = `document.body?.textContent?.includes(${JSON.stringify(probeTitle)}) === true`
    await browser.waitForInFrame(previewUrl, showsProbe, {
      timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity,
    })
    await browser.evaluate(`(() => {
        window.__taoFrameLoads = 0
        document.querySelector(${JSON.stringify(selector)})
          .addEventListener('load', () => { window.__taoFrameLoads += 1 })
        return true
      })()`)
    const updatesDone = () =>
      browser!.evaluateInFrame<number>(previewUrl, 'window.__taoHmrProbe.done', { world: 'page' })
    const before = await updatesDone()

    const dataPath = FS.resolvePath('Data.tao', projectRoot)
    const source = await FS.readText(dataPath)
    Expect(source).toContain('"HNReaderBookmarksDev"')
    await FS.writeText(dataPath, source.replace('"HNReaderBookmarksDev"', '"HNReaderBookmarksEdited"'))
    const updated = await Time.pollUntil(async () => (await updatesDone()) > before || undefined, {
      intervalMs: 50,
      timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity,
    })
    Expect(updated).toBe(true)
    // The fixture reseeds asynchronously after the update commits.
    await Time.sleep(2_000)

    const text = await browser.evaluateInFrame<string>(previewUrl, 'document.body?.innerText ?? ""', { world: 'page' })
    if (!text.includes(probeTitle)) {
      // The project root and its Studio artifacts are removed below, so diagnostics go to the repo.
      const diagnostics = Repo.resolvePath(`.artifacts/tests/studio-smoke/datasource-edit-${Date.now()}`)
      await browser.captureScreenshotAt(FS.resolvePath('preview.png', diagnostics))
      await FS.writeJson(FS.resolvePath('state.json', diagnostics), {
        browserEvents: browser.browserEvents().slice(-60),
        html: await browser.evaluateInFrame(previewUrl, 'document.body?.innerHTML?.slice(0, 4000)', {
          world: 'page',
        }),
        text,
      })
      HCI.writeLine(`datasource edit diagnostics: ${diagnostics}`)
    }
    Expect(text).toContain(probeTitle)
    Expect(await browser.evaluate<number>('window.__taoFrameLoads')).toBe(0)
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 300_000)

/**
 * An activated cell keeps its iframe off-screen, and a cell can remount between
 * two reads, so its URL is read in the same poll that sees it loaded.
 */
async function loadedPreviewUrl(browser: StudioCdp, selector: string): Promise<string> {
  const previewUrl = await Time.pollUntil(
    async () =>
      await browser.evaluate<string>(`(() => {
          const cell = document.querySelector(${JSON.stringify(selector)})
          if (!(cell instanceof HTMLIFrameElement)) return ''
          cell.scrollIntoView({ block: 'nearest' })
          return cell.src.startsWith('http') ? cell.src : ''
        })()`) || undefined,
    { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity },
  )
  if (previewUrl === undefined) {
    const titles = await browser.evaluate<string[]>(
      `[...document.querySelectorAll('.studio-preview-cell iframe')].map(cell => cell.title)`,
    )
    Errors.throwHostEnvironment(`The probe cell never loaded its Metro URL; cells: ${JSON.stringify(titles)}`)
  }
  return previewUrl
}
