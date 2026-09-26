import { Errors, HCI, Platform, Repo, Switch } from '@shared'
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

async function createHostTestingContext(request: HostTestingRequest): Promise<HostTestingContext> {
  const runId = Platform.randomUUID()
  const artifactRoot = Repo.resolvePath(`.artifacts/host-testing/${runId}`)
  return {
    artifactRoot,
    environment: {
      ...Platform.runtimeProcess.env,
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
  })
}
