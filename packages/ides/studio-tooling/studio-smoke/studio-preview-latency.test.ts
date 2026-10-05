import { Assert, Errors, FS, HCI, Platform, ProjectIdentity, ProjectLocal, Repo, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

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

app LatencySmoke { id "tao-studio-latency" version "1.0.0" name "Latency" view MainView }

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
  loadAverage: number
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
    for (const expected of probe.watch) {
      const marker = typeof expected === 'string' ? expected : expected.marker
      const matches = typeof expected === 'string' ? text.includes(marker)
        : [...document.querySelectorAll('[data-tao-studio]')].some(node =>
          node.textContent?.includes(expected.text) && getComputedStyle(node).paddingTop === expected.padding)
      if (probe.seen[marker] === undefined && matches) {
        probe.seen[marker] = now()
        requestAnimationFrame(() => requestAnimationFrame(() => { probe.painted[marker] = now() }))
      }
    }
  }
  new MutationObserver(check).observe(document, { attributes: true, characterData: true, childList: true, subtree: true })
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
  /** Ordinary source file to open before editor saves; a one-file fixture is already open. */
  editorPath?: string
  /** A real style edit is observed through computed layout, rather than a changing text marker. */
  expectedStyle?: (edit: number, marker: string) => { marker: string; padding: string; text: string }
  /** Writes the authored project and returns the file the editor saves. */
  setup: (projectRoot: string) => Promise<string>
  /** The edited file's full source with `marker` in rendered text. */
  sourceFor: (marker: string) => string
}

const hnreaderRoot = Repo.resolvePath('Apps/HNReader')
const hnreaderDesignSource = await FS.readText(FS.resolvePath('Design.tao', hnreaderRoot))

async function copyHNReader(projectRoot: string): Promise<void> {
  await FS.mkdir(FS.resolvePath('.tao', projectRoot))
  await ProjectIdentity.ensure(projectRoot)
  for (const name of await FS.listDir(hnreaderRoot)) {
    if (/\.(tao|ts)$/.test(name) && await FS.isFile(FS.resolvePath(name, hnreaderRoot))) {
      await FS.copyFile(FS.resolvePath(name, hnreaderRoot), FS.resolvePath(name, projectRoot))
    }
  }
  await FS.copyDirectory(FS.resolvePath('@model', hnreaderRoot), FS.resolvePath('@model', projectRoot))
}

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
      await FS.mkdir(FS.resolvePath('.tao', projectRoot))
      await ProjectIdentity.ensure(projectRoot)
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
      await copyHNReader(projectRoot)
      // Studio lists scenarios for `@/studio` views without the app importing them.
      const sourcePath = FS.resolvePath('@/studio/LatencyProbe.tao', projectRoot)
      await FS.mkdir(FS.dirname(sourcePath))
      await FS.writeText(sourcePath, hnreaderProbeSource('Edit0x'))
      return sourcePath
    },
    sourceFor: hnreaderProbeSource,
  },
  {
    appName: 'HNReaderStub',
    edit: 'editor',
    editorPath: 'Design.tao',
    frameSelector: '.studio-preview-cell iframe[title*="HNReader.scenarios.tao#scenario:rows:leading"]',
    initialText: 'Show HN: A Tao reader',
    name: 'HNReader editor padding',
    expectedStyle: (edit, marker) => ({ marker, padding: `${12 + edit}px`, text: 'Show HN: A Tao reader' }),
    async setup(projectRoot) {
      await copyHNReader(projectRoot)
      return FS.resolvePath('Design.tao', projectRoot)
    },
    sourceFor: marker => {
      const edit = Number(/^Edit(\d+)/u.exec(marker)?.[1])
      Assert(Number.isInteger(edit), 'padding latency marker names its edit')
      Assert(hnreaderDesignSource.includes('storyCard [pad 12,'), 'HNReader fixture owns the measured story padding')
      return hnreaderDesignSource.replace('storyCard [pad 12,', `storyCard [pad ${12 + edit},`)
    },
  },
]

const selectedCase = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_CASE']
Assert.input(
  selectedCase === undefined || latencyProjects.some(project => project.name === selectedCase),
  'Select an existing Studio latency case.',
)
Assert.input(
  Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PERFORMANCE'] !== 'true' || selectedCase === undefined,
  'Performance qualification runs every Studio latency case.',
)
for (const project of latencyProjects.filter(project => selectedCase === undefined || project.name === selectedCase)) {
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
    await activateSmokePreviews(browser)
    // Load events do not bubble, but a capturing listener on the document sees every cell's.
    await browser.evaluate(`(() => {
        window.__taoCellLoadAt = Date.now()
        window.__taoCellLoads = []
        document.addEventListener('load', event => {
          if (!(event.target instanceof HTMLIFrameElement)) return
          window.__taoCellLoadAt = Date.now()
          window.__taoCellLoads.push({ at: window.__taoCellLoadAt, src: event.target.src, title: event.target.title })
        }, true)
        return true
      })()`)
    const frame = JSON.stringify(project.frameSelector)
    // An activated cell keeps its iframe off-screen, and a cell can remount
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
    if (project.expectedStyle !== undefined) {
      const initial = project.expectedStyle(0, 'initial')
      await browser.waitForInFrame(
        previewUrl,
        `[...document.querySelectorAll('[data-tao-studio]')].some(node =>
          node.textContent?.includes(${JSON.stringify(initial.text)}) &&
          getComputedStyle(node).paddingTop === ${JSON.stringify(initial.padding)})`,
        { timeoutMs: 60_000 },
      )
    }
    const generatedRoot = await generatedRootFor(projectRoot)
    await browser.click('[data-preset="design"]')
    await browser.waitFor(`document.querySelector('.cm-content') !== null`)
    if (project.editorPath !== undefined) {
      await browser.pressShortcut('k')
      await browser.waitFor(`document.querySelector('.studio-command-overlay')?.hidden === false
        && document.activeElement === document.querySelector('.studio-command-overlay input')`)
      await browser.insertText(project.editorPath)
      await browser.waitFor(
        `document.querySelector('.studio-command-result')?.textContent?.includes(${
          JSON.stringify(project.editorPath)
        }) === true`,
      )
      await browser.click('.studio-command-result')
      await browser.waitFor("document.querySelector('.cm-content')?.textContent?.includes('design HNDesign') === true")
    }
    // A cell that finishes loading registers with Metro's HMR server, and a registration that overlaps
    // an edit's update can leave the bundle's cells on a revision Metro deleted, so later edits never
    // arrive (see the edit failures in the Studio preview speed roadmap). The layout change above
    // brings more cells into view, and the edits start once none has loaded for a while, so they time
    // an edit rather than that race.
    const settled = await Time.pollUntil(
      async () => await browser!.evaluate<boolean>('Date.now() - window.__taoCellLoadAt > 3000') || undefined,
      { intervalMs: 250, timeoutMs: 60_000 },
    )
    Assert.defined(settled, `the ${project.name} preview cells stop loading`)
    await browser.evaluate(`(() => {
        const now = () => performance.timeOrigin + performance.now()
        window.__taoLatencyLoads = 0
        window.__taoCellLoads = []
        document.querySelector(${frame}).addEventListener('load', () => { window.__taoLatencyLoads += 1 })
        window.addEventListener('keydown', event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') window.__taoLatencySaveAt = now()
        }, true)
        return true
      })()`)

    const samples: EditSample[] = []
    for (let edit = 1; edit <= EDITS_PER_MODE; edit += 1) {
      // Each marker is longer than the last, as most real edits change a file's length and so move
      // every source range after them.
      const marker = `Edit${edit}${'x'.repeat(edit)}`
      const expected = project.expectedStyle?.(edit, marker) ?? marker
      await browser.evaluateInFrame(previewUrl, `window.__taoLatencyProbe.watch.push(${JSON.stringify(expected)})`, {
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
      // Editing while the canvas moves must not suspend and resume active HMR clients.
      if (project.name === 'HNReader') {
        await browser.evaluate(`(async () => {
          const cells = [...document.querySelectorAll('.studio-preview-cell')]
          cells[${edit} % cells.length]?.scrollIntoView({ block: 'start' })
          await new Promise(resolve => requestAnimationFrame(resolve))
          // Chrome withholds iframe paint callbacks outside the viewport. Return the measured
          // cell before waiting for its paint, after scrolling during the in-flight edit.
          document.querySelector(${frame})?.scrollIntoView({ block: 'nearest' })
        })()`)
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
        const diagnostics = FS.resolvePath(
          `latency-${project.name}-${mode}-${marker}.json`,
          studio.readiness.artifactRoot,
        )
        await FS.writeJson(diagnostics, {
          browserEvents: browser.browserEvents().slice(-40),
          cellLoads: await browser.evaluate('window.__taoCellLoads'),
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
        loadAverage: Platform.loadAverage(),
        mode,
        paintAt: probe.painted[marker],
        publishedAt: await newestModification(generatedRoot),
        saveAt,
        sourceWrittenAt: await FS.modifiedTimeMs(sourcePath),
      })
      await Time.sleep(500)
    }
    const evidence = {
      browserEvents: browser.browserEvents(),
      cellLoads: await browser.evaluate<unknown[]>('window.__taoCellLoads'),
      metroMessages: await browser.evaluateInFrame<unknown[]>(previewUrl, 'window.__taoLatencyProbe.other', {
        world: 'page',
      }),
      activatedCells: await browser.evaluate<number>(
        'document.querySelectorAll(".studio-preview-activation-toggle[aria-pressed=true]").length',
      ),
      emissionCache: studio.output().split('\n').flatMap(line => {
        const entry = /\{"type":"studio-emitted-module-cache"[^\n]*\}/u.exec(line)?.[0]
        return entry === undefined ? [] : [JSON.parse(entry) as unknown]
      }),
      pipelineProfile: studio.output().split('\n').flatMap(line => {
        const entry =
          /\{"type":"studio-(?:preview-pipeline|project-tooling|workspace|typescript-config|native-program|validator|validation-checks|host-module)-profile"[^\n]*\}/u
            .exec(line)
            ?.[0]
        return entry === undefined ? [] : [JSON.parse(entry) as unknown]
      }),
    }
    await reportSamples(`${project.name} publication-${mode}`, samples, evidence)
    Expect(samples.at(-1)!.frameLoads).toBe(0)
    Expect(evidence.cellLoads).toEqual([])
    Expect(evidence.activatedCells).toBeGreaterThan(project.name === 'HNReader' ? 1 : 0)
    Expect(JSON.stringify(evidence)).not.toContain('RevisionNotFoundError')
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}

async function generatedRootFor(projectRoot: string): Promise<string> {
  const artifactRoot = ProjectLocal.cacheResolve('studio/runtimes', projectRoot)
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

async function reportSamples(
  label: string,
  samples: readonly EditSample[],
  evidence: {
    browserEvents: ReturnType<StudioCdp['browserEvents']>
    cellLoads: unknown[]
    metroMessages: unknown[]
    activatedCells: number
    emissionCache: unknown[]
    pipelineProfile: unknown[]
  },
): Promise<void> {
  const span = (from: number | undefined, to: number | undefined) =>
    from === undefined || to === undefined ? undefined : Math.round(to - from)
  const rows = samples.map(sample => ({
    edit: sample.edit,
    frameLoads: sample.frameLoads,
    loadAverage: sample.loadAverage,
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
  const machine = {
    cpus: Platform.cpuCount(),
    loadAverageMinimum: Math.min(...samples.map(sample => sample.loadAverage)),
    loadAverageMaximum: Math.max(...samples.map(sample => sample.loadAverage)),
  }
  const report = { label, machine, rows, samples, summary, evidence }
  await FS.writeJson(path, report)
  const performanceRoot = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PERFORMANCE_ARTIFACT_ROOT']
  if (performanceRoot !== undefined) {
    await FS.mkdir(performanceRoot)
    await FS.writeJson(FS.resolvePath(`${slug}.json`, performanceRoot), report)
  }
  HCI.writeLine(`${label} cold ${JSON.stringify(rows[0])}`)
  HCI.writeLine(`${label} warm ${JSON.stringify(summary)}; machine ${JSON.stringify(machine)}`)
  HCI.writeLine(`${label} samples: ${path}`)
}

function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  const sorted = values.toSorted((left, right) => left - right)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!)
}
