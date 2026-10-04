import type { createAndroid } from '@expo-host/dev-loop/expo-runner/android'
import { createExpoConfig } from '@expo-host/dev-loop/expo-runner/expo-config'
import type { ExpoMetroSession } from '@expo-host/dev-loop/expo-runner/metro'
import { createExpoTargets } from '@expo-host/dev-loop/expo-runner/run-targets'
import { Platform } from '@shared'
import { Expect, Test } from '@shared/test'

Test('managed Chrome navigates the recorded loopback origin even when Expo advertises LAN', async () => {
  const env = Platform.runtimeProcess.env
  const quiet = env['TAO_AGENT_BROWSER_QUIET']
  const visible = env['TAO_AGENT_BROWSER_VISIBLE']
  env['TAO_AGENT_BROWSER_QUIET'] = '1'
  delete env['TAO_AGENT_BROWSER_VISIBLE']
  const launches: unknown[] = []
  let stops = 0
  try {
    const config = createExpoConfig(49_152)
    const targets = createExpoTargets(
      config,
      {
        expoOpenEndpoint: async () => ({ url: 'http://192.168.50.107:49152' }),
        endpointUrl: () => 'http://192.168.50.107:49152',
      } as unknown as ExpoMetroSession,
      {} as ReturnType<typeof createAndroid>,
      {
        startChrome: async (url, profile, shown) => {
          launches.push({ url, profile, shown })
          return {
            debugPort: 49_153,
            profile: '/owned/profile',
            process: { command: 'Google Chrome', pid: 123, startedAt: 'captured-kernel' },
            stop: async () => {
              stops++
            },
          }
        },
      },
    )
    Expect(await targets.openStartupTargets(['web'])).toEqual([{
      target: 'web',
      dispatched: true,
      browser: {
        devToolsUrl: 'http://127.0.0.1:49153',
        profile: '/owned/profile',
        process: { command: 'Google Chrome', pid: 123, startedAt: 'captured-kernel' },
      },
    }])
    Expect(launches).toEqual([{ url: 'http://127.0.0.1:49152', profile: config.WEB_PROFILE_PARENT, shown: false }])
    await targets.stopWeb()
    Expect(stops).toBe(1)
  } finally {
    if (quiet === undefined) {
      delete env['TAO_AGENT_BROWSER_QUIET']
    } else {
      env['TAO_AGENT_BROWSER_QUIET'] = quiet
    }
    if (visible === undefined) {
      delete env['TAO_AGENT_BROWSER_VISIBLE']
    } else {
      env['TAO_AGENT_BROWSER_VISIBLE'] = visible
    }
  }
})
