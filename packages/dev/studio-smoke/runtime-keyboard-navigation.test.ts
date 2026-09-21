import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Expect, runCleanups, Test } from '@shared/test'
import { openStudioPreviewSession } from '@studio'
import { StudioCdp } from '../dev-src/studio/StudioCdp'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from '../dev-src/studio/StudioPreviewRuntime'

type StaticExportServer = {
  stop(): void
  url: string
}

/**
 * The reducer and Jest suites remain fast mutation guards. This deliberately slower acceptance
 * crosses the browser boundary: a generated app is exported, loaded in Chrome, and driven with
 * physical CDP key events while real inputs, command surfaces, and pending-slot controls are mounted.
 */
Test('generated keyboard navigation works in a real browser', async () => {
  const repositoryRoot = Repo.getRoot()
  const artifactBase = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/runtime-keyboard-navigation/local', repositoryRoot)
  const artifactRoot = FS.resolvePath('interaction-authority', artifactBase)
  const runtimeToolchainRoot = FS.resolvePath('packages/apps/expo-host', repositoryRoot)
  const projectRoot = FS.resolvePath(
    'packages/dev/studio-smoke/fixtures/runtime-keyboard-navigation',
    repositoryRoot,
  )
  let browser: StudioCdp | undefined
  let exportRoot: string | undefined
  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let runtime: CreatedStudioPreviewRuntime | undefined
  let server: StaticExportServer | undefined
  let primaryFailure: unknown
  try {
    await FS.mkdir(artifactRoot)
    exportRoot = await FS.mkTmpDir('tao-keyboard-navigation-export-')
    runtime = await StudioPreviewRuntime.create(
      runtimeToolchainRoot,
      FS.resolvePath('runtime', artifactRoot),
    )
    preview = await openStudioPreviewSession({
      appName: 'KeyboardNavigationAcceptance',
      entryPath: FS.resolvePath('KeyboardNavigation.tao', projectRoot),
      previewRuntimeRoot: runtime.root,
      projectRoot,
    })
    const compiled = await preview.session.compileInitial()
    Expect(compiled.status).toBe('compiled')

    await CLI.mustRun(FS.resolvePath('node_modules/.bin/expo', runtime.root), {
      args: ['export', '--platform', 'web', '--output-dir', exportRoot],
      cwd: runtime.root,
      env: {
        ...Platform.runtimeProcess.env,
        CI: '1',
        EXPO_NO_DOTENV: '1',
        TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: runtimeToolchainRoot,
      },
      prefixedOutput: { processName: 'keyboard-browser-export' },
    })
    server = startStaticExport(exportRoot, smokePort())
    browser = await StudioCdp.launchChrome({ artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(server.url)
    await browser.waitFor(
      `document.body.textContent?.includes('Keyboard acceptance ready') === true`,
      { timeoutMs: 30_000 },
    )

    // Narrowing may target an input, but targeting alone must not focus or engage it. Enter is the
    // explicit activation edge; only after it does browser-owned text entry reach the input.
    await browser.evaluate(`(document.activeElement instanceof HTMLElement) && document.activeElement.blur()`)
    for (const key of ['i', 'n', 'p']) {
      await browser.pressKey(key)
    }
    await browser.waitFor(
      `document.querySelector('[aria-label="Narrowing “inp”"]') instanceof HTMLElement
        && document.querySelector('[data-testid^="tao-interaction-row:"][aria-label="Acceptance input"]')
          instanceof HTMLElement`,
    )
    Expect(await inputIsFocused(browser, 'Acceptance input')).toBe(false)
    await browser.pressKey('Enter')
    await browser.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Acceptance input'`)
    await browser.insertText('field text')
    await browser.waitFor(
      `document.querySelector('input[aria-label="Acceptance input"]')?.value === 'field text'`,
    )
    Expect(await surfaceHeading(browser)).toBe('')
    await browser.pressKey('Escape')
    await browser.waitFor(`document.activeElement?.getAttribute('aria-label') !== 'Acceptance input'`)

    await browser.click('[aria-label="Seed folders"]')
    await browser.waitFor(`document.body.textContent?.includes('Mounted folder: Archive') === true`)
    await browser.click('[aria-label="Create draft"]')
    await browser.waitFor(`document.body.textContent?.includes('Draft note') === true`)

    // A bare authored command key is ordinary narrowing until the verb layer is explicitly open.
    // Reserved discovery punctuation must open its own surface without invoking that command.
    await browser.pressKey('f')
    await browser.waitFor(`document.querySelector('[aria-label="Narrowing “f”"]') instanceof HTMLElement`)
    Expect(await bodyIncludes(browser, 'Choose Destination for File note')).toBe(false)
    Expect(await bodyIncludes(browser, 'Draft note')).toBe(true)
    await browser.pressKey('Escape')
    for (const key of ['d', 'r', 'a', 'f', 't']) {
      await browser.pressKey(key)
    }
    await browser.waitFor(
      `document.querySelector('[aria-label="Narrowing “draft”"]') instanceof HTMLElement
        && document.querySelector('[data-testid^="tao-interaction-row:"][aria-label="Draft note"]')
          instanceof HTMLElement`,
    )
    await browser.pressKey('Escape')
    await browser.pressKey('/')
    await browser.waitFor(`document.querySelector('[aria-label="Interaction hints"]') instanceof HTMLElement`)
    Expect(await bodyIncludes(browser, 'Choose Destination for File note')).toBe(false)
    await browser.pressKey('/')
    await browser.waitFor(`document.querySelector('[aria-label="Interaction hints"]') === null`)
    await browser.pressKey('.')
    await browser.waitFor(
      `document.querySelector('[aria-label="Actions for Draft note"]') instanceof HTMLElement
        && document.querySelector('[data-testid^="tao-interaction-row:"][aria-label="F — File note"]')
          instanceof HTMLElement`,
    )
    await browser.pressKey('f')

    // The pending surface must expose the mounted entity picker, then the store fallback, then the
    // scalar input. Selecting the unmounted store result and submitting the scalar completes the command.
    await browser.waitFor(
      `document.querySelector('[aria-label="Choose Destination for File note"]') instanceof HTMLElement
        && document.querySelector('[data-testid="tao-interaction-pending-search"]') instanceof HTMLElement
        && document.querySelector('[data-testid^="tao-interaction-row:"][aria-label="Archive"]')
          instanceof HTMLElement`,
    )
    Expect(await interactionRowLabels(browser)).toEqual(['Archive'])
    await browser.click('[data-testid="tao-interaction-pending-search"]')
    await browser.waitFor(
      `document.querySelector('[data-testid^="tao-interaction-row:"][aria-label="Home"]')
        instanceof HTMLElement`,
    )
    Expect(await interactionRowLabels(browser)).toEqual(['Archive', 'Home'])
    await browser.click('[data-testid^="tao-interaction-row:"][aria-label="Home"]')
    await browser.waitFor(
      `document.querySelector('input[data-testid="tao-interaction-pending-input"]') instanceof HTMLInputElement
        && document.activeElement?.getAttribute('aria-label') === 'Label for File note'`,
    )
    await browser.insertText('Filed note')
    await browser.pressKey('Enter')
    await browser.waitFor(`document.body.textContent?.includes('Filed note') === true`)
    Expect(await bodyIncludes(browser, 'Choose Destination for File note')).toBe(false)

    // Palette letters filter rather than dispatching accelerators. Arrows cycle the actual displayed
    // selection, and Enter invokes that selected row rather than the first or a stale candidate.
    await browser.pressShortcut('k')
    await browser.waitFor(`document.querySelector('[aria-label="Command palette"]') instanceof HTMLElement`)
    for (const key of ['r', 'e', 'c']) {
      await browser.pressKey(key)
    }
    await browser.waitFor(`(() => {
      const rows = [...document.querySelectorAll('[data-testid^="tao-interaction-row:"]')]
      return rows.length === 3
        && rows[0]?.getAttribute('aria-label') === 'Record alpha'
        && rows[1]?.getAttribute('aria-label') === 'Record beta'
        && rows[2]?.getAttribute('aria-label') === 'Record gamma'
        && rows[0]?.getAttribute('aria-selected') === 'true'
    })()`)
    await browser.pressKey('ArrowUp')
    await browser.waitFor(
      `document.querySelector('[aria-selected="true"]')?.getAttribute('aria-label') === 'Record gamma'`,
    )
    await browser.pressKey('ArrowDown')
    await browser.waitFor(
      `document.querySelector('[aria-selected="true"]')?.getAttribute('aria-label') === 'Record alpha'`,
    )
    await browser.pressKey('ArrowDown')
    await browser.waitFor(
      `document.querySelector('[aria-selected="true"]')?.getAttribute('aria-label') === 'Record beta'`,
    )
    await browser.pressKey('Enter')
    await browser.waitFor(`document.body.textContent?.includes('Beta invoked') === true`)
    Expect(await bodyIncludes(browser, 'Alpha invoked')).toBe(false)

    await browser.captureScreenshot('runtime-keyboard-navigation')
    const failures = browser.browserEvents().filter(event =>
      event.kind === 'exception'
      || event.level === 'assert'
      || event.level === 'error'
      || event.level === 'warn'
      || event.level === 'warning'
    )
    Expect(failures).toEqual([])
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    await runCleanups(primaryFailure, [
      { label: 'close browser', run: () => browser?.close() },
      { label: 'stop export server', run: () => server?.stop() },
      { label: 'close preview session', run: () => preview?.close() },
      { label: 'remove preview runtime', run: () => runtime?.close() },
      { label: 'remove web export', run: () => exportRoot === undefined ? undefined : FS.remove(exportRoot) },
    ], { channel: 'keyboard-journey-cleanup', subject: 'keyboard journey' })
  }
}, 180_000)

Test('generated WordFlower keyboard navigation works in a real browser', async () => {
  const repositoryRoot = Repo.getRoot()
  const artifactBase = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/runtime-keyboard-navigation/local', repositoryRoot)
  const artifactRoot = FS.resolvePath('wordflower-existing', artifactBase)
  const runtimeToolchainRoot = FS.resolvePath('packages/apps/expo-host', repositoryRoot)
  const projectRoot = FS.resolvePath('Apps/WordFlower/1 - Current', repositoryRoot)
  let browser: StudioCdp | undefined
  let exportRoot: string | undefined
  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let runtime: CreatedStudioPreviewRuntime | undefined
  let server: StaticExportServer | undefined
  let primaryFailure: unknown
  try {
    await FS.mkdir(artifactRoot)
    exportRoot = await FS.mkTmpDir('tao-wordflower-keyboard-export-')
    runtime = await StudioPreviewRuntime.create(
      runtimeToolchainRoot,
      FS.resolvePath('runtime', artifactRoot),
    )
    preview = await openStudioPreviewSession({
      appName: 'WordFlower',
      entryPath: FS.resolvePath('WordFlower.tao', projectRoot),
      previewRuntimeRoot: runtime.root,
      projectRoot,
    })
    const compiled = await preview.session.compileInitial()
    Expect(compiled.status).toBe('compiled')

    await CLI.mustRun(FS.resolvePath('node_modules/.bin/expo', runtime.root), {
      args: ['export', '--platform', 'web', '--output-dir', exportRoot],
      cwd: runtime.root,
      env: {
        ...Platform.runtimeProcess.env,
        CI: '1',
        EXPO_NO_DOTENV: '1',
        TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: runtimeToolchainRoot,
      },
      prefixedOutput: { processName: 'wordflower-keyboard-browser-export' },
    })
    server = startStaticExport(exportRoot, smokePort())
    browser = await StudioCdp.launchChrome({ artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(server.url)
    await browser.waitFor(
      `document.querySelector('input[aria-label="Workspace name"]') instanceof HTMLInputElement`,
      { timeoutMs: 30_000 },
    )

    await focusWorkspaceName(browser)
    await browser.pressShortcut('k')
    await browser.waitFor(`document.body.textContent?.includes('Command palette') === true`)
    await browser.pressKey('Escape')
    await browser.waitFor(`document.body.textContent?.includes('Command palette') === false`)

    await createWorkspace(browser, 'Home')
    await createWorkspace(browser, 'Projects')

    Expect(
      await browser.evaluate<boolean>(`(() => {
      const row = document.querySelector('[role="group"][aria-label="Home"]')
      const nestedDelete = row?.querySelector('[aria-label="Delete workspace"]')
      return row instanceof HTMLElement
        && !(row instanceof HTMLButtonElement)
        && nestedDelete instanceof HTMLElement
    })()`),
    ).toBe(true)
    await browser.click('[role="group"][aria-label="Home"] [aria-label="Delete workspace"]')
    await browser.waitFor(`document.querySelector('[role="group"][aria-label="Home"]') === null`)
    Expect(
      await browser.evaluate<boolean>(
        `document.querySelector('[role="group"][aria-label="Projects"]') instanceof HTMLElement`,
      ),
    ).toBe(true)
    Expect(await navigationTitle(browser)).toBe('WordFlower')

    await browser.evaluate(`(document.activeElement instanceof HTMLElement) && document.activeElement.blur()`)
    for (const key of ['p', 'r', 'o']) {
      await browser.pressKey(key)
    }
    await browser.waitFor(
      `document.querySelector('[aria-label="Narrowing “pro”"]') instanceof HTMLElement
        && document.querySelector('[data-testid^="tao-interaction-row:"][aria-label="Projects"]')
          instanceof HTMLElement`,
    )
    await browser.pressKey('Enter')
    await browser.waitFor(
      `document.querySelector('[data-testid="__tao_navigation_title"]')?.textContent === 'Projects'`,
    )

    await browser.pressKey('/')
    await browser.waitFor(`(() => {
      const heading = document.querySelector('[aria-label="Interaction hints"]')
      const rows = document.querySelectorAll('[data-testid^="tao-interaction-row:"]')
      return heading instanceof HTMLElement && rows.length > 0
    })()`)
    await browser.pressKey('/')
    for (const key of ['x', 'q', 'z']) {
      await browser.pressKey(key)
    }
    await browser.waitFor(`document.body.textContent?.includes('No matching targets') === true`)

    await browser.captureScreenshot('runtime-keyboard-navigation-wordflower')
    const failures = browser.browserEvents().filter(event =>
      event.kind === 'exception'
      || event.level === 'assert'
      || event.level === 'error'
      || event.level === 'warn'
      || event.level === 'warning'
    )
    Expect(failures).toEqual([])
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    await runCleanups(primaryFailure, [
      { label: 'close browser', run: () => browser?.close() },
      { label: 'stop export server', run: () => server?.stop() },
      { label: 'close preview session', run: () => preview?.close() },
      { label: 'remove preview runtime', run: () => runtime?.close() },
      { label: 'remove web export', run: () => exportRoot === undefined ? undefined : FS.remove(exportRoot) },
    ], { channel: 'keyboard-journey-cleanup', subject: 'keyboard journey' })
  }
}, 180_000)

async function createWorkspace(browser: StudioCdp, name: string): Promise<void> {
  await focusWorkspaceName(browser)
  await browser.insertText(name)
  await browser.waitFor(
    `document.querySelector('input[aria-label="Workspace name"]')?.value === ${JSON.stringify(name)}`,
  )
  await browser.click('[aria-label="Add workspace"]')
  await browser.waitFor(
    `document.querySelector(${JSON.stringify(`[role="group"][aria-label="${name}"]`)}) instanceof HTMLElement`,
  )
}

async function focusWorkspaceName(browser: StudioCdp): Promise<void> {
  const focused = await browser.evaluate<boolean>(`(() => {
    const input = document.querySelector('input[aria-label="Workspace name"]')
    if (!(input instanceof HTMLInputElement)) return false
    input.focus()
    return document.activeElement === input
  })()`)
  if (!focused) {
    Errors.throwHostEnvironment('Could not focus the workspace-name input')
  }
}

async function navigationTitle(browser: StudioCdp): Promise<string> {
  return await browser.evaluate<string>(
    `document.querySelector('[data-testid="__tao_navigation_title"]')?.textContent ?? ''`,
  )
}

async function bodyIncludes(browser: StudioCdp, text: string): Promise<boolean> {
  return await browser.evaluate<boolean>(`document.body.textContent?.includes(${JSON.stringify(text)}) === true`)
}

async function inputIsFocused(browser: StudioCdp, label: string): Promise<boolean> {
  return await browser.evaluate<boolean>(
    `document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(label)}`,
  )
}

async function interactionRowLabels(browser: StudioCdp): Promise<string[]> {
  return await browser.evaluate<string[]>(`[...document.querySelectorAll('[data-testid^="tao-interaction-row:"]')]
    .map(row => row.getAttribute('aria-label') ?? '')`)
}

async function surfaceHeading(browser: StudioCdp): Promise<string> {
  return await browser.evaluate<string>(
    `document.querySelector('[data-testid="tao-interaction-layers"] [role="heading"]')
      ?.getAttribute('aria-label') ?? ''`,
  )
}

function smokePort(): number {
  const value = Number(Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_SERVER_PORT'] ?? 42_008)
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    Errors.throwUserInput('TAO_STUDIO_SMOKE_SERVER_PORT must be a valid TCP port.')
  }
  return value
}

function startStaticExport(root: string, port: number): StaticExportServer {
  const server = Bun.serve({
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
      if (relativePath.split('/').includes('..')) {
        return new Response('Invalid path.', { status: 400 })
      }
      const path = FS.resolvePath(relativePath, root)
      if (!await FS.isFile(path)) {
        return new Response('Not found.', { status: 404 })
      }
      return new Response(await FS.readFile(path), {
        headers: { 'content-type': contentType(path) },
      })
    },
    hostname: '127.0.0.1',
    port,
  })
  return {
    stop: () => server.stop(true),
    url: `http://127.0.0.1:${port}`,
  }
}

function contentType(path: string): string {
  if (path.endsWith('.html')) {
    return 'text/html; charset=utf-8'
  }
  if (path.endsWith('.js')) {
    return 'text/javascript; charset=utf-8'
  }
  if (path.endsWith('.json')) {
    return 'application/json; charset=utf-8'
  }
  if (path.endsWith('.ttf')) {
    return 'font/ttf'
  }
  return 'application/octet-stream'
}
