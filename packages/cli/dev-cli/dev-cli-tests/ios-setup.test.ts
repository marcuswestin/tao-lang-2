import { CLI } from '@shared'
import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { IosSetupCommand } from '../dev-cli-src/ios-setup/IosSetupCommand'

type Invocation = { name: string; spec: CLI.CommandSpec }
type InstallState = { paths: Set<string>; failCopyOnce?: boolean; installed?: string }

async function setup(fixture: {
  xcodeVersion?: string
  hostArch?: string
  installed?: string
  installedVersion?: string
  runtime?: string
  serviceFailure?: boolean
  firstLaunch?: boolean
  apply?: boolean
  json?: boolean
  interactive?: boolean
  answers?: { answer: string; downloads?: string[]; firstLaunchComplete?: boolean; installedRuntime?: string }[]
  archive?: string
  downloads?: string[]
  downloadDirectories?: string[]
  defaultChanged?: boolean
  afterImport?: string
  runtimeDownloadError?: string
  archiveExists?: boolean
  archiveVersion?: string
  targetSymlink?: boolean
  defaultUnset?: boolean
  defaultError?: string
  deviceOutput?: string
  deviceDiagnostic?: string
  extractedApps?: string[]
  lowDisk?: boolean
  lowDiskAfterPrompt?: boolean
  installState?: InstallState
  publishCollision?: boolean
} = {}) {
  const calls: Invocation[] = []
  const writes: string[] = []
  const listings: string[] = []
  const prompts: string[] = []
  const events: string[] = []
  let receiptJson: string | undefined
  let downloads = fixture.downloads
  let firstLaunchPending = fixture.firstLaunch
  let defaults = 0
  const state = fixture.installState ?? { paths: new Set<string>(), installed: fixture.installed }
  let imported = false
  let installedRuntime = fixture.runtime ?? '27.1'
  const result = await withCapturedOutput(async () =>
    await IosSetupCommand.run({
      xcodeVersion: fixture.xcodeVersion ?? '27.1',
      runtimeVersion: '27.1',
      apply: fixture.apply,
      archive: fixture.archive,
      repositoryRoot: '/repo',
      hostPlatform: 'darwin',
      hostArch: fixture.hostArch ?? 'arm64',
      json: fixture.json ?? true,
      terminal: {
        isInteractive: () => fixture.interactive ?? false,
        askText: async options => {
          prompts.push(options.message)
          events.push('prompt')
          const reply = fixture.answers?.[prompts.length - 1]
          downloads = reply?.downloads ?? downloads
          installedRuntime = reply?.installedRuntime ?? installedRuntime
          if (reply?.firstLaunchComplete) {
            firstLaunchPending = false
          }
          return reply?.answer ?? 'q'
        },
      },
      files: {
        homeDir: () => '/Users/test',
        exists: async path =>
          path === '/Users/test/Downloads' && downloads !== undefined
          || state.paths.has(path) || path === state.installed
          || path === `${state.installed}/Contents/Developer/usr/bin/xcodebuild`,
        isFile: async path =>
          path.startsWith('/Users/test/Downloads/')
            ? (downloads ?? []).includes(path.split('/').at(-1)!)
              && !(fixture.downloadDirectories ?? []).includes(path.split('/').at(-1)!)
            : fixture.archiveExists ?? false,
        isSymbolicLink: async path => path === '/Applications/Xcode-27.1.app' && (fixture.targetSymlink ?? false),
        listDir: async path => {
          listings.push(path)
          if (path === '/Users/test/Downloads') {
            events.push('scan')
            return downloads ?? []
          }
          if (path.includes('/runtime-')) {
            return ['iOS.simruntime.dmg']
          }
          if (path.includes('/extract-')) {
            return fixture.extractedApps ?? ['Xcode.app']
          }
          return state.installed ? [state.installed.split('/').at(-1)!] : []
        },
        mkdir: async path => {
          writes.push(path)
        },
        writeJson: async (path, value) => {
          writes.push(path)
          receiptJson = JSON.stringify(value)
        },
      },
      runCommand: async (name, spec = {}) => {
        calls.push({ name, spec })
        events.push(spec.args?.includes('-checkFirstLaunchStatus') ? 'check-first-launch' : name)
        const args = spec.args ?? []
        let stdout = ''
        let stderr = ''
        let exitCode = 0
        if (name.endsWith('sw_vers')) {
          stdout = '27.0\n'
        }
        if (name.endsWith('xcode-select')) {
          defaults++
          stdout = fixture.defaultChanged && defaults > 1 ? '/changed' : '/Applications/Xcode.app/Contents/Developer\n'
          if (fixture.defaultError || fixture.defaultUnset && !(fixture.defaultChanged && defaults > 1)) {
            stdout = ''
            stderr = fixture.defaultError ?? 'xcode-select: error: unable to get active developer directory.'
            exitCode = 2
          }
        }
        if (name.endsWith('PlistBuddy')) {
          stdout = args[1] === 'Print :LSMinimumSystemVersion'
            ? '26.0'
            : fixture.installedVersion ?? fixture.archiveVersion ?? '27.1'
        }
        if (name.endsWith('/xip')) {
          for (const app of fixture.extractedApps ?? ['Xcode.app']) {
            state.paths.add(`${spec.cwd}/${app}/Contents/Developer/usr/bin/xcodebuild`)
          }
        }
        if (name.endsWith('/mkdir')) {
          if (state.paths.has(args[0]!)) {
            exitCode = 1
            stderr = 'File exists'
          } else {
            state.paths.add(args[0]!)
          }
        }
        if (name.endsWith('/ditto')) {
          state.paths.add(args[1]!)
          if (state.failCopyOnce) {
            state.failCopyOnce = false
            exitCode = 1
            stderr = 'copy interrupted'
          } else {
            state.paths.add(`${args[1]}/Contents/Developer/usr/bin/xcodebuild`)
          }
        }
        if (name.endsWith('/mv') && !fixture.publishCollision) {
          state.paths.delete(args[1]!)
          state.installed = '/Applications/Xcode-27.1.app'
        }
        if (args.includes('-importPlatform')) {
          imported = true
        }
        if (args.includes('-downloadPlatform') && fixture.runtimeDownloadError) {
          exitCode = 1
          stderr = fixture.runtimeDownloadError
        }
        if (name.endsWith('/df')) {
          stdout = `Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk 200000000 1000000 ${
            fixture.lowDisk || fixture.lowDiskAfterPrompt && prompts.length > 0 ? 1000 : 199000000
          } 1% /\n`
        }
        if (args.includes('-version')) {
          stdout = 'Xcode 27.1\nBuild version 18B42'
        }
        if (args.includes('-checkFirstLaunchStatus') && firstLaunchPending) {
          exitCode = 1
        }
        if (args.includes('--show-sdk-version')) {
          stdout = '27.1'
        }
        if (args.includes('runtimes')) {
          stdout = JSON.stringify({
            runtimes: [{
              identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1',
              version: imported ? fixture.afterImport ?? installedRuntime : installedRuntime,
              isAvailable: true,
            }],
          })
          if (fixture.serviceFailure) {
            stderr = 'CoreSimulatorService connection invalid'
            exitCode = 1
          }
        }
        if (args.includes('devices')) {
          stdout = fixture.deviceOutput ?? '{"devices":{}}'
          stderr = fixture.deviceDiagnostic ?? ''
        }
        return { command: name, args: [...args], exitCode, signal: null, stdout, stderr }
      },
    })
  )
  return {
    calls,
    writes,
    listings,
    prompts,
    events,
    output: result.stdout,
    code: result.result,
    receipt: JSON.parse(receiptJson ?? (fixture.json === false ? '{}' : result.stdout)) as {
      status: string
      selectedXcode?: string
      selectedArchive?: string
      xcodeBuild?: string
      remaining: string[]
      runtimeAvailable: boolean
      defaultDeveloperDirectory: string | null
      ownedPaths: { path: string; purpose: string; cleanup: string }[]
    },
  }
}

Describe('explicit iOS dependency setup', () => {
  Test('opens the selected Xcode after Enter and rechecks first launch before continuing', async () => {
    const result = await setup({
      installed: '/Applications/Xcode-27.1.app',
      firstLaunch: true,
      apply: true,
      json: false,
      interactive: true,
      answers: [{ answer: '' }, { answer: '', firstLaunchComplete: true }],
    })
    Expect(result.code).toBe(0)
    Expect(result.receipt.remaining).toEqual([])
    Expect(result.output).toContain("review and accept Apple's license if you agree")
    Expect(result.output).toContain('let required components finish installing')
    Expect(result.prompts).toEqual([
      'Press Enter to open /Applications/Xcode-27.1.app, or type q and Enter to stop',
      'After completing setup in Xcode, press Enter to continue, or type q and Enter to stop',
    ])
    Expect(result.calls.find(call => call.name === '/usr/bin/open')?.spec.args).toEqual([
      '/Applications/Xcode-27.1.app',
    ])
    Expect(
      result.events.filter(event =>
        ['check-first-launch', 'prompt', '/usr/bin/open', '/usr/bin/xcrun'].includes(event)
      ),
    )
      .toEqual([
        'check-first-launch',
        'prompt',
        '/usr/bin/open',
        'prompt',
        'check-first-launch',
        '/usr/bin/xcrun',
        '/usr/bin/xcrun',
        '/usr/bin/xcrun',
      ])
  })

  Test('does not open Xcode or wait for first launch in plan, JSON, or noninteractive runs', async () => {
    for (
      const mode of [
        { apply: false, json: false, interactive: true },
        { apply: true, json: true, interactive: true },
        { apply: true, json: false, interactive: false },
      ]
    ) {
      const result = await setup({ ...mode, installed: '/Applications/Xcode.app', firstLaunch: true })
      Expect(result.code).toBe(1)
      Expect(result.prompts).toEqual([])
      Expect(result.calls.some(call => call.name === '/usr/bin/open')).toBe(false)
      Expect(result.output).toContain('Open Xcode to complete these steps')
    }
  })

  Test('allows quitting before opening Xcode or while waiting for its setup', async () => {
    for (const answers of [[{ answer: 'q' }], [{ answer: '' }, { answer: 'q' }]]) {
      const result = await setup({
        installed: '/Applications/Xcode.app',
        firstLaunch: true,
        apply: true,
        json: false,
        interactive: true,
        answers,
      })
      Expect(result.code).toBe(1)
      Expect(result.calls.filter(call => call.name === '/usr/bin/open').length).toBe(answers.length - 1)
      Expect(result.calls.filter(call => call.spec.args?.includes('-checkFirstLaunchStatus')).length).toBe(1)
      Expect(result.calls.some(call => call.name === '/usr/bin/xcrun')).toBe(false)
      Expect(result.receipt.remaining.join('\n')).toContain('Stopped')
    }
  })

  Test('pressing Enter after opening Xcode does not imply first-launch completion', async () => {
    const result = await setup({
      installed: '/Applications/Xcode.app',
      firstLaunch: true,
      apply: true,
      json: false,
      interactive: true,
      answers: [{ answer: '' }, { answer: '' }],
    })
    Expect(result.code).toBe(1)
    Expect(result.calls.filter(call => call.spec.args?.includes('-checkFirstLaunchStatus')).length).toBe(2)
    Expect(result.receipt.remaining.join('\n')).toContain('Xcode setup is still incomplete')
    Expect(result.calls.some(call => call.name === '/usr/bin/xcrun')).toBe(false)
  })

  Test('passes the Apple identity requirement as inline codesign source rather than a filename', async () => {
    const result = await setup({ installed: '/Applications/Xcode.app' })
    const verification = result.calls.find(call => call.name === '/usr/bin/codesign')
    Expect(verification?.spec.args).toEqual([
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '-R',
      '=anchor apple and identifier "com.apple.dt.Xcode"',
      '/Applications/Xcode.app',
    ])
  })

  Test('rechecks free space consumed while waiting for the download before extraction', async () => {
    const result = await setup({
      apply: true,
      json: false,
      interactive: true,
      downloads: [],
      lowDiskAfterPrompt: true,
      answers: [{ answer: '', downloads: ['Xcode_27.1_beta.xip'] }],
    })
    Expect(result.code).toBe(1)
    Expect(result.prompts.length).toBe(1)
    Expect(result.receipt.remaining.join('\n')).toContain('Need at least 50 GiB free')
    Expect(result.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
  })

  Test('guides the download and resumes installation in the same interactive command', async () => {
    const result = await setup({
      apply: true,
      json: false,
      interactive: true,
      downloads: [],
      answers: [{ answer: '', downloads: ['Xcode_27.1_beta.xip'] }],
    })
    Expect(result.code).toBe(0)
    Expect(result.prompts).toEqual([
      'Press Enter when the download is complete to continue, or type q and Enter to stop',
    ])
    Expect(result.output).toContain('https://developer.apple.com/download/applications/')
    Expect(result.output).toContain('download Xcode 27.1 into /Users/test/Downloads')
    Expect(result.receipt.selectedArchive).toBe('/Users/test/Downloads/Xcode_27.1_beta.xip')
    Expect(result.receipt.remaining).toEqual([])
    Expect(result.events.filter(event => ['scan', 'prompt', '/usr/bin/xip'].includes(event))).toEqual([
      'scan',
      'prompt',
      'scan',
      '/usr/bin/xip',
    ])
  })

  Test('rescans after early Enter and stops without extraction when the user quits', async () => {
    const result = await setup({
      apply: true,
      json: false,
      interactive: true,
      downloads: [],
      answers: [{ answer: '', downloads: ['Xcode_27.1_beta.xip.download'] }, { answer: 'q' }],
    })
    Expect(result.code).toBe(1)
    Expect(result.prompts.length).toBe(2)
    Expect(result.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
    Expect(result.receipt.remaining.join('\n')).toContain('Stopped before installation')
    Expect(result.receipt.remaining.filter(step => step.startsWith('No completed')).length).toBe(1)
  })

  Test('does not wait for input in plan, JSON, or noninteractive runs', async () => {
    for (
      const mode of [
        { apply: false, json: false, interactive: true },
        { apply: true, json: true, interactive: true },
        { apply: true, json: false, interactive: false },
      ]
    ) {
      const result = await setup({ ...mode, downloads: [] })
      Expect(result.code).toBe(1)
      Expect(result.prompts).toEqual([])
      Expect(result.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
      Expect(result.output).toContain('Rerun with --apply after downloading.')
    }
  })

  Test('detects a major-only archive filename for the equivalent point-zero request', async () => {
    const result = await setup({ xcodeVersion: '27.0', downloads: ['Xcode_27_Universal.xip'] })
    Expect(result.receipt.selectedArchive).toBe('/Users/test/Downloads/Xcode_27_Universal.xip')
  })

  Test('detects the completed requested archive and reports it without installing in plan mode', async () => {
    const result = await setup({
      downloads: [
        'Xcode_27.1_beta.xip',
        'Xcode_27.10.xip',
        'Xcode_27.0.xip',
        'Xcode_27.1_beta_2.xip.download',
        'Xcode_27.1_beta_3.xip.crdownload',
        'Xcode_27.1_directory.xip',
      ],
      downloadDirectories: ['Xcode_27.1_directory.xip'],
    })
    Expect(result.receipt.selectedArchive).toBe('/Users/test/Downloads/Xcode_27.1_beta.xip')
    Expect(result.writes).toEqual([])
    Expect(result.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
  })

  Test('applies a detected archive and still verifies its extracted version before copying', async () => {
    const result = await setup({ downloads: ['Xcode_27.1_beta.xip'], apply: true })
    Expect(result.code).toBe(0)
    Expect(result.calls.find(call => call.name.endsWith('/xip'))?.spec.args).toEqual([
      '--expand',
      '/Users/test/Downloads/Xcode_27.1_beta.xip',
    ])
    const wrong = await setup({ downloads: ['Xcode_27.1_beta.xip'], archiveVersion: '27.0', apply: true })
    Expect(wrong.code).toBe(1)
    Expect(wrong.receipt.remaining.join('\n')).toContain('Archive contains Xcode 27.0; requested 27.1.')
    Expect(wrong.calls.some(call => call.name.endsWith('/ditto'))).toBe(false)
  })

  Test('lists ambiguous downloads without extracting or choosing the newest beta', async () => {
    const result = await setup({ downloads: ['Xcode_27.1_beta.xip', 'Xcode_27.1_beta_2.xip'], apply: true })
    Expect(result.code).toBe(1)
    Expect(result.receipt.selectedArchive).toBeUndefined()
    Expect(result.receipt.remaining).toContain('/Users/test/Downloads/Xcode_27.1_beta.xip')
    Expect(result.receipt.remaining).toContain('/Users/test/Downloads/Xcode_27.1_beta_2.xip')
    Expect(result.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
  })

  Test('an explicit archive or installed Xcode skips Downloads inspection', async () => {
    const explicit = await setup({
      archive: '/Downloads/renamed.xip',
      archiveExists: true,
      downloads: ['Xcode_27.1_beta.xip', 'Xcode_27.1_beta_2.xip'],
      apply: true,
    })
    Expect(explicit.code).toBe(0)
    Expect(explicit.receipt.selectedArchive).toBe('/Downloads/renamed.xip')
    Expect(explicit.listings).not.toContain('/Users/test/Downloads')
    const installed = await setup({ installed: '/Applications/Xcode.app', downloads: ['Xcode_27.1_beta.xip'] })
    Expect(installed.code).toBe(0)
    Expect(installed.listings).not.toContain('/Users/test/Downloads')
  })

  Test('explains where to download when only incomplete or different-version archives exist', async () => {
    const result = await setup({ downloads: ['Xcode_27.1.xip.download', 'Xcode_27.10.xip'], apply: true })
    Expect(result.code).toBe(1)
    Expect(result.receipt.remaining.join('\n')).toContain(
      'No completed Xcode 27.1 .xip found in /Users/test/Downloads.',
    )
    Expect(result.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
  })

  Test('plans without writes or installers and hands off a missing Apple archive', async () => {
    const result = await setup()
    Expect(result.code).toBe(1)
    Expect(result.writes).toEqual([])
    Expect(result.calls.map(call => call.name)).toEqual([
      '/usr/bin/sw_vers',
      '/usr/bin/xcode-select',
      '/bin/df',
      '/bin/df',
      '/usr/bin/xcode-select',
    ])
    Expect(result.receipt.remaining.join('\n')).toContain('https://developer.apple.com/download/applications/')
  })

  Test('reuses a matching Xcode while isolating developer-directory overrides', async () => {
    const result = await setup({ installed: '/Applications/Xcode-preview.app' })
    Expect(result.code).toBe(0)
    Expect(result.receipt.selectedXcode).toBe('/Applications/Xcode-preview.app')
    Expect(result.receipt.xcodeBuild).toBe('Xcode 27.1\nBuild version 18B42')
    Expect(result.writes).toEqual([])
    const selection = result.calls.filter(call => call.name.endsWith('xcode-select'))
    Expect(selection.length).toBe(2)
    for (const call of selection) {
      Expect(call.spec.args).toEqual(['-p'])
      Expect(call.spec.env).toEqual({ DEVELOPER_DIR: undefined })
    }
    for (const call of result.calls.filter(call => call.name.endsWith('xcodebuild') || call.name.endsWith('xcrun'))) {
      Expect(call.spec.env).toEqual({ DEVELOPER_DIR: '/Applications/Xcode-preview.app/Contents/Developer' })
    }
  })

  Test('refuses a wrong-version occupied destination', async () => {
    const result = await setup({ installed: '/Applications/Xcode-27.1.app', installedVersion: '27.0', apply: true })
    Expect(result.code).toBe(1)
    Expect(result.receipt.remaining.join('\n')).toContain('Refusing to overwrite')
    Expect(result.calls.some(call => call.name.endsWith('/ditto') || call.name.endsWith('/xip'))).toBe(false)
  })

  Test('hands license and first-launch work to the user without accepting it', async () => {
    const result = await setup({ installed: '/Applications/Xcode.app', firstLaunch: true, apply: true })
    Expect(result.code).toBe(1)
    Expect(result.receipt.remaining.join('\n')).toContain("Xcode at '/Applications/Xcode.app' needs first-launch setup")
    Expect(
      result.calls.some(call =>
        call.name.includes('sudo') || call.spec.args?.includes('-license')
        || call.spec.args?.includes('-runFirstLaunch')
      ),
    ).toBe(false)
    Expect(result.calls.some(call => call.spec.args?.includes('-downloadPlatform'))).toBe(false)
  })

  Test('does not claim readiness for another runtime or a failed simulator service', async () => {
    const mismatch = await setup({ installed: '/Applications/Xcode.app', runtime: '27.0' })
    Expect(mismatch.code).toBe(1)
    Expect(mismatch.receipt.runtimeAvailable).toBe(false)
    const failed = await setup({ installed: '/Applications/Xcode.app', serviceFailure: true })
    Expect(failed.code).toBe(1)
    Expect(failed.receipt.remaining.join('\n')).toContain('CoreSimulatorService connection invalid')
  })

  Test('fails verification if the global default changes during inspection', async () => {
    const result = await setup({ installed: '/Applications/Xcode.app', defaultChanged: true })
    Expect(result.code).toBe(1)
    Expect(result.receipt.status).toBe('needs-action')
    Expect(result.receipt.remaining.join('\n')).toContain('Global Xcode selection changed')
  })

  Test('rejects versions and archive paths before invoking commands', async () => {
    await Expect(IosSetupCommand.run({ xcodeVersion: '../27', runtimeVersion: '27.1' })).rejects.toThrow(
      'numeric Xcode',
    )
    await Expect(IosSetupCommand.run({ xcodeVersion: '27.1', runtimeVersion: 'latest' })).rejects.toThrow(
      'numeric Xcode',
    )
    await Expect(IosSetupCommand.run({ xcodeVersion: '27.1', runtimeVersion: '27.1', archive: 'installer.sh' })).rejects
      .toThrow('local .xip')
  })

  Test('downloads the exact requested runtime and verifies inventory after import', async () => {
    const result = await setup({
      installed: '/Applications/Xcode.app',
      runtime: '27.0',
      afterImport: '27.1',
      apply: true,
    })
    Expect(result.code).toBe(0)
    const download = result.calls.find(call => call.spec.args?.includes('-downloadPlatform'))
    Expect(download?.spec.args?.slice(0, 5)).toEqual([
      '-downloadPlatform',
      'iOS',
      '-buildVersion',
      '27.1',
      '-exportPath',
    ])
    Expect(download?.spec.args?.[5]).toMatch(/^\/repo\/\.artifacts\/ios-setup\/27\.1-27\.1\/runtime-[a-f0-9-]+$/)
    Expect(download?.spec.args?.slice(6)).toEqual(['-architectureVariant', 'arm64'])
    Expect(download?.spec.env?.['DEVELOPER_DIR']).toBe('/Applications/Xcode.app/Contents/Developer')
    Expect(result.calls.filter(call => call.spec.args?.includes('runtimes')).length).toBe(2)
    const mismatch = await setup({ installed: '/Applications/Xcode.app', runtime: '27.0', apply: true })
    Expect(mismatch.code).toBe(1)
    Expect(mismatch.receipt.runtimeAvailable).toBe(false)
    const retryDownload = mismatch.calls.find(call => call.spec.args?.includes('-downloadPlatform'))
    Expect(retryDownload?.spec.args?.[5]).not.toBe(download?.spec.args?.[5])
  })

  Test('uses the universal runtime variant for Intel or Rosetta processes', async () => {
    const result = await setup({
      hostArch: 'x64',
      installed: '/Applications/Xcode.app',
      runtime: '27.0',
      afterImport: '27.1',
      apply: true,
    })
    Expect(result.code).toBe(0)
    Expect(result.calls.find(call => call.spec.args?.includes('-downloadPlatform'))?.spec.args?.slice(6)).toEqual([
      '-architectureVariant',
      'universal',
    ])
  })

  Test('guides a failed runtime download through Xcode and verifies the requested version', async () => {
    for (const runtime of ['27.1', '27.2']) {
      const result = await setup({
        installed: '/Applications/Xcode-27.1.app',
        runtime: '27.0',
        apply: true,
        json: false,
        interactive: true,
        runtimeDownloadError: 'iOS 27.1 is not available for download.',
        answers: [{ answer: '' }, { answer: '', installedRuntime: runtime }],
      })
      Expect(result.code).toBe(runtime === '27.1' ? 0 : 1)
      Expect(result.receipt.runtimeAvailable).toBe(runtime === '27.1')
      Expect(result.output).toContain('Settings > Components')
      Expect(result.output).toContain('Developer Documentation is a separate download')
      Expect(result.prompts.length).toBe(2)
      const open = result.calls.find(call => call.name === '/usr/bin/open')
      Expect(open?.spec.args).toEqual(['/Applications/Xcode-27.1.app'])
      Expect(result.events.indexOf('prompt')).toBeLessThan(result.events.indexOf('/usr/bin/open'))
      Expect(result.calls.filter(call => call.spec.args?.includes('runtimes')).length).toBe(2)
      Expect(result.calls.some(call => call.spec.args?.includes('-importPlatform'))).toBe(false)
    }
  })

  Test('keeps failed runtime downloads unattended or cancellable without importing an export', async () => {
    for (
      const mode of [{ json: true, interactive: true }, { json: false, interactive: false }, {
        json: false,
        interactive: true,
      }]
    ) {
      const result = await setup({
        installed: '/Applications/Xcode.app',
        runtime: '27.0',
        apply: true,
        ...mode,
        runtimeDownloadError: 'iOS 27.1 is not available for download.',
        answers: [{ answer: 'q' }],
      })
      Expect(result.code).toBe(1)
      Expect(result.receipt.remaining.join('\n')).toContain('iOS 27.1 is not available for download.')
      Expect(result.receipt.remaining.join('\n')).toContain('Settings > Components')
      Expect(result.prompts.length).toBe(!mode.json && mode.interactive ? 1 : 0)
      Expect(result.calls.some(call => call.name === '/usr/bin/open' || call.spec.args?.includes('-importPlatform')))
        .toBe(false)
    }
  })

  Test('validates extracted archive metadata before reserving an install destination', async () => {
    const wrong = await setup({
      archive: '/Downloads/Xcode.xip',
      archiveExists: true,
      archiveVersion: '27.0',
      apply: true,
    })
    Expect(wrong.code).toBe(1)
    Expect(wrong.receipt.remaining.join('\n')).toContain('Archive contains Xcode 27.0')
    Expect(wrong.calls.some(call => call.name.endsWith('/mkdir') || call.name.endsWith('/ditto'))).toBe(false)
    const valid = await setup({ archive: '/Downloads/Xcode.xip', archiveExists: true, apply: true })
    Expect(valid.code).toBe(0)
    const install = valid.calls.findIndex(call => call.name.endsWith('/ditto'))
    Expect(valid.calls[install - 1]?.name).toBe('/bin/mkdir')
    Expect(valid.calls[install - 1]?.spec.args?.[0]).toMatch(/^\/Applications\/\.tao-ios-setup-/)
    Expect(valid.calls[install]?.spec.args?.[1]).toMatch(
      /^\/Applications\/\.tao-ios-setup-[a-f0-9-]+\/Xcode-27\.1.app$/,
    )
    Expect(valid.calls.filter(call => call.name.endsWith('/codesign')).length).toBe(3)
    const publish = valid.calls.find(call => call.name.endsWith('/mv'))
    Expect(publish?.spec.args?.[0]).toBe('-n')
    Expect(publish?.spec.args?.[2]).toBe('/Applications/')
  })

  Test('rejects a symlink destination before extraction or installation', async () => {
    const result = await setup({
      targetSymlink: true,
      archive: '/Downloads/Xcode.xip',
      archiveExists: true,
      apply: true,
    })
    Expect(result.code).toBe(1)
    Expect(result.receipt.remaining.join('\n')).toContain('Refusing symbolic-link destination')
    Expect(result.calls.some(call => call.name.endsWith('/xip') || call.name.endsWith('/ditto'))).toBe(false)
  })

  Test('preserves an unset global default and distinguishes inspection failures', async () => {
    const unset = await setup({ installed: '/Applications/Xcode.app', defaultUnset: true })
    Expect(unset.code).toBe(0)
    Expect(unset.receipt.defaultDeveloperDirectory).toBe(null)
    const changed = await setup({ installed: '/Applications/Xcode.app', defaultUnset: true, defaultChanged: true })
    Expect(changed.code).toBe(1)
    Expect(changed.receipt.remaining.join('\n')).toContain('original was unset')
    const failed = await setup({ defaultError: 'Permission denied', apply: true })
    Expect(failed.code).toBe(1)
    Expect(failed.receipt.remaining.join('\n')).toContain('Cannot inspect the global Xcode selection')
    Expect(failed.calls.some(call => call.name.endsWith('/xip'))).toBe(false)
  })

  Test('requires valid device inventory and no service diagnostic', async () => {
    for (const deviceOutput of ['', '{', '{}', '{"devices":[]}', '{"devices":{"runtime":{}}}']) {
      const result = await setup({ installed: '/Applications/Xcode.app', deviceOutput })
      Expect(result.code).toBe(1)
      Expect(result.receipt.remaining.join('\n')).toMatch(/CoreSimulator returned (an )?invalid device/)
    }
    const diagnostic = await setup({
      installed: '/Applications/Xcode.app',
      deviceDiagnostic: 'CoreSimulatorService connection invalid',
    })
    Expect(diagnostic.code).toBe(1)
    Expect(diagnostic.receipt.remaining.join('\n')).toContain('CoreSimulatorService connection invalid')
  })

  Test('accepts a uniquely extracted beta app and refuses absent or ambiguous apps', async () => {
    const beta = await setup({
      archive: '/Downloads/Xcode.xip',
      archiveExists: true,
      extractedApps: ['Xcode-beta.app'],
      apply: true,
    })
    Expect(beta.code).toBe(0)
    Expect(beta.calls.find(call => call.name.endsWith('/ditto'))?.spec.args?.[0]).toContain('/Xcode-beta.app')
    for (const extractedApps of [[], ['Xcode.app', 'Xcode-beta.app']]) {
      const result = await setup({ archive: '/Downloads/Xcode.xip', archiveExists: true, extractedApps, apply: true })
      Expect(result.code).toBe(1)
      Expect(result.calls.some(call => call.name.endsWith('/ditto'))).toBe(false)
    }
  })

  Test('does not impose installation disk thresholds on an already-ready machine', async () => {
    const ready = await setup({ installed: '/Applications/Xcode.app', lowDisk: true, apply: true })
    Expect(ready.code).toBe(0)
    Expect(ready.calls.some(call => call.name.endsWith('/df'))).toBe(false)
    const pending = await setup({ installed: '/Applications/Xcode.app', runtime: '27.0', lowDisk: true, apply: true })
    Expect(pending.code).toBe(1)
    Expect(pending.receipt.remaining.join('\n')).toContain('Need at least 15 GiB')
  })

  Test('recovers after a partial copy while retaining the failed staging directory', async () => {
    const state: InstallState = { paths: new Set(), failCopyOnce: true }
    const first = await setup({
      archive: '/Downloads/Xcode.xip',
      archiveExists: true,
      installState: state,
      apply: true,
    })
    Expect(first.code).toBe(1)
    Expect(first.receipt.remaining.join('\n')).toContain('copy interrupted')
    Expect(state.installed).toBeUndefined()
    const failedCopy = first.calls.find(call => call.name.endsWith('/ditto'))?.spec.args?.[1]!
    Expect(state.paths.has(failedCopy)).toBe(true)
    Expect(
      first.receipt.ownedPaths.some(entry =>
        failedCopy.startsWith(`${entry.path}/`) && entry.path.startsWith('/Applications/')
      ),
    ).toBe(true)
    const second = await setup({
      archive: '/Downloads/Xcode.xip',
      archiveExists: true,
      installState: state,
      apply: true,
    })
    Expect(second.code).toBe(0)
    Expect(state.installed).toBe('/Applications/Xcode-27.1.app')
    Expect(state.paths.has(failedCopy)).toBe(true)
    Expect(second.calls.find(call => call.name.endsWith('/ditto'))?.spec.args?.[1]).not.toBe(failedCopy)
  })

  Test('does not treat a skipped non-overwriting publish as successful installation', async () => {
    const result = await setup({
      archive: '/Downloads/Xcode.xip',
      archiveExists: true,
      publishCollision: true,
      apply: true,
    })
    Expect(result.code).toBe(1)
    Expect(result.receipt.remaining.join('\n')).toContain('became occupied')
    Expect(result.receipt.selectedXcode).toBeUndefined()
    Expect(result.receipt.ownedPaths.some(entry => entry.path === '/Applications/Xcode-27.1.app')).toBe(false)
  })
})
