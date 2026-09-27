import { Assert, CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { StudioCdp, type StudioCdpRendererFingerprint } from './StudioCdp'
import { type ReviewBrowser, StudioReview } from './StudioReview'
import { type StartedStudioSmokeLaunch, startStudioSmokeLaunch } from './StudioSmokeLaunch'

/**
 * QaScreenshots captures every Studio scenario across a device × appearance matrix into an
 * append-only store: PNGs named by their sha256 under `blobs/`, one manifest per run under `runs/`,
 * and a generated, ignored `index.html` timeline. Two runs never write the same tracked file, so
 * stores kept in Git merge without conflicts.
 */

// The scenario `device` presets' default sizes, from `packages/compiler/compiler-src/studio-preview-manifest.ts`.
const qaDevices = {
  laptop: { height: 900, width: 1440 },
  phone: { height: 844, width: 390 },
  tablet: { height: 1024, width: 768 },
} as const

type QaDevice = keyof typeof qaDevices
type QaAppearance = 'dark' | 'light'

const qaDeviceOrder: readonly QaDevice[] = ['phone', 'tablet', 'laptop']
const qaAppearanceOrder: readonly QaAppearance[] = ['light', 'dark']
const qaRunManifestVersion = 1 as const

type QaShot = {
  appearance: QaAppearance
  device: QaDevice
  error?: string
  group: string
  key: string
  label: string
  sha256?: string
  status: 'captured' | 'failed'
}

type QaRunManifest = {
  createdAt: string
  note?: string
  project: { appName: string; entryPath: string }
  renderer: StudioCdpRendererFingerprint
  runId: string
  shots: readonly QaShot[]
  source: { branch: string; commit: string; dirty: boolean; subject: string }
  version: typeof qaRunManifestVersion
}

type QaScreenshotOptions = {
  appName?: string
  appearances?: readonly string[]
  dest: string
  devices?: readonly string[]
  note?: string
}

type QaScreenshotResult = {
  captured: number
  failed: number
  newBlobs: number
  runPath: string
  timelinePath: string
}

/** runQaScreenshots captures one run into the store at `options.dest` and regenerates its timeline. */
export async function runQaScreenshots(projectPath: string, options: QaScreenshotOptions): Promise<QaScreenshotResult> {
  const projectRoot = FS.resolvePath(projectPath)
  if (!await FS.isDirectory(projectRoot)) {
    Errors.throwUserInput(`No Tao project directory found at ${projectRoot}.`)
  }
  const devices = chosen(options.devices, qaDeviceOrder, 'device')
  const appearances = chosen(options.appearances, qaAppearanceOrder, 'appearance')
  const repositoryRoot = Repo.getRoot(projectRoot)
  const store = FS.resolvePath(options.dest)
  const createdAt = new Date().toISOString()
  const runId = `${createdAt.replaceAll(':', '-').replace(/\.\d{3}Z$/u, 'Z')}-${Platform.randomUUID().slice(0, 8)}`
  const workRoot = FS.resolvePath(`.artifacts/qa-screenshots/${runId}`, repositoryRoot)
  await FS.mkdir(workRoot)
  const source = await sourceRevision(repositoryRoot)

  let browser: StudioCdp | undefined
  let launch: StartedStudioSmokeLaunch | undefined
  const shots: QaShot[] = []
  let newBlobs = 0
  try {
    launch = await startStudioSmokeLaunch({
      ...(options.appName === undefined ? {} : { appName: options.appName }),
      projectRoot,
      repositoryRoot,
    })
    browser = await StudioCdp.launchChrome({ artifactRoot: workRoot })
    await waitForStudioClient(launch.readiness.sessionUrl)
    await StudioReview.capture.open(browser, launch.readiness.sessionUrl)
    let project: QaRunManifest['project'] | undefined
    for (const device of devices) {
      for (const appearance of appearances) {
        HCI.writeLine(`Capturing ${device} ${appearance}…`)
        await applyEnvironment(browser, device, appearance)
        await StudioReview.capture.open(browser, launch.readiness.sessionUrl)
        const surface = await StudioReview.capture.surface(browser)
        project ??= { appName: surface.manifest.appName, entryPath: surface.manifest.entryPath }
        const captureRoot = FS.resolvePath(`${device}-${appearance}`, workRoot)
        for (const cell of surface.cells) {
          // A scenario that authors its appearance is captured only in that appearance's pass.
          const scheme = appliedEnvironment(cell.environment)?.scheme
          if (scheme !== undefined && scheme !== appearance) {
            continue
          }
          const captured = await StudioReview.capture.cell(browser, cell, captureRoot, surface.manifest)
          const stored = await storeShot(store, captureRoot, {
            appearance,
            device,
            ...(captured.error === undefined ? {} : { error: captured.error }),
            environment: captured.environment,
            group: captured.group,
            label: captured.label,
            ...(captured.screenshot === undefined ? {} : { screenshot: captured.screenshot }),
            ...(captured.sha256 === undefined ? {} : { sha256: captured.sha256 }),
            status: captured.status,
          })
          shots.push(stored.shot)
          newBlobs += stored.newBlob ? 1 : 0
        }
      }
    }
    // Taken last: the fingerprint records each font's load status, which settles only once the
    // captured cells have rendered.
    const renderer = await browser.rendererFingerprint()
    Assert.defined(project, 'Studio exposed at least one reviewable cell.')
    const manifest: QaRunManifest = {
      createdAt,
      ...(options.note === undefined ? {} : { note: options.note }),
      project,
      renderer,
      runId,
      shots,
      source,
      version: qaRunManifestVersion,
    }
    const runPath = FS.resolvePath(`runs/${runId}.json`, store)
    await FS.writeJson(runPath, manifest)
    const timelinePath = await writeTimeline(store)
    return {
      captured: shots.filter(shot => shot.status === 'captured').length,
      failed: shots.filter(shot => shot.status === 'failed').length,
      newBlobs,
      runPath,
      timelinePath,
    }
  } finally {
    if (launch !== undefined) {
      await FS.writeText(FS.resolvePath('studio.log', workRoot), launch.output()).catch(() => undefined)
    }
    await browser?.close().catch(() => undefined)
    await launch?.stop().catch(() => undefined)
  }
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

/**
 * waitForStudioClient returns once Studio has stopped republishing its browser client. Launching
 * Studio compiles its own Tao client into the sources its dev reload watches, so the page reloads
 * itself once shortly after startup, which would tear down a capture in progress.
 */
async function waitForStudioClient(sessionUrl: string): Promise<void> {
  const quietMs = 8_000
  const deadline = Date.now() + 120_000
  const url = new URL('/studio-dev/revision', sessionUrl)
  let revision: unknown
  let changedAt = Date.now()
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      return // This launch publishes no dev reloads.
    }
    const next = ((await response.json()) as { revision?: unknown }).revision
    if (next !== revision) {
      revision = next
      changedAt = Date.now()
    } else if (Date.now() - changedAt >= quietMs) {
      return
    }
    await Time.sleep(250)
  }
  Errors.throwHostEnvironment('Tao Studio kept republishing its browser client for two minutes.')
}

/**
 * applyEnvironment overrides every cell's viewport, and the scheme of every cell whose scenario does
 * not author an appearance, for this Studio session only, through the same reconfigure route Studio's
 * own environment controls use; the Tao source is untouched. A reload then renders the published
 * manifest, which carries the overrides.
 */
async function applyEnvironment(browser: ReviewBrowser, device: QaDevice, appearance: QaAppearance): Promise<void> {
  const viewport = { ...qaDevices[device], presetId: device }
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
      const scheme = cell.environment.scheme
      // A scenario's authored appearance outranks the cell's scheme in the runtime, so it stays.
      const environment = {
        ...cell.environment,
        scheme: scheme.source === 'scenario'
          ? scheme
          : { ...scheme, requested: appearance, resolved: appearance, source: 'preference' },
        viewport,
      }
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
      if (!response.ok) return 'Tao Studio refused ' + cell.cellId + ' at ${device} ${appearance}: ' + await response.text()
    }
    return null
  })()`)
  if (failure !== null) {
    Errors.throwHostEnvironment(failure)
  }
}

async function storeShot(
  store: string,
  captureRoot: string,
  shot: Omit<QaShot, 'key'> & { environment: unknown; screenshot?: string },
): Promise<{ newBlob: boolean; shot: QaShot }> {
  const { environment, screenshot, ...recorded } = shot
  const key = `${shot.group}/${shot.label}`
  const applied = appliedEnvironment(environment)
  const mismatch = applied !== undefined
      && (applied.width !== qaDevices[shot.device].width || applied.scheme !== shot.appearance)
    ? `Studio rendered ${applied.width}px ${applied.scheme}, not the requested ${shot.device} ${shot.appearance}.`
    : undefined
  let newBlob = false
  if (screenshot !== undefined && shot.sha256 !== undefined) {
    const blob = FS.resolvePath(`blobs/${shot.sha256}.png`, store)
    if (!await FS.exists(blob)) {
      await FS.copyFile(FS.resolvePath(screenshot, captureRoot), blob)
      newBlob = true
    }
  }
  return {
    newBlob,
    shot: {
      ...recorded,
      ...(mismatch === undefined ? {} : { error: [recorded.error, mismatch].filter(Boolean).join(' ') }),
      key,
      status: mismatch === undefined ? recorded.status : 'failed',
    },
  }
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

async function sourceRevision(repositoryRoot: string): Promise<QaRunManifest['source']> {
  const git = async (args: readonly string[]): Promise<string> =>
    (await CLI.mustRun('git', { args, cwd: repositoryRoot })).stdout.trim()
  return {
    branch: await git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: await git(['rev-parse', 'HEAD']),
    dirty: (await git(['status', '--porcelain', '--untracked-files=no'])).length > 0,
    subject: await git(['log', '-1', '--format=%s']),
  }
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
    sha256?: string
    subject: string
  }>
  key: string
}

/** writeQaTimeline regenerates the timeline of the store at `dest` without capturing anything. */
export async function writeQaTimeline(dest: string): Promise<string> {
  return await writeTimeline(FS.resolvePath(dest))
}

/**
 * writeTimeline regenerates the store's index from every run manifest it holds. The index is derived
 * and would conflict whenever two runs land concurrently, so the store ignores it and every reader
 * regenerates it.
 */
async function writeTimeline(store: string): Promise<string> {
  const ignore = FS.resolvePath('.gitignore', store)
  if (!await FS.exists(ignore)) {
    await FS.writeText(ignore, '/index.html\n')
  }
  const runsRoot = FS.resolvePath('runs', store)
  const names = await FS.exists(runsRoot) ? (await FS.listDir(runsRoot)).filter(name => name.endsWith('.json')) : []
  const runs = (await Promise.all(names.map(name => FS.readJson<QaRunManifest>(FS.resolvePath(name, runsRoot)))))
    .filter(run => run.version === qaRunManifestVersion)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const entries = new Map<string, TimelineEntry>()
  const lastRenderer = new Map<string, string>()
  for (const run of runs) {
    const renderer = JSON.stringify(run.renderer)
    for (const shot of run.shots) {
      const id = `${run.project.appName}/${shot.key}/${shot.device}/${shot.appearance}`
      const entry = entries.get(id) ?? {
        appearance: shot.appearance,
        appName: run.project.appName,
        device: shot.device,
        history: [],
        key: shot.key,
      }
      entries.set(id, entry)
      const previous = entry.history.at(-1)
      const rendererChanged = lastRenderer.has(id) && lastRenderer.get(id) !== renderer
      lastRenderer.set(id, renderer)
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
        ...(shot.sha256 === undefined ? {} : { sha256: shot.sha256 }),
        subject: run.source.subject,
      })
    }
  }
  const path = FS.resolvePath('index.html', store)
  await FS.writeText(path, renderTimeline([...entries.values()], runs.length))
  return path
}

function renderTimeline(entries: readonly TimelineEntry[], runCount: number): string {
  const sorted = [...entries].sort((left, right) =>
    left.appName.localeCompare(right.appName)
    || left.key.localeCompare(right.key)
    || qaDeviceOrder.indexOf(left.device) - qaDeviceOrder.indexOf(right.device)
    || left.appearance.localeCompare(right.appearance)
  )
  const apps = [...new Set(sorted.map(entry => entry.appName))]
  const rows = sorted.map(entry => {
    const frames = [...entry.history].reverse().map(item => {
      const image = item.sha256 === undefined
        ? `<div class="missing">No capture</div>`
        : `<a href="blobs/${item.sha256}.png"><img loading="lazy" src="blobs/${item.sha256}.png" alt="${
          escapeHtml(`${entry.key} ${entry.device} ${entry.appearance} at ${item.commit.slice(0, 8)}`)
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
<h2>${escapeHtml(entry.appName)} · ${
      escapeHtml(entry.key)
    } <small>${entry.device} · ${entry.appearance} · ${entry.history.length} ${
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
.row{margin:18px 0;padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.row h2{margin:0 0 10px;font-size:15px}.row small{color:var(--muted);font-weight:400}
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
