import { type CLI } from '@shared'
import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { WatchosSetupCommand } from '../dev-cli-src/watchos-setup/WatchosSetupCommand'

function harness(settings: { device?: boolean; booted?: boolean; failure?: string; runtimeReady?: boolean } = {}) {
  const calls: { command: string; args: string[]; env?: Record<string, string | undefined> }[] = []
  const files = new Map<string, unknown>()
  const reports: string[] = []
  const options = {
    repositoryRoot: '/repo',
    project: 'Apps/WatchHello',
    xcodeVersion: '27.1',
    runtimeVersion: '27.1',
    json: true,
    runCommand: async (command: string, spec: CLI.CommandSpec = {}) => {
      const args = spec.args ?? []
      calls.push({ command, args: [...args], env: spec.env })
      let stdout = ''
      if (command === './tao') {
        const output = args[args.indexOf('--output') + 1]!
        files.set(`${output}/build-1/build.json`, {
          results: { watchos: { status: 'succeeded', artifact: `${output}/build-1/watchos/TaoWatch.xcodeproj` } },
        })
      }
      if (command.endsWith('PlistBuddy')) {
        stdout = 'com.devtao.preview.watchhello'
      }
      if (command.endsWith('xcode-select')) {
        stdout = '/Applications/Xcode.app/Contents/Developer'
      }
      if (args.includes('runtimes')) {
        stdout = JSON.stringify({
          runtimes: [{
            identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-27-1',
            version: '27.1',
            isAvailable: true,
          }],
        })
      }
      if (args.includes('devices')) {
        stdout = JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.watchOS-27-1': settings.device === false ? [] : [{
              udid: 'watch-uuid',
              name: 'Apple Watch',
              state: settings.booted ? 'Booted' : 'Shutdown',
              deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-11',
              isAvailable: true,
            }],
          },
        })
      }
      if (args.includes('get_app_container')) {
        stdout = '/sim/TaoWatch.app'
      }
      if (args.includes('launch')) {
        stdout = 'com.devtao.preview.watchhello: 321\n'
      }
      return {
        command,
        args: [...args],
        exitCode: command === settings.failure ? 1 : 0,
        signal: null,
        stdout,
        stderr: command === settings.failure ? 'Native build failed' : '',
      }
    },
  }
  const dependencies = {
    prepare: async () => ({
      requested: { xcodeVersion: '27.1', runtimeVersion: '27.1' },
      mode: 'apply' as const,
      status: (settings.runtimeReady === false ? 'needs-action' : 'ready') as 'ready' | 'needs-action',
      selectedXcode: '/Applications/Xcode-27.1.app',
      defaultDeveloperDirectory: '/Applications/Xcode.app/Contents/Developer',
      runtimeAvailable: settings.runtimeReady !== false,
      simulatorHealthy: settings.runtimeReady !== false,
      remaining: settings.runtimeReady === false ? ['Install watchOS 27.1 Simulator runtime.'] : [],
      ownedPaths: [],
    }),
    files: {
      readJson: async <T = unknown>(path: string): Promise<T> => files.get(path) as T,
      writeJson: async (path: string, value: unknown) => {
        files.set(path, value)
      },
      writeText: async (path: string, value: string) => {
        files.set(path, value)
      },
      exists: async () => true,
      listDir: async () => ['build-1'],
    },
    report: (message: string) => reports.push(message),
  }
  const receipt = () =>
    JSON.parse(reports.at(-1)!) as {
      status: string
      remaining: string[]
      xcodeProject?: string
      processIdentifier?: number
      log?: string
    }
  return { calls, files, reports, options, dependencies, receipt }
}

Describe('guided watchOS setup', () => {
  Test('requires an exact simulator runtime and does not claim readiness from an absent runtime', async () => {
    const h = harness({ runtimeReady: false })
    await Expect(WatchosSetupCommand.run({ ...h.options, runtimeVersion: undefined }, h.dependencies))
      .rejects.toThrow('--runtime-version')
    Expect(await WatchosSetupCommand.run(h.options, h.dependencies)).toBe(1)
    Expect(h.receipt().remaining.join('\n')).toContain('Install watchOS 27.1')
    Expect(h.calls.some(call => call.command === './tao')).toBe(false)
  })

  Test('exports before simulator discovery; a missing device stops before build and install', async () => {
    const h = harness({ device: false })
    Expect(await WatchosSetupCommand.run({ ...h.options, apply: true }, h.dependencies)).toBe(1)
    Expect(h.calls.findIndex(call => call.command === './tao')).toBeLessThan(
      h.calls.findIndex(call => call.args.includes('runtimes')),
    )
    Expect(h.receipt().xcodeProject).toContain('TaoWatch.xcodeproj')
    Expect(h.receipt().remaining.join('\n')).toContain('Device Hub')
    Expect(h.calls.some(call => call.command === '/usr/bin/xcodebuild')).toBe(false)
    Expect(h.calls.some(call => call.args.includes('install'))).toBe(false)
  })

  Test('rechecks device inventory after Enter instead of treating the prompt as readiness', async () => {
    const h = harness({ device: false })
    const prompts: string[] = []
    Expect(
      await WatchosSetupCommand.run({
        ...h.options,
        apply: true,
        json: false,
        terminal: {
          isInteractive: () => true,
          askText: async ({ message }) => {
            prompts.push(message)
            return prompts.length === 1 ? '' : 'q'
          },
        },
      }, h.dependencies),
    ).toBe(1)
    Expect(prompts).toHaveLength(2)
    Expect(h.calls.filter(call => call.args.includes('devices'))).toHaveLength(2)
    Expect(h.calls.some(call => call.command === '/usr/bin/xcodebuild')).toBe(false)
  })

  Test('builds, installs, verifies the app container, and launches on a selected simulator', async () => {
    const h = harness({ booted: true })
    Expect(await WatchosSetupCommand.run({ ...h.options, apply: true }, h.dependencies)).toBe(0)
    Expect(h.receipt().status).toBe('running')
    Expect(h.receipt().processIdentifier).toBe(321)
    const build = h.calls.find(call => call.command === '/usr/bin/xcodebuild')!
    Expect(build.args).toContain('CODE_SIGNING_ALLOWED=NO')
    Expect(build.env?.['DEVELOPER_DIR']).toBe('/Applications/Xcode-27.1.app/Contents/Developer')
    Expect(h.calls.some(call => call.args[1] === 'boot')).toBe(false)
    Expect(h.calls.find(call => call.args.includes('get_app_container'))?.args).toContain(
      'com.devtao.preview.watchhello',
    )
    Expect(h.calls.at(-1)?.command).toBe('/usr/bin/xcode-select')
  })

  Test('build failure retains diagnostics and never installs', async () => {
    const h = harness({ failure: '/usr/bin/xcodebuild' })
    Expect(await WatchosSetupCommand.run({ ...h.options, apply: true }, h.dependencies)).toBe(1)
    Expect(h.receipt().remaining.join('\n')).toContain('Native build failed')
    Expect(h.files.get(h.receipt().log!)).toContain('Native build failed')
    Expect(h.calls.some(call => call.args.includes('install'))).toBe(false)
  })

  Test('physical mode exports and prints person-led pairing and signing steps without simulator work', async () => {
    const h = harness()
    const output = await withCapturedOutput(() =>
      WatchosSetupCommand.run({
        ...h.options,
        physical: true,
        runtimeVersion: undefined,
        apply: true,
      }, h.dependencies)
    )
    Expect(output.result).toBe(1)
    Expect(h.receipt().remaining.join('\n')).toContain('companion iPhone')
    Expect(h.receipt().remaining.join('\n')).toContain('Developer Mode')
    Expect(h.receipt().remaining.join('\n')).toContain('Signing & Capabilities')
    Expect(h.calls.some(call => call.args[0] === 'simctl' || call.command === '/usr/bin/xcodebuild')).toBe(false)
  })
})
