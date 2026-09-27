import { Errors, FS, HCI, Platform, Repo } from '@shared'
import { prepareHostApp } from '../app-build/HostBuild'
import { recordedCommand } from '../CommandReceipts'
import type { CatalystHostTestingRequest, HostTestingContext } from '../HostTestingRequest'
import { applyCatalystScreensPatch } from './CatalystScreensPatch'

const sliderPackage = '@react-native-community/slider'
const sliderRelative = 'ios/RNCSliderComponentView.mm'
const sliderOriginalDigest = '1daac056d745713392c8c5c819bbbe9f3108065e0c67c0700887ffdb06ca3959'

/** Builds a local Catalyst trial; a build receipt makes no claim about native UI acceptance. */
export async function runCatalystBuild(
  request: CatalystHostTestingRequest,
  context: HostTestingContext,
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(context.runId)) {
    Errors.throwUserInput('Catalyst run id must contain only lowercase letters, digits, and hyphens.')
  }
  const root = Repo.resolvePath(`.artifacts/catalyst/${context.runId}`)
  if (await FS.exists(root)) {
    Errors.throwUserInput(`Catalyst trial already exists: ${root}`)
  }
  await FS.mkdir(root)
  const sourceRoot = Repo.resolvePath('packages/apps/expo-host')
  const sourceModules = FS.resolvePath('node_modules', sourceRoot)
  const sourceSlider = await FS.realPath(FS.resolvePath(`${sliderPackage}/${sliderRelative}`, sourceModules))
  const protectedPaths = [
    Repo.resolvePath('package.json'),
    Repo.resolvePath('bun.lock'),
    FS.resolvePath('package.json', sourceRoot),
    sourceSlider,
    await FS.realPath(FS.resolvePath('react-native-screens/ios/RNSScreenStack.mm', sourceModules)),
    await FS.realPath(FS.resolvePath('react-native-screens/ios/tabs/host/RNSTabsHostComponentView.mm', sourceModules)),
    await FS.realPath(FS.resolvePath('react-native-screens/ios/RNSScreen.mm', sourceModules)),
    await FS.realPath(
      FS.resolvePath('react-native-screens/ios/tabs/screen/RNSTabsScreenComponentView.h', sourceModules),
    ),
    await FS.realPath(
      FS.resolvePath('react-native-screens/ios/tabs/screen/RNSTabsScreenComponentView.mm', sourceModules),
    ),
  ]
  const protectedDigests = await digests(protectedPaths)
  const env = {
    ...context.environment,
    CI: '1',
    EXPO_NO_DOTENV: '1',
    EXPO_USE_PRECOMPILED_MODULES: '0',
    RCT_USE_RN_DEP: '0',
    RCT_USE_PREBUILT_RNCORE: '0',
    TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: sourceRoot,
  }
  const base = {
    version: 1,
    subject: request.subject,
    seed: request.seed,
    runId: context.runId,
    artifactRoot: root,
    acceptance: 'Build and binary platform only; native UI acceptance remains outstanding.',
    cleanup: 'Retained trial inputs, app, and diagnostics; remove this run directory only when no longer needed.',
  }
  let appPath: string | undefined
  let failure: string | undefined
  await FS.writeJson(FS.resolvePath('receipt.json', root), { ...base, status: 'building' })
  try {
    await recordedCommand('source-commit', 'git', { args: ['rev-parse', 'HEAD'], cwd: Repo.getRoot() }, root)
    await recordedCommand('source-status', 'git', { args: ['status', '--short'], cwd: Repo.getRoot() }, root)
    await recordedCommand('source-diff', 'git', { args: ['diff', 'HEAD'], cwd: Repo.getRoot() }, root)
    for (const file of ['CatalystBuild.ts', 'CatalystScreensPatch.ts']) {
      await FS.copyFile(
        Repo.resolvePath(`packages/testing/e2e-testing/native/${file}`),
        FS.resolvePath(file, root),
      )
    }
    await recordedCommand(
      'signing-identities',
      'security',
      { args: ['find-identity', '-v', '-p', 'codesigning'] },
      root,
    )
    const identities = [...(await FS.readText(FS.resolvePath('signing-identities.log', root)))
      .matchAll(/\b([A-F0-9]{40}) "Apple Development:[^"\n]+"/gu)]
    requireCondition(
      identities.length === 1,
      'Catalyst trial requires exactly one existing Apple Development signing identity for local library validation.',
    )
    const signingIdentity = identities[0]![1]!
    await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'], cwd: Repo.getRoot() }, root)
    const build = await prepareHostApp({ ...request, artifactRoot: root, runId: context.runId })
    await FS.writeJson(FS.resolvePath('preparation.json', root), build)
    await isolateModules(sourceModules, FS.resolvePath('node_modules', build.root), root)
    // The trial changes native linkage in its Podfile; every package declaration stays intact.
    const manifestPath = FS.resolvePath('package.json', build.root)
    const manifest = await FS.readText(FS.resolvePath('package.json', sourceRoot))
    await FS.writeText(manifestPath, manifest)
    // Only the isolated Mac trial opts into native appearance changes.
    const appConfigPath = FS.resolvePath('app.json', build.root)
    const appConfig = await FS.readJson<{ expo: Record<string, unknown> }>(appConfigPath)
    appConfig.expo['userInterfaceStyle'] = 'automatic'
    await FS.writeJson(appConfigPath, appConfig)
    await addRuntimeReceipt(build.root)
    try {
      await recordedCommand('prebuild', FS.resolvePath('node_modules/.bin/expo', build.root), {
        args: ['prebuild', '--platform', 'ios', '--no-install', '--skip-dependency-update', 'react-native,react'],
        cwd: build.root,
        env,
        timeoutMs: 180_000,
        idleOutputMs: 90_000,
      }, root)
      requireCondition(
        await FS.readText(manifestPath) === manifest,
        'Expo prebuild changed trial package declarations.',
      )
    } finally {
      const generatedManifest = await FS.readText(manifestPath)
      await FS.writeText(FS.resolvePath('package.before.json', root), manifest)
      await FS.writeText(FS.resolvePath('package.after-prebuild.json', root), generatedManifest)
      await FS.writeJson(FS.resolvePath('manifest-integrity.json', root), {
        unchanged: generatedManifest === manifest,
        originalDigest: Platform.sha256Hex(manifest),
        generatedDigest: Platform.sha256Hex(generatedManifest),
      })
      await FS.writeText(manifestPath, manifest)
    }
    const ios = FS.resolvePath('ios', build.root)
    const project = await singleEntry(ios, '.xcodeproj')
    const scheme = FS.basename(project, '.xcodeproj')
    await configureNativeProject(ios, scheme, request.subject, root)
    await recordedCommand('pod-install', 'pod', {
      args: ['install'],
      cwd: ios,
      env,
      timeoutMs: 600_000,
      idleOutputMs: 180_000,
      prefixedOutput: { processName: 'catalyst-pods' },
    }, root)
    const workspace = await singleEntry(ios, '.xcworkspace')
    const derivedData = FS.resolvePath('DerivedData', root)
    await recordedCommand('catalyst-build', 'xcrun', {
      args: [
        'xcodebuild',
        '-workspace',
        workspace,
        '-scheme',
        scheme,
        '-configuration',
        'Release',
        '-destination',
        'platform=macOS,variant=Mac Catalyst',
        '-derivedDataPath',
        derivedData,
        '-resultBundlePath',
        FS.resolvePath('Build.xcresult', root),
        `CODE_SIGN_IDENTITY=${signingIdentity}`,
        'CODE_SIGN_STYLE=Manual',
        'DEVELOPMENT_TEAM=',
        'IPHONEOS_DEPLOYMENT_TARGET=16.4',
        'MACOSX_DEPLOYMENT_TARGET=13.3',
        'PROVISIONING_PROFILE_SPECIFIER=',
        'build',
      ],
      cwd: ios,
      env,
      processPolicy: 'test',
      prefixedOutput: { processName: 'catalyst-build' },
      timeoutMs: 900_000,
      idleOutputMs: 180_000,
    }, root)
    const builtApp = await singleEntry(FS.resolvePath('Build/Products/Release-maccatalyst', derivedData), '.app')
    appPath = FS.resolvePath(request.subject === 'hnreader' ? 'HNReader.app' : 'NativeNavigation.app', root)
    // Preserve framework symlinks relative to the copied bundle so the app stays relocatable.
    await recordedCommand('copy-app', 'ditto', { args: [builtApp, appPath] }, root)
    await recordedCommand('verify-signatures', 'codesign', {
      args: ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    }, root)
    await recordedCommand('app-info', 'plutil', {
      args: [
        '-convert',
        'json',
        '-o',
        FS.resolvePath('Info.json', root),
        FS.resolvePath('Contents/Info.plist', appPath),
      ],
    }, root)
    const info = await FS.readJson<{ CFBundleExecutable?: string; UIDeviceFamily?: number[] }>(
      FS.resolvePath('Info.json', root),
    )
    const executable = info.CFBundleExecutable
    requireCondition(
      typeof executable === 'string' && FS.basename(executable) === executable,
      'Built Catalyst app has no safe CFBundleExecutable.',
    )
    requireCondition(info.UIDeviceFamily?.includes(6) === true, 'Built app does not declare the Mac device family.')
    await recordedCommand('binary-platform', 'xcrun', {
      args: ['vtool', '-show-build', FS.resolvePath(`Contents/MacOS/${executable}`, appPath)],
      env,
    }, root)
    requireCondition(
      /platform\s+MACCATALYST\b/u.test(await FS.readText(FS.resolvePath('binary-platform.log', root))),
      'Built executable does not report the MACCATALYST platform.',
    )
  } catch (error) {
    failure = Errors.messageOf(error)
  } finally {
    const after = await digests(protectedPaths).catch(error => ({ integrityReadFailure: Errors.messageOf(error) }))
    const sourceUnchanged = JSON.stringify(after) === JSON.stringify(protectedDigests)
    if (!sourceUnchanged) {
      failure = [failure, 'Protected source or dependency input changed during the trial.'].filter(Boolean).join('\n')
    }
    await FS.writeJson(FS.resolvePath('source-integrity.json', root), {
      before: protectedDigests,
      after,
      sourceUnchanged,
    })
    await FS.writeJson(FS.resolvePath('receipt.json', root), {
      ...base,
      status: failure === undefined ? 'built' : 'failed',
      appPath,
      failure,
    })
    HCI.writeLine(`Catalyst trial artifacts retained: ${root}`)
  }
  if (failure !== undefined) {
    Errors.throwHostEnvironment(`Catalyst trial failed: ${failure}\nArtifacts: ${root}`)
  }
  HCI.writeLine(
    `Catalyst app: ${appPath}\nBuild and binary platform verified; native UI acceptance remains outstanding.`,
  )
}

async function isolateModules(source: string, destination: string, artifacts: string): Promise<void> {
  requireCondition(await FS.isSymbolicLink(destination), 'Prepared node_modules must be a removable directory symlink.')
  await FS.remove(destination)
  await FS.mkdir(destination)
  for (const name of await FS.listDir(source)) {
    if (name === 'react-native-screens') {
      continue
    }
    const from = FS.resolvePath(name, source)
    const to = FS.resolvePath(name, destination)
    if (name.startsWith('@') && await FS.isDirectory(from)) {
      await FS.mkdir(to)
      for (const child of await FS.listDir(from)) {
        if (`${name}/${child}` === sliderPackage) {
          continue
        }
        await FS.symlink(await FS.realPath(FS.resolvePath(child, from)), FS.resolvePath(child, to))
      }
    } else {
      await FS.symlink(await FS.realPath(from), to)
    }
  }
  await applyCatalystScreensPatch(source, destination, artifacts)
  const original = await FS.realPath(FS.resolvePath(sliderPackage, source))
  const copied = FS.resolvePath(sliderPackage, destination)
  const manifest = await FS.readJson<{ version: string }>(FS.resolvePath('package.json', original))
  requireCondition(manifest.version === '5.2.0', 'Catalyst slider patch requires the installed slider 5.2.0.')
  await FS.copyDirectory(original, copied)
  const target = FS.resolvePath(sliderRelative, copied)
  requireCondition(
    FS.pathIsWithin(await FS.realPath(target), await FS.realPath(copied)),
    'Slider patch target escapes the copied package.',
  )
  requireCondition(
    !FS.pathIsWithin(await FS.realPath(target), original),
    'Slider patch target aliases the source package.',
  )
  const before = await FS.readText(target)
  requireCondition(
    Platform.sha256Hex(before) === sliderOriginalDigest,
    'Installed slider source does not match the reviewed patch hash.',
  )
  const after = replaceOnce(before, '    BOOL _isSliding;', '    bool _isSliding;')
  const patch = await FS.readText(Repo.resolvePath('packages/testing/e2e-testing/native/catalyst/slider-bool.patch'))
  requireCondition(
    patch.includes('-    BOOL _isSliding;') && patch.includes('+    bool _isSliding;'),
    'Reviewed slider patch resource is missing the exact replacement.',
  )
  await FS.writeText(target, after)
  await FS.writeText(FS.resolvePath('slider-bool.patch', artifacts), patch)
  await FS.writeJson(FS.resolvePath('slider-patch.json', artifacts), {
    package: sliderPackage,
    version: manifest.version,
    source: original,
    target,
    originalDigest: Platform.sha256Hex(before),
    replacementDigest: Platform.sha256Hex(after),
    exactReplacement: { before: '    BOOL _isSliding;', after: '    bool _isSliding;' },
  })
}

async function configureNativeProject(
  ios: string,
  scheme: string,
  subject: 'native-navigation' | 'hnreader',
  artifacts: string,
): Promise<void> {
  const podfile = FS.resolvePath('Podfile', ios)
  const before = await FS.readText(podfile)
  let after = replaceOnce(before, ':mac_catalyst_enabled => false', ':mac_catalyst_enabled => true')
  after = replaceOnce(after, '  use_expo_modules!', "  use_expo_modules!({ exclude: ['@clerk/expo'] })")
  after = `ENV['EXPO_USE_PRECOMPILED_MODULES'] = '0'\n${after}`
  const delegate = FS.resolvePath(`${scheme}/AppDelegate.swift`, ios)
  const menu = subject === 'hnreader' ? '' : await FS.readText(
    Repo.resolvePath('packages/testing/e2e-testing/native/catalyst/CatalystMenu.swift.txt'),
  )
  requireCondition(
    subject === 'hnreader' || menu.includes('#if targetEnvironment(macCatalyst)'),
    'Catalyst menu resource must guard its class members.',
  )
  const delegateBefore = await FS.readText(delegate)
  const delegateAnchor = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
  const withMenu = replaceOnce(delegateBefore, delegateAnchor, `${delegateAnchor}\n${menu}\n`)
  const delegateAfter = /^import UIKit$/mu.test(withMenu) ? withMenu : `import UIKit\n${withMenu}`
  await FS.writeText(delegate, delegateAfter)
  await FS.writeText(FS.resolvePath('AppDelegate.before.swift', artifacts), delegateBefore)
  await FS.writeText(FS.resolvePath('AppDelegate.after.swift', artifacts), delegateAfter)
  // Evaluate with CocoaPods' own Ruby and xcodeproj, without installing host gems.
  after += `\nproject = Xcodeproj::Project.open(File.join(__dir__, ${JSON.stringify(`${scheme}.xcodeproj`)}))
targets = project.targets.select { |target| target.product_type == 'com.apple.product-type.application' }
abort 'Expected exactly one application target' unless targets.length == 1
targets.first.build_configurations.each do |config|
  config.build_settings['SUPPORTS_MACCATALYST'] = 'YES'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '6'
  config.build_settings['SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD'] = 'NO'
  config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
  config.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Development'
  config.build_settings['DEVELOPMENT_TEAM'] = ''
end
project.save
`
  await FS.writeText(podfile, after)
  await FS.writeText(FS.resolvePath('Podfile.before', artifacts), before)
  await FS.writeText(FS.resolvePath('Podfile.after', artifacts), after)
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    await recordedCommand(`display-name-${key}`, 'plutil', {
      args: [
        '-replace',
        key,
        '-string',
        subject === 'hnreader' ? 'Tao Reader Trial' : 'Tao Navigation Trial',
        FS.resolvePath(`${scheme}/Info.plist`, ios),
      ],
    }, artifacts)
  }
}

async function addRuntimeReceipt(root: string): Promise<void> {
  const constants = await FS.readText(
    FS.resolvePath('node_modules/react-native/React/CoreModules/RCTPlatform.mm', root),
  )
  requireCondition(
    constants.includes('.isMacCatalyst = true') && constants.includes('.interfaceIdiom = interfaceIdiom('),
    'Installed React Native does not expose the required Catalyst runtime constants.',
  )
  const path = FS.resolvePath('index.ts', root)
  let entry = await FS.readText(path)
  entry = replaceOnce(entry, 'SafeAreaView as View, Text', 'SafeAreaView as View, Text, useColorScheme')
  entry = replaceOnce(
    entry,
    'const HostApp: ComponentType = () => {',
    `const HostApp: ComponentType = () => {
  const nativeScheme = useColorScheme() ?? 'light'
  const receiptStyle = { color: nativeScheme === 'dark' ? '#ffffff' : '#000000' }`,
  )
  entry = entry.replaceAll('createElement(Text, {', 'createElement(Text, { style: receiptStyle,')
  await FS.writeText(
    path,
    replaceOnce(
      entry,
      'registerRootComponent(HostApp)',
      `const CatalystHostApp: ComponentType = () => {
  const constants = Platform.constants as { isMacCatalyst?: boolean; interfaceIdiom?: string }
  const nativeScheme = useColorScheme() ?? 'light'
  const receipt = \`Catalyst: \${String(constants.isMacCatalyst)} · Interface: \${constants.interfaceIdiom ?? 'unknown'} · Native appearance: \${nativeScheme}\`
  return createElement(View, { style: { flex: 1, backgroundColor: nativeScheme === 'dark' ? '#000000' : '#ffffff' } },
    createElement(Text, { style: { color: nativeScheme === 'dark' ? '#ffffff' : '#000000' }, testID: 'tao-catalyst-platform', accessibilityLabel: receipt }, receipt),
    createElement(HostApp))
}
registerRootComponent(CatalystHostApp)`,
    ),
  )
}

async function singleEntry(root: string, suffix: string): Promise<string> {
  const names = (await FS.listDir(root)).filter(name => name.endsWith(suffix))
  requireCondition(names.length === 1, `Expected exactly one ${suffix} in ${root}; found ${names.length}.`)
  return FS.resolvePath(names[0]!, root)
}

function replaceOnce(source: string, expected: string, replacement: string): string {
  requireCondition(
    source.split(expected).length === 2,
    `Generated input no longer has one expected patch anchor: ${expected}`,
  )
  return source.replace(expected, replacement)
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    Errors.throwHostEnvironment(message)
  }
}

async function digests(paths: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(paths.map(async path => [path, Platform.sha256Hex(await FS.readFile(path))])),
  )
}
