const WEB_BROWSER_APP_NAME = 'Google Chrome'
const EXPO_PORT = 8081
const EXPO_ORIGIN = `http://127.0.0.1:${EXPO_PORT}`

export type ExpoPlatform = 'android' | 'ios' | 'web'

/** ExpoConfig collects shared Expo runner constants. */
export const ExpoConfig = {
  EXPO_GO_URL: `exp://127.0.0.1:${EXPO_PORT}`,
  EXPO_OPEN_URL: `${EXPO_ORIGIN}/_expo/open`,
  EXPO_ORIGIN,
  EXPO_PORT,
  EXPO_START_ARGS: [
    'expo',
    'start',
    '--host',
    'lan',
    '--port',
    EXPO_PORT.toString(),
  ],
  EXPO_START_ENV: {
    BROWSER: WEB_BROWSER_APP_NAME,
    EXPO_NO_TELEMETRY: '1',
    OPEN_MATCH_HOST_ONLY: 'true',
  },
  EXPO_START_POLL_MS: 1_000,
  EXPO_START_TIMEOUT_MS: 60_000,
  EXPO_STATUS_URL: `${EXPO_ORIGIN}/status`,
  EXPO_STOP_TIMEOUT_MS: 3_000,
  IOS_BOOT_POLL_MS: 1_000,
  IOS_BOOT_TIMEOUT_MS: 120_000,
  RUNTIME_TOOLCHAIN_PATH: 'packages/runtime-toolchain',
  WEB_BROWSER_APP_NAME,
} as const
