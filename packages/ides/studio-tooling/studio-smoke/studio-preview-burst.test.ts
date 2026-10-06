import { Assert, Errors, FS, ProjectIdentity, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

const previewSelector = '.studio-preview-cell iframe'

const mainSource = (label: string) =>
  `use Col, Text from @tao/ui
use BurstLabel from ./BurstLabel

app MetroBurstSmoke { id "tao-metro-burst" version "1.0.0" name "Metro Burst" view BurstView }

public
view BurstView() {
   render Col() {
      Text("${label}")
      BurstLabel()
}  }

fixture Empty { }
scenarios BurstView "states" {
   fixture Empty
   device phone
   scenario "default" {
      render BurstView()
}  }
`

const helperSource = (label: string) =>
  `use Text from @tao/ui

public
view BurstLabel() {
   render Text("${label}")
}
`

const hmrProbe = `(() => {
  if (!location.search.includes('taoStudioPreviewInstanceId=')) return
  const probe = window.__taoMetroBurstProbe = { errorFrames: [] }
  const NativeSocket = window.WebSocket
  function ProbedSocket(...args) {
    const socket = new NativeSocket(...args)
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      const type = /"type"\\s*:\\s*"([a-z-]+)"/.exec(event.data)?.[1]
      if (type === 'error' || event.data.includes('RevisionNotFoundError')) {
        probe.errorFrames.push(event.data.slice(0, 1000))
      }
    })
    return socket
  }
  ProbedSocket.prototype = NativeSocket.prototype
  Object.assign(ProbedSocket, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 })
  window.WebSocket = ProbedSocket
})()`

Test('real Metro applies multi-file edit bursts and keeps the preview live', async () => {
  const projectRoot = await mkTestDir('tao-studio-preview-burst-')
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    await FS.mkdir(FS.resolvePath('.tao', projectRoot))
    await ProjectIdentity.ensure(projectRoot)
    const mainPath = FS.resolvePath('MetroBurstSmoke.tao', projectRoot)
    const helperPath = FS.resolvePath('BurstLabel.tao', projectRoot)
    await FS.writeText(mainPath, mainSource('MainInitial'))
    await FS.writeText(helperPath, helperSource('HelperInitial'))

    studio = await startStudioSmokeLaunch({ appName: 'MetroBurstSmoke', projectRoot })
    Assert.defined(studio.readiness.previewUrl, 'the Studio launch advertises its Metro preview URL')
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.addInitScript(hmrProbe)
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    await activateSmokePreviews(browser)

    const selector = JSON.stringify(previewSelector)
    const previewUrl = await Time.pollUntil(
      async () =>
        await browser!.evaluate<string>(`(() => {
        const frame = document.querySelector(${selector})
        if (!(frame instanceof HTMLIFrameElement)) return ''
        frame.scrollIntoView({ block: 'nearest' })
        return frame.src.startsWith('http') ? frame.src : ''
      })()`) || undefined,
      { intervalMs: 100, timeoutMs: 60_000 },
    )
    if (previewUrl === undefined) {
      const frames = await browser.evaluate<{ src: string; title: string }[]>(
        `[...document.querySelectorAll(${selector})]
        .map(frame => ({ src: frame.src, title: frame.title }))`,
      )
      const status = await browser.evaluate<string>(`document.querySelector('.studio-status')?.textContent ?? ''`)
      Errors.throwHostEnvironment(
        `The one-view Metro burst preview never loaded: ${JSON.stringify({ frames, status })}`,
      )
    }
    // A minimal app may publish more than one cell. Keep the first frame only after proving it owns
    // both initial labels; every later state check uses this exact Metro URL.
    await browser.waitForInFrame(
      previewUrl,
      `document.body?.textContent?.includes('MainInitial') === true && document.body?.textContent?.includes('HelperInitial') === true`,
      { timeoutMs: 60_000 },
    )
    await browser.evaluate(`(() => {
      window.__taoMetroBurstFrameLoads = 0
      document.addEventListener('load', event => {
        if (event.target instanceof HTMLIFrameElement && event.target.matches(${selector})) {
          window.__taoMetroBurstFrameLoads += 1
        }
      }, true)
      return true
    })()`)
    await browser.evaluateInFrame(previewUrl, 'window.__taoMetroBurstProbe.errorFrames = []', { world: 'page' })

    // Save both authored modules three times without waiting for intermediate preview updates.
    for (let burst = 1; burst <= 3; burst += 1) {
      await Promise.all([
        FS.writeText(mainPath, mainSource(`MainBurst${burst}`)),
        FS.writeText(helperPath, helperSource(`HelperBurst${burst}`)),
      ])
    }
    await browser.waitForInFrame(
      previewUrl,
      `document.body?.textContent?.includes('MainBurst3') === true && document.body?.textContent?.includes('HelperBurst3') === true`,
      { timeoutMs: 60_000 },
    )

    // Prove the burst did not leave a pending watcher event stranded.
    await FS.writeText(helperPath, helperSource('HelperAfterBurst'))
    await browser.waitForInFrame(
      previewUrl,
      `document.body?.textContent?.includes('MainBurst3') === true && document.body?.textContent?.includes('HelperAfterBurst') === true`,
      { timeoutMs: 60_000 },
    )

    const state = await browser.evaluateInFrame<{ main: boolean; helper: boolean; errorFrames: string[] }>(
      previewUrl,
      `({
        main: document.body?.textContent?.includes('MainBurst3') === true,
        helper: document.body?.textContent?.includes('HelperAfterBurst') === true,
        errorFrames: window.__taoMetroBurstProbe?.errorFrames ?? [],
      })`,
      { world: 'page' },
    )
    Expect(state.main).toBe(true)
    Expect(state.helper).toBe(true)
    Expect(JSON.stringify(state.errorFrames)).not.toContain('RevisionNotFoundError')
    Expect(state.errorFrames).toEqual([])
    Expect(await browser.evaluate<number>('window.__taoMetroBurstFrameLoads')).toBe(0)
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 300_000)
