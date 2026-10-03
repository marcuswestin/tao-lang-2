import Compiler from '@compiler'
import { Workspace } from '@compiler/workspace'
import { CLI, Errors, FS, HCI, Platform, ProjectLocal, Repo, Time } from '@shared'
import { StudioCdp, type StudioCdpRendererFingerprint } from './StudioCdp'
import { type ReviewBrowser, StudioReview } from './StudioReview'
import { type StartedStudioSmokeLaunch, startStudioSmokeLaunch } from './StudioSmokeLaunch'

/**
 * QaScreenshots captures every Studio scenario of every app in a project across a device × appearance
 * matrix into an append-only store: one directory per run, `runs/<UTC time>-<unique id>/`, holding `qa-run.json`
 * and a `screenshots/` directory of PNGs named `<App>_<Subject>_<group>-<entry>_<device>-<appearance>.png`,
 * plus a generated, ignored `index.html` timeline. Two runs never write the same tracked file, so
 * stores kept in Git merge without conflicts, and Git keeps a screenshot that reproduces earlier
 * pixels only once.
 */

// The scenario `device` presets' default sizes, from `packages/compiler/compiler-src/studio-preview-manifest.ts`.
const qaDevices = {
  laptop: { height: 900, width: 1440 },
  phone: { height: 844, width: 390 },
  tablet: { height: 1024, width: 768 },
} as const

type QaDevice = keyof typeof qaDevices
type QaAppearance = 'dark' | 'light'

// Headless Chrome's default window is smaller than a tablet or laptop cell, and a cell captured
// beyond the viewport is rastered afresh for each shot, antialiasing edges differently between two
// captures of the same settled frame. A window that holds every preset keeps each capture on screen;
// the margin leaves room for the page's scrollbars.
const qaCaptureViewport = {
  height: Math.max(...Object.values(qaDevices).map(size => size.height)) + 64,
  width: Math.max(...Object.values(qaDevices).map(size => size.width)) + 64,
} as const

const qaDeviceOrder: readonly QaDevice[] = ['phone', 'tablet', 'laptop']
const qaAppearanceOrder: readonly QaAppearance[] = ['light', 'dark']
const qaRunManifestVersion = 2 as const
const qaRunManifestName = 'qa-run.json'

/** QaScenario is a scenario's source identity: its file, `scenarios` group and entry, and subject. */
type QaScenario = {
  entry: string
  group: string
  source: string
  subject: string
  subjectKind: 'app' | 'view'
}

/**
 * QaSelector picks scenarios, spelled `[<file>.tao:]<name>[/<name>[/<name>]]`: one name is a subject
 * or a group, two are a group and entry or a subject and group, and three are subject, group, and
 * entry. The file prefix, a project-relative path or a file name, narrows any of them.
 */
type QaSelector = { file?: string; names: readonly string[]; text: string }

/**
 * QaShot is one screenshot, compared with the latest earlier capture of the same name. A Tao app's
 * shot names its scenario; one of Studio's own names the Studio state it shows.
 */
type QaShot = {
  app: string
  appearance: QaAppearance
  change?: 'changed' | 'new' | 'unchanged'
  device: QaDevice
  error?: string
  name: string
  scenario?: QaScenario
  sha256?: string
  status: 'captured' | 'failed'
  studioState?: string
}

/**
 * Studio's own shot list: stable keys naming how to reach each state from a freshly opened session
 * page. Studio is captured at `laptop` only, its chrome is dark-only, and the appearance pass sets its
 * preview cells' scheme, so its light and dark shots differ in the previews alone.
 */
const studioStates: readonly { key: string; preset: 'code' | 'design' | 'draw' | 'run' }[] = [
  { key: 'run', preset: 'run' },
  { key: 'design', preset: 'design' },
  { key: 'code', preset: 'code' },
  { key: 'draw', preset: 'draw' },
]
const studioApp = 'Studio'
const studioDevice: QaDevice = 'laptop'
// Captures after the first before a Studio state that never repeats itself is reported unstable.
const studioStableAttempts = 4

type QaRunManifest = {
  appearances: readonly QaAppearance[]
  apps: readonly string[]
  createdAt: string
  devices: readonly QaDevice[]
  note?: string
  project: string
  renderer: StudioCdpRendererFingerprint
  runId: string
  selection?: readonly string[]
  shots: readonly QaShot[]
  source: { branch: string; commit: string; dirty: boolean; subject: string }
  version: typeof qaRunManifestVersion
}

type QaScreenshotOptions = {
  appearances?: readonly string[]
  apps?: readonly string[]
  dest: string
  devices?: readonly string[]
  note?: string
  scenarios?: readonly string[]
  studio?: boolean
}

type QaScreenshotResult = {
  captured: number
  changed: number
  failed: number
  new: number
  runPath: string
  timelinePath: string
}

type QaSession = { artifactRoot: string; browser: StudioCdp; sessionUrl: string }

/** QaCapture is what one app's capture needs from the run. */
type QaCapture = {
  appearances: readonly QaAppearance[]
  devices: readonly QaDevice[]
  matched: Set<QaSelector>
  previous: ReadonlyMap<string, string>
  projectRoot: string
  runRoot: string
  scenarios: QaScenario[]
  selectors: readonly QaSelector[]
  shots: QaShot[]
}

/**
 * runQaScreenshots captures one run into the store at `options.dest` and regenerates its timeline.
 * Studio previews one app per session, so each app gets its own launch. The first launch opens the
 * first requested app, or Studio's default, and captures the view scenarios with its own; without
 * `--app`, only the other apps that some selected scenario runs are launched after it. A run that
 * fails leaves nothing in the store.
 */
export async function runQaScreenshots(projectPath: string, options: QaScreenshotOptions): Promise<QaScreenshotResult> {
  const projectRoot = FS.resolvePath(projectPath)
  if (!await FS.isDirectory(projectRoot)) {
    Errors.throwUserInput(`No Tao project directory found at ${projectRoot}.`)
  }
  const devices = chosen(options.devices, qaDeviceOrder, 'device')
  const appearances = chosen(options.appearances, qaAppearanceOrder, 'appearance')
  const selectors = (options.scenarios ?? []).map(parseSelector)
  if (options.studio === true && !devices.includes(studioDevice)) {
    Errors.throwUserInput(`Studio is captured at ${studioDevice} only; include it in --device to capture Studio.`)
  }
  const repositoryRoot = Repo.getRoot(projectRoot)
  const store = FS.resolvePath(options.dest)
  const createdAt = new Date().toISOString()
  const runId = newRunId(createdAt)
  const runRoot = FS.resolvePath(`runs/${runId}`, store)
  if (await FS.exists(runRoot)) {
    Errors.throwUserInput(`The store already holds run ${runId}; start another capture.`)
  }
  const workRoot = FS.resolvePath(`.artifacts/qa-screenshots/${runId}`, repositoryRoot)
  await FS.mkdir(workRoot)
  const source = await sourceRevision(repositoryRoot)
  const capture: QaCapture = {
    appearances,
    devices,
    matched: new Set(),
    previous: latestCaptures(await readRuns(store)),
    projectRoot,
    runRoot,
    scenarios: [],
    selectors,
    shots: [],
  }

  try {
    const requested = options.apps === undefined || options.apps.length === 0 ? undefined : options.apps
    let apps: readonly string[] = requested ?? []
    let renderer: StudioCdpRendererFingerprint | undefined
    for (let index = 0; index < Math.max(apps.length, 1); index += 1) {
      const launchRoot = FS.resolvePath(`launch-${index + 1}`, workRoot)
      await withStudio({ appName: apps[index], launchRoot, projectRoot, repositoryRoot }, async session => {
        const handshake = await readHandshake(session.browser)
        if (index === 0) {
          const declared = handshake.apps.map(app => app.appName)
          const unknown = requested?.filter(app => !declared.includes(app)) ?? []
          if (unknown.length > 0) {
            Errors.throwUserInput(`Unknown app ${unknown.join(', ')}; the project declares ${declared.join(', ')}.`)
          }
          const others = handshake.apps.filter(app => app.appName !== handshake.appName)
          apps = requested ?? [handshake.appName, ...await appsWithOwnScenarios(projectRoot, others, selectors)]
        }
        // Studio goes first, while every cell still has the size its scenario authored.
        if (options.studio === true && index === 0) {
          await captureStudio(session, handshake.appName, capture)
        }
        await captureApp(session, handshake.appName, index === 0, capture)
        // Taken last: the fingerprint records each font's load status, which settles only once the
        // captured cells have rendered.
        renderer = await session.browser.rendererFingerprint()
      })
    }
    const unmatched = selectors.filter(selector => !capture.matched.has(selector))
    if (unmatched.length > 0) {
      Errors.throwUserInput(
        `No scenario matches ${unmatched.map(selector => selector.text).join(', ')}. The project's scenarios: ${
          capture.scenarios.map(scenario => `${scenario.subject}/${scenario.group}/${scenario.entry}`).join(', ')
        }.`,
      )
    }
    if (capture.shots.length === 0 || renderer === undefined) {
      Errors.throwUserInput(`Studio found no scenario to capture in ${projectRoot}.`)
    }
    const manifest: QaRunManifest = {
      appearances,
      apps,
      createdAt,
      devices,
      ...(options.note === undefined ? {} : { note: options.note }),
      project: FS.relativePath(repositoryRoot, projectRoot),
      renderer,
      runId,
      ...(selectors.length === 0 ? {} : { selection: selectors.map(selector => selector.text) }),
      shots: capture.shots,
      source,
      version: qaRunManifestVersion,
    }
    const runPath = FS.resolvePath(qaRunManifestName, runRoot)
    await FS.writeJson(runPath, manifest)
    // The work directory holds each launch's Studio log and raw captures; a finished run no longer
    // needs them, and a failed one keeps them for diagnosis.
    await FS.remove(workRoot)
    const shots = capture.shots
    return {
      captured: shots.filter(shot => shot.status === 'captured').length,
      changed: shots.filter(shot => shot.change === 'changed').length,
      failed: shots.filter(shot => shot.status === 'failed').length,
      new: shots.filter(shot => shot.change === 'new').length,
      runPath,
      timelinePath: await writeTimeline(store),
    }
  } catch (error) {
    await FS.remove(runRoot)
    throw error
  }
}

/** withStudio launches Studio on the project, and Chrome on its session page, for the length of `work`. */
async function withStudio(
  options: { appName: string | undefined; launchRoot: string; projectRoot: string; repositoryRoot: string },
  work: (session: QaSession) => Promise<void>,
): Promise<void> {
  let browser: StudioCdp | undefined
  let launch: StartedStudioSmokeLaunch | undefined
  const recordsBefore = await sessionRecords(options.projectRoot)
  try {
    launch = await startStudioSmokeLaunch({
      ...(options.appName === undefined ? {} : { appName: options.appName }),
      projectRoot: options.projectRoot,
      repositoryRoot: options.repositoryRoot,
    })
    browser = await StudioCdp.launchChrome({ artifactRoot: options.launchRoot })
    await browser.setViewport(qaCaptureViewport.width, qaCaptureViewport.height)
    await StudioReview.capture.open(browser, launch.readiness.sessionUrl)
    await work({ artifactRoot: options.launchRoot, browser, sessionUrl: launch.readiness.sessionUrl })
  } finally {
    if (launch !== undefined) {
      await FS.writeText(FS.resolvePath('studio.log', options.launchRoot), launch.output()).catch(() => undefined)
    }
    await browser?.close().catch(() => undefined)
    await launch?.stop().catch(() => undefined)
    await removeNewSessionRecords(options.projectRoot, recordsBefore)
  }
}

/** sessionRecords lists the dev-session history records a project holds, leaving out its live owner. */
async function sessionRecords(projectRoot: string): Promise<ReadonlySet<string>> {
  const root = ProjectLocal.storeResolve('sessions', projectRoot)
  return new Set(
    await FS.isDirectory(root)
      ? (await FS.listDir(root)).filter(name => name.endsWith('.json') && name !== 'owner.json')
      : [],
  )
}

/**
 * removeNewSessionRecords deletes the history records a capture's own Studio launch left in the
 * project, and the directories they emptied, so repeated captures do not pile records into an
 * ignored folder nobody reads. A record that was there before the launch stays, and `.tao/` goes
 * only when nothing but its own ignore file is left.
 */
async function removeNewSessionRecords(projectRoot: string, before: ReadonlySet<string>): Promise<void> {
  const sessions = ProjectLocal.storeResolve('sessions', projectRoot)
  for (const name of await sessionRecords(projectRoot)) {
    if (!before.has(name)) {
      await FS.remove(FS.resolvePath(name, sessions))
    }
  }
  for (const path of [sessions, FS.dirname(sessions)]) {
    if (await FS.isDirectory(path) && await FS.isEmptyDirectory(path)) {
      await FS.remove(path)
    }
  }
  const folder = ProjectLocal.root(projectRoot)
  if (await FS.isDirectory(folder) && (await FS.listDir(folder)).every(name => name === '.gitignore')) {
    await FS.remove(folder)
  }
}

/**
 * captureApp captures the selected scenarios the session owns in every device and appearance pass.
 * A session owns the scenarios that run its app. A view scenario is listed by every app whose source
 * reaches the view, and only the run's first session captures it, so it gets one shot per configuration.
 */
async function captureApp(session: QaSession, appName: string, first: boolean, capture: QaCapture): Promise<void> {
  const { browser, sessionUrl } = session
  const scenarios = await readScenarios(browser, capture.projectRoot)
  const owned = scenarios.filter(scenario => scenario.subjectKind === 'app' ? scenario.subject === appName : first)
  capture.scenarios.push(...owned)
  const wanted = owned.filter(scenario => selects(capture.selectors, scenario, capture.matched))
  if (wanted.length === 0) {
    return
  }
  for (const device of capture.devices) {
    for (const appearance of capture.appearances) {
      HCI.writeLine(`Capturing ${appName} ${device} ${appearance}…`)
      await applyEnvironment(browser, device, appearance)
      await StudioReview.capture.open(browser, sessionUrl)
      const surface = await StudioReview.capture.surface(browser)
      const captureRoot = FS.resolvePath(`${device}-${appearance}`, session.artifactRoot)
      for (const cell of surface.cells) {
        const scenario = scenarioOf(cell, scenarios)
        if (!wanted.includes(scenario)) {
          continue
        }
        const name = uniqueName(shotName(appName, scenario, device, appearance), scenario, capture.shots)
        const captured = await StudioReview.capture.cell(browser, cell, captureRoot, surface.manifest)
        capture.shots.push(
          await storeShot(capture.runRoot, captureRoot, capture.previous, {
            app: appName,
            appearance,
            device,
            ...(captured.error === undefined ? {} : { error: captured.error }),
            environment: captured.environment,
            name,
            scenario,
            ...(captured.screenshot === undefined ? {} : { screenshot: captured.screenshot }),
            ...(captured.sha256 === undefined ? {} : { sha256: captured.sha256 }),
            status: captured.status,
          }),
        )
      }
    }
  }
}

/**
 * captureStudio captures Studio's own page in each state of `studioStates`, at the laptop size with
 * the window exactly that size, in every appearance pass. Each state starts from a freshly loaded
 * session page, so no state inherits scroll or focus from the one before it.
 */
async function captureStudio(session: QaSession, appName: string, capture: QaCapture): Promise<void> {
  const { browser, sessionUrl } = session
  const size = qaDevices[studioDevice]
  const captureRoot = FS.resolvePath('studio', session.artifactRoot)
  await FS.mkdir(captureRoot)
  await StudioReview.capture.open(browser, sessionUrl)
  // Studio remembers the layout preset, and the cell captures after these shots need the one the
  // session opened in: in Draw no preview cell renders, so every one of them would time out.
  const openedPreset = await browser.evaluate<string | undefined>(
    `document.querySelector('[data-layout-preset]')?.dataset.layoutPreset`,
  )
  await browser.setViewport(size.width, size.height)
  try {
    for (const appearance of capture.appearances) {
      HCI.writeLine(`Capturing Studio on ${appName} ${studioDevice} ${appearance}…`)
      // The previews keep their authored sizes: Studio's shot shows them as a person opening it would.
      await applyEnvironment(browser, undefined, appearance)
      for (const state of studioStates) {
        const name = studioShotName(appName, state.key, appearance)
        const shot = { app: studioApp, appearance, device: studioDevice, name, studioState: state.key }
        try {
          await StudioReview.capture.open(browser, sessionUrl)
          await minimizeAgentPanel(browser)
          await resetCanvasViewport(browser, 'design')
          await browser.click(`[data-preset="${state.preset}"]`)
          if (state.preset === 'draw') {
            await resetCanvasViewport(browser, 'draw')
          }
          await browser.waitFor(studioStateSettled(state.preset), { timeoutMs: 60_000 })
          const settled = await settledPageCapture(browser, FS.resolvePath(name, captureRoot))
          if (settled.error !== undefined) {
            capture.shots.push({ ...shot, error: settled.error, status: 'failed' })
            continue
          }
          await FS.copyFile(settled.path, FS.resolvePath(`screenshots/${name}`, capture.runRoot))
          capture.shots.push({
            ...shot,
            change: changeSince(capture.previous, name, settled.sha256),
            sha256: settled.sha256,
            status: 'captured',
          })
        } catch (error) {
          capture.shots.push({ ...shot, error: Errors.formatForUser(error), status: 'failed' })
        }
      }
    }
  } finally {
    await browser.setViewport(qaCaptureViewport.width, qaCaptureViewport.height)
    if (openedPreset !== undefined) {
      await StudioReview.capture.open(browser, sessionUrl)
      await browser.click(`[data-preset="${openedPreset}"]`)
      await browser.waitFor(`document.querySelector('[data-layout-preset=${JSON.stringify(openedPreset)}]') !== null`)
    }
  }
}

/**
 * minimizeAgentPanel folds Studio's floating agent panel, which opens over the workbench and reports
 * whether this host has a model key, so a shot shows the workbench rather than one machine's setup.
 */
async function minimizeAgentPanel(browser: StudioCdp): Promise<void> {
  const minimized = `(() => {
    const collapse = document.querySelector('.studio-agent-collapse')
    const panel = collapse?.closest('[data-studio-panel="agent"] > *')
    if (!(collapse instanceof HTMLElement) || !(panel instanceof HTMLElement)) return false
    if (panel.dataset.minimized === 'true') return true
    collapse.click()
    return false
  })()`
  await browser.waitFor(minimized, { timeoutMs: 30_000 })
}

/**
 * resetCanvasViewport returns the preview canvas to 100 % at its top left through Studio's own zoom
 * menu, and scrolls its host back to the origin. Studio restores the last pan for the project, and a review capture pans to reveal each cell,
 * so without this a shot shows wherever the previous capture or person left it. The menu answers only
 * in the Design and Draw presets, and Draw keeps a canvas of its own.
 */
async function resetCanvasViewport(browser: StudioCdp, preset: 'design' | 'draw'): Promise<void> {
  await browser.click(`[data-preset="${preset}"]`)
  const reset = `(() => {
    if (document.querySelector('[data-layout-preset=${JSON.stringify(preset)}]') === null) return false
    const host = [...document.querySelectorAll('[data-canvas-surface="on"]')].find(candidate =>
      (candidate.dataset.canvasWorkspace === 'draw') === ${JSON.stringify(preset === 'draw')})
    const grid = host?.querySelector(${
    JSON.stringify(preset === 'draw' ? ':scope > [data-tao-studio-draw-canvas]' : ':scope > .studio-preview-grid')
  })
    if (!(grid instanceof HTMLElement)) return false
    // A revealed element can scroll the clipped host itself as well as panning the grid.
    host.scrollTo(0, 0)
    if (grid.style.transform === 'translate(0px, 0px) scale(1)') return true
    const choice = host.querySelector('[data-tao-studio-canvas-zoom-action="1"]')
    if (choice instanceof HTMLElement && !choice.parentElement?.hidden) {
      choice.click()
    } else {
      host.querySelector('.studio-canvas-zoom')?.click()
    }
    return false
  })()`
  await browser.waitFor(reset, { timeoutMs: 30_000 })
}

/** studioShotName spells `Studio_<App>_<state>_laptop-<appearance>.png`, naming the app Studio opened. */
function studioShotName(appName: string, state: string, appearance: QaAppearance): string {
  return `${[studioApp, appName, state, `${studioDevice}-${appearance}`].map(namePart).join('_')}.png`
}

/**
 * studioStateSettled holds until the layout preset applied, the fonts loaded, and every preview cell
 * on screen stopped waiting for its frame. A cell scrolled out of view is left out: Chrome pauses its
 * frame's animation frames, so it may never settle, and the shot does not show it.
 */
function studioStateSettled(preset: string): string {
  return `(() => {
    if (document.querySelector('[data-layout-preset=${JSON.stringify(preset)}]') === null) return false
    if (document.fonts.status !== 'loaded') return false
    return [...document.querySelectorAll('.studio-preview-cell[data-tao-review-key]')].every(cell => {
      const box = cell.getBoundingClientRect()
      const onScreen = box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight
      return !onScreen || cell.dataset.taoReviewStatus !== 'pending'
    })
  })()`
}

/** settledPageCapture captures the window until two consecutive captures agree. */
async function settledPageCapture(
  browser: StudioCdp,
  path: string,
): Promise<{ error?: string; path: string; sha256: string }> {
  let sha256 = Platform.sha256Hex(await FS.readFile(await browser.captureScreenshotAt(path)))
  for (let attempt = 0; attempt < studioStableAttempts; attempt += 1) {
    await Time.sleep(250)
    const next = Platform.sha256Hex(await FS.readFile(await browser.captureScreenshotAt(path)))
    if (next === sha256) {
      return { path, sha256 }
    }
    sha256 = next
  }
  return { error: `Studio kept changing across ${studioStableAttempts + 1} captures.`, path, sha256 }
}

function chosen<Value extends string>(
  requested: readonly string[] | undefined,
  known: readonly Value[],
  label: string,
): readonly Value[] {
  if (requested === undefined || requested.length === 0) {
    return known
  }
  const unknown = requested.filter(value => !known.some(candidate => candidate === value))
  if (unknown.length > 0) {
    Errors.throwUserInput(`Unknown ${label} ${unknown.join(', ')}; choose from ${known.join(', ')}.`)
  }
  return known.filter(value => requested.includes(value))
}

/** parseSelector reads one `--scenario` value; see QaSelector. */
function parseSelector(text: string): QaSelector {
  const qualified = /^(?<file>[^:/]*(?:\/[^:/]+)*\.tao):(?<rest>.*)$/u.exec(text)?.groups
  const names = (qualified?.['rest'] ?? text).split('/')
  if (names.length > 3 || names.some(name => name.length === 0)) {
    Errors.throwUserInput(
      `Cannot read scenario selector "${text}"; write [<file>.tao:]<subject or group>[/<group or entry>[/<entry>]].`,
    )
  }
  return { ...(qualified?.['file'] === undefined ? {} : { file: qualified['file'] }), names, text }
}

function selectorMatches(selector: QaSelector, scenario: QaScenario): boolean {
  const file = selector.file
  if (file !== undefined && scenario.source !== file && !scenario.source.endsWith(`/${file}`)) {
    return false
  }
  const [first, second, third] = selector.names
  if (second === undefined) {
    return scenario.subject === first || scenario.group === first
  }
  if (third === undefined) {
    return (scenario.group === first && scenario.entry === second)
      || (scenario.subject === first && scenario.group === second)
  }
  return scenario.subject === first && scenario.group === second && scenario.entry === third
}

/** selects says whether a scenario is captured, recording each selector that picked it. */
function selects(selectors: readonly QaSelector[], scenario: QaScenario, matched: Set<QaSelector>): boolean {
  if (selectors.length === 0) {
    return true
  }
  const hits = selectors.filter(selector => selectorMatches(selector, scenario))
  for (const hit of hits) {
    matched.add(hit)
  }
  return hits.length > 0
}

/** QaApp is one app the project declares, with its entry file relative to the project root. */
type QaApp = { appName: string; entryPath: string }

/** readHandshake reads the session's app and every app the project declares from Studio's handshake. */
async function readHandshake(browser: ReviewBrowser): Promise<{ appName: string; apps: readonly QaApp[] }> {
  const read = await browser.evaluate<{ error: string } | { appName: string; apps: QaApp[] }>(`(async () => {
    const base = location.pathname.match(/^\\/sessions\\/[^/]+/u)?.[0]
    if (base === undefined) return { error: 'Tao Studio page is not scoped to a session: ' + location.pathname }
    const reply = await fetch(base + '/api/protocol')
    if (!reply.ok) return { error: 'Tao Studio protocol handshake returned ' + reply.status }
    const handshake = await reply.json()
    return {
      appName: handshake.identity.appName,
      apps: handshake.apps.map(app => ({ appName: app.appName, entryPath: app.entryPath })),
    }
  })()`)
  if ('error' in read) {
    Errors.throwHostEnvironment(read.error)
  }
  const apps = read.apps.filter((app, index) => read.apps.findIndex(other => other.appName === app.appName) === index)
  return { appName: read.appName, apps }
}

/**
 * appsWithOwnScenarios names the apps that some selected scenario runs as its subject. A session lists
 * only the scenarios its app's source reaches, so the other apps' entries are parsed here, without a
 * launch, to leave out the many apps a project declares only as harnesses.
 */
async function appsWithOwnScenarios(
  projectRoot: string,
  apps: readonly QaApp[],
  selectors: readonly QaSelector[],
): Promise<readonly string[]> {
  if (apps.length === 0) {
    return []
  }
  const entryOf = (app: QaApp): string => FS.resolvePath(app.entryPath, projectRoot)
  const workspace = await Workspace.open(projectRoot)
  // Several apps may share an entry file, which parses once.
  const parsed = await workspace.parseFiles(apps.map(entryOf))
  const filesByEntry = new Map(parsed.map(result => [result.entry.path, result.files]))
  return apps.filter(app => {
    const appName = app.appName
    return Compiler.compileStudioPreviewManifest(filesByEntry.get(entryOf(app)) ?? [], appName, projectRoot)
      .scenarios.some(scenario =>
        scenario.subject.kind === 'app' && scenario.subject.appName === appName
        && (selectors.length === 0 || selectors.some(selector =>
          selectorMatches(selector, {
            entry: scenario.name,
            group: scenario.group,
            source: FS.relativePath(projectRoot, scenario.source.path),
            subject: appName,
            subjectKind: 'app',
          })
        ))
      )
  }).map(app => app.appName)
}

/** readScenarios reads each scenario's source identity from the session's preview manifest. */
async function readScenarios(browser: ReviewBrowser, projectRoot: string): Promise<readonly QaScenario[]> {
  const read = await browser.evaluate<{ error: string } | { scenarios: QaScenario[] }>(`(async () => {
    const base = location.pathname.match(/^\\/sessions\\/[^/]+/u)?.[0]
    if (base === undefined) return { error: 'Tao Studio page is not scoped to a session: ' + location.pathname }
    const reply = await fetch(base + '/api/preview/manifest')
    if (!reply.ok) return { error: 'Tao Studio preview manifest returned ' + reply.status }
    const manifest = await reply.json()
    const subjects = new Map(manifest.subjects.map(subject => [subject.subjectId, subject]))
    return {
      scenarios: manifest.scenarios.map(scenario => {
        const subject = subjects.get(scenario.subjectId)
        return {
          entry: scenario.label,
          group: scenario.group,
          source: scenario.source.path,
          subject: subject === undefined ? '' : subject.kind === 'app' ? subject.appName : subject.viewName,
          subjectKind: subject?.kind === 'app' ? 'app' : 'view',
        }
      }),
    }
  })()`)
  if ('error' in read) {
    Errors.throwHostEnvironment(read.error)
  }
  return read.scenarios.map(scenario => ({
    ...scenario,
    source: FS.relativePath(projectRoot, FS.resolvePath(scenario.source, projectRoot)),
  }))
}

/** scenarioOf finds a review cell's scenario by group and entry, then by source file when two share them. */
function scenarioOf(cell: { group: string; key: string; label: string }, scenarios: readonly QaScenario[]): QaScenario {
  const named = scenarios.filter(scenario => scenario.group === cell.group && scenario.entry === cell.label)
  const [file] = JSON.parse(cell.key) as [unknown]
  const matches = named.length > 1 && typeof file === 'string'
    ? named.filter(scenario => scenario.source === file || scenario.source.endsWith(`/${file}`))
    : named
  if (matches.length !== 1) {
    Errors.throwUnexpected(`Studio's review cell ${cell.group}/${cell.label} matched ${matches.length} scenarios.`)
  }
  return matches[0]!
}

/**
 * shotName spells `<App>_<Subject>_<group>-<entry>_<device>-<appearance>.png`: `_` separates fields,
 * `-` joins words within one, and the subject is left out when it is the app itself.
 */
function shotName(appName: string, scenario: QaScenario, device: QaDevice, appearance: QaAppearance): string {
  const fields = [
    appName,
    ...(scenario.subjectKind === 'app' && scenario.subject === appName ? [] : [scenario.subject]),
    `${scenario.group}-${scenario.entry}`,
    `${device}-${appearance}`,
  ]
  return `${fields.map(namePart).join('_')}.png`
}

/** uniqueName qualifies a name with its source file when two files declare the same group and entry. */
function uniqueName(name: string, scenario: QaScenario, shots: readonly QaShot[]): string {
  if (!shots.some(shot => shot.name === name)) {
    return name
  }
  const file = FS.basename(scenario.source).replace(/\.tao$/u, '')
  return name.replace(/\.png$/u, `_${namePart(file)}.png`)
}

function namePart(value: string): string {
  // Decomposing then dropping the combining marks keeps an accented letter's base letter.
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^A-Za-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
    || 'unnamed'
}

/**
 * applyEnvironment overrides every cell's scheme, and its viewport when a device is given, including a
 * scenario's authored device and appearance, for this Studio session only, through the same
 * reconfigure route Studio's own environment controls use; the Tao source is untouched. A reload then
 * renders the published manifest, which carries the overrides.
 */
async function applyEnvironment(
  browser: ReviewBrowser,
  device: QaDevice | undefined,
  appearance: QaAppearance,
): Promise<void> {
  const viewport = device === undefined ? null : { ...qaDevices[device], presetId: device }
  // Raw `Error`: this string runs in Chrome, which has no reach into Tao's error taxonomy.
  const failure = await browser.evaluate<string | null>(`(async () => {
    const base = location.pathname.match(/^\\/sessions\\/[^/]+/u)?.[0]
    if (base === undefined) return 'Tao Studio page is not scoped to a session: ' + location.pathname
    const reply = await fetch(base + '/api/preview/manifest')
    if (!reply.ok) return 'Tao Studio preview manifest returned ' + reply.status
    const manifest = await reply.json()
    const viewport = ${JSON.stringify(viewport)}
    const appearance = ${JSON.stringify(appearance)}
    for (const cell of manifest.cells) {
      // An explicit preference outranks even a scenario's authored appearance in the preview runtime.
      const scheme = { ...cell.environment.scheme, requested: appearance, resolved: appearance, source: 'preference' }
      const environment = { ...cell.environment, scheme, viewport: viewport ?? cell.environment.viewport }
      const response = await fetch(base + '/api/preview/cell/reconfigure', {
        body: JSON.stringify({
          appName: manifest.project.appName,
          cellId: cell.cellId,
          cellRevision: cell.cellRevision,
          compileRevision: manifest.compileRevision,
          environment,
          manifestRevision: manifest.manifestRevision,
          project: manifest.project.root,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) return 'Tao Studio refused ' + cell.cellId + ' at ${
    device ?? 'its own size'
  } ${appearance}: ' + await response.text()
    }
    return null
  })()`)
  if (failure !== null) {
    Errors.throwHostEnvironment(failure)
  }
}

async function storeShot(
  runRoot: string,
  captureRoot: string,
  previous: ReadonlyMap<string, string>,
  shot: Omit<QaShot, 'change'> & { environment: unknown; screenshot?: string },
): Promise<QaShot> {
  const { environment, screenshot, ...recorded } = shot
  const applied = appliedEnvironment(environment)
  const mismatch = applied !== undefined
      && (applied.width !== qaDevices[shot.device].width || applied.scheme !== shot.appearance)
    ? `Studio rendered ${applied.width}px ${applied.scheme}, not the requested ${shot.device} ${shot.appearance}.`
    : undefined
  if (mismatch !== undefined) {
    return { ...recorded, error: [recorded.error, mismatch].filter(Boolean).join(' '), status: 'failed' }
  }
  if (screenshot === undefined || shot.sha256 === undefined || shot.status === 'failed') {
    return recorded
  }
  await FS.copyFile(FS.resolvePath(screenshot, captureRoot), FS.resolvePath(`screenshots/${shot.name}`, runRoot))
  return { ...recorded, change: changeSince(previous, shot.name, shot.sha256) }
}

/** changeSince compares a screenshot's pixels with the latest earlier capture of the same name. */
function changeSince(previous: ReadonlyMap<string, string>, name: string, sha256: string): QaShot['change'] {
  const before = previous.get(name)
  return before === undefined ? 'new' : before === sha256 ? 'unchanged' : 'changed'
}

function appliedEnvironment(environment: unknown): { scheme: string; width: number } | undefined {
  if (typeof environment !== 'object' || environment === null) {
    return undefined
  }
  const { scheme, viewport } = environment as { scheme?: { resolved?: unknown }; viewport?: { width?: unknown } }
  return typeof viewport?.width === 'number' && typeof scheme?.resolved === 'string'
    ? { scheme: scheme.resolved, width: viewport.width }
    : undefined
}

/** newRunId keeps directory order chronological, with a random suffix for independent captures. */
function newRunId(createdAt: string): string {
  return `${createdAt.replace(/\.(\d{3})Z$/u, 'Z-$1').replaceAll(':', '-')}-${Platform.randomUUID()}`
}

async function sourceRevision(repositoryRoot: string): Promise<QaRunManifest['source']> {
  const git = async (args: readonly string[]): Promise<string> =>
    (await CLI.mustRun('git', { args, cwd: repositoryRoot })).stdout.trim()
  return {
    branch: await git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: await git(['rev-parse', 'HEAD']),
    dirty: (await git(['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=all'])).length > 0,
    // `%s` joins the whole first paragraph, and this repository's commits list their bullets
    // directly under the summary, so only the first line is the subject.
    subject: (await git(['log', '-1', '--format=%B'])).split('\n')[0] ?? '',
  }
}

/** readRuns reads every run manifest in the store, oldest first. */
async function readRuns(store: string): Promise<readonly QaRunManifest[]> {
  const runsRoot = FS.resolvePath('runs', store)
  if (!await FS.exists(runsRoot)) {
    return []
  }
  const runs: QaRunManifest[] = []
  for (const runId of (await FS.listDir(runsRoot)).sort()) {
    const path = FS.resolvePath(`${runId}/${qaRunManifestName}`, runsRoot)
    if (await FS.exists(path)) {
      const run = await FS.readJson<QaRunManifest>(path)
      if (run.version === qaRunManifestVersion) {
        runs.push(run)
      }
    }
  }
  return runs
}

/** latestCaptures maps each screenshot name to the pixels its most recent successful capture recorded. */
function latestCaptures(runs: readonly QaRunManifest[]): ReadonlyMap<string, string> {
  const latest = new Map<string, string>()
  for (const run of runs) {
    for (const shot of run.shots) {
      if (shot.status === 'captured' && shot.sha256 !== undefined) {
        latest.set(shot.name, shot.sha256)
      }
    }
  }
  return latest
}

type TimelineEntry = {
  appearance: QaAppearance
  appName: string
  device: QaDevice
  history: Array<{
    commit: string
    createdAt: string
    dirty: boolean
    error?: string
    note?: string
    rendererChanged: boolean
    runId: string
    screenshot?: string
    sha256?: string
    subject: string
  }>
  name: string
}

/** writeQaTimeline regenerates the timeline of the store at `dest` without capturing anything. */
export async function writeQaTimeline(dest: string): Promise<string> {
  return await writeTimeline(FS.resolvePath(dest))
}

/**
 * writeTimeline regenerates the store's index from every run manifest it holds. The index is derived
 * and would conflict whenever two runs land concurrently, so the store ignores it. A file mutation
 * lock keeps each regeneration's read and publish together across capture and timeline commands.
 */
async function writeTimeline(store: string): Promise<string> {
  await FS.mkdir(store)
  const path = FS.resolvePath('index.html', store)
  return await FS.withFileMutationLock(path, store, async () => {
    const ignore = FS.resolvePath('.gitignore', store)
    const currentIgnore = await FS.exists(ignore) ? await FS.readText(ignore) : ''
    if (!currentIgnore.split('\n').includes('/index.html*')) {
      const separator = currentIgnore !== '' && !currentIgnore.endsWith('\n') ? '\n' : ''
      await FS.writeText(ignore, `${currentIgnore}${separator}/index.html*\n`)
    }
    const runs = await readRuns(store)
    const temporaryPath = `${path}.${Platform.randomUUID()}.tmp`
    try {
      await FS.writeText(temporaryPath, renderTimeline(timelineEntries(runs), runs.length))
      await FS.move(temporaryPath, path)
    } finally {
      await FS.remove(temporaryPath)
    }
    return path
  })
}

/** timelineEntries keeps, per screenshot name, only the runs where its pixels changed or its capture failed. */
function timelineEntries(runs: readonly QaRunManifest[]): readonly TimelineEntry[] {
  const entries = new Map<string, TimelineEntry>()
  const lastRenderer = new Map<string, string>()
  for (const run of runs) {
    const renderer = JSON.stringify(run.renderer)
    for (const shot of run.shots) {
      const entry = entries.get(shot.name) ?? {
        appearance: shot.appearance,
        appName: shot.app,
        device: shot.device,
        history: [],
        name: shot.name,
      }
      entries.set(shot.name, entry)
      const previous = entry.history.at(-1)
      const rendererChanged = lastRenderer.has(shot.name) && lastRenderer.get(shot.name) !== renderer
      lastRenderer.set(shot.name, renderer)
      // A run that reproduced the previous pixels adds nothing to the history of this screen.
      if (previous !== undefined && previous.sha256 === shot.sha256 && shot.status === 'captured') {
        continue
      }
      entry.history.push({
        commit: run.source.commit,
        createdAt: run.createdAt,
        dirty: run.source.dirty,
        ...(shot.error === undefined ? {} : { error: shot.error }),
        ...(run.note === undefined ? {} : { note: run.note }),
        rendererChanged,
        runId: run.runId,
        ...(shot.status === 'captured' ? { screenshot: `runs/${run.runId}/screenshots/${shot.name}` } : {}),
        ...(shot.sha256 === undefined ? {} : { sha256: shot.sha256 }),
        subject: run.source.subject,
      })
    }
  }
  return [...entries.values()]
}

function renderTimeline(entries: readonly TimelineEntry[], runCount: number): string {
  const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
  const apps = [...new Set(sorted.map(entry => entry.appName))]
  const rows = sorted.map(entry => {
    const frames = [...entry.history].reverse().map(item => {
      const image = item.screenshot === undefined
        ? `<div class="missing">No capture</div>`
        : `<a href="${escapeHtml(item.screenshot)}"><img loading="lazy" src="${escapeHtml(item.screenshot)}" alt="${
          escapeHtml(`${entry.name} at ${item.commit.slice(0, 8)}`)
        }"></a>`
      const flags = [
        item.rendererChanged ? '<span class="flag">renderer changed</span>' : '',
        item.dirty ? '<span class="flag">uncommitted</span>' : '',
        item.error === undefined ? '' : `<span class="flag error">${escapeHtml(item.error)}</span>`,
      ].join('')
      return `<figure>${image}<figcaption><time>${escapeHtml(item.createdAt.slice(0, 10))}</time> <code>${
        escapeHtml(item.commit.slice(0, 8))
      }</code> ${escapeHtml(item.subject)}${
        item.note === undefined ? '' : `<em>${escapeHtml(item.note)}</em>`
      }${flags}</figcaption></figure>`
    }).join('')
    return `<section class="row" data-app="${
      escapeHtml(entry.appName)
    }" data-device="${entry.device}" data-appearance="${entry.appearance}">
<h2>${escapeHtml(entry.name.replace(/\.png$/u, ''))} <small>${entry.history.length} ${
      entry.history.length === 1 ? 'version' : 'versions'
    }</small></h2>
<div class="strip">${frames}</div></section>`
  }).join('\n')
  const options = (values: readonly string[]): string =>
    values.map(value => `<option>${escapeHtml(value)}</option>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tao UI history</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d1e22;--muted:#696d78;--line:#dcdde2;--flag:#8a5a00;--error:#b3261e;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#101114;--panel:#181a20;--ink:#f1f1ee;--muted:#9da1ad;--line:#343741;--flag:#e4a853;--error:#f28b82}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}main{max-width:1600px;margin:auto}
header p{color:var(--muted)}.filters{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}select{font:inherit}
.row{margin:18px 0;padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.row h2{margin:0 0 10px;font-size:15px;overflow-wrap:anywhere}.row small{color:var(--muted);font-weight:400}
.strip{display:flex;gap:14px;overflow-x:auto;padding-bottom:6px}figure{flex:0 0 auto;width:220px;margin:0}figure img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px}
figcaption{margin-top:6px;font-size:12px;color:var(--muted)}figcaption em{display:block;color:var(--ink)}.flag{display:block;color:var(--flag)}.flag.error{color:var(--error)}.missing{display:grid;place-items:center;height:140px;border:1px dashed var(--line);border-radius:6px;color:var(--muted)}
</style></head><body><main>
<header><h1>Tao UI history</h1><p>${runCount} capture ${
    runCount === 1 ? 'run' : 'runs'
  }. Each strip shows only the captures where that screen changed, newest first.</p></header>
<div class="filters"><label>App <select id="app"><option value="">All</option>${options(apps)}</select></label>
<label>Device <select id="device"><option value="">All</option>${
    options(qaDeviceOrder)
  }</select></label><label>Appearance <select id="appearance"><option value="">All</option>${
    options(qaAppearanceOrder)
  }</select></label></div>
${rows}
</main><script>
const filters=['app','device','appearance'].map(id=>document.getElementById(id));
const apply=()=>{for(const row of document.querySelectorAll('.row')){row.hidden=filters.some(select=>select.value!==''&&row.dataset[select.id]!==select.value)}};
for(const select of filters)select.addEventListener('change',apply);
</script></body></html>\n`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export const QaScreenshotsTesting = {
  appsWithOwnScenarios,
  changeSince,
  latestCaptures,
  newRunId,
  parseSelector,
  readRuns,
  selectorMatches,
  shotName,
  sourceRevision,
  studioShotName,
  studioStates,
  timelineEntries,
  uniqueName,
} as const
