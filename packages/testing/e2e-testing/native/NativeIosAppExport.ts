import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

type ExportOptions = {
  appPath: string
  output: string
  environment: Record<string, string | undefined>
  appId: string
  runId: string
}

/** Manual simulator review needs an app that outlives the automated proof's build cleanup. */
export async function validateNativeIosAppOutput(output: string): Promise<string> {
  if (!output.trim() || /[\x00-\x1f]/u.test(output)) {
    Errors.throwUserInput('--output must name a new directory for the retained simulator application.')
  }
  const destination = FS.resolvePath(output, Repo.getRoot())
  let ancestor = FS.dirname(destination)
  while (!await FS.exists(ancestor) && FS.dirname(ancestor) !== ancestor) {
    ancestor = FS.dirname(ancestor)
  }
  const physicalDestination = FS.resolvePath(FS.relativePath(ancestor, destination), await FS.realPath(ancestor))
  const managedRoot = Repo.resolvePath('.artifacts/host-testing')
  const physicalManagedRoot = await FS.exists(managedRoot) ? await FS.realPath(managedRoot) : managedRoot
  if (FS.pathIsWithin(physicalDestination, physicalManagedRoot)) {
    Errors.throwUserInput('--output must be outside .artifacts/host-testing, whose generated builds are pruned.')
  }
  if (await FS.exists(destination) || await FS.isSymbolicLink(destination)) {
    Errors.throwUserInput(`Refusing to replace existing simulator export: ${destination}`)
  }
  return destination
}

/** Retain only the built app and provenance, without retaining a whole native build tree. */
export async function exportNativeIosApp(options: ExportOptions, runCommand = CLI.run): Promise<void> {
  const destination = await validateNativeIosAppOutput(options.output)
  const run = async (command: string, args: string[]) => {
    const result = await runCommand(command, { args, env: options.environment })
    if (result.error || result.exitCode !== 0 || result.signal !== null) {
      Errors.throwHostEnvironment(
        `Simulator app export failed: ${result.stderr || result.stdout || result.error?.message}`,
      )
    }
    return result.stdout.trim()
  }
  const plist = (key: string) =>
    run('/usr/bin/plutil', ['-extract', key, 'raw', FS.resolvePath('Info.plist', options.appPath)])
  const appId = await plist('CFBundleIdentifier')
  if (appId !== options.appId) {
    Errors.throwHostEnvironment(`Built simulator app identifier ${appId} does not match ${options.appId}.`)
  }
  const executable = await plist('CFBundleExecutable')
  if (!executable || executable === '.' || executable === '..' || /[/\\\x00-\x1f]/u.test(executable)) {
    Errors.throwHostEnvironment('Built simulator app has an invalid executable name.')
  }
  const sdk = await plist('DTSDKName')
  if (!sdk.startsWith('iphonesimulator')) {
    Errors.throwHostEnvironment(`Built app uses ${sdk}, not an iOS Simulator SDK.`)
  }
  const xcodeVersion = await run('/usr/bin/xcodebuild', ['-version'])
  const selectedSdk = await run('/usr/bin/xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])
  const xcodeBuild = await plist('DTXcodeBuild')
  if (sdk !== `iphonesimulator${selectedSdk}` || xcodeBuild !== xcodeVersion.match(/^Build version (\S+)/mu)?.[1]) {
    Errors.throwHostEnvironment('Built simulator app metadata does not match the selected Xcode and SDK.')
  }
  const executableSha256 = Platform.sha256Hex(await FS.readFile(FS.resolvePath(executable, options.appPath)))
  await FS.mkdir(FS.dirname(destination))
  // mkdir without -p reserves a fresh destination even if another writer won after validation.
  await run('/bin/mkdir', [destination])
  const receipt = {
    appId,
    appPath: FS.resolvePath('Application.app', destination),
    cleanup: 'Remove this exported directory after manual simulator review; it is not pruned with host-testing runs.',
    developerDirectory: options.environment['DEVELOPER_DIR'] ?? null,
    executable,
    executableSha256,
    runId: options.runId,
    sdk,
    selectedSdk,
    xcodeVersion,
    xcodeBuild,
  }
  await FS.writeJson(FS.resolvePath('build.json', destination), { ...receipt, status: 'copying' })
  await run('/usr/bin/ditto', [options.appPath, receipt.appPath])
  if (Platform.sha256Hex(await FS.readFile(FS.resolvePath(executable, receipt.appPath))) !== executableSha256) {
    Errors.throwHostEnvironment(`Retained simulator executable does not match its source: ${receipt.appPath}`)
  }
  await FS.writeJson(FS.resolvePath('build.json', destination), { ...receipt, status: 'ready' })
  HCI.writeLine(`Retained simulator app and build provenance: ${destination}`)
}
