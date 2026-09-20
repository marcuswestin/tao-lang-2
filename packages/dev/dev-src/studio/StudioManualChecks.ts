import { Errors, FS, HCI, Repo } from '@shared'
import { resolveCanaryTarget } from './StudioCanary'
import { runStudioDev, type StudioDevOptions } from './StudioDev'

/** Human-owned native behaviours intentionally excluded from test, verify, and canary. */
export const STUDIO_MANUAL_CHECKS = [
  'Choose File > Open Project…, select a Tao project, and confirm a second project window opens.',
  'Press Command-W and confirm exactly one Studio window closes.',
  'Close the final Studio window and confirm Tao Studio quits.',
] as const

type StudioManualCheckReport = {
  checks: readonly string[]
  launchExitCode: number
  status: 'launched'
  version: 2
}

type StudioManualCheckOptions = {
  appName?: string
  artifactRoot?: string
  hutchPath?: string
  projectRoot?: string
}

type StudioManualCheckDependencies = {
  isInteractive: () => boolean
  runStudio: (options: StudioDevOptions) => Promise<number>
  writeLine: (message: string) => void
}

const systemDependencies: StudioManualCheckDependencies = {
  isInteractive: HCI.isInteractive,
  runStudio: runStudioDev,
  writeLine: HCI.writeLine,
}

/** Opens visible native Studio for a person to judge, and ends when they stop it. */
async function run(
  options: StudioManualCheckOptions = {},
  dependencies: StudioManualCheckDependencies = systemDependencies,
): Promise<number> {
  if (!dependencies.isInteractive()) {
    Errors.throwUserInput('Studio manual checks require an interactive terminal and desktop session.')
  }
  const repositoryRoot = Repo.getRoot()
  const artifactRoot = FS.resolvePath(
    options.artifactRoot ?? '.artifacts/tests/studio-manual-checks',
    repositoryRoot,
  )
  await FS.mkdir(artifactRoot)
  const { appName, projectRoot } = resolveCanaryTarget(options, repositoryRoot)
  dependencies.writeLine('Tao Studio will open for these manual checks:')
  for (const [index, instruction] of STUDIO_MANUAL_CHECKS.entries()) {
    dependencies.writeLine(`${index + 1}. ${instruction}`)
  }
  dependencies.writeLine(
    'Complete them in order. Closing the last window leaves the dev server running, so press Ctrl-C'
      + ' when you are done; that is how this workflow ends, and it is not a failure.',
  )

  const launchExitCode = await dependencies.runStudio({
    appName,
    browser: true,
    native: true,
    nativeArtifactRoot: FS.resolvePath('electrobun', artifactRoot),
    nativeHutchPath: options.hutchPath,
    projectRoot,
  })
  const report: StudioManualCheckReport = {
    checks: STUDIO_MANUAL_CHECKS,
    launchExitCode,
    status: 'launched',
    version: 2,
  }
  const reportPath = FS.resolvePath('manual-checks.json', artifactRoot)
  await FS.writeJson(reportPath, report)
  dependencies.writeLine(
    `\nStudio closed. The verdict on the checks above is yours; this run records only that it ran.`,
  )
  dependencies.writeLine(`Report: ${FS.displayPath(reportPath)}`)
  return 0
}

export const StudioManualChecks = { run } as const

/**
 * This workflow used to ask, after the launch returned, whether each check above had passed, and to
 * exit non-zero when one had not. That tail is removed, deliberately and temporarily.
 *
 * Closing the last Studio window does not end the run: the browser dev server this workflow also
 * starts keeps the process alive, so the only way back to the terminal is Ctrl-C. `StudioDev`
 * handles that signal and returns 130, which the removed tail read as a failed launch — it skipped
 * every question, recorded all three checks `not-run`, and exited 1. So a person who completed all
 * three checks successfully ended with `verify-repo` reporting a failure, which is the opposite of
 * what they had just seen. Answering the questions was not possible at all.
 *
 * What has to exist before the questions can come back is a way for this workflow to know the person
 * is finished without being interrupted: the dev server stopping itself once the last native window
 * closes, or a launch mode that waits for the windows alone. Until then the run's only claim is that
 * it opened Studio, and the checks' verdict stays with the person who watched them — which is what a
 * manual check is. Restore the questions together with that ending, not before it.
 */
