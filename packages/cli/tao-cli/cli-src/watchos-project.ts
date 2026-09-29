import { Errors, FS } from '@shared'

/** Package compiler-emitted Swift and optional shared UI tests as a standalone watchOS app. */
export async function exportWatchOSProject(options: {
  appName: string
  displayName?: string
  outputRoot: string
  files: readonly { relativePath: string; code: string }[]
  entryArtifact: string
  /** Paths to the shared interpreter and its serialized journey plan. */
  tests?: { source: string; plan: string }
}): Promise<string> {
  const paths = new Set<string>()
  for (const file of options.files) {
    const parts = file.relativePath.split('/')
    if (
      !file.relativePath.endsWith('.swift') || /[\\:\x00-\x1f\x7f]/.test(file.relativePath)
      || parts.some(part => !part || part === '.' || part === '..')
    ) {
      Errors.throwUserInput(`The watchOS source path must be a contained relative .swift path: ${file.relativePath}`)
    }
    const key = file.relativePath.normalize('NFC').toLowerCase()
    if (paths.has(key)) {
      Errors.throwUserInput(`The watchOS source path is duplicated: ${file.relativePath}`)
    }
    paths.add(key)
  }
  if (!options.files.some(file => file.relativePath === options.entryArtifact)) {
    Errors.throwUserInput('The watchOS entry artifact must name one of the supplied Swift files.')
  }
  // Read both inputs before writing output, so missing test artifacts leave no partial project.
  const tests = options.tests
    ? { source: await FS.readText(options.tests.source), plan: await FS.readText(options.tests.plan) }
    : undefined
  const bundleId = `com.devtao.preview.${options.appName.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'app'}`
  const outputs = [
    ...options.files.map(file => ({ path: `Sources/${file.relativePath}`, code: file.code })),
    { path: 'Info.plist', code: infoPlist() },
    {
      path: 'en.lproj/InfoPlist.strings',
      code: `CFBundleDisplayName = ${JSON.stringify(options.displayName ?? options.appName)};\n`,
    },
    { path: 'TaoWatch.xcodeproj/project.pbxproj', code: project(bundleId, options.files, tests !== undefined) },
    { path: 'TaoWatch.xcodeproj/xcshareddata/xcschemes/TaoWatch.xcscheme', code: scheme(tests !== undefined) },
    ...(tests
      ? [
        { path: 'Tests/WatchJourneyTests.swift', code: tests.source },
        { path: 'Tests/WatchJourneyPlan.json', code: tests.plan },
      ]
      : []),
  ]
  for (const output of outputs) {
    let path = options.outputRoot
    for (const component of ['', ...output.path.split('/')]) {
      path = FS.resolvePath(component, path)
      if (await FS.isSymbolicLink(path)) {
        Errors.throwUserInput(`The watchOS export cannot write through a symbolic link: ${path}`)
      }
    }
  }
  for (const output of outputs) {
    await FS.writeText(FS.resolvePath(output.path, options.outputRoot), output.code)
  }
  return FS.resolvePath('TaoWatch.xcodeproj', options.outputRoot)
}

function infoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>TaoWatch</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleName</key><string>TaoWatch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>10.0</string>
  <key>WKApplication</key><true/>
  <key>WKWatchOnly</key><true/>
</dict></plist>
`
}

function sourceId(index: number, kind: 'reference' | 'build'): string {
  return `${kind === 'reference' ? 'C' : 'D'}${index.toString(16).toUpperCase().padStart(23, '0')}`
}

function project(bundleId: string, files: readonly { relativePath: string }[], includeTests: boolean): string {
  const sourceReferences = files.map((_, index) => sourceId(index, 'reference')).join(', ')
  const sourceBuilds = files.map((_, index) => sourceId(index, 'build')).join(', ')
  const sourceObjects = files.map((file, index) => `
    ${sourceId(index, 'reference')} = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${
    JSON.stringify(`Sources/${file.relativePath}`)
  }; sourceTree = "<group>";};
    ${sourceId(index, 'build')} = {isa = PBXBuildFile; fileRef = ${sourceId(index, 'reference')};};`).join('')
  const settings = `ALWAYS_SEARCH_USER_PATHS = NO; CODE_SIGN_STYLE = Automatic; INFOPLIST_FILE = Info.plist;
    PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}"; PRODUCT_NAME = TaoWatch;
    SUPPORTED_PLATFORMS = "watchos watchsimulator"; TARGETED_DEVICE_FAMILY = 4;
    LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks");`
  return `// !$*UTF8*$!
{
  archiveVersion = 1;
  classes = {};
  objectVersion = 56;
  objects = {
    A00000000000000000000001 = {isa = PBXProject; attributes = {LastUpgradeCheck = 1600;}; buildConfigurationList = A00000000000000000000002; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en, Base); mainGroup = A00000000000000000000003; productRefGroup = A00000000000000000000004; projectDirPath = ""; projectRoot = ""; targets = (A00000000000000000000005${
    includeTests ? ', B00000000000000000000001' : ''
  });};
    A00000000000000000000002 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000006, A00000000000000000000007); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
    A00000000000000000000003 = {isa = PBXGroup; children = (${sourceReferences}, A0000000000000000000000F, A00000000000000000000004${
    includeTests ? ', B00000000000000000000003, B0000000000000000000000C' : ''
  }); sourceTree = "<group>";};
    A00000000000000000000004 = {isa = PBXGroup; children = (A0000000000000000000000A${
    includeTests ? ', B00000000000000000000002' : ''
  }); name = Products; sourceTree = "<group>";};
    A00000000000000000000005 = {isa = PBXNativeTarget; buildConfigurationList = A0000000000000000000000B; buildPhases = (A0000000000000000000000C, A0000000000000000000000D, A0000000000000000000000E); buildRules = (); dependencies = (); name = TaoWatch; productName = TaoWatch; productReference = A0000000000000000000000A; productType = "com.apple.product-type.application";};
    A00000000000000000000006 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = watchos; SWIFT_VERSION = 5.0; WATCHOS_DEPLOYMENT_TARGET = 10.0;}; name = Debug;};
    A00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = watchos; SWIFT_VERSION = 5.0; WATCHOS_DEPLOYMENT_TARGET = 10.0;}; name = Release;};
    A0000000000000000000000A = {isa = PBXFileReference; explicitFileType = wrapper.application; path = TaoWatch.app; sourceTree = BUILT_PRODUCTS_DIR;};
    A0000000000000000000000B = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000011, A00000000000000000000012); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
    A0000000000000000000000C = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${sourceBuilds}); runOnlyForDeploymentPostprocessing = 0;};
    A0000000000000000000000D = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;};
    A0000000000000000000000E = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000010); runOnlyForDeploymentPostprocessing = 0;};
    A0000000000000000000000F = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; path = "en.lproj/InfoPlist.strings"; sourceTree = "<group>";};
    A00000000000000000000010 = {isa = PBXBuildFile; fileRef = A0000000000000000000000F;};
    A00000000000000000000011 = {isa = XCBuildConfiguration; buildSettings = {${settings} SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;}; name = Debug;};
    A00000000000000000000012 = {isa = XCBuildConfiguration; buildSettings = {${settings}}; name = Release;};
    ${sourceObjects}
    ${includeTests ? testProjectObjects(bundleId) : ''}
  };
  rootObject = A00000000000000000000001;
}
`
}

function testProjectObjects(bundleId: string): string {
  const settings = `ALWAYS_SEARCH_USER_PATHS = NO; GENERATE_INFOPLIST_FILE = YES; TEST_TARGET_NAME = TaoWatch;
    PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}.uitests"; PRODUCT_NAME = TaoWatchUITests;
    CODE_SIGN_STYLE = Automatic; SUPPORTED_PLATFORMS = "watchos watchsimulator"; TARGETED_DEVICE_FAMILY = 4;
    LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks", "@loader_path/Frameworks");`
  return `B00000000000000000000001 = {isa = PBXNativeTarget; buildConfigurationList = B00000000000000000000006; buildPhases = (B00000000000000000000004, B00000000000000000000005, B0000000000000000000000E); buildRules = (); dependencies = (B00000000000000000000009); name = TaoWatchUITests; productName = TaoWatchUITests; productReference = B00000000000000000000002; productType = "com.apple.product-type.bundle.ui-testing";};
    B00000000000000000000002 = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = TaoWatchUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;};
    B00000000000000000000003 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "Tests/WatchJourneyTests.swift"; sourceTree = "<group>";};
    B00000000000000000000004 = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (B0000000000000000000000B); runOnlyForDeploymentPostprocessing = 0;};
    B00000000000000000000005 = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;};
    B00000000000000000000006 = {isa = XCConfigurationList; buildConfigurations = (B00000000000000000000007, B00000000000000000000008); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
    B00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = {${settings} SWIFT_OPTIMIZATION_LEVEL = "-Onone";}; name = Debug;};
    B00000000000000000000008 = {isa = XCBuildConfiguration; buildSettings = {${settings}}; name = Release;};
    B00000000000000000000009 = {isa = PBXTargetDependency; target = A00000000000000000000005; targetProxy = B0000000000000000000000A;};
    B0000000000000000000000A = {isa = PBXContainerItemProxy; containerPortal = A00000000000000000000001; proxyType = 1; remoteGlobalIDString = A00000000000000000000005; remoteInfo = TaoWatch;};
    B0000000000000000000000B = {isa = PBXBuildFile; fileRef = B00000000000000000000003;};
    B0000000000000000000000C = {isa = PBXFileReference; lastKnownFileType = text.json; path = "Tests/WatchJourneyPlan.json"; sourceTree = "<group>";};
    B0000000000000000000000D = {isa = PBXBuildFile; fileRef = B0000000000000000000000C;};
    B0000000000000000000000E = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (B0000000000000000000000D); runOnlyForDeploymentPostprocessing = 0;};`
}

function scheme(includeTests: boolean): string {
  const appReference =
    '<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000005" BuildableName="TaoWatch.app" BlueprintName="TaoWatch" ReferencedContainer="container:TaoWatch.xcodeproj"/>'
  const testReference =
    '<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="B00000000000000000000001" BuildableName="TaoWatchUITests.xctest" BlueprintName="TaoWatchUITests" ReferencedContainer="container:TaoWatch.xcodeproj"/>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${appReference}</BuildActionEntry>${
    includeTests
      ? `<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">${testReference}</BuildActionEntry>`
      : ''
  }</BuildActionEntries>
  </BuildAction>
  ${
    includeTests
      ? `<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${testReference}</TestableReference></Testables></TestAction>`
      : ''
  }
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">${appReference}</BuildableProductRunnable>
  </LaunchAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`
}
