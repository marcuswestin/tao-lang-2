import { CLI, FS, Platform, Repo } from '@shared'
import type { HostFaultProvenance } from '../app-build/HostBuild'

/** A subject the isolated host builder can compile without touching an ordinary Tao app install. */
type NativeHostSubject = 'clockwork' | 'hnreader'

/** The target is explicit so a physical-device claim cannot silently become a simulator claim. */
type NativeHostDevice = {
  id: string
  target: 'device' | 'simulator'
}

type NativeFlow = 'flows/clockwork.yaml' | 'flows/hnreader.yaml' | 'flows/reset.yaml'

/** The browser/build owner supplies an isolated Expo project and its content identity. */
type PreparedHostApp = {
  appId: string
  compiledArtifactDigest: string
  entrySourceDigest: string
  fault?: HostFaultProvenance
  root: string
}

type PrepareHostApp = (input: {
  artifactRoot: string
  runId: string
  seed: number
  subject: NativeHostSubject
}) => Promise<PreparedHostApp>

export type NativeHostProofOptions = {
  artifactRoot: string
  build: PrepareHostApp
  device: NativeHostDevice
  runId: string
  seed: number
  subject: NativeHostSubject
}

type CommandReceipt = {
  args: readonly string[]
  command: string
  error?: string
  exitCode: number | null
  signal: string | null
  stderr: string
  stdout: string
}

/** NativeHostProofReceipt is written for every outcome; only `passed` is evidence of a proof. */
export type NativeHostProofReceipt = {
  artifacts: { maestroJunit: string; receipt: string }
  commands: readonly CommandReceipt[]
  device: NativeHostDevice
  failure?: { code: string; message: string }
  preparation?: PreparedHostApp
  runId: string
  status: 'blocked' | 'failed' | 'passed'
  subject: NativeHostSubject
  version: 1
}

const flowFor: Record<NativeHostSubject, NativeFlow> = {
  clockwork: 'flows/clockwork.yaml',
  hnreader: 'flows/hnreader.yaml',
}

const preflightTimeoutMs = 30_000
const uiFlowTimeoutMs = 120_000
const nativeBuildTimeoutMs = 600_000

/**
 * runNativeHostProof builds an isolated standalone iOS app, then lets Maestro perform every
 * product interaction. It deliberately has no API for selecting a cell, invoking a Tao action,
 * or faking a relaunch: those would turn an OS journey into a runtime unit test.
 */
export async function runNativeHostProof(options: NativeHostProofOptions): Promise<NativeHostProofReceipt> {
  const artifactRoot = FS.resolvePath(options.artifactRoot)
  const root = FS.resolvePath('native', artifactRoot)
  await FS.mkdir(root)
  const receiptPath = FS.resolvePath('receipt.json', root)
  const maestroJunit = FS.resolvePath('maestro.junit.xml', root)
  const receiptBase = {
    artifacts: { maestroJunit, receipt: receiptPath },
    commands: [] as CommandReceipt[],
    device: options.device,
    runId: options.runId,
    subject: options.subject,
    version: 1 as const,
  }

  if (options.device.id.trim() === '') {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: {
        code: 'device-id-required',
        message: 'Pass an explicit simulator UDID or physical device identifier.',
      },
      status: 'blocked',
    })
  }
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: {
        code: 'invalid-seed',
        message: 'seed must be an unsigned 32-bit integer.',
      },
      status: 'blocked',
    })
  }
  if (options.device.target === 'simulator') {
    const maestro = await commandReceipt('maestro', ['--version'], undefined, preflightTimeoutMs)
    receiptBase.commands.push(maestro)
    if (!succeeded(maestro)) {
      return await writeReceipt(receiptPath, {
        ...receiptBase,
        failure: {
          code: 'maestro-unavailable',
          message: commandFailure('Maestro is required for native OS interaction.', maestro),
        },
        status: 'blocked',
      })
    }
    const simulator = await commandReceipt(
      'xcrun',
      ['simctl', 'list', 'devices', '--json', 'available'],
      undefined,
      preflightTimeoutMs,
    )
    receiptBase.commands.push(simulator)
    if (!succeeded(simulator)) {
      return await writeReceipt(receiptPath, {
        ...receiptBase,
        failure: {
          code: 'ios-simulator-unavailable',
          message: commandFailure('CoreSimulator is unavailable.', simulator),
        },
        status: 'blocked',
      })
    }
    if (!simulatorContains(simulator.stdout, options.device.id)) {
      return await writeReceipt(receiptPath, {
        ...receiptBase,
        failure: {
          code: 'ios-simulator-id-unavailable',
          message: `CoreSimulator did not report simulator ${options.device.id} as available.`,
        },
        status: 'blocked',
      })
    }
  } else {
    const deviceReportPath = FS.resolvePath('physical-device-discovery.json', root)
    const device = await commandReceipt(
      'xcrun',
      ['devicectl', 'list', 'devices', '--json-output', deviceReportPath],
      undefined,
      preflightTimeoutMs,
    )
    receiptBase.commands.push(device)
    if (!succeeded(device)) {
      return await writeReceipt(receiptPath, {
        ...receiptBase,
        failure: {
          code: 'ios-device-unavailable',
          message: commandFailure('The requested physical iOS device is unavailable.', device),
        },
        status: 'blocked',
      })
    }
    if (!await physicalDeviceReportContains(deviceReportPath, options.device.id)) {
      return await writeReceipt(receiptPath, {
        ...receiptBase,
        failure: {
          code: 'ios-device-id-unavailable',
          message: `devicectl did not report physical device ${options.device.id}.`,
        },
        status: 'blocked',
      })
    }
  }

  let preparation: PreparedHostApp
  try {
    preparation = await options.build({
      artifactRoot,
      runId: options.runId,
      seed: options.seed,
      subject: options.subject,
    })
  } catch (error) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: {
        code: 'host-app-prepare-failed',
        message: errorMessage(error),
      },
      status: 'failed',
    })
  }
  const canonicalArtifactRoot = await FS.realPath(artifactRoot)
  const canonicalProjectRoot = await canonicalDirectory(preparation.root)
  if (canonicalProjectRoot === undefined || !FS.pathIsWithin(canonicalProjectRoot, canonicalArtifactRoot)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'host-app-not-isolated',
        message: 'The host builder did not return an isolated Expo project under artifactRoot.',
      },
      status: 'failed',
    })
  }
  const expectedAppId = `dev.tao.taohost${options.subject}${options.runId.replaceAll('-', '')}`
  if (
    preparation.appId !== expectedAppId
    || !/^dev\.tao\.taohost(?:clockwork|hnreader)[a-z0-9]+$/u.test(preparation.appId)
  ) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'host-app-id-not-isolated',
        message: 'The host builder returned an app identifier outside the expected isolated dev.tao.taohost namespace.',
      },
      status: 'failed',
    })
  }
  if (!/^[a-f0-9]{64}$/u.test(preparation.compiledArtifactDigest)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'host-app-missing-artifact-digest',
        message: 'The host builder did not return a SHA-256 compiled artifact digest.',
      },
      status: 'failed',
    })
  }
  if (!await hostAppConfigHasIdentifier(canonicalProjectRoot, preparation.appId)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'host-app-config-identity-mismatch',
        message: 'The isolated project app.json does not declare the expected iOS and Android identifier.',
      },
      status: 'failed',
    })
  }
  const expo = FS.resolvePath('node_modules/.bin/expo', canonicalProjectRoot)
  if (!await FS.isFile(expo)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'isolated-expo-missing',
        message: 'The isolated host project has no installed Expo executable.',
      },
      status: 'failed',
    })
  }

  // Release embeds JavaScript; --no-bundler lets Expo exit after install so the OS journey can run.
  // A Debug build without Metro would not establish the same standalone behavior.
  const install = await commandReceipt(
    expo,
    [
      'run:ios',
      '--device',
      options.device.id,
      '--configuration',
      'Release',
      '--no-bundler',
    ],
    canonicalProjectRoot,
    nativeBuildTimeoutMs,
  )
  receiptBase.commands.push(install)
  if (!succeeded(install)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'native-build-or-install-failed',
        message: commandFailure('Expo could not build or install the isolated app.', install),
      },
      status: 'failed',
    })
  }
  if (options.device.target === 'device') {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'physical-ios-ui-driver-unsupported',
        message:
          'The isolated Release app was built and installed on the requested physical device, but Maestro cannot drive physical iOS UI. A physical-device UI-driver integration is required for an end-to-end proof.',
      },
      status: 'blocked',
    })
  }

  const reset = await commandReceipt(
    'maestro',
    [
      '--device',
      options.device.id,
      'test',
      nativeFlowPath('flows/reset.yaml'),
      '--test-output-dir',
      FS.resolvePath('reset-artifacts', root),
      '--debug-output',
      FS.resolvePath('reset-debug', root),
      '--env',
      `TAO_HOST_TEST_APP=${preparation.appId}`,
    ],
    canonicalProjectRoot,
    uiFlowTimeoutMs,
  )
  receiptBase.commands.push(reset)
  if (!succeeded(reset)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      preparation,
      failure: {
        code: 'native-clean-state-failed',
        message: commandFailure('Maestro could not prepare clean isolated app state.', reset),
      },
      status: 'failed',
    })
  }
  const flow = nativeFlowPath(flowFor[options.subject])
  const run = await commandReceipt(
    'maestro',
    [
      '--device',
      options.device.id,
      'test',
      flow,
      '--test-output-dir',
      FS.resolvePath('journey-artifacts', root),
      '--debug-output',
      FS.resolvePath('journey-debug', root),
      '--format',
      'junit',
      '--output',
      maestroJunit,
      '--env',
      `TAO_HOST_TEST_APP=${preparation.appId}`,
      '--env',
      `TAO_HOST_TEST_RUN_ID=${options.runId}`,
      '--env',
      `TAO_HOST_TEST_SEED=${options.seed}`,
      '--env',
      `TAO_HOST_TEST_CLOCKWORK_INITIAL_COLOR=${clockworkColor(options.seed, 1)}`,
      '--env',
      `TAO_HOST_TEST_CLOCKWORK_FIRST_COLOR=${clockworkColor(options.seed, 2)}`,
      '--env',
      `TAO_HOST_TEST_CLOCKWORK_SECOND_COLOR=${clockworkColor(options.seed, 3)}`,
      '--env',
      `TAO_HOST_TEST_ARTIFACTS=${root}`,
    ],
    canonicalProjectRoot,
    uiFlowTimeoutMs,
  )
  receiptBase.commands.push(run)
  return await writeReceipt(
    receiptPath,
    succeeded(run)
      ? { ...receiptBase, preparation, status: 'passed' }
      : {
        ...receiptBase,
        preparation,
        failure: {
          code: 'native-ui-flow-failed',
          message: commandFailure('Maestro did not complete the real native UI flow.', run),
        },
        status: 'failed',
      },
  )
}

async function commandReceipt(
  command: string,
  args: readonly string[],
  cwd?: string,
  timeoutMs = preflightTimeoutMs,
): Promise<CommandReceipt> {
  try {
    const result = await CLI.run(command, {
      args: [...args],
      ...(cwd === undefined ? {} : { cwd }),
      env: {
        ...Platform.runtimeProcess.env,
        CI: '1',
        EXPO_NO_DOTENV: '1',
        ...(command === 'maestro' ? await maestroEnvironment() : {}),
        TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: Repo.resolvePath('packages/runtime-toolchain'),
      },
      // Maestro stays quiet while an assertion waits; only its full wall budget may end that wait.
      idleOutputMs: command === 'maestro' ? timeoutMs : Math.min(90_000, timeoutMs / 2),
      prefixedOutput: {
        processName: command === 'maestro' ? 'native-ui' : command === 'xcrun' ? 'native-discovery' : 'native-build',
      },
      processPolicy: 'test',
      stdio: 'pipe',
      timeoutMs,
    })
    return {
      args,
      command,
      ...(result.error === undefined ? {} : { error: result.error.message }),
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
    }
  } catch (error) {
    return { args, command, error: errorMessage(error), exitCode: null, signal: null, stderr: '', stdout: '' }
  }
}

/**
 * Homebrew's JDK is keg-only, so macOS's java_home does not discover it until the user chooses to
 * register it globally. Keep the proof self-contained instead: honor a configured JAVA_HOME and
 * use a locally installed Homebrew JDK only for the Maestro child process. Maestro's default
 * analytics initialization also writes to the user home, which a managed proof intentionally
 * cannot assume is writable.
 */
async function maestroEnvironment(): Promise<Record<string, string>> {
  const environment: Record<string, string> = { MAESTRO_CLI_NO_ANALYTICS: '1' }
  if (Platform.runtimeProcess.env['JAVA_HOME'] !== undefined) {
    return environment
  }
  for (
    const home of [
      '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
      '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    ]
  ) {
    if (await FS.isFile(FS.resolvePath('bin/java', home))) {
      environment['JAVA_HOME'] = home
      return environment
    }
  }
  return environment
}

function clockworkColor(seed: number, selection: number): string {
  // The canonical seed has an independent literal oracle. Other seeds only prove valid choices.
  return seed === 12345 ? ['brass', 'brass', 'steel'][selection - 1]! : '(brass|copper|steel|verdigris)'
}

function succeeded(result: CommandReceipt): boolean {
  return result.exitCode === 0 && result.error === undefined && result.signal === null
}

function commandFailure(prefix: string, result: CommandReceipt): string {
  const detail = [result.error, result.stderr, result.stdout].filter((value): value is string => value !== undefined)
    .map(value => value.trim()).find(value => value !== '')
  return detail === undefined ? `${prefix} ${result.command} exited ${String(result.exitCode)}.` : `${prefix} ${detail}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeReceipt(
  path: string,
  receipt: Omit<NativeHostProofReceipt, 'artifacts'> & { artifacts: NativeHostProofReceipt['artifacts'] },
): Promise<NativeHostProofReceipt> {
  await FS.writeJson(path, receipt)
  return receipt
}

/** Resolves Maestro flow declarations from the worktree, independent of the isolated build cwd. */
export function nativeFlowPath(
  flow: NativeFlow,
  cwd?: string,
): string {
  return Repo.resolvePath(`packages/e2e-testing/native/${flow}`, cwd)
}

async function canonicalDirectory(path: string): Promise<string | undefined> {
  return await FS.isDirectory(path) ? await FS.realPath(path) : undefined
}

async function hostAppConfigHasIdentifier(root: string, appId: string): Promise<boolean> {
  try {
    // The prototype emits only static app.json. Reject overrides before installing anything.
    for (const name of ['app.config.ts', 'app.config.js', 'app.config.cjs', 'app.config.mjs']) {
      if (await FS.exists(FS.resolvePath(name, root))) {
        return false
      }
    }
    const config = await FS.readJson<
      { expo?: { android?: { package?: unknown }; ios?: { bundleIdentifier?: unknown } } }
    >(
      FS.resolvePath('app.json', root),
    )
    return config.expo?.ios?.bundleIdentifier === appId && config.expo.android?.package === appId
  } catch {
    return false
  }
}

function simulatorContains(output: string, id: string): boolean {
  try {
    const parsed = JSON.parse(output) as { devices?: Record<string, Array<{ isAvailable?: unknown; udid?: unknown }>> }
    return Object.entries(parsed.devices ?? {}).some(([runtime, devices]) =>
      runtime.includes('.iOS-') && devices.some(device => device.udid === id && device.isAvailable === true)
    )
  } catch {
    return false
  }
}

async function physicalDeviceReportContains(path: string, id: string): Promise<boolean> {
  try {
    const report = await FS.readJson<
      {
        result?: {
          devices?: Array<
            { identifier?: unknown; hardwareProperties?: { reality?: unknown; udid?: unknown; deviceType?: unknown } }
          >
        }
      }
    >(path)
    return report.result?.devices?.some(device => {
      const hardware = device.hardwareProperties
      return (device.identifier === id || hardware?.udid === id)
        && (hardware?.deviceType === 'iPhone' || hardware?.deviceType === 'iPad')
        && (hardware.reality === undefined || hardware.reality === 'physical')
    }) === true
  } catch {
    return false
  }
}
