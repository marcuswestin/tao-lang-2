import { Assert, Errors, FS, HCI, Repo, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

/**
 * Measures Studio's edit-to-paint path against real Metro, once per preview publication mode, for a
 * one-file app and for HNReader. Each save is timed from the editor keydown, or from the disk write,
 * to the next frame after the edited text reached the preview DOM, and split at the saved source's
 * mtime, the newest generated module's mtime, and the first Metro HMR message the preview received.
 * Every stamp is wall-clock milliseconds on one host.
 *
 * Run it explicitly: `./agent unsandboxed studio-smoke <this file>`. The samples are written under
 * `.artifacts/tests/studio-smoke/preview-latency/`.
 */

const EDITS_PER_MODE = 8

const latencySource = (label: string) =>
  `use Col, Text from @tao/ui

app LatencySmoke { view MainView }

view MainView() {
   render Col() {
      Text("${label}")
      Text("Second")
      Text("Third")
}  }

fixture Empty { }
scenarios MainView "states" {
   fixture Empty
   device phone
   scenario "default" { render MainView() }
}
`

type EditSample = {
  domAt: number
  edit: number
  frameLoads: number
  hmrAt?: number
  mode: 'on' | 'off'
  paintAt?: number
  publishedAt: number
  saveAt: number
  sourceWrittenAt: number
}

const probeScript = `(() => {
  if (!location.search.includes('taoStudioPreviewInstanceId=')) return
  const now = () => performance.timeOrigin + performance.now()
  const probe = window.__taoLatencyProbe = { hmr: [], other: [], painted: {}, seen: {}, watch: [] }
  const NativeSocket = window.WebSocket
  function ProbedSocket(...args) {
    const socket = new NativeSocket(...args)
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      const type = /"type":"([a-z-]+)"/.exec(event.data)?.[1]
      if (type !== undefined && type.startsWith('update')) probe.hmr.push({ at: now(), type })
      // A stalled edit's diagnostics need what Metro sent instead, such as an error.
      else if (type !== undefined) probe.other.push({ at: now(), data: event.data.slice(0, 600), type })
    })
    return socket
  }
  ProbedSocket.prototype = NativeSocket.prototype
  Object.assign(ProbedSocket, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 })
  window.WebSocket = ProbedSocket
  const check = () => {
    const text = document.body?.textContent ?? ''
    for (const marker of probe.watch) {
      if (probe.seen[marker] === undefined && text.includes(marker)) {
        probe.seen[marker] = now()
        requestAnimationFrame(() => requestAnimationFrame(() => { probe.painted[marker] = now() }))
      }
    }
  }
  new MutationObserver(check).observe(document, { characterData: true, childList: true, subtree: true })
})()`

type LatencyProject = {
  appName: string
  /**
   * `editor` saves through Studio's editor; `disk` writes the file and lets Studio's watcher see
   * it, so that sample's save-to-source span is zero and its watcher batch lands in source-to-publish.
   */
  edit: 'disk' | 'editor'
  /** Picks the measured cell among the preview iframes. */
  frameSelector: string
  /** The rendered text the first compile shows. */
  initialText: string
  name: string
  /** Writes the authored project and returns the file the editor saves. */
  setup: (projectRoot: string) => Promise<string>
  /** The edited file's full source with `marker` in rendered text. */
  sourceFor: (marker: string) => string
}

const hnreaderRoot = Repo.resolvePath('Apps/HNReader')

/**
 * A view beside HNReader's own, so the measurement times an ordinary view edit. Editing Data.tao
 * re-executes its datasource declarations and every cell reseeds its fixture, a cost measured
 * separately from this one.
 */
const hnreaderProbeSource = (label: string) =>
  `use Col, Text from @tao/ui

public
view LatencyProbe() {
   render Col() {
      Text("${label}")
}  }

scenarios LatencyProbe "latency" {
   device phone
   scenario "probe" {
      render ()
}  }
`

const latencyProjects: readonly LatencyProject[] = [
  {
    appName: 'LatencySmoke',
    edit: 'editor',
    frameSelector: '.studio-preview-cell iframe',
    initialText: 'Edit0x',
    name: 'one-file app',
    async setup(projectRoot) {
      await FS.writeText(
        FS.resolvePath('Project.tao', projectRoot),
        'project { id "tao-studio-latency" name "Latency" }\n',
      )
      const sourcePath = FS.resolvePath('LatencySmoke.tao', projectRoot)
      await FS.writeText(sourcePath, latencySource('Edit0x'))
      return sourcePath
    },
    sourceFor: latencySource,
  },
  {
    appName: 'HNReaderStub',
    edit: 'disk',
    frameSelector: '.studio-preview-cell iframe[title*="LatencyProbe"]',
    initialText: 'Edit0x',
    name: 'HNReader',
    async setup(projectRoot) {
      for (const name of await FS.listDir(hnreaderRoot)) {
        if (/\.(tao|ts)$/.test(name) && await FS.isFile(FS.resolvePath(name, hnreaderRoot))) {
          await FS.copyFile(FS.resolvePath(name, hnreaderRoot), FS.resolvePath(name, projectRoot))
        }
      }
      await FS.copyDirectory(FS.resolvePath('@model', hnreaderRoot), FS.resolvePath('@model', projectRoot))
      // Studio lists scenarios for `@/studio` views without the app importing them.
      const sourcePath = FS.resolvePath('@/studio/LatencyProbe.tao', projectRoot)
      await FS.mkdir(FS.dirname(sourcePath))
      await FS.writeText(sourcePath, hnreaderProbeSource('Edit0x'))
      return sourcePath
    },
    sourceFor: hnreaderProbeSource,
  },
]

for (const project of latencyProjects) {
  for (const mode of ['on', 'off'] as const) {
    Test(`Studio publication-${mode} edit-to-paint latency for ${project.name}`, async () => {
      await measureLatency(mode, project)
    }, 300_000)
  }
}

async function measureLatency(mode: 'on' | 'off', project: LatencyProject): Promise<void> {
  const projectRoot = await mkTestDir(`tao-studio-latency-${mode}-`)
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    const sourcePath = await project.setup(projectRoot)
    studio = await startStudioSmokeLaunch({ appName: project.appName, previewPublication: mode, projectRoot })
    Assert.defined(studio.readiness.previewUrl, 'the browser Studio launch advertises its Metro preview URL')
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.addInitScript(probeScript)
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    const frame = JSON.stringify(project.frameSelector)
    // A cell off-screen keeps `about:blank` until it scrolls into view, and a cell can remount
    // between two reads, so its URL is read in the same poll that sees it loaded. Every cell
    // shares the Metro origin; the chosen cell's own URL names exactly one frame.
    const previewUrl = await Time.pollUntil(
      async () =>
        await browser!.evaluate<string>(`(() => {
            const cell = document.querySelector(${frame})
            if (!(cell instanceof HTMLIFrameElement)) return ''
            cell.scrollIntoView({ block: 'nearest' })
            return cell.src.startsWith('http') ? cell.src : ''
          })()`) || undefined,
      { intervalMs: 100, timeoutMs: 60_000 },
    )
    Assert.defined(previewUrl, `the ${project.name} preview cell loads its Metro URL`)
    await browser.waitForInFrame(
      previewUrl,
      `document.body?.textContent?.includes(${JSON.stringify(project.initialText)}) === true`,
      { timeoutMs: 60_000 },
    )
    const generatedRoot = await generatedRootFor(projectRoot)
    await browser.click('[data-preset="design"]')
    await browser.waitFor(`document.querySelector('.cm-content') !== null`)
    await browser.evaluate(`(() => {
        const now = () => performance.timeOrigin + performance.now()
        window.__taoLatencyLoads = 0
        document.querySelector(${frame}).addEventListener('load', () => { window.__taoLatencyLoads += 1 })
        window.addEventListener('keydown', event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') window.__taoLatencySaveAt = now()
        }, true)
        return true
      })()`)

    const samples: EditSample[] = []
    for (let edit = 1; edit <= EDITS_PER_MODE; edit += 1) {
      const marker = `Edit${edit}x`
      await browser.evaluateInFrame(previewUrl, `window.__taoLatencyProbe.watch.push(${JSON.stringify(marker)})`, {
        world: 'page',
      })
      let diskSaveAt: number | undefined
      if (project.edit === 'editor') {
        await browser.click('.cm-content')
        await browser.pressShortcut('a')
        await browser.insertText(project.sourceFor(marker))
        await browser.pressShortcut('s')
      } else {
        // Studio makes `@/studio` files read-only when the project opens; this stands in for an
        // outside editor that saved anyway.
        await FS.chmod(sourcePath, 0o644)
        diskSaveAt = Date.now()
        await FS.writeText(sourcePath, project.sourceFor(marker))
      }
      const painted = await Time.pollUntil(
        async () =>
          await browser!.evaluateInFrame<boolean>(
            previewUrl,
            `window.__taoLatencyProbe?.painted[${JSON.stringify(marker)}] !== undefined`,
            { world: 'page' },
          ),
        { intervalMs: 50, timeoutMs: 30_000 },
      )
      if (painted !== true) {
        const state = await browser.evaluateInFrame(
          previewUrl,
          `({ probe: window.__taoLatencyProbe, href: location.href, text: document.body?.textContent?.slice(0, 400),
              visibility: document.visibilityState })`,
          { world: 'page' },
        )
        const disk = await FS.readText(sourcePath)
        const status = await browser.evaluate(`document.querySelector('.studio-status')?.textContent`)
        const diagnostics = FS.resolvePath(`latency-${marker}.json`, studio.readiness.artifactRoot)
        await FS.writeJson(diagnostics, {
          browserEvents: browser.browserEvents().slice(-40),
          disk,
          frameLoads: await browser.evaluate<number>('window.__taoLatencyLoads'),
          expected: project.sourceFor(marker),
          screenshot: await browser.captureScreenshot(`latency-${marker}`),
          state,
          status,
          text: await browser.evaluateInFrame(previewUrl, 'document.body.innerText', { world: 'page' }),
        })
        Errors.throwHostEnvironment(
          `Edit ${marker} never painted: ${
            JSON.stringify({ disk: disk === project.sourceFor(marker), diagnostics, status })
          }`,
        )
      }
      const saveAt = diskSaveAt ?? await browser.evaluate<number>('window.__taoLatencySaveAt')
      const probe = await browser.evaluateInFrame<{
        hmr: { at: number; type: string }[]
        painted: Record<string, number>
        seen: Record<string, number>
      }>(previewUrl, 'window.__taoLatencyProbe', { world: 'page' })
      samples.push({
        domAt: probe.seen[marker]!,
        edit,
        frameLoads: await browser.evaluate<number>('window.__taoLatencyLoads'),
        hmrAt: probe.hmr.find(message => message.at >= saveAt)?.at,
        mode,
        paintAt: probe.painted[marker],
        publishedAt: await newestModification(generatedRoot),
        saveAt,
        sourceWrittenAt: await FS.modifiedTimeMs(sourcePath),
      })
      await Time.sleep(500)
    }
    await reportSamples(`${project.name} publication-${mode}`, samples)
    Expect(samples.at(-1)!.frameLoads).toBe(0)
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}

async function generatedRootFor(projectRoot: string): Promise<string> {
  const artifactRoot = Repo.resolvePath('.artifacts/dev/studio-preview')
  for (const name of await FS.listDir(artifactRoot)) {
    const generatedRoot = FS.resolvePath(`${name}/_gen_tao-app`, artifactRoot)
    const publication = FS.resolvePath('TaoStudioPublication.ts', generatedRoot)
    if (name.startsWith('runtime-') && await FS.exists(publication)) {
      if ((await FS.readText(publication)).includes(projectRoot)) {
        return generatedRoot
      }
    }
  }
  Errors.throwUnexpected(`No Studio preview runtime publishes ${projectRoot}.`)
}

async function newestModification(root: string): Promise<number> {
  let newest = 0
  for await (const path of FS.walk(root)) {
    newest = Math.max(newest, await FS.modifiedTimeMs(path))
  }
  return newest
}

async function reportSamples(label: string, samples: readonly EditSample[]): Promise<void> {
  const span = (from: number | undefined, to: number | undefined) =>
    from === undefined || to === undefined ? undefined : Math.round(to - from)
  const rows = samples.map(sample => ({
    edit: sample.edit,
    frameLoads: sample.frameLoads,
    saveToSource: span(sample.saveAt, sample.sourceWrittenAt),
    sourceToPublished: span(sample.sourceWrittenAt, sample.publishedAt),
    publishedToHmr: span(sample.publishedAt, sample.hmrAt),
    hmrToDom: span(sample.hmrAt, sample.domAt),
    domToPaint: span(sample.domAt, sample.paintAt),
    total: span(sample.saveAt, sample.paintAt ?? sample.domAt),
  }))
  const warm = rows.slice(1)
  const summary = Object.fromEntries(
    (['saveToSource', 'sourceToPublished', 'publishedToHmr', 'hmrToDom', 'domToPaint', 'total'] as const).map(
      key => {
        const values = warm.map(row => row[key]).filter((value): value is number => value !== undefined)
        return [key, { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }]
      },
    ),
  )
  const slug = label.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase()
  const path = Repo.resolvePath(`.artifacts/tests/studio-smoke/preview-latency/${slug}-${Date.now()}.json`)
  await FS.writeJson(path, { label, rows, samples, summary })
  HCI.writeLine(`${label} cold ${JSON.stringify(rows[0])}`)
  HCI.writeLine(`${label} warm ${JSON.stringify(summary)}`)
  HCI.writeLine(`${label} samples: ${path}`)
}

function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  const sorted = values.toSorted((left, right) => left - right)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!)
}
