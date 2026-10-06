import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Errors, FS, Platform } from '@shared'

const uncaught = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  uncaught.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => {
  expect(uncaught.get(page), 'The tutorial must not raise an uncaught browser exception').toEqual([])
})

test.describe('First-hour tutorial in the browser', () => {
  test('edits a book, preserves it across reload, finishes it, switches destinations, and removes it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.getByText('Nothing on the go', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add book', exact: true })).toBeDisabled()
    await addBook(page, 'The Dispossessed')
    await page.getByText('The Dispossessed', { exact: true }).click()
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The Left Hand of Darkness')
    await page.getByRole('textbox', { name: 'Author', exact: true }).fill('Ursula K. Le Guin')
    await page.getByTestId('save').click()
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('The Left Hand of Darkness')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByText('Ursula K. Le Guin', { exact: true })).toBeVisible()
    await expect.poll(() => savedBooks(page)).toContain('The Left Hand of Darkness')
    await page.reload()
    await expect(page.getByText('The Left Hand of Darkness', { exact: true })).toBeVisible()
    await expect(page.getByText('Ursula K. Le Guin', { exact: true })).toBeVisible()
    await capture(page, 'persisted-phone')
    await page.getByText('The Left Hand of Darkness', { exact: true }).click()
    await page.getByTestId('finished').click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByText('Finished: 1', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'About', exact: true }).click()
    await expect(page.getByText('A small reading list, written in Tao.', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Library', exact: true }).click()
    await page.getByText('The Left Hand of Darkness', { exact: true }).click()
    await page.getByTestId('remove').click()
    await expect(page.getByText('Nothing finished yet', { exact: true })).toBeVisible()
    await expect.poll(() => savedBooks(page)).not.toContain('The Left Hand of Darkness')
    await page.reload()
    await expect(page.getByText('Nothing on the go', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing finished yet', { exact: true })).toBeVisible()
  })

  test('reports unavailable local storage and recovers the saved book through Retry', async ({ page }) => {
    await page.goto('/')
    await addBook(page, 'A saved book')
    await expect.poll(() => savedBooks(page)).toContain('A saved book')
    // Inject at the browser storage boundary, keeping the generated provider and runtime real.
    await page.addInitScript(() => {
      const read = Storage.prototype.getItem
      Storage.prototype.getItem = function(key) {
        if (key.startsWith('tao-data:') && !sessionStorage.getItem('tutorial-storage-restored')) {
          throw new DOMException('Tutorial storage is temporarily unavailable', 'SecurityError')
        }
        return read.call(this, key)
      }
    })
    await page.reload()
    await expect(page.getByText("Couldn't load app data", { exact: true })).toBeVisible()
    await capture(page, 'storage-failure')
    await page.evaluate(() => sessionStorage.setItem('tutorial-storage-restored', 'yes'))
    await page.getByRole('button', { name: 'Try loading data again', exact: true }).click()
    await expect(page.getByText("Couldn't load app data", { exact: true })).toHaveCount(0)
    await expect(page.getByText('A saved book', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('A saved book', { exact: true })).toBeVisible()
    await capture(page, 'storage-recovered')
  })

  test('keeps short phone sections together and adapts to desktop and dark scheme', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    const reading = page.getByText('Reading: 0', { exact: true })
    const finished = page.getByText('Finished: 0', { exact: true })
    await expect(reading).toBeVisible()
    await expect(finished).toBeVisible()
    const library = page.getByRole('tab', { name: 'Library', exact: true })
    const about = page.getByRole('tab', { name: 'About', exact: true })
    await expect(library).toHaveAttribute('aria-selected', 'true')
    const libraryBounds = await library.boundingBox()
    const aboutBounds = await about.boundingBox()
    expect(libraryBounds).not.toBeNull()
    expect(aboutBounds).not.toBeNull()
    expect(libraryBounds!.height).toBeGreaterThanOrEqual(44)
    expect(aboutBounds!.x - libraryBounds!.x - libraryBounds!.width).toBeGreaterThanOrEqual(8)
    await capture(page, 'phone-light')
    const phoneReading = await reading.boundingBox()
    const phoneFinished = await finished.boundingBox()
    expect(phoneReading).not.toBeNull()
    expect(phoneFinished).not.toBeNull()
    expect(phoneFinished!.y - phoneReading!.y).toBeLessThan(180)
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(async () => (await finished.boundingBox())!.y - (await reading.boundingBox())!.y).toBe(0)
    await capture(page, 'desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(reading).toBeVisible()
    // The tutorial deliberately owns a light paper palette in either system scheme.
    await expect(reading).toHaveCSS('color', 'rgb(27, 27, 31)')
    await capture(page, 'phone-dark')
    for (let index = 1; index <= 8; index += 1) {
      await addBook(page, `Book ${index}`, index)
    }
    await page.getByText('Book 8', { exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByText('Book 8', { exact: true })).toBeVisible()
    await capture(page, 'phone-long-list')
  })
})

async function addBook(page: Page, title: string, count = 1): Promise<void> {
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill(title)
  await page.getByTestId('addBook').click()
  await expect(page.getByText(`Reading: ${count}`, { exact: true })).toBeVisible()
}

async function savedBooks(page: Page): Promise<string> {
  return await page.evaluate(() =>
    Object.keys(localStorage)
      .filter(key => key.startsWith('tao-data:'))
      .map(key => localStorage.getItem(key)).join('\n')
  )
}

async function capture(page: Page, name: string): Promise<void> {
  const root = Platform.runtimeProcess.env['TAO_HOST_TEST_ARTIFACTS']
  if (!root) {
    Errors.throwUnexpected('Tutorial browser evidence needs an artifact directory.')
  }
  await page.screenshot({ path: FS.resolvePath(`tutorial-${name}.png`, root), fullPage: true })
}
