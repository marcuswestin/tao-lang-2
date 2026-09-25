import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { Errors, Platform, Repo, Switch } from '@shared'
import { HNREADER_AUTHORED_RELOAD_MARKER } from '../app-build/FaultVerdict'
import {
  compileHostJourney,
  type HostJourneyAdapter,
  type HostJourneyOperation,
  type HostJourneySelection,
  runHostJourney,
} from '../journey/HostJourney'

test('executes the authored HNReader reading-history journey through browser-visible input and reload', async ({ page }) => {
  const configuration = configuredHost()
  const journey = await compileHostJourney(Repo.resolvePath('Apps/HNReader/HNReader.test.tao'), {
    check: 'keeps reading history across a relaunch in most-recent order',
    suite: 'hn reader',
  })

  await runHostJourney(journey, browserJourneyAdapter(page, configuration))
})

type HostSnapshot = Readonly<{ monotonicMs: number; runId: string }>
type HostControl = Readonly<{
  advance: (request: Readonly<{ advanceMs: number; runId: string }>) => HostSnapshot
  snapshot: () => HostSnapshot
}>

function browserJourneyAdapter(page: Page, configuration: { runId: string; seed: string }): HostJourneyAdapter {
  let hasRelaunched = false
  return {
    capabilities: [
      'advanceTime',
      'assertNavigationTitle',
      'assertText',
      'press',
      'relaunch',
      'runApplication',
      'select',
    ],
    async execute(operation) {
      await Switch.kind(operation, {
        network: unsupportedBrowserJourneyOperation,
        waitForSync: unsupportedBrowserJourneyOperation,
        datasourceFailure: unsupportedBrowserJourneyOperation,
        advance: async operation => {
          const beforeAdvance = await hostSnapshot(page)
          const afterAdvance = await advanceHostClock(page, configuration.runId, operation.milliseconds)
          expect(afterAdvance.monotonicMs).toBe(beforeAdvance.monotonicMs + operation.milliseconds)
        },
        back: unsupportedBrowserJourneyOperation,
        enter: unsupportedBrowserJourneyOperation,
        expect: async operation => {
          const target = scopedText(page, operation.selections, operation.text)
          const assertion = assertionDescription(operation, hasRelaunched)
          if (operation.missing) {
            await expect(target, assertion).not.toBeVisible()
          } else {
            await expect(target, assertion).toBeVisible()
          }
        },
        expectCheckboxState: unsupportedBrowserJourneyOperation,
        expectFocusRegion: unsupportedBrowserJourneyOperation,
        expectGroup: unsupportedBrowserJourneyOperation,
        expectInputValue: unsupportedBrowserJourneyOperation,
        expectNavigationTitle: async operation => {
          await expect(page.getByTestId('__tao_navigation_title'), assertionDescription(operation)).toHaveText(
            operation.title,
          )
        },
        expectTarget: unsupportedBrowserJourneyOperation,
        expectToolbarCommand: unsupportedBrowserJourneyOperation,
        expectVerbs: unsupportedBrowserJourneyOperation,
        focus: unsupportedBrowserJourneyOperation,
        hover: unsupportedBrowserJourneyOperation,
        narrow: unsupportedBrowserJourneyOperation,
        press: async operation => {
          await scopedPress(page, operation.selections, operation.selector, operation.text)
        },
        pressDown: unsupportedBrowserJourneyOperation,
        pressKey: unsupportedBrowserJourneyOperation,
        pressToolbarCommand: unsupportedBrowserJourneyOperation,
        pressUp: unsupportedBrowserJourneyOperation,
        relaunch: async () => {
          await page.reload()
          hasRelaunched = true
        },
        run: async operation => {
          await page.goto('/')
          await expect(
            page.getByText(`Host ready: run ${configuration.runId} · seed ${configuration.seed}`, { exact: true }),
          ).toBeVisible()
          expect(operation.appName).toBe('HNReaderStub')
        },
        submit: unsupportedBrowserJourneyOperation,
      })
    },
  }
}

async function scopedPress(
  page: Page,
  selections: readonly HostJourneySelection[],
  selector: string,
  text: string,
): Promise<void> {
  const scope = scopedLocator(page, selections)
  if (selector === 'label') {
    await scope.getByRole('button', { name: text, exact: true }).click()
    return
  }
  if (selector === 'text') {
    await scope.getByText(text, { exact: true }).click()
    return
  }
  if (selector === 'tag') {
    await scope.getByTestId(text).click()
    return
  }
  return Errors.throwUnexpected(`HNReader browser adapter does not support press selector '${selector}'.`)
}

function scopedText(page: Page, selections: readonly HostJourneySelection[], text: string): Locator {
  return scopedLocator(page, selections).getByText(text, { exact: true })
}

function scopedLocator(page: Page, selections: readonly HostJourneySelection[]): Locator {
  let scope = page.locator('body')
  for (const selection of selections) {
    scope = scope.getByTestId(selection.tag).nth(selection.index - 1)
  }
  return scope
}

function assertionDescription(operation: HostJourneyOperation, hasRelaunched = false): string {
  if (hasRelaunched && operation.kind === 'expect' && !operation.missing && operation.text === '2 opened') {
    return HNREADER_AUTHORED_RELOAD_MARKER
  }
  const range = operation.source.range
  const position = range === undefined
    ? operation.source.filePath
    : `${operation.source.filePath}:${range.start.line + 1}`
  return `Tao journey assertion at ${position}`
}

function unsupportedBrowserJourneyOperation(operation: HostJourneyOperation): never {
  return Errors.throwUnexpected(
    `HNReader browser adapter received '${operation.kind}' after its capability preflight should have rejected it.`,
  )
}

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

function configuredHost(): { runId: string; seed: string } {
  const runId = Platform.runtimeProcess.env['TAO_HOST_TEST_RUN_ID']
  const seed = Platform.runtimeProcess.env['TAO_HOST_TEST_SEED']
  if (runId === undefined || seed === undefined) {
    return Errors.throwUserInput('TAO_HOST_TEST_RUN_ID and TAO_HOST_TEST_SEED must configure the HNReader host proof.')
  }
  return { runId, seed }
}
