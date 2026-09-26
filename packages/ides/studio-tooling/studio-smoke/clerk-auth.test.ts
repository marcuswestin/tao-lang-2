import { createClerkClient } from '@clerk/backend'
import { clerkSetup } from '@clerk/testing/playwright'
import Compiler from '@compiler'
import { Assert, CLI, Errors, FS, Platform, ProcessTree, Repo, Time } from '@shared'
import { Expect, mkTestDir, runCleanups, Test } from '@shared/test'
import { openStudioPreviewSession } from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from '../studio-tooling-src/StudioPreviewRuntime'
import { clerkFailureSummary, clerkTestingTokenScript, loadClerkLiveConfiguration } from './clerk-testing-token'

/**
 * Explicit remote acceptance: a development Clerk instance with password and email-code enabled,
 * without required MFA/session tasks. Supply TAO_CLERK_LIVE=1, CLERK_PUBLISHABLE_KEY,
 * CLERK_SECRET_KEY and CLERK_JWT_KEY through the invoking environment or the repository secrets store.
 * Run with ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/clerk-auth.test.ts
 */
Test('real Clerk password and email-code UI sessions authorize durable Account and Note data', async () => {
  const env = Platform.runtimeProcess.env
  const configuration = await loadClerkLiveConfiguration(env)
  if (configuration === undefined) {
    Platform.runtimeConsole.warn(
      'Skipped: real Clerk browser acceptance requires TAO_CLERK_LIVE=1 and development instance keys.',
    )
    return
  }
  const artifactBase = env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT'] ?? Repo.resolvePath('.artifacts/studio-smoke/clerk')
  await FS.mkdir(artifactBase)
  const artifactRoot = await mkTestDir('clerk-live-')
  const ownershipPath = FS.resolvePath(`${FS.basename(artifactRoot)}-ownership.json`, artifactBase)
  const owned: Array<{ path: string; owner: string; purpose: string; cleanup: string }> = []
  const record = async (path: string, purpose: string) => {
    owned.push({ path, owner: 'clerk-auth smoke', purpose, cleanup: 'Removed in the journey finally block.' })
    await FS.writeJson(ownershipPath, owned)
  }
  let clerk: ReturnType<typeof createClerkClient> | undefined
  let projectRoot: string | undefined
  let browser: StudioCdp | undefined
  let runtime: CreatedStudioPreviewRuntime | undefined
  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let staticServer: ReturnType<typeof startStaticExport> | undefined
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined
  let userId: string | undefined
  let primaryFailure: unknown
  let stage = 'prepare compiled app'
  const previousFapi = env['CLERK_FAPI']
  const previousTestingToken = env['CLERK_TESTING_TOKEN']
  try {
    // Discovery honors Git ignores; the source project must be outside .artifacts.
    projectRoot = await mkTestDir('tao-clerk-live-project-', { location: 'host' })
    await record(projectRoot, 'Disposable Auth Review source project')
    const exportRoot = FS.resolvePath('export', artifactRoot)
    await FS.mkdir(exportRoot)
    staticServer = startStaticExport(exportRoot)
    const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
    const compiled = await Compiler.compileCode(source, { appName: 'AuthReviewClerk' })
    const policyFile = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
    if (policyFile === undefined) {
      Errors.throwUnexpected('Auth Review must emit its account data policy.')
    }
    gateway = await startGateway(artifactRoot, policyFile.code, configuration, staticServer.url)
    const configuredSource = source.replaceAll('pk_test_REPLACE_WITH_YOUR_KEY', configuration.publishableKey)
      .replaceAll('http://127.0.0.1:4738', gateway.url)
    await FS.writeText(FS.resolvePath('Auth Review.tao', projectRoot), configuredSource)
    await FS.writeText(
      FS.resolvePath('Project.tao', projectRoot),
      'project { id "tao-clerk-live" name "Clerk live acceptance" }\n',
    )
    const toolchainRoot = Repo.resolvePath('packages/apps/expo-host')
    runtime = await StudioPreviewRuntime.create(toolchainRoot, FS.resolvePath('runtime', artifactRoot))
    preview = await openStudioPreviewSession({
      appName: 'AuthReviewClerk',
      entryPath: FS.resolvePath('Auth Review.tao', projectRoot),
      previewRuntimeRoot: runtime.root,
      projectRoot,
    })
    Expect((await preview.session.compileInitial()).status).toBe('compiled')
    await CLI.mustRun(FS.resolvePath('node_modules/.bin/expo', runtime.root), {
      args: ['export', '--platform', 'web', '--output-dir', exportRoot],
      cwd: runtime.root,
      env: {
        ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLERK_'))),
        CI: '1',
        EXPO_NO_DOTENV: '1',
        TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: toolchainRoot,
      },
      prefixedOutput: { processName: 'clerk-browser-export' },
    })

    stage = 'request Clerk testing token'
    clerk = createClerkClient({ secretKey: configuration.secretKey, publishableKey: configuration.publishableKey })
    await clerkSetup({
      publishableKey: configuration.publishableKey,
      secretKey: configuration.secretKey,
      dotenv: false,
    })
    stage = 'validate Clerk testing token instance'
    const testingToken = env['CLERK_TESTING_TOKEN']
    if (!testingToken || `https://${env['CLERK_FAPI']}` !== configuration.issuer) {
      Errors.throwHostEnvironment('Clerk testing setup did not return the configured instance and testing token.')
    }
    const email = `tao-${crypto.randomUUID()}+clerk_test@example.com`
    const password = `Tao!${crypto.randomUUID()}a7`
    stage = 'create development test user'
    const user = await clerk.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true })
    userId = user.id
    stage = 'launch disposable browser'
    // No screenshots, network captures, browser console dumps, or serialized auth state: the
    // authored password field is plain text and browser failures may include signed request URLs.
    browser = await StudioCdp.launchChrome({
      onProfileCreated: path => record(path, 'Disposable Chrome session profile'),
    })
    await browser.addInitScript(clerkTestingTokenScript(configuration.issuer, testingToken))
    await browser.goto(staticServer.url)
    stage = 'password sign-in through Tao UI'
    await fill(browser, 'Account email', email)
    await fill(browser, 'Password', password)
    await browser.click('[aria-label="Sign in"]')
    await browser.waitFor(`document.querySelector('[aria-label="Account profile"]') !== null`, { timeoutMs: 60_000 })

    stage = 'save Account profile and owned Note through gateway'
    await fill(browser, 'Display name', 'Clerk browser account')
    await clickButtonText(browser, 'Save profile')
    await browser.waitFor(`document.body.textContent?.includes('Hello Clerk browser account') === true`)
    await fill(browser, 'New note', 'Clerk password note')
    await browser.click('[aria-label="Add note"]')
    await browser.waitFor(`document.body.textContent?.includes('Clerk password note') === true`)
    // Reload discards optimistic React state and proves the reference authority persisted both writes.
    await browser.goto(staticServer.url)
    await browser.waitFor(`document.body.textContent?.includes('Clerk password note') === true`, { timeoutMs: 60_000 })
    Expect(await bodyIncludes(browser, 'Hello Clerk browser account')).toBe(true)

    stage = 'sign-out clears account data'
    await signOut(browser)
    Expect(await bodyIncludes(browser, 'Clerk password note')).toBe(false)
    Expect(await bodyIncludes(browser, 'Hello Clerk browser account')).toBe(false)
    stage = 'email-code sign-in through Tao UI'
    await browser.click('[aria-label="Use email code"]')
    await fill(browser, 'Email for code', email)
    await browser.click('[aria-label="Send code"]')
    await fill(browser, 'Code', '424242')
    await browser.click('[aria-label="Verify code"]')
    await browser.waitFor(`document.body.textContent?.includes('Clerk password note') === true`, { timeoutMs: 60_000 })
    Expect(await bodyIncludes(browser, 'Hello Clerk browser account')).toBe(true)
    await fill(browser, 'New note', 'Clerk email-code note')
    await browser.click('[aria-label="Add note"]')
    await browser.waitFor(`document.body.textContent?.includes('Clerk email-code note') === true`)
    await browser.goto(staticServer.url)
    await browser.waitFor(`document.body.textContent?.includes('Clerk email-code note') === true`, {
      timeoutMs: 60_000,
    })
    await signOut(browser)
    Expect(await bodyIncludes(browser, 'Clerk email-code note')).toBe(false)
    Expect(await bodyIncludes(browser, 'Clerk password note')).toBe(false)
  } catch (error) {
    // Neither SDK errors nor CDP exceptions are safe durable artifacts: they can embed credentials.
    primaryFailure = true
    Errors.throwHostEnvironment(`Clerk live browser acceptance failed during: ${stage}.${clerkFailureSummary(error)}`)
  } finally {
    if (previousFapi === undefined) {
      delete env['CLERK_FAPI']
    } else {
      env['CLERK_FAPI'] = previousFapi
    }
    if (previousTestingToken === undefined) {
      delete env['CLERK_TESTING_TOKEN']
    } else {
      env['CLERK_TESTING_TOKEN'] = previousTestingToken
    }
    await runCleanups(primaryFailure, [
      { label: 'close disposable browser', run: () => browser?.close() },
      {
        label: 'delete synthetic Clerk user',
        run: async () => {
          if (userId === undefined || clerk === undefined) {
            return
          }
          try {
            await clerk.users.deleteUser(userId)
          } catch {
            Errors.throwHostEnvironment(
              `Could not delete synthetic Clerk user ${userId}; remove it from the development instance.`,
            )
          }
        },
      },
      { label: 'stop web export', run: () => staticServer?.stop() },
      { label: 'close preview', run: () => preview?.close() },
      { label: 'remove runtime', run: () => runtime?.close() },
      { label: 'stop account gateway', run: () => gateway?.stop() },
      { label: 'remove source project', run: () => projectRoot === undefined ? undefined : FS.remove(projectRoot) },
      { label: 'remove disposable state', run: () => FS.remove(artifactRoot) },
    ], { channel: 'clerk-live-cleanup', subject: 'Clerk live browser acceptance' })
  }
}, 300_000)

async function fill(browser: StudioCdp, label: string, value: string): Promise<void> {
  const selector = `input[aria-label=${JSON.stringify(label)}]`
  await browser.waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, { timeoutMs: 60_000 })
  await browser.click(selector)
  await browser.pressShortcut('a')
  await browser.insertText(value)
}

async function signOut(browser: StudioCdp): Promise<void> {
  await browser.click('[aria-label="Sign out"]')
  await browser.waitFor(`document.querySelector('input[aria-label="Account email"]') !== null`)
  Expect(await browser.evaluate<boolean>(`document.querySelector('[aria-label="Account profile"]') === null`)).toBe(
    true,
  )
}

async function bodyIncludes(browser: StudioCdp, text: string): Promise<boolean> {
  return await browser.evaluate<boolean>(`document.body.textContent?.includes(${JSON.stringify(text)}) === true`)
}

async function clickButtonText(browser: StudioCdp, label: string): Promise<void> {
  const clicked = await browser.evaluate<boolean>(`(() => {
    const button = [...document.querySelectorAll('button, [role="button"]')]
      .find(element => element.textContent?.trim() === ${JSON.stringify(label)})
    if (!(button instanceof HTMLElement)) return false
    button.click()
    return true
  })()`)
  Assert(clicked, 'the rendered account profile has a save button')
}

async function startGateway(
  root: string,
  policy: string,
  configuration: { issuer: string; jwtKey: string },
  origin: string,
) {
  const policyPath = FS.resolvePath('TaoDataPolicy.json', root)
  const clerkPath = FS.resolvePath('clerk-public-trust.json', root)
  const readyPath = FS.resolvePath('gateway-ready.json', root)
  await FS.writeText(policyPath, policy)
  await FS.writeJson(clerkPath, {
    issuer: configuration.issuer,
    jwtKey: configuration.jwtKey,
    authorizedParties: [origin],
  })
  const command = CLI.start(Repo.resolvePath('agent'), {
    args: [
      'auth-review-server',
      '--policy',
      policyPath,
      '--clerk-config',
      clerkPath,
      '--database',
      FS.resolvePath('accounts.sqlite', root),
      '--port',
      '0',
      '--resource',
      'auth-review',
      '--issuer',
      'tao-local:clerk-live',
      '--origin',
      origin,
      '--ready-file',
      readyPath,
    ],
    cwd: Repo.getRoot(),
    detached: true,
    stdio: 'pipe',
    env: Object.fromEntries(Object.entries(Platform.runtimeProcess.env).filter(([key]) => !key.startsWith('CLERK_'))),
  })
  const stop = async () => {
    await ProcessTree.stopTree(command.pid)
    await command.waitForClose()
    await command.closeOutput()
    command.dispose()
  }
  try {
    const ready = await Time.pollUntil(async () => {
      if (command.exitCode !== null || command.signalCode !== null || command.error !== undefined) {
        Errors.throwHostEnvironment('The Clerk account gateway exited before reporting readiness.')
      }
      if (!await FS.isFile(readyPath)) {
        return undefined
      }
      return await FS.readJson<{ resource: string; url: string }>(readyPath)
    }, { timeoutMs: 60_000, intervalMs: 100 })
    if (!ready || ready.resource !== 'auth-review' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url)) {
      Errors.throwHostEnvironment('The Clerk account gateway did not report its localhost URL.')
    }
    return { url: ready.url, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

function startStaticExport(root: string) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
      if (relative.split('/').includes('..')) {
        return new Response('Invalid path', { status: 400 })
      }
      const path = FS.resolvePath(relative, root)
      if (!await FS.isFile(path)) {
        return new Response('Not found', { status: 404 })
      }
      const contentType = path.endsWith('.html') ? 'text/html' : path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.json')
        ? 'application/json'
        : path.endsWith('.ttf')
        ? 'font/ttf'
        : 'application/octet-stream'
      return new Response(await FS.readFile(path), { headers: { 'content-type': contentType } })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
