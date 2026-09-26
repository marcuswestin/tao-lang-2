import { HostControlError, type HostRevision, type HostSession } from '@host-control'
import { createPlaywrightHostController } from '@playwright-driver'
import { expect as Expect, test as Test } from '@playwright/test'
import { FS, Platform, Repo, Time } from '@shared'

const Describe = Test.describe

const firstRevision: HostRevision = { build: 'build-1', source: 'source-1' }
const secondRevision: HostRevision = { build: 'build-2', source: 'source-2' }

Describe('Playwright host control', () => {
  Test('owns isolated storage, input, and artifacts for concurrent browser contexts', async () => {
    await withFixturePage(interactionFixture(), async (target, artifactRoot) => {
      const controller = await createController()
      try {
        const first = await controller.openSession({
          artifactRoot,
          mode: 'development',
          revision: firstRevision,
          target,
        })
        const second = await controller.openSession({
          artifactRoot,
          mode: 'development',
          revision: firstRevision,
          target,
        })

        Expect(first.descriptor()).toMatchObject({ driver: 'playwright', mode: 'development', version: 1 })
        Expect(first.descriptor().id).not.toBe(second.descriptor().id)
        Expect(first.descriptor().lease).not.toEqual(second.descriptor().lease)
        Expect(first.descriptor().lease.name).toBe(`browser-context:${first.descriptor().id}`)
        Expect(second.descriptor().lease.name).toBe(`browser-context:${second.descriptor().id}`)
        Expect(first.descriptor().capabilities).not.toContain('relaunchApplication')

        await typeInto(first, 'Session input', 'alpha')
        await first.perform({
          expectedRevision: firstRevision,
          kind: 'key',
          key: 'Backspace',
          lease: first.descriptor().lease,
        })
        await typeInto(second, 'Session input', 'beta')

        Expect((await observeTag(first, 'input-state')).text).toBe('Input: alph')
        Expect((await observeTag(second, 'input-state')).text).toBe('Input: beta')

        const setStorage = await first.observe({
          expectedRevision: firstRevision,
          target: { kind: 'text', value: 'Set storage' },
        })
        await first.perform({
          expectedRevision: firstRevision,
          kind: 'click',
          lease: first.descriptor().lease,
          observation: setStorage,
        })
        await first.perform({
          expectedRevision: firstRevision,
          kind: 'refreshDocument',
          lease: first.descriptor().lease,
        })
        Expect((await observeTag(first, 'storage-state')).text).toBe('Storage: alph')
        Expect((await observeTag(second, 'storage-state')).text).toBe('Storage: empty')

        await first.perform({
          deltaX: 0,
          deltaY: 600,
          expectedRevision: firstRevision,
          kind: 'scroll',
          lease: first.descriptor().lease,
        })
        Expect((await observeTag(first, 'scroll-state')).text).toBe('Scroll: yes')
        Expect((await observeTag(second, 'scroll-state')).text).toBe('Scroll: no')

        const firstScreenshot = await first.captureScreenshot('same name')
        const secondScreenshot = await second.captureScreenshot('same name')
        Expect(firstScreenshot.artifactPath).not.toBe(secondScreenshot.artifactPath)
        Expect(FS.dirname(firstScreenshot.artifactPath)).not.toBe(FS.dirname(secondScreenshot.artifactPath))
        Expect(await FS.exists(firstScreenshot.artifactPath)).toBe(true)
        Expect(await FS.exists(secondScreenshot.artifactPath)).toBe(true)

        await first.close(first.descriptor().lease)
        await first.close(first.descriptor().lease)
        await second.close(second.descriptor().lease)
        Expect(await FS.exists(FS.resolvePath('trace.zip', FS.dirname(firstScreenshot.artifactPath)))).toBe(true)
        Expect(await FS.exists(FS.resolvePath('trace.zip', FS.dirname(secondScreenshot.artifactPath)))).toBe(true)
      } finally {
        await controller.close()
      }
    })
  })

  Test('rejects stale leases, observations, and revisions before browser input', async () => {
    await withFixturePage(counterFixture('Counter revision one'), async (target, artifactRoot) => {
      const controller = await createController()
      try {
        const session = await controller.openSession({
          artifactRoot,
          mode: 'development',
          revision: firstRevision,
          target,
        })
        const lease = session.descriptor().lease
        const button = await observeTag(session, 'increment')

        await expectHostFailure(
          session.perform({
            expectedRevision: firstRevision,
            kind: 'click',
            lease: { ...lease, generation: 'stale-generation' },
            observation: button,
          }),
          'staleLease',
        )
        await expectHostFailure(
          session.perform({
            expectedRevision: firstRevision,
            kind: 'click',
            lease,
            observation: { ...button, lease: { ...lease, generation: 'stale-observation-generation' } },
          }),
          'staleLease',
        )
        Expect((await observeTag(session, 'counter')).text).toBe('Count: 0')

        const staleButton = await observeTag(session, 'increment')
        await observeTag(session, 'counter')
        await expectHostFailure(
          session.perform({ expectedRevision: firstRevision, kind: 'click', lease, observation: staleButton }),
          'staleObservation',
        )
        Expect((await observeTag(session, 'counter')).text).toBe('Count: 0')

        const oldRevisionButton = await observeTag(session, 'increment')
        await session.publishRevision({ expectedCurrentRevision: firstRevision, lease, revision: secondRevision })
        await expectHostFailure(
          session.perform({ expectedRevision: firstRevision, kind: 'click', lease, observation: oldRevisionButton }),
          'staleRevision',
        )
        await expectHostFailure(
          session.observe({ expectedRevision: firstRevision, target: { kind: 'tag', value: 'counter' } }),
          'staleRevision',
        )
        Expect((await observeTag(session, 'counter', secondRevision)).text).toBe('Count: 0')

        await expectHostFailure(
          session.perform({ expectedRevision: firstRevision, kind: 'key', key: 'A', lease }),
          'staleRevision',
        )
        Expect((await observeTag(session, 'key-state', secondRevision)).text).toBe('Keys: 0')

        await expectHostFailure(
          session.perform({ expectedRevision: firstRevision, kind: 'refreshDocument', lease }),
          'staleRevision',
        )
        Expect((await observeTag(session, 'reload-state', secondRevision)).text).toBe('Reloads: 2')

        await expectHostFailure(
          session.perform({
            deltaX: 0,
            deltaY: 600,
            expectedRevision: firstRevision,
            kind: 'scroll',
            lease,
          }),
          'staleRevision',
        )
        Expect((await observeTag(session, 'scroll-state', secondRevision)).text).toBe('Scroll: no')

        await expectHostFailure(
          session.perform({ expectedRevision: secondRevision, kind: 'relaunchApplication', lease }),
          'unsupported',
        )
      } finally {
        await controller.close()
      }
    })
  })

  Test('uses one-based occurrences and never re-resolves a replaced observed element', async () => {
    await withFixturePage(replacementFixture(), async (target, artifactRoot) => {
      const controller = await createController()
      try {
        const session = await controller.openSession({
          artifactRoot,
          mode: 'development',
          revision: firstRevision,
          target,
        })
        const replaced = await observeTag(session, 'replaceable')
        Expect(replaced.text).toBe('Original')
        await Time.sleep(850)
        await expectHostFailure(
          session.perform({
            expectedRevision: firstRevision,
            kind: 'click',
            lease: session.descriptor().lease,
            observation: replaced,
          }),
          'host',
        )
        Expect((await observeTag(session, 'replacement-result')).text).toBe('Clicked: none')
        Expect((await observeTag(session, 'replaceable')).text).toBe('Replacement')

        Expect(
          (await session.observe({
            expectedRevision: firstRevision,
            target: { kind: 'tag', value: 'repeated' },
          })).text,
        ).toBe('First occurrence')
        Expect(
          (await session.observe({
            expectedRevision: firstRevision,
            target: { kind: 'tag', occurrence: 1, value: 'repeated' },
          })).text,
        ).toBe('First occurrence')
        Expect(
          (await session.observe({
            expectedRevision: firstRevision,
            target: { kind: 'tag', occurrence: 2, value: 'repeated' },
          })).text,
        ).toBe('Second occurrence')
        Expect(
          (await session.observe({
            expectedRevision: firstRevision,
            target: {
              kind: 'scoped',
              scope: { kind: 'tag', occurrence: 2, value: 'row' },
              target: { kind: 'tag', value: 'child' },
            },
          })).text,
        ).toBe('Second child')
        await expectHostFailure(
          session.observe({
            expectedRevision: firstRevision,
            target: { kind: 'tag', occurrence: 0, value: 'repeated' },
          }),
          'assertion',
        )
      } finally {
        await controller.close()
      }
    })
  })

  Test('reloads a development session into its published visual revision', async () => {
    await withFixturePage(visualFixture('Visual revision one'), async (target, artifactRoot, writeFixture) => {
      const controller = await createController()
      try {
        const session = await controller.openSession({
          artifactRoot,
          mode: 'development',
          revision: firstRevision,
          target,
        })
        Expect(
          (await session.observe({
            expectedRevision: firstRevision,
            target: { kind: 'text', value: 'Visual revision one' },
          })).visible,
        ).toBe(true)

        await writeFixture(visualFixture('Visual revision two'))
        await session.publishRevision({
          expectedCurrentRevision: firstRevision,
          lease: session.descriptor().lease,
          revision: secondRevision,
        })

        Expect(session.descriptor().revision).toEqual(secondRevision)
        Expect(
          (await session.observe({
            expectedRevision: secondRevision,
            target: { kind: 'text', value: 'Visual revision two' },
          })).visible,
        ).toBe(true)

        await writeFixture(visualFixture('Visual revision three'))
        await expectHostFailure(
          session.publishRevision({
            expectedCurrentRevision: firstRevision,
            lease: session.descriptor().lease,
            revision: { build: 'build-3', source: 'source-3' },
          }),
          'staleRevision',
        )
        Expect(session.descriptor().revision).toEqual(secondRevision)
        Expect(
          (await session.observe({
            expectedRevision: secondRevision,
            target: { kind: 'text', value: 'Visual revision two' },
          })).visible,
        ).toBe(true)
        const screenshot = await session.captureScreenshot('revision two')
        Expect(screenshot.revision).toEqual(secondRevision)
        Expect(await FS.exists(screenshot.artifactPath)).toBe(true)
      } finally {
        await controller.close()
      }
    })
  })

  Test('keeps acceptance immutable and requires a separate session for another revision', async () => {
    await withFixturePage(visualFixture('Accepted revision one'), async (target, artifactRoot, writeFixture) => {
      const controller = await createController()
      try {
        const accepted = await controller.openSession({
          artifactRoot,
          mode: 'acceptance',
          revision: firstRevision,
          target,
        })
        await writeFixture(visualFixture('Accepted revision two'))

        await expectHostFailure(
          accepted.publishRevision({
            expectedCurrentRevision: firstRevision,
            lease: accepted.descriptor().lease,
            revision: secondRevision,
          }),
          'unsupported',
        )
        Expect(accepted.descriptor().revision).toEqual(firstRevision)
        Expect(
          (await accepted.observe({
            expectedRevision: firstRevision,
            target: { kind: 'text', value: 'Accepted revision one' },
          })).visible,
        ).toBe(true)

        const nextAcceptance = await controller.openSession({
          artifactRoot,
          mode: 'acceptance',
          revision: secondRevision,
          target,
        })
        Expect(
          (await nextAcceptance.observe({
            expectedRevision: secondRevision,
            target: { kind: 'text', value: 'Accepted revision two' },
          })).visible,
        ).toBe(true)
        Expect(nextAcceptance.descriptor().id).not.toBe(accepted.descriptor().id)
      } finally {
        await controller.close()
      }
    })
  })
})

async function createController() {
  return await createPlaywrightHostController({
    launchOptions: {
      channel: Platform.runtimeProcess.env['TAO_HOST_TEST_BROWSER_CHANNEL'] ?? 'chrome',
      headless: true,
    },
  })
}

async function typeInto(session: HostSession, name: string, text: string): Promise<void> {
  const observation = await session.observe({
    expectedRevision: session.descriptor().revision,
    target: { kind: 'accessibility', name },
  })
  await session.perform({
    expectedRevision: session.descriptor().revision,
    kind: 'type',
    lease: session.descriptor().lease,
    observation,
    text,
  })
}

async function observeTag(
  session: HostSession,
  value: string,
  revision = session.descriptor().revision,
) {
  return await session.observe({ expectedRevision: revision, target: { kind: 'tag', value } })
}

async function expectHostFailure(promise: Promise<unknown>, code: HostControlError['code']): Promise<void> {
  let failure: unknown
  try {
    await promise
  } catch (error) {
    failure = error
  }
  Expect(failure).toBeInstanceOf(HostControlError)
  Expect((failure as HostControlError).code).toBe(code)
}

async function withFixturePage(
  source: string,
  use: (
    target: string,
    artifactRoot: string,
    writeFixture: (nextSource: string) => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const root = await Repo.mkScratchDir('tao-playwright-host-control-')
  const fixturePath = FS.resolvePath('fixture.html', root)
  const artifactRoot = FS.resolvePath('artifacts', root)
  const writeFixture = async (nextSource: string) => await FS.writeText(fixturePath, nextSource)
  try {
    await writeFixture(source)
    await use(`file://${fixturePath}`, artifactRoot, writeFixture)
  } finally {
    await FS.remove(root)
  }
}

function visualFixture(text: string): string {
  return `<!doctype html><html><body><main>${text}</main></body></html>`
}

function counterFixture(title: string): string {
  return `<!doctype html>
<html>
  <body style="height: 1800px">
    <h1>${title}</h1>
    <button data-testid="increment">Increment</button>
    <p data-testid="counter">Count: 0</p>
    <p data-testid="key-state">Keys: 0</p>
    <p data-testid="reload-state"></p>
    <p data-testid="scroll-state" style="position: fixed; top: 0; right: 0">Scroll: no</p>
    <script>
      const counter = document.querySelector('[data-testid="counter"]')
      const keyState = document.querySelector('[data-testid="key-state"]')
      const reloadState = document.querySelector('[data-testid="reload-state"]')
      const scrollState = document.querySelector('[data-testid="scroll-state"]')
      let count = 0
      let keys = 0
      const reloads = Number(sessionStorage.getItem('reloads') || 0) + 1
      sessionStorage.setItem('reloads', String(reloads))
      reloadState.textContent = 'Reloads: ' + reloads
      document.querySelector('[data-testid="increment"]').addEventListener('click', () => {
        count += 1
        counter.textContent = 'Count: ' + count
      })
      window.addEventListener('keydown', () => {
        keys += 1
        keyState.textContent = 'Keys: ' + keys
      })
      window.addEventListener('scroll', () => scrollState.textContent = 'Scroll: yes', { once: true })
    </script>
  </body>
</html>`
}

function interactionFixture(): string {
  return `<!doctype html>
<html>
  <body style="height: 1800px">
    <label>Session input <input aria-label="Session input"></label>
    <p data-testid="input-state">Input: </p>
    <button>Set storage</button>
    <p data-testid="storage-state">Storage: empty</p>
    <p data-testid="scroll-state" style="position: fixed; top: 0; right: 0">Scroll: no</p>
    <script>
      const input = document.querySelector('input')
      const inputState = document.querySelector('[data-testid="input-state"]')
      const storageState = document.querySelector('[data-testid="storage-state"]')
      const scrollState = document.querySelector('[data-testid="scroll-state"]')
      const renderStorage = () => storageState.textContent = 'Storage: ' + (localStorage.getItem('value') || 'empty')
      input.addEventListener('input', () => inputState.textContent = 'Input: ' + input.value)
      document.querySelector('button').addEventListener('click', () => {
        localStorage.setItem('value', input.value)
        renderStorage()
      })
      window.addEventListener('scroll', () => scrollState.textContent = 'Scroll: yes', { once: true })
      renderStorage()
    </script>
  </body>
</html>`
}

function replacementFixture(): string {
  return `<!doctype html>
<html>
  <body>
    <button data-testid="repeated">First occurrence</button>
    <button data-testid="repeated">Second occurrence</button>
    <section data-testid="row"><span data-testid="child">First child</span></section>
    <section data-testid="row"><span data-testid="child">Second child</span></section>
    <button id="observed" data-testid="replaceable">Original</button>
    <p data-testid="replacement-result">Clicked: none</p>
    <script>
      const result = document.querySelector('[data-testid="replacement-result"]')
      const observed = document.querySelector('#observed')
      observed.addEventListener('click', () => result.textContent = 'Clicked: original')
      setTimeout(() => {
        const replacement = document.createElement('button')
        replacement.setAttribute('data-testid', 'replaceable')
        replacement.textContent = 'Replacement'
        replacement.addEventListener('click', () => result.textContent = 'Clicked: replacement')
        observed.replaceWith(replacement)
      }, 750)
    </script>
  </body>
</html>`
}
