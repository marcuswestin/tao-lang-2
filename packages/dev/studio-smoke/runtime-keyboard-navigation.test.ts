import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import { openStudioPreviewSession } from '@studio'
import { StudioCdp } from '../dev-src/studio/StudioCdp'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from '../dev-src/studio/StudioPreviewRuntime'

type StaticExportServer = {
  stop(): void
  url: string
}

/**
 * The Tao journeys call the attention reducer directly, and the Jest integration suite supplies a
 * fake document. This deliberately slower test crosses the missing boundary: a generated app is
 * exported, loaded in Chrome, and driven with physical CDP key events while a real input and DOM
 * hierarchy are mounted.
 */
Test('generated WordFlower keyboard navigation works in a real browser', async () => {
  const repositoryRoot = Repo.getRoot()
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/runtime-keyboard-navigation/local', repositoryRoot)
  const runtimeToolchainRoot = FS.resolvePath('packages/runtime-toolchain', repositoryRoot)
  const projectRoot = FS.resolvePath('Apps/WordFlower/1 - Current', repositoryRoot)
  const exportRoot = FS.resolvePath('web-export', artifactRoot)
  await FS.mkdir(artifactRoot)
  await FS.remove(exportRoot)

  let browser: StudioCdp | undefined
  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let runtime: CreatedStudioPreviewRuntime | undefined
  let server: StaticExportServer | undefined
  try {
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
      prefixedOutput: { processName: 'keyboard-browser-export' },
    })
    server = startStaticExport(exportRoot, smokePort())
    browser = await StudioCdp.launchChrome({ artifactRoot })
    await browser.setViewport(1_440, 900)
    await browser.goto(server.url)
    await browser.waitFor(
      `document.querySelector('input[aria-label="Workspace name"]') instanceof HTMLInputElement`,
      { timeoutMs: 30_000 },
    )

    // Global commands must work before any discovery surface opens and while an input has focus.
    await focusWorkspaceName(browser)
    await browser.pressShortcut('k')
    await browser.waitFor(`document.body.textContent?.includes('Command palette') === true`)
    await browser.pressKey('Escape')
    await browser.waitFor(`document.body.textContent?.includes('Command palette') === false`)

    await createWorkspace(browser, 'Home')
    await createWorkspace(browser, 'Projects')

    // A selectable row must stay a group around its real controls, and a nested delete must not
    // invoke the row's open action.
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

    // These are physical browser key events, not a direct call to TR.Interaction.Narrow.
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

    // Discovery must contain actionable rows; a heading or empty rectangle alone is a failure.
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

    await browser.captureScreenshot('runtime-keyboard-navigation')
    const failures = browser.browserEvents().filter(event =>
      event.kind === 'exception'
      || event.level === 'assert'
      || event.level === 'error'
      || event.level === 'warn'
      || event.level === 'warning'
    )
    Expect(failures).toEqual([])
  } finally {
    await browser?.close()
    server?.stop()
    await preview?.close()
    await runtime?.close()
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
