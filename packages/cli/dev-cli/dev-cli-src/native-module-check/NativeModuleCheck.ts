import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

const EXPO_PREBUILD_TIMEOUT_MS = 2 * 60_000
const COCOAPODS_INSTALL_TIMEOUT_MS = 5 * 60_000
const POD_INSPECTION_TIMEOUT_MS = 2 * 60_000
const XCODE_TARGET_LIST_TIMEOUT_MS = 2 * 60_000
const XCODE_TARGET_BUILD_TIMEOUT_MS = 10 * 60_000

const HOST_FILES = [
  'app.json',
  'app.config.js',
  'app-config.cjs',
  'index.ts',
  'metro.config.cjs',
  'package.json',
] as const

const HOST_DIRECTORIES = ['assets', 'plugins'] as const

export type NativeModuleCommand = {
  args: readonly string[]
  command: string
  cwd: string
  env?: Platform.ProcessEnv
  phase: string
  quiet?: boolean
  timeoutMs: number
}

export type NativeModuleCommandResult = {
  error?: Error
  exitCode: number | null
  stderr: string
  stdout: string
  timedOut: boolean
}

export type NativeModuleCheckDependencies = {
  createRunRoot: (artifactRoot: string) => Promise<string>
  discoverPodspecs: (repositoryRoot: string) => Promise<readonly string[]>
  prepareHost: (runtimeToolchainRoot: string, hostRoot: string) => Promise<void>
  remove: (path: string) => Promise<void>
  runCommand: (command: NativeModuleCommand) => Promise<NativeModuleCommandResult>
  writeErrorLine: (message: string) => void
  writeLine: (message: string) => void
}

type NativeModuleCheckOptions = {
  artifactRoot?: string
  repositoryRoot?: string
  runtimeToolchainRoot?: string
}

const systemDependencies: NativeModuleCheckDependencies = {
  createRunRoot: async artifactRoot => {
    await FS.mkdir(artifactRoot)
    return await FS.mkTmpDir(FS.resolvePath('run-', artifactRoot))
  },
  discoverPodspecs,
  prepareHost,
  remove: FS.remove,
  runCommand,
  writeErrorLine: HCI.writeErrorLine,
  writeLine: HCI.writeLine,
}

/** Run an isolated prebuild, Pods installation, and simulator compile for every Tao pod target. */
async function run(
  options: NativeModuleCheckOptions = {},
  dependencies: NativeModuleCheckDependencies = systemDependencies,
): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const runtimeToolchainRoot = options.runtimeToolchainRoot
    ?? FS.resolvePath('packages/apps/expo-host', repositoryRoot)
  const artifactRoot = FS.resolvePath(
    options.artifactRoot ?? '.artifacts/native-module-check',
    repositoryRoot,
  )
  let phase = 'create isolated host'
  let runRoot: string | undefined

  try {
    runRoot = await dependencies.createRunRoot(artifactRoot)
    const hostRoot = FS.resolvePath('host', runRoot)
    const iosRoot = FS.resolvePath('ios', hostRoot)
    const podsProject = FS.resolvePath('Pods/Pods.xcodeproj', iosRoot)

    phase = 'prepare isolated host'
    await dependencies.prepareHost(runtimeToolchainRoot, hostRoot)

    phase = 'Expo prebuild'
    await runChecked(dependencies, {
      args: ['prebuild', '--platform', 'ios', '--no-install', '--clean'],
      command: FS.resolvePath('node_modules/.bin/expo', runtimeToolchainRoot),
      cwd: hostRoot,
      env: { TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: runtimeToolchainRoot },
      phase,
      timeoutMs: EXPO_PREBUILD_TIMEOUT_MS,
    })

    phase = 'CocoaPods install'
    await runChecked(dependencies, {
      args: ['install'],
      command: 'pod',
      cwd: iosRoot,
      env: { COCOAPODS_DISABLE_STATS: 'true' },
      phase,
      timeoutMs: COCOAPODS_INSTALL_TIMEOUT_MS,
    })

    phase = 'discover native podspecs'
    const podspecPaths = await dependencies.discoverPodspecs(repositoryRoot)
    if (podspecPaths.length === 0) {
      Errors.throwHostEnvironment('No native module podspecs exist under a package ios/*.podspec directory.')
    }

    const targetNames: string[] = []
    for (const podspecPath of podspecPaths) {
      phase = `inspect podspec ${FS.relativePath(repositoryRoot, podspecPath)}`
      const result = await runChecked(dependencies, {
        args: ['ipc', 'spec', podspecPath],
        command: 'pod',
        cwd: FS.dirname(podspecPath),
        phase,
        quiet: true,
        timeoutMs: POD_INSPECTION_TIMEOUT_MS,
      })
      targetNames.push(podTargetName(result.stdout, podspecPath))
    }

    phase = 'list Pods project targets'
    const targetListing = await runChecked(dependencies, {
      args: ['-project', podsProject, '-list', '-json'],
      command: 'xcodebuild',
      cwd: iosRoot,
      phase,
      quiet: true,
      timeoutMs: XCODE_TARGET_LIST_TIMEOUT_MS,
    })

    phase = 'validate Pods project targets'
    const projectTargets = podsProjectTargets(targetListing.stdout)
    const targets = requiredPodTargets(targetNames, projectTargets)
    const symRoot = FS.resolvePath('build/products', runRoot)
    const objRoot = FS.resolvePath('build/intermediates', runRoot)
    for (const target of targets) {
      phase = `compile pod target ${target}`
      await runChecked(dependencies, {
        args: [
          '-project',
          podsProject,
          '-target',
          target,
          '-configuration',
          'Debug',
          '-sdk',
          'iphonesimulator',
          'CODE_SIGNING_ALLOWED=NO',
          'CODE_SIGNING_REQUIRED=NO',
          `SYMROOT=${symRoot}`,
          `OBJROOT=${objRoot}`,
        ],
        command: 'xcodebuild',
        cwd: iosRoot,
        phase,
        timeoutMs: XCODE_TARGET_BUILD_TIMEOUT_MS,
      })
    }

    await dependencies.remove(runRoot)
    dependencies.writeLine(
      `Native module check passed for ${targets.length} pod target${targets.length === 1 ? '' : 's'}: ${
        targets.join(', ')
      }`,
    )
    return 0
  } catch (error) {
    const retained = runRoot === undefined ? artifactRoot : runRoot
    dependencies.writeErrorLine(
      `Native module check failed during ${phase}. Artifacts retained at: ${retained}\n${Errors.formatForUser(error)}`,
    )
    return 1
  }
}

async function runChecked(
  dependencies: Pick<NativeModuleCheckDependencies, 'runCommand'>,
  command: NativeModuleCommand,
): Promise<NativeModuleCommandResult> {
  const result = await dependencies.runCommand(command)
  if (result.timedOut) {
    Errors.throwHostEnvironment(`${command.phase} timed out after ${command.timeoutMs}ms.`)
  }
  if (result.error !== undefined || result.exitCode !== 0) {
    const output = relevantOutput(result)
    Errors.throwHostEnvironment(
      `${command.phase} failed with exit ${result.exitCode ?? 'unknown'}.${
        output === '' ? '' : `\nRelevant output:\n${output}`
      }`,
      { cause: result.error },
    )
  }
  return result
}

function relevantOutput(result: Pick<NativeModuleCommandResult, 'stderr' | 'stdout'>): string {
  const output = result.stderr.trim() || result.stdout.trim()
  const lines = output.split('\n')
  return lines.slice(Math.max(0, lines.length - 20)).join('\n')
}

async function prepareHost(runtimeToolchainRoot: string, hostRoot: string): Promise<void> {
  for (const file of HOST_FILES) {
    await FS.copyFile(FS.resolvePath(file, runtimeToolchainRoot), FS.resolvePath(file, hostRoot))
  }
  for (const directory of HOST_DIRECTORIES) {
    await FS.copyDirectory(FS.resolvePath(directory, runtimeToolchainRoot), FS.resolvePath(directory, hostRoot))
  }
  await FS.symlink(
    FS.resolvePath('node_modules', runtimeToolchainRoot),
    FS.resolvePath('node_modules', hostRoot),
  )
}

async function discoverPodspecs(repositoryRoot: string): Promise<readonly string[]> {
  const packagesRoot = FS.resolvePath('packages', repositoryRoot)
  const paths: string[] = []
  for (const packageRoot of await packageRoots(packagesRoot)) {
    const iosRoot = FS.resolvePath('ios', packageRoot)
    if (!await FS.isDirectory(iosRoot)) {
      continue
    }
    for (const name of await FS.listDir(iosRoot)) {
      const path = FS.resolvePath(name, iosRoot)
      if (name.endsWith('.podspec') && await FS.isFile(path)) {
        paths.push(path)
      }
    }
  }
  return paths.toSorted()
}

/** packageRoots finds both standalone packages and one-level package groups. */
async function packageRoots(packagesRoot: string): Promise<readonly string[]> {
  const roots: string[] = []
  for (const name of await FS.listDir(packagesRoot)) {
    const groupRoot = FS.resolvePath(name, packagesRoot)
    if (!await FS.isDirectory(groupRoot)) {
      continue
    }
    if (await FS.isFile(FS.resolvePath('package.json', groupRoot))) {
      roots.push(groupRoot)
      continue
    }
    for (const nested of await FS.listDir(groupRoot)) {
      const packageRoot = FS.resolvePath(nested, groupRoot)
      if (await FS.isFile(FS.resolvePath('package.json', packageRoot))) {
        roots.push(packageRoot)
      }
    }
  }
  return roots
}

function podTargetName(output: string, podspecPath: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch (error) {
    Errors.throwHostEnvironment(`CocoaPods returned invalid JSON for ${podspecPath}.`, { cause: error })
  }
  const name = typeof parsed === 'object' && parsed !== null && 'name' in parsed
    ? (parsed as { name?: unknown }).name
    : undefined
  if (typeof name !== 'string' || name.trim() === '') {
    Errors.throwHostEnvironment(`CocoaPods reported no pod target name for ${podspecPath}.`)
  }
  return name
}

function podsProjectTargets(output: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch (error) {
    Errors.throwHostEnvironment('xcodebuild returned invalid JSON while listing Pods project targets.', {
      cause: error,
    })
  }
  const project = typeof parsed === 'object' && parsed !== null && 'project' in parsed
    ? (parsed as { project?: unknown }).project
    : undefined
  const targets = typeof project === 'object' && project !== null && 'targets' in project
    ? (project as { targets?: unknown }).targets
    : undefined
  if (!Array.isArray(targets) || !targets.every(target => typeof target === 'string')) {
    Errors.throwHostEnvironment('xcodebuild returned no target list for the generated Pods project.')
  }
  return targets
}

function requiredPodTargets(
  declaredTargets: readonly string[],
  projectTargets: readonly string[],
): readonly string[] {
  const targets = [...new Set(declaredTargets)].toSorted()
  const available = new Set(projectTargets)
  const missing = targets.filter(target => !available.has(target))
  if (missing.length > 0) {
    Errors.throwHostEnvironment(
      `Generated Pods project is missing native module target${missing.length === 1 ? '' : 's'}: ${
        missing.join(', ')
      }.`,
    )
  }
  return targets
}

async function runCommand(command: NativeModuleCommand): Promise<NativeModuleCommandResult> {
  const result = await CLI.run(command.command, {
    args: command.args,
    cwd: command.cwd,
    env: command.env,
    processPolicy: 'test',
    stdio: command.quiet === true ? 'pipe' : 'stream',
    timeoutMs: command.timeoutMs,
  })
  return {
    error: result.error,
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
    timedOut: result.signal !== null && result.stderr.includes('timed out after'),
  }
}

export const NativeModuleCheck = {
  run,
  testing: {
    discoverPodspecs,
    podTargetName,
    podsProjectTargets,
    prepareHost,
    requiredPodTargets,
    runCommand,
  },
} as const
