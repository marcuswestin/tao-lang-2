import { Errors, FS, HCI, Platform } from '@shared'
import { StudioCdp } from '@studio-tooling/StudioCdp'

const url = Platform.runtimeProcess.argv[2]
const appFile = Platform.runtimeProcess.argv[3]
const evidence = Platform.runtimeProcess.argv[4]
if (url === undefined || !url.startsWith('http://127.0.0.1:')) {
  Errors.throwUserInput('Usage: standalone-browser-click <http://127.0.0.1:port/>')
}

try {
  HCI.writeLine('Standalone browser click: launching Chrome...')
  const browserStarted = Date.now()
  const browser = await StudioCdp.launchChrome({
    // A fresh macOS guest assesses the entire signed bundle before its first instruction executes.
    startupTimeoutMs: 120_000,
    useMockKeychain: true,
    onProfileCreated: async profile => {
      if (evidence !== undefined) {
        const scopePath = FS.resolvePath('audit-scope.json', evidence)
        if (await FS.isFile(scopePath)) {
          const scope = await FS.readJson<Record<string, unknown>>(scopePath)
          await FS.writeJson(scopePath, { ...scope, browserProfiles: [await FS.realPath(profile)] })
        }
      }
    },
  })
  HCI.writeLine(`Standalone browser click: Chrome ready in ${Date.now() - browserStarted}ms.`)
  let originalSource: string | undefined
  try {
    HCI.writeLine(`Standalone browser click: opening ${url}...`)
    await browser.goto(url)
    HCI.writeLine('Standalone browser click: waiting for the initial counter...')
    await browser.waitFor("document.body.textContent?.includes('Browser clicks: 0') === true", {
      timeoutMs: 60_000,
    })
    HCI.writeLine('Standalone browser click: clicking Increment...')
    await browser.click('[aria-label="Increment"]')
    HCI.writeLine('Standalone browser click: waiting for the updated counter...')
    await browser.waitFor("document.body.textContent?.includes('Browser clicks: 1') === true", {
      timeoutMs: 30_000,
    })
    await browser.click('[aria-label="Increment"]')
    await browser.waitFor("document.body.textContent?.includes('Browser clicks: 2') === true")
    HCI.writeLine('Standalone browser click: a second click rendered 2; reloading...')
    await browser.goto(url)
    await browser.waitFor("document.body.textContent?.includes('Browser clicks: 0') === true")
    if (appFile !== undefined) {
      originalSource = await FS.readText(appFile)
      if (!originalSource.includes('Browser clicks:')) {
        Errors.throwUnexpected('The live-edit fixture has no Browser clicks label.')
      }
      HCI.writeLine('Standalone browser click: editing Tao source and waiting for live reload...')
      await FS.writeText(appFile, originalSource.replace('Browser clicks:', 'Browser updated:'))
      await browser.waitFor("document.body.textContent?.includes('Browser updated:') === true", { timeoutMs: 120_000 })
      await browser.click('[aria-label="Increment"]')
      await browser.waitFor("document.body.textContent?.includes('Browser updated: 1') === true")
    }
    const failures = browser.browserFailures()
    if (failures.length > 0) {
      Errors.throwHostEnvironment(`The browser reported errors: ${JSON.stringify(failures)}`)
    }
    if (evidence !== undefined) {
      await FS.writeJson(FS.resolvePath('browser-events.json', evidence), browser.browserFailures())
      await browser.captureScreenshotAt(FS.resolvePath('browser-passed.png', evidence))
    }
    HCI.writeLine(
      `Standalone browser click: repeated clicks and reload${
        appFile === undefined ? '' : ', plus source editing'
      } passed with no browser errors.`,
    )
  } catch (error) {
    if (evidence !== undefined) {
      try {
        await FS.writeJson(FS.resolvePath('browser-events.json', evidence), browser.browserFailures())
        await browser.captureScreenshotAt(FS.resolvePath('browser-failed.png', evidence))
      } catch (captureError) {
        HCI.writeErrorLine(`Browser evidence capture failed: ${Errors.formatForUser(captureError)}`)
      }
    }
    throw error
  } finally {
    try {
      if (appFile !== undefined && originalSource !== undefined) {
        await FS.writeText(appFile, originalSource)
      }
    } finally {
      HCI.writeLine('Standalone browser click: closing Chrome...')
      await browser.close()
    }
  }
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}
