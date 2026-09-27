import { CLI, Errors, FS, HCI, Platform, Repo, Switch } from '@shared'
import { runBrowserHostProof } from './BrowserHostProof'
import { runPlaywrightHostDriverProof } from './DriverHostProof'
import { HostTestingArtifacts } from './HostTestingArtifacts'
import { runHostTestingMaintenance } from './HostTestingMaintenance'
import {
  type HostTestingContext,
  type HostTestingOptions,
  type HostTestingRequest,
  parseHostTestingRequest,
} from './HostTestingRequest'
import { validateNativeIosAppOutput } from './native/NativeIosAppExport'
import { runNativeHostProofCommand } from './NativeHostProofCommand'

/** Public command entry for explicitly selected host tests; ordinary suites never discover these tests. */
export async function runHostTesting(mode: string, options: HostTestingOptions): Promise<void> {
  const request = parseHostTestingRequest(mode, options)
  const context = await createHostTestingContext(request)
  HCI.writeLine(`Host-testing artifacts: ${context.artifactRoot}`)
  await HostTestingArtifacts.begin(context.runId, mode)
  await pruneWithWarning()
  let passed = false
  try {
    await dispatchHostTestingRequest(request, context)
    passed = true
  } finally {
    // A failed proof keeps bounded diagnostic artifacts; a killed process is reclaimed by a later
    // ordinary invocation once its PID is gone and the grace period has elapsed.
    await HostTestingArtifacts.finish(context.runId, passed ? 'passed' : 'failed').catch(error => {
      HCI.writeLine(`WARN Host-testing receipt could not be finished: ${Errors.messageOf(error)}`)
    })
    await pruneWithWarning()
  }
}

async function pruneWithWarning(): Promise<void> {
  await HostTestingArtifacts.prune().catch(error => {
    HCI.writeLine(`WARN Host-testing artifact cleanup did not finish: ${Errors.messageOf(error)}`)
  })
}

/** Validates an explicit Xcode selection before artifact creation, pruning, builds, or device operations. */
export async function createHostTestingContext(
  request: HostTestingRequest,
  dependencies: {
    environment?: Record<string, string | undefined>
    files?: Pick<typeof FS, 'isDirectory' | 'isFile' | 'realPath'>
    hostPlatform?: string
    run?: typeof CLI.run
  } = {},
): Promise<HostTestingContext> {
  if (request.kind === 'native' && request.mode === 'ios' && request.output !== undefined) {
    await validateNativeIosAppOutput(request.output)
  }
  const environment = { ...(dependencies.environment ?? Platform.runtimeProcess.env) }
  if (request.kind === 'catalyst' || request.kind === 'native' && request.mode !== 'android') {
    // CocoaPods' Ruby normalization fails under the C locale before installing any pods.
    environment['LANG'] = 'en_US.UTF-8'
    environment['LC_ALL'] = 'en_US.UTF-8'
  }
  if ('developerDir' in request && request.developerDir !== undefined) {
    const files = dependencies.files ?? FS
    const execute = dependencies.run ?? CLI.run
    if ((dependencies.hostPlatform ?? Platform.hostPlatform) !== 'darwin') {
      Errors.throwHostEnvironment('--developer-dir requires a macOS host.')
    }
    if (
      !await files.isDirectory(request.developerDir)
      || !await files.isFile(`${request.developerDir}/usr/bin/xcodebuild`)
    ) {
      Errors.throwHostEnvironment(
        `The selected Xcode Developer directory is missing or incomplete: ${request.developerDir}`,
      )
    }
    environment['DEVELOPER_DIR'] = await files.realPath(request.developerDir)
    for (const args of [['-version'], ['-checkFirstLaunchStatus']]) {
      const result = await execute('/usr/bin/xcodebuild', { args, env: environment })
      if (
        result.exitCode !== 0 || result.error || result.signal !== null
        || args[0] === '-version' && !/^Xcode \d/mu.test(result.stdout)
      ) {
        Errors.throwHostEnvironment(
          `Selected Xcode is not ready: ${
            result.stderr || result.stdout || result.error?.message || request.developerDir
          }. Complete its first-launch and license prompts in Xcode before rerunning.`,
        )
      }
    }
    const resolved = await execute('/usr/bin/xcrun', { args: ['--find', 'xcodebuild'], env: environment })
    if (
      resolved.exitCode !== 0 || resolved.error || resolved.signal !== null
      || resolved.stdout.trim() !== `${environment['DEVELOPER_DIR']}/usr/bin/xcodebuild`
    ) {
      Errors.throwHostEnvironment(
        `xcrun did not resolve xcodebuild inside the selected Developer directory: ${request.developerDir}`,
      )
    }
  }
  const runId = Platform.randomUUID()
  const artifactRoot = Repo.resolvePath(`.artifacts/host-testing/${runId}`)
  return {
    artifactRoot,
    environment: {
      ...environment,
      TAO_HOST_TEST_APP: request.subject,
      TAO_HOST_TEST_ARTIFACTS: artifactRoot,
      TAO_HOST_TEST_BROWSER_CHANNEL: request.browserChannel,
      TAO_HOST_TEST_RUN_ID: runId,
      TAO_HOST_TEST_SEED: String(request.seed),
    },
    playwright: Repo.resolvePath('packages/testing/e2e-testing/node_modules/@playwright/test/cli.js'),
    runId,
  }
}

async function dispatchHostTestingRequest(request: HostTestingRequest, context: HostTestingContext): Promise<void> {
  await Switch.kind<HostTestingRequest, Promise<void>>(request, {
    browser: browserRequest => runBrowserHostProof(browserRequest, context),
    driver: driverRequest => runPlaywrightHostDriverProof(driverRequest, context),
    maintenance: maintenanceRequest => runHostTestingMaintenance(maintenanceRequest, context),
    native: nativeRequest => runNativeHostProofCommand(nativeRequest, context),
    catalyst: async catalystRequest => {
      const { runCatalystBuild } = await import('./native/CatalystBuild')
      await runCatalystBuild(catalystRequest, context)
    },
  })
}
