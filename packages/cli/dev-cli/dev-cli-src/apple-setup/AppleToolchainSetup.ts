import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

export type AppleSetupOptions = {
  xcodeVersion: string
  runtimeVersion?: string
  archive?: string
  apply?: boolean
  json?: boolean
  repositoryRoot?: string
  hostPlatform?: string
  hostArch?: string
  runCommand?: typeof CLI.run
  terminal?: Pick<typeof HCI, 'isInteractive' | 'askText'>
  files?: Pick<typeof FS, 'exists' | 'homeDir' | 'isFile' | 'isSymbolicLink' | 'listDir' | 'mkdir' | 'writeJson'>
}

export type AppleSetupReceipt = {
  requested: { xcodeVersion: string; runtimeVersion?: string }
  mode: 'apply' | 'plan'
  status: 'needs-action' | 'ready'
  defaultDeveloperDirectory?: string | null
  selectedXcode?: string
  selectedArchive?: string
  macOS?: string
  sdk?: string
  deviceSdk?: string
  xcodeBuild?: string
  runtimeAvailable: boolean
  simulatorHealthy: boolean
  remaining: string[]
  ownedPaths: { path: string; purpose: string; cleanup: string }[]
}

type AppleSetupPlatform = {
  command: string
  label: string
  directory: string
  simulatorSdk: string
  runtimePrefix: string
  deviceSdk?: string
}

export const AppleSetupPlatforms = {
  ios: {
    command: 'setup-ios',
    label: 'iOS',
    directory: 'ios-setup',
    simulatorSdk: 'iphonesimulator',
    runtimePrefix: 'com.apple.CoreSimulator.SimRuntime.iOS-',
  },
  visionos: {
    command: 'setup-visionos',
    label: 'visionOS',
    directory: 'visionos-setup',
    simulatorSdk: 'xrsimulator',
    runtimePrefix: 'com.apple.CoreSimulator.SimRuntime.xrOS-',
    deviceSdk: 'xros',
  },
  watchos: {
    command: 'setup-watchos',
    label: 'watchOS',
    directory: 'watchos-setup',
    simulatorSdk: 'watchsimulator',
    runtimePrefix: 'com.apple.CoreSimulator.SimRuntime.watchOS-',
    deviceSdk: 'watchos',
  },
} satisfies Record<string, AppleSetupPlatform>

const APPLE_DOWNLOADS = 'https://developer.apple.com/download/applications/'
const VERSION = /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/
// Apple's Xcode distribution identities: Mac App Store or Apple's Developer ID team.
const XCODE_REQUIREMENT = '=(anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.9]'
  + ' or anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6]'
  + ' and certificate leaf[field.1.2.840.113635.100.6.1.13]'
  + ' and certificate leaf[subject.OU] = "59GAB85EFG") and identifier "com.apple.dt.Xcode"'

function matchesVersion(actual: string, requested: string): boolean {
  const normalize = (value: string) => value.replace(/(?:\.0)+$/, '')
  return normalize(actual) === normalize(requested)
}

function atLeast(actual: string, minimum: string): boolean {
  const a = actual.split('.').map(Number)
  const b = minimum.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) > (b[i] ?? 0)
    }
  }
  return true
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Installs only explicitly requested Apple components; every rerun inspects the host anew. */
async function prepare(options: AppleSetupOptions, platform: AppleSetupPlatform): Promise<AppleSetupReceipt> {
  if (
    !VERSION.test(options.xcodeVersion)
    || (options.runtimeVersion !== undefined && !VERSION.test(options.runtimeVersion))
  ) {
    Errors.throwUserInput(`Specify numeric Xcode and ${platform.label} versions, for example 27.1 and 27.1.`)
  }
  if (options.archive && (!options.archive.endsWith('.xip') || /[\x00-\x1f]/.test(options.archive))) {
    Errors.throwUserInput('The Xcode archive must be a local .xip file.')
  }
  const files = options.files ?? FS
  const execute = options.runCommand ?? CLI.run
  const terminal = options.terminal ?? HCI
  const root = options.repositoryRoot ?? Repo.getRoot()
  const target = `/Applications/Xcode-${options.xcodeVersion}.app`
  const work = FS.resolvePath(
    `.artifacts/${platform.directory}/${options.xcodeVersion}-${options.runtimeVersion ?? 'device'}`,
    root,
  )
  const runId = Platform.randomUUID()
  let verificationFailed = false
  const receipt: AppleSetupReceipt = {
    requested: { xcodeVersion: options.xcodeVersion, runtimeVersion: options.runtimeVersion },
    mode: options.apply ? 'apply' : 'plan',
    status: 'needs-action',
    runtimeAvailable: false,
    simulatorHealthy: false,
    remaining: [],
    ownedPaths: [],
  }
  const command = (name: string, args: string[], app?: string, cwd = root) =>
    execute(name, {
      args,
      cwd,
      // An explicit undefined also removes an inherited override in Platform.spawn.
      env: { DEVELOPER_DIR: app ? `${app}/Contents/Developer` : undefined },
    })
  const requireSuccess = async (name: string, args: string[], app?: string, cwd?: string) => {
    const result = await command(name, args, app, cwd)
    if (result.exitCode !== 0 || result.error) {
      Errors.throwHostEnvironment(
        `${name} failed: ${(result.stderr || result.stdout || result.error?.message || 'no diagnostic').trim()}`,
      )
    }
    return result.stdout.trim()
  }
  const plist = async (app: string, key: string) =>
    await requireSuccess('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, `${app}/Contents/Info.plist`])
  const defaultSelection = async (): Promise<string | null> => {
    const result = await command('/usr/bin/xcode-select', ['-p'])
    if (result.exitCode === 0 && !result.error && result.stdout.trim()) {
      return result.stdout.trim()
    }
    if (!result.error && result.exitCode !== 0 && result.stderr.includes('unable to get active developer directory')) {
      return null
    }
    Errors.throwHostEnvironment(
      `Cannot inspect the global Xcode selection: ${
        result.stderr || result.stdout || result.error?.message || 'no diagnostic'
      }`,
    )
  }
  const signed = async (app: string) => {
    const verify = async (name: string, args: string[], stage: string) => {
      const result = await command(name, args)
      if (result.exitCode === 0 && !result.error) {
        return
      }
      verificationFailed = true
      const diagnostic = (result.stderr || result.stdout || result.error?.message || 'no diagnostic').trim()
      const summary = diagnostic.split('\n').filter(Boolean).at(-1)?.slice(0, 280) ?? 'no diagnostic'
      const log = `${work}/diagnostics/${runId}-${stage}.json`
      if (options.apply) {
        await files.writeJson(log, {
          command: name,
          args,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error?.message,
        })
      }
      Errors.throwHostEnvironment(
        `Xcode ${stage} verification failed for ${quote(app)}: ${summary}. ${
          options.apply ? `Details: ${log}.` : 'Rerun with --apply to save full verification diagnostics.'
        }`,
      )
    }
    if (options.apply) {
      notice(
        `Verifying the full Xcode code signature at ${app}... This reads the app bundle and can take several minutes.`,
      )
    }
    await verify('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '-R',
      XCODE_REQUIREMENT,
      app,
    ], 'signature')
    if (options.apply) {
      notice('Code signature verified. Checking macOS Gatekeeper approval...')
    }
    await verify('/usr/sbin/spctl', ['--assess', '--verbose', app], 'Gatekeeper')
    if (options.apply) {
      notice('Gatekeeper approval confirmed.')
    }
  }
  const save = async () => {
    if (options.apply) {
      // Retain earlier owned-path evidence even when a later attempt starts a new extraction.
      await files.writeJson(`${work}/receipts/${runId}.json`, receipt)
      await files.writeJson(`${work}/receipt.json`, receipt)
    }
  }
  const notice = (message: string) => {
    if (options.json) {
      HCI.writeErrorLine(message)
    } else {
      HCI.writeLine(message)
    }
  }
  const firstLaunch = (app: string) =>
    `Xcode at ${
      quote(app)
    } needs first-launch setup. In Xcode, review and accept Apple's license if you agree, authorize requested administrator steps, and let required components finish installing. Leave the default Xcode selection unchanged, then return to this Terminal.`
  const waitToContinue = async (message: string) => {
    const answer = await terminal.askText({ message })
    return !['q', 'quit'].includes(answer.trim().toLowerCase())
  }
  const inspectRuntime = async (app: string, runtimeVersion: string) => {
    if (options.apply) {
      notice('Checking the simulator SDK, installed runtimes, and CoreSimulator service...')
    }
    receipt.sdk = await requireSuccess('/usr/bin/xcrun', ['--sdk', platform.simulatorSdk, '--show-sdk-version'], app)
    if (!VERSION.test(receipt.sdk) || !atLeast(receipt.sdk, runtimeVersion)) {
      Errors.throwHostEnvironment(
        `Xcode's ${platform.label} Simulator SDK ${receipt.sdk} cannot satisfy requested ${platform.label} ${runtimeVersion}.`,
      )
    }
    const result = await command('/usr/bin/xcrun', ['simctl', 'list', 'runtimes', '--json'], app)
    if (result.exitCode !== 0 || result.error || result.stderr.trim()) {
      Errors.throwHostEnvironment(
        `CoreSimulator inspection failed: ${result.stderr || result.stdout || result.error?.message}`,
      )
    }
    const inventory: unknown = JSON.parse(result.stdout)
    if (
      !inventory || typeof inventory !== 'object' || !('runtimes' in inventory) || !Array.isArray(inventory.runtimes)
    ) {
      Errors.throwHostEnvironment('CoreSimulator returned an invalid runtime inventory.')
    }
    receipt.runtimeAvailable = inventory.runtimes.some((runtime: unknown) => {
      if (!runtime || typeof runtime !== 'object') {
        return false
      }
      const item = runtime as Record<string, unknown>
      return typeof item['identifier'] === 'string'
        && item['identifier'].startsWith(platform.runtimePrefix)
        && typeof item['version'] === 'string' && matchesVersion(item['version'], runtimeVersion)
        && item['isAvailable'] === true
    })
    const deviceResult = await command('/usr/bin/xcrun', ['simctl', 'list', 'devices', '--json'], app)
    if (deviceResult.exitCode !== 0 || deviceResult.error || deviceResult.stderr.trim()) {
      Errors.throwHostEnvironment(
        `CoreSimulator device inspection failed: ${
          deviceResult.stderr || deviceResult.stdout || deviceResult.error?.message
        }`,
      )
    }
    let devices: unknown
    try {
      devices = JSON.parse(deviceResult.stdout)
    } catch {
      Errors.throwHostEnvironment('CoreSimulator returned invalid device JSON.')
    }
    if (
      !devices || typeof devices !== 'object' || !('devices' in devices)
      || !devices.devices || typeof devices.devices !== 'object' || Array.isArray(devices.devices)
      || !Object.values(devices.devices).every(Array.isArray)
    ) {
      Errors.throwHostEnvironment('CoreSimulator returned an invalid device inventory.')
    }
    receipt.simulatorHealthy = true
  }
  const disk = async (path: string, minimumGiB: number) => {
    const report = await requireSuccess('/bin/df', ['-Pk', path])
    const row = report.trim().split('\n').at(-1)?.trim().split(/\s+/)
    const available = Number(row?.[3]) / 1024 / 1024
    if (!Number.isFinite(available) || available < minimumGiB) {
      Errors.throwHostEnvironment(
        `Need at least ${minimumGiB} GiB free at ${path}; df reported ${available.toFixed(1)} GiB.`,
      )
    }
  }
  try {
    if ((options.hostPlatform ?? Platform.hostPlatform) !== 'darwin') {
      Errors.throwHostEnvironment(`${platform.label} Simulator setup requires macOS.`)
    }
    receipt.macOS = await requireSuccess('/usr/bin/sw_vers', ['-productVersion'])
    if (!VERSION.test(receipt.macOS)) {
      Errors.throwHostEnvironment(`Cannot recognize macOS version: ${receipt.macOS}`)
    }
    receipt.defaultDeveloperDirectory = await defaultSelection()
    const candidates = [
      target,
      ...((await files.listDir('/Applications')).filter(name => name.endsWith('.app')).map(name =>
        `/Applications/${name}`
      )),
    ]
    for (const app of new Set(candidates)) {
      if (app === target && await files.isSymbolicLink(target)) {
        Errors.throwHostEnvironment(`Refusing symbolic-link destination ${target}.`)
      }
      if (!await files.exists(`${app}/Contents/Developer/usr/bin/xcodebuild`)) {
        if (app === target && await files.exists(target)) {
          Errors.throwHostEnvironment(`Refusing existing target ${target}: it is not a complete Xcode application.`)
        }
        continue
      }
      const version = await plist(app, 'CFBundleShortVersionString')
      if (app === target && !matchesVersion(version, options.xcodeVersion)) {
        Errors.throwHostEnvironment(`Refusing to overwrite ${target}: found Xcode ${version}.`)
      }
      if (matchesVersion(version, options.xcodeVersion)) {
        receipt.selectedXcode = app
        break
      }
    }
    if (!receipt.selectedXcode) {
      await disk(root, 50)
      await disk('/Applications', 50)
      receipt.remaining.push(`Install Xcode ${options.xcodeVersion} side by side at ${target}.`)
      let archive = options.archive ? FS.resolvePath(options.archive, root) : undefined
      let waitedForDownload = false
      while (!archive) {
        const downloads = FS.resolvePath('Downloads', files.homeDir())
        const archives: string[] = []
        if (await files.exists(downloads)) {
          let names: string[]
          try {
            names = await files.listDir(downloads)
          } catch (error) {
            Errors.throwHostEnvironment(
              `Cannot inspect ${downloads}: ${
                Errors.messageOf(error)
              }. Use --archive to select a local .xip explicitly.`,
            )
          }
          for (const name of names) {
            const version = /^Xcode[_ -](\d+(?:\.\d+){0,2})(?:[_ -].*)?\.xip$/i.exec(name)?.[1]
            const path = FS.resolvePath(name, downloads)
            if (
              version && matchesVersion(version, options.xcodeVersion) && !/[\x00-\x1f]/.test(name)
              && await files.isFile(path) && !await files.isSymbolicLink(path)
            ) {
              archives.push(path)
            }
          }
        }
        if (archives.length > 1) {
          receipt.remaining.push(
            `Several Xcode ${options.xcodeVersion} archives were found; choose one with --archive:`,
            ...archives,
          )
          return await finish()
        }
        archive = archives[0]
        if (archive) {
          break
        }
        const missing = `No completed Xcode ${options.xcodeVersion} .xip found in ${downloads}.`
        const instruction =
          `Open ${APPLE_DOWNLOADS}, sign in if requested, and download Xcode ${options.xcodeVersion} into ${downloads}, keeping Apple's filename. Wait for the .xip download to finish.`
        receipt.remaining.push(
          missing,
          instruction,
        )
        if (!options.apply || options.json || !terminal.isInteractive()) {
          receipt.remaining.push(
            'Rerun with --apply after downloading. Use --archive for another location or filename.',
          )
          return await finish()
        }
        await save()
        notice(missing)
        notice(instruction)
        waitedForDownload = true
        if (
          !await waitToContinue('Press Enter when the download is complete to continue, or type q and Enter to stop')
        ) {
          receipt.remaining.push('Stopped before installation; rerun the same command when the download is ready.')
          return await finish()
        }
        // Reinspect after every response; pressing Enter is not evidence of a completed download.
        receipt.remaining.splice(-2)
      }
      receipt.selectedArchive = archive
      if (!await files.isFile(archive)) {
        Errors.throwUserInput(`Xcode archive does not exist: ${archive}`)
      }
      if (!options.apply) {
        return await finish()
      }
      if (waitedForDownload) {
        await disk(root, 50)
        await disk('/Applications', 50)
      }
      notice(
        `Will expand Apple's signed archive and install ${target}. Later runtime download/import can change shared CoreSimulator components for every Xcode. The global Xcode selection will be checked and preserved.`,
      )
      // A fresh directory avoids mistaking a partial previous extraction for a complete app.
      const stage = `${work}/extract-${Platform.randomUUID()}`
      receipt.ownedPaths.push({
        path: stage,
        purpose: 'Xcode archive extraction',
        cleanup: 'Remove after successful installation or after inspecting a failed extraction.',
      })
      await save()
      await files.mkdir(stage)
      // Apple's xip verifies the signed archive; never fall back to raw xar extraction.
      notice(`Extracting Xcode from ${archive}... This can take several minutes.`)
      await requireSuccess('/usr/bin/xip', ['--expand', archive], undefined, stage)
      const extractedApps = (await files.listDir(stage)).filter(name => name.endsWith('.app'))
      if (extractedApps.length !== 1) {
        Errors.throwHostEnvironment(
          `Expected exactly one extracted Xcode application in ${stage}; found ${extractedApps.length}.`,
        )
      }
      const extracted = `${stage}/${extractedApps[0]}`
      if (!await files.exists(`${extracted}/Contents/Developer/usr/bin/xcodebuild`)) {
        Errors.throwHostEnvironment(`Extracted application is incomplete: ${extracted}.`)
      }
      if (await files.isSymbolicLink(extracted)) {
        Errors.throwHostEnvironment('Refusing a symbolic-link Xcode application in the archive.')
      }
      notice('Extraction complete. Verifying the Xcode signature and version...')
      await signed(extracted)
      const version = await plist(extracted, 'CFBundleShortVersionString')
      if (!matchesVersion(version, options.xcodeVersion)) {
        Errors.throwUserInput(`Archive contains Xcode ${version}; requested ${options.xcodeVersion}.`)
      }
      const minimum = await plist(extracted, 'LSMinimumSystemVersion')
      if (!atLeast(receipt.macOS, minimum)) {
        Errors.throwHostEnvironment(`Xcode requires macOS ${minimum}; this host runs ${receipt.macOS}.`)
      }
      if (await files.exists(target)) {
        Errors.throwHostEnvironment(`Refusing to overwrite the newly occupied target ${target}.`)
      }
      const installStage = `/Applications/.tao-${platform.directory}-${runId}`
      const stagedApp = `${installStage}/Xcode-${options.xcodeVersion}.app`
      receipt.ownedPaths.push({
        path: installStage,
        purpose: 'Owned installation staging; incomplete copies never occupy the final Xcode path',
        cleanup: 'Remove this staging directory after inspecting a failed copy or after successful installation.',
      })
      await save()
      await requireSuccess('/bin/mkdir', [installStage])
      notice(`Copying Xcode into /Applications... This can take several minutes.`)
      await requireSuccess('/usr/bin/ditto', [extracted, stagedApp])
      notice('Copy complete. Verifying the copied Xcode application...')
      await signed(stagedApp)
      if (!matchesVersion(await plist(stagedApp, 'CFBundleShortVersionString'), options.xcodeVersion)) {
        Errors.throwHostEnvironment('The staged Xcode version changed during installation.')
      }
      // The parent destination prevents mv from nesting an app inside an occupied app bundle.
      notice(`Finishing Xcode installation at ${target}...`)
      await requireSuccess('/bin/mv', ['-n', stagedApp, '/Applications/'])
      if (await files.exists(stagedApp)) {
        Errors.throwHostEnvironment(
          `The destination ${target} became occupied; the validated staged app remains at ${stagedApp}. Nothing was overwritten.`,
        )
      }
      if (!await files.exists(`${target}/Contents/Developer/usr/bin/xcodebuild`)) {
        Errors.throwHostEnvironment(`Published Xcode is missing or incomplete at ${target}.`)
      }
      receipt.ownedPaths.push({
        path: target,
        purpose: 'Requested side-by-side Xcode installation',
        cleanup: 'Keep until the Developer explicitly retires this Xcode version.',
      })
      receipt.selectedXcode = target
      await save()
      receipt.remaining = []
      notice(`Xcode installed at ${target}.`)
    }
    const selected = receipt.selectedXcode
    await signed(selected)
    const minimum = await plist(selected, 'LSMinimumSystemVersion')
    if (!VERSION.test(minimum) || !atLeast(receipt.macOS, minimum)) {
      Errors.throwHostEnvironment(`Xcode requires macOS ${minimum}; this host runs ${receipt.macOS}.`)
    }
    receipt.xcodeBuild = await requireSuccess('/usr/bin/xcodebuild', ['-version'], selected)
    if (options.apply) {
      notice('Checking Xcode first-launch readiness...')
    }
    const launch = await command('/usr/bin/xcodebuild', ['-checkFirstLaunchStatus'], selected)
    if (launch.exitCode !== 0 || launch.error) {
      receipt.remaining.push(firstLaunch(selected))
      if (!options.apply || options.json || !terminal.isInteractive()) {
        receipt.remaining.push(
          `Open Xcode to complete these steps, then rerun ${platform.command} with the same options.`,
        )
        return await finish()
      }
      await save()
      notice(firstLaunch(selected))
      if (!await waitToContinue(`Press Enter to open ${selected}, or type q and Enter to stop`)) {
        receipt.remaining.push('Stopped before opening Xcode; rerun the same command when ready.')
        return await finish()
      }
      notice(`Opening ${selected}...`)
      await requireSuccess('/usr/bin/open', [selected])
      if (
        !await waitToContinue('After completing setup in Xcode, press Enter to continue, or type q and Enter to stop')
      ) {
        receipt.remaining.push('Stopped while waiting for Xcode setup; rerun the same command when ready.')
        return await finish()
      }
      notice('Rechecking Xcode first-launch readiness...')
      const recheck = await command('/usr/bin/xcodebuild', ['-checkFirstLaunchStatus'], selected)
      if (recheck.exitCode !== 0 || recheck.error) {
        receipt.remaining.push(
          'Xcode setup is still incomplete. Finish its setup prompts, then rerun the same command.',
        )
        return await finish()
      }
      receipt.remaining = []
    }
    if (platform.deviceSdk) {
      const inspectDeviceSdk = async () => {
        const sdk = await command('/usr/bin/xcrun', ['--sdk', platform.deviceSdk!, '--show-sdk-version'], selected)
        if (sdk.exitCode === 0 && !sdk.error && VERSION.test(sdk.stdout.trim())) {
          receipt.deviceSdk = sdk.stdout.trim()
          return true
        }
        return false
      }
      if (!await inspectDeviceSdk()) {
        const instruction = `Xcode at ${
          quote(selected)
        } needs ${platform.label} Platform Support. Open Xcode > Settings > Components, install ${platform.label} Platform Support, and leave the default Xcode selection unchanged.`
        receipt.remaining.push(instruction)
        if (!options.apply || options.json || !terminal.isInteractive()) {
          return await finish()
        }
        await save()
        notice(instruction)
        if (!await waitToContinue(`Press Enter to open ${selected}, or type q and Enter to stop`)) {
          return await finish()
        }
        await requireSuccess('/usr/bin/open', [selected])
        if (
          !await waitToContinue(
            'After installing platform support, press Enter to continue, or type q and Enter to stop',
          )
        ) {
          return await finish()
        }
        if (!await inspectDeviceSdk()) {
          receipt.remaining.push(
            `${platform.label} device SDK is still unavailable. Complete platform installation, then rerun the same command.`,
          )
          return await finish()
        }
        receipt.remaining = []
      }
    }
    if (options.runtimeVersion === undefined) {
      receipt.status = 'ready'
      return await finish()
    }
    await inspectRuntime(selected, options.runtimeVersion)
    if (!receipt.runtimeAvailable) {
      await disk(root, 15)
      await disk('/Library/Developer', 15)
    }
    if (!receipt.runtimeAvailable && options.apply) {
      const downloads = `${work}/runtime-${runId}`
      receipt.ownedPaths.push({
        path: downloads,
        purpose: 'Apple runtime export',
        cleanup: 'Remove after runtime verification; keep on failure to resume.',
      })
      receipt.ownedPaths.push({
        path: '/Library/Developer/CoreSimulator',
        purpose: 'Apple-managed shared simulator runtime installation',
        cleanup: 'Manage installed runtimes through Xcode Settings; do not remove this shared directory.',
      })
      await save()
      await files.mkdir(downloads)
      notice(
        `Downloading ${platform.label} ${options.runtimeVersion} Simulator runtime... This can take several minutes and may update shared CoreSimulator components.`,
      )
      const download = await command('/usr/bin/xcodebuild', [
        '-downloadPlatform',
        platform.label,
        '-buildVersion',
        options.runtimeVersion,
        '-exportPath',
        downloads,
        '-architectureVariant',
        (options.hostArch ?? Platform.hostArch) === 'arm64' ? 'arm64' : 'universal',
      ], selected)
      if (download.exitCode !== 0 || download.error) {
        const diagnostic = (download.stderr || download.stdout || download.error?.message || 'no diagnostic').trim()
        receipt.remaining.push(`Simulator runtime download failed: ${diagnostic}`)
        const instructions = `In Xcode at ${
          quote(selected)
        }, open Xcode > Settings > Components. Find ${platform.label} ${options.runtimeVersion} under Platform Support, or use the + button under Other Installed Platforms to select that exact version. Click Get or Download & Install and wait for installation to finish. Developer Documentation is a separate download. Leave the default Xcode selection unchanged, then return to this Terminal. If that runtime is not listed, stop here; another ${platform.label} version does not satisfy this request.`
        receipt.remaining.push(instructions)
        if (options.json || !terminal.isInteractive()) {
          return await finish()
        }
        await save()
        notice(receipt.remaining.join('\n'))
        if (!await waitToContinue(`Press Enter to open ${selected}, or type q and Enter to stop`)) {
          return await finish()
        }
        notice(`Opening ${selected}...`)
        await requireSuccess('/usr/bin/open', [selected])
        if (
          !await waitToContinue(
            'After installing the simulator runtime in Xcode, press Enter to continue, or type q and Enter to stop',
          )
        ) {
          return await finish()
        }
        receipt.runtimeAvailable = false
        receipt.simulatorHealthy = false
        notice('Checking the installed runtime and CoreSimulator service...')
        await inspectRuntime(selected, options.runtimeVersion)
        if (receipt.runtimeAvailable && receipt.simulatorHealthy) {
          receipt.remaining = []
          receipt.status = 'ready'
        } else {
          receipt.remaining.push(
            `${platform.label} ${options.runtimeVersion} is still unavailable. Complete its runtime installation, then rerun the same command.`,
          )
        }
        return await finish()
      }
      const images = (await files.listDir(downloads)).filter(name => name.endsWith('.dmg'))
      if (images.length !== 1) {
        Errors.throwHostEnvironment(
          `Expected one Apple runtime image in ${downloads}; inspect the export before retrying.`,
        )
      }
      notice(
        `Installing ${platform.label} ${options.runtimeVersion} Simulator runtime... This can take several minutes.`,
      )
      await requireSuccess('/usr/bin/xcodebuild', ['-importPlatform', `${downloads}/${images[0]}`], selected)
      receipt.runtimeAvailable = false
      receipt.simulatorHealthy = false
      notice('Checking the installed runtime and CoreSimulator service...')
      await inspectRuntime(selected, options.runtimeVersion)
    }
    if (!receipt.runtimeAvailable) {
      receipt.remaining.push(
        `Install available ${platform.label} ${options.runtimeVersion} with --apply; an unavailable or different runtime does not satisfy this request.`,
      )
    }
    if (receipt.runtimeAvailable && receipt.simulatorHealthy) {
      receipt.status = 'ready'
    }
  } catch (error) {
    receipt.status = 'needs-action'
    receipt.remaining.push(Errors.messageOf(error))
    if (options.apply && !verificationFailed) {
      receipt.remaining.push(
        'If Apple requests sign-in, license acceptance, first launch or administrator access, complete that step in Xcode or Finder, then rerun the same setup command.',
      )
    }
  }
  return await finish()

  async function finish(): Promise<AppleSetupReceipt> {
    if (receipt.defaultDeveloperDirectory !== undefined) {
      try {
        const current = await defaultSelection()
        if (current !== receipt.defaultDeveloperDirectory) {
          Errors.throwHostEnvironment('The global default changed during setup.')
        }
      } catch (error) {
        receipt.status = 'needs-action'
        receipt.remaining.push(
          `Global Xcode selection changed or could not be verified; original was ${
            receipt.defaultDeveloperDirectory ?? 'unset'
          }. ${Errors.messageOf(error)} Inspect xcode-select -p before proceeding.`,
        )
      }
    }
    await save()
    return receipt
  }
}

async function run(options: AppleSetupOptions, platform: AppleSetupPlatform): Promise<number> {
  const receipt = await prepare(options, platform)
  const root = options.repositoryRoot ?? Repo.getRoot()
  const work = FS.resolvePath(
    `.artifacts/${platform.directory}/${options.xcodeVersion}-${options.runtimeVersion ?? 'device'}`,
    root,
  )
  if (options.json) {
    HCI.writeLine(JSON.stringify(receipt, null, 2))
  } else {
    HCI.writeLine(`${platform.label} setup: ${receipt.status}. Xcode: ${receipt.selectedXcode ?? 'missing'}.`)
    if (receipt.selectedArchive) {
      HCI.writeLine(`Xcode archive: ${receipt.selectedArchive}`)
    }
    for (const step of receipt.remaining) {
      HCI.writeLine(step)
    }
    if (!options.apply) {
      HCI.writeLine('Inspection only; use --apply to install the requested components.')
    }
    if (options.apply) {
      HCI.writeLine(`Receipt: ${work}/receipt.json`)
    }
  }
  return receipt.status === 'ready' ? 0 : 1
}

export const AppleToolchainSetup = { matchesVersion, prepare, run }
