import {
  type AppiumSession,
  createAppiumHttpTransport,
  createAppiumWebDriverClient,
  startMobileAppiumServer,
} from '@appium-driver'
import { createClerkClient } from '@clerk/backend'
import Compiler from '@compiler'
import { Ports } from '@expo-host/dev-loop/expo-runner/Ports'
import { companionDevClientUrl, CompanionIdentity } from '@expo-host/dev-loop/prebuilt-host/CompanionIdentity'
import { MachineResources } from '@host-control'
import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { Expect, mkTestDir, runCleanups } from '@shared/test'
import { companionInstallEnv, prepareCompanionIosInstall } from '../studio-tooling-src/StudioCompanionDevice'
import { createStudioCompanionSimulator } from '../studio-tooling-src/StudioCompanionSimulator'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { startClerkGateway } from './clerk-gateway'
import { assertClerkInstantData, type ClerkInstantFixture } from './clerk-instant'
import { clerkChildEnvironment, clerkFailureSummary, type loadClerkLiveConfiguration } from './clerk-testing-token'

type Fixture =
  | { kind: 'phone-review' }
  | {
    kind: 'synthetic'
    configuration: NonNullable<Awaited<ReturnType<typeof loadClerkLiveConfiguration>>>
    instant: ClerkInstantFixture
  }

/** Shared quiet native driver; the review variant starts the actual phone command without replacing its account. */
export async function runClerkIosJourney(fixture: Fixture) {
  const review = fixture.kind === 'phone-review'
  const root = await mkTestDir('clerk-ios-')
  const artifactBase = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? Repo.resolvePath('.artifacts/studio-smoke/clerk-ios')
  const receiptPath = FS.resolvePath(`${FS.basename(root)}-receipt.json`, artifactBase)
  const ownershipPath = FS.resolvePath(`${FS.basename(root)}-ownership.json`, artifactBase)
  let clerk: ReturnType<typeof createClerkClient> | undefined
  const simulator = createStudioCompanionSimulator({
    run: (command, spec) =>
      CLI.run(command, { ...spec, env: clerkChildEnvironment({ ...Platform.runtimeProcess.env, ...spec?.env }) }),
  })
  let userId: string | undefined
  let deviceId: string | undefined
  let projectRoot: string | undefined
  let gateway: Awaited<ReturnType<typeof startClerkGateway>> | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  let server: Awaited<ReturnType<typeof startMobileAppiumServer>> | undefined
  let driver: AppiumSession | undefined
  const driverPorts: Array<Awaited<ReturnType<typeof reserveDriverPort>>> = []
  let simulatorRemoved = false
  let cleanupFailed = false
  let primaryFailure: unknown
  let stage = 'prepare native fixture'
  let nativeArtifact: { mode: 'built' | 'supplied'; path?: string; executableSha256?: string } = { mode: 'built' }
  const steps: string[] = []
  const progress = async (next: string) => {
    stage = next
    HCI.writeLine(`Clerk iOS: ${next}`)
    await FS.writeJson(receiptPath, { status: 'running', fixture: fixture.kind, stage, passed: steps, nativeArtifact })
  }
  const ownership = async (state: string) =>
    await FS.writeJson(ownershipPath, {
      owner: 'clerk-ios-auth smoke',
      fixture: fixture.kind,
      reviewLaunchId: studio?.readiness.launchId,
      reviewProjectRoot: review ? studio?.readiness.projectRoot : undefined,
      simulatorPath: deviceId === undefined
        ? undefined
        : FS.resolvePath(`Library/Developer/CoreSimulator/Devices/${deviceId}`, FS.homeDir()),
      state,
      projectRoot,
      deviceId,
      userId,
      purpose: review
        ? 'Disposable simulator and owned foreground clerk-review; shared account is unchanged'
        : 'Disposable simulator, synthetic Clerk identity and source project',
      cleanup: review
        ? 'Sign out only this simulator session; stop owned clerk-review and await its gateway/source cleanup; delete simulator and scratch state. Shared account and Instant stack remain.'
        : 'Delete simulator and synthetic user; remove source and scratch state in finally. Instant app expires automatically.',
    })
  try {
    if (fixture.kind === 'synthetic') {
      const { configuration, instant } = fixture
      clerk = createClerkClient({ secretKey: configuration.secretKey, publishableKey: configuration.publishableKey })
      await progress('create synthetic development account')
      const email = `tao-${crypto.randomUUID()}+clerk_test@example.com`
      const password = `Tao!${crypto.randomUUID()}a7`
      userId = (await clerk.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true })).id
      await ownership('active')
      projectRoot = await mkTestDir('tao-clerk-ios-project-', { location: 'host' })
      await FS.chmod(projectRoot, 0o700)
      await ownership('active')
      const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
      const compiled = await Compiler.compileCode(source, { appName: 'AuthReviewClerk' })
      const policy = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
      if (policy === undefined) {
        Errors.throwUnexpected('Auth Review must emit its account data policy.')
      }
      gateway = await startClerkGateway(root, policy.code, configuration, undefined, instant)
      await FS.writeText(
        FS.resolvePath('Auth Review.tao', projectRoot),
        source
          .replaceAll('pk_test_REPLACE_WITH_YOUR_KEY', configuration.publishableKey)
          .replaceAll('http://127.0.0.1:4738', gateway.url)
          .replace(/let ReviewEmail = ".*"/, `let ReviewEmail = ${JSON.stringify(email)}`)
          .replace(/let ReviewPassword = ".*"/, `let ReviewPassword = ${JSON.stringify(password)}`),
      )
      await FS.writeText(
        FS.resolvePath('Project.tao', projectRoot),
        'project { id "tao-clerk-ios" name "Clerk iOS acceptance" }\n',
      )
    }
    await progress('create and install isolated iOS simulator')
    const devices = JSON.parse(
      (await CLI.mustRun('xcrun', { args: ['simctl', 'list', 'devices', 'available', '--json'] })).stdout,
    ) as {
      devices: Record<string, Array<{ isAvailable: boolean; name: string; deviceTypeIdentifier: string }>>
    }
    const template = Object.entries(devices.devices).flatMap(([runtime, entries]) =>
      entries
        .filter(item =>
          item.isAvailable && item.name.startsWith('iPhone') && typeof item.deviceTypeIdentifier === 'string'
        )
        .map(item => ({ runtime, type: item.deviceTypeIdentifier }))
    )[0]
    if (template === undefined) {
      Errors.throwHostEnvironment('Install an iPhone simulator in Xcode before running Clerk acceptance.')
    }
    deviceId = (await CLI.mustRun('xcrun', {
      args: ['simctl', 'create', `Tao Clerk ${FS.basename(root)}`, template.type, template.runtime],
    })).stdout.trim()
    await ownership('active')
    const existingApp = Platform.runtimeProcess.env['TAO_CLERK_IOS_APP_PATH']
    if (existingApp === undefined) {
      const packageRoot = Repo.resolvePath(CompanionIdentity.packagePath)
      const output = FS.resolvePath('native-build', root)
      const env = clerkChildEnvironment(companionInstallEnv(Platform.runtimeProcess.env, Repo.getRoot()))
      await prepareCompanionIosInstall({ root: packageRoot, env, run: CLI.run })
      // A generic build returns before Expo installs, launches or presents a simulator window.
      await CLI.mustRun('bunx', {
        args: [
          'expo',
          'run:ios',
          '--configuration',
          'Debug',
          '--device',
          'generic',
          '--no-bundler',
          '--output',
          output,
        ],
        cwd: packageRoot,
        env,
      })
      await simulator.boot(deviceId)
      await CLI.mustRun('xcrun', { args: ['simctl', 'bootstatus', deviceId, '-b'] })
      await CLI.mustRun('xcrun', { args: ['simctl', 'install', deviceId, FS.resolvePath('TaoCompanion.app', output)] })
    } else {
      const identifier = await CLI.mustRun('plutil', {
        args: ['-extract', 'CFBundleIdentifier', 'raw', FS.resolvePath('Info.plist', existingApp)],
      })
      Expect(identifier.stdout.trim()).toBe(simulator.bundleIdentifier)
      const executable = (await CLI.mustRun('plutil', {
        args: ['-extract', 'CFBundleExecutable', 'raw', FS.resolvePath('Info.plist', existingApp)],
      })).stdout.trim()
      nativeArtifact = {
        mode: 'supplied',
        path: existingApp,
        executableSha256: Platform.sha256Hex(await FS.readFile(FS.resolvePath(executable, existingApp))),
      }
      await simulator.boot(deviceId)
      await CLI.mustRun('xcrun', { args: ['simctl', 'bootstatus', deviceId, '-b'] })
      await CLI.mustRun('xcrun', { args: ['simctl', 'install', deviceId, existingApp] })
    }
    await progress('start isolated Studio and native driver')
    studio = await startStudioSmokeLaunch({
      appName: 'AuthReviewClerk',
      projectRoot: projectRoot ?? Repo.getRoot(),
      start: (command, args, onOutput) =>
        CLI.start(review ? Repo.resolvePath('agent') : command, {
          args: review ? ['unsandboxed', 'clerk-review', '--no-browser'] : args,
          env: { ...clerkChildEnvironment(Platform.runtimeProcess.env), NODE_ENV: 'development' },
          onOutput: (_stream, chunk) => onOutput(chunk),
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
    })
    await ownership('active')
    await progress('start private Appium server')
    server = await startMobileAppiumServer({
      artifactRoot: root,
      runId: FS.basename(root),
      driver: 'xcuitest',
      quiet: true,
    })
    driverPorts.push(await reserveDriverPort('wda'))
    driverPorts.push(await reserveDriverPort('mjpeg'))
    await progress('attach XCUITest to disposable simulator')
    // Appium preserves a prebooted device without presenting windows when this matches the UI's
    // current state. Unconditional headless mode would close the user's existing simulator UI.
    const simulatorUi = await CLI.run('pgrep', { args: ['-x', 'Simulator|DeviceHub'], stdio: 'pipe' })
    if (simulatorUi.error !== undefined || ![0, 1].includes(simulatorUi.exitCode ?? -1)) {
      Errors.throwHostEnvironment('Could not determine whether the simulator UI is already running.')
    }
    driver = await createAppiumWebDriverClient(createAppiumHttpTransport({ serverUrl: server.url })).createSession({
      'appium:wdaLocalPort': driverPorts[0]!.port,
      'appium:mjpegServerPort': driverPorts[1]!.port,
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': deviceId,
      'appium:bundleId': simulator.bundleIdentifier,
      'appium:noReset': true,
      'appium:isHeadless': simulatorUi.exitCode === 1,
      'appium:waitForIdleTimeout': 1,
      'appium:autoAcceptAlerts': true,
      'appium:newCommandTimeout': 180,
      'appium:derivedDataPath': FS.resolvePath('wda', root),
      'appium:showXcodeLog': false,
    })
    const sessionUrl = studio.readiness.sessionUrl
    const api = async (path: string, body?: unknown) => {
      const response = await fetch(
        `${sessionUrl}/api/${path}`,
        body === undefined ? {} : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!response.ok) {
        Errors.throwHostEnvironment(`Studio native acceptance API ${path} returned HTTP ${response.status}.`)
      }
      return await response.json()
    }
    const launch = await api('device/launch') as { metroPort: number; url?: string }
    if (review && launch.url === undefined) {
      Errors.throwHostEnvironment('Phone review did not offer a LAN Companion URL.')
    }
    const nativeUrl = review ? launch.url! : companionDevClientUrl({ host: '127.0.0.1', port: launch.metroPort })
    // The interactive Studio launch deliberately presents Simulator/Device Hub. Acceptance drives
    // the same installed app and URL through simctl without changing the desktop's focus.
    const open = async () => {
      await CLI.mustRun('xcrun', { args: ['simctl', 'openurl', deviceId!, nativeUrl] })
    }
    await api('device/pairing/open', {})
    await open()
    await progress('pair the owned simulator with its Studio session')
    const pending = await Time.pollUntil(async () => {
      const status = await api('device/status') as { pairing: { pending?: { code: string; devicePublicKey: string } } }
      return status.pairing.pending
    }, { timeoutMs: 120_000, intervalMs: 500 })
    if (pending === undefined) {
      Errors.throwHostEnvironment('The owned simulator did not request pairing.')
    }
    if (await visible(driver, 'Continue')) {
      await press(driver, 'Continue')
    }
    if (await visible(driver, 'Go home') && await visible(driver, 'Reload')) {
      await press(driver, 'Close')
    }
    await progress('compare simulator pairing code')
    const displayedCode = await driver.find({ using: 'accessibility id', value: 'tao-studio-device-code' })
    Expect((await displayedCode.getText())?.replace(/\s/g, '')).toBe(pending.code.replace(/\s/g, ''))
    await api('device/pairing/confirm', { devicePublicKey: pending.devicePublicKey })
    const manifest = await api('preview/manifest') as { cells: Array<{ cellId: string }> }
    const cell = manifest.cells.find(item => item.cellId.includes('#scenario:Clerk%20and%20InstantDB:iPhone#'))
    if (cell === undefined) {
      Errors.throwUnexpected('The authored Clerk iPhone scenario must exist.')
    }
    await api('device/select-cell', { cellId: cell.cellId })
    await progress('mount native Auth Review')
    await waitVisible(driver, 'Fill email', 120_000)
    steps.push('native auth screen mounted')
    await progress('password sign-in through native controls')
    await press(driver, 'Fill email')
    await press(driver, 'Fill password')
    await press(driver, 'Sign in')
    await waitSignedIn(driver)
    steps.push('password sign-in')
    if (fixture.kind === 'phone-review') {
      await progress('sign out only the review test session')
      await press(driver, 'Sign out')
      await waitVisible(driver, 'Fill email')
      steps.push('review test session signed out')
      return
    }
    const { instant } = fixture
    await progress('write profile and note through native controls')
    await fill(driver, 'Display name', 'Clerk browser account')
    await press(driver, 'Save profile')
    await waitVisible(driver, 'Hello Clerk browser account')
    await fill(driver, 'New note', 'Clerk native password note')
    await press(driver, 'Add note')
    await progress('observe native password note')
    await waitVisible(driver, 'Clerk native password note')
    await assertClerkInstantData(instant, ['Clerk native password note'], next => {
      stage = next
    })
    steps.push('profile and owned note persisted in Instant')
    await progress('restore native session after process relaunch')
    await driver.terminateApplication(simulator.bundleIdentifier)
    await open()
    await waitVisible(driver, 'Clerk native password note', 120_000)
    await waitVisible(driver, 'Hello Clerk browser account')
    steps.push('session and data restored after process relaunch')
    await progress('sign out and clear native account data')
    await press(driver, 'Sign out')
    await waitVisible(driver, 'Fill email')
    Expect(await visible(driver, 'Clerk native password note')).toBe(false)
    Expect(await visible(driver, 'Hello Clerk browser account')).toBe(false)
    await driver.terminateApplication(simulator.bundleIdentifier)
    await open()
    await waitVisible(driver, 'Fill email', 120_000)
    Expect(await visible(driver, 'Clerk native password note')).toBe(false)
    Expect(await visible(driver, 'Hello Clerk browser account')).toBe(false)
    steps.push('sign-out remained isolated after relaunch')
    await progress('email-code sign-in through native controls')
    await press(driver, 'Use email code')
    await press(driver, 'Fill email')
    await press(driver, 'Send code')
    await fill(driver, 'Code', '424242')
    await press(driver, 'Verify code')
    await waitVisible(driver, 'Clerk native password note')
    await fill(driver, 'New note', 'Clerk native email-code note')
    await press(driver, 'Add note')
    await waitVisible(driver, 'Clerk native email-code note')
    await assertClerkInstantData(instant, ['Clerk native password note', 'Clerk native email-code note'], next => {
      stage = next
    })
    await driver.terminateApplication(simulator.bundleIdentifier)
    await open()
    await waitVisible(driver, 'Clerk native email-code note', 120_000)
    await waitVisible(driver, 'Clerk native password note')
    await waitVisible(driver, 'Hello Clerk browser account')
    steps.push('email-code session and both notes persisted after relaunch')
    await press(driver, 'Sign out')
    await waitVisible(driver, 'Fill email')
    Expect(await visible(driver, 'Clerk native email-code note')).toBe(false)
    await driver.terminateApplication(simulator.bundleIdentifier)
    await open()
    await waitVisible(driver, 'Fill email', 120_000)
    Expect(await visible(driver, 'Clerk native email-code note')).toBe(false)
    Expect(await visible(driver, 'Clerk native password note')).toBe(false)
    Expect(await visible(driver, 'Hello Clerk browser account')).toBe(false)
    steps.push('final sign-out remained isolated after relaunch')
    await FS.writeJson(receiptPath, { fixture: fixture.kind, status: 'journey-passed', passed: steps, nativeArtifact })
  } catch (error) {
    primaryFailure = true
    await FS.writeJson(receiptPath, { fixture: fixture.kind, status: 'failed', stage, passed: steps, nativeArtifact })
    if (driver !== undefined) {
      const knownControls = [
        'Continue',
        'Got it',
        'Reconnect',
        'Pair with Tao Studio',
        'Fill email',
        'Sign out',
        'Dismiss',
        'Verify code',
        'Unable to sign in. Check your details and connection, then try again.',
      ]
      const controls: string[] = []
      for (const label of knownControls) {
        if (await visible(driver, label).catch(() => false)) {
          controls.push(label)
        }
      }
      await FS.writeJson(receiptPath, {
        fixture: fixture.kind,
        status: 'failed',
        stage,
        passed: steps,
        controls,
        nativeArtifact,
        uiTarget: error instanceof NativeUiAssertionError ? { label: error.label, present: error.present } : undefined,
      })
    }
    // No raw SDK/Appium errors, screenshots, form values, network dumps or session tokens.
    Errors.throwHostEnvironment(
      `Clerk iOS acceptance failed during: ${stage}.${clerkFailureSummary(error)} See ${receiptPath}`,
    )
  } finally {
    await runCleanups(
      primaryFailure,
      [
        {
          label: 'sign out owned review session',
          run: async () => {
            if (review && driver !== undefined && await visible(driver, 'Sign out')) {
              await press(driver, 'Sign out')
              await waitVisible(driver, 'Fill email')
            }
          },
        },
        { label: 'close native driver', run: () => driver?.delete() },
        { label: 'stop private Appium server', run: () => server?.close() },
        {
          label: 'stop owned Studio and verify review cleanup',
          run: async () => {
            await studio?.stop()
            if (review && studio !== undefined && await FS.exists(studio.readiness.projectRoot)) {
              Errors.throwHostEnvironment('The review command left its temporary project behind.')
            }
          },
        },
        { label: 'stop gateway', run: () => gateway?.stop() },
        {
          label: 'delete owned simulator',
          run: async () => {
            if (deviceId === undefined) {
              return
            }
            await CLI.run('xcrun', { args: ['simctl', 'shutdown', deviceId] })
            await CLI.mustRun('xcrun', { args: ['simctl', 'delete', deviceId] })
            simulatorRemoved = true
          },
        },
        {
          label: 'release native driver ports',
          run: async () => {
            if (deviceId === undefined || simulatorRemoved) {
              for (const port of driverPorts) {
                await port.release()
              }
            }
          },
        },
        {
          label: 'delete synthetic user',
          run: async () => {
            if (userId !== undefined && clerk !== undefined) {
              await clerk.users.deleteUser(userId)
            }
          },
        },
        { label: 'remove source', run: () => projectRoot === undefined ? undefined : FS.remove(projectRoot) },
        { label: 'remove scratch state', run: () => FS.remove(root) },
      ].map(cleanup => ({
        ...cleanup,
        run: async () => {
          try {
            await cleanup.run()
          } catch {
            cleanupFailed = true
            await FS.writeJson(receiptPath, {
              fixture: fixture.kind,
              status: 'cleanup-failed',
              stage,
              passed: steps,
              nativeArtifact,
            })
            await ownership('cleanup-required')
            Errors.throwHostEnvironment(`Could not ${cleanup.label}; see ${ownershipPath}.`)
          }
        },
      })),
      { channel: 'clerk-ios-cleanup', subject: 'Clerk iOS acceptance' },
    )
    await ownership(cleanupFailed ? 'cleanup-required' : 'removed')
    if (primaryFailure === undefined && !cleanupFailed) {
      await FS.writeJson(receiptPath, { fixture: fixture.kind, status: 'passed', passed: steps, nativeArtifact })
    }
  }
}

function locator(label: string) {
  return {
    using: '-ios predicate string',
    value: `label == ${JSON.stringify(label)} OR name == ${JSON.stringify(label)}`,
  }
}

async function visible(driver: AppiumSession, label: string): Promise<boolean> {
  const elements = await driver.findAll(locator(label))
  for (const element of elements) {
    if (await element.visible()) {
      return true
    }
  }
  return false
}

async function waitVisible(driver: AppiumSession, label: string, timeoutMs = 60_000): Promise<void> {
  let present = false
  const found = await Time.pollUntil(async () => {
    if (await visible(driver, label)) {
      return true
    }
    // Expo's first-launch tutorial opens its developer menu; neither overlay belongs to Tao auth.
    if (await visible(driver, 'Continue')) {
      await (await driver.find(locator('Continue'))).click()
    }
    if (await visible(driver, 'Go home') && await visible(driver, 'Reload')) {
      await (await driver.find(locator('Close'))).click()
    }
    const matches = await driver.findAll(locator(label))
    present = matches.length > 0
    if (present) {
      await driver.executeScript('mobile: scrollToElement', [{ elementId: matches[0]!.id }])
    }
    return await visible(driver, label)
  }, { timeoutMs, intervalMs: 500 })
  if (!found) {
    throw new NativeUiAssertionError(label, present)
  }
  Expect(found).toBe(true)
}

async function press(driver: AppiumSession, label: string): Promise<void> {
  await waitVisible(driver, label)
  await (await driver.find(locator(label))).click()
}

async function fill(driver: AppiumSession, label: string, value: string): Promise<void> {
  await waitVisible(driver, label)
  // Tao controls may also expose a labeled container. Type into the native editor, not that container.
  const field = await driver.find({
    using: '-ios predicate string',
    value:
      `type IN {"XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeTextView"} AND label == ${
        JSON.stringify(label)
      }`,
  })
  await field.click()
  await field.sendKeys(value)
  if (label !== 'Code') {
    Expect(await field.getAttribute('value')).toBe(value)
  }
}

async function waitSignedIn(driver: AppiumSession): Promise<void> {
  const result = await Time.pollUntil(async () => {
    if (await visible(driver, 'Sign out')) {
      return 'signed-in'
    }
    if (await visible(driver, 'Unable to sign in. Check your details and connection, then try again.')) {
      return 'rejected'
    }
    if (await visible(driver, 'Verify code')) {
      return 'verification-required'
    }
    return undefined
  }, { timeoutMs: 60_000, intervalMs: 500 })
  Expect(result).toBe('signed-in')
}

async function reserveDriverPort(kind: 'wda' | 'mjpeg') {
  for (let attempt = 0; attempt < 100; attempt++) {
    const socket = await Ports.reserveAvailable(0)
    try {
      const lease = await MachineResources.tryAcquire({
        name: `appium-${kind}-port-${socket.port}`,
        command: 'Clerk iOS acceptance',
        repositoryRoot: Repo.getRoot(),
      })
      if (lease !== undefined) {
        return { port: socket.port, release: () => lease.release() }
      }
    } finally {
      await socket.release()
    }
  }
  return Errors.throwHostEnvironment(`No isolated Appium ${kind} port is available.`)
}

class NativeUiAssertionError extends Errors.HostEnvironmentError {
  constructor(readonly label: string, readonly present: boolean) {
    super(`Expected native UI target: ${label}`)
  }
}
