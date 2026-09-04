import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { StudioClientAssets } from '@studio'
import { Workspace } from '@workspace'
import { createHash } from 'node:crypto'
import { delimiter as pathDelimiter } from 'node:path'
import { MachineLanes, type MachineResourceLease } from '../repository-tests/MachineLanes'
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
// Both bounds leave room inside the 120-second native smoke gate for Studio startup, the runtime
// probe, and process-tree shutdown. Healthy local runs complete both commands in under ten seconds.
const hutchInstallTimeoutMs = 30_000
const electrobunPrepareTimeoutMs = 45_000
const electrobunBuildTimeoutMs = 120_000
const hutchShutdownTimeoutMs = 5_000
const hutchDiagnosticOutputLimit = 8_000
const defaultAppName = 'Tao Studio'
const defaultBundleIdentifier = 'dev.tao-lang.studio'
const defaultHutchCommand = 'hutch'
const hutchInstallUrl = 'https://hutch.blackboard.sh/hutch/install.sh'

export type StudioNativeOptions = {
  artifactRoot?: string
  hutchPath?: string
  /** Operation recorded in the machine-wide native-host lease. */
  nativeHostCommand?: string
  previewUrl: string
  /** Undefined opens the Welcome window only: `--no-browser` must not add a project window. */
  projectUrl?: string
  probe?: boolean
  showWindow?: boolean
  signal?: AbortSignal
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
type NativePhaseLog = (message: string) => void
type StartProcessTree = typeof startStudioProcessTree
type NativeStartLifecycleOptions = {
  onProcessSignal?: typeof Platform.onProcessSignal
}
type PrepareElectrobunOptions = {
  installTimeoutMs?: number
  log?: NativePhaseLog
  now?: () => number
  prepareTimeoutMs?: number
  runner?: CommandRunner
  signal?: AbortSignal
  startCommand?: StartProcessTree
  stopCommand?: typeof stopStudioProcessTree
}
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
    installedHutchExecutablePath,
    installStudioServicePayload,
    createNativeInterruption,
    materializeStudioNodeRuntime,
    materializeStudioServicePayload,
    nativeRuntimeCloseResult,
    nativeDevelopmentProcessIds,
    prepareElectrobun,
    runNativePhase,
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

async function start(
  options: StudioNativeOptions,
  lifecycleOptions: NativeStartLifecycleOptions = {},
): Promise<StartedStudioNative> {
  const interruption = createNativeInterruption(options.signal, lifecycleOptions.onProcessSignal)
  let nativeHostLease: MachineResourceLease | undefined
  try {
    const hutchPath = await resolveHutchExecutablePath(options.hutchPath)
    nativeHostLease = await runNativePhase(
      'native host lease',
      async () =>
        await MachineLanes.acquireResource({
          command: options.nativeHostCommand ?? 'studio-native',
          name: 'studio-native-host',
          repositoryRoot: Repo.getRoot(),
          waitTimeoutMs: 0,
        }),
      { signal: interruption.signal },
    )
    return await startWithInterruption(
      { ...options, hutchPath, signal: interruption.signal },
      interruption.close,
      nativeHostLease,
    )
  } catch (error) {
    await releaseNativeHostLease(nativeHostLease)
    interruption.close()
    throw error
  }
}

async function startWithInterruption(
  options: StudioNativeOptions,
  closeInterruption: () => void,
  nativeHostLease: MachineResourceLease,
): Promise<StartedStudioNative> {
  const hutchPath = options.hutchPath ?? defaultHutchCommand
  const artifactRoot = FS.resolvePath(options.artifactRoot ?? '.artifacts/user/studio-native', Repo.getRoot())
  const phaseOptions = { signal: options.signal }
  const stoppedNativeProcesses = await runNativePhase(
    'owned process inspection',
    async () => await stopExistingNativeDevelopmentProcesses(artifactRoot),
    phaseOptions,
  )
  if (stoppedNativeProcesses > 0) {
    HCI.logProcessInfo(
      'studio-native',
      `Stopped ${stoppedNativeProcesses} existing native Studio ${
        stoppedNativeProcesses === 1 ? 'process' : 'processes'
      }.`,
    )
  }
  const project = await runNativePhase(
    'materialize Electrobun project',
    async () =>
      await StudioElectrobun.create({
        appName: defaultAppName,
        bundleIdentifier: defaultBundleIdentifier,
        outputRoot: artifactRoot,
        previewUrl: options.previewUrl,
        projectUrl: options.projectUrl,
        runProbe: options.probe,
        showWindow: options.showWindow,
        studioUrl: options.studioUrl,
      }),
    phaseOptions,
  )
  await FS.remove(project.runtimeResultPath)
  await prepareElectrobun(hutchPath, project.root, { signal: options.signal })
  let finishRuntimeClose: ((result: NativeRuntimeCloseResult) => void) | undefined
  const runtimeClosed = new Promise<NativeRuntimeCloseResult>(resolve => {
    finishRuntimeClose = resolve
  })
  const outputRemainders: Record<CLI.CommandOutputStream, string> = { stderr: '', stdout: '' }
  const command = await runNativePhase(
    'electrobun dev --watch',
    () =>
      startStudioProcessTree(hutchPath, {
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
      }),
    phaseOptions,
  )
  const waitForHutchClose = finalizeCommand(command)
  let stopping: Promise<void> | undefined
  let closing: Promise<number> | undefined
  let releasingNativeHost: Promise<void> | undefined
  let removeAbortStop = () => {}
  let interruptionClosed = false
  const closeInterruptionOnce = () => {
    if (!interruptionClosed) {
      interruptionClosed = true
      removeAbortStop()
      closeInterruption()
    }
  }
  const releaseNativeHostOnce = () => {
    releasingNativeHost ??= releaseNativeHostLease(nativeHostLease)
    return releasingNativeHost
  }
  const stopHutch = () => {
    stopping ??= runNativePhase(
      'owned process tree shutdown',
      async () => await stopCommand(command, Time.sleep, waitForHutchClose),
    ).then(() => {
      HCI.logProcessInfo('studio-native', 'cleanup: all command-owned processes stopped')
    }).finally(async () => {
      closeInterruptionOnce()
      await releaseNativeHostOnce()
    })
    return stopping
  }
  if (options.signal !== undefined) {
    const stopOnAbort = () => {
      void stopHutch().catch(error => {
        HCI.logProcessError('studio-native', `Could not stop interrupted Hutch: ${Errors.formatForLog(error)}`)
      })
    }
    options.signal.addEventListener('abort', stopOnAbort, { once: true })
    removeAbortStop = () => options.signal?.removeEventListener('abort', stopOnAbort)
    if (options.signal.aborted) {
      stopOnAbort()
    }
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
      waitForHutchClose().then(async exitCode => {
        // The launcher may exit before every descendant in its detached process group. The close
        // path owns the same complete-tree cleanup as an explicit stop before releasing the host.
        await stopHutch()
        return { exitCode, message: '' }
      }),
      handledRuntimeClose,
    ]).then(result => result.exitCode).finally(async () => {
      closeInterruptionOnce()
      await releaseNativeHostOnce()
    })
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
      return runNativePhase(
        'runtime probe',
        async () => await waitForProbeResult(project.runtimeResultPath, command, Time.sleep, options.signal),
        phaseOptions,
      )
    },
  }
}

async function releaseNativeHostLease(lease: MachineResourceLease | undefined): Promise<void> {
  if (lease === undefined) {
    return
  }
  await runNativePhase('native host lease release', async () => await lease.release())
}

function createNativeInterruption(
  parentSignal: AbortSignal | undefined,
  onProcessSignal: typeof Platform.onProcessSignal = Platform.onProcessSignal,
): { close: () => void; signal: AbortSignal } {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  const removeParent = parentSignal === undefined
    ? () => {}
    : (() => {
      parentSignal.addEventListener('abort', interrupt, { once: true })
      return () => parentSignal.removeEventListener('abort', interrupt)
    })()
  const removeSignals = [
    onProcessSignal('SIGHUP', interrupt),
    onProcessSignal('SIGINT', interrupt),
    onProcessSignal('SIGTERM', interrupt),
  ]
  if (parentSignal?.aborted === true) {
    interrupt()
  }
  let closed = false
  return {
    close() {
      if (closed) {
        return
      }
      closed = true
      removeParent()
      for (const removeSignal of removeSignals) {
        removeSignal()
      }
    },
    signal: controller.signal,
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
    throw new Errors.HostEnvironmentError(
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
    throw new Errors.HostEnvironmentError(
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
  await runHutchCommand(hutchPath, ['electrobun', 'build', `--env=${channel}`], project.root, {
    failureKind: 'electrobun-build-timeout',
    timeoutMs: electrobunBuildTimeoutMs,
  })
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
  optionsOrRunner: PrepareElectrobunOptions | CommandRunner = {},
): Promise<void> {
  const options = typeof optionsOrRunner === 'function' ? { runner: optionsOrRunner } : optionsOrRunner
  await runNativePhase(
    'hutch install',
    async () =>
      await runHutchCommand(hutchPath, ['install'], projectRoot, {
        ...options,
        failureKind: 'hutch-install-timeout',
        timeoutMs: options.installTimeoutMs ?? hutchInstallTimeoutMs,
      }),
    options,
  )
  await runNativePhase(
    'electrobun prepare',
    async () =>
      await runHutchCommand(hutchPath, ['electrobun', 'prepare'], projectRoot, {
        ...options,
        failureKind: 'electrobun-prepare-timeout',
        timeoutMs: options.prepareTimeoutMs ?? electrobunPrepareTimeoutMs,
      }),
    options,
  )
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
  options: PrepareElectrobunOptions & { failureKind: string; timeoutMs: number },
): Promise<void> {
  throwIfNativeInterrupted(options.signal, args.join(' '), projectRoot)
  if (options.runner !== undefined) {
    const result = await options.runner(hutchPath, { args, cwd: projectRoot, stdio: 'stream' })
    if (result.error !== undefined || result.exitCode !== 0) {
      throw new Errors.CommandExecutionError(result)
    }
    return
  }

  const startedAt = (options.now ?? Time.nowMs)()
  let spawnError: Error | undefined
  let output = ''
  const commandSpec: Parameters<StartProcessTree>[1] = {
    args,
    cwd: projectRoot,
    onError(error) {
      spawnError = error
    },
    onOutput(_stream, chunk) {
      output = boundedDiagnosticOutput(`${output}${chunk.toString('utf8')}`)
    },
  }
  let command: StudioProcessTree
  try {
    command = (options.startCommand ?? startStudioProcessTree)(hutchPath, commandSpec)
  } catch (error) {
    throw new Errors.HostEnvironmentError(
      `Could not start ${args.join(' ')} in ${projectRoot}.`,
      { cause: error, details: { command: hutchPath, phase: args.join(' '), projectRoot } },
    )
  }
  const waitForClose = finalizeStudioProcessTree(command)
  const outcome = await waitForCommandOutcome(waitForClose(), options.timeoutMs, options.signal)
  if (outcome.kind !== 'closed') {
    let cleanupError: unknown
    try {
      await stopProcessTreeBoundedly(command, waitForClose, options.stopCommand)
    } catch (error) {
      cleanupError = error
    }
    const elapsedMs = Math.max(0, Math.round((options.now ?? Time.nowMs)() - startedAt))
    const interrupted = outcome.kind === 'interrupted'
    const failureKind = interrupted ? 'user-interruption' : options.failureKind
    const action = interrupted
      ? `was interrupted after ${elapsedMs}ms`
      : `timed out after ${options.timeoutMs}ms (elapsed ${elapsedMs}ms)`
    const diagnostic = output === '' ? '(no Hutch output)' : output
    throw new Errors.HostEnvironmentError(
      `Hutch ${args.join(' ')} ${action} in ${projectRoot}.\nRelevant output:\n${diagnostic}`,
      {
        cause: cleanupError,
        details: {
          command: hutchPath,
          elapsedMs,
          failureKind,
          output: diagnostic,
          phase: args.join(' '),
          projectRoot,
        },
      },
    )
  }
  if (spawnError !== undefined || outcome.result.exitCode !== 0) {
    throw new Errors.CommandExecutionError({
      args,
      command: hutchPath,
      cwd: projectRoot,
      error: spawnError,
      exitCode: outcome.result.exitCode,
      signal: outcome.result.signal,
      stderr: output,
      stdout: output,
    })
  }
}

type HutchCommandOutcome =
  | { kind: 'closed'; result: CLI.CommandCloseResult }
  | { kind: 'interrupted' }
  | { kind: 'timeout' }

async function waitForCommandOutcome(
  closed: Promise<CLI.CommandCloseResult>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HutchCommandOutcome> {
  return await new Promise(resolve => {
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const complete = (outcome: HutchCommandOutcome) => {
      if (finished) {
        return
      }
      finished = true
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      signal?.removeEventListener('abort', interrupted)
      resolve(outcome)
    }
    const interrupted = () => complete({ kind: 'interrupted' })
    signal?.addEventListener('abort', interrupted, { once: true })
    timeout = setTimeout(() => complete({ kind: 'timeout' }), timeoutMs)
    void closed.then(result => complete({ kind: 'closed', result }))
    if (signal?.aborted === true) {
      interrupted()
    }
  })
}

async function stopProcessTreeBoundedly(
  command: StudioProcessTree,
  waitForClose: () => Promise<unknown>,
  stopProcessTree: typeof stopStudioProcessTree = stopStudioProcessTree,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const stopped = stopProcessTree(command, { waitForClose }).then(() => true)
  try {
    const completed = await Promise.race([
      stopped,
      new Promise<false>(resolve => {
        timeout = setTimeout(() => resolve(false), hutchShutdownTimeoutMs)
      }),
    ])
    if (!completed) {
      command.kill('SIGKILL')
      throw new Errors.HostEnvironmentError('Hutch process-tree cleanup did not complete within 5000ms.')
    }
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

function boundedDiagnosticOutput(output: string): string {
  if (output.length <= hutchDiagnosticOutputLimit) {
    return output
  }
  return `[earlier Hutch output truncated]\n${output.slice(-hutchDiagnosticOutputLimit)}`
}

async function runNativePhase<Value>(
  phase: string,
  run: () => Value | Promise<Value>,
  options: Pick<PrepareElectrobunOptions, 'log' | 'now' | 'signal'> = {},
): Promise<Value> {
  const now = options.now ?? Time.nowMs
  const log = options.log ?? (message => HCI.logProcessInfo('studio-native', message))
  throwIfNativeInterrupted(options.signal, phase)
  const startedAt = now()
  log(`${phase}: started`)
  try {
    const result = await run()
    log(`${phase}: completed in ${Math.max(0, Math.round(now() - startedAt))}ms`)
    return result
  } catch (error) {
    log(`${phase}: failed after ${Math.max(0, Math.round(now() - startedAt))}ms`)
    throw error
  }
}

function throwIfNativeInterrupted(signal: AbortSignal | undefined, phase: string, projectRoot?: string): void {
  if (signal?.aborted === true) {
    throw new Errors.HostEnvironmentError(
      `Native Studio was interrupted before ${phase}${projectRoot === undefined ? '' : ` in ${projectRoot}`}.`,
      { details: { failureKind: 'user-interruption', phase, projectRoot } },
    )
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
  signal?: AbortSignal,
): Promise<StudioNativeProbeResult> {
  const deadline = Date.now() + probeTimeoutMs
  while (Date.now() < deadline) {
    throwIfNativeInterrupted(signal, 'runtime probe')
    if (await FS.isFile(resultPath)) {
      return probeResult(await FS.readJson(resultPath))
    }
    if (command.exitCode !== null || command.signalCode !== null) {
      throw new Errors.HostEnvironmentError('Electrobun exited before writing its runtime probe result.')
    }
    await sleep(100)
  }
  throw new Errors.HostEnvironmentError('Timed out waiting for the Electrobun runtime probe.')
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
  await stopProcessTreeBoundedly(
    command,
    waitForClose,
    async (ownedCommand, options) => await stopStudioProcessTree(ownedCommand, { ...options, sleep }),
  )
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
