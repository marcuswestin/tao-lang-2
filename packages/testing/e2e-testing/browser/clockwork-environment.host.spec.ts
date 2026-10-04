import { type Browser, expect, type Page, test } from '@playwright/test'
import { Platform } from '@shared'

const hostUrl = Platform.runtimeProcess.env['TAO_HOST_TEST_URL'] ?? ''
const runId = Platform.runtimeProcess.env['TAO_HOST_TEST_RUN_ID'] ?? ''
const seed = Platform.runtimeProcess.env['TAO_HOST_TEST_SEED'] ?? ''
const defaultChoices = [
  'Choice: brass',
  'Choice: brass',
  'Choice: steel',
  'Choice: steel',
  'Choice: verdigris',
]

type HostSnapshot = Readonly<{
  runId: string
  seed: number
  epochMs: number
  wallMs: number
  monotonicMs: number
}>

type HostControl = Readonly<{
  snapshot: () => HostSnapshot
  advance: (request: Readonly<{ runId: string; advanceMs: number }>) => HostSnapshot
}>

type HostTestGlobal = typeof globalThis & { __TAO_HOST_TEST_CONTROL__: HostControl }

// REMOVAL CANDIDATE: Fresh browser-realm seed progression largely repeats clockwork.host.spec.ts; dropping this loses a separate realm-initialization check.
test('Clockwork gives fresh same-seed browser realms the same visible random progression', async ({ browser }) => {
  const first = await openClockwork(browser)
  const second = await openClockwork(browser)
  try {
    await expect(first.page.getByText(`Host ready: run ${runId} · seed ${seed}`, { exact: false })).toBeVisible()
    await expect(second.page.getByText(`Host ready: run ${runId} · seed ${seed}`, { exact: false })).toBeVisible()
    await expect(first.page.getByText('Countdown: 0:10', { exact: true })).toBeVisible()
    await expect(second.page.getByText('Countdown: 0:10', { exact: true })).toBeVisible()

    const expectedChoices = seed === '12345' ? defaultChoices : undefined
    const firstChoices = await chooseColors(first.page, expectedChoices)
    const secondChoices = await chooseColors(second.page, expectedChoices)
    expect(firstChoices).toEqual(secondChoices)
    if (expectedChoices !== undefined) {
      expect(firstChoices).toEqual(expectedChoices)
    }
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

// REMOVAL CANDIDATE: Browser-realm clock isolation adds little beyond owned same-process session isolation; dropping it loses the compiled browser seam.
test('Clockwork does not advance a concurrent browser realm', async ({ browser }) => {
  const advanced = await openClockwork(browser)
  const untouched = await openClockwork(browser)
  try {
    const beforeAdvanced = await snapshot(advanced.page)
    const beforeUntouched = await snapshot(untouched.page)
    expect(beforeAdvanced.monotonicMs).toBe(0)
    expect(beforeUntouched.monotonicMs).toBe(0)

    const afterAdvanced = await advance(advanced.page, runId, 1_000)
    const afterUntouched = await snapshot(untouched.page)
    expect(afterAdvanced.wallMs).toBe(beforeAdvanced.wallMs + 1_000)
    expect(afterAdvanced.monotonicMs).toBe(1_000)
    expect(afterUntouched.wallMs).toBe(beforeUntouched.wallMs)
    expect(afterUntouched.monotonicMs).toBe(0)
    await expect(
      advanced.page.getByText('Countdown: 0:09', { exact: true }),
      'Clockwork concurrent realm countdown remains independent',
    ).toBeVisible()
    await expect(untouched.page.getByText('Countdown: 0:10', { exact: true })).toBeVisible()
  } finally {
    await advanced.context.close()
    await untouched.context.close()
  }
})

async function openClockwork(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(hostUrl)
  await expect(page.getByText(`Host ready: run ${runId} · seed ${seed}`, { exact: false })).toBeVisible()
  return { context, page }
}

async function chooseColors(page: Page, expectedChoices?: readonly string[]): Promise<readonly string[]> {
  const choice = page.getByText(/^Choice: (brass|copper|steel|verdigris)$/)
  const choices = [await choice.innerText()]
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: 'Choose clockwork color' }).click()
    if (expectedChoices !== undefined) {
      await expect(choice).toHaveText(expectedChoices[index + 1]!)
    }
    choices.push(await choice.innerText())
  }
  return choices
}

async function snapshot(page: Page): Promise<HostSnapshot> {
  return await page.evaluate(() => {
    const control = (globalThis as HostTestGlobal).__TAO_HOST_TEST_CONTROL__
    return control.snapshot()
  })
}

async function advance(page: Page, activeRunId: string, advanceMs: number): Promise<HostSnapshot> {
  return await page.evaluate(({ runId: requestedRunId, milliseconds }) => {
    const control = (globalThis as HostTestGlobal).__TAO_HOST_TEST_CONTROL__
    return control.advance({ runId: requestedRunId, advanceMs: milliseconds })
  }, { runId: activeRunId, milliseconds: advanceMs })
}
