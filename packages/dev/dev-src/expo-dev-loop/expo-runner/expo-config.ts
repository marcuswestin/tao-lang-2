import { Repo } from '@shared'

const WEB_BROWSER_APP_NAME = 'Google Chrome'
const EXPO_HOME_PATH = '.artifacts/cache/expo'
export const PREFERRED_EXPO_PORT = 8081

export type ExpoPlatform = 'android' | 'ios' | 'web'

export type ExpoConfigOptions = {
  /** A custom URI scheme Expo CLI uses for dev-client deep links (`/_expo/link?choice=expo-dev-client`). */
  scheme?: string
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
      OPEN_MATCH_HOST_ONLY: 'true',
      __UNSAFE_EXPO_HOME_DIRECTORY: Repo.resolvePath(EXPO_HOME_PATH),
    },
    EXPO_START_POLL_MS: 1_000,
    EXPO_START_TIMEOUT_MS: 60_000,
    EXPO_STATUS_URL: `${origin}/status`,
    EXPO_STOP_TIMEOUT_MS: 3_000,
    IOS_BOOT_POLL_MS: 1_000,
    IOS_BOOT_TIMEOUT_MS: 120_000,
    RUNTIME_TOOLCHAIN_PATH: 'packages/apps/expo-host',
    WEB_BROWSER_APP_NAME,
  } as const
}

/** ExpoConfig is the fixed default session used by explicit single-session commands and tests. */
export const ExpoConfig = createExpoConfig()
