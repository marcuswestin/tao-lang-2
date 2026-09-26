import { hostSessionTargetLeaseName, type MachineResourceLease, MachineResources } from '@host-control'
import { CLI, FS, Platform, Repo } from '@shared'
import type { HostBuild, HostSubject, PrepareHostAppOptions } from '../app-build/HostBuild'

/** The physical-device path proves only that an isolated Release build was installed. */
export type PhysicalIosInstallOptions = Readonly<{
  artifactRoot: string
  build: (input: PrepareHostAppOptions) => Promise<HostBuild>
  dependencies?: PhysicalIosInstallDependencies
  device: string
  runId: string
  seed: number
  subject: HostSubject
}>

type PhysicalIosInstallFilesystem = Pick<
  typeof FS,
  'exists' | 'isDirectory' | 'isFile' | 'mkdir' | 'pathIsWithin' | 'readJson' | 'realPath' | 'resolvePath' | 'writeJson'
>
type PhysicalIosInstallCommand = (
  input: Readonly<{
    args: readonly string[]
    command: string
    cwd: string | undefined
    timeoutMs: number
  }>,
) => Promise<CommandReceipt>
type PhysicalIosInstallDependencies = Readonly<{
  acquireLease?: (
    input: Readonly<{ command: string; name: string; repositoryRoot: string }>,
  ) => Promise<PhysicalIosInstallLease>
  command?: PhysicalIosInstallCommand
  filesystem?: PhysicalIosInstallFilesystem
}>

type CommandReceipt = Readonly<{
  args: readonly string[]
  command: string
  error?: string
  exitCode: number | null
  signal: string | null
  stderr: string
  stdout: string
}>

/** PhysicalIosInstallReceipt records a build/install milestone and never claims UI acceptance. */
export type PhysicalIosInstallReceipt = Readonly<{
  artifacts: { receipt: string }
  commands: readonly CommandReceipt[]
  device: { id: string; kind: 'physical-ios' }
  failure?: { code: string; message: string }
  preparation?: HostBuild
  runId: string
  status: 'blocked' | 'failed' | 'installed'
  subject: HostSubject
  version: 1
}>

const preflightTimeoutMs = 30_000
const nativeBuildTimeoutMs = 600_000

type PhysicalIosInstallLease = Pick<MachineResourceLease, 'release'>

/** Builds and installs one isolated Release app on an explicit physical iOS device. */
export async function runPhysicalIosInstall(options: PhysicalIosInstallOptions): Promise<PhysicalIosInstallReceipt> {
  const filesystem = options.dependencies?.filesystem ?? FS
  const inputFailure = physicalIosInstallInputFailure(options.device, options.seed)
  if (inputFailure !== undefined) {
    return await writeBlockedInputReceipt(options, inputFailure, filesystem)
  }
  return await withPhysicalIosInstallLease({
    ...(options.dependencies?.acquireLease === undefined ? {} : { acquire: options.dependencies.acquireLease }),
    action: async () => await runLeasedPhysicalIosInstall(options, filesystem, options.dependencies?.command),
    device: options.device,
    runId: options.runId,
  })
}

/** Acquires the shared physical target from discovery until the install attempt finishes. */
export async function withPhysicalIosInstallLease<T>(
  options: Readonly<{
    acquire?: (
      input: Readonly<{ command: string; name: string; repositoryRoot: string }>,
    ) => Promise<PhysicalIosInstallLease>
    action: () => Promise<T>
    device: string
    runId: string
  }>,
): Promise<T> {
  const lease = await (options.acquire ?? MachineResources.acquire)({
    command: `physical iOS install ${options.runId}`,
    name: hostSessionTargetLeaseName({ id: options.device, kind: 'iosDevice' }),
    repositoryRoot: Repo.getRoot(),
  })
  try {
    return await options.action()
  } finally {
    await lease.release()
  }
}

async function runLeasedPhysicalIosInstall(
  options: PhysicalIosInstallOptions,
  filesystem: PhysicalIosInstallFilesystem,
  command: PhysicalIosInstallCommand | undefined,
): Promise<PhysicalIosInstallReceipt> {
  const artifactRoot = filesystem.resolvePath(options.artifactRoot)
  const root = filesystem.resolvePath('physical-ios-install', artifactRoot)
  await filesystem.mkdir(root)
  const receiptPath = filesystem.resolvePath('receipt.json', root)
  const receiptBase = {
    artifacts: { receipt: receiptPath },
    commands: [] as CommandReceipt[],
    device: { id: options.device, kind: 'physical-ios' as const },
    runId: options.runId,
    subject: options.subject,
    version: 1 as const,
  }

  const deviceReportPath = filesystem.resolvePath('physical-device-discovery.json', root)
  const discovery = await commandReceipt(
    'xcrun',
    ['devicectl', 'list', 'devices', '--json-output', deviceReportPath],
    undefined,
    preflightTimeoutMs,
    command,
  )
  receiptBase.commands.push(discovery)
  if (!succeeded(discovery)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: {
        code: 'ios-device-unavailable',
        message: commandFailure('The requested physical iOS device is unavailable.', discovery),
      },
      status: 'blocked',
    }, filesystem)
  }
  if (!await physicalIosDeviceReportContains(deviceReportPath, options.device, filesystem)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: {
        code: 'ios-device-id-unavailable',
        message: `devicectl did not report physical device ${options.device}.`,
      },
      status: 'blocked',
    }, filesystem)
  }

  let preparation: HostBuild
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
      failure: { code: 'host-app-prepare-failed', message: errorMessage(error) },
      status: 'failed',
    }, filesystem)
  }
  const configurationFailure = await physicalIosInstallConfigurationFailure(
    artifactRoot,
    preparation,
    options,
    filesystem,
  )
  if (configurationFailure !== undefined) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: configurationFailure,
      preparation,
      status: 'failed',
    }, filesystem)
  }
  const expo = filesystem.resolvePath('node_modules/.bin/expo', preparation.root)
  if (!await filesystem.isFile(expo)) {
    return await writeReceipt(receiptPath, {
      ...receiptBase,
      failure: {
        code: 'isolated-expo-missing',
        message: 'The isolated host project has no installed Expo executable.',
      },
      preparation,
      status: 'failed',
    }, filesystem)
  }
  const install = await commandReceipt(
    expo,
    ['run:ios', '--device', options.device, '--configuration', 'Release', '--no-bundler'],
    preparation.root,
    nativeBuildTimeoutMs,
    command,
  )
  receiptBase.commands.push(install)
  return await writeReceipt(
    receiptPath,
    succeeded(install)
      ? { ...receiptBase, preparation, status: 'installed' }
      : {
        ...receiptBase,
        failure: {
          code: 'native-build-or-install-failed',
          message: commandFailure('Expo could not build or install the isolated app.', install),
        },
        preparation,
        status: 'failed',
      },
    filesystem,
  )
}

async function writeBlockedInputReceipt(
  options: PhysicalIosInstallOptions,
  failure: { code: string; message: string },
  filesystem: PhysicalIosInstallFilesystem,
): Promise<PhysicalIosInstallReceipt> {
  const artifactRoot = filesystem.resolvePath(options.artifactRoot)
  const root = filesystem.resolvePath('physical-ios-install', artifactRoot)
  await filesystem.mkdir(root)
  const receiptPath = filesystem.resolvePath('receipt.json', root)
  return await writeReceipt(receiptPath, {
    artifacts: { receipt: receiptPath },
    commands: [],
    device: { id: options.device, kind: 'physical-ios' },
    failure,
    runId: options.runId,
    status: 'blocked',
    subject: options.subject,
    version: 1,
  }, filesystem)
}

/** Validates the host-free boundary before physical device discovery or build work begins. */
export function physicalIosInstallInputFailure(
  device: string,
  seed: number,
): { code: string; message: string } | undefined {
  if (device.trim() === '') {
    return { code: 'device-id-required', message: 'Pass an explicit physical iOS device identifier.' }
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    return { code: 'invalid-seed', message: 'seed must be an unsigned 32-bit integer.' }
  }
  return undefined
}

/** Reads exactly physical iPhone and iPad targets from a devicectl JSON report. */
async function physicalIosDeviceReportContains(
  path: string,
  id: string,
  filesystem: PhysicalIosInstallFilesystem,
): Promise<boolean> {
  try {
    const report = await filesystem.readJson<{
      result?: {
        devices?: Array<{
          identifier?: unknown
          hardwareProperties?: { deviceType?: unknown; reality?: unknown; udid?: unknown }
        }>
      }
    }>(path)
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

async function physicalIosInstallConfigurationFailure(
  artifactRoot: string,
  preparation: HostBuild,
  options: PhysicalIosInstallOptions,
  filesystem: PhysicalIosInstallFilesystem,
): Promise<{ code: string; message: string } | undefined> {
  const canonicalArtifactRoot = await filesystem.realPath(artifactRoot)
  const canonicalProjectRoot = await canonicalDirectory(preparation.root, filesystem)
  if (canonicalProjectRoot === undefined || !filesystem.pathIsWithin(canonicalProjectRoot, canonicalArtifactRoot)) {
    return {
      code: 'host-app-not-isolated',
      message: 'The host builder did not return an isolated Expo project under artifactRoot.',
    }
  }
  const expectedAppId = `dev.tao.taohost${options.subject.replaceAll('-', '')}${options.runId.replaceAll('-', '')}`
  if (
    preparation.appId !== expectedAppId
    || !/^dev\.tao\.taohost(?:clockwork|hnreader|nativenavigation)[a-z0-9]+$/u.test(preparation.appId)
  ) {
    return {
      code: 'host-app-id-not-isolated',
      message: 'The host builder returned an app identifier outside the expected isolated dev.tao.taohost namespace.',
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(preparation.compiledArtifactDigest)) {
    return {
      code: 'host-app-missing-artifact-digest',
      message: 'The host builder did not return a SHA-256 compiled artifact digest.',
    }
  }
  return await hostAppConfigHasIdentifier(canonicalProjectRoot, preparation.appId, filesystem)
    ? undefined
    : {
      code: 'host-app-config-identity-mismatch',
      message: 'The isolated project app.json does not declare the expected iOS and Android identifier.',
    }
}

async function commandReceipt(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
  timeoutMs: number,
  injected: PhysicalIosInstallCommand | undefined,
): Promise<CommandReceipt> {
  if (injected !== undefined) {
    return await injected({ args, command, cwd, timeoutMs })
  }
  try {
    const result = await CLI.run(command, {
      args: [...args],
      ...(cwd === undefined ? {} : { cwd }),
      env: {
        ...Platform.runtimeProcess.env,
        CI: '1',
        EXPO_NO_DOTENV: '1',
        TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: Repo.resolvePath('packages/apps/expo-host'),
      },
      idleOutputMs: Math.min(90_000, timeoutMs / 2),
      prefixedOutput: { processName: command === 'xcrun' ? 'native-discovery' : 'native-build' },
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
  receipt: PhysicalIosInstallReceipt,
  filesystem: PhysicalIosInstallFilesystem,
): Promise<PhysicalIosInstallReceipt> {
  await filesystem.writeJson(path, receipt)
  return receipt
}

async function canonicalDirectory(path: string, filesystem: PhysicalIosInstallFilesystem): Promise<string | undefined> {
  return await filesystem.isDirectory(path) ? await filesystem.realPath(path) : undefined
}

async function hostAppConfigHasIdentifier(
  root: string,
  appId: string,
  filesystem: PhysicalIosInstallFilesystem,
): Promise<boolean> {
  try {
    for (const name of ['app.config.ts', 'app.config.js', 'app.config.cjs', 'app.config.mjs']) {
      if (await filesystem.exists(filesystem.resolvePath(name, root))) {
        return false
      }
    }
    const config = await filesystem.readJson<
      { expo?: { android?: { package?: unknown }; ios?: { bundleIdentifier?: unknown } } }
    >(
      filesystem.resolvePath('app.json', root),
    )
    return config.expo?.ios?.bundleIdentifier === appId && config.expo.android?.package === appId
  } catch {
    return false
  }
}
