import {
  type AppiumServer,
  type AppiumSession,
  createAppiumHttpTransport,
  createAppiumWebDriverClient,
  startMobileAppiumServer,
} from '@appium-driver'
import { type HostRevision, type MachineResourceLease, MachineResources } from '@host-control'
import { Assert, CLI, Errors, FS, HCI, Platform, Repo, Switch, Time } from '@shared'
import type { HostBuild, PrepareHostAppOptions } from './app-build/HostBuild'
import type { HostTestingContext, SimulatorNativeHostTestingRequest } from './HostTestingRequest'
import { compileHostJourney, type HostJourney, type HostJourneyOperation } from './journey/HostJourney'
import {
  androidTargetLeaseName,
  createAppiumAndroidController,
} from './native/appium-android/AppiumAndroidController'
import { runAppiumAndroidHostProof } from './native/appium-android/AppiumAndroidHostProof'
import { runAppiumIosHostProof } from './native/appium/AppiumIosHostProof'
import { createAppiumXcuiTestController, iosTargetLeaseName } from './native/appium/AppiumXcuiTestController'
import { proveAppiumBackgroundResume } from './native/AppiumBackgroundResumeProof'
import { appiumAndroidClient, appiumXcuiTestClient } from './native/AppiumMobileClients'
import { exportNativeIosApp } from './native/NativeIosAppExport'

type AppiumMobilePlatform = 'android' | 'ios'
type AppiumProof =
  | Awaited<ReturnType<typeof runAppiumAndroidHostProof>>
  | Awaited<ReturnType<typeof runAppiumIosHostProof>>

/** Runs the authored Tao journey through a real Appium mobile driver and preserves its evidence. */
export async function runAppiumNativeHostProofCommand(
  request: SimulatorNativeHostTestingRequest,
  context: HostTestingContext,
  build: (input: PrepareHostAppOptions) => Promise<HostBuild>,
): Promise<void> {
  const platform = request.mode
  const preparation = await build({
    artifactRoot: context.artifactRoot,
    runId: context.runId,
    seed: request.seed,
    subject: request.subject,
  })
  if (request.buildOnly) {
    return await runIosBuildOnly(request, context, preparation)
  }
  const revision: HostRevision = Object.freeze({
    build: preparation.compiledArtifactDigest,
    source: preparation.entrySourceDigest,
  })
  const journey = await journeyFor(request.subject)
  const driver = platform === 'ios' ? 'xcuitest' : 'uiautomator2'
  const targetLease = await acquireTargetLease(platform, request.device, preparation.appId, context.runId)
  let server: AppiumServer | undefined
  let proof: AppiumProof | undefined
  let proofFailure: unknown
  let lifecycleProved = false
  let timerSampleProved = false
  let cleanupFailures: readonly AppiumCleanupFailure[] = []
  try {
    await buildAndInstall(platform, request.device, preparation, context.environment)
    if (request.output !== undefined) {
      await exportNativeIosApp({
        appPath: await builtIosAppPath(preparation),
        output: request.output,
        environment: context.environment,
        appId: preparation.appId,
        runId: context.runId,
      })
    }
    server = await startMobileAppiumServer({
      artifactRoot: context.artifactRoot,
      driver,
      environment: context.environment,
      runId: context.runId,
    })
    await FS.writeText(FS.resolvePath('appium/server.url.txt', context.artifactRoot), `${server.url}\n`)
    const client = createAppiumWebDriverClient(createAppiumHttpTransport({ serverUrl: server.url }))
    let mobileSession: AppiumSession | undefined
    const factory: typeof client = {
      async createSession(capabilities) {
        mobileSession = await client.createSession(capabilities)
        return mobileSession
      },
    }
    let earliestTimerStartMs: number | undefined
    let observedBackgroundMs: number | undefined
    const afterOperation = request.subject !== 'syntax2' ? undefined : async (operation: HostJourneyOperation) => {
      if (operation.kind === 'expect' && operation.text === 'Native timer ready') {
        earliestTimerStartMs = Time.nowMs()
        return
      }
      if (operation.kind === 'press' && operation.text === 'Sample native timer') {
        Assert.defined(earliestTimerStartMs, 'Timing acceptance brackets the timer start before backgrounding.')
        Assert.defined(observedBackgroundMs, 'Timing acceptance observes the actual background interval.')
        const foregroundUpperBoundMs = Time.nowMs() - earliestTimerStartMs - observedBackgroundMs
        await FS.writeJson(FS.resolvePath('appium/timer-sample-window.json', context.artifactRoot), {
          foregroundUpperBoundMs,
          observedBackgroundMs,
        })
        // This bound prevents a paused clock passing merely because automation spent 10s in the foreground.
        if (foregroundUpperBoundMs >= 10_000) {
          return Errors.throwHostEnvironment(
            'Native timing proof is inconclusive: foreground automation took too long to distinguish background time.',
          )
        }
        timerSampleProved = true
        return
      }
      if (operation.kind !== 'press' || operation.text !== 'Start native timer') {
        return
      }
      Assert.defined(mobileSession, 'The native lifecycle proof requires the opened mobile session.')
      const evidence = await proveAppiumBackgroundResume({ appId: preparation.appId, session: mobileSession })
      observedBackgroundMs = evidence.backgroundWaitCompletedAtMs - evidence.backgroundObservedAtMs
      await FS.writeJson(FS.resolvePath('appium/background-resume.json', context.artifactRoot), evidence)
      lifecycleProved = true
    }
    const fault = preparation.fault === undefined ? undefined : appiumFault(preparation.fault.kind, journey)
    const control = nativeClockControl(platform, request.device, preparation, context.runId, context.environment)
    proof = platform === 'ios'
      ? await runAppiumIosHostProof({
        afterOperation,
        artifactRoot: context.artifactRoot,
        control,
        controller: createAppiumXcuiTestController({
          client: appiumXcuiTestClient(factory),
          preheldTargetLease: nonReleasingTargetLease(targetLease),
          target: { appId: preparation.appId, kind: 'simulator', udid: request.device },
        }),
        ...(fault === undefined ? {} : { fault }),
        journey,
        revision,
        runId: context.runId,
        target: `ios-simulator:${request.device}`,
      })
      : await runAppiumAndroidHostProof({
        afterOperation,
        artifactRoot: context.artifactRoot,
        control,
        controller: createAppiumAndroidController({
          build: {
            apkPath: androidApkPath(preparation),
            compiledArtifactDigest: preparation.compiledArtifactDigest,
          },
          client: appiumAndroidClient(factory),
          preheldTargetLease: nonReleasingTargetLease(targetLease),
          target: { appId: preparation.appId, kind: 'emulator', serial: request.device },
        }),
        ...(fault === undefined ? {} : { fault }),
        journey,
        revision,
        runId: context.runId,
        target: `android-emulator:${request.device}`,
      })
  } catch (error) {
    proofFailure = error
  } finally {
    cleanupFailures = await cleanupAppiumNativeHostProof({
      artifactRoot: context.artifactRoot,
      releaseTargetLease: shouldReleaseAppiumTargetLease(proof),
      server,
      targetLease,
      uninstall: async () => await uninstall(platform, request.device, preparation.appId, context.environment),
    })
  }
  if (proofFailure !== undefined) {
    return Errors.throwHostEnvironment('The Appium mobile proof did not complete.', {
      cause: proofFailure,
      details: cleanupFailureDetails(cleanupFailures),
    })
  }
  if (request.subject === 'syntax2' && proof?.status === 'passed' && (!lifecycleProved || !timerSampleProved)) {
    return Errors.throwHostEnvironment('The Syntax2 journey did not prove the native background/resume lifecycle.')
  }
  if (proof?.retainsTargetLease === true) {
    return Errors.throwHostEnvironment(
      'The Appium mobile proof retained its target lease because the driver session could not be closed after opening failed.',
      { details: cleanupFailureDetails(cleanupFailures) },
    )
  }
  if (proof?.cleanupFailure !== undefined) {
    return Errors.throwHostEnvironment(
      'The Appium mobile proof could not close its driver session; retaining its target lease.',
      {
        details: { cleanupFailure: proof.cleanupFailure.message, ...cleanupFailureDetails(cleanupFailures) },
      },
    )
  }
  if (cleanupFailures.length > 0) {
    return Errors.throwHostEnvironment('The Appium mobile proof could not clean up its owned session.', {
      cause: cleanupFailures[0]!.error,
      details: cleanupFailureDetails(cleanupFailures),
    })
  }
  await reportProof(request, context, preparation, proof!)
}

/** Installs a review build and deliberately leaves it on the simulator; this proves no UI journey. */
export async function runIosBuildOnly(
  request: SimulatorNativeHostTestingRequest,
  context: HostTestingContext,
  preparation: HostBuild,
  dependencies: {
    acquire?: (...args: Parameters<typeof acquireTargetLease>) => Promise<Pick<MachineResourceLease, 'release'>>
    install?: typeof buildAndInstall
    exportApp?: typeof exportNativeIosApp
    appPath?: typeof builtIosAppPath
    writeReceipt?: typeof FS.writeJson
  } = {},
): Promise<void> {
  if (request.mode !== 'ios') {
    Errors.throwUserInput('--build-only is supported only for ios.')
  }
  const lease = await (dependencies.acquire ?? acquireTargetLease)(
    'ios',
    request.device,
    preparation.appId,
    context.runId,
  )
  const writeReceipt = dependencies.writeReceipt ?? FS.writeJson
  const receipt = {
    mode: 'build-install-only',
    appId: preparation.appId,
    device: request.device,
    runId: context.runId,
    developerDir: context.environment['DEVELOPER_DIR'],
    output: request.output,
    acceptance: 'Build and simulator installation only; no launch, visual inspection, or journey acceptance claimed.',
    cleanup: 'Installed app retained for Developer inspection; remove only after inspection is finished.',
  }
  try {
    await (dependencies.install ?? buildAndInstall)('ios', request.device, preparation, context.environment)
    if (request.output !== undefined) {
      await (dependencies.exportApp ?? exportNativeIosApp)({
        appPath: await (dependencies.appPath ?? builtIosAppPath)(preparation),
        output: request.output,
        environment: context.environment,
        appId: preparation.appId,
        runId: context.runId,
      })
    }
    await writeReceipt(FS.resolvePath('build-install-only.json', context.artifactRoot), {
      ...receipt,
      status: 'installed',
    })
  } catch (error) {
    await writeReceipt(FS.resolvePath('build-install-only.json', context.artifactRoot), {
      ...receipt,
      status: 'failed',
      failure: Errors.messageOf(error),
    })
    throw error
  } finally {
    await lease.release()
  }
}

export type AppiumCleanupFailure = Readonly<{ error: unknown; operation: string }>

type AppiumFaultAssertion = Readonly<{
  operation: 'expect'
  sourceMarker: string
  sourcePath: string
  text: string
}>

type AppiumFault = Readonly<{ expectedAssertion: AppiumFaultAssertion; kind: string }>

/** shouldReleaseAppiumTargetLease leaves a target fenced whenever its driver reports an ambiguous close. */
export function shouldReleaseAppiumTargetLease(
  proof: Readonly<{ cleanupFailure?: unknown; retainsTargetLease?: true }> | undefined,
): boolean {
  return proof?.cleanupFailure === undefined && proof?.retainsTargetLease !== true
}

export type AppiumNativeHostProofCleanupOptions = Readonly<{
  artifactRoot: string
  releaseTargetLease?: boolean
  server?: Pick<AppiumServer, 'close' | 'logs'>
  targetLease: Pick<MachineResourceLease, 'release'>
  uninstall: () => Promise<void>
}>

/** cleanupAppiumNativeHostProof attempts every owned cleanup step and returns all failures for reporting. */
export async function cleanupAppiumNativeHostProof(
  options: AppiumNativeHostProofCleanupOptions,
): Promise<readonly AppiumCleanupFailure[]> {
  const failures: AppiumCleanupFailure[] = []
  if (options.server !== undefined) {
    await captureCleanupFailure(failures, 'write Appium server log', async () => {
      await FS.writeText(FS.resolvePath('appium/server.log', options.artifactRoot), options.server!.logs())
    })
    await captureCleanupFailure(failures, 'close Appium server', async () => await options.server!.close())
  }
  await captureCleanupFailure(failures, 'uninstall isolated application', options.uninstall)
  if (options.releaseTargetLease !== false) {
    await captureCleanupFailure(failures, 'release host target lease', async () => await options.targetLease.release())
  }
  return failures
}

async function captureCleanupFailure(
  failures: AppiumCleanupFailure[],
  operation: string,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    failures.push({ error, operation })
  }
}

function cleanupFailureDetails(failures: readonly AppiumCleanupFailure[]): Readonly<Record<string, unknown>> {
  return failures.length === 0
    ? {}
    : {
      cleanupFailures: failures.map(failure => ({
        message: Errors.messageOf(failure.error),
        operation: failure.operation,
      })),
    }
}

async function reportProof(
  request: SimulatorNativeHostTestingRequest,
  context: HostTestingContext,
  preparation: HostBuild,
  proof: AppiumProof,
): Promise<void> {
  const receiptPath = FS.resolvePath(`appium-${request.mode}/proof.receipt.json`, context.artifactRoot)
  HCI.writeLine(`${proof.status.toUpperCase()} Appium ${request.mode} proof: ${receiptPath}`)
  if (request.fault === undefined) {
    if (proof.status !== 'passed') {
      return Errors.throwHostEnvironment(proof.failure?.message ?? `The Appium ${request.mode} journey failed.`)
    }
    return
  }
  const verdict = proof.fault?.verdict ?? 'inconclusive'
  const report = {
    fault: request.fault,
    provenance: preparation.fault,
    reason: proof.failure?.message ?? `The complete Appium ${request.mode} journey passed.`,
    status: verdict,
  }
  await FS.writeJson(FS.resolvePath('application-fault.json', context.artifactRoot), report)
  if (verdict === 'detected') {
    return Errors.throwUserInput(
      `Application fault '${request.fault}' was detected; this intentionally red run wrote ${context.artifactRoot}/application-fault.json`,
    )
  }
  if (verdict === 'escaped') {
    return Errors.throwUnexpected(
      `Application fault '${request.fault}' escaped the Appium ${request.mode} assertions; see ${context.artifactRoot}/application-fault.json`,
    )
  }
  return Errors.throwUnexpected(
    `Application fault '${request.fault}' was inconclusive; see ${context.artifactRoot}/application-fault.json`,
  )
}

export async function journeyFor(subject: SimulatorNativeHostTestingRequest['subject']) {
  const journey = await Switch<SimulatorNativeHostTestingRequest['subject'], Promise<HostJourney>>(subject, {
    clockwork: () =>
      compileHostJourney(Repo.resolvePath('packages/testing/e2e-testing/fixtures/Clockwork/Clockwork.test.tao'), {
        check: 'counts down after a controlled second',
        suite: 'clockwork',
      }),
    hnreader: () =>
      compileHostJourney(Repo.resolvePath('Apps/HNReader/HNReader.test.tao'), {
        check: 'keeps reading history across a relaunch in most-recent order',
        suite: 'hn reader',
      }),
    'native-bridge': () =>
      compileHostJourney(Repo.resolvePath('Apps/Test Apps/Native Bridge/.host-tests/Clipboard.test.tao'), {
        check: 'round trips native clipboard formats and manages change subscriptions',
        suite: 'Native Clipboard acceptance',
      }),
    'native-navigation': () =>
      compileHostJourney(Repo.resolvePath('Apps/Test Apps/Navigation/Native Navigation.test.tao'), {
        check: 'keeps three independent stack positions and local state when switching tabs',
        suite: 'Native navigation acceptance',
      }),
    syntax2: () =>
      compileHostJourney(Repo.resolvePath('Apps/Syntax2/.host-tests/Native.test.tao'), {
        check: 'renders the installed Library',
        suite: 'Syntax2 native acceptance',
      }),
  })
  return subject === 'clockwork' || subject === 'native-bridge' || subject === 'syntax2'
    ? journey
    : requireNativeNavigationHosts(journey, subject)
}

/** Host receipts guard each process lifetime, including both sides of an authored relaunch. */
export function requireNativeNavigationHosts(
  journey: HostJourney,
  subject: 'hnreader' | 'native-navigation' = 'native-navigation',
): HostJourney {
  const receipt = {
    kind: 'expect' as const,
    missing: false,
    selector: 'text' as const,
    source: { filePath: Repo.resolvePath('packages/testing/e2e-testing/app-build/HostBuild.ts') },
    text: subject === 'hnreader' ? 'Native navigation host: stack' : 'Native navigation host: tabs and stack',
  }
  const steps = journey.check.steps.flatMap<HostJourney['check']['steps'][number]>(step => {
    if (step.kind === 'select' && containsRelaunch(step.steps)) {
      return Errors.throwUserInput(
        'Native host acceptance requires relaunch outside select blocks so host receipts remain globally observable.',
      )
    }
    return step.kind === 'relaunch' ? [receipt, step, receipt] : [step]
  })
  return { ...journey, check: { ...journey.check, steps: [receipt, ...steps, receipt] } }
}

function containsRelaunch(steps: HostJourney['check']['steps']): boolean {
  return steps.some(step => step.kind === 'relaunch' || (step.kind === 'select' && containsRelaunch(step.steps)))
}

/** appiumFault binds a mutation to one exact source-ranged assertion in its authored Tao journey. */
export function appiumFault(
  kind: 'clockwork-countdown-frozen' | 'hnreader-reading-history-no-write',
  journey: HostJourney,
): AppiumFault {
  const text = kind === 'clockwork-countdown-frozen' ? 'Countdown: 0:09' : '2 opened'
  let afterRelaunch = kind === 'clockwork-countdown-frozen'
  let expected: AppiumFaultAssertion | undefined
  for (const step of journey.check.steps) {
    if (step.kind === 'relaunch') {
      afterRelaunch = true
      continue
    }
    if (step.kind === 'expect' && !step.missing && step.text === text && afterRelaunch) {
      const range = step.source.range
      if (range === undefined) {
        return Errors.throwUnexpected(`The Appium fault assertion '${text}' has no Tao source range.`)
      }
      expected = {
        operation: 'expect',
        sourceMarker:
          `${step.source.filePath}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`,
        sourcePath: step.source.filePath,
        text,
      }
    }
  }
  return expected === undefined
    ? Errors.throwUnexpected(
      `The Appium fault '${kind}' has no matching authored assertion in '${journey.sourcePath}'.`,
    )
    : { expectedAssertion: expected, kind }
}

async function buildAndInstall(
  platform: AppiumMobilePlatform,
  device: string,
  build: HostBuild,
  environment: Platform.ProcessEnv,
): Promise<void> {
  const expo = FS.resolvePath('node_modules/.bin/expo', build.root)
  const androidDeviceName = platform === 'android' ? await androidExpoDeviceName(device) : undefined
  const args = platform === 'ios'
    ? [
      'run:ios',
      '--device',
      'generic',
      '--configuration',
      'Release',
      '--no-bundler',
      '--output',
      iosBuildOutputRoot(build),
    ]
    : ['run:android', '--device', androidDeviceName!, '--variant', 'release', '--no-bundler']
  const result = await CLI.run(expo, {
    args,
    cwd: build.root,
    env: {
      ...environment,
      CI: '1',
      EXPO_NO_DOTENV: '1',
      TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: Repo.resolvePath('packages/apps/expo-host'),
    },
    prefixedOutput: { processName: `host-${platform}-${device}` },
    processPolicy: 'test',
    timeoutMs: 600_000,
  })
  if (result.error !== undefined || result.exitCode !== 0 || result.signal !== null) {
    Errors.throwHostEnvironment(`Expo could not build and install the isolated ${platform} application.`, {
      cause: result.error,
      details: { exitCode: result.exitCode, signal: result.signal, stderr: result.stderr },
    })
  }
  if (platform === 'ios') {
    await CLI.mustRun('xcrun', { args: ['simctl', 'install', device, await builtIosAppPath(build)], env: environment })
  }
  if (platform === 'android' && !await FS.isFile(androidApkPath(build))) {
    Errors.throwHostEnvironment(`Expo completed without the expected release APK: ${androidApkPath(build)}`)
  }
}

async function androidExpoDeviceName(serial: string): Promise<string> {
  const result = await CLI.run('adb', { args: ['-s', serial, 'emu', 'avd', 'name'] })
  if (result.error !== undefined || result.exitCode !== 0 || result.signal !== null) {
    return Errors.throwHostEnvironment(`Could not resolve Android emulator '${serial}' to its Expo device name.`, {
      cause: result.error,
      details: { exitCode: result.exitCode, signal: result.signal, stderr: result.stderr },
    })
  }
  return parseAndroidAvdName(result.stdout, serial)
}

/** parseAndroidAvdName keeps the leased ADB serial authoritative while satisfying Expo's name-only selector. */
export function parseAndroidAvdName(output: string, serial: string): string {
  const names = output.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0 && line !== 'OK')
  if (names.length !== 1) {
    return Errors.throwHostEnvironment(`Android emulator '${serial}' reported an ambiguous AVD name.`, {
      details: { output },
    })
  }
  return names[0]!
}

/** acquireTargetLease fences install and driver startup around one explicit native target. */
async function acquireTargetLease(
  platform: AppiumMobilePlatform,
  device: string,
  appId: string,
  runId: string,
): Promise<MachineResourceLease> {
  const name = platform === 'ios'
    ? iosTargetLeaseName({ appId, kind: 'simulator', udid: device })
    : androidTargetLeaseName({ appId, kind: 'emulator', serial: device })
  return await MachineResources.acquire({
    command: `Appium ${platform} host proof ${runId}`,
    name,
    repositoryRoot: Repo.getRoot(),
  })
}

/** nonReleasingTargetLease lets the driver fence its session without taking command cleanup ownership. */
function nonReleasingTargetLease(
  lease: MachineResourceLease,
): Pick<MachineResourceLease, 'assertCurrent' | 'generation' | 'release'> {
  return {
    assertCurrent: async generation => await lease.assertCurrent(generation),
    generation: lease.generation,
    release: async () => {},
  }
}

function iosBuildOutputRoot(build: HostBuild): string {
  return FS.resolvePath('native-build/ios', build.root)
}

async function builtIosAppPath(build: HostBuild): Promise<string> {
  const root = iosBuildOutputRoot(build)
  const applications = (await FS.listDir(root)).filter(name => name.endsWith('.app'))
  if (applications.length !== 1) {
    return Errors.throwHostEnvironment(`Expected one built iOS application in ${root}, found ${applications.length}.`)
  }
  return FS.resolvePath(applications[0]!, root)
}

function androidApkPath(build: HostBuild): string {
  return FS.resolvePath('android/app/build/outputs/apk/release/app-release.apk', build.root)
}

function nativeClockControl(
  platform: AppiumMobilePlatform,
  device: string,
  build: HostBuild,
  runId: string,
  environment: Platform.ProcessEnv,
) {
  const controlUrl = (request: Readonly<{ milliseconds: number; runId: string }>): string => {
    if (request.runId !== runId) {
      return Errors.throwUserInput('Native clock control run ID does not match the owned host session.')
    }
    return `taohostpoc-${runId}://control?runId=${runId}&advanceMs=${request.milliseconds}`
  }
  return {
    deepLinkUrl: controlUrl,
    async advance(request: Readonly<{ milliseconds: number; runId: string }>) {
      const url = controlUrl(request)
      if (platform === 'ios') {
        await CLI.mustRun('xcrun', { args: ['simctl', 'openurl', device, url], env: environment })
      } else {
        await CLI.mustRun('adb', {
          args: [
            '-s',
            device,
            'shell',
            'am',
            'start',
            '-W',
            '-a',
            'android.intent.action.VIEW',
            '-d',
            androidShellUrl(url),
            build.appId,
          ],
        })
      }
    },
  }
}

/** androidShellUrl preserves query separators across adb's second, device-side shell parse. */
export function androidShellUrl(url: string): string {
  return url.replaceAll('&', '\\&')
}

async function uninstall(
  platform: AppiumMobilePlatform,
  device: string,
  appId: string,
  environment: Platform.ProcessEnv,
): Promise<void> {
  const result = platform === 'ios'
    ? await CLI.run('xcrun', { args: ['simctl', 'uninstall', device, appId], env: environment })
    : await CLI.run('adb', { args: ['-s', device, 'uninstall', appId] })
  if (result.error !== undefined || (result.exitCode !== 0 && !result.stderr.includes('not installed'))) {
    Errors.throwHostEnvironment(`Could not uninstall the isolated ${platform} application '${appId}'.`, {
      cause: result.error,
      details: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
    })
  }
}
