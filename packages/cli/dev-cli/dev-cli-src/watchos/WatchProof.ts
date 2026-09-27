import { Workspace } from '@compiler/workspace'
import { Assert, CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { exportWatchOSProject } from '@tao-cli/watchos-project'
import { compileHostJourney } from '../../../../testing/e2e-testing/journey/HostJourney'
import { prepareWatchJourney } from '../../../../testing/e2e-testing/native/watchos/WatchJourneyRunner'

/** Build the native watch example, optionally exercising its authored journey on an explicit simulator. */
export async function runWatchProof(options: { app: string; device?: string; fault?: boolean }): Promise<void> {
  if (options.app !== 'watchhello' || options.fault) {
    Errors.throwUserInput('The watchOS proof requires --app watchhello and does not support --fault.')
  }
  const root = Repo.resolvePath(`.artifacts/watchos-proof/${Platform.randomUUID()}`)
  const journey = await compileHostJourney(Repo.resolvePath('Apps/WatchHello/WatchHello.test.tao'), {
    suite: 'WatchHello',
    check: 'records one set and resets',
  })
  const tests = await prepareWatchJourney({
    journey,
    bundleIdentifier: 'com.devtao.preview.watchhello',
    outputDirectory: FS.resolvePath('journey', root),
  })
  const compiled = await Workspace.compile(Repo.resolvePath('Apps/WatchHello/WatchHello.tao'), {
    appName: 'WatchHello',
    target: 'watchos',
  })
  Assert.defined(compiled.entryArtifact, 'watch compilation provides an entry artifact')
  const project = await exportWatchOSProject({
    appName: 'WatchHello',
    displayName: compiled.displayName,
    outputRoot: FS.resolvePath('project', root),
    files: compiled.files,
    entryArtifact: compiled.entryArtifact,
    tests,
  })
  HCI.writeLine(`watchOS proof: ${root}`)
  const destination = options.device === undefined
    ? 'generic/platform=watchOS Simulator'
    : `platform=watchOS Simulator,id=${options.device}`
  await CLI.mustRun('xcodebuild', {
    args: [
      '-project',
      project,
      '-scheme',
      'TaoWatch',
      '-sdk',
      'watchsimulator',
      '-destination',
      destination,
      '-derivedDataPath',
      FS.resolvePath('DerivedData', root),
      '-resultBundlePath',
      FS.resolvePath('Results.xcresult', root),
      'CODE_SIGNING_ALLOWED=NO',
      '-quiet',
      options.device === undefined ? 'build-for-testing' : 'test',
    ],
    cwd: Repo.getRoot(),
    stdio: 'inherit',
    processPolicy: 'test',
    timeoutMs: 900_000,
  })
  HCI.writeLine(
    options.device === undefined
      ? 'Native watch app and UI-test bundle compiled. Pass --device <watch-simulator-UUID> to run the Tao journey.'
      : 'Native watch Tao journey completed. Physical watch signing and visual acceptance remain unverified.',
  )
}
