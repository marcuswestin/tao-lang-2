import { CLI } from '@shared'
import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { AppleSetupPlatforms, AppleToolchainSetup } from '../dev-cli-src/apple-setup/AppleToolchainSetup'

async function prepare(fixture: {
  runtimeVersion?: string
  runtimeIdentifier?: string
  installedVersion?: string
  apply?: boolean
  interactive?: boolean
  missingDeviceSdk?: boolean
  installDeviceSdk?: boolean
} = {}) {
  const calls: { name: string; spec: CLI.CommandSpec }[] = []
  const writes: string[] = []
  const prompts: string[] = []
  let deviceSdkAvailable = !fixture.missingDeviceSdk
  let imported = false
  const output = await withCapturedOutput(() =>
    AppleToolchainSetup.prepare({
      xcodeVersion: '27.1',
      runtimeVersion: fixture.runtimeVersion,
      repositoryRoot: '/repo',
      hostPlatform: 'darwin',
      hostArch: 'arm64',
      apply: fixture.apply,
      terminal: {
        isInteractive: () => fixture.interactive ?? false,
        askText: async options => {
          prompts.push(options.message)
          if (prompts.length === 2 && fixture.installDeviceSdk) {
            deviceSdkAvailable = true
          }
          return ''
        },
      },
      files: {
        homeDir: () => '/Users/test',
        exists: async path => path === '/Applications/Xcode-27.1.app/Contents/Developer/usr/bin/xcodebuild',
        isFile: async () => false,
        isSymbolicLink: async () => false,
        listDir: async path => path.includes('/runtime-') ? ['visionOS.dmg'] : ['Xcode-27.1.app'],
        mkdir: async path => {
          writes.push(path)
        },
        writeJson: async path => {
          writes.push(path)
        },
      },
      runCommand: async (name, spec = {}) => {
        calls.push({ name, spec })
        const args = spec.args ?? []
        let stdout = ''
        let exitCode = 0
        if (name.endsWith('sw_vers')) {
          stdout = '27.0'
        }
        if (name.endsWith('xcode-select')) {
          stdout = '/Applications/Xcode.app/Contents/Developer'
        }
        if (name.endsWith('PlistBuddy')) {
          stdout = args[1] === 'Print :LSMinimumSystemVersion' ? '26.0' : '27.1'
        }
        if (args.includes('-version')) {
          stdout = 'Xcode 27.1\nBuild version 18B42'
        }
        if (args.includes('--show-sdk-version')) {
          stdout = '27.1'
          if (args.includes('xros') && !deviceSdkAvailable) {
            exitCode = 1
          }
        }
        if (args.includes('-importPlatform')) {
          imported = true
        }
        if (args.includes('runtimes')) {
          stdout = JSON.stringify({
            runtimes: [{
              identifier: fixture.runtimeIdentifier ?? 'com.apple.CoreSimulator.SimRuntime.xrOS-27-1',
              version: imported ? '27.1' : fixture.installedVersion ?? '27.1',
              isAvailable: true,
            }],
          })
        }
        if (args.includes('devices')) {
          stdout = '{"devices":{}}'
        }
        if (name.endsWith('/df')) {
          stdout = 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk 200000000 1000000 199000000 1% /'
        }
        return { command: name, args: [...args], exitCode, signal: null, stdout, stderr: '' }
      },
    }, AppleSetupPlatforms.visionos)
  )
  return { receipt: output.result, output: output.stdout, calls, writes, prompts }
}

Describe('shared Apple toolchain setup', () => {
  Test('checks visionOS device support without touching simulator state for headset-only setup', async () => {
    const result = await prepare()
    Expect(result.receipt.status).toBe('ready')
    Expect(result.receipt.selectedXcode).toBe('/Applications/Xcode-27.1.app')
    Expect(result.receipt.deviceSdk).toBe('27.1')
    Expect(result.calls.filter(call => call.name.endsWith('/xcrun')).map(call => call.spec.args)).toEqual([
      ['--sdk', 'xros', '--show-sdk-version'],
    ])
    Expect(result.calls.some(call => call.spec.args?.includes('-downloadPlatform'))).toBe(false)
    Expect(result.writes).toEqual([])
    Expect(result.output).toBe('')
  })

  Test('requires the visionOS runtime identifier and requested version', async () => {
    for (
      const fixture of [
        { runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1' },
        { installedVersion: '27.0' },
      ]
    ) {
      const result = await prepare({ runtimeVersion: '27.1', ...fixture })
      Expect(result.receipt.status).toBe('needs-action')
      Expect(result.receipt.runtimeAvailable).toBe(false)
      Expect(result.calls.some(call => call.spec.args?.includes('xrsimulator'))).toBe(true)
    }
    const ready = await prepare({ runtimeVersion: '27.1' })
    Expect(ready.receipt.status).toBe('ready')
    Expect(ready.receipt.runtimeAvailable).toBe(true)
    Expect(ready.receipt.simulatorHealthy).toBe(true)
  })

  Test('downloads visionOS and rechecks its exact runtime after importing', async () => {
    const result = await prepare({ runtimeVersion: '27.1', installedVersion: '27.0', apply: true })
    const download = result.calls.find(call => call.spec.args?.includes('-downloadPlatform'))
    Expect(download?.spec.args?.slice(0, 4)).toEqual(['-downloadPlatform', 'visionOS', '-buildVersion', '27.1'])
    Expect(download?.spec.env).toEqual({ DEVELOPER_DIR: '/Applications/Xcode-27.1.app/Contents/Developer' })
    Expect(result.calls.filter(call => call.spec.args?.includes('runtimes')).length).toBe(2)
    Expect(result.calls.some(call => call.spec.args?.includes('-importPlatform'))).toBe(true)
    Expect(result.receipt.status).toBe('ready')
    Expect(result.writes.some(path => path.startsWith('/repo/.artifacts/visionos-setup/27.1-27.1/'))).toBe(true)
  })

  Test('hands missing device platform support back without opening Xcode in inspection mode', async () => {
    const result = await prepare({ missingDeviceSdk: true, interactive: true })
    Expect(result.receipt.status).toBe('needs-action')
    Expect(result.receipt.remaining.join('\n')).toContain('visionOS Platform Support')
    Expect(result.calls.some(call => call.name.endsWith('/open'))).toBe(false)
    Expect(result.prompts).toEqual([])
  })

  Test('rechecks device platform support after guided installation', async () => {
    const result = await prepare({ missingDeviceSdk: true, installDeviceSdk: true, apply: true, interactive: true })
    Expect(result.receipt.status).toBe('ready')
    Expect(result.receipt.remaining).toEqual([])
    Expect(result.calls.filter(call => call.spec.args?.includes('xros')).length).toBe(2)
    Expect(result.calls.some(call => call.name.endsWith('/open'))).toBe(true)
    Expect(result.calls.some(call => call.spec.args?.includes('simctl'))).toBe(false)
  })

  Test('does not treat Enter as evidence of installed device platform support', async () => {
    const result = await prepare({ missingDeviceSdk: true, apply: true, interactive: true })
    Expect(result.receipt.status).toBe('needs-action')
    Expect(result.receipt.remaining.join('\n')).toContain('device SDK is still unavailable')
    Expect(result.calls.filter(call => call.spec.args?.includes('xros')).length).toBe(2)
  })
})
