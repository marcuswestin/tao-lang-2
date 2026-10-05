import {
  type AppiumLocator,
  type AppiumPortReservation,
  type AppiumPortReservations,
  createStudioMac2AcceptanceFactory,
  type Mac2HostController,
  type Mac2HostSession,
  startAppiumServer,
} from '@appium-driver'
import { HostControlError, type HostTarget, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Expect, runCleanups, until } from '@shared/test'
import { StudioMac2TestRun } from '../studio-tooling-src/StudioMac2TestRun'
import { StudioNative } from '../studio-tooling-src/StudioNative'
import { StudioNativeTestRun } from '../studio-tooling-src/StudioNativeTestRun'

const revision = { build: 'studio-mac2-acceptance-1', source: 'studio-mac2-smoke' }

const fixtureScope = "//XCUIElementTypeWebView[@label='Studio Mac2 acceptance']"
  // Pinned WDA evaluates XPath on a detached snapshot root; embedded absolute paths have no document.
  + "[count(ancestor::XCUIElementTypeApplication//XCUIElementTypeWebView[@label='Studio Mac2 acceptance'])=1]"
  + "[count(.//XCUIElementTypeStaticText[@value='Studio Mac2 acceptance fixture'])=1]"

/** Fixed native selectors proved by the owned fixture XML; count guards refuse duplicate scopes or controls. */
export function resolveMac2FixtureTarget(target: HostTarget): AppiumLocator {
  if (target.kind !== 'accessibility' || target.occurrence !== undefined) {
    return Errors.throwUnexpected('The fixed Mac2 fixture accepts only its unique named native targets.')
  }
  if (target.name === 'mac2-fixture') {
    return { using: 'xpath', value: fixtureScope }
  }
  const nativeTargets: Readonly<Record<string, string>> = {
    'mac2-state-waiting': "XCUIElementTypeStaticText[starts-with(@value, 'Acceptance state: ')]",
    'mac2-state-clicked': "XCUIElementTypeStaticText[starts-with(@value, 'Acceptance state: ')]",
    'mac2-update': 'XCUIElementTypeButton',
    'mac2-input': "XCUIElementTypeTextField[@label='Acceptance text input']",
    'mac2-input-typed': "XCUIElementTypeStaticText[starts-with(@value, 'Acceptance input: ')]",
  }
  const nativeTarget = Object.hasOwn(nativeTargets, target.name) ? nativeTargets[target.name] : undefined
  if (nativeTarget === undefined) {
    return Errors.throwUnexpected('The fixed Mac2 fixture has no native target with that name.')
  }
  return { using: 'xpath', value: `${fixtureScope}[count(.//${nativeTarget})=1]//${nativeTarget}` }
}

/** Genuine input proof and original native element images stay scoped to the unique owned fixture WebView. */
export async function captureMac2FixtureInput(
  session: Pick<
    Mac2HostSession,
    'captureTargetScreenshot' | 'descriptor' | 'executeExternalUi' | 'observe' | 'perform'
  >,
  artifactRoot: string,
  studioBundleIdentifier: string,
): Promise<void> {
  const appState = await session.executeExternalUi({
    args: [{ bundleId: studioBundleIdentifier }],
    kind: 'executeScript',
    script: 'macos: queryAppState',
  })
  Expect(typeof appState).toBe('number')
  await FS.writeJson(FS.resolvePath('appium-mac2/app-state.json', artifactRoot), { appState, version: 1 })
  const capture = async (name: string) =>
    await session.captureTargetScreenshot(name, {
      expectedRevision: revision,
      target: { kind: 'accessibility', name: 'mac2-fixture' },
    })
  const before = await capture('studio-native-before-input')
  Expect(await FS.isFile(before.artifactPath)).toBe(true)
  const observe = async (name: string) =>
    await session.observe({ expectedRevision: revision, target: { kind: 'accessibility', name } })
  const waiting = await observe('mac2-state-waiting')
  Expect(waiting.visible).toBe(true)
  Expect(waiting.text).toBe('Acceptance state: waiting')
  const control = await observe('mac2-update')
  Expect(control.visible).toBe(true)
  await session.perform({
    expectedRevision: revision,
    kind: 'click',
    lease: session.descriptor().lease,
    observation: control,
  })
  const observeEventually = async (name: string, value: string) =>
    await until(async () => {
      // Observe the unique stable result node while its old value is still published; only exact final text proves input.
      // Missing or ambiguous native nodes and ownership failures remain errors, rather than retryable absence.
      const observed = await observe(name)
      return observed.visible && observed.text === value ? observed : undefined
    }, { description: `visible native text '${value}'` })
  const changed = await observeEventually('mac2-state-clicked', 'Acceptance state: clicked')
  Expect(changed.visible).toBe(true)
  Expect(changed.text).toBe('Acceptance state: clicked')
  const input = await observe('mac2-input')
  Expect(input.visible).toBe(true)
  await session.perform({
    expectedRevision: revision,
    kind: 'type',
    lease: session.descriptor().lease,
    observation: input,
    text: 'Mac2 typed this',
  })
  const typed = await observeEventually('mac2-input-typed', 'Acceptance input: Mac2 typed this')
  Expect(typed.visible).toBe(true)
  Expect(typed.text).toBe('Acceptance input: Mac2 typed this')
  const after = await capture('studio-native-after-input')
  Expect(await FS.isFile(after.artifactPath)).toBe(true)
  Expect(after.artifactPath).not.toBe(before.artifactPath)
  await FS.writeJson(FS.resolvePath('appium-mac2/input-proof.json', artifactRoot), {
    after: after.artifactPath,
    before: before.artifactPath,
    bundleIdentifier: studioBundleIdentifier,
    capture: { route: 'native-xctest-element', scope: fixtureScope },
    clickedState: 'Acceptance state: clicked',
    typedState: 'Acceptance input: Mac2 typed this',
    version: 1,
  }, { mode: 0o600 })
}

/** Only the fixed source diagnostic receives this cancellation budget; input and cleanup keep their existing behavior. */
export function mac2SourceProbeFetch(
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = globalThis.fetch,
  /** Source-test seam; the fixed host route always uses its native 30-second deadline. */
  sourceBudget: () => AbortSignal = () => AbortSignal.timeout(30_000),
) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as { script?: unknown; args?: unknown }
      : undefined
    if (
      init?.method !== 'POST' || !/^\/session\/[^/]+\/execute\/sync$/.test(path) || body?.script !== 'macos: source'
    ) {
      return await fetcher(input, init)
    }
    const budget = sourceBudget()
    const controller = new AbortController()
    let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'read' | 'cancel' | 'releaseLock'> | undefined
    let rejectAbort: (error: unknown) => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    const cancelReader = () => {
      try {
        void reader?.cancel().catch(() => {})
      } catch { /* Reader cancellation must never delay owned cleanup. */ }
    }
    const abort = () => {
      rejectAbort(new Errors.HostEnvironmentError('Owned Mac2 source response was cancelled before completion.'))
      controller.abort()
      cancelReader()
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    budget.addEventListener('abort', abort, { once: true })
    if (init.signal?.aborted || budget.aborted) {
      abort()
    }
    try {
      // The mobile fetch ambient requires a non-null onabort handler; cancellation remains native AbortSignal behavior.
      const response = await Promise.race([
        fetcher(input, { ...init, signal: Object.assign(controller.signal, { onabort: () => {} }) }).then(response => {
          if (controller.signal.aborted) {
            try {
              void response.body?.cancel().catch(() => {})
            } catch { /* Late responses remain cancelled. */ }
            return Errors.throwHostEnvironment('Owned Mac2 source response arrived after cancellation.')
          }
          return response
        }),
        cancelled,
      ])
      const chunks: Uint8Array[] = []
      let bytes = 0
      reader = response.body?.getReader()
      if (reader !== undefined) {
        for (;;) {
          const next = await Promise.race([reader.read(), cancelled])
          if (controller.signal.aborted) {
            return Errors.throwHostEnvironment('Owned Mac2 source response was cancelled before completion.')
          }
          if (next.done) {
            break
          }
          bytes += next.value.byteLength
          // Raw JSON allows quoting/escaping overhead around the separately capped 256 KiB XML artifact.
          if (bytes > 1024 * 1024) {
            controller.abort()
            cancelReader()
            return Errors.throwHostEnvironment('Owned Mac2 source response exceeded its 1 MiB transport body limit.')
          }
          chunks.push(next.value)
        }
      }
      const data = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      const complete = new Response(response.body === null ? null : data, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
      Object.defineProperties(complete, {
        redirected: { value: response.redirected },
        url: { value: response.url },
        type: { value: response.type },
      })
      return complete
    } finally {
      init.signal?.removeEventListener('abort', abort)
      budget.removeEventListener('abort', abort)
      try {
        reader?.releaseLock()
      } catch { /* A pending cancelled read is independently bounded by the deadline. */ }
    }
  }
}

/** Reads only the application bound to this already-owned session, with fresh lease/kernel checks on both sides. */
export async function captureMac2FixtureSource(
  session: Pick<Awaited<ReturnType<Mac2HostController['openSession']>>, 'executeExternalUi'>,
  artifactRoot: string,
  studioBundleIdentifier: string,
): Promise<Readonly<{ sourceBytes: number; fixtureAttributeCounts: Readonly<Record<string, number>> }>> {
  const state = async () =>
    await session.executeExternalUi({
      args: [{ bundleId: studioBundleIdentifier }],
      kind: 'executeScript',
      script: 'macos: queryAppState',
    })
  const beforeState = await state()
  const source = await session.executeExternalUi({
    args: [{ format: 'xml' }],
    kind: 'executeScript',
    script: 'macos: source',
  })
  // The next fenced operation refuses stale physical ownership before any captured data is published.
  const afterState = await state()
  if (typeof beforeState !== 'number' || typeof afterState !== 'number' || typeof source !== 'string') {
    return Errors.throwHostEnvironment('Owned Mac2 source diagnostic returned invalid source or application state.')
  }
  const bytes = new TextEncoder().encode(source).byteLength
  if (bytes > 256 * 1024 || !source.trimStart().startsWith('<?xml')) {
    return Errors.throwHostEnvironment('Owned Mac2 source diagnostic exceeded its XML artifact contract.')
  }
  const texts = [
    'Studio Mac2 acceptance',
    'Studio Mac2 acceptance fixture',
    'Update acceptance state',
    'Acceptance state: waiting',
    'Acceptance text input',
    'Acceptance input: empty',
  ]
  const fields = new Set([
    'type',
    'name',
    'label',
    'title',
    'value',
    'identifier',
    'enabled',
    'visible',
    'x',
    'y',
    'width',
    'height',
  ])
  const elements: { type: string; attributes: Record<string, string> }[] = []
  for (const tag of source.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)\b([^>]*)>/g)) {
    const attributes = Object.fromEntries(
      [...tag[2]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"/g)]
        .filter(match => fields.has(match[1]!)).map(match => [match[1]!, decodeXml(match[2]!)]),
    )
    if (Object.values(attributes).some(value => texts.includes(value))) {
      elements.push({ type: tag[1]!, attributes })
    }
  }
  if (elements.length > 64) {
    return Errors.throwHostEnvironment('Owned Mac2 source diagnostic returned an ambiguous fixture attribute set.')
  }
  const fixtureAttributeCounts = Object.fromEntries(
    texts.map(text => [text, elements.filter(element => Object.values(element.attributes).includes(text)).length]),
  )
  await FS.writeText(FS.resolvePath('appium-mac2/native-source.xml', artifactRoot), source, { mode: 0o600 })
  await FS.writeJson(FS.resolvePath('appium-mac2/native-source-summary.json', artifactRoot), {
    afterState,
    beforeState,
    bundleIdentifier: studioBundleIdentifier,
    bytes,
    elements,
    fixtureAttributeCounts,
    fixturePresence: Object.fromEntries(
      texts.map(text => [text, elements.some(element => Object.values(element.attributes).includes(text))]),
    ),
    inputPerformed: false,
    version: 1,
  }, { mode: 0o600 })
  return { sourceBytes: bytes, fixtureAttributeCounts }
}

/** Input-free same-session source/lookup evidence; missing matches are diagnostic, never acceptance proof. */
export async function captureMac2FixtureSourceBeforeLookup(
  session: Pick<Mac2HostSession, 'executeExternalUi' | 'observe'>,
  artifactRoot: string,
  studioBundleIdentifier: string,
): Promise<void> {
  const source = await captureMac2FixtureSource(session, artifactRoot, studioBundleIdentifier)
  let outcome: 'found' | 'missing' = 'found'
  try {
    await session.observe({ expectedRevision: revision, target: { kind: 'accessibility', name: 'mac2-fixture' } })
  } catch (error) {
    const target = error instanceof HostControlError ? error.details?.['target'] : undefined
    if (
      !(error instanceof HostControlError) || error.code !== 'host'
      || error.message !== 'Appium Mac2 could not find occurrence 1 of the requested target.'
      || typeof target !== 'object' || target === null || Object.keys(target).length !== 2
      || !('kind' in target) || target.kind !== 'accessibility' || !('name' in target)
      || target.name !== 'mac2-fixture'
    ) {
      throw error
    }
    outcome = 'missing'
  }
  // A failed lookup must still prove fresh ownership before publishing a diagnostic outcome.
  const afterLookupState = await session.executeExternalUi({
    args: [{ bundleId: studioBundleIdentifier }],
    kind: 'executeScript',
    script: 'macos: queryAppState',
  })
  if (typeof afterLookupState !== 'number') {
    return Errors.throwHostEnvironment('Owned Mac2 lookup diagnostic returned invalid application state.')
  }
  await FS.writeJson(FS.resolvePath('appium-mac2/native-source-lookup.json', artifactRoot), {
    afterLookupState,
    bundleIdentifier: studioBundleIdentifier,
    diagnosticOnly: true,
    fixtureAttributeCounts: source.fixtureAttributeCounts,
    inputPerformed: false,
    lookup: { outcome, target: 'mac2-fixture' },
    physicalAcceptance: false,
    sourceBytes: source.sourceBytes,
    sourcePath: 'appium-mac2/native-source.xml',
    version: 1,
  }, { mode: 0o600 })
}

function decodeXml(text: string): string {
  return text.replace(
    /&(quot|apos|lt|gt|amp);/g,
    (_match, entity: string) => ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' })[entity]!,
  )
}

/**
 * This opt-in smoke opens the actual Studio native shell through a private Appium Mac2 home. It
 * deliberately retains the physical-input lease and server when remote deletion is ambiguous.
 */
export async function runStudioMac2Fixture(mode: 'acceptance' | 'source-probe'): Promise<void> {
  const artifactBase = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-smoke/mac2-acceptance', Repo.getRoot())
  const { root: artifactRoot } = await StudioNativeTestRun.create(artifactBase)
  const appiumHome = FS.resolvePath('appium-mac2-home', artifactRoot)
  const studioPort = smokePort('TAO_STUDIO_SMOKE_SERVER_PORT', 42_020)
  const previewPort = smokePort('TAO_STUDIO_SMOKE_PREVIEW_PORT', 42_021)
  let studioServer: ReturnType<typeof Bun.serve> | undefined
  let previewServer: ReturnType<typeof Bun.serve> | undefined
  let native: Awaited<ReturnType<typeof StudioNative.start>> | undefined
  let controller: Mac2HostController | undefined
  let closeController: (() => Promise<void>) | undefined
  let mac2: Awaited<ReturnType<typeof StudioMac2TestRun.prepare>> | undefined
  let serverStopped = false
  let primaryFailure: { error: unknown } | undefined
  try {
    studioServer = Bun.serve({
      fetch: () => new Response(studioFixture(), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      hostname: '127.0.0.1',
      port: studioPort,
    })
    previewServer = Bun.serve({
      fetch: () => new Response('<!doctype html><title>Studio Mac2 acceptance preview</title>'),
      hostname: '127.0.0.1',
      port: previewPort,
    })
    await provisionMac2DriverHome(appiumHome)
    mac2 = await StudioMac2TestRun.prepare({
      artifactRoot,
      ...(mode === 'source-probe' ? { sourceLookupProbe: true } : {}),
    })
    const studioUrl = `http://127.0.0.1:${studioServer.port}`
    native = await StudioNative.start({
      ...await StudioNativeTestRun.nativeOptions(artifactRoot),
      nativeHostCommand: 'studio-mac2-acceptance-smoke',
      previewUrl: `http://127.0.0.1:${previewServer.port}`,
      projectUrl: `${studioUrl}/sessions/mac2-acceptance-fixture`,
      showWindow: true,
      studioUrl,
    })
    // Mac2 attaches only after the owned Electrobun renderer has published its ready transport.
    await native.hostControl()
    // Each worktree builds its own development app, so Mac2 attaches to the identifier this run built.
    const studioBundleIdentifier = native.bundleIdentifier
    const serverLogPath = FS.resolvePath('appium-mac2/server.log', artifactRoot)
    const factory = createStudioMac2AcceptanceFactory({
      capabilities: {
        'appium:appPath': await StudioMac2TestRun.appPath(native.project.root, studioBundleIdentifier),
        'appium:bootstrapRoot': mac2.bootstrapRoot,
        'appium:bundleId': studioBundleIdentifier,
        'appium:noReset': true,
        'appium:skipAppKill': true,
        'appium:systemPort': mac2.systemPort,
        'appium:webDriverAgentMacUrl': mac2.webDriverAgentMacUrl,
        // Keep the WDA/Xcode diagnosis in the run log when macOS blocks a future attach.
        'appium:showServerLogs': true,
      },
      cleanupArtifacts: async () => {
        await mac2!.cleanup(serverStopped)
        await FS.writeJson(FS.resolvePath('appium-mac2/cleanup.json', artifactRoot), {
          lifecycle: 'closed',
          version: 1,
        })
        await FS.remove(appiumHome)
      },
      driverHome: appiumHome,
      desktopLeases: mac2.desktopLeases,
      resolveTarget: resolveMac2FixtureTarget,
      server: {
        ...(mode === 'source-probe' ? { fetch: mac2SourceProbeFetch() } : {}),
        command: appiumCommand(),
        environment: mac2.environment,
        reservations: appiumPortReservations(artifactRoot),
      },
      startServer: async options => {
        const server = await startAppiumServer(options)
        return {
          close: async () => {
            await FS.writeText(serverLogPath, server.logs())
            await server.close()
            serverStopped = true
          },
          logs: server.logs,
          url: server.url,
        }
      },
    })
    controller = await native.mac2Acceptance(factory)
    closeController = async () => await controller!.close()
    const session = await controller.openSession({
      artifactRoot,
      mode: 'acceptance',
      revision,
      target: 'Tao Studio native shell',
    })
    if (mode === 'source-probe') {
      await captureMac2FixtureSourceBeforeLookup(session, artifactRoot, studioBundleIdentifier)
    } else {
      await captureMac2FixtureInput(session, artifactRoot, studioBundleIdentifier)
    }

    await session.close(session.descriptor().lease)
    await controller.close()
    closeController = undefined
    Expect(await FS.isFile(FS.resolvePath('appium-mac2/server.log', artifactRoot))).toBe(true)
    Expect(await FS.isFile(FS.resolvePath('appium-mac2/cleanup.json', artifactRoot))).toBe(true)
  } catch (error) {
    primaryFailure = { error }
  } finally {
    await StudioMac2TestRun.finish({
      cleanupWda: async () => await mac2?.cleanup(serverStopped),
      closeController,
      primaryFailure,
      stopFixtures: async () =>
        await runCleanups(undefined, [
          { label: 'stop Studio fixture', run: () => studioServer?.stop(true) },
          { label: 'stop preview fixture', run: () => previewServer?.stop(true) },
        ], { channel: 'studio-smoke-cleanup', subject: 'Studio Mac2 fixtures' }),
      stopNative: async () => await native?.stop(),
    })
  }
}

async function provisionMac2DriverHome(home: string): Promise<void> {
  const source = await FS.realPath(Repo.resolvePath('packages/testing/appium-driver/node_modules/appium-mac2-driver'))
  const destination = FS.resolvePath('node_modules/appium-mac2-driver', home)
  await FS.mkdir(FS.dirname(destination))
  if (!await FS.exists(destination)) {
    await FS.symlink(source, destination)
  }
  await FS.writeJson(FS.resolvePath('package.json', home), {
    devDependencies: { 'appium-mac2-driver': `file:${source}` },
  })
  const listed = await CLI.mustRun(appiumCommand(), {
    args: ['driver', 'list', '--installed', '--json'],
    env: { ...Platform.runtimeProcess.env, APPIUM_HOME: home },
  })
  if (!listed.stdout.includes('mac2')) {
    Errors.throwHostEnvironment('The isolated Appium home did not discover its pinned Mac2 driver.', {
      details: { appiumHome: home, installed: listed.stdout },
    })
  }
}

function appiumCommand(): string {
  return Repo.resolvePath('packages/testing/appium-driver/node_modules/.bin/appium')
}

function appiumPortReservations(runId: string): AppiumPortReservations {
  return {
    async reserve(): Promise<AppiumPortReservation> {
      const first = 4723 + Number.parseInt(Platform.sha256Hex(runId).slice(0, 4), 16) % 1_000
      for (let offset = 0; offset < 1_000; offset += 1) {
        const port = 4723 + (first - 4723 + offset) % 1_000
        const lease = await MachineResources.tryAcquire({
          command: 'Studio Mac2 acceptance smoke',
          name: `appium-server-port-${port}`,
          repositoryRoot: Repo.getRoot(),
        })
        if (lease !== undefined) {
          return { port, release: async () => await lease.release() }
        }
      }
      return Errors.throwHostEnvironment('No Appium server port is available for the Studio Mac2 acceptance smoke.')
    },
  }
}

function smokePort(name: string, fallback: number): number {
  const value = Number(Platform.runtimeProcess.env[name] ?? fallback)
  if (Number.isInteger(value) && value > 0 && value <= 65_535) {
    return value
  }
  return Errors.throwUserInput(`${name} must be a valid TCP port.`)
}

function studioFixture(): string {
  return `<!doctype html><title>Studio Mac2 acceptance</title>
<style>body{font:24px system-ui;padding:48px}button,input{font:inherit;margin:16px;padding:12px}</style>
<main><h1>Studio Mac2 acceptance fixture</h1>
<button id="mac2-update" onclick="document.getElementById('mac2-click-state').textContent='Acceptance state: clicked'">Update acceptance state</button>
<p id="mac2-click-state">Acceptance state: waiting</p>
<label for="mac2-input">Acceptance text input</label><input id="mac2-input" aria-label="Acceptance text input"
 oninput="document.getElementById('mac2-input-state').textContent='Acceptance input: '+this.value">
<p id="mac2-input-state">Acceptance input: empty</p></main>`
}
