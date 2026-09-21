import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { Errors, Platform } from '@shared'

test('Clockwork renders its configured seed and responds to a visible controlled clock advance', async ({ page }) => {
  const { runId, seed } = configuredHost()
  await page.goto('/')
  await expect(page.getByText(`Host ready: run ${runId} · seed ${seed} · wall`, { exact: false })).toBeVisible()
  const choice = page.getByText(/^Choice: (brass|copper|steel|verdigris)$/)
  await expect(choice).toBeVisible()
  await expect(page.getByText('Countdown: 0:10', { exact: true })).toBeVisible()
  await expectClockworkChoices(page, choice, seed)
  const after = await advance(page, 1_000)
  expect(after.monotonicMs).toBe(1_000)
  expect(after.lastControlAdvanceMs).toBe(1_000)
  await expect(page.getByText('Control received: advance 1000ms', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Countdown: 0:09', { exact: true }),
    'Clockwork controlled countdown advances after visible clock advance',
  ).toBeVisible()
})

async function expectClockworkChoices(page: Page, choice: Locator, seed: string): Promise<void> {
  if (seed !== '12345') {
    return
  }
  await expect(choice).toHaveText('Choice: brass')
  for (const expected of ['brass', 'steel', 'steel', 'verdigris']) {
    await page.getByRole('button', { name: 'Choose clockwork color' }).click()
    await expect(choice).toHaveText(`Choice: ${expected}`)
  }
}

type HostSnapshot = Readonly<{ lastControlAdvanceMs?: number; monotonicMs: number; runId: string }>
type HostControl = Readonly<{
  advance: (request: Readonly<{ advanceMs: number; runId: string }>) => HostSnapshot
  snapshot: () => HostSnapshot
}>

async function advance(page: Page, advanceMs: number): Promise<HostSnapshot> {
  return await page.evaluate(milliseconds => {
    const control = (globalThis as typeof globalThis & { __TAO_HOST_TEST_CONTROL__: HostControl })
      .__TAO_HOST_TEST_CONTROL__
    return control.advance({ advanceMs: milliseconds, runId: control.snapshot().runId })
  }, advanceMs)
}

function configuredHost(): { runId: string; seed: string } {
  const runId = Platform.runtimeProcess.env['TAO_HOST_TEST_RUN_ID']
  const seed = Platform.runtimeProcess.env['TAO_HOST_TEST_SEED']
  if (runId === undefined || seed === undefined) {
    return Errors.throwUserInput('TAO_HOST_TEST_RUN_ID and TAO_HOST_TEST_SEED must configure the Clockwork host proof.')
  }
  return { runId, seed }
}
