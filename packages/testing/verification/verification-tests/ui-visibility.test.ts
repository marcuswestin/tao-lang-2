import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { runGates } from '../verification-src/GateRunner'
import { UiVisibility } from '../verification-src/UiVisibility'

Describe('visible test workflows', () => {
  Test('refuses native gates before hashing, resource acquisition or execution', async () => {
    let touched = false
    await Expect(runGates({
      gates: ['studio-host-control-smoke'],
      greenTree: {
        lanes: ['verify-full'],
        hashTree: async () => {
          touched = true
          return 'tree'
        },
      },
      runGate: async () => {
        touched = true
        return { exitCode: 0, output: '' }
      },
    })).rejects.toBeInstanceOf(Errors.UserInputError)
    Expect(touched).toBe(false)
  })

  Test('does not accept another surface show flag as Studio consent', () => {
    for (const flag of ['--show-browser', '--show-simulator', '--show-emulator']) {
      Expect(() => UiVisibility.preflightCommand('studio-host-control-smoke', [flag])).toThrow('--show-studio')
    }
    Expect(() => UiVisibility.preflightCommand('studio-host-control-smoke', ['--show-studio'])).not.toThrow()
    Expect(() => UiVisibility.preflightCommand('verify-full', [])).not.toThrow()
    Expect(UiVisibility.smokeNeedsStudio(['studio-simulated-user.test.ts'], true)).toBe(false)
    Expect(UiVisibility.smokeNeedsStudio(['studio-wda-registration-probe.test.ts'], true)).toBe(true)
    Expect(UiVisibility.smokeNeedsStudio(['studio-wda-registration-probe.test.ts'], false)).toBe(true)
    Expect(UiVisibility.smokeNeedsStudio(['studio-mac2-source-probe.test.ts'], true)).toBe(true)
    Expect(UiVisibility.smokeNeedsStudio(['studio-mac2-source-probe.test.ts'], false)).toBe(true)
    Expect(() => UiVisibility.preflightCommand('studio-smoke', ['studio-mac2-source-probe.test.ts']))
      .toThrow('--show-studio')
    Expect(() => UiVisibility.preflightCommand('studio-smoke', ['studio-mac2-source-probe.test.ts', '--show-studio']))
      .not.toThrow()
    Expect(() => UiVisibility.preflightCommand('studio-smoke', ['studio-wda-registration-probe.test.ts']))
      .toThrow('--show-studio')
    Expect(() =>
      UiVisibility.preflightCommand('studio-smoke', [
        'studio-wda-registration-probe.test.ts',
        '--show-studio',
      ])
    ).not.toThrow()
    Expect(UiVisibility.smokeNeedsStudio(['other-studio-wda-registration-probe.test.ts'], true)).toBe(true)
    Expect(
      UiVisibility.smokeNeedsStudio(['studio-wda-registration-probe.test.ts', 'studio-mac2-acceptance.test.ts'], true),
    ).toBe(true)
    Expect(() => UiVisibility.preflightCommand('land', ['--dry-run'])).not.toThrow()
    Expect(() => UiVisibility.preflightCommand('land', ['--skip-verify-full'])).not.toThrow()
    Expect(UiVisibility.preflightGates(['studio-smoke'])).toEqual([])
    Expect(UiVisibility.preflightGates(['studio-canary'])).toEqual([])
    Expect(UiVisibility.preflightGates(['studio-canary'], true)).toEqual(UiVisibility.studioWarnings)
    Expect(UiVisibility.warningsForCommand('studio', ['--no-browser'])).toEqual([])
    Expect(UiVisibility.warningsForCommand('studio', [])).toHaveLength(1)
    Expect(UiVisibility.warningsForCommand('studio-native', ['--no-browser'])[0]).toContain('Welcome')
  })

  Test('scopes child consent and retains declared visibility warnings in the final summary', async () => {
    const root = await mkTestDir('tao-ui-visibility-')
    const environments: Readonly<Record<string, string>>[] = []
    try {
      const visible = await runGates({
        gates: ['studio-host-control-smoke'],
        showStudio: true,
        repositoryRoot: root,
        registryRoot: FS.resolvePath('registry', root),
        logRoot: FS.resolvePath('visible', root),
        machineCpuCount: 8,
        machineLoadAverage: () => 0,
        runGate: async (_name, _log, env) => {
          environments.push(env)
          return { exitCode: 0, output: 'passed' }
        },
      })
      Expect(visible.status).toBe('passed')
      Expect(visible.warnings).toContain(UiVisibility.studioWarnings[0])
      Expect(environments[0]?.[UiVisibility.STUDIO_ENV_KEY]).toBe('true')
      await runGates({
        gates: ['quiet-probe'],
        repositoryRoot: root,
        registryRoot: FS.resolvePath('registry', root),
        logRoot: FS.resolvePath('quiet', root),
        machineCpuCount: 8,
        machineLoadAverage: () => 0,
        runGate: async (_name, _log, env) => {
          environments.push(env)
          return { exitCode: 0, output: 'passed' }
        },
      })
      Expect(environments[1]?.[UiVisibility.STUDIO_ENV_KEY]).toBe('false')
    } finally {
      await FS.remove(root)
    }
  })
})
