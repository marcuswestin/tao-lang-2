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
  checks: readonly Readonly<{
    instruction: string
    status: 'failed' | 'not-run' | 'passed'
  }>[]
  launchExitCode: number
  status: 'failed' | 'passed'
  version: 1
}

type StudioManualCheckOptions = {
  appName?: string
  artifactRoot?: string
  hutchPath?: string
  projectRoot?: string
}

type StudioManualCheckDependencies = {
  askConfirm: (options: { defaultValue: boolean; message: string }) => Promise<boolean>
  isInteractive: () => boolean
  runStudio: (options: StudioDevOptions) => Promise<number>
  writeLine: (message: string) => void
}

const systemDependencies: StudioManualCheckDependencies = {
  askConfirm: HCI.askConfirm,
  isInteractive: HCI.isInteractive,
  runStudio: runStudioDev,
  writeLine: HCI.writeLine,
}

/** Opens visible native Studio and records a person's answers after the final window closes. */
async function run(
  options: StudioManualCheckOptions = {},
  dependencies: StudioManualCheckDependencies = systemDependencies,
): Promise<number> {
  if (!dependencies.isInteractive()) {
    throw new Errors.UserInputError('Studio manual checks require an interactive terminal and desktop session.')
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
  dependencies.writeLine('Complete them in order; closing the final window returns to this terminal.')

  const launchExitCode = await dependencies.runStudio({
    appName,
    browser: true,
    native: true,
    nativeArtifactRoot: FS.resolvePath('electrobun', artifactRoot),
    nativeHutchPath: options.hutchPath,
    projectRoot,
  })
  const checks: Array<StudioManualCheckReport['checks'][number]> = []
  if (launchExitCode === 0) {
    for (const instruction of STUDIO_MANUAL_CHECKS) {
      checks.push({
        instruction,
        status: await dependencies.askConfirm({
            defaultValue: false,
            message: `Passed: ${instruction}`,
          })
          ? 'passed'
          : 'failed',
      })
    }
  } else {
    checks.push(...STUDIO_MANUAL_CHECKS.map(instruction => ({ instruction, status: 'not-run' as const })))
  }
  const report: StudioManualCheckReport = {
    checks,
    launchExitCode,
    status: launchExitCode === 0 && checks.every(check => check.status === 'passed') ? 'passed' : 'failed',
    version: 1,
  }
  const reportPath = FS.resolvePath('manual-checks.json', artifactRoot)
  await FS.writeJson(reportPath, report)
  dependencies.writeLine(format(report))
  dependencies.writeLine(`\nReport: ${FS.displayPath(reportPath)}`)
  return report.status === 'passed' ? 0 : 1
}

function format(report: StudioManualCheckReport): string {
  return report.checks.map(check => `${check.status.toUpperCase().padEnd(7)} ${check.instruction}`).join('\n')
}

export const StudioManualChecks = { run } as const
