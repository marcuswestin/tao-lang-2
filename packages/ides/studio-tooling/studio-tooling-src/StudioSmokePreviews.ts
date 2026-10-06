import { Errors } from '@shared'
import type { StudioCdp } from './StudioCdp'

/** Activates the listed cells a real-Metro smoke uses, through each cell's own toggle. */
export async function activateSmokePreviews(browser: StudioCdp, requestedCellIds?: readonly string[]): Promise<void> {
  // The first toggle waits on Studio's first page load and render, which a full lane's CPU
  // contention stretches well past the default bound.
  await browser.waitFor("document.querySelector('.studio-preview-activation-toggle') !== null", { timeoutMs: 120_000 })
  const availableCellIds = await browser.evaluate<string[]>(
    "[...document.querySelectorAll('.studio-preview-cell')].filter(cell => cell.querySelector('.studio-preview-activation-toggle')).map(cell => cell.dataset.taoStudioCell ?? cell.dataset.cellId)",
  )
  for (const cellId of requestedCellIds ?? availableCellIds) {
    if (!availableCellIds.includes(cellId)) {
      Errors.throwHostEnvironment(`Missing Studio preview activation control for ${cellId}.`)
    }
    const toggle =
      `[...document.querySelectorAll('.studio-preview-cell')].find(cell => (cell.dataset.taoStudioCell ?? cell.dataset.cellId) === ${
        JSON.stringify(cellId)
      })?.querySelector('.studio-preview-activation-toggle')`
    await browser.waitFor(`(${toggle}) instanceof HTMLButtonElement && !(${toggle}).disabled`)
    await browser.evaluate(`(() => {
      const toggle = ${toggle}
      if (toggle instanceof HTMLButtonElement && toggle.getAttribute('aria-pressed') === 'false') toggle.click()
    })()`)
    try {
      // Activation may spend 30 seconds on readiness before registration and the session write.
      await browser.waitFor(`(${toggle})?.getAttribute('aria-pressed') === 'true'`, { timeoutMs: 120_000 })
    } catch (error) {
      const state = await browser.evaluate(`(() => {
        const toggle = ${toggle}
        return {
          exists: toggle instanceof HTMLButtonElement,
          disabled: toggle?.disabled,
          pressed: toggle?.getAttribute('aria-pressed'),
          title: toggle?.title,
          status: document.querySelector('.studio-status')?.textContent,
        }
      })()`)
      Errors.throwHostEnvironment(`Preview activation failed for ${cellId}: ${JSON.stringify(state)}`, { cause: error })
    }
  }
}
