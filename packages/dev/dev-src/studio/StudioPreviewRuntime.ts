import { FS, Repo } from '@shared'
import { StudioCompanionIdentity } from './StudioCompanionIdentity'

const runtimeFiles = [
  'index.ts',
  'metro.config.cjs',
  'package.json',
] as const

export type CreatedStudioPreviewRuntime = {
  close: () => Promise<void>
  root: string
}

export type StudioPreviewRuntimeOptions = {
  artifactRoot?: string
  /** The tao-studio-device-v1 gateway port a companion build should dial after loading this bundle. */
  deviceGatewayPort?: number
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
  const artifactRoot = settings.artifactRoot ?? Repo.resolvePath('.artifacts/dev/studio-preview')
  await FS.mkdir(artifactRoot)
  const root = await FS.mkTmpDir(FS.resolvePath('runtime-', artifactRoot))
  try {
    await Promise.all(
      runtimeFiles.map(file => FS.copyFile(FS.resolvePath(file, sourceRoot), FS.resolvePath(file, root))),
    )
    const appConfig = await FS.readJson<Record<string, unknown>>(FS.resolvePath('app.json', sourceRoot))
    await FS.writeJson(FS.resolvePath('app.json', root), previewAppConfig(appConfig, settings))
    await FS.symlink(FS.resolvePath('node_modules', sourceRoot), FS.resolvePath('node_modules', root))
    return {
      close: () => FS.remove(root),
      root,
    }
  } catch (error) {
    await FS.remove(root)
    throw error
  }
}

/**
 * previewAppConfig is the runtime toolchain's Expo config plus what only a Studio preview needs: the
 * companion's scheme, so Expo's own `/_expo/link?choice=expo-dev-client` answers with the installed
 * shell's deep link, and the non-secret bootstrap fact a loaded bundle needs to find the gateway.
 * Shipping apps never see either; this config exists only inside the isolated preview project.
 */
function previewAppConfig(
  appConfig: Record<string, unknown>,
  options: Pick<StudioPreviewRuntimeOptions, 'deviceGatewayPort'>,
): Record<string, unknown> {
  const expo = isRecord(appConfig['expo']) ? appConfig['expo'] : {}
  const extra = isRecord(expo['extra']) ? expo['extra'] : {}
  return {
    ...appConfig,
    expo: {
      ...expo,
      scheme: StudioCompanionIdentity.scheme,
      ...(options.deviceGatewayPort === undefined ? {} : {
        extra: {
          ...extra,
          taoStudioDevice: { gatewayPort: options.deviceGatewayPort, protocol: 'tao-studio-device-v1' },
        },
      }),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
