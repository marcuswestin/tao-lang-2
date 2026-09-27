import {
  type AppiumPortReservation,
  type AppiumPortReservations,
  type AppiumServer,
  createAppiumHttpTransport,
  createAppiumWebDriverClient,
  startAppiumServer,
} from '@appium-driver'
import { type HostRevision, type MachineResourceLease, MachineResources } from '@host-control'
import { CLI, Errors, FS, HCI, Json, Platform, Repo, Switch } from '@shared'
import type { HostBuild, PrepareHostAppOptions } from './app-build/HostBuild'
import type { HostTestingContext, SimulatorNativeHostTestingRequest } from './HostTestingRequest'
import { compileHostJourney, type HostJourney } from './journey/HostJourney'
import {
  androidTargetLeaseName,
  createAppiumAndroidController,
} from './native/appium-android/AppiumAndroidController'
import { runAppiumAndroidHostProof } from './native/appium-android/AppiumAndroidHostProof'
import { runAppiumIosHostProof } from './native/appium/AppiumIosHostProof'
import { createAppiumXcuiTestController, iosTargetLeaseName } from './native/appium/AppiumXcuiTestController'
import { appiumAndroidClient, appiumXcuiTestClient } from './native/AppiumMobileClients'

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
  const revision: HostRevision = Object.freeze({
    build: preparation.compiledArtifactDigest,
    source: preparation.entrySourceDigest,
  })
  const journey = await journeyFor(request.subject)
  const driver = platform === 'ios' ? 'xcuitest' : 'uiautomator2'
  await ensureAppiumDriver(driver, context.artifactRoot)
  const targetLease = await acquireTargetLease(platform, request.device, preparation.appId, context.runId)
  let server: AppiumServer | undefined
  let proof: AppiumProof | undefined
  let proofFailure: unknown
  let cleanupFailures: readonly AppiumCleanupFailure[] = []
  try {
    await buildAndInstall(platform, request.device, preparation)
    server = await startOwnedAppiumServer(context.runId, context.artifactRoot)
    await FS.writeText(FS.resolvePath('appium/server.url.txt', context.artifactRoot), `${server.url}\n`)
    const factory = createAppiumWebDriverClient(createAppiumHttpTransport({ serverUrl: server.url }))
    const fault = preparation.fault === undefined ? undefined : appiumFault(preparation.fault.kind, journey)
    const control = nativeClockControl(platform, request.device, preparation, context.runId)
    proof = platform === 'ios'
      ? await runAppiumIosHostProof({
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
      uninstall: async () => await uninstall(platform, request.device, preparation.appId),
    })
  }
  if (proofFailure !== undefined) {
    return Errors.throwHostEnvironment('The Appium mobile proof did not complete.', {
      cause: proofFailure,
      details: cleanupFailureDetails(cleanupFailures),
    })
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

async function journeyFor(subject: SimulatorNativeHostTestingRequest['subject']) {
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
  })
  return subject === 'clockwork' || subject === 'native-bridge'
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

async function buildAndInstall(platform: AppiumMobilePlatform, device: string, build: HostBuild): Promise<void> {
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
      ...Platform.runtimeProcess.env,
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
    await CLI.mustRun('xcrun', { args: ['simctl', 'install', device, await builtIosAppPath(build)] })
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
        await CLI.mustRun('xcrun', { args: ['simctl', 'openurl', device, url] })
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

async function uninstall(platform: AppiumMobilePlatform, device: string, appId: string): Promise<void> {
  const result = platform === 'ios'
    ? await CLI.run('xcrun', { args: ['simctl', 'uninstall', device, appId] })
    : await CLI.run('adb', { args: ['-s', device, 'uninstall', appId] })
  if (result.error !== undefined || (result.exitCode !== 0 && !result.stderr.includes('not installed'))) {
    Errors.throwHostEnvironment(`Could not uninstall the isolated ${platform} application '${appId}'.`, {
      cause: result.error,
      details: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
    })
  }
}

async function ensureAppiumDriver(driver: 'uiautomator2' | 'xcuitest', artifactRoot: string): Promise<void> {
  const command = appiumCommand()
  const environment = appiumEnvironment(artifactRoot)
  const home = environment['APPIUM_HOME']!
  const packageNames = [
    'appium-mac2-driver',
    'appium-uiautomator2-driver',
    'appium-xcuitest-driver',
  ] as const
  const dependencies: Record<string, string> = {}
  for (const packageName of packageNames) {
    const source = await FS.realPath(Repo.resolvePath(`packages/testing/appium-driver/node_modules/${packageName}`))
    const destination = FS.resolvePath(`node_modules/${packageName}`, home)
    dependencies[packageName] = `file:${source}`
    await FS.mkdir(FS.dirname(destination))
    if (!await FS.exists(destination)) {
      await FS.symlink(source, destination)
    }
  }
  await FS.writeJson(FS.resolvePath('package.json', home), { devDependencies: dependencies })
  const listed = await CLI.mustRun(command, { args: ['driver', 'list', '--installed', '--json'], env: environment })
  const installed = Json.tryParse(listed.stdout)
  if (typeof installed === 'object' && installed !== null && driver in installed) {
    return
  }
  Errors.throwHostEnvironment(`The isolated Appium home did not discover its pinned ${driver} driver.`, {
    details: { appiumHome: home, installed },
  })
}

async function startOwnedAppiumServer(runId: string, artifactRoot: string): Promise<AppiumServer> {
  return await startAppiumServer({
    command: appiumCommand(),
    environment: appiumEnvironment(artifactRoot),
    reservations: appiumPortReservations(runId),
  })
}

function appiumCommand(): string {
  return Repo.resolvePath('packages/testing/appium-driver/node_modules/.bin/appium')
}

function appiumEnvironment(artifactRoot: string): Record<string, string | undefined> {
  return {
    ...Platform.runtimeProcess.env,
    APPIUM_HOME: FS.resolvePath('appium-home', artifactRoot),
  }
}

function appiumPortReservations(runId: string): AppiumPortReservations {
  return {
    async reserve(): Promise<AppiumPortReservation> {
      const first = 4723 + Number.parseInt(Platform.sha256Hex(runId).slice(0, 4), 16) % 1_000
      for (let offset = 0; offset < 1_000; offset += 1) {
        const port = 4723 + (first - 4723 + offset) % 1_000
        const lease = await MachineResources.tryAcquire({
          command: `Appium server for host test ${runId}`,
          name: `appium-server-port-${port}`,
          repositoryRoot: Repo.getRoot(),
        })
        if (lease !== undefined) {
          return portReservation(port, lease)
        }
      }
      return Errors.throwHostEnvironment('No Appium server port could be reserved.')
    },
  }
}

function portReservation(port: number, lease: MachineResourceLease): AppiumPortReservation {
  return { port, release: async () => await lease.release() }
}
