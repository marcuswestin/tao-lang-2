import { Errors, FS, Platform, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import { StudioCdp } from '../dev-src/studio/StudioCdp'

type DialogBrowserState = Readonly<{
  activeId: string
  authoredAriaHidden: string | null
  authoredInert: boolean
  abortTriggered: boolean
  backdropCount: number
  defaultAriaHidden: string | null
  defaultInert: boolean
  modalCount: number
  result: string | undefined
  settled: string | undefined
}>

Test('Studio dialog teardown cancels its answer and restores the live ProductHost in Chrome', async () => {
  const repositoryRoot = Repo.getRoot()
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-dialog-browser/local', repositoryRoot)
  await FS.mkdir(artifactRoot)

  const build = await Bun.build({
    entrypoints: [
      FS.resolvePath('packages/studio/studio-tests/fixtures/studio-dialog-browser.ts', repositoryRoot),
    ],
    minify: false,
    target: 'browser',
  })
  Expect(build.success).toBe(true)
  const output = build.outputs.find(candidate => candidate.path.endsWith('.js'))
  if (output === undefined) {
    Errors.throwUnexpected('The Studio dialog browser fixture did not produce JavaScript.')
  }
  const javascript = await output.text()
  const server = startDialogFixtureServer(javascript, smokePort())
  let browser: StudioCdp | undefined
  try {
    browser = await StudioCdp.launchChrome({ artifactRoot })
    await browser.setViewport(960, 720)
    await browser.goto(server.url)
    await browser.waitFor("document.documentElement.dataset.fixtureReady === 'true'")

    // This physical click establishes the connected focus target which teardown must restore.
    await browser.click('#open-confirm')
    await browser.waitFor(`document.querySelector('.studio-dialog[aria-modal="true"]') instanceof HTMLElement`)
    Expect(await dialogState(browser)).toEqual({
      activeId: '',
      authoredAriaHidden: 'true',
      authoredInert: true,
      abortTriggered: false,
      backdropCount: 1,
      defaultAriaHidden: 'true',
      defaultInert: true,
      modalCount: 1,
      result: undefined,
      settled: 'false',
    })
    Expect(
      await browser.evaluate<string>(
        "document.activeElement?.closest('.studio-dialog')?.getAttribute('aria-modal') ?? ''",
      ),
    ).toBe('true')

    // This remains outside the ProductHost scope, just as a host-owned teardown signal does.
    await browser.click('#abort-dialog')
    await browser.waitFor(`document.querySelector('.studio-dialog-backdrop') === null
      && document.querySelector('#dialog-result')?.getAttribute('data-settled') === 'true'`)
    Expect(await dialogState(browser)).toEqual({
      activeId: 'open-confirm',
      authoredAriaHidden: 'false',
      authoredInert: false,
      abortTriggered: true,
      backdropCount: 0,
      defaultAriaHidden: null,
      defaultInert: false,
      modalCount: 0,
      result: 'false',
      settled: 'true',
    })
    Expect(browser.browserFailures()).toEqual([])
    Expect(browser.consoleErrors()).toEqual([])
    await browser.captureScreenshot('studio-dialog-teardown')
  } finally {
    await browser?.close()
    server.stop()
  }
}, 60_000)

async function dialogState(browser: StudioCdp): Promise<DialogBrowserState> {
  return await browser.evaluate<DialogBrowserState>(`(() => {
    const defaultBackground = document.querySelector('#open-confirm')
    const authoredBackground = document.querySelector('#authored-background')
    const result = document.querySelector('#dialog-result')
    return {
      activeId: document.activeElement?.id ?? '',
      authoredAriaHidden: authoredBackground?.getAttribute('aria-hidden') ?? null,
      authoredInert: authoredBackground instanceof HTMLElement && authoredBackground.inert,
      abortTriggered: document.documentElement.dataset.abortClicked === 'true',
      backdropCount: document.querySelectorAll('.studio-dialog-backdrop').length,
      defaultAriaHidden: defaultBackground?.getAttribute('aria-hidden') ?? null,
      defaultInert: defaultBackground instanceof HTMLElement && defaultBackground.inert,
      modalCount: document.querySelectorAll('.studio-dialog[aria-modal="true"]').length,
      result: result instanceof HTMLElement ? result.dataset.answer : undefined,
      settled: result instanceof HTMLElement ? result.dataset.settled : undefined,
    }
  })()`)
}

function startDialogFixtureServer(javascript: string, port: number): { stop(): void; url: string } {
  const server = Bun.serve({
    fetch(request) {
      if (new URL(request.url).pathname === '/fixture.js') {
        return new Response(javascript, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
      }
      return new Response(fixtureHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
    hostname: '127.0.0.1',
    port,
  })
  return { stop: () => server.stop(true), url: `http://127.0.0.1:${port}` }
}

function smokePort(): number {
  const value = Number(Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_SERVER_PORT'] ?? 42_010)
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    Errors.throwUserInput('TAO_STUDIO_SMOKE_SERVER_PORT must be a valid TCP port.')
  }
  return value
}

const fixtureHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Studio dialog browser acceptance</title>
    <style>
      body { font: 16px system-ui; margin: 24px; }
      button { margin: 8px; padding: 8px 12px; }
      #abort-dialog { position: relative; z-index: 2; }
      #product-host { border: 1px solid #888; min-height: 240px; padding: 16px; }
      .studio-dialog-backdrop { align-items: center; background: rgb(0 0 0 / 35%); display: flex; inset: 0; justify-content: center; position: fixed; z-index: 1; }
      .studio-dialog { background: white; border: 1px solid #444; padding: 24px; }
    </style>
  </head>
  <body>
    <button id="abort-dialog" type="button">Abort ProductHost dialog</button>
    <main id="product-host">
      <button id="open-confirm" type="button">Open confirmation</button>
      <section id="authored-background" aria-hidden="false">Authored background state</section>
      <output id="dialog-result">idle</output>
    </main>
    <script src="/fixture.js"></script>
  </body>
</html>`
