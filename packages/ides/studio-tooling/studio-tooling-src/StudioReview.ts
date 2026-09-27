import { Errors, FS, Platform, Repo } from '@shared'
import {
  StudioCdp,
  type StudioCdpRendererFingerprint,
} from './StudioCdp'
import { type StartedStudioSmokeLaunch, startStudioSmokeLaunch } from './StudioSmokeLaunch'

export const studioReviewManifestVersion = 1 as const

export type StudioReviewCell = {
  environment: unknown
  error?: string
  group: string
  key: string
  label: string
  renderInputs: unknown
  screenshot?: string
  sha256?: string
  status: 'captured' | 'failed'
}

export type StudioReviewPairStatus =
  | 'added'
  | 'changed'
  | 'failed'
  | 'incomparable'
  | 'removed'
  | 'unchanged'

export type StudioReviewPair = {
  baselineSha256?: string
  baselineScreenshot?: string
  currentSha256?: string
  currentScreenshot?: string
  key: string
  label: string
  status: StudioReviewPairStatus
}

export type StudioReviewManifest = {
  cells: readonly StudioReviewCell[]
  comparison?: {
    baselineReviewId: string
    pairs: readonly StudioReviewPair[]
    rendererCompatible: boolean
    rendererDifference?: string
  }
  createdAt: string
  project: {
    appName: string
    entryPath: string
  }
  renderer: StudioCdpRendererFingerprint
  reviewId: string
  studio: {
    compileRevision: number
    manifestRevision: string
    sourceVersions: Readonly<Record<string, string>>
  }
  version: typeof studioReviewManifestVersion
}

export type StudioReviewResult = {
  artifactRoot: string
  manifestPath: string
  reportPath: string
  statusCounts: Readonly<Record<StudioReviewPairStatus, number>>
}

export type StudioReviewOptions = {
  against?: string
  appName?: string
  artifactRoot?: string
}

type ReviewSurfaceManifest = {
  appName: string
  compileRevision: number
  entryPath: string
  manifestRevision: string
  sourceVersions: Readonly<Record<string, string>>
}

type ReviewSurfaceCell = {
  environment: unknown
  error?: string
  group: string
  key: string
  label: string
  renderInputs: unknown
  status: 'failed' | 'pending' | 'ready'
}

type ReviewSurface = {
  cells: readonly ReviewSurfaceCell[]
  manifest: ReviewSurfaceManifest
}

export type ReviewBrowser = Pick<
  StudioCdp,
  | 'browserEvents'
  | 'captureElementScreenshotAt'
  | 'close'
  | 'evaluate'
  | 'goto'
  | 'rendererFingerprint'
  | 'waitFor'
>

type StudioReviewDependencies = {
  launchBrowser: (artifactRoot: string) => Promise<ReviewBrowser>
  now: () => Date
  randomId: () => string
  startStudio: (options: {
    appName?: string
    projectRoot: string
    repositoryRoot: string
  }) => Promise<StartedStudioSmokeLaunch>
}

const defaultDependencies: StudioReviewDependencies = {
  launchBrowser: async artifactRoot => await StudioCdp.launchChrome({ artifactRoot }),
  now: () => new Date(),
  randomId: Platform.randomUUID,
  startStudio: startStudioSmokeLaunch,
}

/** runStudioReview captures every review-ready web scenario and writes a portable static report. */
export async function runStudioReview(
  projectPath = '.',
  options: StudioReviewOptions = {},
  dependencies: StudioReviewDependencies = defaultDependencies,
): Promise<StudioReviewResult> {
  const projectRoot = FS.resolvePath(projectPath)
  if (!await FS.isDirectory(projectRoot)) {
    Errors.throwUserInput(`No Tao project directory found at ${projectRoot}.`)
  }
  const repositoryRoot = Repo.getRoot(projectRoot)
  const createdAt = dependencies.now().toISOString()
  const reviewId = `${artifactTimestamp(createdAt)}-${dependencies.randomId().slice(0, 8)}`
  const artifactRoot = options.artifactRoot === undefined
    ? FS.resolvePath(`.artifacts/reviews/${reviewId}`, repositoryRoot)
    : FS.resolvePath(options.artifactRoot)
  const baseline = options.against === undefined ? undefined : await readReviewManifest(options.against)
  if (await FS.exists(artifactRoot)) {
    Errors.throwUserInput(`Review artifact directory already exists: ${artifactRoot}`)
  }
  await FS.mkdir(artifactRoot)

  let browser: ReviewBrowser | undefined
  let launch: StartedStudioSmokeLaunch | undefined
  try {
    launch = await dependencies.startStudio({
      ...(options.appName === undefined ? {} : { appName: options.appName }),
      projectRoot,
      repositoryRoot,
    })
    browser = await dependencies.launchBrowser(artifactRoot)
    await openReviewGrid(browser, launch.readiness.sessionUrl)
    const initialSurface = await readReviewSurface(browser)
    validateReviewSurface(initialSurface)
    const cells: StudioReviewCell[] = []
    for (const initialCell of initialSurface.cells) {
      cells.push(await captureReviewCell(browser, initialCell, artifactRoot, initialSurface.manifest))
    }
    // Taken last: the fingerprint records each font's load status, which settles only once the
    // captured cells have rendered.
    const renderer = await browser.rendererFingerprint()
    const browserEvents = browser.browserEvents().map(event => ({
      kind: event.kind,
      level: event.level,
      ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    }))
    await FS.writeJson(FS.resolvePath('logs/browser-events.json', artifactRoot), browserEvents)
    await FS.writeText(FS.resolvePath('logs/studio.log', artifactRoot), launch.output())
    return await writeReviewArtifacts({
      artifactRoot,
      baseline,
      cells,
      createdAt,
      renderer,
      reviewId,
      surface: initialSurface.manifest,
    })
  } catch (error) {
    await FS.writeJson(FS.resolvePath('failure.json', artifactRoot), {
      error: error instanceof Error ? error.message : String(error),
      reviewId,
      version: 1,
    })
    if (launch !== undefined) {
      await FS.writeText(FS.resolvePath('logs/studio.log', artifactRoot), launch.output())
    }
    throw error
  } finally {
    await browser?.close().catch(() => undefined)
    await launch?.stop().catch(() => undefined)
  }
}

/**
 * openReviewGrid loads a Studio session's preview grid ready for capture. Screenshots are clips of
 * the Studio page, so its floating agent chat window is hidden to keep it out of them.
 */
async function openReviewGrid(browser: ReviewBrowser, sessionUrl: string): Promise<void> {
  await browser.goto(sessionUrl)
  await browser.waitFor(
    `document.querySelector('.studio-preview-grid[data-tao-review-manifest]') instanceof HTMLElement`,
    { timeoutMs: 60_000 },
  )
  await browser.evaluate(`(() => {
    const style = document.createElement('style')
    style.textContent = '.studio-agent-panel { display: none !important; }'
    document.head.append(style)
    return true
  })()`)
}

async function captureReviewCell(
  browser: ReviewBrowser,
  initialCell: ReviewSurfaceCell,
  artifactRoot: string,
  expectedManifest: ReviewSurfaceManifest,
): Promise<StudioReviewCell> {
  const marker = `review-${Platform.randomUUID()}`
  const key = JSON.stringify(initialCell.key)
  try {
    const marked = await browser.evaluate<boolean>(`(() => {
      const key = ${key}
      const frame = [...document.querySelectorAll('.studio-preview-cell[data-tao-review-key]')]
        .find(candidate => candidate instanceof HTMLElement && candidate.dataset.taoReviewKey === key)
      if (!(frame instanceof HTMLElement)) return false
      document.querySelectorAll('[data-tao-review-capture]').forEach(element => {
        if (element instanceof HTMLElement) delete element.dataset.taoReviewCapture
      })
      frame.dataset.taoReviewCapture = ${JSON.stringify(marker)}
      frame.scrollIntoView({ block: 'center', inline: 'center' })
      return true
    })()`)
    if (!marked) {
      Errors.throwUnexpected(`Tao Studio did not expose the review cell selected for capture: ${initialCell.key}`)
    }
    await browser.waitFor(
      `(() => {
      const key = ${key}
      const frame = [...document.querySelectorAll('.studio-preview-cell[data-tao-review-key]')]
        .find(candidate => candidate instanceof HTMLElement && candidate.dataset.taoReviewKey === key)
      return frame instanceof HTMLElement && ['ready', 'failed'].includes(frame.dataset.taoReviewStatus ?? '')
    })()`,
      { timeoutMs: 60_000 },
    )
    const surface = await readReviewSurface(browser)
    validateReviewSurface(surface)
    if (!reviewSurfaceManifestsMatch(surface.manifest, expectedManifest)) {
      Errors.throwUnexpected('Tao Studio changed the visual-review manifest while screenshots were being captured.')
    }
    const current = surface.cells.find(cell => cell.key === initialCell.key)
    if (current === undefined) {
      Errors.throwUnexpected(`Tao Studio removed a visual-review cell before capture: ${initialCell.key}`)
    }
    const fileName = reviewScreenshotName(current)
    const screenshot = `screenshots/${fileName}`
    const screenshotPath = FS.resolvePath(screenshot, artifactRoot)
    const stabilityPath = FS.resolvePath(`screenshots/.stability-${fileName}`, artifactRoot)
    const selector = `[data-tao-review-capture="${marker}"] > .studio-preview-cell-viewport`
    await browser.captureElementScreenshotAt(screenshotPath, selector)
    let sha256: string
    let stabilityHash: string
    try {
      await browser.captureElementScreenshotAt(stabilityPath, selector)
      sha256 = hash(await FS.readFile(screenshotPath))
      stabilityHash = hash(await FS.readFile(stabilityPath))
    } finally {
      await FS.remove(stabilityPath)
    }
    const unstable = sha256 !== stabilityHash
    const error = [
      current.error,
      ...(unstable ? ['The preview changed between two consecutive settled captures.'] : []),
    ].filter((message): message is string => message !== undefined).join(' ')
    return {
      environment: current.environment,
      ...(error.length === 0 ? {} : { error }),
      group: current.group,
      key: current.key,
      label: current.label,
      renderInputs: current.renderInputs,
      screenshot,
      sha256,
      status: current.status === 'failed' || unstable ? 'failed' : 'captured',
    }
  } catch (error) {
    return {
      environment: initialCell.environment,
      error: error instanceof Error ? error.message : String(error),
      group: initialCell.group,
      key: initialCell.key,
      label: initialCell.label,
      renderInputs: initialCell.renderInputs,
      status: 'failed',
    }
  }
}

async function readReviewSurface(browser: ReviewBrowser): Promise<ReviewSurface> {
  const surface = await browser.evaluate<ReviewSurface | null>(`(() => {
    const grid = document.querySelector('.studio-preview-grid[data-tao-review-manifest]')
    if (!(grid instanceof HTMLElement)) return null
    const rawManifest = grid.dataset.taoReviewManifest
    if (rawManifest === undefined) return null
    return {
      manifest: JSON.parse(rawManifest),
      cells: [...grid.querySelectorAll('.studio-preview-cell[data-tao-review-key]')].map(frame => ({
        environment: JSON.parse(frame.dataset.taoReviewEnvironment ?? 'null'),
        error: frame.dataset.taoReviewError,
        group: frame.dataset.taoReviewGroup ?? '',
        key: frame.dataset.taoReviewKey ?? '',
        label: frame.dataset.taoReviewLabel ?? '',
        renderInputs: JSON.parse(frame.dataset.taoReviewRenderInputs ?? 'null'),
        status: frame.dataset.taoReviewStatus ?? 'pending',
      })),
    }
  })()`)
  if (surface === null) {
    Errors.throwHostEnvironment('Tao Studio did not publish its visual-review manifest.')
  }
  return surface
}

function validateReviewSurface(surface: ReviewSurface): void {
  if (
    typeof surface.manifest.appName !== 'string'
    || typeof surface.manifest.entryPath !== 'string'
    || typeof surface.manifest.compileRevision !== 'number'
    || typeof surface.manifest.manifestRevision !== 'string'
    || typeof surface.manifest.sourceVersions !== 'object'
  ) {
    Errors.throwUnexpected('Tao Studio exposed an invalid visual-review manifest.')
  }
  const keys = new Set<string>()
  if (surface.cells.length === 0) {
    Errors.throwUserInput('This Studio project has no reviewable scenario cells.')
  }
  for (const cell of surface.cells) {
    if (cell.key.length === 0 || cell.label.length === 0 || cell.group.length === 0) {
      Errors.throwUnexpected('Tao Studio exposed an incomplete visual-review cell.')
    }
    if (keys.has(cell.key)) {
      Errors.throwUnexpected(`Tao Studio exposed duplicate visual-review key: ${cell.key}`)
    }
    if (!['failed', 'pending', 'ready'].includes(cell.status)) {
      Errors.throwUnexpected(`Tao Studio exposed an invalid visual-review status for ${cell.key}.`)
    }
    keys.add(cell.key)
  }
}

function reviewSurfaceManifestsMatch(left: ReviewSurfaceManifest, right: ReviewSurfaceManifest): boolean {
  return left.appName === right.appName
    && left.compileRevision === right.compileRevision
    && left.entryPath === right.entryPath
    && left.manifestRevision === right.manifestRevision
    && canonicalJson(left.sourceVersions) === canonicalJson(right.sourceVersions)
}

async function writeReviewArtifacts(input: {
  artifactRoot: string
  baseline?: { manifest: StudioReviewManifest; root: string }
  cells: readonly StudioReviewCell[]
  createdAt: string
  renderer: StudioCdpRendererFingerprint
  reviewId: string
  surface: ReviewSurfaceManifest
}): Promise<StudioReviewResult> {
  if (!input.cells.every(isReviewCell)) {
    Errors.throwUnexpected('Studio review capture produced invalid cell evidence.')
  }
  validateUniqueReviewCells(input.cells, 'current review')
  const comparison = input.baseline === undefined
    ? undefined
    : await compareReviews(
      input.cells,
      input.renderer,
      input.baseline,
      input.artifactRoot,
      { appName: input.surface.appName, entryPath: input.surface.entryPath },
    )
  const manifest: StudioReviewManifest = {
    cells: input.cells,
    ...(comparison === undefined ? {} : { comparison }),
    createdAt: input.createdAt,
    project: { appName: input.surface.appName, entryPath: input.surface.entryPath },
    renderer: input.renderer,
    reviewId: input.reviewId,
    studio: {
      compileRevision: input.surface.compileRevision,
      manifestRevision: input.surface.manifestRevision,
      sourceVersions: input.surface.sourceVersions,
    },
    version: studioReviewManifestVersion,
  }
  const pairs = comparison?.pairs ?? input.cells.map(cell => ({
    ...(cell.sha256 === undefined ? {} : { currentSha256: cell.sha256 }),
    ...(cell.screenshot === undefined ? {} : { currentScreenshot: cell.screenshot }),
    key: cell.key,
    label: cell.label,
    status: cell.status === 'failed' ? 'failed' as const : 'added' as const,
  }))
  const manifestPath = FS.resolvePath('review.json', input.artifactRoot)
  const reportPath = FS.resolvePath('index.html', input.artifactRoot)
  await FS.writeJson(manifestPath, manifest)
  await FS.writeJson(FS.resolvePath('annotations.json', input.artifactRoot), {
    comments: [],
    decisions: [],
    reviewId: input.reviewId,
    version: 1,
  })
  await FS.writeText(reportPath, renderReviewHtml(manifest, pairs))
  return {
    artifactRoot: input.artifactRoot,
    manifestPath,
    reportPath,
    statusCounts: pairStatusCounts(pairs),
  }
}

async function compareReviews(
  currentCells: readonly StudioReviewCell[],
  currentRenderer: StudioCdpRendererFingerprint,
  baseline: { manifest: StudioReviewManifest; root: string },
  artifactRoot: string,
  currentProject: StudioReviewManifest['project'],
): Promise<NonNullable<StudioReviewManifest['comparison']>> {
  if (
    baseline.manifest.project.appName !== currentProject.appName
    || baseline.manifest.project.entryPath !== currentProject.entryPath
  ) {
    Errors.throwUserInput(
      `Baseline review is for ${baseline.manifest.project.appName} (${baseline.manifest.project.entryPath}), not ${currentProject.appName} (${currentProject.entryPath}).`,
    )
  }
  validateUniqueReviewCells(currentCells, 'current review')
  validateUniqueReviewCells(baseline.manifest.cells, 'baseline review')
  const rendererCompatible = rendererFingerprintsMatch(currentRenderer, baseline.manifest.renderer)
  const rendererDifference = rendererCompatible
    ? undefined
    : `Renderer changed from ${rendererLabel(baseline.manifest.renderer)} to ${rendererLabel(currentRenderer)}.`
  const currentByKey = new Map(currentCells.map(cell => [cell.key, cell]))
  const baselineByKey = new Map(baseline.manifest.cells.map(cell => [cell.key, cell]))
  const keys = [...new Set([...baselineByKey.keys(), ...currentByKey.keys()])].sort()
  const pairs: StudioReviewPair[] = []
  for (const key of keys) {
    const before = baselineByKey.get(key)
    const after = currentByKey.get(key)
    const label = after?.label ?? before?.label ?? key
    const baselineScreenshot = before?.screenshot === undefined
      ? undefined
      : await copyBaselineScreenshot(baseline.root, before.screenshot, artifactRoot, key, before.sha256)
    const baselineEvidenceMissing = before?.status === 'captured'
      && (before.sha256 === undefined || baselineScreenshot === undefined)
    pairs.push({
      ...(before?.sha256 === undefined ? {} : { baselineSha256: before.sha256 }),
      ...(baselineScreenshot === undefined ? {} : { baselineScreenshot }),
      ...(after?.sha256 === undefined ? {} : { currentSha256: after.sha256 }),
      ...(after?.screenshot === undefined ? {} : { currentScreenshot: after.screenshot }),
      key,
      label,
      status: baselineEvidenceMissing ? 'failed' : pairStatus(before, after, rendererCompatible),
    })
  }
  return {
    baselineReviewId: baseline.manifest.reviewId,
    pairs,
    rendererCompatible,
    ...(rendererDifference === undefined ? {} : { rendererDifference }),
  }
}

function pairStatus(
  before: StudioReviewCell | undefined,
  after: StudioReviewCell | undefined,
  rendererCompatible: boolean,
): StudioReviewPairStatus {
  if (before === undefined) {
    return after?.status === 'failed' ? 'failed' : 'added'
  }
  if (after === undefined) {
    return before.status === 'failed' ? 'failed' : 'removed'
  }
  if (before.status === 'failed' || after.status === 'failed') {
    return 'failed'
  }
  if (!rendererCompatible) {
    return 'incomparable'
  }
  if (
    canonicalJson(before.environment) !== canonicalJson(after.environment)
    || canonicalJson(before.renderInputs) !== canonicalJson(after.renderInputs)
  ) {
    return 'incomparable'
  }
  return before.sha256 === after.sha256 ? 'unchanged' : 'changed'
}

async function copyBaselineScreenshot(
  baselineRoot: string,
  screenshot: string,
  artifactRoot: string,
  key: string,
  expectedSha256: string | undefined,
): Promise<string | undefined> {
  const source = FS.resolvePath(screenshot, baselineRoot)
  if (!FS.pathIsWithin(source, baselineRoot) || !await FS.isFile(source) || expectedSha256 === undefined) {
    return undefined
  }
  const [realRoot, realSource] = await Promise.all([FS.realPath(baselineRoot), FS.realPath(source)])
  if (!FS.pathIsWithin(realSource, realRoot)) {
    return undefined
  }
  const bytes = await FS.readFile(realSource)
  if (hash(bytes) !== expectedSha256) {
    return undefined
  }
  const target = `baseline/${hash(Buffer.from(key)).slice(0, 12)}-${FS.basename(screenshot)}`
  await FS.writeFile(FS.resolvePath(target, artifactRoot), bytes)
  return target
}

async function readReviewManifest(path: string): Promise<{ manifest: StudioReviewManifest; root: string }> {
  const resolved = FS.resolvePath(path)
  if (!await FS.isFile(resolved)) {
    Errors.throwUserInput(`No review manifest found at ${resolved}.`)
  }
  const manifest = await FS.readJson<StudioReviewManifest>(resolved)
  if (
    manifest.version !== studioReviewManifestVersion
    || typeof manifest.reviewId !== 'string'
    || !Array.isArray(manifest.cells)
    || !manifest.cells.every(isReviewCell)
    || !isReviewProject(manifest.project)
    || !isRendererFingerprint(manifest.renderer)
  ) {
    Errors.throwUserInput(`Unsupported or invalid review manifest: ${resolved}`)
  }
  validateUniqueReviewCells(manifest.cells, 'baseline review')
  return { manifest, root: FS.dirname(resolved) }
}

function isReviewCell(value: unknown): value is StudioReviewCell {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const cell = value as Record<string, unknown>
  return typeof cell['key'] === 'string'
    && typeof cell['label'] === 'string'
    && typeof cell['group'] === 'string'
    && 'environment' in cell
    && 'renderInputs' in cell
    && (cell['status'] === 'captured' || cell['status'] === 'failed')
    && (cell['screenshot'] === undefined || typeof cell['screenshot'] === 'string')
    && (cell['sha256'] === undefined || isSha256(cell['sha256']))
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function isReviewProject(value: unknown): value is StudioReviewManifest['project'] {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const project = value as Record<string, unknown>
  return typeof project['appName'] === 'string' && typeof project['entryPath'] === 'string'
}

function validateUniqueReviewCells(cells: readonly StudioReviewCell[], label: string): void {
  const keys = new Set<string>()
  for (const cell of cells) {
    if (keys.has(cell.key)) {
      Errors.throwUserInput(`The ${label} contains duplicate cell key: ${cell.key}`)
    }
    keys.add(cell.key)
  }
}

function isRendererFingerprint(value: unknown): value is StudioCdpRendererFingerprint {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const renderer = value as Record<string, unknown>
  return (renderer['colorGamut'] === 'p3' || renderer['colorGamut'] === 'srgb' || renderer['colorGamut'] === 'unknown')
    && typeof renderer['deviceScaleFactor'] === 'number'
    && typeof renderer['fontFingerprint'] === 'string'
    && typeof renderer['jsVersion'] === 'string'
    && typeof renderer['locale'] === 'string'
    && typeof renderer['platform'] === 'string'
    && typeof renderer['product'] === 'string'
    && typeof renderer['protocolVersion'] === 'string'
    && typeof renderer['timezone'] === 'string'
    && typeof renderer['userAgent'] === 'string'
}

function rendererFingerprintsMatch(
  current: StudioCdpRendererFingerprint,
  baseline: StudioCdpRendererFingerprint,
): boolean {
  return current.colorGamut === baseline.colorGamut
    && current.deviceScaleFactor === baseline.deviceScaleFactor
    && current.fontFingerprint === baseline.fontFingerprint
    && current.jsVersion === baseline.jsVersion
    && current.locale === baseline.locale
    && current.platform === baseline.platform
    && current.product === baseline.product
    && current.protocolVersion === baseline.protocolVersion
    && current.timezone === baseline.timezone
    && current.userAgent === baseline.userAgent
}

function rendererLabel(renderer: StudioCdpRendererFingerprint): string {
  return `${renderer.product} on ${renderer.platform} at ${renderer.deviceScaleFactor}x`
}

function reviewScreenshotName(cell: Pick<ReviewSurfaceCell, 'group' | 'key' | 'label'>): string {
  const readable = `${cell.group}-${cell.label}`
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase()
    .slice(0, 60) || 'scenario'
  return `${readable}-${hash(Buffer.from(cell.key)).slice(0, 12)}.png`
}

function hash(bytes: Uint8Array): string {
  return Platform.sha256Hex(bytes)
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    return `{${
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(',')
    }}`
  }
  return JSON.stringify(value) ?? String(value)
}

function artifactTimestamp(iso: string): string {
  return iso.replaceAll(':', '-').replace(/\.\d{3}Z$/u, 'Z')
}

function pairStatusCounts(pairs: readonly StudioReviewPair[]): Record<StudioReviewPairStatus, number> {
  const counts: Record<StudioReviewPairStatus, number> = {
    added: 0,
    changed: 0,
    failed: 0,
    incomparable: 0,
    removed: 0,
    unchanged: 0,
  }
  for (const pair of pairs) {
    counts[pair.status] += 1
  }
  return counts
}

function renderReviewHtml(
  manifest: StudioReviewManifest,
  pairs: readonly StudioReviewPair[],
): string {
  const comparisonNotice = manifest.comparison?.rendererDifference === undefined
    ? ''
    : `<p class="renderer-warning">${escapeHtml(manifest.comparison.rendererDifference)}</p>`
  const cards = pairs.map(pair => {
    const before = reviewImage(pair.baselineScreenshot, `${pair.label} before`, 'before')
    const after = reviewImage(pair.currentScreenshot, `${pair.label} after`, 'after')
    return `<article class="review-card" data-key="${
      escapeAttribute(pair.key)
    }" data-status="${pair.status}" data-baseline-sha256="${
      escapeAttribute(pair.baselineSha256 ?? '')
    }" data-current-sha256="${escapeAttribute(pair.currentSha256 ?? '')}">
      <header><div><h2>${escapeHtml(pair.label)}</h2><code>${
      escapeHtml(pair.key)
    }</code></div><strong>${pair.status}</strong></header>
      <div class="images">${before}${after}</div>
      <section class="collaboration" aria-label="Review notes">
        <label>Decision <select data-decision><option value="">Unreviewed</option><option>Accept</option><option>Needs work</option><option>Question</option></select></label>
        <label>Comment side <select data-side><option value="current">Current</option><option value="baseline">Baseline</option></select></label>
        <label class="comment-label">Comment <textarea data-comment placeholder="Leave context for the next reviewer"></textarea></label>
        <button type="button" data-add-comment>Add comment</button><ul data-comments></ul>
        <p class="annotation-status" data-annotation-status aria-live="polite"></p>
      </section>
    </article>`
  }).join('\n')
  const data = JSON.stringify({ reviewId: manifest.reviewId }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tao visual review · ${escapeHtml(manifest.project.appName)}</title>
<style>
:root{color-scheme:dark;background:#101114;color:#f5f5f3;font:15px system-ui,sans-serif}body{margin:0;padding:28px}main{max-width:1600px;margin:auto}header,.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center}.toolbar{position:sticky;top:0;z-index:2;padding:12px;background:#181a20;border:1px solid #343741;border-radius:12px}button,select,textarea,input{font:inherit}.review-card{margin:24px 0;padding:18px;background:#181a20;border:1px solid #343741;border-radius:14px}.review-card>header strong{text-transform:uppercase}.review-card[data-status=changed]{border-color:#e4a853}.review-card[data-status=failed]{border-color:#f06b74}.review-card[data-status=unchanged]{opacity:.78}.review-card.reopened{box-shadow:inset 4px 0 #8f7ee7}.images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}.image{position:relative;min-height:180px;overflow:auto;background:#0a0b0d;border-radius:10px}.image img{display:block;max-width:100%;height:auto}.image span{position:absolute;top:8px;left:8px;padding:4px 7px;background:#000b;border-radius:5px}.placeholder{display:grid;place-items:center;color:#9da1ad}.collaboration{display:grid;grid-template-columns:auto auto 1fr auto;gap:10px;margin-top:16px}.comment-label{display:grid;gap:4px}.collaboration textarea{min-height:42px}.collaboration ul,.annotation-status{grid-column:1/-1}.annotation-status,.stale-annotation{color:#c1b6ff}.renderer-warning{padding:10px;background:#4b3518;border-radius:8px}code{color:#b8bdca}.blink .images,.overlay .images{display:block;position:relative}.blink .image,.overlay .image{position:absolute;inset:0}.blink .image.after{animation:blink 1.2s steps(1,end) infinite}.blink-paused .image.after{animation-play-state:paused}.overlay .image.after{opacity:var(--opacity,.5)}.blink .collaboration,.overlay .collaboration{margin-top:460px}@keyframes blink{0%,49%{opacity:0}50%,100%{opacity:1}}@media(prefers-reduced-motion:reduce){.blink .image.after{animation:none}}@media(max-width:800px){.images{grid-template-columns:1fr}.collaboration{grid-template-columns:1fr}.blink .collaboration,.overlay .collaboration{margin-top:360px}}
</style></head><body><main>
<h1>Tao visual review · ${escapeHtml(manifest.project.appName)}</h1><p>${
    escapeHtml(manifest.createdAt)
  } · ${pairs.length} scenarios</p>${comparisonNotice}
<div class="toolbar"><label>View <select id="mode"><option value="side">Side by side</option><option value="blink">Blink</option><option value="overlay">Opacity overlay</option></select></label><button id="pause-blink" type="button" disabled>Pause blink</button><label>Current opacity <input id="opacity" type="range" min="0" max="1" value="0.5" step="0.05"></label><button id="import" type="button">Import annotations</button><input id="import-file" type="file" accept="application/json,.json" hidden><button id="export" type="button">Export annotations</button></div>
<section id="cards">${cards}</section>
</main><script>
const metadata=${data};const state={version:1,reviewId:metadata.reviewId,decisions:[],comments:[]};
const cards=document.querySelector('#cards');const pauseBlink=document.querySelector('#pause-blink');document.querySelector('#mode').addEventListener('change',e=>{cards.className=e.target.value;pauseBlink.disabled=e.target.value!=='blink';pauseBlink.textContent='Pause blink'});pauseBlink.addEventListener('click',()=>{const paused=cards.classList.toggle('blink-paused');pauseBlink.textContent=paused?'Resume blink':'Pause blink'});document.querySelector('#opacity').addEventListener('input',e=>{cards.style.setProperty('--opacity',e.target.value)});
const digestPair=card=>({baselineSha256:card.dataset.baselineSha256||null,currentSha256:card.dataset.currentSha256||null});
const exact=(card,item)=>item.key===card.dataset.key&&item.baselineSha256===digestPair(card).baselineSha256&&item.currentSha256===digestPair(card).currentSha256;
const prior=(card,item)=>item.key===card.dataset.key&&item.currentSha256!==null&&item.currentSha256===digestPair(card).baselineSha256;
for(const card of document.querySelectorAll('.review-card')){const key=card.dataset.key;card.querySelector('[data-decision]').addEventListener('change',e=>{state.decisions=state.decisions.filter(x=>!exact(card,x));if(e.target.value)state.decisions.push({key,...digestPair(card),value:e.target.value})});card.querySelector('[data-add-comment]').addEventListener('click',()=>{const input=card.querySelector('[data-comment]');const text=input.value.trim();if(!text)return;state.comments.push({key,...digestPair(card),side:card.querySelector('[data-side]').value,text});renderAnnotations();input.value=''})}
function renderAnnotations(){for(const card of document.querySelectorAll('.review-card')){const key=card.dataset.key;const decisions=state.decisions.filter(item=>item.key===key);const decision=decisions.find(item=>exact(card,item));card.querySelector('[data-decision]').value=decision?.value??'';const list=card.querySelector('[data-comments]');list.replaceChildren();for(const earlier of decisions.filter(item=>!exact(card,item))){const row=document.createElement('li');row.className='stale-annotation';row.textContent='Earlier decision · '+earlier.value;list.append(row)}const related=state.comments.filter(item=>item.key===key);for(const comment of related){const row=document.createElement('li');const stale=!exact(card,comment);row.className=stale?'stale-annotation':'';row.textContent=(stale?'Earlier capture · ':'')+comment.side+': '+comment.text;list.append(row)}const reopened=decisions.some(item=>!exact(card,item))||related.some(item=>!exact(card,item));card.classList.toggle('reopened',reopened);card.querySelector('[data-annotation-status]').textContent=reopened?(decisions.some(item=>prior(card,item))||related.some(item=>prior(card,item))?'Reopened: annotations from the new baseline are preserved, but the comparison changed.':'Stale annotations are preserved for context; review these pixels again.') : ''}}
const digest=value=>value===null||/^[a-f0-9]{64}$/u.test(value)?value:undefined;
const decisionValues=new Set(['Accept','Needs work','Question']);
const validBase=item=>item&&typeof item==='object'&&typeof item.key==='string'&&digest(item.baselineSha256)!==undefined&&digest(item.currentSha256)!==undefined;
const validDecision=item=>validBase(item)&&decisionValues.has(item.value);
const validComment=item=>validBase(item)&&(item.side==='current'||item.side==='baseline')&&typeof item.text==='string'&&item.text.trim().length>0;
const annotationId=item=>JSON.stringify([item.key,item.baselineSha256,item.currentSha256]);const commentId=item=>JSON.stringify([annotationId(item),item.side,item.text]);const importFile=document.querySelector('#import-file');document.querySelector('#import').addEventListener('click',()=>importFile.click());importFile.addEventListener('change',async()=>{const file=importFile.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!parsed||parsed.version!==1||typeof parsed.reviewId!=='string'||!Array.isArray(parsed.decisions)||!Array.isArray(parsed.comments)||!parsed.decisions.every(validDecision)||!parsed.comments.every(validComment)){window.alert('This is not a valid Tao review annotations file.');return}state.decisions=[...new Map([...state.decisions,...parsed.decisions.map(item=>({...item,sourceReviewId:item.sourceReviewId??parsed.reviewId}))].map(item=>[annotationId(item),item])).values()];state.comments=[...new Map([...state.comments,...parsed.comments.map(item=>({...item,text:item.text.trim(),sourceReviewId:item.sourceReviewId??parsed.reviewId}))].map(item=>[commentId(item),item])).values()];renderAnnotations()}catch(error){window.alert(error instanceof Error?error.message:String(error))}finally{importFile.value=''}});
document.querySelector('#export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)+'\\n'],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='annotations.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0)});
</script></body></html>\n`
}

function reviewImage(path: string | undefined, alt: string, side: 'after' | 'before'): string {
  return path === undefined
    ? `<div class="image ${side} placeholder"><span>${side}</span>No capture</div>`
    : `<div class="image ${side}"><span>${side}</span><img src="${escapeAttribute(path)}" alt="${
      escapeAttribute(alt)
    }"></div>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;')
}

export const StudioReview = {
  /** The per-cell capture steps, for callers that drive one Studio session through several captures. */
  capture: {
    cell: captureReviewCell,
    open: openReviewGrid,
    surface: async (browser: ReviewBrowser): Promise<ReviewSurface> => {
      const surface = await readReviewSurface(browser)
      validateReviewSurface(surface)
      return surface
    },
  },
  testing: {
    pairStatus,
    renderReviewHtml,
    rendererFingerprintsMatch,
    reviewScreenshotName,
    writeReviewArtifacts,
  },
} as const
