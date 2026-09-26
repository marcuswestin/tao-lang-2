import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

type Options = {
  xcodeVersion: string
  runtimeVersion: string
  archive?: string
  apply?: boolean
  json?: boolean
  repositoryRoot?: string
  hostPlatform?: string
  runCommand?: typeof CLI.run
  terminal?: Pick<typeof HCI, 'isInteractive' | 'askText'>
  files?: Pick<typeof FS, 'exists' | 'homeDir' | 'isFile' | 'isSymbolicLink' | 'listDir' | 'mkdir' | 'writeJson'>
}

type Receipt = {
  requested: { xcodeVersion: string; runtimeVersion: string }
  mode: 'apply' | 'plan'
  status: 'needs-action' | 'ready'
  defaultDeveloperDirectory?: string | null
  selectedXcode?: string
  selectedArchive?: string
  macOS?: string
  sdk?: string
  xcodeBuild?: string
  runtimeAvailable: boolean
  simulatorHealthy: boolean
  remaining: string[]
  ownedPaths: { path: string; purpose: string; cleanup: string }[]
}

const APPLE_DOWNLOADS = 'https://developer.apple.com/download/applications/'
const VERSION = /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/

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
async function run(options: Options): Promise<number> {
  if (!VERSION.test(options.xcodeVersion) || !VERSION.test(options.runtimeVersion)) {
    Errors.throwUserInput('Specify numeric Xcode and iOS versions, for example 27.1 and 27.1.')
  }
  if (options.archive && (!options.archive.endsWith('.xip') || /[\x00-\x1f]/.test(options.archive))) {
    Errors.throwUserInput('The Xcode archive must be a local .xip file.')
  }
  const files = options.files ?? FS
  const execute = options.runCommand ?? CLI.run
  const terminal = options.terminal ?? HCI
  const root = options.repositoryRoot ?? Repo.getRoot()
  const target = `/Applications/Xcode-${options.xcodeVersion}.app`
  const work = FS.resolvePath(`.artifacts/ios-setup/${options.xcodeVersion}-${options.runtimeVersion}`, root)
  const runId = Platform.randomUUID()
  const receipt: Receipt = {
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
    await requireSuccess('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '-R',
      '=anchor apple and identifier "com.apple.dt.Xcode"',
      app,
    ])
    await requireSuccess('/usr/sbin/spctl', ['--assess', '--verbose', app])
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
    `Open ${quote(app)} and complete Apple's license, administrator and first-launch prompts. Command: open ${
      quote(app)
    }. Then rerun setup-ios with the same options.`
  const inspectRuntime = async (app: string) => {
    receipt.sdk = await requireSuccess('/usr/bin/xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], app)
    if (!VERSION.test(receipt.sdk) || !atLeast(receipt.sdk, options.runtimeVersion)) {
      Errors.throwHostEnvironment(
        `Xcode's iOS Simulator SDK ${receipt.sdk} cannot satisfy requested iOS ${options.runtimeVersion}.`,
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
        && item['identifier'].startsWith('com.apple.CoreSimulator.SimRuntime.iOS-')
        && typeof item['version'] === 'string' && matchesVersion(item['version'], options.runtimeVersion)
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
      Errors.throwHostEnvironment('iOS Simulator setup requires macOS.')
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
        const answer = await terminal.askText({
          message: 'Press Enter when the download is complete to continue, or type q and Enter to stop',
        })
        if (['q', 'quit'].includes(answer.trim().toLowerCase())) {
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
      const installStage = `/Applications/.tao-ios-setup-${runId}`
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
    if (options.apply) {
      notice('Checking Xcode signature, first-launch readiness, and simulator availability...')
    }
    await signed(selected)
    const minimum = await plist(selected, 'LSMinimumSystemVersion')
    if (!VERSION.test(minimum) || !atLeast(receipt.macOS, minimum)) {
      Errors.throwHostEnvironment(`Xcode requires macOS ${minimum}; this host runs ${receipt.macOS}.`)
    }
    receipt.xcodeBuild = await requireSuccess('/usr/bin/xcodebuild', ['-version'], selected)
    const launch = await command('/usr/bin/xcodebuild', ['-checkFirstLaunchStatus'], selected)
    if (launch.exitCode !== 0 || launch.error) {
      receipt.remaining.push(firstLaunch(selected))
      return await finish()
    }
    await inspectRuntime(selected)
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
        `Downloading iOS ${options.runtimeVersion} Simulator runtime... This can take several minutes and may update shared CoreSimulator components.`,
      )
      await requireSuccess('/usr/bin/xcodebuild', [
        '-downloadPlatform',
        'iOS',
        '-buildVersion',
        options.runtimeVersion,
        '-exportPath',
        downloads,
      ], selected)
      const images = (await files.listDir(downloads)).filter(name => name.endsWith('.dmg'))
      if (images.length !== 1) {
        Errors.throwHostEnvironment(
          `Expected one Apple runtime image in ${downloads}; inspect the export before retrying.`,
        )
      }
      notice(`Installing iOS ${options.runtimeVersion} Simulator runtime... This can take several minutes.`)
      await requireSuccess('/usr/bin/xcodebuild', ['-importPlatform', `${downloads}/${images[0]}`], selected)
      receipt.runtimeAvailable = false
      receipt.simulatorHealthy = false
      notice('Checking the installed runtime and CoreSimulator service...')
      await inspectRuntime(selected)
    }
    if (!receipt.runtimeAvailable) {
      receipt.remaining.push(
        `Install available iOS ${options.runtimeVersion} with --apply; an unavailable or different runtime does not satisfy this request.`,
      )
    }
    if (receipt.runtimeAvailable && receipt.simulatorHealthy) {
      receipt.status = 'ready'
    }
  } catch (error) {
    receipt.status = 'needs-action'
    receipt.remaining.push(Errors.messageOf(error))
    if (options.apply) {
      receipt.remaining.push(
        'If Apple requests sign-in, license acceptance, first launch or administrator access, complete that step in Xcode or Finder, then rerun the same setup command.',
      )
    }
  }
  return await finish()

  async function finish(): Promise<number> {
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
    if (options.json) {
      HCI.writeLine(JSON.stringify(receipt, null, 2))
    } else {
      HCI.writeLine(`iOS setup: ${receipt.status}. Xcode: ${receipt.selectedXcode ?? 'missing'}.`)
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
}

export const IosSetupCommand = { run }
