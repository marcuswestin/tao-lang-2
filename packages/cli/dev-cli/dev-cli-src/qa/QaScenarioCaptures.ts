import { CLI, Errors, FS, HCI, Json, Platform } from '@shared'
import { type QaScenarioApp, QaScenarioApps } from './QaScenarioApps'

type Cell = QaScenarioApp['cells'][number]
type CapturedCell = Cell & {
  status: 'captured' | 'failed' | 'missing'
  screenshot?: string
  sha256?: string
  error?: string
}
type AppCapture = {
  surfaceId: string
  project: string
  app: string
  output: string
  status: 'complete' | 'partial' | 'failed'
  cells: CapturedCell[]
  unexpectedCells: Cell[]
  error?: string
}
type CaptureApp = (app: QaScenarioApp, output: string, timeoutMs: number) => Promise<void>

/** Captures discovered apps sequentially. Each child has a parent-enforced process-tree deadline. */
export class QaScenarioCaptures {
  constructor(
    private readonly root: string,
    private readonly captureApp: CaptureApp = async (app, output, timeoutMs) => {
      const result = await CLI.run('./dev', {
        args: ['qa-capture', app.project, '--app', app.app, '--output', output],
        cwd: root,
        processPolicy: 'test',
        timeoutPolicy: 'bounded',
        timeoutMs,
      })
      await FS.writeText(FS.resolvePath(`${output}.log`, root), `${result.stdout}\n${result.stderr}`)
      if (result.exitCode !== 0 || result.error !== undefined) {
        Errors.throwHostEnvironment(
          `Capture exited ${String(result.exitCode)} (${String(result.signal)}); see ${output}.log.`,
        )
      }
    },
  ) {}

  async run(options: { output: string; timeoutSeconds: number }): Promise<{
    report: string
    status: 'complete' | 'partial'
    apps: AppCapture[]
    discoveryFailures: { source: string; error: string }[]
    uncoveredApps: { source: string; app: string }[]
    counts: Record<CapturedCell['status'], number>
  }> {
    if (
      !Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 0.001
      || options.timeoutSeconds * 1_000 > 2_147_483_647
    ) {
      Errors.throwUserInput('QA capture timeout must be between 0.001 and 2147483 seconds per app.')
    }
    const output = FS.resolvePath(options.output, this.root)
    if (!FS.pathIsWithin(output, FS.resolvePath('.artifacts', this.root)) || await FS.exists(output)) {
      Errors.throwUserInput("QA capture batch output must be a new directory inside this checkout's .artifacts.")
    }
    const discovery = await new QaScenarioApps(this.root).discover()
    await FS.mkdirWithinBoundary(output, this.root)
    const reportPath = FS.resolvePath('coverage.json', output)
    const report = {
      report: FS.relativePath(this.root, reportPath),
      status: 'partial' as 'complete' | 'partial',
      apps: [] as AppCapture[],
      discoveryFailures: discovery.failures,
      uncoveredApps: discovery.uncovered,
      counts: { captured: 0, failed: 0, missing: 0 },
    }
    // Persist expected coverage first: interruption must not erase apps that never launched.
    for (const [index, app] of discovery.apps.entries()) {
      report.apps.push({
        surfaceId: app.id,
        project: app.project,
        app: app.app,
        output: FS.relativePath(this.root, FS.resolvePath(`app-${index + 1}`, output)),
        status: 'partial',
        cells: app.cells.map(cell => ({ ...cell, status: 'missing', error: 'Capture has not run.' })),
        unexpectedCells: [],
      })
    }
    report.counts.missing = report.apps.reduce((count, app) => count + app.cells.length, 0)
    await FS.writeJson(reportPath, report)
    for (const [index, app] of discovery.apps.entries()) {
      const capture = report.apps[index]!
      HCI.writeLine(
        `QA capture ${
          index + 1
        }/${discovery.apps.length}: ${app.project} / ${app.app} (${options.timeoutSeconds}s budget)`,
      )
      try {
        await this.captureApp(app, capture.output, options.timeoutSeconds * 1_000)
        await this.readCapture(app, capture)
      } catch (error) {
        capture.status = 'failed'
        capture.error = Errors.formatForUser(error)
        // A failed launch can still leave useful, explicitly partial cell evidence.
        await this.readCapture(app, capture).catch(() => undefined)
        capture.status = 'failed'
        for (const cell of capture.cells) {
          if (cell.status === 'missing' && cell.error === 'Capture has not run.') {
            cell.error = `Capture failed before this cell was recorded: ${capture.error}`
          }
        }
      }
      report.counts = { captured: 0, failed: 0, missing: 0 }
      for (const cell of report.apps.flatMap(item => item.cells)) {
        report.counts[cell.status] += 1
      }
      await FS.writeJson(reportPath, report)
      HCI.writeLine(
        `QA capture ${app.app}: ${capture.status}; ${
          capture.cells.filter(cell => cell.status !== 'captured').length
        } missing or failed cells`,
      )
    }
    report.status = report.apps.length > 0 && report.discoveryFailures.length === 0
        && report.apps.every(app => app.status === 'complete')
      ? 'complete'
      : 'partial'
    await FS.writeJson(reportPath, report)
    return report
  }

  private async readCapture(app: QaScenarioApp, capture: AppCapture): Promise<void> {
    const path = FS.resolvePath(`${capture.output}/source-snapshot.json`, this.root)
    if (!await FS.isFile(path)) {
      capture.error ??= 'Capture produced no source snapshot; all expected cells are missing.'
      return
    }
    const snapshot = await FS.readJson<{
      owner: string
      app: string
      originalProject: string
      status: string
      cells: { key: string; group: string; label: string; status: string; screenshot?: string; sha256?: string }[]
    }>(path)
    if (
      snapshot.owner !== 'qa-capture' || snapshot.app !== app.app
      || snapshot.originalProject !== await FS.realPath(FS.resolvePath(app.project, this.root))
      || !Array.isArray(snapshot.cells)
    ) {
      Errors.throwHostEnvironment('Capture snapshot does not identify the expected project and app.')
    }
    const actual = snapshot.cells.map(cell => {
      const key = Json.tryParse(cell.key)
      return { ...cell, source: Array.isArray(key) && typeof key[0] === 'string' ? key[0] : '' }
    })
    const sameCell = (left: Cell, right: Cell) =>
      left.source === right.source && left.group === right.group && left.label === right.label
    capture.cells = await Promise.all(app.cells.map(async expected => {
      const found = actual.filter(cell => sameCell(expected, cell))
      if (found.length !== 1) {
        return { ...expected, status: 'missing' as const, error: `Expected one capture cell; found ${found.length}.` }
      }
      const cell = found[0]!
      const screenshot = cell.screenshot && FS.resolvePath(cell.screenshot, FS.resolvePath(capture.output, this.root))
      const validImage = screenshot && FS.pathIsWithin(screenshot, FS.resolvePath(capture.output, this.root))
        && await FS.isFile(screenshot) && !await FS.isSymbolicLink(screenshot)
        && FS.pathIsWithin(await FS.realPath(screenshot), await FS.realPath(FS.resolvePath(capture.output, this.root)))
        && (await FS.readFile(screenshot)).length > 0
        && Platform.sha256Hex(await FS.readFile(screenshot)) === cell.sha256
      return {
        ...expected,
        status: cell.status === 'captured' && validImage ? 'captured' as const : 'failed' as const,
        ...(cell.screenshot ? { screenshot: cell.screenshot } : {}),
        ...(cell.sha256 ? { sha256: cell.sha256 } : {}),
        ...(cell.status !== 'captured' || !validImage
          ? { error: 'Cell failed or its screenshot is missing or changed.' }
          : {}),
      }
    }))
    capture.unexpectedCells = actual.filter(cell => !app.cells.some(expected => sameCell(expected, cell)))
      .map(({ source, group, label }) => ({ source, group, label }))
    capture.status = snapshot.status === 'complete' && capture.cells.every(cell => cell.status === 'captured')
        && capture.unexpectedCells.length === 0
      ? 'complete'
      : 'partial'
  }
}
