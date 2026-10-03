import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { exportWatchOSProject } from '../cli-src/watchos-project'

const files = [
  {
    relativePath: 'Entry.swift',
    code: 'import SwiftUI\n@main struct WatchApp: App { var body: some Scene { WindowGroup { Home() } } }\n',
  },
  {
    relativePath: 'Views/Home.swift',
    code: 'import SwiftUI\nstruct Home: View { var body: some View { Text("Tao") } }\n',
  },
]

Describe('watchOS project export', () => {
  Test('packages compiler sources in a portable standalone watch app with an escaped display name', async () => {
    const root = await mkTestDir('tao-watchos-project-')
    try {
      const outputRoot = FS.resolvePath('export', root)
      const project = await exportWatchOSProject({
        appName: 'Hello <Tao> & "Watch" $(PRODUCT_NAME)',
        outputRoot,
        files,
        entryArtifact: 'Entry.swift',
      })
      Expect(project).toBe(FS.resolvePath('TaoWatch.xcodeproj', outputRoot))
      Expect(await FS.readText(FS.resolvePath('Sources/Entry.swift', outputRoot))).toBe(files[0]!.code)
      Expect(await FS.readText(FS.resolvePath('Sources/Views/Home.swift', outputRoot))).toBe(files[1]!.code)
      const configuration = await FS.readText(FS.resolvePath('project.pbxproj', project))
      Expect(configuration).toContain('SDKROOT = watchos;')
      Expect(configuration).toContain('WATCHOS_DEPLOYMENT_TARGET = 10.0;')
      Expect(configuration).toContain('SUPPORTED_PLATFORMS = "watchos watchsimulator";')
      Expect(configuration).toContain('TARGETED_DEVICE_FAMILY = 4;')
      Expect(configuration).toContain('productType = "com.apple.product-type.application";')
      Expect(configuration).toContain('path = "Sources/Entry.swift";')
      Expect(configuration).toContain('path = "Sources/Views/Home.swift";')
      Expect(configuration).toContain('files = (D00000000000000000000000, D00000000000000000000001);')
      Expect(configuration).toContain('path = "en.lproj/InfoPlist.strings";')
      Expect(configuration).toContain('files = (A00000000000000000000010);')
      Expect(configuration).not.toContain(root)
      Expect(configuration).not.toContain('TaoWatchUITests')
      Expect(await FS.exists(FS.resolvePath('Tests', outputRoot))).toBe(false)
      const plist = await FS.readText(FS.resolvePath('Info.plist', outputRoot))
      Expect(plist).toContain('<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>')
      Expect(plist).not.toContain('CFBundleDisplayName')
      Expect(await FS.readText(FS.resolvePath('en.lproj/InfoPlist.strings', outputRoot))).toBe(
        'CFBundleDisplayName = "Hello <Tao> & \\"Watch\\" $(PRODUCT_NAME)";\n',
      )
      Expect(plist).toContain('<key>WKApplication</key><true/>')
      Expect(plist).toContain('<key>MinimumOSVersion</key><string>10.0</string>')
      Expect(plist).toContain('<key>WKWatchOnly</key><true/>')
      Expect(plist).not.toContain('WKRunsIndependentlyOfCompanionApp')
      const scheme = await FS.readText(FS.resolvePath('xcshareddata/xcschemes/TaoWatch.xcscheme', project))
      Expect(scheme).toContain('BuildableName="TaoWatch.app" BlueprintName="TaoWatch"')
      Expect(scheme).not.toContain('<TestAction')
    } finally {
      await FS.remove(root)
    }
  })

  Test('copies the shared interpreter and journey resource into an independent UI-testing target', async () => {
    const root = await mkTestDir('tao-watchos-tests-')
    try {
      const source = FS.resolvePath('input/Interpreter.swift', root)
      const plan = FS.resolvePath('input/Plan.json', root)
      const outputRoot = FS.resolvePath('export', root)
      const sourceText = 'import XCTest\nfinal class WatchJourneyTests: XCTestCase {}\n'
      const planText = '{"version":1,"operations":[]}\n'
      await FS.writeText(source, sourceText)
      await FS.writeText(plan, planText)
      const project = await exportWatchOSProject({
        appName: 'Hello Tao',
        outputRoot,
        files,
        entryArtifact: 'Entry.swift',
        tests: { source, plan },
      })
      await FS.remove(FS.resolvePath('input', root))
      Expect(await FS.readText(FS.resolvePath('Tests/WatchJourneyTests.swift', outputRoot))).toBe(sourceText)
      Expect(await FS.readText(FS.resolvePath('Tests/WatchJourneyPlan.json', outputRoot))).toBe(planText)
      const configuration = await FS.readText(FS.resolvePath('project.pbxproj', project))
      Expect(configuration).toContain('com.apple.product-type.bundle.ui-testing')
      Expect(configuration).toContain('TEST_TARGET_NAME = TaoWatch;')
      Expect(configuration).toContain('PRODUCT_BUNDLE_IDENTIFIER = "com.devtao.preview.hello-tao.uitests";')
      Expect(configuration).toContain('path = "Tests/WatchJourneyTests.swift";')
      Expect(configuration).toContain('path = "Tests/WatchJourneyPlan.json";')
      Expect(configuration).toContain(
        'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (B0000000000000000000000D);',
      )
      Expect(configuration).toContain('PBXTargetDependency')
      Expect(configuration).not.toContain('bundle.unit-test')
      Expect(configuration).not.toContain('TEST_HOST')
      Expect(configuration).not.toContain('BUNDLE_LOADER')
      Expect(configuration).not.toContain(root)
      const scheme = await FS.readText(FS.resolvePath('xcshareddata/xcschemes/TaoWatch.xcscheme', project))
      Expect(scheme).toContain('<TestAction buildConfiguration="Debug"')
      Expect(scheme).toContain('<TestableReference skipped="NO">')
      Expect(scheme).toContain('BuildableName="TaoWatchUITests.xctest"')
    } finally {
      await FS.remove(root)
    }
  })

  Test('uses the compiled display name while retaining the app name for the bundle identifier', async () => {
    const root = await mkTestDir('tao-watchos-display-name-')
    try {
      const project = await exportWatchOSProject({
        appName: 'WatchHello',
        displayName: 'Rep Counter',
        outputRoot: root,
        files,
        entryArtifact: 'Entry.swift',
      })
      Expect(await FS.readText(FS.resolvePath('en.lproj/InfoPlist.strings', root))).toBe(
        'CFBundleDisplayName = "Rep Counter";\n',
      )
      Expect(await FS.readText(FS.resolvePath('project.pbxproj', project))).toContain(
        'PRODUCT_BUNDLE_IDENTIFIER = "com.devtao.preview.watchhello";',
      )
    } finally {
      await FS.remove(root)
    }
  })

  for (
    const relativePath of [
      '/Escape.swift',
      'Views/../../Escape.swift',
      'Views\\Escape.swift',
      'C:/Escape.swift',
      './Entry.swift',
      'Views//Entry.swift',
      'Entry.ts',
      'Entry\0.swift',
    ]
  ) {
    Test(`rejects unsafe or non-Swift source path ${JSON.stringify(relativePath)} before writing`, async () => {
      const root = await mkTestDir('tao-watchos-path-')
      try {
        const outputRoot = FS.resolvePath('export', root)
        const exported = exportWatchOSProject({
          appName: 'Tao',
          outputRoot,
          files: [{ relativePath, code: '' }],
          entryArtifact: relativePath,
        })
        await Expect(exported).rejects.toBeInstanceOf(Errors.UserInputError)
        Expect(await FS.exists(outputRoot)).toBe(false)
      } finally {
        await FS.remove(root)
      }
    })
  }

  Test('rejects duplicate paths on case-insensitive filesystems and missing entry artifacts', async () => {
    const root = await mkTestDir('tao-watchos-invalid-')
    try {
      const outputRoot = FS.resolvePath('export', root)
      await Expect(exportWatchOSProject({
        appName: 'Tao',
        outputRoot,
        files: [...files, { relativePath: 'entry.swift', code: '' }],
        entryArtifact: 'Entry.swift',
      })).rejects.toThrow('duplicated')
      await Expect(exportWatchOSProject({
        appName: 'Tao',
        outputRoot,
        files,
        entryArtifact: 'Missing.swift',
      })).rejects.toThrow('entry artifact')
      Expect(await FS.exists(outputRoot)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects an output symlink before it can replace a file outside the export', async () => {
    const root = await mkTestDir('tao-watchos-symlink-')
    try {
      const outputRoot = FS.resolvePath('export', root)
      const outside = FS.resolvePath('outside', root)
      await FS.writeText(FS.resolvePath('Entry.swift', outside), 'keep this source')
      await FS.symlink(outside, FS.resolvePath('Sources', outputRoot))
      await Expect(exportWatchOSProject({
        appName: 'Tao',
        outputRoot,
        files,
        entryArtifact: 'Entry.swift',
      })).rejects.toThrow('symbolic link')
      Expect(await FS.readText(FS.resolvePath('Entry.swift', outside))).toBe('keep this source')
      Expect(await FS.exists(FS.resolvePath('TaoWatch.xcodeproj', outputRoot))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('escapes quoted Swift paths in project references', async () => {
    const root = await mkTestDir('tao-watchos-quoted-path-')
    try {
      const project = await exportWatchOSProject({
        appName: 'Tao',
        outputRoot: root,
        files: [{ relativePath: 'Views/"Quoted" View.swift', code: 'import SwiftUI\n' }],
        entryArtifact: 'Views/"Quoted" View.swift',
      })
      Expect(await FS.readText(FS.resolvePath('Sources/Views/"Quoted" View.swift', root))).toBe('import SwiftUI\n')
      Expect(await FS.readText(FS.resolvePath('project.pbxproj', project))).toContain(
        'path = "Sources/Views/\\"Quoted\\" View.swift";',
      )
    } finally {
      await FS.remove(root)
    }
  })
})
