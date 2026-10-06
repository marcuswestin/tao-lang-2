import { type CLI } from '@shared'
import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { type AppleSetupReceipt } from '../dev-cli-src/apple-setup/AppleToolchainSetup'
import { VisionosSetupCommand } from '../dev-cli-src/visionos-setup/VisionosSetupCommand'

const VisionOSSetup = {
  run: async (...args: Parameters<typeof VisionosSetupCommand.run>) =>
    (await withCapturedOutput(() => VisionosSetupCommand.run(...args))).result,
}

function harness(
  settings: {
    reality?: string
    mode?: string
    devices?: number
    launchPid?: number
    installed?: string
    failure?: string
    legacy?: boolean
    jsonOutcome?: string
    selection?: string
  } = {},
) {
  const calls: { command: string; args: string[]; env: CLI.CommandSpec['env'] }[] = []
  const files = new Map<string, unknown>()
  const reports: string[] = []
  let mode = settings.mode ?? 'enabled'
  const reality = settings.reality ?? 'physical'
  let prompts = 0
  let output = ''
  const runCommand: typeof CLI.run = async (command, spec = {}) => {
    const args = [...spec.args ?? []]
    calls.push({ command, args, env: spec.env })
    let stdout = ''
    const result = (value: unknown) =>
      files.set(args[args.indexOf('--json-output') + 1]!, {
        info: { outcome: settings.jsonOutcome ?? 'success' },
        result: value,
      })
    if (command === '/usr/bin/xcode-select') {
      stdout = settings.selection ?? '/Applications/Xcode-default.app/Contents/Developer\n'
    }
    if (args[0] === 'devicectl') {
      if (args[1] === 'list') {
        result({
          devices: Array.from({ length: settings.devices ?? 1 }, (_, i) => ({
            identifier: `headset-${i}`,
            ...(settings.legacy
              ? {
                hardwareProperties: { platform: 'visionOS', reality, udid: `hardware-udid-${i}` },
                deviceProperties: { name: `Headset ${i}` },
                connectionProperties: { tunnelState: 'connected', pairingState: 'paired' },
              }
              : {
                properties: {
                  hardware: { platform: 'visionOS', reality, udid: `hardware-udid-${i}` },
                  device: { name: `Headset ${i}` },
                  connection: { state: 'connected', pairingState: 'paired' },
                },
              }),
          })),
        })
      }
      if (args.includes('details')) {
        result({ deviceProperties: { developerModeStatus: mode } })
      }
      if (args.includes('install')) {
        result({ installedApplications: [] })
      }
      if (args.includes('apps')) {
        result({ apps: [{ bundleIdentifier: settings.installed ?? 'com.acme.visionhello' }] })
      }
      if (args.includes('launch')) {
        result({ process: { processIdentifier: settings.launchPid ?? 123 } })
      }
    }
    if (command === './tao') {
      output = args[args.indexOf('--output') + 1]!
      files.set(`${output}/build-1/build.json`, {
        results: { visionos: { status: 'succeeded', artifact: `${output}/build-1/visionos/TaoApp.xcodeproj` } },
      })
    }
    if (args[0] === 'simctl') {
      if (args[2] === 'runtimes') {
        stdout = JSON.stringify({
          runtimes: [{
            identifier: 'com.apple.CoreSimulator.SimRuntime.xrOS-27-1',
            version: '27.1',
            isAvailable: true,
          }],
        })
      }
      if (args[2] === 'devices') {
        stdout = JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.xrOS-27-1': [{
              udid: 'sim-1',
              name: 'Apple Vision Pro',
              deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.Apple-Vision-Pro',
              isAvailable: true,
              state: 'Shutdown',
            }],
          },
        })
      }
      if (args[1] === 'get_app_container') {
        stdout = '/sim/installed/TaoApp.app'
      }
      if (args[1] === 'launch') {
        stdout = `com.acme.visionhello: ${settings.launchPid ?? 123}\n`
      }
    }
    return {
      command,
      args,
      exitCode: settings.failure === command ? 1 : 0,
      signal: null,
      stdout,
      stderr: settings.failure === command ? 'Signing requires an account' : '',
    }
  }
  const prepare = async (): Promise<AppleSetupReceipt> => ({
    requested: { xcodeVersion: '27.1' },
    mode: 'apply',
    status: 'ready',
    selectedXcode: '/Applications/Xcode-27.1.app',
    defaultDeveloperDirectory: '/Applications/Xcode-default.app/Contents/Developer',
    remaining: [],
    ownedPaths: [],
    runtimeAvailable: true,
    simulatorHealthy: true,
  })
  const options = {
    repositoryRoot: '/repo',
    xcodeVersion: '27.1',
    project: 'Apps/VisionHello',
    team: 'ABCDEFGHIJ',
    bundleId: 'com.acme.visionhello',
    runCommand,
  }
  const dependencies = {
    prepare,
    files: {
      readJson: async <T = unknown>(path: string): Promise<T> => files.get(path) as T,
      writeJson: async (path: string, value: unknown) => {
        files.set(path, value)
      },
      writeText: async (path: string, value: string) => {
        files.set(path, value)
      },
      exists: async () => true,
      listDir: async (path: string) => path === output ? ['build-1'] : [],
    },
    report: (message: string) => reports.push(message),
  }
  return {
    calls,
    files,
    reports,
    options,
    dependencies,
    terminal: {
      isInteractive: () => true,
      askText: async () => {
        prompts++
        return 'q'
      },
    },
    setMode: (value: string) => {
      mode = value
    },
    promptCount: () => prompts,
    receipt: () =>
      JSON.parse(reports.at(-1)!) as {
        status: string
        processIdentifier?: number
        remaining: string[]
        log?: string
        xcodeProject?: string
      },
  }
}

Describe('guided visionOS setup', () => {
  Test('explains bundle ownership and obtaining a signing team before requesting either identifier', async () => {
    const h = harness()
    const prompts: string[] = []
    const result = await VisionOSSetup.run({
      ...h.options,
      apply: true,
      bundleId: undefined,
      team: undefined,
      terminal: {
        isInteractive: () => true,
        askText: async ({ message }) => {
          prompts.push(message)
          const output = h.reports.join('\n')
          if (prompts.length === 1) {
            Expect(message).toContain('Enter your own app bundle ID')
            Expect(output).toContain('Reuse the bundle ID of your own app')
            Expect(output).toContain('domain you own (yourcompany.com becomes com.yourcompany.visionhello)')
            Expect(output).toContain('dot-separated parts starting with a letter')
            return 'com.acme.visionhello'
          }
          Expect(message).toContain('Enter your 10-character development Team ID')
          Expect(output).toContain('https://developer.apple.com/account > Membership details')
          Expect(output).toContain('exactly 10 uppercase letters or digits')
          Expect(output).toContain('Reuse the team that owns your app')
          Expect(output).toContain('Xcode > Settings > Apple Accounts')
          Expect(output).toContain('so Xcode can obtain signing credentials')
          return 'ABCDEFGHIJ'
        },
      },
    }, h.dependencies)
    Expect(result).toBe(0)
    Expect(prompts).toHaveLength(2)
    const build = h.calls.find(call => call.command === '/usr/bin/xcodebuild')!
    Expect(build.args).toContain('DEVELOPMENT_TEAM=ABCDEFGHIJ')
    Expect(build.args).toContain('PRODUCT_BUNDLE_IDENTIFIER=com.acme.visionhello')
  })

  Test(
    'exports before pairing, retains the project on quit, and explains manual device and simulator runs',
    async () => {
      const h = harness({ devices: 0 })
      Expect(await VisionOSSetup.run({ ...h.options, apply: true, terminal: h.terminal }, h.dependencies)).toBe(1)
      const exportIndex = h.calls.findIndex(call => call.command === './tao')
      const discoveryIndex = h.calls.findIndex(call => call.args[0] === 'devicectl')
      Expect(exportIndex).toBeGreaterThanOrEqual(0)
      Expect(discoveryIndex).toBeGreaterThan(exportIndex)
      Expect(h.calls.some(call => call.command === '/usr/bin/xcodebuild')).toBe(false)
      Expect(h.calls.some(call => call.args.includes('install') || call.args.includes('launch'))).toBe(false)
      const saved = [...h.files.entries()].find(([path]) => path.endsWith('/receipt.json'))![1] as {
        xcodeProject: string
        status: string
      }
      Expect(saved.xcodeProject).toContain('/exports/build-1/visionos/TaoApp.xcodeproj')
      Expect(saved.status).toBe('needs-action')
      const output = h.reports.join('\n')
      for (
        const instruction of [
          'File > Open',
          'For Simulator:',
          'TaoApp scheme',
          'Signing & Capabilities',
          'Automatically manage signing',
          'Apple Accounts',
          'Settings > General > Remote Devices',
          'Device Hub > + > Pair Nearby Device',
          'Opening Xcode alone does not start pairing',
        ]
      ) {
        Expect(output).toContain(instruction)
      }
      Expect(output.indexOf('Xcode project generated:')).toBeLessThan(output.indexOf('Next: pair your Vision Pro'))
    },
  )

  Test('failed export stops before pairing and cannot claim a usable project', async () => {
    const h = harness({ failure: './tao' })
    Expect(await VisionOSSetup.run({ ...h.options, apply: true, json: true }, h.dependencies)).toBe(1)
    Expect(h.receipt().xcodeProject).toBeUndefined()
    Expect(h.calls.some(call => call.args[0] === 'devicectl' || call.command === '/usr/bin/xcodebuild')).toBe(false)
  })

  Test('plan inspects a physical headset without exporting, installing, launching, or prompting', async () => {
    const h = harness()
    Expect(await VisionOSSetup.run({ ...h.options, json: true, terminal: h.terminal }, h.dependencies)).toBe(0)
    Expect(h.receipt().status).toBe('planned')
    Expect(h.promptCount()).toBe(0)
    Expect(
      h.calls.some(call => call.command === './tao' || call.args.includes('install') || call.args.includes('launch')),
    ).toBe(false)
    Expect(h.calls.at(-1)?.command).toBe('/usr/bin/xcode-select')
    Expect(h.calls.at(-1)?.env?.['DEVELOPER_DIR']).toBeUndefined()
  })

  Test(
    'excludes simulated and unknown identity records, and refuses unknown Developer Mode or arbitrary multiple headsets',
    async () => {
      for (const settings of [{ reality: 'simulated' }, { reality: '' }, { mode: 'unknown' }, { devices: 2 }]) {
        const h = harness(settings)
        Expect(await VisionOSSetup.run({ ...h.options, apply: true, json: true }, h.dependencies)).toBe(1)
        Expect(h.receipt().status).toBe('needs-action')
        Expect(h.calls.some(call => call.command === './tao')).toBe(true)
        Expect(h.calls.some(call => call.command === '/usr/bin/xcodebuild')).toBe(false)
        Expect(h.receipt().remaining.length).toBeGreaterThan(0)
      }
    },
  )

  Test('Enter rechecks actual Developer Mode and quit saves resumable progress', async () => {
    const h = harness({ mode: 'unknown' })
    let answers = 0
    Expect(
      await VisionOSSetup.run({
        ...h.options,
        apply: true,
        terminal: {
          isInteractive: () => true,
          askText: async () => ++answers === 1 ? '' : 'q',
        },
      }, h.dependencies),
    ).toBe(1)
    Expect(answers).toBe(2)
    Expect(h.calls.filter(call => call.args.includes('details'))).toHaveLength(2)
    Expect(h.calls.some(call => call.command === './tao')).toBe(true)
    Expect(h.calls.some(call => call.command === '/usr/bin/xcodebuild')).toBe(false)
    Expect([...h.files.keys()].some(path => path.endsWith('/receipt.json'))).toBe(true)
    h.setMode('enabled')
    Expect(await VisionOSSetup.run({ ...h.options, apply: true, json: true }, h.dependencies)).toBe(0)
    Expect(h.receipt().status).toBe('running')
  })

  Test(
    'headset run uses retained project, explicit signing and selected Xcode; success requires installed bundle and launch PID',
    async () => {
      const h = harness()
      Expect(await VisionOSSetup.run({ ...h.options, apply: true, json: true }, h.dependencies)).toBe(0)
      Expect(h.receipt()).toMatchObject({ status: 'running', processIdentifier: 123 })
      const build = h.calls.find(call => call.command === '/usr/bin/xcodebuild')!
      Expect(build.args).toContain('DEVELOPMENT_TEAM=ABCDEFGHIJ')
      Expect(build.args).toContain('PRODUCT_BUNDLE_IDENTIFIER=com.acme.visionhello')
      Expect(build.args).toContain('CODE_SIGN_STYLE=Automatic')
      Expect(build.args).toContain('-allowProvisioningUpdates')
      Expect(build.args).toContain('platform=visionOS,id=hardware-udid-0')
      Expect(h.calls.find(call => call.args.includes('launch'))?.args).toContain('headset-0')
      Expect(build.args[build.args.indexOf('-project') + 1]).toContain('/exports/build-1/visionos/TaoApp.xcodeproj')
      Expect(build.env?.['DEVELOPER_DIR']).toBe('/Applications/Xcode-27.1.app/Contents/Developer')
      Expect(h.calls.some(call => call.args[0] === 'simctl')).toBe(false)
      const queries = h.calls.filter(call => call.args.includes('--json-output')).map(call => call.args.at(-1))
      Expect(new Set(queries).size).toBe(queries.length)
      for (const settings of [{ launchPid: 0 }, { installed: 'com.other.app' }]) {
        const failed = harness(settings)
        Expect(await VisionOSSetup.run({ ...failed.options, apply: true, json: true }, failed.dependencies)).toBe(1)
        Expect(failed.receipt().status).toBe('needs-action')
      }
    },
  )

  Test('build failure retains full diagnostics and cannot install or launch', async () => {
    const h = harness({ failure: '/usr/bin/xcodebuild' })
    Expect(await VisionOSSetup.run({ ...h.options, apply: true, json: true }, h.dependencies)).toBe(1)
    Expect(h.receipt().remaining.join('\n')).toContain('Signing requires an account')
    Expect(h.files.get(h.receipt().log!)).toContain('Signing requires an account')
    Expect(h.calls.some(call => call.args.includes('install') || call.args.includes('launch'))).toBe(false)
  })

  Test(
    'optional simulator path boots exact runtime, verifies container, and never uses headset signing or devicectl',
    async () => {
      const h = harness()
      Expect(
        await VisionOSSetup.run({
          ...h.options,
          simulator: true,
          runtimeVersion: '27.1',
          team: undefined,
          apply: true,
          json: true,
        }, h.dependencies),
      ).toBe(0)
      Expect(h.receipt().status).toBe('running')
      Expect(h.calls.some(call => call.args[0] === 'devicectl')).toBe(false)
      Expect(h.calls.find(call => call.args[1] === 'bootstatus')?.args).toEqual(['simctl', 'bootstatus', 'sim-1', '-b'])
      Expect(h.calls.find(call => call.command === '/usr/bin/xcodebuild')?.args).toContain('CODE_SIGNING_ALLOWED=NO')
      const normalized = harness()
      Expect(
        await VisionOSSetup.run(
          { ...normalized.options, simulator: true, runtimeVersion: '27.1.0', json: true },
          normalized.dependencies,
        ),
      ).toBe(0)
      const mismatch = harness()
      Expect(
        await VisionOSSetup.run(
          { ...mismatch.options, simulator: true, runtimeVersion: '27.0', json: true },
          mismatch.dependencies,
        ),
      ).toBe(1)
      Expect(mismatch.calls.some(call => call.args[1] === 'boot')).toBe(false)
      const named = harness()
      Expect(await VisionOSSetup.run({ ...named.options, device: 'Headset 0', json: true }, named.dependencies)).toBe(1)
    },
  )

  Test(
    'supports older physical records, rejects unsuccessful JSON, and rechecks the global selection before exit',
    async () => {
      const older = harness({ legacy: true })
      Expect(await VisionOSSetup.run({ ...older.options, json: true }, older.dependencies)).toBe(0)
      Expect(older.receipt().status).toBe('planned')
      const simulated = harness({ legacy: true, reality: 'simulated' })
      Expect(await VisionOSSetup.run({ ...simulated.options, json: true }, simulated.dependencies)).toBe(1)
      const badJson = harness({ jsonOutcome: 'failed' })
      Expect(await VisionOSSetup.run({ ...badJson.options, apply: true, json: true }, badJson.dependencies)).toBe(1)
      Expect(badJson.calls.some(call => call.command === '/usr/bin/xcodebuild')).toBe(false)
      const changed = harness({ selection: '/Applications/Other.app/Contents/Developer' })
      Expect(await VisionOSSetup.run({ ...changed.options, json: true }, changed.dependencies)).toBe(1)
      Expect(changed.receipt().remaining.join('\n')).toContain('global Xcode selection changed')
      Expect(changed.calls.filter(call => call.command === '/usr/bin/xcode-select').map(call => call.args))
        .toEqual([['-p']])
    },
  )

  Test('rejects preview signing identities and missing simulator version before executing commands', async () => {
    const h = harness()
    await Expect(VisionOSSetup.run({ ...h.options, bundleId: 'com.devtao.preview.visionhello' }, h.dependencies))
      .rejects.toThrow('your own reverse-DNS')
    await Expect(VisionOSSetup.run({ ...h.options, team: 'bad-team' }, h.dependencies)).rejects.toThrow('10-character')
    await Expect(VisionOSSetup.run({ ...h.options, simulator: true }, h.dependencies)).rejects.toThrow(
      'requires --runtime-version',
    )
    Expect(h.calls).toHaveLength(0)
  })

  Test('a mistyped headset selection reoffers current identifiers instead of trapping the retry loop', async () => {
    const h = harness({ devices: 2 })
    const answers = ['typo', 'headset-1']
    const prompts: string[] = []
    Expect(
      await VisionOSSetup.run({
        ...h.options,
        apply: true,
        terminal: {
          isInteractive: () => true,
          askText: async options => {
            prompts.push(options.message)
            return answers.shift() ?? 'q'
          },
        },
      }, h.dependencies),
    ).toBe(0)
    Expect(prompts).toHaveLength(2)
    Expect(prompts.every(message => message.startsWith('Select a headset by identifier'))).toBe(true)
    Expect(h.calls.find(call => call.command === '/usr/bin/xcodebuild')?.args).toContain(
      'platform=visionOS,id=hardware-udid-1',
    )
  })
})
