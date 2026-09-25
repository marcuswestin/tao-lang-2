import { Errors, HCI, Platform } from '@shared'
import { StudioCdp } from '@studio-tooling/StudioCdp'

const url = Platform.runtimeProcess.argv[2]
if (url === undefined || !url.startsWith('http://127.0.0.1:')) {
  Errors.throwUserInput('Usage: standalone-browser-click <http://127.0.0.1:port/>')
}

try {
  HCI.writeLine('Standalone browser click: launching Chrome...')
  const browser = await StudioCdp.launchChrome({ useMockKeychain: true })
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
    const failures = browser.browserFailures()
    if (failures.length > 0) {
      Errors.throwHostEnvironment(`The browser reported errors: ${JSON.stringify(failures)}`)
    }
    HCI.writeLine('Standalone browser click: rendered 0, clicked Increment, then rendered 1 with no browser errors.')
  } finally {
    HCI.writeLine('Standalone browser click: closing Chrome...')
    await browser.close()
  }
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}
