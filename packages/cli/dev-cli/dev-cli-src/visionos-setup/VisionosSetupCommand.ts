import { Assert, CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import {
  type AppleSetupOptions,
  AppleSetupPlatforms,
  type AppleSetupReceipt,
  AppleToolchainSetup,
} from '../apple-setup/AppleToolchainSetup'
import { developerModeEnabled, object, type VisionOSDevice, visionOSDevices } from './VisionOSDevices'

type SetupFiles = Pick<typeof FS, 'readJson' | 'writeJson' | 'writeText' | 'exists' | 'listDir'>
export type VisionOSSetupOptions = AppleSetupOptions & {
  project?: string
  simulator?: boolean
  device?: string
  team?: string
  bundleId?: string
}
type Dependencies = {
  files?: SetupFiles
  prepare?: typeof AppleToolchainSetup.prepare
  report?: (message: string) => void
}
type Step = { name: string; status: 'ready' | 'needs-action' | 'planned'; detail: string }
type TargetDevice = { id: string; destinationId: string }
type Receipt = {
  status: 'needs-action' | 'planned' | 'running'
  target: 'headset' | 'simulator'
  project: string
  toolchain?: AppleSetupReceipt
  steps: Step[]
  remaining: string[]
  device?: string
  bundleId?: string
  processIdentifier?: number
  xcodeProject?: string
  log?: string
  receiptPath: string
}

const PAIR = [
  'Next: pair your Vision Pro with this Mac. Opening Xcode alone does not start pairing.',
  '1. Connect the Mac and headset to the same Wi-Fi network with IPv6 enabled; keep the headset awake and unlocked.',
  '2. On the headset, open Settings > General > Remote Devices and leave it open.',
  '3. On the Mac, choose Xcode > Open Developer Tool > Device Hub > + > Pair Nearby Device.',
  '4. Select your Vision Pro and complete the pairing code and trust prompts on both devices.',
].join('\n')
const DEVELOPER = [
  'Next: enable Developer Mode on your paired Vision Pro.',
  '1. On the headset, open Settings > Privacy & Security > Developer Mode and turn it on.',
  '2. Restart when prompted, then confirm enabling Developer Mode after the restart.',
  '3. Unlock the headset and reconnect it in Device Hub. If Developer Mode is missing, complete pairing first.',
  'Setup will recheck Developer Mode; an unknown status does not permit installation.',
].join('\n')
const TEAM = /^[A-Z0-9]{10}$/
const BUNDLE = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/

/** Guided native visionOS setup. Every invocation discovers current state; receipts are evidence, never readiness inputs. */
export const VisionosSetupCommand = {
  async run(options: VisionOSSetupOptions, dependencies: Dependencies = {}): Promise<number> {
    const receipt = await new SetupSession(options, dependencies).run()
    return receipt.status === 'needs-action' ? 1 : 0
  },
}

class SetupSession {
  private readonly files: SetupFiles
  private readonly root: string
  private readonly work: string
  private readonly receipt: Receipt
  private readonly execute: typeof CLI.run
  private readonly terminal: Pick<typeof HCI, 'askText' | 'isInteractive'>
  private app?: string
  private queryNumber = 0

  constructor(private options: VisionOSSetupOptions, private dependencies: Dependencies) {
    this.files = dependencies.files ?? FS
    this.root = options.repositoryRoot ?? Repo.getRoot()
    this.work = FS.resolvePath(`.artifacts/visionos-setup/runs/${Platform.randomUUID()}`, this.root)
    this.receipt = {
      status: 'needs-action',
      target: options.simulator ? 'simulator' : 'headset',
      project: options.project ?? 'Apps/VisionHello',
      steps: [],
      remaining: [],
      receiptPath: `${this.work}/receipt.json`,
    }
    this.execute = options.runCommand ?? CLI.run
    this.terminal = options.terminal ?? HCI
  }

  async run(): Promise<Receipt> {
    if (this.options.simulator && !this.options.runtimeVersion) {
      Errors.throwUserInput('--simulator requires --runtime-version.')
    }
    if (this.options.team && !TEAM.test(this.options.team)) {
      Errors.throwUserInput('--team must be a 10-character uppercase Apple development team ID.')
    }
    if (this.options.bundleId && !this.validBundle(this.options.bundleId)) {
      Errors.throwUserInput('--bundle-id must be your own reverse-DNS identifier, not the preview app identifier.')
    }
    try {
      const inspecting = '1/6 Inspecting Xcode and verifying its signature... This can take several minutes.'
      if (this.options.json) {
        HCI.writeErrorLine(inspecting)
      } else {
        this.notice(inspecting)
      }
      this.receipt.toolchain = await (this.dependencies.prepare ?? AppleToolchainSetup.prepare)(
        { ...this.options, runtimeVersion: this.options.simulator ? this.options.runtimeVersion : undefined },
        AppleSetupPlatforms.visionos,
      )
      this.app = this.receipt.toolchain.selectedXcode
      if (this.receipt.toolchain.status !== 'ready' || !this.app) {
        this.receipt.remaining.push(...this.receipt.toolchain.remaining)
        return await this.finish()
      }
      this.step('toolchain', 'ready', `Using ${this.app}; the global Xcode selection is preserved.`)
      if (this.options.apply) {
        this.notice("2/6 Generating the Tao app's Xcode project before device setup...")
        await this.exportProject()
      } else {
        this.step(
          'export',
          'planned',
          'With --apply, setup first generates an Xcode project usable on a simulator or paired headset, then checks the selected destination.',
        )
      }
      this.notice(`3/6 Inspecting ${this.receipt.target} availability...`)
      const device = this.options.simulator ? await this.simulator() : await this.headset()
      if (!device) {
        return await this.finish()
      }
      this.receipt.device = device.id
      this.notice('4/6 Checking app identity and signing inputs...')
      const identity = await this.identity()
      if (!identity) {
        return await this.finish()
      }
      this.receipt.bundleId = identity.bundleId
      if (!this.options.apply) {
        this.receipt.status = 'planned'
        this.step(
          'build-install-launch',
          'planned',
          'Rerun with --apply to export, build, install, and launch. Current readiness will be checked again.',
        )
        return await this.finish()
      }
      this.notice('5/6 Building the Tao app; full command output is retained in this run directory...')
      const artifact = await this.build(device.destinationId, identity)
      this.notice('6/6 Installing and launching the app...')
      await this.installAndLaunch(device.id, identity.bundleId, artifact)
      this.receipt.status = 'running'
      this.step(
        'launch',
        'ready',
        `Launch returned process ${this.receipt.processIdentifier}. Inspect the app in ${
          this.receipt.target === 'headset' ? 'your headset' : 'Simulator'
        } to confirm visual behavior.`,
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

  private step(name: string, status: Step['status'], detail: string): void {
    this.receipt.steps.push({ name, status, detail })
    this.notice(detail)
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

  private async jsonCommand(args: string[]): Promise<Record<string, unknown>> {
    // A fresh name per probe prevents a failed invocation from consuming stale successful JSON.
    const path = `${this.work}/device-query-${++this.queryNumber}.json`
    await this.files.writeJson(`${this.work}/query-directory.json`, { purpose: 'Device query output directory' })
    await this.command('/usr/bin/xcrun', ['devicectl', ...args, '--json-output', path])
    const payload = object(await this.files.readJson(path))
    if (object(payload['info'])['outcome'] !== 'success' || !payload['result']) {
      Errors.throwHostEnvironment(`Device inspection returned no successful result. Inspect ${path}.`)
    }
    return object(payload['result'])
  }

  private async retry(instruction: string): Promise<boolean> {
    this.notice(instruction)
    if (this.options.apply && !this.options.json && this.terminal.isInteractive()) {
      while (true) {
        const answer = await this.terminal.askText({
          message: 'Complete the step, then press Enter to check again; q to save progress and quit',
        })
        if (answer.trim() === '') {
          return true
        }
        if (['q', 'quit'].includes(answer.trim().toLowerCase())) {
          break
        }
        this.notice('Press Enter to recheck, or q to quit.')
      }
    }
    this.receipt.remaining.push(instruction)
    return false
  }

  private async headset(): Promise<TargetDevice | undefined> {
    while (true) {
      const result = await this.jsonCommand(['list', 'devices'])
      if (!Array.isArray(result['devices'])) {
        Errors.throwHostEnvironment('Device listing did not contain a devices array.')
      }
      const candidates = visionOSDevices(result['devices'])
      let device: VisionOSDevice | undefined = this.options.device
        ? candidates.find(item => item.id === this.options.device)
        : candidates.length === 1
        ? candidates[0]
        : undefined
      if (!device) {
        if (
          candidates.length > 1 && !this.options.device && this.options.apply && !this.options.json
          && this.terminal.isInteractive()
        ) {
          const selection = await this.terminal.askText({
            message: `Select a headset by identifier (${
              candidates.map(item => `${item.name}: ${item.id}`).join(', ')
            }); q to quit`,
          })
          if (['q', 'quit'].includes(selection.trim().toLowerCase())) {
            this.receipt.remaining.push('Select a headset with --device <identifier>.')
            return undefined
          }
          if (candidates.some(item => item.id === selection.trim())) {
            this.options.device = selection.trim()
          } else {
            this.notice('That identifier is not in the current headset list. Select one of the listed identifiers.')
          }
          continue
        }
        if (
          await this.retry(`${PAIR}${
            candidates.length > 1
              ? ` Multiple headsets found; pass --device with one of: ${candidates.map(item => item.id).join(', ')}.`
              : ''
          }`)
        ) {
          continue
        }
        return undefined
      }
      if (!device.connected || !device.paired) {
        if (await this.retry(`${PAIR} ${device.name} is not both connected and paired.`)) {
          continue
        }
        return undefined
      }
      const details = await this.jsonCommand(['device', 'info', 'details', '--device', device.id])
      device = { ...device, developerMode: developerModeEnabled(details) }
      if (!device.developerMode) {
        if (await this.retry(DEVELOPER)) {
          continue
        }
        return undefined
      }
      this.step('headset', 'ready', `${device.name} is physically connected, paired, and has Developer Mode enabled.`)
      return { id: device.id, destinationId: device.udid }
    }
  }

  private async simulator(): Promise<TargetDevice | undefined> {
    while (true) {
      const runtimeResult = await this.command('/usr/bin/xcrun', ['simctl', 'list', 'runtimes', '--json'])
      const runtimes = object(JSON.parse(runtimeResult.stdout))['runtimes']
      const runtime = Array.isArray(runtimes)
        ? runtimes.map(object).find(item =>
          item['isAvailable'] === true && typeof item['version'] === 'string'
          && AppleToolchainSetup.matchesVersion(item['version'], this.options.runtimeVersion!)
          && typeof item['identifier'] === 'string' && /SimRuntime\.(xrOS|visionOS)-/.test(item['identifier'])
        )
        : undefined
      const listed = await this.command('/usr/bin/xcrun', ['simctl', 'list', 'devices', '--json'])
      const devices = object(object(JSON.parse(listed.stdout))['devices'])
      const available = runtime ? devices[String(runtime['identifier'])] : undefined
      const candidates = Array.isArray(available)
        ? available.map(object).filter(item =>
          item['isAvailable'] === true
          && typeof item['deviceTypeIdentifier'] === 'string'
          && item['deviceTypeIdentifier'].includes('Apple-Vision-Pro')
          && typeof item['udid'] === 'string'
          && (!this.options.device || item['udid'] === this.options.device)
        )
        : []
      if (candidates.length !== 1) {
        if (candidates.length > 1 && this.options.apply && !this.options.json && this.terminal.isInteractive()) {
          const selection = await this.terminal.askText({
            message: `Select a simulator identifier (${
              candidates.map(item => `${item['name']}: ${item['udid']}`).join(', ')
            }); q to quit`,
          })
          if (['q', 'quit'].includes(selection.trim().toLowerCase())) {
            this.receipt.remaining.push('Select a simulator with --device <identifier>.')
            return undefined
          }
          if (candidates.some(item => item['udid'] === selection.trim())) {
            this.options.device = selection.trim()
          } else {
            this.notice('That identifier is not in the current simulator list. Select one of the listed identifiers.')
          }
          continue
        }
        if (
          await this.retry(
            `Next: set up the optional simulator; headset pairing and a signing team are not needed.\n1. In Xcode > Settings > Components, install visionOS ${this.options.runtimeVersion} Simulator if it is missing.\n2. Open Xcode > Open Developer Tool > Device Hub and create or select an Apple Vision Pro simulator using that runtime.\n3. In the generated project, choose the TaoApp scheme and that simulator as the run destination, then Run. ${
              candidates.length > 1
                ? `Pass --device with one identifier: ${candidates.map(item => item['udid']).join(', ')}.`
                : ''
            }`,
          )
        ) {
          continue
        }
        return undefined
      }
      const selected = candidates[0]!
      if (this.options.apply) {
        if (selected['state'] !== 'Booted') {
          await this.command('/usr/bin/xcrun', ['simctl', 'boot', String(selected['udid'])])
        }
        await this.command('/usr/bin/xcrun', ['simctl', 'bootstatus', String(selected['udid']), '-b'])
      }
      this.step(
        'simulator',
        'ready',
        `Selected ${selected['name']} (${selected['udid']}), visionOS ${this.options.runtimeVersion}.`,
      )
      return { id: String(selected['udid']), destinationId: String(selected['udid']) }
    }
  }

  private validBundle(value: string): boolean {
    return BUNDLE.test(value) && !value.startsWith('com.devtao.preview.')
      && !['dev.tao.preview', 'com.tao.preview', 'com.example.taoapp'].includes(value)
  }

  private async identity(): Promise<{ bundleId: string; team?: string } | undefined> {
    let bundleId = this.options.bundleId
    let team = this.options.team
    if (this.options.apply && !this.options.json && this.terminal.isInteractive()) {
      while (!bundleId) {
        const answer = await this.terminal.askText({
          message: 'Enter your own app bundle ID (for example com.yourcompany.visionhello), or q to quit',
        })
        if (['q', 'quit'].includes(answer.trim().toLowerCase())) {
          break
        }
        if (this.validBundle(answer.trim())) {
          bundleId = answer.trim()
        } else {
          this.notice('Use your own reverse-DNS bundle ID; the preview identifier cannot be signed for your team.')
        }
      }
      while (bundleId && !team && !this.options.simulator) {
        const answer = await this.terminal.askText({
          message:
            'In Xcode > Settings > Apple Accounts, sign in to your Apple developer account. Enter its 10-character development team ID, or q to quit',
        })
        if (['q', 'quit'].includes(answer.trim().toLowerCase())) {
          break
        }
        if (TEAM.test(answer.trim())) {
          team = answer.trim()
        } else {
          this.notice('A development team ID has exactly 10 uppercase letters or digits.')
        }
      }
    }
    if (!bundleId || (!team && !this.options.simulator)) {
      this.receipt.remaining.push(
        'Supply your own --bundle-id and, for a headset, --team; Xcode must have your developer account signed in and signing credentials available.',
      )
      return undefined
    }
    this.step(
      'identity',
      'ready',
      `Using ${bundleId}${team ? ` with team ${team}; Xcode will verify signing during build` : ''}.`,
    )
    return { bundleId, team }
  }

  private async exportProject(): Promise<void> {
    const output = `${this.work}/exports`
    await this.command('./tao', ['build', this.receipt.project, '--visionos', '--output', output], 'export')
    const records = await this.files.listDir(output)
    if (records.length !== 1) {
      Errors.throwHostEnvironment(`Expected exactly one retained build under ${output}.`)
    }
    const record = object(await this.files.readJson(`${output}/${records[0]}/build.json`))
    const vision = object(object(record['results'])['visionos'])
    if (
      vision['status'] !== 'succeeded' || typeof vision['artifact'] !== 'string'
      || !vision['artifact'].endsWith('.xcodeproj')
      || !FS.pathIsWithin(vision['artifact'], output) || !await this.files.exists(vision['artifact'])
    ) {
      Errors.throwHostEnvironment(`The export did not retain a successful visionOS Xcode project; inspect ${output}.`)
    }
    this.receipt.xcodeProject = vision['artifact']
    this.step(
      'export',
      'ready',
      [
        `Xcode project generated: ${this.receipt.xcodeProject}`,
        'You can use this project on a simulator or a physical Vision Pro. It remains available if you quit setup.',
        `1. In ${this.app}, choose File > Open and select the project path above.`,
        '2. For Simulator: choose the TaoApp scheme and an Apple Vision Pro simulator as the run destination, then click Run. Install the visionOS Simulator runtime in Xcode > Settings > Components if needed; no team is required.',
        '3. For a headset: pair it in Device Hub and enable Developer Mode using the next instructions. In the TaoApp target > Signing & Capabilities, enable Automatically manage signing, select your Team, and choose your own unique bundle identifier. If your team is missing, sign in under Xcode > Settings > Apple Accounts.',
        '4. Select the paired Vision Pro as the run destination, keep it awake and unlocked, then click Run. Check the app window and controls in the headset.',
        `Setup will now continue with the ${this.receipt.target} workflow.`,
      ].join('\n'),
    )
  }

  private async build(device: string, identity: { bundleId: string; team?: string }): Promise<string> {
    Assert.defined(this.receipt.xcodeProject, 'Expected an exported Xcode project before native build.')
    const derived = `${this.work}/DerivedData`
    await this.command('/usr/bin/xcodebuild', [
      '-project',
      this.receipt.xcodeProject,
      '-scheme',
      'TaoApp',
      '-configuration',
      'Debug',
      '-sdk',
      this.options.simulator ? 'xrsimulator' : 'xros',
      '-destination',
      `platform=${this.options.simulator ? 'visionOS Simulator' : 'visionOS'},id=${device}`,
      '-derivedDataPath',
      derived,
      `PRODUCT_BUNDLE_IDENTIFIER=${identity.bundleId}`,
      ...(this.options.simulator
        ? ['CODE_SIGNING_ALLOWED=NO']
        : [`DEVELOPMENT_TEAM=${identity.team}`, 'CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates']),
      'build',
    ], 'build')
    const artifact = `${derived}/Build/Products/Debug-${this.options.simulator ? 'xrsimulator' : 'xros'}/TaoApp.app`
    if (!await this.files.exists(artifact)) {
      Errors.throwHostEnvironment(`Build returned success without an app at ${artifact}.`)
    }
    this.step('build', 'ready', `Built ${artifact}.`)
    return artifact
  }

  private async installAndLaunch(device: string, bundle: string, app: string): Promise<void> {
    if (this.options.simulator) {
      await this.command('/usr/bin/xcrun', ['simctl', 'install', device, app], 'install')
      const container = await this.command('/usr/bin/xcrun', ['simctl', 'get_app_container', device, bundle, 'app'])
      if (!container.stdout.trim()) {
        Errors.throwHostEnvironment('Simulator did not report the installed app container.')
      }
      const launched = await this.command('/usr/bin/xcrun', ['simctl', 'launch', device, bundle], 'launch')
      const pid = Number(launched.stdout.trim().match(/: (\d+)$/)?.[1])
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        Errors.throwHostEnvironment('Simulator launch did not report a positive process ID.')
      }
      this.receipt.processIdentifier = pid
      return
    }
    await this.jsonCommand(['device', 'install', 'app', '--device', device, app])
    const installed = await this.jsonCommand(['device', 'info', 'apps', '--device', device])
    if (
      !Array.isArray(installed['apps']) || !installed['apps'].some(item => object(item)['bundleIdentifier'] === bundle)
    ) {
      Errors.throwHostEnvironment(`The headset did not report installed app ${bundle}.`)
    }
    const launched = await this.jsonCommand(['device', 'process', 'launch', '--device', device, bundle])
    const pid = object(launched['process'])['processIdentifier']
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
      Errors.throwHostEnvironment('Headset launch did not report a positive process ID.')
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
          'The global Xcode selection changed or could not be verified during setup. Review xcode-select -p; this command never changes it.',
        )
      }
    }
    if (this.options.apply) {
      await this.files.writeJson(this.receipt.receiptPath, this.receipt)
    }
    if (this.options.json) {
      ;(this.dependencies.report ?? HCI.writeLine)(JSON.stringify(this.receipt))
    } else {
      this.notice(`visionOS setup: ${this.receipt.status}.`)
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
