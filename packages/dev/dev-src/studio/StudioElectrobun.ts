import { Errors, FS } from '@shared'
import {
  browserProbeSource,
  bunTypesVersion,
  configSource,
  hutchConfigSource,
  hutchLock,
  mainSource,
  multiWindowProbeResult,
  webSocketVersion,
} from './StudioElectrobunAppSource'

export const defaultStudioAppName = 'Tao Studio'
export const defaultStudioBundleIdentifier = 'dev.tao-lang.studio'
const defaultVersion = '0.0.1'

/** Re-exported: the native canary and its behavioral regression both call this directly. */
export { multiWindowProbeResult }

type StudioElectrobunOptions = {
  appName?: string
  bundleIdentifier?: string
  outputRoot: string
  packagedService?: boolean
  previewUrl: string
  projectUrl?: string
  runProbe?: boolean
  releaseBaseUrl?: string
  showWindow?: boolean
  serviceBundlePath?: string
  studioUrl: string
  version?: string
}

export type StudioElectrobunProject = {
  buildCanary: StudioElectrobunCommand
  buildStable: StudioElectrobunCommand
  configPath: string
  dev: StudioElectrobunCommand
  install: StudioElectrobunCommand
  mainPath: string
  prepare: StudioElectrobunCommand
  root: string
  runtimeResultPath: string
  sync: StudioElectrobunCommand
}

type StudioElectrobunCommand = {
  args: readonly string[]
  command: 'hutch'
  cwd: string
  env?: Readonly<Record<string, string>>
}

type StudioElectrobunSources = {
  config: string
  hutchConfig: string
  hutchLock: Record<string, unknown>
  main: string
  packageJson: Record<string, unknown>
  tsconfig: Record<string, unknown>
}

/** Materializes Tao Studio's native Electrobun project. */
export const StudioElectrobun = {
  create,
  sources,
  testing: { browserProbeSource },
} as const

async function create(options: StudioElectrobunOptions): Promise<StudioElectrobunProject> {
  const root = FS.resolvePath(options.outputRoot)
  const generated = sources(options)
  for (
    const relativePath of [
      'artifacts',
      'electrobun.config.ts',
      'hutch.config.ts',
      'hutch.lock',
      'package.json',
      'service',
      'src',
      'tsconfig.json',
    ]
  ) {
    await FS.remove(FS.resolvePath(relativePath, root))
  }
  const mainPath = FS.resolvePath('src/bun/index.ts', root)
  const configPath = FS.resolvePath('electrobun.config.ts', root)
  const runtimeResultPath = FS.resolvePath('artifacts/runtime-result.json', root)
  await FS.mkdir(FS.dirname(mainPath))
  await FS.mkdir(FS.dirname(runtimeResultPath))
  await FS.writeText(mainPath, generated.main)
  const servicePath = FS.resolvePath('src/bun/service.js', root)
  if (options.serviceBundlePath === undefined) {
    // Raw `Error`: this line is the placeholder module written into the generated Electrobun
    // project, which installs only `@types/bun` and `ws` and cannot import Tao's error taxonomy.
    await FS.writeText(
      servicePath,
      "export async function startStudioPackagedService() { throw new Error('Packaged Studio service is unavailable.') }\n",
    )
  } else {
    await FS.copyFile(options.serviceBundlePath, servicePath)
  }
  await FS.writeText(configPath, generated.config)
  await FS.writeText(FS.resolvePath('hutch.config.ts', root), generated.hutchConfig)
  await FS.writeJson(FS.resolvePath('hutch.lock', root), generated.hutchLock)
  await FS.writeJson(FS.resolvePath('package.json', root), generated.packageJson)
  await FS.writeJson(FS.resolvePath('tsconfig.json', root), generated.tsconfig)

  const environment = {
    TAO_STUDIO_ELECTROBUN_RESULT_PATH: runtimeResultPath,
    TAO_STUDIO_ELECTROBUN_RUN_PROBE: options.runProbe === true ? 'true' : 'false',
    TAO_STUDIO_ELECTROBUN_SHOW_WINDOWS: options.showWindow === false ? 'false' : 'true',
    TAO_STUDIO_PREVIEW_URL: localHttpUrl(options.previewUrl, 'Studio preview').href,
    ...(options.projectUrl === undefined
      ? {}
      : { TAO_STUDIO_PROJECT_URL: localHttpUrl(options.projectUrl, 'Studio project').href }),
    TAO_STUDIO_URL: localHttpUrl(options.studioUrl, 'Studio server').href,
  }
  return {
    buildCanary: command(root, ['run', 'build:canary']),
    buildStable: command(root, ['run', 'build:stable']),
    configPath,
    dev: command(root, ['run', 'dev'], environment),
    install: command(root, ['install']),
    mainPath,
    prepare: command(root, ['electrobun', 'prepare']),
    root,
    runtimeResultPath,
    sync: command(root, ['electrobun', 'sync']),
  }
}

function sources(options: StudioElectrobunOptions): StudioElectrobunSources {
  localHttpUrl(options.studioUrl, 'Studio server')
  localHttpUrl(options.previewUrl, 'Studio preview')
  const appName = safeAppName(options.appName ?? defaultStudioAppName)
  const bundleIdentifier = safeBundleIdentifier(options.bundleIdentifier ?? defaultStudioBundleIdentifier)
  const version = safeVersion(options.version ?? defaultVersion)
  const releaseBaseUrl = options.releaseBaseUrl ?? 'https://example.invalid/tao-studio'
  return {
    config: configSource({
      appName,
      bundleIdentifier,
      packagedService: options.packagedService === true,
      releaseBaseUrl,
      version,
    }),
    hutchConfig: hutchConfigSource(),
    hutchLock: hutchLock(),
    main: mainSource(),
    packageJson: {
      name: 'tao-studio-electrobun',
      private: true,
      type: 'module',
      devDependencies: {
        '@types/bun': bunTypesVersion,
        ws: webSocketVersion,
      },
    },
    tsconfig: {
      extends: './.hutch/devkit/tsconfig.json',
    },
  }
}

function command(
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): StudioElectrobunCommand {
  return { args, command: 'hutch', cwd, env }
}

function localHttpUrl(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    Errors.throwUserInput(`${label} must be a valid URL.`)
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    Errors.throwUserInput(`${label} must be a loopback HTTP URL.`)
  }
  return url
}

function safeAppName(value: string): string {
  const appName = value.trim()
  if (appName !== '' && !/[/:\\]/.test(appName)) {
    return appName
  }
  Errors.throwUserInput('Electrobun app name must be a non-empty macOS file name.')
}

function safeBundleIdentifier(value: string): string {
  const bundleIdentifier = value.trim()
  if (/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleIdentifier)) {
    return bundleIdentifier
  }
  Errors.throwUserInput('Electrobun bundle identifier must be a reverse-DNS identifier.')
}

function safeVersion(value: string): string {
  const version = value.trim()
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return version
  }
  Errors.throwUserInput('Electrobun version must be a semantic version.')
}
