import { Errors, FS } from '@shared'

/** Export a self-contained, windowed visionOS project using the existing Tao web runtime. */
export async function exportVisionOSProject(options: {
  appName: string
  outputRoot: string
  siteRoot: string
  testSource?: string
}): Promise<string> {
  if (!await FS.isFile(FS.resolvePath('index.html', options.siteRoot))) {
    Errors.throwHostEnvironment('The visionOS project requires an exported Tao web app with index.html.')
  }
  const bundleId = `com.devtao.preview.${options.appName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
  await FS.copyDirectory(options.siteRoot, FS.resolvePath('site', options.outputRoot))
  await FS.writeText(FS.resolvePath('TaoApp.swift', options.outputRoot), swiftHost)
  const includeTests = options.testSource !== undefined
  if (options.testSource !== undefined) {
    await FS.writeText(FS.resolvePath('TaoAppTests.swift', options.outputRoot), options.testSource)
  }
  await FS.writeText(
    FS.resolvePath('TaoApp.xcodeproj/project.pbxproj', options.outputRoot),
    project(bundleId, options.appName, includeTests),
  )
  await FS.writeText(
    FS.resolvePath('TaoApp.xcodeproj/xcshareddata/xcschemes/TaoApp.xcscheme', options.outputRoot),
    scheme(includeTests),
  )
  await FS.writeText(
    FS.resolvePath('README.md', options.outputRoot),
    `# ${options.appName} for visionOS

This experimental project embeds the compiled Tao web UI in a native SwiftUI window.
The bundled site needs no development server. Native Tao views, volumes, immersive spaces,
native data providers, device signing, and store distribution are outside this prototype.

Open TaoApp.xcodeproj in Xcode, select the TaoApp scheme and an Apple Vision Pro simulator,
then Run. Install the visionOS Simulator runtime in Xcode's Components settings if needed.
The simulator build does not require a development team. Select your own team and bundle
identifier before a device build. The current bundle identifier is ${bundleId}.

From this directory, a command-line simulator build is:

\`\`\`sh
xcodebuild -project TaoApp.xcodeproj -scheme TaoApp -sdk xrsimulator -destination 'generic/platform=visionOS Simulator' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
\`\`\`

The result is DerivedData/Build/Products/Debug-xrsimulator/TaoApp.app.
Re-run tao build --visionos after editing Tao source; this project is a frozen snapshot.
`,
  )
  return FS.resolvePath('TaoApp.xcodeproj', options.outputRoot)
}

// A custom origin preserves Expo's root-relative script and asset URLs without a server.
// Only files inside the bundled site are served; no remote navigation or native bridge is exposed.
const swiftHost = `import SwiftUI
import WebKit
import UniformTypeIdentifiers

@main
struct TaoApp: App {
    var body: some Scene {
        WindowGroup {
            TaoWindow()
        }
        .defaultSize(width: 640, height: 480)
    }
}

struct TaoWindow: View {
    @State private var failure: String?

    var body: some View {
        ZStack {
            TaoWebView(failure: $failure)
            if let failure {
                ContentUnavailableView("Unable to open app", systemImage: "exclamationmark.triangle", description: Text(failure))
            }
        }
    }
}

struct TaoWebView: UIViewRepresentable {
    @Binding var failure: String?

    func makeCoordinator() -> Coordinator { Coordinator(failure: $failure) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundledSite(), forURLScheme: "tao-app")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        #if DEBUG
        view.isInspectable = true
        #endif
        view.load(URLRequest(url: URL(string: "tao-app://bundle/index.html")!))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var failure: String?

        init(failure: Binding<String?>) { _failure = failure }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = action.request.url
            decisionHandler(url?.scheme == "tao-app" && url?.host == "bundle" ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failure = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failure = error.localizedDescription
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            failure = "The app's web content stopped. Close and reopen the window to retry."
        }
    }
}

final class BundledSite: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "bundle",
              let root = Bundle.main.resourceURL?.appendingPathComponent("site").resolvingSymlinksInPath() else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        let path = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/") else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }
        do {
            let data = try Data(contentsOf: file)
            let mime = file.pathExtension == "js" ? "application/javascript"
                : UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
            task.didReceive(data)
            task.didFinish()
        } catch {
            task.didFailWithError(error)
        }
    }

    // Reads finish synchronously, so there is no outstanding work to cancel.
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
`

function project(bundleId: string, appName: string, includeTests: boolean): string {
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
    A00000000000000000000003 = {isa = PBXGroup; children = (A00000000000000000000008, A00000000000000000000009, A00000000000000000000004${
    includeTests ? ', B00000000000000000000003' : ''
  }); sourceTree = "<group>";};
    A00000000000000000000004 = {isa = PBXGroup; children = (A0000000000000000000000A${
    includeTests ? ', B00000000000000000000002' : ''
  }); name = Products; sourceTree = "<group>";};
    A00000000000000000000005 = {isa = PBXNativeTarget; buildConfigurationList = A0000000000000000000000B; buildPhases = (A0000000000000000000000C, A0000000000000000000000D, A0000000000000000000000E); buildRules = (); dependencies = (); name = TaoApp; productName = TaoApp; productReference = A0000000000000000000000A; productType = "com.apple.product-type.application";};
    A00000000000000000000006 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = xros; SWIFT_VERSION = 5.0; XROS_DEPLOYMENT_TARGET = 2.0;}; name = Debug;};
    A00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = xros; SWIFT_VERSION = 5.0; XROS_DEPLOYMENT_TARGET = 2.0;}; name = Release;};
    A00000000000000000000008 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = TaoApp.swift; sourceTree = "<group>";};
    A00000000000000000000009 = {isa = PBXFileReference; lastKnownFileType = folder; path = site; sourceTree = "<group>";};
    A0000000000000000000000A = {isa = PBXFileReference; explicitFileType = wrapper.application; path = TaoApp.app; sourceTree = BUILT_PRODUCTS_DIR;};
    A0000000000000000000000B = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000011, A00000000000000000000012); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
    A0000000000000000000000C = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A0000000000000000000000F); runOnlyForDeploymentPostprocessing = 0;};
    A0000000000000000000000D = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;};
    A0000000000000000000000E = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000010); runOnlyForDeploymentPostprocessing = 0;};
    A0000000000000000000000F = {isa = PBXBuildFile; fileRef = A00000000000000000000008;};
    A00000000000000000000010 = {isa = PBXBuildFile; fileRef = A00000000000000000000009;};
    A00000000000000000000011 = {isa = XCBuildConfiguration; buildSettings = {${
    buildSettings(bundleId, appName)
  } ENABLE_TESTABILITY = YES; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;}; name = Debug;};
    A00000000000000000000012 = {isa = XCBuildConfiguration; buildSettings = {${
    buildSettings(bundleId, appName)
  }}; name = Release;};
    ${includeTests ? testProjectObjects(bundleId) : ''}
  };
  rootObject = A00000000000000000000001;
}
`
}

function buildSettings(bundleId: string, appName: string): string {
  return `ALWAYS_SEARCH_USER_PATHS = NO; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES;
    INFOPLIST_KEY_CFBundleDisplayName = ${JSON.stringify(appName)};
    INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
    INFOPLIST_KEY_UIApplicationPreferredDefaultSceneSessionRole = UIWindowSceneSessionRoleApplication;
    MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}"; PRODUCT_NAME = TaoApp;
    SUPPORTED_PLATFORMS = "xros xrsimulator"; TARGETED_DEVICE_FAMILY = 7;`
}

function scheme(includeTests: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000005" BuildableName="TaoApp.app" BlueprintName="TaoApp" ReferencedContainer="container:TaoApp.xcodeproj"/>
    </BuildActionEntry>${
    includeTests
      ? `<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="B00000000000000000000001" BuildableName="TaoAppTests.xctest" BlueprintName="TaoAppTests" ReferencedContainer="container:TaoApp.xcodeproj"/></BuildActionEntry>`
      : ''
  }</BuildActionEntries>
  </BuildAction>
  ${
    includeTests
      ? `<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
    <Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="B00000000000000000000001" BuildableName="TaoAppTests.xctest" BlueprintName="TaoAppTests" ReferencedContainer="container:TaoApp.xcodeproj"/></TestableReference></Testables>
  </TestAction>`
      : ''
  }
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000005" BuildableName="TaoApp.app" BlueprintName="TaoApp" ReferencedContainer="container:TaoApp.xcodeproj"/></BuildableProductRunnable>
  </LaunchAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`
}

function testProjectObjects(bundleId: string): string {
  const settings =
    `ALWAYS_SEARCH_USER_PATHS = NO; BUNDLE_LOADER = "$(TEST_HOST)"; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/TaoApp.app/TaoApp";
    GENERATE_INFOPLIST_FILE = YES; PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}.tests"; PRODUCT_NAME = TaoAppTests;
    CODE_SIGN_STYLE = Automatic; SUPPORTED_PLATFORMS = "xros xrsimulator"; TARGETED_DEVICE_FAMILY = 7;
    LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks", "@loader_path/Frameworks");`
  return `B00000000000000000000001 = {isa = PBXNativeTarget; buildConfigurationList = B00000000000000000000006; buildPhases = (B00000000000000000000004, B00000000000000000000005); buildRules = (); dependencies = (B00000000000000000000009); name = TaoAppTests; productName = TaoAppTests; productReference = B00000000000000000000002; productType = "com.apple.product-type.bundle.unit-test";};
    B00000000000000000000002 = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = TaoAppTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;};
    B00000000000000000000003 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = TaoAppTests.swift; sourceTree = "<group>";};
    B00000000000000000000004 = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (B0000000000000000000000B); runOnlyForDeploymentPostprocessing = 0;};
    B00000000000000000000005 = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;};
    B00000000000000000000006 = {isa = XCConfigurationList; buildConfigurations = (B00000000000000000000007, B00000000000000000000008); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
    B00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = {${settings} SWIFT_OPTIMIZATION_LEVEL = "-Onone";}; name = Debug;};
    B00000000000000000000008 = {isa = XCBuildConfiguration; buildSettings = {${settings}}; name = Release;};
    B00000000000000000000009 = {isa = PBXTargetDependency; target = A00000000000000000000005; targetProxy = B0000000000000000000000A;};
    B0000000000000000000000A = {isa = PBXContainerItemProxy; containerPortal = A00000000000000000000001; proxyType = 1; remoteGlobalIDString = A00000000000000000000005; remoteInfo = TaoApp;};
    B0000000000000000000000B = {isa = PBXBuildFile; fileRef = B00000000000000000000003;};`
}
