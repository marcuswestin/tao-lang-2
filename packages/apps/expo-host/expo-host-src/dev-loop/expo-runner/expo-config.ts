import { FS, Platform, Repo } from '@shared'

const WEB_BROWSER_APP_NAME = 'Google Chrome'
const EXPO_HOME_PATH = '.artifacts/cache/expo'
export const PREFERRED_EXPO_PORT = 8081

/**
 * The Expo SDK generation `packages/apps/expo-host` pins. Every runtime this loop opens is measured
 * against it: the Expo Go it installs on Android and iOS simulators. A
 * repository test keeps this equal to the host package's own `expo` dependency, so an SDK upgrade
 * cannot leave the dev loop installing last year's client.
 */
export const EXPO_SDK_VERSION = '57.0.0'

export type ExpoPlatform = 'android' | 'ios' | 'web'

/** expoSdkMajor reads the generation number two Expo runtimes must share to be compatible. */
export function expoSdkMajor(version: string = EXPO_SDK_VERSION): string | undefined {
  return version.match(/^(\d+)\./u)?.[1]
}

export type ExpoConfigOptions = {
  /** A custom URI scheme Expo CLI uses for dev-client deep links (`/_expo/link?choice=expo-dev-client`). */
  scheme?: string
  /** Project-owned writable Expo state; repository callers keep the historic default. */
  stateRoot?: string
}

/** ExpoSessionConfig collects the Expo URLs and process options for one Metro session. */
export type ExpoSessionConfig = ReturnType<typeof createExpoConfig>

/** createExpoConfig derives all port-sensitive Expo settings from one session port. */
export function createExpoConfig(port: number = PREFERRED_EXPO_PORT, options: ExpoConfigOptions = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`Expo port must be an integer from 1 through 65535; received ${port}.`)
  }

  const origin = `http://127.0.0.1:${port}`
  return {
    EXPO_GO_URL: `exp://127.0.0.1:${port}`,
    EXPO_LOG_PATH: port === PREFERRED_EXPO_PORT ? '.artifacts/dev/expo.log' : `.artifacts/dev/expo-${port}.log`,
    EXPO_OPEN_URL: `${origin}/_expo/open`,
    EXPO_ORIGIN: origin,
    EXPO_PORT: port,
    EXPO_START_ARGS: [
      'expo',
      'start',
      '--host',
      'lan',
      '--port',
      port.toString(),
      // Expo resolves the custom-runtime deep link only from an explicit scheme when the project
      // does not itself depend on expo-dev-client, which the isolated Studio preview never does.
      ...(options.scheme === undefined ? [] : ['--scheme', options.scheme]),
    ],
    EXPO_START_ENV: {
      BROWSER: WEB_BROWSER_APP_NAME,
      EXPO_NO_TELEMETRY: '1',
      NODE_ENV: Platform.runtimeProcess.env['NODE_ENV'],
      OPEN_MATCH_HOST_ONLY: 'true',
      __UNSAFE_EXPO_HOME_DIRECTORY: options.stateRoot === undefined
        ? Repo.tryResolvePath(EXPO_HOME_PATH) ?? FS.resolvePath('tao-expo-home', FS.tmpdir())
        : FS.resolvePath('expo-home', options.stateRoot),
    },
    EXPO_START_POLL_MS: 1_000,
    EXPO_START_TIMEOUT_MS: 60_000,
    EXPO_STATUS_URL: `${origin}/status`,
    EXPO_STOP_TIMEOUT_MS: 3_000,
    IOS_BOOT_POLL_MS: 1_000,
    IOS_BOOT_TIMEOUT_MS: 120_000,
    RUNTIME_TOOLCHAIN_PATH: 'packages/apps/expo-host',
    WEB_BROWSER_APP_NAME,
    WEB_PROFILE_PARENT: FS.resolvePath(
      'chrome',
      options.stateRoot ?? Repo.tryResolvePath('.artifacts/dev') ?? FS.resolvePath('tao-dev', FS.tmpdir()),
    ),
  } as const
}

/** ExpoConfig is the fixed default session used by explicit single-session commands and tests. */
export const ExpoConfig = createExpoConfig()
