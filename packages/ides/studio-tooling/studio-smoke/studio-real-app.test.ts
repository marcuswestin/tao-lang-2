import { Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  openStudioPreviewSession,
  StudioInspector,
} from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

const fastRefreshSource = `use Button, Col, Number, Text from @tao/ui

app RefreshSmoke { view MainView }

view MainView() {
   state Count = 0
   action Increment() {
      set Count += 1
   }
   render Col() {
      Button("Increment") {
         on press Increment
      }
      Number(Count)
      Text("First")
      Text("Second")
      Text("Third")
}  }

fixture Empty { }
scenarios MainView "states" {
   fixture Empty
   device phone
   scenario "default" { render MainView() }
}
`

Test('Studio compiles, visually edits, and undoes the real HNReader app', async () => {
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-smoke/real-app', Repo.getRoot())
  const projectRoot = await mkTestDir('tao-studio-hnreader-')
  const previewRuntimeRoot = FS.resolvePath('runtime', artifactRoot)
  await FS.remove(previewRuntimeRoot)
  await FS.copyDirectory(Repo.resolvePath('Apps/HNReader'), projectRoot)

  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  try {
    preview = await openStudioPreviewSession({
      appName: 'HNReaderStub',
      entryPath: FS.resolvePath('HNReader.tao', projectRoot),
      previewRuntimeRoot,
      projectRoot,
    })
    preview.session.registerPreview({ previewInstanceId: 'real-app-preview' })
    const initialCompile = await preview.session.compileInitial()
    const initial = await preview.session.readFile('HNReader.tao')
    const identity = {
      ...preview.session.identity(),
      path: initial.path,
      previewInstanceId: 'real-app-preview',
      sourceVersion: initial.sourceVersion,
    }
    const applied = await preview.session.applySourceAction(StudioInspector.singleAction({
      action: { component: 'Text', kind: 'insert-component' },
      checkpointId: 'real-app-visual-edit',
      identity,
      requestId: 'real-app-insert-text',
    }))
    const undone = await preview.session.undoSourceAction(StudioInspector.undo({
      checkpointId: 'real-app-visual-edit',
      identity: { ...identity, sourceVersion: applied.sourceVersion },
      requestId: 'real-app-undo',
    }))
    const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
    const stableRoot = await FS.readText(FS.resolvePath('App.tsx', generatedRoot))
    const publication = await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))

    Expect(initialCompile.status).toBe('compiled')
    Expect(initialCompile.compileRevision).toBe(1)
    Expect(applied.compile.compileRevision).toBe(2)
    Expect(applied.content).toContain('Text("New text")')
    Expect(undone.compile.compileRevision).toBe(3)
    Expect(undone.content).toBe(initial.content)
    Expect(await FS.readText(FS.resolvePath('HNReader.tao', projectRoot))).toBe(initial.content)
    Expect(stableRoot).toContain('TR.Studio.PreviewBridge')
    Expect(publication).toContain('"appName":"HNReaderStub"')
    Expect(publication).toContain('"compileRevision":3')
    Expect(publication).toContain(FS.resolvePath('HNReader.tao', projectRoot))
    Expect(publication).toContain(initial.sourceVersion)
  } finally {
    await preview?.close()
    await FS.remove(projectRoot)
  }
}, 120_000)

Test('Studio drag refreshes the real Metro preview without blanking, reloading, or losing state', async () => {
  const repositoryRoot = Repo.getRoot()
  const projectRoot = await mkTestDir('tao-studio-fast-refresh-')
  const sourcePath = FS.resolvePath('RefreshSmoke.tao', projectRoot)
  let browser: StudioCdp | undefined
  let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
  try {
    await FS.writeText(sourcePath, fastRefreshSource)
    await FS.writeText(
      FS.resolvePath('Project.tao', projectRoot),
      'project { id "tao-studio-fast-refresh-smoke" name "Fast refresh smoke" }\n',
    )
    studio = await startStudioSmokeLaunch({
      appName: 'RefreshSmoke',
      projectRoot,
      repositoryRoot,
    })
    const previewUrl = studio.readiness.previewUrl
    if (previewUrl === undefined) {
      Errors.throwUnexpected('The browser Studio launch did not advertise its Metro preview URL.')
    }
    browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(studio.readiness.sessionUrl)
    await browser.waitFor(
      `document.querySelector('.studio-preview-cell iframe') instanceof HTMLIFrameElement`,
      { timeoutMs: 30_000 },
    )
    // The native button renders its title uppercase on web, and innerText reports the transformed text.
    await waitForPreview(browser, studio, previewUrl, `document.body?.textContent?.includes('Increment') === true`)

    await browser.evaluate(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      if (!(frame instanceof HTMLIFrameElement)) throw new Error('Missing Studio preview iframe')
      window.__taoFastRefreshFrameProbe = { loads: 0 }
      frame.addEventListener('load', () => { window.__taoFastRefreshFrameProbe.loads += 1 })
      return true
    })()`)
    await browser.evaluateInFrame(
      previewUrl,
      `(() => {
      const probe = window.__taoFastRefreshProbe = {
        sawEmptyRoot: false,
        sawPending: document.body?.innerText.includes('Loading scenario') === true,
        token: 'retained-preview-realm',
      }
      const root = document.querySelector('#root') ?? document.body
      new MutationObserver(records => {
        probe.sawPending ||= records.some(record => [...record.addedNodes].some(node =>
          node.textContent?.includes('Loading scenario') === true
        ))
        probe.sawEmptyRoot ||= root.childElementCount === 0
      }).observe(root, { childList: true, subtree: true })
      return true
    })()`,
    )

    // Edit mode gives Studio every click for selection, so the press happens in Run mode, the way a
    // person would press it, and the drag after it happens back in Edit mode.
    await setInteractionMode(browser, 'run')
    await pressIncrementOnce(browser, previewUrl)
    await setInteractionMode(browser, 'edit')

    const compileRevision = await waitForCompileAfter(browser, -1)
    await dragThirdBetweenFirstAndSecond(browser, previewUrl)
    await waitForSourceOrder(sourcePath, ['Text("First")', 'Text("Third")', 'Text("Second")'])
    const movedRevision = await waitForCompileAfter(browser, compileRevision)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `document.body?.innerText.indexOf('First') < document.body?.innerText.indexOf('Third')
        && document.body?.innerText.indexOf('Third') < document.body?.innerText.indexOf('Second')`,
    )

    const movedSource = await FS.readText(sourcePath)
    await replaceEditorSource(browser, 'view Broken( {\n')
    await waitForStudioStatus(browser, 'error')
    Expect(await FS.readText(sourcePath)).toBe(movedSource)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1')`,
    )
    await replaceEditorSource(browser, `${movedSource.trimEnd()}\n\n// recovered after invalid draft\n`)
    const recoveredRevision = await waitForCompileAfter(browser, movedRevision)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1')`,
    )

    const frameProbe = await browser.evaluate<Readonly<{ loads: number }>>(
      'window.__taoFastRefreshFrameProbe',
    )
    const previewProbe = await browser.evaluateInFrame<
      Readonly<{
        countPreserved: boolean
        sawEmptyRoot: boolean
        sawPending: boolean
        token?: string
      }>
    >(
      previewUrl,
      `(() => ({
      countPreserved: [...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '1'),
      sawEmptyRoot: window.__taoFastRefreshProbe?.sawEmptyRoot === true,
      sawPending: window.__taoFastRefreshProbe?.sawPending === true,
      token: window.__taoFastRefreshProbe?.token,
    }))()`,
    )
    Expect(frameProbe.loads).toBe(0)
    Expect(previewProbe).toEqual({
      countPreserved: true,
      sawEmptyRoot: false,
      sawPending: false,
      token: 'retained-preview-realm',
    })
    // Adding a scenario changes the cell contract. Unlike a compatible render edit above, it
    // deliberately resets every retained preview so old interaction state cannot cross it.
    const expandedSource = movedSource.replace(
      /scenario "default" \{\s*render MainView\(\)\s*\}/,
      '$&\n   scenario "second" { render MainView() }',
    )
    Expect(expandedSource).not.toBe(movedSource)
    await replaceEditorSource(
      browser,
      expandedSource,
    )
    await waitForCompileAfter(browser, recoveredRevision)
    await waitForPreview(
      browser,
      studio,
      previewUrl,
      `[...document.querySelectorAll('[data-tao-studio]')]
        .some(element => element.textContent?.trim() === '0')`,
    )
    const afterReset = await browser.evaluate<Readonly<{ loads: number }>>('window.__taoFastRefreshFrameProbe')
    Expect(afterReset.loads).toBeGreaterThan(0)
    await writePreviewDiagnostics(browser, studio, previewUrl, 'scenario-reset-passed')
    Expect(browser.browserFailures()).toEqual([])
  } finally {
    await browser?.close()
    await studio?.stop()
    await FS.remove(projectRoot)
  }
}, 300_000)

async function waitForPreview(
  browser: StudioCdp,
  studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>>,
  previewUrl: string,
  expression: string,
): Promise<void> {
  let last = ''
  const ready = await Time.pollUntil(async () => {
    try {
      return await browser.evaluateInFrame<boolean>(previewUrl, expression)
    } catch (error) {
      last = Errors.messageOf(error)
      return false
    }
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready) {
    const diagnostics = await writePreviewDiagnostics(browser, studio, previewUrl, 'preview-timeout')
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio preview expression: ${expression}; last=${last}; diagnostics=${diagnostics}`,
    )
  }
}

async function writePreviewDiagnostics(
  browser: StudioCdp,
  studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>>,
  previewUrl: string,
  step: string,
): Promise<string> {
  const read = async <T>(action: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await action()
    } catch (error) {
      return { error: Errors.messageOf(error) }
    }
  }
  const manifest = await read(async () => {
    const response = await fetch(`${studio.readiness.sessionUrl}/api/preview/manifest`, {
      signal: AbortSignal.timeout(2_000),
    } as RequestInit)
    const body = await response.json() as { compileRevision?: number; manifestRevision?: string; cells?: unknown[] }
    return {
      status: response.status,
      compileRevision: body.compileRevision,
      manifestRevision: body.manifestRevision,
      cells: body.cells,
    }
  })
  const iframe = await read(() =>
    browser.evaluate<{ src?: string }>(`(() => {
    const frame = document.querySelector('.studio-preview-cell iframe')
    const status = document.querySelector('.studio-status')
    return { exists: frame instanceof HTMLIFrameElement, src: frame?.src,
      connected: frame?.isConnected, loads: window.__taoFastRefreshFrameProbe?.loads,
      status: status?.textContent, statusState: status?.getAttribute('data-state') }
  })()`)
  )
  const bootstrap = await read(async () => {
    if ('error' in iframe || iframe.src === undefined) {
      return { unavailable: 'iframe source missing' }
    }
    const previewInstanceId = new URL(iframe.src).searchParams.get('taoStudioPreviewInstanceId')
    if (previewInstanceId === null) {
      return { unavailable: 'preview instance id missing' }
    }
    const url = new URL(`${studio.readiness.sessionUrl}/api/preview/cell/bootstrap`)
    url.searchParams.set('previewInstanceId', previewInstanceId)
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) } as RequestInit)
    const body = await response.json() as { identity?: unknown; replay?: { domains?: { domain: string }[] } }
    return {
      status: response.status,
      identity: body.identity,
      replayDomains: body.replay?.domains?.map(domain => domain.domain),
    }
  })
  const preview = await read(() =>
    browser.evaluateInFrame(
      previewUrl,
      `(() => ({
    href: location.href, readyState: document.readyState, text: document.body?.innerText?.slice(0, 2000),
    stages: window.__taoStudioPreviewDiagnostics ?? [],
  }))()`,
      { world: 'page' },
    )
  )
  const diagnostics = {
    step,
    manifest,
    iframe,
    bootstrap,
    preview,
    browserEvents: browser.browserEvents().slice(-80),
    metroOutput: studio.output().slice(-30_000),
  }
  const path = FS.resolvePath(
    `preview-readiness-${studio.readiness.launchId}-${step}.json`,
    studio.readiness.artifactRoot,
  )
  await FS.writeJson(path, diagnostics)
  if (step === 'preview-timeout') {
    HCI.writeErrorLine(`Studio preview ${step} diagnostics: ${path}`)
    HCI.writeErrorLine(`Studio preview stage summary: ${
      JSON.stringify({
        manifest: 'error' in manifest ? manifest : {
          status: manifest.status,
          compileRevision: manifest.compileRevision,
          manifestRevision: manifest.manifestRevision,
          cells: manifest.cells?.length,
        },
        iframe,
        bootstrap,
        preview,
      })
    }`)
  }
  return path
}

async function waitForCompileAfter(browser: StudioCdp, previousRevision: number): Promise<number> {
  let last = ''
  let revision: number | undefined
  const ready = await Time.pollUntil(async () => {
    last = await browser.evaluate<string>("document.querySelector('.studio-status')?.textContent ?? ''")
    const state = await browser.evaluate<string>(
      "document.querySelector('.studio-status')?.getAttribute('data-state') ?? ''",
    )
    const match = /^compiled (\d+) · applied \d+ —/.exec(last)?.[1]
    revision = match === undefined ? undefined : Number(match)
    return state === 'compiled' && revision !== undefined && revision > previousRevision
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready || revision === undefined) {
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio compile revision after ${previousRevision}; last=${JSON.stringify(last)}`,
    )
  }
  return revision
}

async function setInteractionMode(browser: StudioCdp, mode: 'edit' | 'run'): Promise<void> {
  await browser.evaluate(`(() => {
    const button = document.querySelector('.studio-interaction-mode')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing Studio interaction mode control')
    if (button.dataset.mode !== ${JSON.stringify(mode)}) button.click()
    return button.dataset.mode
  })()`)
}

/**
 * The native button answers pointer input rather than a synthetic `click()`, so the press is real
 * mouse input at the button's centre, mapped out of the preview frame and through the canvas zoom.
 *
 * The mode reaches the preview by message, so a press sent before it lands is still Studio's. Press
 * only while the count still reads 0, and give each press time to render before looking again, so a
 * press that did land is never repeated.
 */
async function pressIncrementOnce(browser: StudioCdp, previewUrl: string): Promise<void> {
  const counted =
    `[...document.querySelectorAll('[data-tao-studio]')].some(element => element.textContent?.trim() === '1')`
  const ready = await Time.pollUntil(async () => {
    if (await browser.evaluateInFrame<boolean>(previewUrl, counted)) {
      return true
    }
    const inFrame = await browser.evaluateInFrame<Readonly<{ x: number; y: number }>>(
      previewUrl,
      `(() => {
      const increment = [...document.querySelectorAll('[data-tao-studio]')]
        .filter(element => element.textContent?.trim() === 'Increment')
        .toSorted((left, right) => left.querySelectorAll('[data-tao-studio]').length
          - right.querySelectorAll('[data-tao-studio]').length)[0]
      if (!(increment instanceof HTMLElement)) throw new Error('Missing Increment control')
      const rect = increment.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`,
    )
    const point = await browser.evaluate<Readonly<{ x: number; y: number }>>(`(() => {
      const frame = document.querySelector('.studio-preview-cell iframe')
      if (!(frame instanceof HTMLIFrameElement)) throw new Error('Missing Studio preview iframe')
      const rect = frame.getBoundingClientRect()
      const scale = frame.clientWidth === 0 ? 1 : rect.width / frame.clientWidth
      return { x: rect.left + ${inFrame.x} * scale, y: rect.top + ${inFrame.y} * scale }
    })()`)
    await browser.clickAt(point)
    await Time.sleep(300)
    return await browser.evaluateInFrame<boolean>(previewUrl, counted)
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready) {
    Errors.throwHostEnvironment('Timed out pressing Increment in Run mode.')
  }
}

async function waitForStudioStatus(browser: StudioCdp, expected: string): Promise<void> {
  let last: Readonly<{ state: string; text: string }> = { state: '', text: '' }
  const ready = await Time.pollUntil(async () => {
    last = await browser.evaluate<Readonly<{ state: string; text: string }>>(`(() => {
      const status = document.querySelector('.studio-status')
      return { state: status?.getAttribute('data-state') ?? '', text: status?.textContent ?? '' }
    })()`)
    return last.state === expected
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!ready) {
    Errors.throwHostEnvironment(`Timed out waiting for Studio status ${expected}; last=${JSON.stringify(last)}`)
  }
}

async function replaceEditorSource(browser: StudioCdp, source: string): Promise<void> {
  await browser.click('.cm-content')
  await browser.pressShortcut('a')
  await browser.insertText(source)
  await browser.pressShortcut('s')
}

async function waitForSourceOrder(path: string, ordered: readonly string[]): Promise<void> {
  let source = ''
  const updated = await Time.pollUntil(async () => {
    source = await FS.readText(path)
    let previous = -1
    for (const text of ordered) {
      const index = source.indexOf(text)
      if (index <= previous) {
        return false
      }
      previous = index
    }
    return true
  }, { intervalMs: 100, timeoutMs: 30_000 })
  if (!updated) {
    Errors.throwHostEnvironment(
      `Timed out waiting for Studio source order ${ordered.join(', ')}. Last source:\n${source}`,
    )
  }
}

async function dragThirdBetweenFirstAndSecond(browser: StudioCdp, previewUrl: string): Promise<void> {
  await browser.evaluateInFrame(
    previewUrl,
    `(() => {
    const exactRender = text => [...document.querySelectorAll('[data-tao-studio]')]
      .filter(element => element.textContent?.trim() === text)
      .toSorted((left, right) => left.querySelectorAll('[data-tao-studio]').length
        - right.querySelectorAll('[data-tao-studio]').length)[0]
    const first = exactRender('First')
    const second = exactRender('Second')
    const third = exactRender('Third')
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement) || !(third instanceof HTMLElement)) {
      throw new Error('Missing draggable Studio render targets')
    }
    const firstRect = first.getBoundingClientRect()
    const secondRect = second.getBoundingClientRect()
    const thirdRect = third.getBoundingClientRect()
    const start = { x: thirdRect.left + thirdRect.width / 2, y: thirdRect.top + thirdRect.height / 2 }
    const end = {
      x: firstRect.left + firstRect.width / 2,
      y: (firstRect.top + firstRect.height / 2 + secondRect.top + secondRect.height / 2) / 2,
    }
    third.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
    }))
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: end.x,
      clientY: end.y,
    }))
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: end.x,
      clientY: end.y,
    }))
    return true
  })()`,
  )
}
