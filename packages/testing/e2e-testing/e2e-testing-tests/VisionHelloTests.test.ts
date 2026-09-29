import { FS, Repo } from '@shared'
import { Expect, Test } from '@shared/test'

const visionHelloTestsPath = Repo.resolvePath(
  'packages/testing/e2e-testing/native/visionos/VisionHelloTests.swift',
)

Test('owns the VisionHello WKWebView XCTest next to the watchOS native journey sources', async () => {
  Expect(await FS.isFile(visionHelloTestsPath)).toBe(true)
  const source = await FS.readText(visionHelloTestsPath)
  Expect(source).toContain('final class VisionHelloTests: XCTestCase')
  Expect(source).toContain('testCounterInBundledWebKit')
  Expect(source).toContain('tao-app://bundle/index.html')
})
