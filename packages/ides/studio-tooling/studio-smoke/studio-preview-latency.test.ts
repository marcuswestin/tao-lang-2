import {
  Assert,
  Errors,
  FS,
  HCI,
  Platform,
  ProjectIdentity,
  ProjectLocal,
  Repo,
  Time,
  VerificationTimeouts,
} from '@shared'
import { Expect, mkTestDir, runCleanups, Test } from '@shared/test'
import SourceActions from '@source-actions'
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
const wholeAppProbe = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_WHOLE_APP'] === 'true'
const saveGapMs = Number(Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_SAVE_GAP_MS'] ?? 500)
Assert.input(Number.isFinite(saveGapMs) && saveGapMs >= 0, 'Diagnostic save gap is a nonnegative duration.')

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
  deliveredAt?: number
  deliveryRevision?: number
  domAt: number
  edit: number
  frameLoads: number
  hmrAt?: number
  loadAverage: number
  mode: 'on' | 'off'
  paintAt?: number
  publishedAt?: number
  saveAt: number
  sourceWrittenAt: number
}

const probeScript = `(() => {
  window.__taoLatencyPaintReports = []
  window.__taoLatencyCaptures = {}
  window.addEventListener('message', event => {
    if (!['preview-painted', 'preview-runtime-captured', 'preview-runtime-capture-failed'].includes(event.data?.type)) return
    const frame = [...document.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source)
    if (frame && new URL(frame.src).origin === event.origin) {
      if (event.data.type === 'preview-painted') window.__taoLatencyPaintReports.push(event.data)
      else window.__taoLatencyCaptures[event.data.requestId] = event.data
    }
  })
  if (!location.search.includes('taoStudioPreviewInstanceId=')) return
  const now = () => performance.timeOrigin + performance.now()
  const probe = window.__taoLatencyProbe = { deliveries: [], hmr: [], other: [], painted: {}, seen: {}, watch: [] }
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.data?.type === 'design-padding') {
      probe.deliveries.push({ at: now(), padding: event.data.padding, revision: event.data.revision })
    }
  })
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
    if (
      /\.(tao|ts)$/.test(name) && (!wholeAppProbe || !name.endsWith('.scenarios.tao'))
      && await FS.isFile(FS.resolvePath(name, hnreaderRoot))
    ) {
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

const paddingLengthProbe = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_PADDING_LENGTH'] === 'true'
const revertProbe = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_REVERT'] === 'true'
const recoveryProbe = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_RECOVERY'] === 'true'
const rapidSaveProbe = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_RAPID_SAVES'] === 'true'
const retainedStateProbe = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_RETAINED_STATE'] === 'true'
const paddingValue = (edit: number) =>
  revertProbe && edit % 2 === 0
    ? 12
    : paddingLengthProbe && edit > 0 && edit % 2 === 0
    ? 100 + edit
    : 12 + edit

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
    expectedStyle: (edit, marker) => ({ marker, padding: `${paddingValue(edit)}px`, text: 'Show HN: A Tao reader' }),
    async setup(projectRoot) {
      await copyHNReader(projectRoot)
      return FS.resolvePath('Design.tao', projectRoot)
    },
    sourceFor: marker => {
      const edit = Number(/^Edit(\d+)/u.exec(marker)?.[1])
      Assert(Number.isInteger(edit), 'padding latency marker names its edit')
      Assert(hnreaderDesignSource.includes('storyCard [pad 12,'), 'HNReader fixture owns the measured story padding')
      return hnreaderDesignSource.replace('storyCard [pad 12,', `storyCard [pad ${paddingValue(edit)},`)
    },
  },
]

const selectedMode = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_PUBLICATION'] || undefined
Assert.input(
  selectedMode === undefined || selectedMode === 'on' || selectedMode === 'off',
  'Select publication on or off for a diagnostic comparison.',
)
const selectedCase = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_CASE'] || undefined
Assert.input(
  selectedCase === undefined || latencyProjects.some(project => project.name === selectedCase),
  'Select an existing Studio latency case.',
)
Assert.input(
  Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PERFORMANCE'] !== 'true'
    || (selectedCase === undefined && selectedMode === undefined && !paddingLengthProbe
      && !revertProbe && !recoveryProbe && !rapidSaveProbe && !retainedStateProbe
      && !wholeAppProbe && saveGapMs === 500
      && Platform.runtimeProcess.env['TAO_STUDIO_DESIGN_DELIVERY'] === 'false'
      && Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_SINGLE_CELL'] !== 'true'
      && Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_ACTIVATE_DURING_OVERLAY'] !== 'true'
      && Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_REQUIRE_FULL_OVERLAP'] !== 'true'
      && Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] !== 'true'
      && Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] !== 'true'
      && (Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_NODE_ENV'] ?? 'development') === 'development'
      && Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_TWO_FILE_BURST'] !== 'true'),
  'Performance qualification runs every Studio latency case.',
)
for (const project of latencyProjects.filter(project => selectedCase === undefined || project.name === selectedCase)) {
  for (const mode of (['on', 'off'] as const).filter(mode => selectedMode === undefined || mode === selectedMode)) {
    Test(`Studio publication-${mode} edit-to-paint latency for ${project.name}`, async () => {
      await measureLatency(mode, project)
    }, 300_000)
  }
}

async function measureLatency(mode: 'on' | 'off', project: LatencyProject): Promise<void> {
  const designDeliveryProbe = mode === 'off' && project.expectedStyle !== undefined
    && Platform.runtimeProcess.env['TAO_STUDIO_DESIGN_DELIVERY'] !== 'false'
  const projectRoot = await mkTestDir(`tao-studio-latency-${mode}-`)
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  const samples: EditSample[] = []
  const traceDiagnostics = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true'
  let diagnosticPhase = 'setup'
  let diagnosticOutput = ''
  let diagnosticTimer: ReturnType<typeof setInterval> | undefined
  let diagnosticWrite: Promise<void> | undefined
  let primaryFailure: unknown
  try {
    if (traceDiagnostics) {
      // A test-process timeout bypasses catch/finally. Keep trace-only progress independently
      // so an interrupted diagnostic retains completed samples and subprocess evidence.
      const diagnosticRoot = FS.resolvePath('.artifacts/tests/studio-smoke/preview-latency', Repo.getRoot())
      await FS.mkdir(diagnosticRoot)
      const diagnosticPath = FS.resolvePath(`live-${Date.now()}`, diagnosticRoot)
      HCI.writeLine(`Studio latency live diagnostic: ${diagnosticPath}`)
      diagnosticTimer = setInterval(() => {
        if (diagnosticWrite !== undefined) {
          return
        }
        diagnosticWrite = Promise.all([
          FS.writeText(`${diagnosticPath}.log`, diagnosticOutput),
          FS.writeJson(`${diagnosticPath}.json`, {
            label: `${project.name} publication-${mode}`,
            phase: diagnosticPhase,
            capturedAt: Date.now(),
            samples: [...samples],
          }),
        ]).then(() => {}).catch(error => HCI.logProcessError('studio-latency', Errors.formatForLog(error))).finally(
          () => {
            diagnosticWrite = undefined
          },
        )
      }, 1_000)
    }
    const sourcePath = await project.setup(projectRoot)
    diagnosticPhase = 'launch'
    studio = await startStudioSmokeLaunch({
      appName: project.appName,
      previewPublication: mode,
      projectRoot,
      ...(traceDiagnostics
        ? {
          onOutput: (chunk: Buffer) => {
            diagnosticOutput += chunk.toString('utf8')
          },
        }
        : {}),
    })
    const activeStudio = studio
    diagnosticPhase = 'activate-preview'
    Assert.defined(studio.readiness.previewUrl, 'the browser Studio launch advertises its Metro preview URL')
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.addInitScript(probeScript)
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    await browser.waitFor("document.querySelector('.studio-preview-activation-toggle') !== null", {
      timeoutMs: 120_000,
    })
    const singleCell = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_SINGLE_CELL'] === 'true'
    const requestedCells = singleCell
      ? await browser.evaluate<string[]>(`(() => {
      const cell = [...document.querySelectorAll('.studio-preview-cell')].find(cell =>
        cell.querySelector('.studio-preview-cell-label')?.textContent?.includes('leading'))
      if (!(cell instanceof HTMLElement)) return []
      return [cell.dataset.taoStudioCell ?? cell.dataset.cellId]
    })()`)
      : wholeAppProbe
      ? ['whole-app']
      : undefined
    if (singleCell) {
      Expect(requestedCells?.length).toBe(1)
    }
    await activateSmokePreviews(browser, requestedCells)
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
    const frame = JSON.stringify(wholeAppProbe ? '.studio-whole-app-preview iframe' : project.frameSelector)
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
      { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity },
    )
    Assert.defined(previewUrl, `the ${project.name} preview cell loads its Metro URL`)
    await browser.waitForInFrame(
      previewUrl,
      `document.body?.textContent?.includes(${JSON.stringify(project.initialText)}) === true`,
      { timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity },
    )
    if (project.expectedStyle !== undefined) {
      const initial = project.expectedStyle(0, 'initial')
      await browser.waitForInFrame(
        previewUrl,
        `[...document.querySelectorAll('[data-tao-studio]')].some(node =>
          node.textContent?.includes(${JSON.stringify(initial.text)}) &&
          getComputedStyle(node).paddingTop === ${JSON.stringify(initial.padding)})`,
        { timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity },
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
      { intervalMs: 250, timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity },
    )
    Assert.defined(settled, `the ${project.name} preview cells stop loading`)
    const captureRetainedState = async (requestId: string): Promise<unknown[]> => {
      await browser!.evaluate(`(async () => {
        const protocol = await (await fetch(${
        JSON.stringify(activeStudio.readiness.sessionUrl)
      } + '/api/protocol')).json()
        const target = document.querySelector(${frame})
        target.contentWindow.postMessage({
          channel: 'tao-studio', protocolVersion: 1, type: 'capture-runtime', requestId: ${JSON.stringify(requestId)},
          identity: { ...protocol.identity, previewInstanceId: new URL(target.src).searchParams.get('taoStudioPreviewInstanceId') }
        }, new URL(target.src).origin)
      })()`)
      await browser!.waitFor(`window.__taoLatencyCaptures[${JSON.stringify(requestId)}] !== undefined`, {
        timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity,
      })
      const reply = await browser!.evaluate<{ type: string; error?: unknown; domains?: unknown[] }>(`(() => {
        const reply = window.__taoLatencyCaptures[${JSON.stringify(requestId)}]
        return { type: reply.type, error: reply.error,
          domains: reply.capture?.domains.filter(item => ['data', 'navigation', 'persisted-state'].includes(item.domain)) }
      })()`)
      if (reply.type !== 'preview-runtime-captured' || reply.domains === undefined) {
        Errors.throwHostEnvironment(`The preview could not capture retained state: ${Errors.messageOf(reply.error)}`)
      }
      return reply.domains
    }
    const retainedBefore = retainedStateProbe ? await captureRetainedState('speed-retained-before') : undefined
    if (retainedBefore !== undefined) {
      Expect(retainedBefore.length).toBeGreaterThan(0)
    }
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

    if (recoveryProbe) {
      Assert.input(
        project.name === 'HNReader editor padding',
        'Recovery probe measures the visible HNReader design edit.',
      )
      await browser.click('.cm-content')
      await browser.pressShortcut('a')
      await browser.insertText(hnreaderDesignSource + '\nview Broken( {')
      await browser.pressShortcut('s')
      await browser.waitFor(`document.querySelector('.studio-status')?.dataset.state === 'error'`, {
        timeoutMs: 30_000,
      })
      Expect(await FS.readText(sourcePath)).toBe(hnreaderDesignSource)
      // Syntax admission rejects before writing; an unknown style input exercises compile failure.
      await browser.click('.cm-content')
      await browser.pressShortcut('a')
      await browser.insertText(
        'use NoSuchSpeedDeclaration from ./\n' + hnreaderDesignSource,
      )
      await browser.pressShortcut('s')
      await browser.waitFor(
        `(async () => {
        const protocol = await (await fetch(${JSON.stringify(studio.readiness.sessionUrl)} + '/api/protocol')).json()
        return protocol.compile.status === 'error'
      })()`,
        { timeoutMs: 30_000 },
      )
      const initial = project.expectedStyle!(0, 'initial')
      Expect(
        await browser.evaluateInFrame<boolean>(
          previewUrl,
          `[...document.querySelectorAll('[data-tao-studio]')].some(node =>
          node.textContent?.includes(${JSON.stringify(initial.text)}) &&
          getComputedStyle(node).paddingTop === ${JSON.stringify(initial.padding)})`,
        ),
      ).toBe(true)
    }
    let lastPaintedRevision = 0
    let finalEdit = EDITS_PER_MODE
    for (let edit = 1; edit <= EDITS_PER_MODE; edit += 1) {
      diagnosticPhase = `edit-${edit}-prepare`
      // Each marker is longer than the last, as most real edits change a file's length and so move
      // every source range after them.
      const marker = `Edit${edit}${'x'.repeat(edit)}`
      const expected = project.expectedStyle?.(edit, marker) ?? marker
      await browser.evaluateInFrame(previewUrl, `window.__taoLatencyProbe.watch.push(${JSON.stringify(expected)})`, {
        world: 'page',
      })
      let diskSaveAt: number | undefined
      if (edit === 4 && Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_REQUIRE_FULL_OVERLAP'] === 'true') {
        diagnosticPhase = `edit-${edit}-await-authoritative-start`
        Assert.input(project.name === 'HNReader editor padding', 'Full-work overlap uses the HNReader design fixture.')
        Assert.input(
          Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true',
          'Full-work overlap requires tracing.',
        )
        const triggerAt = Date.now()
        const companionPath = FS.resolvePath('Feed.tao', projectRoot)
        await FS.writeText(companionPath, await FS.readText(companionPath) + '\n// Full-work overlap probe\n')
        const started = await Time.pollUntil(async () => {
          return activeStudio.output().split('\n').some(line => {
            const match = /\{"type":"studio-preview-trace"[^\n]*\}/u.exec(line)?.[0]
            if (match === undefined) {
              return false
            }
            const entry = JSON.parse(match) as { at: number; event: string; previewFirst?: boolean }
            return entry.at >= triggerAt && entry.event === 'attempt-start' && entry.previewFirst === false
          }) || undefined
        }, { intervalMs: 20, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
        Assert.defined(started, 'a real authoritative attempt begins before the overlapping editor save')
      }
      diagnosticPhase = `edit-${edit}-save`
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
      diagnosticPhase = `edit-${edit}-await-paint`
      const painted = await Time.pollUntil(
        async () =>
          await browser!.evaluateInFrame<boolean>(
            previewUrl,
            `window.__taoLatencyProbe?.painted[${JSON.stringify(marker)}] !== undefined`,
            { world: 'page' },
          ),
        { intervalMs: 50, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
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
        deliveries: { at: number; padding: number; revision: number }[]
        hmr: { at: number; type: string }[]
        painted: Record<string, number>
        seen: Record<string, number>
      }>(previewUrl, 'window.__taoLatencyProbe', { world: 'page' })
      const delivery = probe.deliveries.find(message => message.at >= saveAt && message.at <= probe.seen[marker]!)
      if (delivery !== undefined) {
        // The layout probe and the runtime acknowledgement use independent animation-frame
        // callbacks. Wait for that receipt without changing the already captured paint time.
        await browser.waitFor(
          `window.__taoLatencyPaintReports.some(message =>
            message.paintRevision === ${JSON.stringify(delivery.revision)}
            && message.identity.previewInstanceId === ${
            JSON.stringify(new URL(previewUrl).searchParams.get('taoStudioPreviewInstanceId'))
          })`,
          { timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity },
        )
      }
      const deliveryAccepted = delivery !== undefined && await browser.evaluate<boolean>(
        `window.__taoLatencyPaintReports.some(message => message.painted === true
          && message.paintRevision === ${JSON.stringify(delivery?.revision)}
          && message.identity.previewInstanceId === ${
          JSON.stringify(new URL(previewUrl).searchParams.get('taoStudioPreviewInstanceId'))
        })`,
      )
      samples.push({
        deliveredAt: deliveryAccepted ? delivery?.at : undefined,
        deliveryRevision: deliveryAccepted ? delivery?.revision : undefined,
        domAt: probe.seen[marker]!,
        edit,
        frameLoads: await browser.evaluate<number>('window.__taoLatencyLoads'),
        hmrAt: probe.hmr.find(message => message.at >= saveAt)?.at,
        loadAverage: Platform.loadAverage(),
        mode,
        paintAt: probe.painted[marker],
        publishedAt: deliveryAccepted
          ? undefined
          : await newestModification(generatedRoot),
        saveAt,
        sourceWrittenAt: await FS.modifiedTimeMs(sourcePath),
      })
      diagnosticPhase = `edit-${edit}-await-completion`
      if (Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_FIRST'] !== 'false') {
        await browser.waitFor(
          `(async () => {
          const protocol = await (await fetch(${JSON.stringify(studio.readiness.sessionUrl)} + '/api/protocol')).json()
          return protocol.compile.status === 'compiled'
        })()`,
          { timeoutMs: 30_000 },
        )
        const paintSignal = await browser.evaluate<{ revision: number }>(`(async () => {
          const base = ${JSON.stringify(studio.readiness.sessionUrl)}
          const protocol = await (await fetch(base + '/api/protocol')).json()
          const revision = ${JSON.stringify(designDeliveryProbe)}
            ? protocol.compile.compileRevision : (protocol.compile.publishedRevision ?? protocol.compile.compileRevision)
          return { revision }
        })()`)
        lastPaintedRevision = paintSignal.revision
      }
      await Time.sleep(saveGapMs)
    }
    diagnosticPhase = 'supplemental-and-final-parity'
    if (rapidSaveProbe) {
      Assert.input(
        project.edit === 'editor' && project.expectedStyle !== undefined,
        'Rapid saves use the design editor.',
      )
      finalEdit += 4
      const marker = `Edit${finalEdit}rapid`
      await browser.evaluateInFrame(
        previewUrl,
        `window.__taoLatencyProbe.watch.push(${JSON.stringify(project.expectedStyle(finalEdit, marker))})`,
        { world: 'page' },
      )
      // A revert can already be visible before its queued write runs. Observe actual save responses
      // so a matching old paint or source version cannot stand in for the final requested save.
      await browser.evaluate(`(() => {
        window.__taoRapidSaveResults = []
        window.__taoRapidOriginalFetch = window.fetch
        window.fetch = async (...args) => {
          const response = await window.__taoRapidOriginalFetch(...args)
          if (String(args[0]).endsWith('/api/file/draft')) {
            window.__taoRapidSaveResults.push(await response.clone().json())
          }
          return response
        }
      })()`)
      for (let edit = EDITS_PER_MODE + 1; edit <= finalEdit; edit += 1) {
        await browser.click('.cm-content')
        await browser.pressShortcut('a')
        await browser.insertText(project.sourceFor(`Edit${edit}rapid`))
        await browser.pressShortcut('s')
      }
      await browser.waitFor('window.__taoRapidSaveResults.length === 4', { timeoutMs: 30_000 })
      const rapidResults = await browser.evaluate<{ saved: boolean; content: string }[]>(`(() => {
        window.fetch = window.__taoRapidOriginalFetch
        return window.__taoRapidSaveResults.map(result => ({ saved: result.saved, content: result.file.content }))
      })()`)
      Expect(rapidResults.map(result => result.saved)).toEqual([true, true, true, true])
      Expect(rapidResults.map(result => result.content)).toEqual(
        Array.from({ length: 4 }, (_, index) => project.sourceFor(`Edit${EDITS_PER_MODE + 1 + index}rapid`)),
      )
      const rapidPaint = await Time.pollUntil(async () =>
        await browser!.evaluateInFrame<boolean>(
          previewUrl,
          `window.__taoLatencyProbe?.painted[${JSON.stringify(marker)}] !== undefined`,
          { world: 'page' },
        ) || undefined, { intervalMs: 50, timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity })
      Assert.defined(rapidPaint, 'the final rapid editor save reaches computed padding and paint')
      Expect(await FS.readText(sourcePath)).toBe(project.sourceFor(marker))
      Expect(await browser.evaluate<number>('window.__taoLatencyLoads')).toBe(0)
    }
    const activateDuringOverlay = Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_ACTIVATE_DURING_OVERLAY'] === 'true'
    if (activateDuringOverlay) {
      Assert.input(
        singleCell && project.expectedStyle !== undefined,
        'Overlay activation probe requires one design cell.',
      )
      const nextCell = await browser.evaluate<{ id: string; selector: string }>(`(() => {
        const cell = [...document.querySelectorAll('.studio-preview-cell')].find(cell =>
          cell.querySelector('.studio-preview-cell-label')?.textContent?.includes('wrapping'))
        return { id: cell.dataset.taoStudioCell ?? cell.dataset.cellId, selector: '.studio-preview-cell[data-tao-studio-cell="' + (cell.dataset.taoStudioCell ?? cell.dataset.cellId) + '"] iframe' }
      })()`)
      await activateSmokePreviews(browser, [nextCell.id])
      const freshUrl = await Time.pollUntil(async () =>
        await browser!.evaluate<string>(
          `document.querySelector(${JSON.stringify(nextCell.selector)})?.src ?? ''`,
        ) || undefined, { intervalMs: 50, timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity })
      Assert.defined(freshUrl, 'newly activated design preview receives its authoritative URL')
      const finalStyle = project.expectedStyle(finalEdit, 'final')
      await browser.waitForInFrame(
        freshUrl,
        `[...document.querySelectorAll('[data-tao-studio]')].some(node =>
        node.textContent?.includes(${JSON.stringify('A very long headline about local-first sync')}) &&
        getComputedStyle(node).paddingTop === ${JSON.stringify(finalStyle.padding)})`,
        { timeoutMs: VerificationTimeouts.resolve(60_000) ?? Infinity },
      )
      Expect(await browser.evaluate<number>('window.__taoLatencyLoads')).toBe(0)
    }
    if (lastPaintedRevision > 0) {
      const lastDeliveryRevision = Math.max(0, ...samples.map(sample => sample.deliveryRevision ?? 0))
      const finalSourcePath = FS.relativePath(projectRoot, sourcePath)
      const finalSourceVersion = await browser.evaluate<string>(`(async () => {
        const protocol = await (await fetch(${JSON.stringify(studio.readiness.sessionUrl)} + '/api/protocol')).json()
        return protocol.files.find(file => file.path === ${JSON.stringify(finalSourcePath)}).sourceVersion
      })()`)
      await browser.waitFor(
        `(async () => {
        const protocol = await (await fetch(${JSON.stringify(studio.readiness.sessionUrl)} + '/api/protocol')).json()
        return protocol.compile.compileRevision >= ${lastPaintedRevision}
          && protocol.compile.status === 'compiled'
          && (${lastDeliveryRevision} === 0 || (
            protocol.compile.compileRevision > ${lastDeliveryRevision}
            && protocol.previewManifest.compileRevision > ${lastDeliveryRevision}))
          && protocol.previewManifest.sourceVersions[${JSON.stringify(sourcePath)}] === ${
          JSON.stringify(finalSourceVersion)
        }
      })()`,
        { timeoutMs: 30_000 },
      )
      const finalPadding = project.expectedStyle?.(finalEdit, 'final')
      if (finalPadding !== undefined) {
        const retained = await browser.evaluateInFrame<boolean>(
          previewUrl,
          `[...document.querySelectorAll('[data-tao-studio]')].some(node => node.textContent?.includes(${
            JSON.stringify(finalPadding.text)
          }) && getComputedStyle(node).paddingTop === ${JSON.stringify(finalPadding.padding)})`,
          { world: 'page' },
        )
        Expect(retained).toBe(true)
      }
    }
    if (Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_TWO_FILE_BURST'] === 'true') {
      Assert.input(project.name === 'HNReader editor padding', 'Two-file diagnostic uses the HNReader design fixture.')
      const burst = await browser.evaluate<{ saved: boolean[]; sourceVersion: string }>(`(async () => {
        const base = ${JSON.stringify(studio.readiness.sessionUrl)}
        const read = async path => await (await fetch(base + '/api/file?path=' + encodeURIComponent(path))).json()
        const [design, feed] = await Promise.all([read('Design.tao'), read('Feed.tao')])
        const write = async (file, content, id) => await (await fetch(base + '/api/file/draft', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: file.path, sourceVersion: file.sourceVersion, content, writeId: id })
        })).json()
        const results = await Promise.all([
          write(design, ${JSON.stringify(project.sourceFor('Edit9x'))}, 'speed-burst-design'),
          write(feed, feed.content + '\\n// Speed burst companion input\\n', 'speed-burst-feed')
        ])
        const current = await read('Design.tao')
        const following = await write(current, ${JSON.stringify(project.sourceFor('Edit10x'))}, 'speed-burst-following')
        const final = await read('Design.tao')
        return { saved: [...results, following].map(result => result.saved), sourceVersion: final.sourceVersion }
      })()`)
      Expect(burst.saved).toEqual([true, true, true])
      const final = project.expectedStyle!(10, 'burst-final')
      await browser.waitForInFrame(
        previewUrl,
        `[...document.querySelectorAll('[data-tao-studio]')].some(node =>
        node.textContent?.includes(${JSON.stringify(final.text)}) && getComputedStyle(node).paddingTop === ${
          JSON.stringify(final.padding)
        })`,
      )
      await browser.waitFor(
        `(async () => {
        const protocol = await (await fetch(${JSON.stringify(studio.readiness.sessionUrl)} + '/api/protocol')).json()
        return protocol.compile.status === 'compiled'
          && protocol.previewManifest.sourceVersions[${JSON.stringify(sourcePath)}] === ${
          JSON.stringify(burst.sourceVersion)
        }
      })()`,
        { timeoutMs: 30_000 },
      )
      Expect(await FS.readText(FS.resolvePath('Feed.tao', projectRoot))).toContain('Speed burst companion input')
    }
    const previewTrace = studio.output().split('\n').flatMap(line => {
      const entry = /\{"type":"studio-(?:preview|save)-trace"[^\n]*\}/u.exec(line)?.[0]
      return entry === undefined ? [] : [JSON.parse(entry) as SaveTraceEvent]
    })
    const authoritative = await browser.evaluate<{
      completion: { status: string }
      manifest: { compileRevision: number; sourceVersions: Record<string, string> }
    }>(`(async () => {
      const protocol = await (await fetch(${JSON.stringify(studio.readiness.sessionUrl)} + '/api/protocol')).json()
      return { completion: protocol.compile, manifest: {
        compileRevision: protocol.previewManifest.compileRevision,
        sourceVersions: protocol.previewManifest.sourceVersions,
      } }
    })()`)
    const finalSource = { path: sourcePath, version: SourceActions.studioSourceVersion(await FS.readText(sourcePath)) }
    Expect(authoritative.completion.status).toBe('compiled')
    Expect(authoritative.manifest.sourceVersions[sourcePath]).toBe(finalSource.version)
    const retainedAfter = retainedStateProbe ? await captureRetainedState('speed-retained-after') : undefined
    if (retainedAfter !== undefined) {
      Expect(retainedAfter).toEqual(retainedBefore)
    }
    const evidence = {
      screenshot: await browser.captureScreenshot(`latency-${project.name.replaceAll(' ', '-')}-${mode}-final`),
      authoritativeCompletion: authoritative.completion,
      authoritativeManifest: authoritative.manifest,
      finalSource,
      retainedState: retainedBefore === undefined ? undefined : { before: retainedBefore, after: retainedAfter },
      rapidSaves: rapidSaveProbe ? { finalEdit, finalSource } : undefined,
      runtimeSettings: await browser.evaluateInFrame<unknown>(
        previewUrl,
        "({ development: typeof __DEV__ !== 'undefined' ? __DEV__ : null, scripts: [...document.scripts].map(script => script.src).filter(Boolean) })",
        { world: 'page' },
      ),
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
      previewTrace,
      saveTimeline: samples.map(sample => saveTimeline(sample, previewTrace)),
      pipelineProfile: studio.output().split('\n').flatMap(line => {
        const entry =
          /\{"type":"studio-(?:preview-pipeline|compiler|runtime|project-tooling|workspace|typescript-config|native-program|validator|validation-checks|host-module)-profile"[^\n]*\}/u
            .exec(line)
            ?.[0]
        return entry === undefined ? [] : [JSON.parse(entry) as unknown]
      }),
    }
    await reportSamples(`${project.name} publication-${mode}`, samples, evidence)
    if (Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_REQUIRE_FULL_OVERLAP'] === 'true') {
      Assert.input(
        Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true',
        'Full-overlap proof requires tracing.',
      )
      const fullAttempts = previewTrace.filter(event => event.event === 'attempt-start' && event.previewFirst === false)
      const overlapping = samples.filter(sample =>
        fullAttempts.some(attempt => {
          const completed = previewTrace.find(event =>
            (event.event === 'published' || event.event === 'attempt-failed') && event.revision === attempt.revision
          )
          return attempt.at <= sample.saveAt && completed !== undefined && completed.at > sample.saveAt
        })
      )
      Expect(overlapping.length).toBeGreaterThan(0)
      HCI.writeLine(`Saves during authoritative work: ${overlapping.map(sample => sample.edit).join(', ')}`)
    }
    if (activateDuringOverlay && Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true') {
      Expect(
        evidence.previewTrace.some(event =>
          typeof event === 'object' && event !== null && 'event' in event
          && event.event === 'overlay-publication-barrier'
        ),
      ).toBe(true)
    }
    if (
      Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_BROWSER_SCHEDULER'] === 'true'
      && Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true'
    ) {
      Expect(evidence.previewTrace.some(event =>
        typeof event === 'object' && event !== null
        && 'event' in event && event.event === 'fast-paint-observed'
      )).toBe(true)
    }
    if (
      designDeliveryProbe
      && Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_TWO_FILE_BURST'] !== 'true'
    ) {
      const deliveries = evidence.previewTrace.filter(event =>
        typeof event === 'object' && event !== null && 'event' in event && event.event === 'design-delivered'
        && event.at >= samples[0]!.saveAt && event.at <= samples.at(-1)!.paintAt!
      ).length
      if (saveGapMs >= 1_000 || Platform.runtimeProcess.env['TAO_STUDIO_LATENCY_REQUIRE_FULL_OVERLAP'] === 'true') {
        // Full work may consume a later source before its queued fast request. Measure that race
        // without demanding every update use the diagnostic overlay.
        if (Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true') {
          Expect(deliveries).toBeGreaterThan(0)
        }
      } else {
        if (Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_TRACE'] === 'true') {
          Expect(deliveries).toBe(EDITS_PER_MODE - (recoveryProbe ? 1 : 0))
        }
        Expect(
          samples.slice(recoveryProbe ? 1 : 0).every(sample =>
            sample.hmrAt === undefined
          ),
        ).toBe(true)
      }
    }
    Expect(samples.at(-1)!.frameLoads).toBe(0)
    if (!activateDuringOverlay) {
      Expect(evidence.cellLoads).toEqual([])
    }
    Expect(evidence.activatedCells).toBeGreaterThan(project.name === 'HNReader' ? 1 : 0)
    Expect(JSON.stringify(evidence)).not.toContain('RevisionNotFoundError')
  } catch (error) {
    primaryFailure = error
    diagnosticPhase = 'failed'
    if (studio !== undefined) {
      const failureRoot = FS.resolvePath('.artifacts/tests/studio-smoke/preview-latency', Repo.getRoot())
      await FS.mkdir(failureRoot)
      const failure = FS.resolvePath(`failed-${Date.now()}`, failureRoot)
      const log = `${failure}.log`
      await FS.writeText(log, studio.output())
      await FS.writeJson(`${failure}.json`, {
        label: `${project.name} publication-${mode}`,
        error: Errors.messageOf(error),
        samples,
        browserEvents: browser?.browserEvents(),
        screenshot: await browser?.captureScreenshot('latency-failed').catch(() => undefined),
      })
      HCI.writeLine(`Studio latency failure subprocess log: ${log}`)
      HCI.writeLine(`Studio latency failure samples: ${failure}.json`)
    }
    throw error
  } finally {
    if (diagnosticTimer !== undefined) {
      clearInterval(diagnosticTimer)
    }
    await runCleanups(primaryFailure, [
      { label: 'diagnostic write', run: async () => await diagnosticWrite },
      { label: 'browser', run: async () => await browser?.close() },
      { label: 'Studio', run: async () => await studio?.stop() },
      { label: 'project', run: async () => await FS.remove(projectRoot) },
    ], { channel: 'studio-latency-cleanup', subject: 'Studio latency' })
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
    screenshot: string
    authoritativeCompletion: unknown
    authoritativeManifest: unknown
    finalSource: unknown
    retainedState?: unknown
    rapidSaves?: unknown
    runtimeSettings: unknown
    browserEvents: ReturnType<StudioCdp['browserEvents']>
    cellLoads: unknown[]
    metroMessages: unknown[]
    activatedCells: number
    emissionCache: unknown[]
    previewTrace: unknown[]
    pipelineProfile: unknown[]
    saveTimeline: unknown[]
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
    sourceToDelivery: span(sample.sourceWrittenAt, sample.deliveredAt),
    deliveryRevision: sample.deliveryRevision,
    deliveryToDom: span(sample.deliveredAt, sample.domAt),
    sourceToPaint: span(sample.sourceWrittenAt, sample.paintAt),
    publishedToHmr: span(sample.publishedAt, sample.hmrAt),
    hmrToDom: span(sample.hmrAt, sample.domAt),
    domToPaint: span(sample.domAt, sample.paintAt),
    total: span(sample.saveAt, sample.paintAt ?? sample.domAt),
  }))
  const warm = rows.slice(1)
  const summary = Object.fromEntries(
    ([
      'saveToSource',
      'sourceToPublished',
      'sourceToDelivery',
      'deliveryToDom',
      'sourceToPaint',
      'publishedToHmr',
      'hmrToDom',
      'domToPaint',
      'total',
    ] as const).map(
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

/** Joins lightweight server events to one browser save, without guessing from generated mtimes. */
type SaveTraceEvent = {
  at: number
  event: string
  writeId?: string
  sourceVersion?: string
  revision?: number
  publishedRevision?: number
  sourceVersions?: Record<string, string>
  previewFirst?: boolean
  changes?: readonly { sourceVersion: string }[]
}
function saveTimeline(sample: EditSample, events: readonly SaveTraceEvent[]): unknown {
  const write = events.find(event =>
    event.event === 'source-written' && event.at >= sample.saveAt && event.at <= sample.domAt
  )
  const arrival = events.find(event => event.event === 'request-arrival' && event.writeId === write?.writeId)
  const response = events.find(event => event.event === 'save-response' && event.writeId === write?.writeId)
  const attempt = events.find(event =>
    event.event === 'attempt-start' && event.at >= sample.saveAt
    && event.changes?.some(change => change.sourceVersion === write?.sourceVersion)
  )
  const publication = events.find(event =>
    (event.event === 'published' || event.event === 'design-delivered')
    && event.at >= (write?.at ?? sample.saveAt) && event.at <= sample.domAt
    && Object.values(event.sourceVersions ?? {}).includes(write?.sourceVersion ?? '')
  )
  return {
    edit: sample.edit,
    sourceVersion: write?.sourceVersion,
    writeId: write?.writeId,
    keypressAt: sample.saveAt,
    requestAt: arrival?.at,
    sourceWrittenAt: write?.at,
    attemptAt: attempt?.at,
    publicationAt: publication?.at,
    publicationRevision: publication?.publishedRevision,
    compileRevision: publication?.revision,
    saveResponseAt: response?.at,
    metroAt: sample.hmrAt,
    domAt: sample.domAt,
    paintAt: sample.paintAt,
  }
}
