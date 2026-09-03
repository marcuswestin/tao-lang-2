import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { StudioClientAssets } from '@studio'
import { Workspace } from '@workspace'
import { createHash } from 'node:crypto'
import { delimiter as pathDelimiter } from 'node:path'
import {
  StudioElectrobun,
  type StudioElectrobunProject,
} from './StudioElectrobun'
import {
  finalizeStudioProcessTree,
  processGroupKillSpec,
  startStudioProcessTree,
  stopStudioProcessTree,
  type StudioProcessTree,
} from './StudioProcessTree'

const probeTimeoutMs = 30_000
const defaultAppName = 'Tao Studio'
const defaultBundleIdentifier = 'dev.tao-lang.studio'
const defaultHutchCommand = 'hutch'
const electrobunBuildLockPath = '.hutch/locks/electrobun-build.lock'
const electrobunReleasesPath = '.hutch/releases/electrobun'
const hutchInstallUrl = 'https://hutch.blackboard.sh/hutch/install.sh'

export type StudioNativeOptions = {
  artifactRoot?: string
  hutchPath?: string
  previewUrl: string
  /** Undefined opens the Welcome window only: `--no-browser` must not add a project window. */
  projectUrl?: string
  probe?: boolean
  showWindow?: boolean
  studioUrl: string
}

export type StudioNativeProbeResult = {
  capabilities: Record<string, { message?: string; passed: boolean }>
  passed: boolean
}

export type StartedStudioNative = {
  project: StudioElectrobunProject
  stop(): Promise<void>
  waitForClose(): Promise<number>
  waitForProbe(): Promise<StudioNativeProbeResult>
}

export type StudioNativePackageOptions = {
  appName?: string
  bundleIdentifier?: string
  channel?: 'canary' | 'stable'
  hutchPath?: string
  nodePath?: string
  outputRoot?: string
  releaseBaseUrl: string
  version?: string
}

export type PackagedStudioNative = {
  artifactPaths: readonly string[]
  artifactsRoot: string
  channel: 'canary' | 'stable'
  projectRoot: string
}

type StoppableCommand = StudioProcessTree

type WaitForNativeClose = () => Promise<number>
type CommandRunner = (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
type Sleep = (milliseconds: number) => Promise<void>
type LockHolderProbe = (lockPath: string) => Promise<readonly number[]>
type NativeStudioHolder = { command: string; processId: number }
type ReleaseHolderProbe = () => Promise<readonly NativeStudioHolder[]>
type NativeRuntimeCloseResult = {
  exitCode: number
  message: string
}

/** StudioNative owns Tao Studio's Electrobun shell process and release builds. */
export const StudioNative = {
  packageApp,
  resolveHutchExecutablePath,
  start,
  testing: {
    clearStaleElectrobunBuildLock,
    installedHutchExecutablePath,
    requireIdleElectrobunRelease,
    installStudioServicePayload,
    materializeStudioNodeRuntime,
    materializeStudioServicePayload,
    nativeRuntimeCloseResult,
    nativeDevelopmentProcessIds,
    prepareElectrobun,
    portableStudioClientBundle,
    processGroupKillSpec,
    resolveHutchExecutablePath,
    stageStudioClientBundle,
    stageStudioPackagedServiceBundle,
    stopExistingNativeDevelopmentProcesses,
    stopCommand,
    validateStudioRelease,
    waitForProbeResult,
  },
} as const

async function start(options: StudioNativeOptions): Promise<StartedStudioNative> {
  const hutchPath = await resolveHutchExecutablePath(options.hutchPath)
  const artifactRoot = FS.resolvePath(options.artifactRoot ?? '.artifacts/user/studio-native', Repo.getRoot())
  const stoppedNativeProcesses = await stopExistingNativeDevelopmentProcesses(artifactRoot)
  if (stoppedNativeProcesses > 0) {
    HCI.logProcessInfo(
      'studio-native',
      `Stopped ${stoppedNativeProcesses} existing native Studio ${
        stoppedNativeProcesses === 1 ? 'process' : 'processes'
      }.`,
    )
  }
  const project = await StudioElectrobun.create({
    appName: defaultAppName,
    bundleIdentifier: defaultBundleIdentifier,
    outputRoot: artifactRoot,
    previewUrl: options.previewUrl,
    projectUrl: options.projectUrl,
    runProbe: options.probe,
    showWindow: options.showWindow,
    studioUrl: options.studioUrl,
  })
  await FS.remove(project.runtimeResultPath)
  await prepareElectrobun(hutchPath, project.root)
  let finishRuntimeClose: ((result: NativeRuntimeCloseResult) => void) | undefined
  const runtimeClosed = new Promise<NativeRuntimeCloseResult>(resolve => {
    finishRuntimeClose = resolve
  })
  const outputRemainders: Record<CLI.CommandOutputStream, string> = { stderr: '', stdout: '' }
  const command = startStudioProcessTree(hutchPath, {
    args: ['electrobun', 'dev', '--watch'],
    cwd: project.root,
    env: project.dev.env,
    onError: error => HCI.logProcessError('studio-native', error.message),
    onOutput(stream, chunk) {
      const lines = `${outputRemainders[stream]}${chunk.toString('utf8')}`.split(/\r?\n/)
      outputRemainders[stream] = lines.pop() ?? ''
      for (const line of lines.filter(Boolean)) {
        HCI.logProcessOutput('studio-native', line, { stderr: stream === 'stderr' })
        const runtimeClose = nativeRuntimeCloseResult(line)
        if (runtimeClose !== undefined) {
          finishRuntimeClose?.(runtimeClose)
        }
      }
    },
  })
  const waitForHutchClose = finalizeCommand(command)
  let stopping: Promise<void> | undefined
  let closing: Promise<number> | undefined
  const stopHutch = () => {
    stopping ??= stopCommand(command, Time.sleep, waitForHutchClose)
    return stopping
  }
  const handledRuntimeClose = runtimeClosed.then(async result => {
    if (result.message !== '') {
      HCI.logProcessError('studio-native', result.message)
    }
    await stopHutch()
    return result
  })
  const waitForClose = () => {
    closing ??= Promise.race([
      waitForHutchClose().then(exitCode => ({ exitCode, message: '' })),
      handledRuntimeClose,
    ]).then(result => result.exitCode)
    return closing
  }
  return {
    project,
    stop: stopHutch,
    waitForClose,
    waitForProbe() {
      if (options.probe !== true) {
        return Promise.reject(new Errors.UserInputError('The native Studio runtime probe was not enabled.'))
      }
      return waitForProbeResult(project.runtimeResultPath, command, Time.sleep)
    },
  }
}

/** Stops a prior dev watcher and app so neither can reclaim the generated shell or its build lock. */
async function stopExistingNativeDevelopmentProcesses(
  artifactRoot: string,
  runner: CommandRunner = CLI.run,
  sleep: Sleep = Time.sleep,
): Promise<number> {
  const result = await runner('/usr/sbin/lsof', { args: ['-nP', '-d', 'cwd', '-Fpcn'] })
  if (result.exitCode !== 0 && result.stdout.trim() === '') {
    throw new Errors.UnexpectedBehaviorError(
      `Could not inspect existing native Studio processes: ${result.stderr.trim() || 'lsof failed'}`,
    )
  }
  const processIds = nativeDevelopmentProcessIds(result.stdout, artifactRoot)
  if (processIds.length === 0) {
    return 0
  }

  const terminated = await runner('/bin/kill', { args: ['-TERM', ...processIds.map(String)] })
  assertNativeProcessesSignalable(terminated, processIds)
  let remaining = processIds
  for (let attempt = 0; attempt < 30 && remaining.length > 0; attempt += 1) {
    remaining = await runningProcessIds(remaining, runner)
    if (remaining.length > 0) {
      await sleep(100)
    }
  }
  if (remaining.length > 0) {
    const killed = await runner('/bin/kill', { args: ['-KILL', ...remaining.map(String)] })
    assertNativeProcessesSignalable(killed, remaining)
  }
  return processIds.length
}

function nativeDevelopmentProcessIds(output: string, artifactRoot: string): number[] {
  const buildRoot = FS.resolvePath('build', artifactRoot)
  const processIds = new Set<number>()
  let processId: number | undefined
  let command: string | undefined
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1))
      processId = Number.isInteger(parsed) && parsed > 1 ? parsed : undefined
      command = undefined
    } else if (line.startsWith('c')) {
      command = line.slice(1)
    } else if (line.startsWith('n') && processId !== undefined) {
      const cwd = line.slice(1).replace(/ \(deleted\)$/, '')
      const relative = FS.relativePath(buildRoot, cwd)
      const isNativeApp = /^dev-[^/]+\/[^/]+-dev\.app\/Contents\/MacOS$/.test(relative)
      const isHutchEngine = cwd === FS.resolvePath(artifactRoot) && command === 'hutch-engine'
      if (isNativeApp || isHutchEngine) {
        processIds.add(processId)
      }
    }
  }
  return [...processIds].sort((left, right) => left - right)
}

async function runningProcessIds(processIds: readonly number[], runner: CommandRunner): Promise<number[]> {
  const probes = await Promise.all(processIds.map(async processId => ({
    processId,
    result: await runner('/bin/kill', { args: ['-0', String(processId)] }),
  })))
  for (const probe of probes) {
    assertNativeProcessesSignalable(probe.result, [probe.processId])
  }
  return probes.filter(probe => probe.result.exitCode === 0).map(probe => probe.processId)
}

function assertNativeProcessesSignalable(result: CLI.CommandResult, processIds: readonly number[]): void {
  if (result.exitCode !== 0 && /operation not permitted/i.test(result.stderr)) {
    throw new Errors.UnexpectedBehaviorError(
      `Existing native Studio processes could not be stopped (${processIds.join(', ')}). Close Tao Studio and retry.`,
    )
  }
}

function nativeRuntimeCloseResult(line: string): NativeRuntimeCloseResult | undefined {
  const exited = /Child process exited with code:\s*(\d+)/.exec(line)
  if (exited?.[1] !== undefined) {
    const exitCode = Number(exited[1])
    return {
      exitCode,
      message: exitCode === 0 ? '' : `Native Studio runtime exited with code ${exitCode}.`,
    }
  }
  const signaled = /Child process terminated by signal:\s*(\d+)/.exec(line)
  if (signaled?.[1] === undefined) {
    return undefined
  }
  const signal = Number(signaled[1])
  if (signal === 15) {
    return undefined
  }
  return {
    exitCode: 1,
    message: `Native Studio runtime terminated by signal ${signal}.`,
  }
}

async function packageApp(options: StudioNativePackageOptions): Promise<PackagedStudioNative> {
  const outputRoot = FS.resolvePath(options.outputRoot ?? '.artifacts/build/studio-native', Repo.getRoot())
  const projectRoot = FS.resolvePath('project', outputRoot)
  const serviceStageRoot = FS.resolvePath('service-stage', outputRoot)
  const channel = options.channel ?? 'stable'
  const releaseBaseUrl = requiredHttpsUrl(options.releaseBaseUrl).href
  const hutchPath = await resolveHutchExecutablePath(options.hutchPath)
  await validateStudioRelease()
  await FS.remove(serviceStageRoot)
  await FS.mkdir(serviceStageRoot)
  const serviceBundlePath = FS.resolvePath('service.js', serviceStageRoot)
  await stageStudioPackagedServiceBundle(serviceBundlePath)
  const studioClientBundlePath = FS.resolvePath('studio.js', serviceStageRoot)
  await stageStudioClientBundle(studioClientBundlePath)
  const testCommandBundlePath = FS.resolvePath('test-command.js', serviceStageRoot)
  const testCommandBundle = await Bun.build({
    entrypoints: [Repo.resolvePath('packages/dev/dev-src/studio/StudioPackagedTestCommand.ts')],
    minify: true,
    target: 'node',
  })
  const testCommandOutput = testCommandBundle.outputs[0]
  if (!testCommandBundle.success || testCommandOutput === undefined) {
    throw new Errors.UnexpectedBehaviorError(
      `Could not bundle the packaged Studio test command: ${testCommandBundle.logs.map(log => log.message).join('\n')}`,
    )
  }
  await FS.writeText(testCommandBundlePath, await testCommandOutput.text())
  const servicePayloadRoot = FS.resolvePath('payload', serviceStageRoot)
  await materializeStudioServicePayload(servicePayloadRoot, { 'studio.js': studioClientBundlePath })
  await FS.copyFile(testCommandBundlePath, FS.resolvePath('test-command.js', servicePayloadRoot))
  await materializeStudioNodeRuntime(
    options.nodePath ?? Repo.resolvePath('.devenv/profile/bin/node'),
    servicePayloadRoot,
  )
  await validatePackagedTestRuntime(servicePayloadRoot)
  const project = await StudioElectrobun.create({
    appName: options.appName ?? defaultAppName,
    bundleIdentifier: options.bundleIdentifier ?? defaultBundleIdentifier,
    outputRoot: projectRoot,
    packagedService: true,
    previewUrl: 'http://127.0.0.1:8081',
    releaseBaseUrl,
    serviceBundlePath,
    studioUrl: 'http://127.0.0.1:55101',
    version: options.version,
  })
  await FS.copyDirectory(servicePayloadRoot, FS.resolvePath('service/payload', project.root))
  const artifactsRoot = FS.resolvePath('artifacts', project.root)
  await FS.remove(artifactsRoot)
  await prepareElectrobun(hutchPath, project.root)
  await runHutchCommand(hutchPath, ['electrobun', 'build', `--env=${channel}`], project.root)
  const artifactPaths = await builtArtifacts(artifactsRoot)
  verifyReleaseArtifacts(artifactPaths, channel)
  return { artifactPaths, artifactsRoot, channel, projectRoot }
}

async function stageStudioPackagedServiceBundle(serviceBundlePath: string): Promise<void> {
  const bundle = await Bun.build({
    define: {
      __DEV__: 'false',
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    entrypoints: [Repo.resolvePath('packages/dev/dev-src/studio/StudioPackagedService.ts')],
    minify: true,
    plugins: [prebuiltStudioClientAssetsPlugin()],
    target: 'bun',
  })
  const serviceBundle = bundle.outputs[0]
  if (!bundle.success || serviceBundle === undefined) {
    throw new Errors.UnexpectedBehaviorError(
      `Could not bundle the packaged Studio service: ${bundle.logs.map(log => log.message).join('\n')}`,
    )
  }
  await FS.writeText(serviceBundlePath, await serviceBundle.text())
}

/**
 * The packaged service installs a prebuilt browser bundle before starting the Studio server, so
 * StudioClientAssets' runtime compiler is deliberately unavailable in this artifact. Keeping that
 * compiler would pull React Native's development-only WebSocket client into the Bun service.
 */
function prebuiltStudioClientAssetsPlugin(): Bun.BunPlugin {
  const namespace = 'tao-studio-prebuilt-client-runtime'
  // A module in a Bun plugin namespace has no importer directory, so `@shared/core` does not
  // resolve inside it; its absolute source path does, and Bun inlines the module rather than the
  // path, which keeps the repository root out of the payload.
  const sharedCorePath = Repo.resolvePath('packages/shared/shared-src/core/shared-core.ts')
  return {
    name: namespace,
    setup(build) {
      build.onResolve({ filter: /^@runtime-toolchain$/ }, args =>
        args.importer.endsWith('/StudioClientAssets.ts')
          ? { namespace, path: args.path }
          : undefined)
      build.onLoad({ filter: /.*/, namespace }, () => ({
        contents: `
          import { Errors } from ${JSON.stringify(sharedCorePath)}

          export default {
            async generateApp() {
              Errors.throwHostEnvironment('The packaged Tao Studio service requires its prebuilt browser bundle.')
            },
          }
        `,
        loader: 'js',
      }))
    },
  }
}

/** validateStudioRelease applies the compiler's targeted release gates before native packaging mutates output. */
async function validateStudioRelease(): Promise<void> {
  await Workspace.compile(Repo.resolvePath('packages/studio/studio-src/TaoStudioClient.tao'), {
    validationMode: 'release',
  })
}

function verifyReleaseArtifacts(artifactPaths: readonly string[], channel: 'canary' | 'stable'): void {
  const names = artifactPaths.map(path => FS.basename(path))
  const updatePrefix = `${channel}-`
  const missing = [
    names.some(name => name.startsWith(updatePrefix) && name.endsWith('-update.json')) ? undefined : 'update metadata',
    names.some(name => name.endsWith('.tar.zst')) ? undefined : 'full update archive',
    names.some(name => name.endsWith('.dmg') || name.endsWith('-Setup.zip') || name.endsWith('-Setup.tar.gz'))
      ? undefined
      : 'platform installer',
  ].filter((value): value is string => value !== undefined)
  if (missing.length > 0) {
    throw new Errors.UnexpectedBehaviorError(
      `Electrobun completed without required release artifacts: ${missing.join(', ')}.`,
    )
  }
}

async function materializeStudioServicePayload(
  payloadRoot: string,
  additionalFiles: Readonly<Record<string, string>>,
): Promise<void> {
  const packagesRoot = Repo.resolvePath('packages')
  const packageRoots = new Map<string, string>()
  for (const directory of await FS.listDir(packagesRoot)) {
    const root = FS.resolvePath(directory, packagesRoot)
    const packageJsonPath = FS.resolvePath('package.json', root)
    if (!await FS.isFile(packageJsonPath)) {
      continue
    }
    const packageJson = await FS.readJson<Record<string, unknown>>(packageJsonPath)
    if (typeof packageJson['name'] === 'string') {
      packageRoots.set(packageJson['name'], root)
    }
  }
  const required = new Set<string>(['tao-runtime-toolchain'])
  const pending = [...required]
  while (pending.length > 0) {
    const name = pending.shift()!
    const root = packageRoots.get(name)
    if (root === undefined) {
      throw new Errors.UnexpectedBehaviorError(`Studio service payload requires missing workspace package ${name}.`)
    }
    const packageJson = await FS.readJson<Record<string, unknown>>(FS.resolvePath('package.json', root))
    for (const dependencies of [packageJson['dependencies'], packageJson['peerDependencies']]) {
      if (!isRecord(dependencies)) {
        continue
      }
      for (const [dependency, version] of Object.entries(dependencies)) {
        if (typeof version === 'string' && version.startsWith('workspace:') && !required.has(dependency)) {
          required.add(dependency)
          pending.push(dependency)
        }
      }
    }
  }

  const verificationRoot = `${payloadRoot}.verification`
  await FS.remove(payloadRoot)
  await FS.remove(verificationRoot)
  await FS.mkdir(payloadRoot)
  await FS.copyFile(Repo.resolvePath('package.json'), FS.resolvePath('package.json', payloadRoot))
  await FS.copyFile(Repo.resolvePath('bun.lock'), FS.resolvePath('bun.lock', payloadRoot))
  for (const [name, sourceRoot] of [...packageRoots].sort(([left], [right]) => left.localeCompare(right))) {
    const targetRoot = FS.resolvePath(`packages/${FS.basename(sourceRoot)}`, payloadRoot)
    if (required.has(name)) {
      await copyPayloadTree(sourceRoot, targetRoot)
    } else {
      await FS.copyFile(FS.resolvePath('package.json', sourceRoot), FS.resolvePath('package.json', targetRoot))
    }
  }
  for (const [relativePath, sourcePath] of Object.entries(additionalFiles)) {
    await FS.copyFile(sourcePath, FS.resolvePath(relativePath, payloadRoot))
  }

  await FS.copyDirectory(payloadRoot, verificationRoot)
  try {
    await installStudioServicePayload(payloadRoot)
    await installStudioServicePayload(verificationRoot)
    const actualInventory = await dependencyInventory(payloadRoot)
    const verificationInventory = await dependencyInventory(verificationRoot)
    if (JSON.stringify(actualInventory) !== JSON.stringify(verificationInventory)) {
      throw new Errors.UnexpectedBehaviorError(
        'Two clean Studio service payload materializations produced different dependency inventories.',
      )
    }
    await validateStudioServicePayload(payloadRoot)
    await validateStudioServicePayload(verificationRoot)
  } finally {
    await FS.remove(verificationRoot)
  }
}

async function stageStudioClientBundle(path: string): Promise<void> {
  const source = portableStudioClientBundle(await StudioClientAssets.bundle({ validationMode: 'release' }))
  if (source.trim() === '') {
    throw new Errors.UnexpectedBehaviorError('Studio browser bundling produced an empty artifact.')
  }
  await FS.writeText(path, source)
}

function portableStudioClientBundle(source: string): string {
  const repositoryPrefix = `${FS.slashPath(Repo.getRoot()).replace(/\/$/, '')}/`
  const sourcePathPrefix = new RegExp(
    `(source\\s*:\\s*\\{\\s*path\\s*:\\s*["'])${escapeRegularExpression(repositoryPrefix)}`,
    'g',
  )
  return source.replace(sourcePathPrefix, (_match, property: string) => property)
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function materializeStudioNodeRuntime(
  sourceNodePath: string,
  payloadRoot: string,
  runner: CommandRunner = CLI.run,
): Promise<void> {
  const requestedNode = FS.resolvePath(sourceNodePath)
  if (!await FS.isFile(requestedNode)) {
    throw new Errors.UserInputError(`Studio packaging Node executable was not found: ${sourceNodePath}`)
  }
  const sourceNode = await FS.realPath(requestedNode)
  const architecture = await runChecked('lipo', ['-archs', sourceNode], undefined, runner)
  const requiredArchitecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : process.arch
  if (!architecture.stdout.trim().split(/\s+/).includes(requiredArchitecture)) {
    throw new Errors.UserInputError(
      `Studio packaging Node does not contain the build-host ${requiredArchitecture} architecture.`,
    )
  }

  const targetNode = FS.resolvePath('bin/node', payloadRoot)
  const targetBySource = new Map<string, string>([[sourceNode, targetNode]])
  const pending = [sourceNode]
  while (pending.length > 0) {
    const source = pending.shift()!
    for (const dependency of await machoDependencies(source, runner)) {
      if (!dependency.startsWith('/nix/store/') || targetBySource.has(dependency)) {
        continue
      }
      const hash = createHash('sha256').update(dependency).digest('hex').slice(0, 12)
      targetBySource.set(dependency, FS.resolvePath(`lib/${hash}-${FS.basename(dependency)}`, payloadRoot))
      pending.push(dependency)
    }
  }

  await FS.remove(FS.resolvePath('bin', payloadRoot))
  await FS.remove(FS.resolvePath('lib', payloadRoot))
  for (const [source, target] of targetBySource) {
    await FS.copyFile(source, target)
    await runChecked('chmod', ['755', target], undefined, runner)
  }
  for (const [source, target] of targetBySource) {
    for (const dependency of await machoDependencies(source, runner)) {
      const dependencyTarget = targetBySource.get(dependency)
      if (dependencyTarget === undefined) {
        continue
      }
      const relativeDependency = target === targetNode
        ? `@loader_path/../lib/${FS.basename(dependencyTarget)}`
        : `@loader_path/${FS.basename(dependencyTarget)}`
      await runChecked('install_name_tool', ['-change', dependency, relativeDependency, target], undefined, runner)
    }
    if (target !== targetNode) {
      await runChecked('install_name_tool', ['-id', `@loader_path/${FS.basename(target)}`, target], undefined, runner)
    }
  }

  for (const target of targetBySource.values()) {
    const dependencies = await machoDependencies(target, runner)
    const hostBoundDependency = dependencies.find(dependency =>
      !dependency.startsWith('@')
      && !dependency.startsWith('/System/Library/')
      && !dependency.startsWith('/usr/lib/')
    )
    if (hostBoundDependency !== undefined) {
      throw new Errors.UserInputError(
        `Studio packaging Node retains a host-bound Mach-O dependency (${hostBoundDependency}). `
          + 'Supply a standalone Node executable or a Nix Node whose closure can be relocated.',
      )
    }
    const targetArchitectures = await runChecked('lipo', ['-archs', target], undefined, runner)
    if (!targetArchitectures.stdout.trim().split(/\s+/).includes(requiredArchitecture)) {
      throw new Errors.UnexpectedBehaviorError(
        `Relocated Studio Node dependency does not contain ${requiredArchitecture}: ${target}`,
      )
    }
  }
  const version = await runChecked(targetNode, ['--version'], payloadRoot, runner)
  if (!/^v\d+\.\d+\.\d+\s*$/.test(version.stdout)) {
    throw new Errors.UnexpectedBehaviorError('Relocated Studio Node did not report a valid version.')
  }
}

async function validatePackagedTestRuntime(payloadRoot: string): Promise<void> {
  const runtimeToolchainRoot = FS.resolvePath('packages/runtime-toolchain', payloadRoot)
  const nodePath = FS.resolvePath('bin/node', payloadRoot)
  const result = await CLI.run(nodePath, {
    args: [FS.resolvePath('test-command.js', payloadRoot), Repo.resolvePath('Apps/Test Apps/Data MVP')],
    cwd: payloadRoot,
    env: {
      TAO_STDLIB_ROOT: FS.resolvePath('packages/stdlib', payloadRoot),
      TAO_TEST_IN_PROCESS: 'true',
      TAO_TEST_JEST_PATH: FS.resolvePath('node_modules/jest/bin/jest.js', payloadRoot),
      TAO_TEST_NODE_PATH: nodePath,
      TAO_TEST_NODE_MODULES_ROOT: FS.resolvePath('node_modules', payloadRoot),
      TAO_TEST_RUNTIME_ROOT: runtimeToolchainRoot,
    },
    stdio: 'pipe',
  })
  await FS.remove(FS.resolvePath('_gen_tao-app-test', runtimeToolchainRoot))
  if (result.error !== undefined || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
}

async function machoDependencies(path: string, runner: CommandRunner): Promise<readonly string[]> {
  const output = await runChecked('otool', ['-L', path], undefined, runner)
  return output.stdout.split(/\r?\n/).slice(1).flatMap(line => {
    const match = /^\s*(\S+)\s+\(compatibility version/.exec(line)
    return match?.[1] === undefined ? [] : [match[1]]
  })
}

async function runChecked(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
  runner: CommandRunner,
): Promise<CLI.CommandResult> {
  const result = await runner(command, { args, cwd, stdio: 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
  return result
}

async function installStudioServicePayload(
  payloadRoot: string,
  runner: CommandRunner = CLI.run,
): Promise<void> {
  const installTempRoot = FS.resolvePath('.tmp', payloadRoot)
  await FS.mkdir(installTempRoot)
  const install = await runner('bun', {
    args: [
      'install',
      '--production',
      '--frozen-lockfile',
      '--filter=tao-runtime-toolchain',
      '--linker=hoisted',
      '--backend=copyfile',
    ],
    cwd: payloadRoot,
    env: { TMPDIR: installTempRoot },
    stdio: 'stream',
  })
  if (install.error !== undefined || install.exitCode !== 0) {
    throw new Errors.CommandExecutionError(install)
  }
  await FS.remove(installTempRoot)
  await materializePayloadSymlinks(payloadRoot)
}

async function dependencyInventory(payloadRoot: string): Promise<readonly string[]> {
  const nodeModulesRoot = FS.resolvePath('node_modules', payloadRoot)
  const inventory: string[] = []
  for await (const path of FS.walk(nodeModulesRoot, { includeHidden: true })) {
    if (FS.basename(path) !== 'package.json') {
      continue
    }
    const packageJson = await FS.readJson<Record<string, unknown>>(path)
    const name = packageJson['name']
    const version = packageJson['version']
    if (typeof name === 'string' && typeof version === 'string') {
      inventory.push(`${FS.relativePath(nodeModulesRoot, path)}:${name}@${version}`)
    }
  }
  return inventory.sort()
}

async function copyPayloadTree(sourceRoot: string, targetRoot: string): Promise<void> {
  for await (
    const sourcePath of FS.walk(sourceRoot, {
      excludeDirectory: name => name === 'node_modules' || name === '.artifacts' || name.startsWith('_gen_'),
      includeHidden: true,
    })
  ) {
    await FS.copyFile(sourcePath, FS.resolvePath(FS.relativePath(sourceRoot, sourcePath), targetRoot))
  }
}

async function materializePayloadSymlinks(payloadRoot: string): Promise<void> {
  for (let pass = 0; pass < 20; pass += 1) {
    const symlinks: Array<{ path: string; target: string }> = []
    for await (const path of FS.walk(payloadRoot, { includeDirectories: true, includeHidden: true })) {
      const target = await FS.realPath(path)
      if (target !== FS.resolvePath(path)) {
        symlinks.push({ path, target })
      }
    }
    if (symlinks.length === 0) {
      return
    }
    for (const symlink of symlinks.sort((left, right) => right.path.length - left.path.length)) {
      const temporaryPath = `${symlink.path}.materializing`
      await FS.remove(temporaryPath)
      if (await FS.isDirectory(symlink.target)) {
        await FS.copyDirectory(symlink.target, temporaryPath)
      } else {
        await FS.copyFile(symlink.target, temporaryPath)
      }
      await FS.remove(symlink.path)
      await FS.move(temporaryPath, symlink.path)
    }
  }
  throw new Errors.UnexpectedBehaviorError('Studio service payload symlinks did not converge while materializing.')
}

async function validateStudioServicePayload(payloadRoot: string): Promise<void> {
  const required = [
    'packages/runtime-toolchain/app.json',
    'packages/runtime-toolchain/index.ts',
    'packages/runtime-toolchain/metro.config.cjs',
    'studio.js',
    'node_modules/expo/package.json',
    'node_modules/tao-runtime/package.json',
    'node_modules/tao-shared/package.json',
    'node_modules/tao-workspace/package.json',
  ]
  for (const relativePath of required) {
    if (!await FS.isFile(FS.resolvePath(relativePath, payloadRoot))) {
      throw new Errors.UnexpectedBehaviorError(`Studio service payload is missing ${relativePath}.`)
    }
  }
  const repositoryRoot = Repo.getRoot()
  for await (const path of FS.walk(payloadRoot, { includeDirectories: true, includeHidden: true })) {
    if (await FS.realPath(path) !== FS.resolvePath(path)) {
      throw new Errors.UnexpectedBehaviorError(`Studio service payload contains a symlink: ${path}`)
    }
    if (await FS.isFile(path) && ['.json', '.js', '.ts', '.cjs', '.mjs', '.map'].includes(FS.extname(path))) {
      const content = await FS.readText(path)
      if (content.includes(repositoryRoot)) {
        throw new Errors.UnexpectedBehaviorError(`Studio service payload contains an absolute repository path: ${path}`)
      }
    }
  }
}

async function prepareElectrobun(
  hutchPath: string,
  projectRoot: string,
  runner: CommandRunner = CLI.run,
  holders: LockHolderProbe = electrobunBuildLockHolders,
  releaseHolders: ReleaseHolderProbe = electrobunReleaseHolders,
): Promise<void> {
  if (await clearStaleElectrobunBuildLock(projectRoot, holders)) {
    HCI.logProcessInfo('studio-native', 'Cleared an Electrobun build lock an interrupted run left behind.')
  }
  await requireIdleElectrobunRelease(releaseHolders)
  await runHutchCommand(hutchPath, ['install'], projectRoot, runner)
  await runHutchCommand(hutchPath, ['electrobun', 'prepare'], projectRoot, runner)
}

/**
 * clearStaleElectrobunBuildLock removes a build lock whose owner is gone. Hutch waits on that lock forever
 * — `hutch electrobun prepare` prints `Waiting for the project build lock...` and never returns — so an
 * interrupted native launch otherwise blocks every later one in the same project.
 */
async function clearStaleElectrobunBuildLock(
  projectRoot: string,
  holders: LockHolderProbe = electrobunBuildLockHolders,
): Promise<boolean> {
  const lockPath = FS.resolvePath(electrobunBuildLockPath, projectRoot)
  if (!(await FS.exists(lockPath)) || (await holders(lockPath)).length > 0) {
    return false
  }
  await FS.remove(lockPath)
  return true
}

/**
 * requireIdleElectrobunRelease fails fast when another native Studio is running anywhere on this machine.
 * Hutch takes the shared Electrobun release lock for a dev shell's whole lifetime, so `electrobun prepare`
 * would otherwise block inside `open` with no message and no timeout, whatever the worktree.
 */
async function requireIdleElectrobunRelease(
  probe: ReleaseHolderProbe = electrobunReleaseHolders,
  sleep: Sleep = Time.sleep,
): Promise<void> {
  // A holder that is shutting down releases the lock a moment after its process is signalled.
  let holders = await probe()
  for (let attempt = 0; attempt < 10 && holders.length > 0; attempt += 1) {
    await sleep(200)
    holders = await probe()
  }
  if (holders.length === 0) {
    return
  }
  const described = holders.map(holder => `  pid ${holder.processId}: ${holder.command}`).join('\n')
  Errors.throwHostEnvironment(
    `Another native Tao Studio holds the shared Electrobun release, so this launch would wait forever.\n${described}\n`
      + 'Stop it first — `./dev studio-stop --all` in the worktree that started it, or kill the process ids above.',
  )
}

async function electrobunReleaseHolders(): Promise<readonly NativeStudioHolder[]> {
  const releasesRoot = FS.resolvePath(electrobunReleasesPath, FS.homeDir())
  if (!(await FS.isDirectory(releasesRoot))) {
    return []
  }
  // Layout is `<releases>/electrobun/<version>/<platform>.lock`.
  const lockPaths: string[] = []
  for (const version of await FS.listDir(releasesRoot)) {
    const versionRoot = FS.resolvePath(version, releasesRoot)
    if (!(await FS.isDirectory(versionRoot))) {
      continue
    }
    for (const entry of await FS.listDir(versionRoot)) {
      if (entry.endsWith('.lock')) {
        lockPaths.push(FS.resolvePath(entry, versionRoot))
      }
    }
  }
  const holders: NativeStudioHolder[] = []
  for (const lockPath of lockPaths) {
    for (const processId of await electrobunBuildLockHolders(lockPath)) {
      holders.push({ command: await processCommand(processId), processId })
    }
  }
  return holders
}

async function processCommand(processId: number): Promise<string> {
  const result = await runQuietly('ps', ['-o', 'command=', '-p', String(processId)])
  return result.trim().split('\n')[0] ?? 'unknown process'
}

async function electrobunBuildLockHolders(lockPath: string): Promise<readonly number[]> {
  // `lsof -t` lists the process ids holding the file open, and exits non-zero when there are none.
  return (await runQuietly('lsof', ['-t', lockPath])).split('\n')
    .map(line => Number.parseInt(line.trim(), 10))
    .filter(processId => Number.isInteger(processId) && processId > 0)
}

/**
 * runQuietly returns a command's output, or nothing when the command fails or cannot be spawned at all.
 * These probes only diagnose a launch; a sandbox that refuses `lsof` or `ps` must not stop one.
 */
async function runQuietly(command: string, args: readonly string[]): Promise<string> {
  try {
    return (await CLI.run(command, { args })).stdout
  } catch {
    return ''
  }
}

async function resolveHutchExecutablePath(
  requestedPath = defaultHutchCommand,
  environment: {
    homeDirectory?: string
    path?: string
  } = {},
): Promise<string> {
  if (requestedPath !== defaultHutchCommand) {
    const explicitPath = FS.resolvePath(requestedPath)
    if (await FS.isFile(explicitPath)) {
      return explicitPath
    }
    throw missingHutchError(`The Hutch executable specified by --hutch was not found: ${explicitPath}`)
  }

  const executableNames = ['hutch', 'hutch.exe']
  const candidates = (environment.path ?? Platform.runtimeProcess.env['PATH'] ?? '')
    .split(pathDelimiter)
    .filter(directory => directory.length > 0)
    .flatMap(directory => executableNames.map(name => FS.resolvePath(name, directory)))
  const homeDirectory = environment.homeDirectory ?? FS.homeDir()
  candidates.push(...executableNames.map(name => FS.resolvePath(`.hutch/bin/${name}`, homeDirectory)))
  const installed = await installedHutchExecutablePath(candidates)
  if (installed !== undefined) {
    return installed
  }
  throw missingHutchError('Hutch is not installed or is not available on PATH.')
}

function missingHutchError(reason: string): Errors.UserInputError {
  const installedPath = FS.resolvePath('.hutch/bin/hutch', FS.homeDir())
  return new Errors.UserInputError([
    `${reason} Native Tao Studio requires the Hutch launcher; its generated project pins Hutch CLI 0.24.3.`,
    `Install Hutch with the official verified installer: curl -fsSL ${hutchInstallUrl} | sh`,
    `Then open a new terminal, or retry now with --hutch ${installedPath}`,
    'To use Studio without the native shell, run ./dev studio instead.',
  ].join('\n'))
}

async function runHutchCommand(
  hutchPath: string,
  args: readonly string[],
  projectRoot: string,
  runner: CommandRunner = CLI.run,
): Promise<void> {
  const result = await runner(hutchPath, {
    args,
    cwd: projectRoot,
    stdio: 'stream',
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
}

async function builtArtifacts(artifactsRoot: string): Promise<readonly string[]> {
  if (!await FS.isDirectory(artifactsRoot)) {
    return []
  }
  const paths: string[] = []
  for await (const path of FS.walk(artifactsRoot)) {
    paths.push(path)
  }
  return paths.sort()
}

async function installedHutchExecutablePath(
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await FS.isFile(candidate)) {
      return candidate
    }
  }
  return undefined
}

async function waitForProbeResult(
  resultPath: string,
  command: Pick<StoppableCommand, 'exitCode' | 'signalCode'>,
  sleep: (milliseconds: number) => Promise<void> = Time.sleep,
): Promise<StudioNativeProbeResult> {
  const deadline = Date.now() + probeTimeoutMs
  while (Date.now() < deadline) {
    if (await FS.isFile(resultPath)) {
      return probeResult(await FS.readJson(resultPath))
    }
    if (command.exitCode !== null || command.signalCode !== null) {
      throw new Errors.UnexpectedBehaviorError('Electrobun exited before writing its runtime probe result.')
    }
    await sleep(100)
  }
  throw new Errors.UnexpectedBehaviorError('Timed out waiting for the Electrobun runtime probe.')
}

function probeResult(value: unknown): StudioNativeProbeResult {
  if (
    !isRecord(value) || typeof value['passed'] !== 'boolean' || !isRecord(value['capabilities'])
  ) {
    throw new Errors.UnexpectedBehaviorError('Electrobun wrote an invalid runtime probe result.')
  }
  const capabilities: StudioNativeProbeResult['capabilities'] = {}
  for (const [name, result] of Object.entries(value['capabilities'])) {
    if (
      !isRecord(result) || typeof result['passed'] !== 'boolean'
      || (result['message'] !== undefined && typeof result['message'] !== 'string')
    ) {
      throw new Errors.UnexpectedBehaviorError('Electrobun wrote an invalid runtime probe capability.')
    }
    capabilities[name] = { message: result['message'], passed: result['passed'] }
  }
  return { capabilities, passed: value['passed'] }
}

function requiredHttpsUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Errors.UserInputError('Studio release base URL must be a valid HTTPS URL.')
  }
  if (url.protocol !== 'https:') {
    throw new Errors.UserInputError('Studio release base URL must be a valid HTTPS URL.')
  }
  return url
}

async function stopCommand(
  command: StoppableCommand,
  sleep: (milliseconds: number) => Promise<void> = Time.sleep,
  waitForClose: WaitForNativeClose = finalizeCommand(command),
): Promise<void> {
  await stopStudioProcessTree(command, { sleep, waitForClose })
}

function finalizeCommand(command: StoppableCommand): WaitForNativeClose {
  const waitForResult = finalizeStudioProcessTree(command)
  return async () => {
    const result = await waitForResult()
    return result.exitCode ?? (result.signal === 'SIGINT' ? 130 : 0)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
