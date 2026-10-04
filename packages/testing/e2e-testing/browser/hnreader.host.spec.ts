import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Errors, Platform } from '@shared'

test.describe('HNReader real host', () => {
  // REMOVAL CANDIDATE: The authored browser journey may cover this flow; removal also needs the fault-signature contract to stop requiring both proofs.
  test('opens a story, returns through browser-visible navigation, and keeps reading history after reload', async ({ page }) => {
    const { runId, seed } = configuredHost()
    await page.goto('/')
    await expect(page.getByText(`Host ready: run ${runId} · seed ${seed}`, { exact: true })).toBeVisible()
    await expect(page.getByText('Show HN: A Tao reader', { exact: true })).toBeVisible()

    await page.getByText('Show HN: A Tao reader', { exact: true }).click()
    await expect(page.getByText('Yes, queries evaluate locally.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText('Why local-first sync wins', { exact: true })).toBeVisible()

    const beforeAdvance = await hostSnapshot(page)
    const afterAdvance = await advanceHostClock(page, runId, 1_000)
    expect(afterAdvance.monotonicMs).toBe(beforeAdvance.monotonicMs + 1_000)
    await page.getByText('Why local-first sync wins', { exact: true }).click()
    await expect(page.getByText('No comments yet', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Reading' }).click()
    await expect(page.getByText('2 opened', { exact: true })).toBeVisible()
    await expectReadingOrder(page)

    await test.step('reading history survives reload', async () => {
      await page.reload()
      await expect(page.getByRole('button', { name: 'Reading' })).toBeVisible()
      await page.getByRole('button', { name: 'Reading' }).click()
      await expect(
        page.getByRole('group', { name: 'Reading', exact: true }).getByText('2 opened', { exact: true }),
        'HNReader reading history survives reload',
      ).toBeVisible()
      await expectReadingOrder(page)
    })
  })
})

type HostSnapshot = Readonly<{ monotonicMs: number; runId: string }>
type HostControl = Readonly<{
  advance: (request: Readonly<{ advanceMs: number; runId: string }>) => HostSnapshot
  snapshot: () => HostSnapshot
}>

async function hostSnapshot(page: Page): Promise<HostSnapshot> {
  return await page.evaluate(() => {
    const control = (globalThis as typeof globalThis & { __TAO_HOST_TEST_CONTROL__: HostControl })
      .__TAO_HOST_TEST_CONTROL__
    return control.snapshot()
  })
}

async function advanceHostClock(page: Page, runId: string, advanceMs: number): Promise<HostSnapshot> {
  return await page.evaluate(({ milliseconds, requestedRunId }) => {
    const control = (globalThis as typeof globalThis & { __TAO_HOST_TEST_CONTROL__: HostControl })
      .__TAO_HOST_TEST_CONTROL__
    return control.advance({ advanceMs: milliseconds, runId: requestedRunId })
  }, { milliseconds: advanceMs, requestedRunId: runId })
}

async function expectReadingOrder(page: Page): Promise<void> {
  const reading = page.getByRole('group', { name: 'Reading', exact: true })
  await expect(reading.getByText('Why local-first sync wins', { exact: true })).toBeVisible()
  await expect(reading.getByText('Show HN: A Tao reader', { exact: true })).toBeVisible()
  const visibleText = await reading.innerText()
  expect(visibleText.indexOf('Why local-first sync wins')).toBeLessThan(visibleText.indexOf('Show HN: A Tao reader'))
}

function configuredHost(): { runId: string; seed: string } {
  const runId = Platform.runtimeProcess.env['TAO_HOST_TEST_RUN_ID']
  const seed = Platform.runtimeProcess.env['TAO_HOST_TEST_SEED']
  if (runId === undefined || seed === undefined) {
    return Errors.throwUserInput('TAO_HOST_TEST_RUN_ID and TAO_HOST_TEST_SEED must configure the HNReader host proof.')
  }
  return { runId, seed }
}
