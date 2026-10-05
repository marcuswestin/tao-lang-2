import { Errors, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test, testOverrideSlot, withCapturedOutput } from '@shared/test'
import { UiVisibility } from '@verification/UiVisibility'
import { StudioCanaryCommand } from '../studio-tooling-src/StudioCanaryCommand'
import { StudioNative } from '../studio-tooling-src/StudioNative'
import { StudioSmoke } from '../studio-tooling-src/StudioSmoke'

const visibleSmokeFile = 'packages/ides/studio-tooling/studio-smoke/studio-host-control.test.ts'
const quietSmokeFile = 'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts'

const studioConsent = testOverrideSlot({
  read: () => Platform.runtimeProcess.env[UiVisibility.STUDIO_ENV_KEY],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env[UiVisibility.STUDIO_ENV_KEY]
    } else {
      Platform.runtimeProcess.env[UiVisibility.STUDIO_ENV_KEY] = value
    }
  },
})

Describe('native Studio test visibility', () => {
  for (
    const selection of [
      { probe: true },
      { nativeHostCommand: 'studio-smoke-native' },
      { nativeHostCommand: 'studio-host-control-smoke' },
      { nativeHostCommand: 'studio-mac2-acceptance-smoke' },
      { nativeHostCommand: 'studio-canary' },
      { nativeHostCommand: 'studio-test' },
      { nativeHostCommand: 'studio-manual-checks' },
    ]
  ) {
    Test(`refuses ${selection.nativeHostCommand ?? 'a native probe'} before native startup side effects`, async () => {
      const restore = studioConsent.install(undefined)
      const effects: string[] = []
      try {
        await Expect(StudioNative.start({
          ...selection,
          previewUrl: 'http://127.0.0.1:8081',
          studioUrl: 'http://127.0.0.1:55101',
        }, {
          onProcessSignal: () => {
            effects.push('signal')
            return () => {}
          },
          resolveHutch: async () => {
            effects.push('hutch')
            Errors.throwHostEnvironment('The test stopped before a native process could start.')
          },
        })).rejects.toThrow('--show-studio')
        Expect(effects).toEqual([])
      } finally {
        restore()
      }
    })
  }

  Test('accepts scoped child consent and lets an explicit refusal override it', async () => {
    const restore = studioConsent.install('true')
    let preflights = 0
    const lifecycle = {
      onProcessSignal: () => () => {},
      resolveHutch: async () => {
        preflights += 1
        Errors.throwHostEnvironment('Stopped at the mocked Hutch preflight.')
      },
    }
    try {
      await Expect(StudioNative.start({
        previewUrl: 'http://127.0.0.1:8081',
        probe: true,
        studioUrl: 'http://127.0.0.1:55101',
      }, lifecycle)).rejects.toThrow('Stopped at the mocked Hutch preflight.')
      await Expect(StudioNative.start({
        previewUrl: 'http://127.0.0.1:8081',
        probe: true,
        showStudio: false,
        studioUrl: 'http://127.0.0.1:55101',
      }, lifecycle)).rejects.toThrow('--show-studio')
      Expect(preflights).toBe(1)
    } finally {
      restore()
    }
  })

  Test('accepts explicit consent without a scoped environment', async () => {
    const restore = studioConsent.install(undefined)
    let preflights = 0
    try {
      await Expect(StudioNative.start({
        previewUrl: 'http://127.0.0.1:8081',
        probe: true,
        showStudio: true,
        studioUrl: 'http://127.0.0.1:55101',
      }, {
        onProcessSignal: () => () => {},
        resolveHutch: async () => {
          preflights += 1
          Errors.throwHostEnvironment('Stopped at the mocked Hutch preflight.')
        },
      })).rejects.toThrow('Stopped at the mocked Hutch preflight.')
      Expect(preflights).toBe(1)
    } finally {
      restore()
    }
  })

  Test('allows a quiet probe without consent and preserves its hidden window setting', async () => {
    const restore = studioConsent.install('true')
    const launches: unknown[] = []
    try {
      await withCapturedOutput(async () =>
        await Expect(StudioNative.start({
          nativeHostCommand: 'studio-canary',
          previewUrl: 'http://127.0.0.1:8081',
          probe: true,
          showStudio: false,
          showWindow: false,
          studioUrl: 'http://127.0.0.1:55101',
        }, {
          nativeHost: { acquire: async () => ({ owner: {} as never, release: async () => {} }) },
          onProcessSignal: () => () => {},
          resolveHutch: async () => '/tools/hutch',
          startWithLease: async options => {
            launches.push({ probe: options.probe, showStudio: options.showStudio, showWindow: options.showWindow })
            Errors.throwHostEnvironment('Stopped at the mocked native launch.')
          },
        })).rejects.toThrow('Stopped at the mocked native launch.')
      )
      Expect(launches).toEqual([{ probe: true, showStudio: false, showWindow: false }])
    } finally {
      restore()
    }
  })

  Test('refuses native smoke before parser checks, leases, or port probes', async () => {
    const root = await mkTestDir('tao-studio-smoke-consent-')
    const registryRoot = FS.resolvePath('registry', root)
    let probes = 0
    try {
      await Expect(StudioSmoke.run({
        files: [visibleSmokeFile],
        portsAvailable: async () => {
          probes += 1
          return true
        },
        registryRoot,
        runId: 'visibility-refusal',
      })).rejects.toThrow('--show-studio')
      Expect(probes).toBe(0)
      Expect(await FS.exists(registryRoot)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('runs the quiet canary host preflight without visible-test consent or warnings', async () => {
    const root = await mkTestDir('tao-studio-canary-consent-')
    const artifactRoot = FS.resolvePath('canary', root)
    const registryRoot = FS.resolvePath('registry', root)
    const effects: string[] = []
    try {
      const captured = await withCapturedOutput(async () =>
        await StudioCanaryCommand.testing.runStudioCanary({ artifactRoot }, {
          blockedReason: async () => {
            effects.push('host')
            return 'The mocked host cannot launch native windows.'
          },
          readLaunches: async () => [],
          readProbeResult: async () => undefined,
          registryRoot,
          runStudioDev: async () => {
            effects.push('launch')
            return 1
          },
          survivingOwnedPids: async () => [],
        })
      )
      Expect(effects).toEqual(['host'])
      Expect(captured.stderr).toBe('')
      Expect(await FS.exists(FS.resolvePath('invocations', artifactRoot))).toBe(true)
      Expect(captured.result).toBe(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('warns about visible smoke work before allocating resources', async () => {
    const root = await mkTestDir('tao-studio-smoke-warning-')
    try {
      const captured = await withCapturedOutput(async () => {
        await Expect(StudioSmoke.run({
          files: [visibleSmokeFile],
          registryRoot: FS.resolvePath('registry', root),
          runId: '../invalid',
          showStudio: true,
        })).rejects.toThrow('Studio smoke run id must use only letters, numbers, dots, underscores, or dashes.')
      })
      Expect(captured.stderr).toContain('WARNING: Native Studio tests open Electrobun windows.')
    } finally {
      await FS.remove(root)
    }
  })

  Test('allows the known quiet native smoke without consent or warnings', async () => {
    const root = await mkTestDir('tao-studio-quiet-smoke-')
    try {
      const captured = await withCapturedOutput(async () => {
        await Expect(StudioSmoke.run({
          files: [quietSmokeFile],
          native: true,
          registryRoot: FS.resolvePath('registry', root),
          runId: '../invalid',
        })).rejects.toThrow('Studio smoke run id must use only letters, numbers, dots, underscores, or dashes.')
      })
      Expect(captured.stderr).toBe('')
    } finally {
      await FS.remove(root)
    }
  })
})
