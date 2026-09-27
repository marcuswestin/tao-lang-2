import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import {
  type AppleSetupOptions,
  AppleSetupPlatforms,
  type AppleSetupReceipt,
  AppleToolchainSetup,
} from '../apple-setup/AppleToolchainSetup'

export type WatchOSSetupOptions = AppleSetupOptions & {
  project?: string
  physical?: boolean
  device?: string
}

type SetupFiles = Pick<typeof FS, 'readJson' | 'writeJson' | 'writeText' | 'exists' | 'listDir'>
type Dependencies = {
  prepare?: typeof AppleToolchainSetup.prepare
  files?: SetupFiles
  report?: (message: string) => void
}
type Receipt = {
  status: 'needs-action' | 'planned' | 'running'
  target: 'simulator' | 'physical-watch'
  project: string
  toolchain?: AppleSetupReceipt
  xcodeProject?: string
  device?: string
  processIdentifier?: number
  remaining: string[]
  log?: string
  receiptPath: string
}

/** Guide simulator setup and retain the exported project for manual physical-watch development. */
export const WatchosSetupCommand = {
  async run(options: WatchOSSetupOptions, dependencies: Dependencies = {}): Promise<number> {
    const receipt = await new SetupSession(options, dependencies).run()
    return receipt.status === 'needs-action' ? 1 : 0
  },
}

class SetupSession {
  private readonly root: string
  private readonly work: string
  private readonly files: SetupFiles
  private readonly execute: typeof CLI.run
  private readonly terminal: Pick<typeof HCI, 'isInteractive' | 'askText'>
  private readonly receipt: Receipt
  private app?: string

  constructor(private options: WatchOSSetupOptions, private dependencies: Dependencies) {
    this.root = options.repositoryRoot ?? Repo.getRoot()
    this.work = FS.resolvePath(`.artifacts/watchos-setup/runs/${Platform.randomUUID()}`, this.root)
    this.files = dependencies.files ?? FS
    this.execute = options.runCommand ?? CLI.run
    this.terminal = options.terminal ?? HCI
    this.receipt = {
      status: 'needs-action',
      target: options.physical ? 'physical-watch' : 'simulator',
      project: options.project ?? 'Apps/WatchHello',
      remaining: [],
      receiptPath: `${this.work}/receipt.json`,
    }
  }

  async run(): Promise<Receipt> {
    if (!this.options.physical && !this.options.runtimeVersion) {
      Errors.throwUserInput(
        'Simulator setup requires --runtime-version; use --physical for a watch paired to an iPhone.',
      )
    }
    if (this.options.physical && this.options.device) {
      Errors.throwUserInput('--device selects a simulator; choose the physical watch in Xcode Device Hub.')
    }
    try {
      this.notice('1/5 Inspecting Xcode and watchOS support; verifying its signature may take several minutes...')
      this.receipt.toolchain = await (this.dependencies.prepare ?? AppleToolchainSetup.prepare)(
        { ...this.options, runtimeVersion: this.options.physical ? undefined : this.options.runtimeVersion },
        AppleSetupPlatforms.watchos,
      )
      this.app = this.receipt.toolchain.selectedXcode
      if (this.receipt.toolchain.status !== 'ready' || !this.app) {
        this.receipt.remaining.push(...this.receipt.toolchain.remaining)
        return await this.finish()
      }
      this.notice(`Using ${this.app}; the global Xcode selection remains unchanged.`)
      if (this.options.apply) {
        this.notice("2/5 Exporting the Tao watch app's Xcode project...")
        await this.exportProject()
      } else {
        this.notice('2/5 With --apply, setup will export the Tao watch app before selecting a run destination.')
      }
      if (this.options.physical) {
        this.receipt.remaining.push(
          'Next: pair the companion iPhone with this Mac in Xcode > Open Developer Tool > Device Hub. Keep the iPhone and Apple Watch paired to each other, awake, and unlocked.',
          'Enable Developer Mode on both the iPhone and Apple Watch in Settings > Privacy & Security, restart each if prompted, and finish the trust prompts in Device Hub.',
          'In the generated TaoWatch target > Signing & Capabilities, select your Apple development team, turn on automatic signing, and replace the preview bundle identifier with your own unique reverse-DNS identifier.',
          'Select the paired Apple Watch as the TaoWatch scheme destination in Xcode and click Run. Physical-watch signing, installation, and visual behavior require confirmation on the devices.',
        )
        return await this.finish()
      }
      this.notice('3/5 Finding an available Apple Watch simulator...')
      const device = await this.simulator()
      if (!device) {
        return await this.finish()
      }
      this.receipt.device = device.udid
      if (!this.options.apply) {
        this.receipt.status = 'planned'
        this.receipt.remaining.push('Rerun with --apply to export, build, install, and launch on this simulator.')
        return await this.finish()
      }
      this.notice('4/5 Building the watch app; full Xcode output is retained in the run directory...')
      const artifact = await this.build(device.udid)
      this.notice('5/5 Installing and launching the app on the simulator...')
      await this.installAndLaunch(device, artifact)
      this.receipt.status = 'running'
      this.notice(
        `Launch returned process ${this.receipt.processIdentifier}. Inspect the watch app in Simulator to confirm its appearance and controls.`,
      )
    } catch (error) {
      this.receipt.remaining.push(Errors.asError(error).message)
    }
    return await this.finish()
  }

  private notice(message: string): void {
    if (this.options.json) {
      HCI.writeErrorLine(message)
    } else {
      ;(this.dependencies.report ?? HCI.writeLine)(message)
    }
  }

  private async command(command: string, args: string[], log?: string): Promise<CLI.CommandResult> {
    const result = await this.execute(command, {
      args,
      cwd: this.root,
      env: { DEVELOPER_DIR: this.app ? `${this.app}/Contents/Developer` : undefined },
    })
    if (log) {
      this.receipt.log = `${this.work}/${log}.log`
      await this.files.writeText(this.receipt.log, `${result.stdout}\n${result.stderr}\n${result.error?.message ?? ''}`)
    }
    if (result.exitCode !== 0 || result.error) {
      Errors.throwHostEnvironment(
        `${command} ${args.slice(0, 3).join(' ')} failed: ${
          (result.stderr || result.stdout || result.error?.message || 'no diagnostic').trim().slice(-1200)
        }${log ? `\nFull log: ${this.receipt.log}` : ''}`,
      )
    }
    return result
  }

  private async exportProject(): Promise<void> {
    const output = `${this.work}/exports`
    await this.command('./tao', ['build', this.receipt.project, '--watchos', '--output', output], 'export')
    const records = await this.files.listDir(output)
    if (records.length !== 1) {
      Errors.throwHostEnvironment(`Expected exactly one retained build under ${output}.`)
    }
    const record = await this.files.readJson<{ results?: { watchos?: { status?: string; artifact?: string } } }>(
      `${output}/${records[0]}/build.json`,
    )
    const result = record.results?.watchos
    if (
      result?.status !== 'succeeded' || !result.artifact?.endsWith('.xcodeproj')
      || !FS.pathIsWithin(result.artifact, output) || !await this.files.exists(result.artifact)
    ) {
      Errors.throwHostEnvironment(`The export did not retain a successful watchOS Xcode project; inspect ${output}.`)
    }
    this.receipt.xcodeProject = result.artifact
    this.notice(
      `Xcode project generated: ${result.artifact}. Open it in Xcode with File > Open and select the TaoWatch scheme. It remains available if setup stops here.`,
    )
  }

  private async simulator(): Promise<{ udid: string; state?: string } | undefined> {
    while (true) {
      const runtimes = JSON.parse(
        (await this.command('/usr/bin/xcrun', ['simctl', 'list', 'runtimes', '--json'])).stdout,
      ) as {
        runtimes?: { identifier?: string; version?: string; isAvailable?: boolean }[]
      }
      const runtime = runtimes.runtimes?.find(item =>
        item.identifier?.startsWith(AppleSetupPlatforms.watchos.runtimePrefix)
        && item.version && AppleToolchainSetup.matchesVersion(item.version, this.options.runtimeVersion!)
        && item.isAvailable === true
      )
      const inventory = JSON.parse(
        (await this.command('/usr/bin/xcrun', ['simctl', 'list', 'devices', '--json'])).stdout,
      ) as {
        devices?: Record<string, {
          udid?: string
          name?: string
          state?: string
          deviceTypeIdentifier?: string
          isAvailable?: boolean
        }[]>
      }
      const candidates = (runtime?.identifier && inventory.devices?.[runtime.identifier] || []).filter(item =>
        item.isAvailable === true && item.deviceTypeIdentifier?.includes('Apple-Watch') && typeof item.udid === 'string'
      )
      const selected = this.options.device
        ? candidates.find(item => item.udid === this.options.device)
        : candidates.length === 1
        ? candidates[0]
        : undefined
      if (selected?.udid) {
        this.notice(`Selected ${selected.name} (${selected.udid}), watchOS ${this.options.runtimeVersion}.`)
        return { udid: selected.udid, state: selected.state }
      }
      const available = candidates.map(item => `${item.name}: ${item.udid}`).join(', ')
      const guidance = candidates.length === 0
        ? `No Apple Watch simulator is available for watchOS ${this.options.runtimeVersion}. In Xcode > Open Developer Tool > Device Hub, create an Apple Watch simulator with that runtime, then return here.`
        : `Select an Apple Watch simulator with --device <UUID>. Available: ${available}.`
      this.receipt.remaining.push(guidance)
      if (!this.options.apply || this.options.json || !this.terminal.isInteractive()) {
        return undefined
      }
      this.notice(guidance)
      const answer = await this.terminal.askText({
        message: candidates.length > 1
          ? 'Enter one listed simulator UUID to continue, or q to stop'
          : 'After creating the simulator, press Enter to recheck, or q to stop',
      })
      if (['q', 'quit'].includes(answer.trim().toLowerCase())) {
        return undefined
      }
      if (candidates.length > 1 && answer.trim()) {
        this.options.device = answer.trim()
      }
      this.receipt.remaining.pop()
      // A prompt response only triggers discovery; it never establishes simulator readiness.
    }
  }

  private async build(device: string): Promise<string> {
    const project = this.receipt.xcodeProject
    if (!project) {
      Errors.throwUnexpected('Expected an exported watchOS Xcode project before building.')
    }
    const derived = `${this.work}/DerivedData`
    await this.command('/usr/bin/xcodebuild', [
      '-project',
      project,
      '-scheme',
      'TaoWatch',
      '-configuration',
      'Debug',
      '-sdk',
      'watchsimulator',
      '-destination',
      `platform=watchOS Simulator,id=${device}`,
      '-derivedDataPath',
      derived,
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ], 'build')
    const artifact = `${derived}/Build/Products/Debug-watchsimulator/TaoWatch.app`
    if (!await this.files.exists(artifact)) {
      Errors.throwHostEnvironment(`Xcode reported success without an app at ${artifact}.`)
    }
    return artifact
  }

  private async installAndLaunch(device: { udid: string; state?: string }, artifact: string): Promise<void> {
    const bundle = (await this.command('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleIdentifier',
      `${artifact}/Info.plist`,
    ])).stdout.trim()
    if (!bundle) {
      Errors.throwHostEnvironment(`Built watch app at ${artifact} has no bundle identifier.`)
    }
    if (device.state !== 'Booted') {
      await this.command('/usr/bin/xcrun', ['simctl', 'boot', device.udid])
    }
    await this.command('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'])
    await this.command('/usr/bin/xcrun', ['simctl', 'install', device.udid, artifact], 'install')
    const container = await this.command('/usr/bin/xcrun', ['simctl', 'get_app_container', device.udid, bundle, 'app'])
    if (!container.stdout.trim()) {
      Errors.throwHostEnvironment('Simulator did not report the installed watch app container.')
    }
    const launched = await this.command('/usr/bin/xcrun', ['simctl', 'launch', device.udid, bundle], 'launch')
    const pid = Number(launched.stdout.trim().match(/: (\d+)$/)?.[1])
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      Errors.throwHostEnvironment('Simulator launch did not report a positive process ID.')
    }
    this.receipt.processIdentifier = pid
  }

  private async finish(): Promise<Receipt> {
    if (this.receipt.toolchain && this.receipt.toolchain.defaultDeveloperDirectory !== undefined) {
      const checked = await this.execute('/usr/bin/xcode-select', {
        args: ['-p'],
        cwd: this.root,
        env: { DEVELOPER_DIR: undefined },
      })
      const actual = checked.exitCode === 0 && !checked.error
        ? checked.stdout.trim()
        : checked.stderr.includes('unable to get active developer directory')
        ? null
        : undefined
      if (actual !== this.receipt.toolchain.defaultDeveloperDirectory) {
        this.receipt.status = 'needs-action'
        this.receipt.remaining.push(
          'The global Xcode selection changed or could not be verified. Review xcode-select -p; this setup never changes it.',
        )
      }
    }
    if (this.options.apply) {
      await this.files.writeJson(this.receipt.receiptPath, this.receipt)
    }
    if (this.options.json) {
      ;(this.dependencies.report ?? HCI.writeLine)(JSON.stringify(this.receipt))
    } else {
      this.notice(`watchOS setup: ${this.receipt.status}.`)
      for (const item of this.receipt.remaining) {
        this.notice(item)
      }
      if (this.options.apply) {
        this.notice(`Progress: ${this.receipt.receiptPath}. Rerun the same command to recheck and continue.`)
      }
    }
    return this.receipt
  }
}
