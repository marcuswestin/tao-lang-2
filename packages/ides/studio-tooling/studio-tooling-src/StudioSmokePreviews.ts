import type { StudioCdp } from './StudioCdp'

/** Activates the listed cells a real-Metro smoke uses, through each cell's own toggle. */
export async function activateSmokePreviews(browser: StudioCdp): Promise<void> {
  await browser.waitFor("document.querySelector('.studio-preview-activation-toggle') !== null")
  const cellIds = await browser.evaluate<string[]>(
    "[...document.querySelectorAll('.studio-preview-cell')].filter(cell => cell.querySelector('.studio-preview-activation-toggle')).map(cell => cell.dataset.taoStudioCell ?? cell.dataset.cellId)",
  )
  for (const cellId of cellIds) {
    const toggle =
      `[...document.querySelectorAll('.studio-preview-cell')].find(cell => (cell.dataset.taoStudioCell ?? cell.dataset.cellId) === ${
        JSON.stringify(cellId)
      })?.querySelector('.studio-preview-activation-toggle')`
    await browser.evaluate(`(() => {
      const toggle = ${toggle}
      if (toggle instanceof HTMLButtonElement && toggle.getAttribute('aria-pressed') === 'false') toggle.click()
    })()`)
    await browser.waitFor(`(${toggle})?.getAttribute('aria-pressed') === 'true'`)
  }
}
