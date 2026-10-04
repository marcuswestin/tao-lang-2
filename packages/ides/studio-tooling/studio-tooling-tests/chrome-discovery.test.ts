import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { findPlaywrightChromium } from '../studio-tooling-src/ChromeDiscovery'

Describe('Playwright Chromium discovery', () => {
  Test('prefers the chromium link, then the newest revision, and ignores an absent root', async () => {
    const root = await mkTestDir('tao-chrome-discovery-')
    try {
      Expect(await findPlaywrightChromium(undefined)).toBeUndefined()
      Expect(await findPlaywrightChromium(FS.resolvePath('missing', root))).toBeUndefined()
      Expect(await findPlaywrightChromium(root)).toBeUndefined()

      const older = FS.resolvePath('chromium-900/chrome-linux/chrome', root)
      const newer = FS.resolvePath('chromium-1194/chrome-linux/chrome', root)
      await FS.writeText(older, '')
      await FS.writeText(newer, '')
      await FS.writeText(FS.resolvePath('chromium_headless_shell-2000/chrome-linux/headless_shell', root), '')
      Expect(await findPlaywrightChromium(root)).toBe(newer)

      const linked = FS.resolvePath('chromium', root)
      await FS.symlink(older, linked)
      Expect(await findPlaywrightChromium(root)).toBe(linked)
    } finally {
      await FS.remove(root)
    }
  })
})
