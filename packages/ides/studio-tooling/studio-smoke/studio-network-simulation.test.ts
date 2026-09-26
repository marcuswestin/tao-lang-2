import { Errors, FS, HCI, Repo, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

/**
 * Proves, through Studio's own browser UI rather than the unit-tested runtime, the four behaviors
 * the last "Finish simulation mode in Tao Studio" proof gap named: an observable delay, an offline
 * cell, a declared fill failure, and cross-cell isolation. The fixture is a data-backed list (a
 * Studio scenario over an `Http` datasource) with a loading state, an error state, and one write
 * action nested inside the loaded list.
 *
 * Every condition is driven the way a Studio user drives it today: the single "Environment and
 * scenario" inspector panel that edits whichever cell is active (`TaoStudioClient.tao`'s
 * `StudioEnvironmentPanel`/`StudioScenarioEnvironment`). That panel's Network segmented control
 * covers normal, offline, and declared-failure ("error") outcomes plus latency, so no protocol-only
 * fallback is needed for any of the three conditions — including the declared fill failure, which
 * `Docs/Spec/Tao Studio.md` says has "no Tao scenario spelling" but does have a Studio UI control.
 */
Test(
  'Studio proves observable delay, offline, declared failure, and cross-cell isolation in a real browser',
  async () => {
    const repositoryRoot = Repo.getRoot()
    const projectRoot = await mkTestDir('tao-studio-network-simulation-')
    let browser: StudioCdp | undefined
    let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
    let step = 'launch'
    try {
      await FS.copyDirectory(
        FS.resolvePath('packages/ides/studio-tooling/studio-smoke/fixtures/studio-network-simulation', repositoryRoot),
        projectRoot,
      )
      studio = await startStudioSmokeLaunch({
        appName: 'NetworkSimApp',
        projectRoot,
        repositoryRoot,
      })
      browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
      await browser.setViewport(1_440, 900)
      await browser.goto(studio.readiness.sessionUrl)
      await browser.waitFor(`document.querySelectorAll('.studio-preview-cell').length === 2`, { timeoutMs: 30_000 })
      await browser.click('[data-preset="design"]')
      await browser.waitFor(
        `document.querySelector('[data-studio-section="Environment"] input[aria-label="Latency ms"]')?.checkVisibility() === true`,
      )
      await setInteractionMode(browser, 'run')

      // Baseline: both cells start online with no latency, so both load their fixture rows unaided.
      // The first bundle load per cell is a cold Metro compile, so this wait is generous; every later
      // wait in this file rereads an already-warm bundle and keeps the tighter default.
      step = 'baseline'
      const baselineSrcA = await cellIframeSrc(browser, 'cellA')
      const baselineSrcB = await cellIframeSrc(browser, 'cellB')
      await waitForPreviewText(
        browser,
        baselineSrcA,
        text => text.includes('Alpha item') && text.includes('Beta item'),
        {
          timeoutMs: 150_000,
        },
      )
      await waitForPreviewText(
        browser,
        baselineSrcB,
        text => text.includes('Alpha item') && text.includes('Beta item'),
        {
          timeoutMs: 150_000,
        },
      )
      await waitForEnvironmentPanel(browser, 0)

      // (a) Delay: a configured latency shows the loading state first, and the data only after
      // roughly that latency — asserted as an ordering plus a lower bound, never a tight upper bound.
      step = 'delay'
      const latencyMs = 1_800
      await applyCellNetwork(browser, 'cellA', { latencyMs, outcome: 'normal' })
      const delayedSrcA = await cellIframeSrc(browser, 'cellA')
      // Rows from the previous preview can still be observed after the iframe source changes.
      // Require this reload's loading state before accepting rows as the delayed result.
      // A final-state check before that transition can make this test pass without testing latency.
      await waitForPreviewText(browser, delayedSrcA, text => text.includes('Loading items'))
      const loadingSeenAt = Date.now()
      const loadedAfterDelay = await Time.pollUntil(async () => {
        const text = await browser!.evaluateInFrame<string>(delayedSrcA, `document.body?.textContent ?? ''`)
        return text.includes('Alpha item') && text.includes('Beta item')
      }, { intervalMs: 50, timeoutMs: 20_000 })
      Expect(loadedAfterDelay).toBe(true)
      Expect(Date.now() - loadingSeenAt).toBeGreaterThanOrEqual(latencyMs - 250)

      // (b) Offline: the cell shows its offline state, and the write action nested inside the loaded
      // list is not even reachable — the network condition only gates the query's remote fill, never
      // a local write, so isolation of the write has to come from the guard never reaching the list.
      step = 'offline'
      await applyCellNetwork(browser, 'cellA', { latencyMs: 0, outcome: 'offline' })
      const offlineSrcA = await cellIframeSrc(browser, 'cellA')
      const offlineMessage = "Tao Studio network is offline while filling 'Item'."
      await waitForPreviewText(browser, offlineSrcA, text => text.includes(offlineMessage))
      const removeButtonWhileOffline = await browser.evaluateInFrame<boolean>(
        offlineSrcA,
        `[...document.querySelectorAll('[data-tao-studio]')].some(element => element.textContent?.trim() === 'Remove')`,
      )
      Expect(removeButtonWhileOffline).toBe(false)

      // (c) Declared failure: a custom message set through the same Network control's "error" outcome
      // renders verbatim in the guard's error branch.
      step = 'declared-failure'
      const declaredMessage = 'Simulated Studio outage for Item.'
      await applyCellNetwork(browser, 'cellA', {
        errorMessage: declaredMessage,
        errorStatus: 502,
        latencyMs: 0,
        outcome: 'error',
      })
      const failureSrcA = await cellIframeSrc(browser, 'cellA')
      await waitForPreviewText(browser, failureSrcA, text => text.includes(declaredMessage))

      // (d) Cross-cell isolation: cellA offline and cellB online show different states at the same
      // time, and a write performed in cellB does not appear in cellA once cellA comes back online.
      // Both reads wait on their own settled state before the assertion reads them: cellB is idle
      // Studio's own business (the matrix suspends an off-margin cell's iframe to `about:blank` and
      // restores it on re-intersection — see `observePreviewVisibility` — so a cell already loaded at
      // baseline is not guaranteed to still be mounted here), never a fixed sleep standing in for it.
      step = 'isolation'
      await applyCellNetwork(browser, 'cellA', { latencyMs: 0, outcome: 'offline' })
      const isolationSrcA = await cellIframeSrc(browser, 'cellA')
      const [textA, textB] = await Promise.all([
        waitForPreviewText(browser, isolationSrcA, text => text.includes(offlineMessage)).then(() =>
          browser!.evaluateInFrame<string>(isolationSrcA, `document.body?.textContent ?? ''`)
        ),
        waitForPreviewText(browser, baselineSrcB, text => text.includes('Alpha item') && text.includes('Beta item'))
          .then(() => browser!.evaluateInFrame<string>(baselineSrcB, `document.body?.textContent ?? ''`)),
      ])
      Expect(textA).toContain(offlineMessage)
      Expect(textA).not.toContain('Alpha item')
      Expect(textB).toContain('Alpha item')
      Expect(textB).toContain('Beta item')

      step = 'write-in-cellB'
      await clickPreviewButton(browser, 'cellB', baselineSrcB, 'Remove')
      await waitForPreviewText(
        browser,
        baselineSrcB,
        text => !text.includes('Alpha item') && text.includes('Beta item'),
      )

      step = 'reconnect-cellA'
      await activateCell(browser, 'cellA')
      await waitForEnvironmentPanel(browser, 0)
      await applyCellNetwork(browser, 'cellA', { latencyMs: 0, outcome: 'normal' })
      const reconnectedSrcA = await cellIframeSrc(browser, 'cellA')
      await waitForPreviewText(
        browser,
        reconnectedSrcA,
        text => text.includes('Alpha item') && text.includes('Beta item'),
      )

      Expect(browser.browserFailures()).toEqual([])
    } catch (error) {
      if (browser !== undefined && studio !== undefined) {
        await captureFailureDiagnostics(browser, studio, step)
      }
      throw error
    } finally {
      await browser?.close()
      await studio?.stop()
      await FS.remove(projectRoot)
    }
  },
  450_000,
)

/**
 * On any failure, prints what a timeout or a single text read cannot: each cell's environment as
 * Studio's own manifest reports it, whether a cell's iframe is currently suspended to `about:blank`
 * (the matrix blanks a cell scrolled outside its canvas margin and restores it later — see
 * `observePreviewVisibility` in `StudioPreviewConnection.ts`), each cell's raw preview text when it
 * is not suspended, and the browser's own console/exception events.
 */
async function captureFailureDiagnostics(
  browser: StudioCdp,
  studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>>,
  step: string,
): Promise<void> {
  HCI.writeErrorLine(`--- Studio network-simulation failure diagnostics (step: ${step}) ---`)
  try {
    const manifestResponse = await fetch(`${studio.readiness.sessionUrl}/api/preview/manifest`)
    const manifest = await manifestResponse.json() as {
      cells?: readonly { cellId: string; cellRevision: number; environment: unknown }[]
    }
    HCI.writeErrorLine(`cells: ${JSON.stringify(manifest.cells, null, 2)}`)
  } catch (error) {
    HCI.writeErrorLine(`could not fetch the preview manifest: ${Errors.messageOf(error)}`)
  }
  for (const label of ['cellA', 'cellB'] as const) {
    try {
      const state = await browser.evaluate<{ src: string; suspended: boolean } | null>(`(() => {
        const frame = ${cellFrameExpr(label)}
        const iframe = frame?.querySelector('.studio-preview-cell-viewport iframe')
        return iframe instanceof HTMLIFrameElement
          ? { src: iframe.src, suspended: iframe.src === 'about:blank' }
          : null
      })()`)
      HCI.writeErrorLine(`${label} iframe: ${JSON.stringify(state)}`)
      if (state !== null && !state.suspended) {
        const text = await browser.evaluateInFrame<string>(state.src, `document.body?.textContent ?? ''`).catch(
          error => `<read failed: ${Errors.messageOf(error)}>`,
        )
        HCI.writeErrorLine(`${label} preview text: ${JSON.stringify(text)}`)
      }
    } catch (error) {
      HCI.writeErrorLine(`could not read ${label}: ${Errors.messageOf(error)}`)
    }
  }
  HCI.writeErrorLine(`browser console/exception events: ${JSON.stringify(browser.browserEvents(), null, 2)}`)
  HCI.writeErrorLine('--- end diagnostics ---')
}

function cellFrameExpr(label: string): string {
  return `[...document.querySelectorAll('.studio-preview-cell')].find(frame =>
    frame.querySelector('.studio-preview-cell-label')?.childNodes?.[0]?.textContent === ${JSON.stringify(label)})`
}

async function cellIframeSrc(browser: StudioCdp, label: string): Promise<string> {
  const src = await browser.evaluate<string | null>(`(() => {
    const frame = ${cellFrameExpr(label)}
    const iframe = frame?.querySelector('.studio-preview-cell-viewport iframe')
    return iframe instanceof HTMLIFrameElement ? iframe.src : null
  })()`)
  if (src === null) {
    Errors.throwHostEnvironment(`Missing Studio preview iframe for cell '${label}'.`)
  }
  return src
}

async function activateCell(browser: StudioCdp, label: string): Promise<void> {
  const point = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const frame = ${cellFrameExpr(label)}
    const header = frame?.querySelector('.studio-preview-cell-label')
    if (!(header instanceof HTMLElement)) throw new Error('Missing Studio preview cell header for ' + ${
    JSON.stringify(label)
  })
    header.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = header.getBoundingClientRect()
    return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 }
  })()`)
  await browser.clickAt(point)
}

/**
 * Replaces a text or number field's whole value with real keyboard input. Select-all followed by
 * insertion is unreliable on these controlled inputs — a click can land mid-string and insertText
 * then inserts at that caret rather than replacing the selection — so this clears the field one
 * Backspace at a time from its measured length instead.
 */
async function replaceFieldValue(browser: StudioCdp, selector: string, value: string): Promise<void> {
  await browser.click(selector)
  await browser.pressKey('End')
  const currentLength = await browser.evaluate<number>(
    `document.querySelector(${JSON.stringify(selector)})?.value?.length ?? 0`,
  )
  for (let index = 0; index < currentLength; index += 1) {
    await browser.pressKey('Backspace')
  }
  await browser.insertText(value)
}

/** Waits until the single active-cell Network control reflects a known latency, confirming the panel is ready. */
async function waitForEnvironmentPanel(browser: StudioCdp, expectedLatencyMs: number): Promise<void> {
  await browser.waitFor(
    `document.querySelector('[data-studio-section="Environment"] input[aria-label="Latency ms"]')?.value === ${
      JSON.stringify(String(expectedLatencyMs))
    }`,
    { timeoutMs: 15_000 },
  )
}

type CellNetworkDraft = Readonly<{
  errorMessage?: string
  errorStatus?: number
  latencyMs: number
  outcome: 'error' | 'normal' | 'offline'
}>

/**
 * Edits the currently active cell's Network control (the one place Studio exposes latency, offline,
 * and declared-failure simulation, per `Docs/Spec/Tao Studio.md`) and applies it. `cellA` is the
 * default active cell, so this file never needs to activate it explicitly except once, defensively,
 * after activating `cellB` for a write.
 */
async function applyCellNetwork(browser: StudioCdp, label: string, network: CellNetworkDraft): Promise<void> {
  const previousSrc = await cellIframeSrc(browser, label)
  const outcomeIndex = { error: 3, normal: 1, offline: 2 }[network.outcome]
  await browser.click(
    `[data-studio-section="Environment"] [aria-label="Network"][role="radiogroup"] button:nth-child(${outcomeIndex})`,
  )
  await replaceFieldValue(
    browser,
    '[data-studio-section="Environment"] input[aria-label="Latency ms"]',
    String(network.latencyMs),
  )
  if (network.outcome === 'error') {
    await replaceFieldValue(
      browser,
      '[data-studio-section="Environment"] input[aria-label="Error"]',
      network.errorMessage ?? 'Injected Studio network failure',
    )
    await replaceFieldValue(
      browser,
      '[data-studio-section="Environment"] input[aria-label="Status"]',
      String(network.errorStatus ?? 503),
    )
  }
  await browser.click('[data-studio-section="Environment"] button[data-variant="primary"]')
  await browser.waitFor(
    `(() => {
      const frame = ${cellFrameExpr(label)}
      const iframe = frame?.querySelector('.studio-preview-cell-viewport iframe')
      return iframe instanceof HTMLIFrameElement && iframe.src !== ${JSON.stringify(previousSrc)}
    })()`,
    { timeoutMs: 15_000 },
  )
}

async function waitForPreviewText(
  browser: StudioCdp,
  src: string,
  predicate: (text: string) => boolean,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  let last = ''
  const satisfied = await Time.pollUntil(async () => {
    last = await browser.evaluateInFrame<string>(src, `document.body?.textContent ?? ''`)
    return predicate(last)
  }, { intervalMs: 100, timeoutMs: options.timeoutMs ?? 20_000 })
  if (!satisfied) {
    Errors.throwHostEnvironment(`Timed out waiting for Studio preview text at ${src}; last=${JSON.stringify(last)}`)
  }
}

/**
 * Presses a real native control inside a cell's preview iframe with physical mouse input, mapped
 * through the iframe's own rect and canvas zoom the same way `studio-real-app.test.ts` presses the
 * generated app's own buttons: a synthetic `.click()` does not reach a Pressable-backed native control.
 */
async function clickPreviewButton(browser: StudioCdp, label: string, src: string, text: string): Promise<void> {
  const inFrame = await browser.evaluateInFrame<{ x: number; y: number }>(
    src,
    `(() => {
      const target = [...document.querySelectorAll('[data-tao-studio]')]
        .find(element => element.textContent?.trim() === ${JSON.stringify(text)})
      if (!(target instanceof HTMLElement)) throw new Error('Missing preview control: ' + ${JSON.stringify(text)})
      const rect = target.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`,
  )
  const point = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const frame = ${cellFrameExpr(label)}
    const iframe = frame?.querySelector('.studio-preview-cell-viewport iframe')
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error('Missing Studio preview iframe for cell ' + ${
    JSON.stringify(label)
  })
    const rect = iframe.getBoundingClientRect()
    const scale = iframe.clientWidth === 0 ? 1 : rect.width / iframe.clientWidth
    return { x: rect.left + (${inFrame.x}) * scale, y: rect.top + (${inFrame.y}) * scale }
  })()`)
  await browser.clickAt(point)
}

async function setInteractionMode(browser: StudioCdp, mode: 'edit' | 'run'): Promise<void> {
  await browser.evaluate(`(() => {
    const button = document.querySelector('.studio-interaction-mode')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing Studio interaction mode control')
    if (button.dataset.mode !== ${JSON.stringify(mode)}) button.click()
    return button.dataset.mode
  })()`)
}
