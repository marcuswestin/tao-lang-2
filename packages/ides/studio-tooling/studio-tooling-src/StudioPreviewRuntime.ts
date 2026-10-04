import { type DevDataManifest, DevDataProtocol } from '@expo-host/dev-loop/dev-data/DevDataBootstrap'
import { CompanionIdentity } from '@expo-host/dev-loop/prebuilt-host/CompanionIdentity'
import { Errors, FS, HCI, Json, Repo } from '@shared'

const runtimeFiles = [
  'index.ts',
  'expo-host-src/ManagedLoopIdentityMarker.ts',
  'metro.config.cjs',
  'package.json',
] as const

export type CreatedStudioPreviewRuntime = {
  close: () => Promise<void>
  /** configure rewrites the preview's Expo config with facts known only after the project session opens. */
  configure: (options: StudioPreviewBootstrapOptions) => Promise<void>
  root: string
}

/** The non-secret bootstrap facts a loaded preview bundle reads from its Expo manifest. */
type StudioPreviewBootstrapOptions = {
  /** The tao-dev-data-v1 server and app key a `Dev` datasource in the preview dials. */
  devData?: DevDataManifest
  /** The tao-studio-device-v1 gateway port a companion build should dial after loading this bundle. */
  deviceGatewayPort?: number
}

type StudioPreviewRuntimeOptions = StudioPreviewBootstrapOptions & {
  artifactRoot?: string
}

/** StudioPreviewRuntime creates an isolated Expo project for one Studio process. */
export const StudioPreviewRuntime = {
  create,
  previewAppConfig,
}

async function create(
  sourceRoot: string,
  options: StudioPreviewRuntimeOptions | string = {},
): Promise<CreatedStudioPreviewRuntime> {
  const settings = typeof options === 'string' ? { artifactRoot: options } : options
  // The runtime must stay inside the repository: Expo and Metro resolve hoisted dependencies such
  // as `typescript` by walking up to the repository's root node_modules, which a host-temp root
  // cannot reach even with the package node_modules linked in.
  const artifactRoot = settings.artifactRoot ?? Repo.resolvePath('.artifacts/dev/studio-preview')
  await FS.mkdir(artifactRoot)
  const root = await FS.mkTmpDir(FS.resolvePath('runtime-', artifactRoot))
  try {
    await Promise.all(
      runtimeFiles.map(file => FS.copyFile(FS.resolvePath(file, sourceRoot), FS.resolvePath(file, root))),
    )
    const appConfig = await FS.readJson<Record<string, unknown>>(FS.resolvePath('app.json', sourceRoot))
    const writeAppConfig = (bootstrap: StudioPreviewBootstrapOptions) =>
      FS.writeJson(FS.resolvePath('app.json', root), previewAppConfig(appConfig, bootstrap))
    let bootstrap: StudioPreviewBootstrapOptions = {
      ...(settings.devData === undefined ? {} : { devData: settings.devData }),
      ...(settings.deviceGatewayPort === undefined ? {} : { deviceGatewayPort: settings.deviceGatewayPort }),
    }
    await writeAppConfig(bootstrap)
    await FS.symlink(FS.resolvePath('node_modules', sourceRoot), FS.resolvePath('node_modules', root))
    return {
      close: () => FS.remove(root),
      configure: async next => {
        bootstrap = { ...bootstrap, ...next }
        await writeAppConfig(bootstrap)
      },
      root,
    }
  } catch (error) {
    try {
      await FS.remove(root)
    } catch (cleanupError) {
      HCI.logProcessError(
        'studio-preview',
        `Preview runtime cleanup also failed: ${Errors.formatForLog(cleanupError)}`,
      )
    }
    throw error
  }
}

/**
 * previewAppConfig is the runtime toolchain's Expo config plus what only a Studio preview needs: the
 * companion's scheme, so Expo's own `/_expo/link?choice=expo-dev-client` answers with the installed
 * shell's deep link, and the non-secret bootstrap facts a loaded bundle needs to find the device
 * gateway and the dev data server. Shipping apps never see any of it; this config exists only
 * inside the isolated preview project.
 */
function previewAppConfig(
  appConfig: Record<string, unknown>,
  options: StudioPreviewBootstrapOptions,
): Record<string, unknown> {
  const expo = Json.isRecord(appConfig['expo']) ? appConfig['expo'] : {}
  const extra = Json.isRecord(expo['extra']) ? expo['extra'] : {}
  const bootstrap = {
    ...(options.deviceGatewayPort === undefined ? {} : {
      taoStudioDevice: { gatewayPort: options.deviceGatewayPort, protocol: 'tao-studio-device-v1' },
    }),
    ...(options.devData === undefined ? {} : { [DevDataProtocol.manifestKey]: options.devData }),
  }
  return {
    ...appConfig,
    expo: {
      ...expo,
      scheme: CompanionIdentity.scheme,
      ...(Object.keys(bootstrap).length === 0 ? {} : { extra: { ...extra, ...bootstrap } }),
    },
  }
}
