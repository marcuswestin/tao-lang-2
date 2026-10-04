import { findProjectRoot, ProjectTooling, type ProjectToolingResult } from '@project-tooling'
import { Errors, FS, HCI, Platform } from '@shared'
import { TaoAppModules } from './app-modules'
import * as DiagnosticReport from './diagnostic-report'

function report(result: ProjectToolingResult): void {
  for (const diagnostic of result.diagnostics) {
    HCI.writeErrorLine(DiagnosticReport.renderDiagnostic(diagnostic))
  }
  HCI.writeLine(`Tao project ${result.status} (revision ${result.revision}).`)
}

/** Refresh saved files and keep their contracts current until the process is stopped. */
export async function runTaoWatch(targetPath = '.'): Promise<number> {
  const path = FS.resolvePath(targetPath)
  const root = await findProjectRoot(path)
  if (root === undefined) {
    Errors.throwUserInput(`No Tao project root was found from ${path}. Add a .tao directory to the project root.`)
  }
  const watch = await ProjectTooling.watch(root, {
    runtimeRoot: TaoAppModules.runtimeRoot(),
    onResult: report,
    onError: error => HCI.writeErrorLine(Errors.formatForUser(error)),
  })
  let stop: (() => void) | undefined
  const stopped = new Promise<void>(resolve => {
    stop = resolve
  })
  const removeSigint = Platform.onProcessSignal('SIGINT', () => stop?.())
  const removeSigterm = Platform.onProcessSignal('SIGTERM', () => stop?.())
  try {
    await stopped
    return watch.lastResult.status === 'fresh' ? 0 : 1
  } finally {
    removeSigint()
    removeSigterm()
    await watch.dispose()
  }
}
