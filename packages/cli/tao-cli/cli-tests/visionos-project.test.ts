import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { exportVisionOSProject } from '../cli-src/visionos-project'

Describe('visionOS project export', () => {
  Test('retains a portable web snapshot and a project for device and simulator builds', async () => {
    const root = await mkTestDir('tao-visionos-project-')
    const siteRoot = FS.resolvePath('source', root)
    const outputRoot = FS.resolvePath('export', root)
    const html = '<!doctype html><script src="/_expo/static/js/web/app.js"></script><img src="/assets/icon.png">'
    const script = 'document.body.dataset.loaded = "Tao";\n'
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255])
    try {
      await FS.writeText(FS.resolvePath('index.html', siteRoot), html)
      await FS.writeText(FS.resolvePath('_expo/static/js/web/app.js', siteRoot), script)
      await FS.writeFile(FS.resolvePath('assets/icon.png', siteRoot), image)
      const project = await exportVisionOSProject({ appName: 'Hello Tao', outputRoot, siteRoot })
      await FS.remove(siteRoot)

      Expect(project).toBe(FS.resolvePath('TaoApp.xcodeproj', outputRoot))
      Expect(await FS.readText(FS.resolvePath('site/index.html', outputRoot))).toBe(html)
      Expect(await FS.readText(FS.resolvePath('site/_expo/static/js/web/app.js', outputRoot))).toBe(script)
      const configuration = await FS.readText(FS.resolvePath('project.pbxproj', project))
      Expect(configuration).toContain('SDKROOT = xros;')
      Expect(configuration).toContain('SUPPORTED_PLATFORMS = "xros xrsimulator";')
      Expect(configuration).toContain('PBXResourcesBuildPhase')
      Expect(configuration).toContain('site')
      Expect(configuration).not.toContain('TaoAppTests')
      Expect(await FS.exists(FS.resolvePath('TaoAppTests.swift', outputRoot))).toBe(false)
      Expect(await FS.isFile(FS.resolvePath('TaoApp.swift', outputRoot))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('xcshareddata/xcschemes/TaoApp.xcscheme', project))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('README.md', outputRoot))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('includes supplied native tests in a hosted test target and the shared scheme', async () => {
    const root = await mkTestDir('tao-visionos-native-tests-')
    const siteRoot = FS.resolvePath('source', root)
    const outputRoot = FS.resolvePath('export', root)
    const testSource = 'import XCTest\n@testable import TaoApp\nfinal class AppTests: XCTestCase {}\n'
    try {
      await FS.writeText(FS.resolvePath('index.html', siteRoot), '<!doctype html><p>Tao</p>')
      const project = await exportVisionOSProject({ appName: 'Hello Tao', outputRoot, siteRoot, testSource })
      Expect(await FS.readText(FS.resolvePath('TaoAppTests.swift', outputRoot))).toBe(testSource)
      const configuration = await FS.readText(FS.resolvePath('project.pbxproj', project))
      Expect(configuration).toContain('com.apple.product-type.bundle.unit-test')
      Expect(configuration).toContain('TEST_HOST = "$(BUILT_PRODUCTS_DIR)/TaoApp.app/TaoApp";')
      Expect(configuration).toContain('BUNDLE_LOADER = "$(TEST_HOST)";')
      Expect(configuration).toContain('ENABLE_TESTABILITY = YES;')
      Expect(configuration).toContain('path = TaoAppTests.swift;')
      Expect(configuration).toContain('PBXTargetDependency')
      const scheme = await FS.readText(FS.resolvePath('xcshareddata/xcschemes/TaoApp.xcscheme', project))
      Expect(scheme).toContain('<TestAction buildConfiguration="Debug"')
      Expect(scheme).toContain('<TestableReference skipped="NO">')
      Expect(scheme).toContain('BuildableName="TaoAppTests.xctest"')
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects an incomplete web export before creating a native project', async () => {
    const root = await mkTestDir('tao-visionos-missing-index-')
    const siteRoot = FS.resolvePath('source', root)
    const outputRoot = FS.resolvePath('export', root)
    try {
      await FS.writeText(FS.resolvePath('assets/app.js', siteRoot), 'document.body.textContent = "Tao"')
      const exported = exportVisionOSProject({ appName: 'Hello Tao', outputRoot, siteRoot })
      await Expect(exported).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
      await Expect(exported).rejects.toThrow('index.html')
      Expect(await FS.exists(outputRoot)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})
