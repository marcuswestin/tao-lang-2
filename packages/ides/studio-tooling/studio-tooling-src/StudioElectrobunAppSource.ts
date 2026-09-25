// The text materialized into Tao Studio's generated Electrobun project: its config, lockfile, and
// the native shell's own `src/bun/index.ts`. `StudioElectrobun.ts` owns building and writing that
// project; this file owns what its files say.
//
// Raw `Error` throws below are emitted text, not this module's code: they become the Electrobun
// app's own `src/bun/index.ts`, a standalone project whose `package.json` declares only
// `@types/bun` and `ws` and whose tsconfig extends Hutch's devkit. It has no path to `@shared`, so
// Tao's error taxonomy is unreachable from the program these strings become.

import { Text } from '@shared'
import { StudioRoutes } from '@studio'
import type { StudioHostProjectBinding } from './StudioHostControl'

const electrobunVersion = '2.0.2-beta.12'
export const bunTypesVersion = '1.4.0'
export const webSocketVersion = '8.21.0'

type MultiWindowProbeStatus = 'ready' | 'timeout'

/** multiWindowProbeResult is shared by the generated native canary and its behavioral regression. */
export function multiWindowProbeResult(
  status: MultiWindowProbeStatus,
  windowCount: number,
): { message?: string; passed: boolean } {
  if (status === 'timeout') {
    return { message: 'The auxiliary native window never became ready.', passed: false }
  }
  if (windowCount < 2) {
    return {
      message: `The auxiliary native window became ready, but only ${windowCount} native window${
        windowCount === 1 ? ' was' : 's were'
      } registered.`,
      passed: false,
    }
  }
  return { passed: true }
}

/** The same window check is emitted into the native shell and exercised as a pure behavior test. */
export function hostControlWindowMatches<Window extends { id: number }>(
  binding: StudioHostProjectBinding,
  window: Window | undefined,
  projectWindows: ReadonlySet<Window>,
  windowSessions: ReadonlyMap<number, string>,
  windowTokens: ReadonlyMap<number, string>,
): boolean {
  return window !== undefined
    && window.id === binding.windowId
    && projectWindows.has(window)
    && windowSessions.get(window.id) === binding.projectSessionId
    && windowTokens.get(window.id) === binding.windowToken
}

/**
 * Hutch 0.24.3's built-in resolver can fail before download even when npm serves both direct
 * package versions. Keeping its native lock format with the generated project makes cold worktrees
 * reproducible while `hutch install` still owns integrity verification and materialization.
 */
export function hutchLock(): Record<string, unknown> {
  return {
    configVersion: 1,
    lockfileVersion: 1,
    packages: {
      '@types/bun': [
        '@types/bun@1.4.0',
        'https://registry.npmjs.org/@types/bun/-/bun-1.4.0.tgz',
        { dependencies: { 'bun-types': '1.4.0' } },
        'sha512-K+lZULY23vRgK/CfTjFIV+tyifaNdSMlPh9j+6mQ/cLfpOznLyAuzgV/JQysyECpkBQLVMSyvjlr2fBUSA9wFQ==',
      ],
      '@types/node': [
        '@types/node@26.4.0',
        'https://registry.npmjs.org/@types/node/-/node-26.4.0.tgz',
        { dependencies: { 'undici-types': '~8.3.0' } },
        'sha512-faiGnoIrLH/V8cibOMEAZ8pMw6oXqSukl29ra4mN8GdaB2ZewzeaLj+INpV5N+Z1eKWzY+IzaIZH2EIR6YZRNQ==',
      ],
      'bun-types': [
        'bun-types@1.4.0',
        'https://registry.npmjs.org/bun-types/-/bun-types-1.4.0.tgz',
        { dependencies: { '@types/node': '*' } },
        'sha512-iIKw23BspnQQYd3prITOBxeUsxBHnwzX6YJfGMuNOZzeNcMmVqzIIVGRm1l69ogaPQmb4wB6BN8mA5bE9YuC5Q==',
      ],
      'undici-types': [
        'undici-types@8.3.0',
        'https://registry.npmjs.org/undici-types/-/undici-types-8.3.0.tgz',
        {},
        'sha512-j375ScV60dom+YkPFIfTLcOiPxkN/buHz5GobjLhixFuANaNs3C9l4GmrWqejgXWJ7BbJcFYpTEUkS1Ge8bpZQ==',
      ],
      ws: [
        'ws@8.21.0',
        'https://registry.npmjs.org/ws/-/ws-8.21.0.tgz',
        {
          optionalPeers: ['bufferutil', 'utf-8-validate'],
          peerDependencies: { bufferutil: '^4.0.1', 'utf-8-validate': '>=5.0.2' },
        },
        'sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g==',
      ],
    },
    workspaces: {
      '': {
        devDependencies: { '@types/bun': bunTypesVersion, ws: webSocketVersion },
        name: 'tao-studio-electrobun',
      },
    },
  }
}

export function configSource(options: {
  appName: string
  bundleIdentifier: string
  packagedService: boolean
  releaseBaseUrl: string
  version: string
}): string {
  return Text.stripIndent(`
    import type { ElectrobunConfig } from 'electrobun'

    export default {
      app: {
        name: ${JSON.stringify(options.appName)},
        identifier: ${JSON.stringify(options.bundleIdentifier)},
        version: ${JSON.stringify(options.version)},
      },
      runtime: {
        exitOnLastWindowClosed: true,
      },
      build: {
        mainProcess: 'bun',
        bun: {
          entrypoint: 'src/bun/index.ts',
        },
        ${options.packagedService ? "copy: { 'service/payload': 'service' }," : ''}
        mac: {
          bundleCEF: false,
          codesign: true,
          notarize: true,
          createDmg: true,
        },
      },
      release: {
        baseUrl: ${JSON.stringify(options.releaseBaseUrl)},
        generatePatch: true,
      },
    } satisfies ElectrobunConfig
  `)
}

export function hutchConfigSource(): string {
  return Text.stripIndent(`
    // @hutch cli=0.24.3 cottontail=0.5.0
    export default {
      electrobun: { version: ${JSON.stringify(electrobunVersion)} },
      scripts: {
        install: ['hutch', 'install'],
        dev: ['hutch', 'electrobun', 'dev', '--watch'],
        'build:canary': ['hutch', 'electrobun', 'build', '--env=canary'],
        'build:stable': ['hutch', 'electrobun', 'build', '--env=stable'],
      },
    }
  `)
}

const browserProbePreviewPlaceholder = '__TAO_STUDIO_PREVIEW_URL_JSON__'
const browserProbeTemplate = [
  '(() => {',
  '  if (document.body === null || window.__taoStudioNativeProbeStarted === true) return',
  '  if (typeof window.__electrobunSendToHost !== "function") return',
  '  window.__taoStudioNativeProbeStarted = true',
  '  const message = error => error instanceof Error ? error.message : String(error)',
  '  const report = (capability, passed, detail) => window.__electrobunSendToHost({ capability, message: detail, passed, type: "tao-studio-probe" })',
  '  report("browser-runtime", true)',
  '  try {',
  '    const url = new URL(window.location.href)',
  '    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"',
  "    url.pathname = url.pathname.replace(/\\/?$/, '/events')",
  '    url.search = ""',
  '    url.hash = ""',
  '    const socket = new WebSocket(url.href)',
  '    let settled = false',
  '    socket.addEventListener("open", () => { if (settled) return; settled = true; report("websocket", true); socket.close() }, { once: true })',
  '    socket.addEventListener("error", () => { if (settled) return; settled = true; report("websocket", false, "WebSocket connection failed.") }, { once: true })',
  '  } catch (error) {',
  '    report("websocket", false, "WebSocket probe failed: " + message(error))',
  '  }',
  '  try {',
  "    const iframe = document.createElement('iframe')",
  '    iframe.hidden = true',
  `    iframe.src = ${browserProbePreviewPlaceholder}`,
  '    let settled = false',
  '    iframe.addEventListener("load", () => { if (settled) return; settled = true; report("iframe", true); iframe.remove() }, { once: true })',
  '    iframe.addEventListener("error", () => { if (settled) return; settled = true; report("iframe", false, "Metro iframe failed.") }, { once: true })',
  '    document.body.append(iframe)',
  '  } catch (error) {',
  '    report("iframe", false, "Iframe probe failed: " + message(error))',
  '  }',
  '})()',
].join('\n')

export function browserProbeSource(previewUrl: string): string {
  return browserProbeTemplate.replace(browserProbePreviewPlaceholder, JSON.stringify(previewUrl))
}

/** Emitted unchanged into Electrobun; tests execute its returned script against a small renderer DOM. */
export function hostControlScript(request: unknown): string {
  return '(() => {'
    + 'const request = ' + JSON.stringify(request) + ';'
    + 'const send = value => window.__electrobunSendToHost({ type: "tao-studio-host-control", requestId: request.requestId, ...value });'
    + 'const fail = error => send({ error: error instanceof Error ? error.message : String(error) });'
    + 'const occurrence = target => { const value = target.occurrence ?? 1; if (!Number.isInteger(value) || value < 1) throw new Error("Studio semantic target occurrence must be positive."); return value - 1; };'
    + 'const exactText = (root, value) => [...root.querySelectorAll("*")].filter(element => element.children.length === 0 && element.textContent?.trim() === value);'
    + 'const attributeValue = (root, name, value) => [...root.querySelectorAll("[" + name + "]")].filter(element => element.getAttribute(name) === value);'
    + 'const targetElement = (target, root = document) => { if (target.kind === "scoped") return targetElement(target.target, targetElement(target.scope, root)); if (target.kind === "accessibility" && target.role !== undefined) throw new Error("Studio semantic accessibility role targets are unsupported."); const index = occurrence(target); const values = target.kind === "accessibility" ? attributeValue(root, "aria-label", target.name) : target.kind === "tag" ? attributeValue(root, "data-testid", target.value) : exactText(root, target.value); const element = values[index]; if (element === undefined) throw new Error("Studio semantic target was not found."); return element; };'
    + 'const elements = window.__taoStudioHostControlElements ?? (window.__taoStudioHostControlElements = new Map());'
    + 'const observedElement = (id, target) => { const element = elements.get(id); if (element === undefined || !element.isConnected || targetElement(target) !== element) throw new Error("Studio semantic observation is no longer current."); return element; };'
    + 'try {'
    + 'const path = window.location.pathname.split("/"); if (path[1] !== "sessions" || path[2] !== request.projectSessionId) throw new Error("Studio semantic control project document changed.");'
    + 'if (request.operation === "observe") { const element = targetElement(request.target); const bounds = element.getBoundingClientRect(); const elementId = crypto.randomUUID(); if (elements.size >= 128) elements.delete(elements.keys().next().value); elements.set(elementId, element); send({ result: { accessibilityLabel: element.getAttribute("aria-label") ?? undefined, bounds: { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y }, elementId, text: element.textContent ?? undefined, visible: bounds.width > 0 && bounds.height > 0 } }); return; }'
    + 'if (request.operation === "publishRevisionReady") { if (document.readyState !== "complete" || document.body === null) throw new Error("Studio project document did not finish loading after refresh."); send({ result: null }); return; }'
    + 'const action = request.action; if (action.kind === "click") { observedElement(action.elementId, action.target).click(); elements.delete(action.elementId); } else if (action.kind === "key") { window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: action.key })); } else if (action.kind === "refreshDocument") { window.location.reload(); } else if (action.kind === "scroll") { const target = action.observed === undefined ? window : observedElement(action.observed.elementId, action.observed.target); target.scrollBy(action.deltaX, action.deltaY); if (action.observed !== undefined) elements.delete(action.observed.elementId); } else if (action.kind === "type") { const element = observedElement(action.elementId, action.target); if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("Studio semantic type target is not a text input."); const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value"); descriptor?.set?.call(element, action.text); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); elements.delete(action.elementId); } else { throw new Error("Studio semantic action is unsupported."); } send({ result: null });'
    + '} catch (error) { fail(error); }'
    + '})()'
}

export function mainSource(): string {
  return Text.stripIndent(`
    import Electrobun, {
      ApplicationMenu,
      BrowserWindow,
      GlobalShortcut,
      Updater,
      Utils,
    } from 'electrobun/main'
    import { startStudioPackagedService } from './service.js'

    ${multiWindowProbeResult.toString()}
    ${hostControlWindowMatches.toString()}
    ${settleStudioQuitCleanup.toString()}
    ${hostControlScript.toString()}

    const externalStudioUrl = process.env.TAO_STUDIO_URL
    const packagedService = externalStudioUrl === undefined
      ? await startStudioPackagedService({
        runtimeToolchainRoot: import.meta.dir + '/../service/packages/apps/expo-host',
        stdlibRoot: import.meta.dir + '/../service/packages/apps/stdlib',
        testCommandPath: import.meta.dir + '/../service/test-command.js',
        testNodePath: import.meta.dir + '/../service/bin/node',
        studioClientBundlePath: import.meta.dir + '/../service/studio.js',
        userStateRoot: Utils.paths.userData,
      })
      : undefined
    const studioUrl = localHttpUrl(packagedService?.url ?? externalStudioUrl!, 'Studio server')
    const previewUrl = process.env.TAO_STUDIO_PREVIEW_URL === undefined
      ? undefined
      : localHttpUrl(process.env.TAO_STUDIO_PREVIEW_URL, 'Studio preview')
    const initialProjectUrl = process.env.TAO_STUDIO_PROJECT_URL === undefined
      ? undefined
      : projectSessionUrl(process.env.TAO_STUDIO_PROJECT_URL)
    const showWindows = process.env.TAO_STUDIO_ELECTROBUN_SHOW_WINDOWS !== 'false'
    const runProbe = process.env.TAO_STUDIO_ELECTROBUN_RUN_PROBE === 'true'
    const resultPath = process.env.TAO_STUDIO_ELECTROBUN_RESULT_PATH
    const hostControlPath = process.env.TAO_STUDIO_HOST_CONTROL_PATH
    const windows = new Map<number, BrowserWindow>()
    const projectWindows = new Set<BrowserWindow>()
    const windowSessions = new Map<number, string>()
    const windowTokens = new Map<number, string>()
    let activeProjectWindow: BrowserWindow | undefined
    let auxiliaryProbeWindow: BrowserWindow | undefined
    let probeInjectionTimer: ReturnType<typeof setInterval> | undefined
    const hostControlRequests = new Map<string, {
      reject: (error: Error) => void
      resolve: (value: unknown) => void
      timeout: ReturnType<typeof setTimeout>
    }>()
    const hostControlReadyWindows = new Set<number>()
    const hostControlReadyWaiters = new Map<number, Array<() => void>>()
    const hostControlReloads = new Map<number, { projectSessionId: string; requestId: string }>()
    const hostControlCapability = crypto.randomUUID()
    let hostControlOperationChain: Promise<void> = Promise.resolve()
    let hostControlRevision: { build: string; source: string } | undefined
    let hostControlServer: ReturnType<typeof Bun.serve> | undefined
    let quitAfterCleanup = false
    let quitting: Promise<void> | undefined

    function createStudioWindow(
      kind: 'Welcome' | 'Project',
      target = kind === 'Welcome' ? studioUrl : initialProjectUrl,
      projectPreviewUrl = previewUrl,
      forceHidden = false,
    ): BrowserWindow {
      if (target === undefined) throw new Error('A project URL is required for a project window.')
      const url = new URL(target)
      url.searchParams.set('native-window', kind.toLowerCase())
      const window = new BrowserWindow({
        title: kind === 'Welcome' ? 'Tao Studio' : 'Tao Studio — Project',
        url: url.href,
        hidden: forceHidden || !showWindows,
        frame: { x: kind === 'Welcome' ? 120 : 180, y: kind === 'Welcome' ? 100 : 140, width: 1400, height: 900 },
      })
      windowTokens.set(window.id, crypto.randomUUID())
      window.webview.setNavigationRules([
        studioUrl.origin + '/*',
        ...(projectPreviewUrl === undefined ? [] : [projectPreviewUrl.origin + '/*']),
      ])
      if (kind === 'Project') {
        projectWindows.add(window)
        activeProjectWindow = window
        const sessionId = projectSessionId(url)
        if (sessionId !== undefined) windowSessions.set(window.id, sessionId)
        window.on('focus', () => {
          activeProjectWindow = window
        })
      }
      window.on('close', () => {
        hostControlReadyWindows.delete(window.id)
        const waiters = hostControlReadyWaiters.get(window.id) ?? []
        hostControlReadyWaiters.delete(window.id)
        for (const resolve of waiters) resolve()
        windows.delete(window.id)
        projectWindows.delete(window)
        if (activeProjectWindow === window) {
          activeProjectWindow = [...projectWindows].at(-1)
        }
        const sessionId = windowSessions.get(window.id)
        windowSessions.delete(window.id)
        windowTokens.delete(window.id)
        if (sessionId !== undefined) {
          void closeProjectSession(sessionId)
        }
      })
      window.webview.on('did-navigate', event => {
        hostControlReadyWindows.delete(window.id)
        const navigated = navigationUrl(event)
        const sessionId = navigated === undefined ? undefined : projectSessionId(navigated)
        if (sessionId !== undefined) {
          const switchedPreview = navigated?.searchParams.get('native-preview-url')
          if (switchedPreview !== null && switchedPreview !== undefined) {
            try {
              const origin = localHttpUrlValue(switchedPreview, 'Studio preview').origin
              window.webview.setNavigationRules([studioUrl.origin + '/*', origin + '/*'])
            } catch (error) {
              showNativeError(error)
            }
          }
          windowSessions.set(window.id, sessionId)
          projectWindows.add(window)
          activeProjectWindow = window
          window.setTitle('Tao Studio — Project')
        } else if (navigated?.pathname === '/welcome') {
          windowSessions.delete(window.id)
          projectWindows.delete(window)
          if (activeProjectWindow === window) {
            activeProjectWindow = [...projectWindows].at(-1)
          }
          window.setTitle('Tao Studio')
        }
      })
      window.webview.on('host-message' as 'dom-ready', event => {
        receiveHostControlMessage(event)
      })
      window.webview.on('dom-ready', () => {
        hostControlReadyWindows.add(window.id)
        const waiters = hostControlReadyWaiters.get(window.id) ?? []
        hostControlReadyWaiters.delete(window.id)
        for (const resolve of waiters) resolve()
        void completeHostControlReload(window)
      })
      windows.set(window.id, window)
      return window
    }

    // Electrobun ignores ApplicationMenu installed after the first BrowserWindow.
    ApplicationMenu.setApplicationMenu([
      {
        submenu: [
          { label: 'About Tao Studio', action: 'about' },
          { type: 'separator' },
          { role: 'quit', accelerator: 'q' },
        ],
      },
      {
        label: 'File',
        submenu: [
          { label: 'Open Project…', action: 'open-project', accelerator: 'o' },
          { role: 'close', accelerator: 'w' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [{ label: 'Command Palette…', action: 'command-palette', accelerator: 'k' }],
      },
      {
        label: 'Help',
        submenu: [{ label: 'Check for Updates…', action: 'check-for-updates' }],
      },
    ])

    Electrobun.events.on('application-menu-clicked', event => {
      const action = (event as { data?: { action?: string } }).data?.action
      if (action === 'open-project') {
        void openProjectDialog().catch(showNativeError)
      } else if (action === 'command-palette') {
        if (activeProjectWindow !== undefined) {
          dispatchNativeCommand(activeProjectWindow, 'command-palette')
        }
      } else if (action === 'check-for-updates') {
        void applyAvailableUpdate(true).catch(showNativeError)
      }
    })

    const projectWindow = initialProjectUrl === undefined ? undefined : createStudioWindow('Project')
    const welcomeWindow = projectWindow === undefined ? createStudioWindow('Welcome') : undefined
    void startHostControl().catch(showNativeError)
    void applyAvailableUpdate(false).catch(error => console.error('Tao Studio update check failed.', error))

    async function openProjectDialog(): Promise<void> {
      const paths = await Utils.openFileDialog({
        allowedFileTypes: '*',
        allowsMultipleSelection: false,
        canChooseDirectory: true,
        canChooseFiles: false,
      })
      if (paths[0] !== undefined) {
        const response = await fetch(new URL(${JSON.stringify(StudioRoutes.manager.openSession.path)}, studioUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectPath: paths[0] }),
        })
        if (!response.ok) throw new Error('Studio could not open the selected project.')
        const opened = await response.json() as { previewUrl?: unknown; url?: unknown }
        const openedPreviewUrl = opened.previewUrl === undefined
          ? undefined
          : localHttpUrlValue(opened.previewUrl, 'Studio preview')
        createStudioWindow('Project', projectSessionUrl(opened.url), openedPreviewUrl)
      }
    }

    async function closeProjectSession(sessionId: string): Promise<void> {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const closePath = ${JSON.stringify(StudioRoutes.manager.closeSession.path)}
            .replace(':sessionId', encodeURIComponent(sessionId))
          const response = await fetch(new URL(closePath, studioUrl), {
            method: 'POST',
          })
          if (response.ok || response.status === 404) return
          lastError = new Error('Studio session cleanup failed (' + response.status + ').')
        } catch (error) {
          lastError = error
        }
        await Bun.sleep(100 * (attempt + 1))
      }
      showNativeError(lastError)
    }

    async function applyAvailableUpdate(interactive: boolean): Promise<void> {
      const local = await Updater.getLocalInfo()
      if (local.channel === 'dev') return
      const update = await Updater.checkForUpdate()
      if (!update.updateAvailable) {
        if (interactive) {
          await Utils.showMessageBox({ type: 'info', title: 'Tao Studio', message: 'Tao Studio is up to date.' })
        }
        return
      }
      await Updater.downloadUpdate()
      if (Updater.updateInfo().updateReady) {
        await Updater.applyUpdate()
      }
    }

    function showNativeError(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error)
      void Utils.showMessageBox({ type: 'error', title: 'Tao Studio', message })
    }

    function dispatchNativeCommand(window: BrowserWindow, command: string, detail: Record<string, unknown> = {}): void {
      window.webview.executeJavascript(
        'window.dispatchEvent(new CustomEvent("tao-studio:native-command", { detail: '
          + JSON.stringify({ command, ...detail })
          + ' }))',
      )
    }

    /** The loopback endpoint invokes semantic renderer operations, while Appium owns physical acceptance. */
    async function startHostControl(): Promise<void> {
      if (hostControlPath === undefined) return
      hostControlServer = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async request => await hostControlResponse(request),
      })
      const discovery = {
        capability: hostControlCapability,
        url: 'http://127.0.0.1:' + hostControlServer.port + '/host-control',
        version: 1,
      }
      const temporaryPath = hostControlPath + '.' + crypto.randomUUID() + '.tmp'
      try {
        await Bun.write(temporaryPath, JSON.stringify(discovery, null, 2) + '\\n')
        await import('node:fs/promises').then(fs => fs.rename(temporaryPath, hostControlPath))
      } finally {
        await import('node:fs/promises').then(fs => fs.rm(temporaryPath, { force: true }))
      }
    }

    async function hostControlResponse(request: Request): Promise<Response> {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/host-control') {
        return Response.json({ message: 'Studio semantic control accepts POST /host-control only.' }, { status: 404 })
      }
      let requestValue: unknown
      try {
        requestValue = await request.json()
      } catch {
        return Response.json({ message: 'Studio semantic control request must be JSON.' }, { status: 400 })
      }
      if (typeof requestValue !== 'object' || requestValue === null) {
        return Response.json({ message: 'Studio semantic control request must be an object.' }, { status: 400 })
      }
      const value = requestValue as {
        action?: unknown
        binding?: unknown
        capability?: unknown
        expectedCurrentRevision?: unknown
        expectedRevision?: unknown
        operation?: unknown
        revision?: unknown
        target?: unknown
      }
      if (value.capability !== hostControlCapability) {
        return Response.json({ message: 'Studio semantic control capability was rejected.' }, { status: 403 })
      }
      try {
        const result = await serializeHostControlOperation(async () => await runHostControlOperation(value))
        return Response.json({ ok: true, value: result })
      } catch (error) {
        return Response.json({ message: error instanceof Error ? error.message : String(error) }, { status: 409 })
      }
    }

    async function serializeHostControlOperation<T>(operation: () => Promise<T>): Promise<T> {
      const result = hostControlOperationChain.then(operation, operation)
      hostControlOperationChain = result.then(() => {}, () => {})
      return await result
    }

    async function runHostControlOperation(value: {
      action?: unknown
      binding?: unknown
      expectedCurrentRevision?: unknown
      expectedRevision?: unknown
      operation?: unknown
      revision?: unknown
      target?: unknown
    }): Promise<unknown> {
      if (value.operation === 'bindProject') {
        const window = activeProjectWindow
        const projectSessionId = window === undefined ? undefined : windowSessions.get(window.id)
        const windowToken = window === undefined ? undefined : windowTokens.get(window.id)
        if (window === undefined || !projectWindows.has(window) || projectSessionId === undefined || windowToken === undefined) {
          throw new Error('Studio has no active project window for semantic control.')
        }
        return { projectSessionId, windowId: window.id, windowToken }
      }
      if (!['observe', 'perform', 'publishRevision'].includes(String(value.operation))) {
        throw new Error('Studio semantic control operation is unsupported.')
      }
      const binding = hostControlBindingValue(value.binding)
      const window = windows.get(binding.windowId)
      if (!hostControlWindowMatches(binding, window, projectWindows, windowSessions, windowTokens)) {
        throw new Error('Studio semantic control project window is no longer current.')
      }
      const expectedRevision = value.operation === 'publishRevision'
        ? hostControlRevisionValue(value.expectedCurrentRevision, 'expectedCurrentRevision')
        : hostControlRevisionValue(value.expectedRevision, 'expectedRevision')
      const revision = value.operation === 'publishRevision'
        ? hostControlRevisionValue(value.revision, 'revision')
        : undefined
      const reloadDocument = value.operation === 'perform'
        && typeof value.action === 'object'
        && value.action !== null
        && (value.action as { kind?: unknown }).kind === 'refreshDocument'
      if (hostControlRevision !== undefined && !sameHostControlRevision(hostControlRevision, expectedRevision)) {
        throw new Error('Studio semantic control revision is no longer current.')
      }
      const requestId = crypto.randomUUID()
      const controlRequest = value.operation === 'observe'
        ? { expectedRevision, operation: value.operation, projectSessionId: binding.projectSessionId, requestId, target: value.target }
        : value.operation === 'perform'
          ? { action: value.action, expectedRevision, operation: value.operation, projectSessionId: binding.projectSessionId, requestId }
          : { expectedCurrentRevision: expectedRevision, operation: value.operation, projectSessionId: binding.projectSessionId, requestId, revision }
      const result = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          hostControlRequests.delete(requestId)
          reject(new Error('Studio semantic control did not receive a renderer response.'))
        }, 10_000)
        hostControlRequests.set(requestId, { reject, resolve, timeout })
      })
      try {
        await waitForHostControlDocument(window)
        if (!hostControlWindowMatches(binding, windows.get(binding.windowId), projectWindows, windowSessions, windowTokens)) {
          throw new Error('Studio semantic control project window changed while waiting for its document.')
        }
        if (value.operation === 'publishRevision' || reloadDocument) {
          hostControlReloads.set(window.id, { projectSessionId: binding.projectSessionId, requestId })
          window.webview.executeJavascript('window.location.reload()')
        } else {
          window.webview.executeJavascript(hostControlScript(controlRequest))
        }
      } catch (error) {
        rejectHostControlRequest(requestId, error)
      }
      const response = await result
      if (revision !== undefined) hostControlRevision = revision
      else if (hostControlRevision === undefined) hostControlRevision = expectedRevision
      return response
    }

    function hostControlBindingValue(value: unknown): { projectSessionId: string; windowId: number; windowToken: string } {
      if (
        typeof value !== 'object'
        || value === null
        || !Number.isSafeInteger((value as { windowId?: unknown }).windowId)
        || typeof (value as { projectSessionId?: unknown }).projectSessionId !== 'string'
        || typeof (value as { windowToken?: unknown }).windowToken !== 'string'
      ) throw new Error('Studio semantic control project-window binding is invalid.')
      return value as { projectSessionId: string; windowId: number; windowToken: string }
    }

    function hostControlRevisionValue(value: unknown, name: string): { build: string; source: string } {
      if (
        typeof value !== 'object'
        || value === null
        || typeof (value as { build?: unknown }).build !== 'string'
        || typeof (value as { source?: unknown }).source !== 'string'
      ) throw new Error('Studio semantic control ' + name + ' must name build and source strings.')
      return { build: (value as { build: string }).build, source: (value as { source: string }).source }
    }

    function sameHostControlRevision(left: { build: string; source: string }, right: { build: string; source: string }): boolean {
      return left.build === right.build && left.source === right.source
    }

    async function waitForHostControlDocument(window: BrowserWindow): Promise<void> {
      if (hostControlReadyWindows.has(window.id)) return
      await new Promise<void>(resolve => {
        const waiters = hostControlReadyWaiters.get(window.id) ?? []
        waiters.push(resolve)
        hostControlReadyWaiters.set(window.id, waiters)
      })
    }

    async function completeHostControlReload(window: BrowserWindow): Promise<void> {
      const pending = hostControlReloads.get(window.id)
      if (pending === undefined) return
      hostControlReloads.delete(window.id)
      try {
        if (windowSessions.get(window.id) !== pending.projectSessionId) {
          throw new Error('Studio semantic control project window changed during refresh.')
        }
        window.webview.executeJavascript(hostControlScript({
          operation: 'publishRevisionReady',
          projectSessionId: pending.projectSessionId,
          requestId: pending.requestId,
        }))
      } catch (error) {
        rejectHostControlRequest(pending.requestId, error)
      }
    }

    function receiveHostControlMessage(event: unknown): void {
      const value = (event as { data?: { detail?: unknown } }).data?.detail
      if (typeof value !== 'object' || value === null) return
      const message = value as { error?: unknown; requestId?: unknown; result?: unknown; type?: unknown }
      if (message.type !== 'tao-studio-host-control' || typeof message.requestId !== 'string') return
      const pending = hostControlRequests.get(message.requestId)
      if (pending === undefined) return
      hostControlRequests.delete(message.requestId)
      clearTimeout(pending.timeout)
      if (typeof message.error === 'string') pending.reject(new Error(message.error))
      else pending.resolve(message.result)
    }

    function rejectHostControlRequest(requestId: string, error: unknown): void {
      const pending = hostControlRequests.get(requestId)
      if (pending === undefined) return
      hostControlRequests.delete(requestId)
      clearTimeout(pending.timeout)
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }

    let finished = false
    if (runProbe) {
      if (projectWindow === undefined) throw new Error('The runtime probe requires an initial project window.')
      runRuntimeProbe(projectWindow)
    }

    function runRuntimeProbe(window: BrowserWindow): void {
      const results = new Map<string, { message?: string; passed: boolean }>()
      const shortcut = GlobalShortcut.register('CommandOrControl+Shift+K', () => {
        dispatchNativeCommand(window, 'command-palette')
      })
      auxiliaryProbeWindow = createStudioWindow('Welcome', studioUrl, undefined, true)
      auxiliaryProbeWindow.webview.on('dom-ready', () => {
        results.set('multi-window', multiWindowProbeResult('ready', windows.size))
        void finishIfComplete(results)
      })
      results.set('native-menu', { passed: true })
      results.set('shortcut', { passed: shortcut })

      // host-message is present at runtime but missing from Electrobun's BrowserView event-name
      // union. The trusted preload bridge avoids a cross-origin HTTP callback from the Studio page.
      window.webview.on('host-message' as 'dom-ready', event => {
        const report = nativeProbeReport(event)
        if (report !== undefined) {
          results.set(report.capability, { message: report.message, passed: report.passed })
          void finishIfComplete(results)
        }
      })

      let probeInjectionError: string | undefined
      const injectBrowserProbe = () => {
        if (finished) return
        try {
          window.webview.executeJavascript(browserProbeSource())
          probeInjectionError = undefined
        } catch (error) {
          // WKWebView creation can lag behind BrowserWindow. Keep retrying until the bounded probe
          // timeout can report the last native injection failure as a normal capability result.
          probeInjectionError = error instanceof Error ? error.message : String(error)
        }
      }
      window.webview.on('dom-ready', injectBrowserProbe)
      // Electrobun can create BrowserWindow before its WKWebView exists, and dom-ready can race
      // probe installation. Retry an idempotent page probe until the page accepts it.
      probeInjectionTimer = setInterval(injectBrowserProbe, 250)
      injectBrowserProbe()
      setTimeout(() => {
        if (!results.has('browser-runtime')) {
          results.set('browser-runtime', {
            message: probeInjectionError === undefined
              ? 'The browser probe did not start or could not reach the native host bridge.'
              : 'The browser probe could not be injected: ' + probeInjectionError,
            passed: false,
          })
        }
        if (!results.has('websocket')) results.set('websocket', { message: 'Timed out.', passed: false })
        if (!results.has('iframe')) results.set('iframe', { message: 'Timed out.', passed: false })
        if (!results.has('multi-window')) {
          results.set('multi-window', multiWindowProbeResult('timeout', windows.size))
        }
        void finishProbe(results)
      }, 15_000)
    }

    function nativeProbeReport(
      event: unknown,
    ): { capability: string; message?: string; passed: boolean } | undefined {
      const value = (event as { data?: { detail?: unknown } }).data?.detail
      if (typeof value !== 'object' || value === null) return undefined
      const report = value as { capability?: unknown; message?: unknown; passed?: unknown; type?: unknown }
      if (
        report.type !== 'tao-studio-probe'
        || !['browser-runtime', 'iframe', 'websocket'].includes(String(report.capability))
        || typeof report.passed !== 'boolean'
        || (report.message !== undefined && typeof report.message !== 'string')
      ) return undefined
      return { capability: report.capability, message: report.message, passed: report.passed }
    }

    function browserProbeSource(): string {
      return ${JSON.stringify(browserProbeTemplate)}.replace(
        ${JSON.stringify(browserProbePreviewPlaceholder)},
        JSON.stringify(previewUrl?.href ?? ''),
      )
    }

    async function finishIfComplete(
      results: Map<string, { message?: string; passed: boolean }>,
    ): Promise<void> {
      if (
        results.has('browser-runtime')
        && results.has('websocket')
        && results.has('iframe')
        && results.has('multi-window')
      ) {
        await finishProbe(results)
      }
    }

    async function finishProbe(
      results: Map<string, { message?: string; passed: boolean }>,
    ): Promise<void> {
      if (finished) return
      finished = true
      if (probeInjectionTimer !== undefined) clearInterval(probeInjectionTimer)
      auxiliaryProbeWindow?.close()
      auxiliaryProbeWindow = undefined
      GlobalShortcut.unregisterAll()
      const result = {
        passed: [...results.values()].every(entry => entry.passed),
        capabilities: Object.fromEntries(results),
      }
      console.log('TAO_STUDIO_ELECTROBUN_RESULT ' + JSON.stringify(result))
      if (resultPath !== undefined) {
        const temporaryResultPath = resultPath + '.' + crypto.randomUUID() + '.tmp'
        try {
          await Bun.write(temporaryResultPath, JSON.stringify(result, null, 2) + '\\n')
          await import('node:fs/promises').then(fs => fs.rename(temporaryResultPath, resultPath))
        } finally {
          await import('node:fs/promises').then(fs => fs.rm(temporaryResultPath, { force: true }))
        }
      }
      if (!showWindows) {
        process.exitCode = result.passed ? 0 : 1
        Utils.quit()
      }
    }

    Electrobun.events.on('before-quit', event => {
      try {
        GlobalShortcut.unregisterAll()
        hostControlServer?.stop()
        hostControlServer = undefined
        hostControlReloads.clear()
        hostControlReadyWindows.clear()
        for (const waiters of hostControlReadyWaiters.values()) {
          for (const resolve of waiters) resolve()
        }
        hostControlReadyWaiters.clear()
        for (const pending of hostControlRequests.values()) {
          clearTimeout(pending.timeout)
          pending.reject(new Error('Studio semantic control closed with the native shell.'))
        }
        hostControlRequests.clear()
      } catch (error) {
        console.error('Studio native cleanup failed during quit:', error)
      }
      if (packagedService === undefined || quitAfterCleanup) return
      event.response = { allow: false }
      if (quitting !== undefined) return
      quitting = Promise.resolve().then(() => packagedService.stop())
      void settleStudioQuitCleanup(quitting, 10_000).then(
        result => {
          if (result === 'timed-out') console.error('Studio service cleanup timed out during quit.')
          quitAfterCleanup = true
          Utils.quit()
        },
        error => {
          console.error('Studio service cleanup failed during quit:', error)
          quitAfterCleanup = true
          Utils.quit()
        },
      )
    })
    void welcomeWindow

    function requiredEnvironment(name: string): string {
      const value = process.env[name]
      if (value === undefined || value.trim() === '') throw new Error(name + ' is required.')
      return value
    }

    function localHttpUrl(value: string, label: string): URL {
      const url = new URL(value)
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error(label + ' must be a loopback HTTP URL.')
      }
      return url
    }

    function localHttpUrlValue(value: unknown, label: string): URL {
      if (typeof value !== 'string') throw new Error(label + ' URL is invalid.')
      return localHttpUrl(value, label)
    }

    function projectSessionId(value: URL): string | undefined {
      return value.pathname.match(/^\\/sessions\\/([A-Za-z0-9_-]{1,128})(?:\\/|$)/)?.[1]
    }

    function navigationUrl(event: unknown): URL | undefined {
      const value = event as { data?: { detail?: unknown }; detail?: unknown }
      const detail = value.data?.detail ?? value.detail
      if (typeof detail !== 'string') return undefined
      try {
        const url = new URL(detail, studioUrl)
        return url.origin === studioUrl.origin ? url : undefined
      } catch {
        return undefined
      }
    }

    function projectSessionUrl(value: unknown): URL {
      if (typeof value !== 'string') throw new Error('Studio returned an invalid project URL.')
      const url = new URL(value, studioUrl)
      if (url.origin !== studioUrl.origin || projectSessionId(url) === undefined) {
        throw new Error('Studio returned an invalid project URL.')
      }
      return url
    }
  `)
}

/** Give the native shell a finite chance to flush its embedded service before exiting. */
async function settleStudioQuitCleanup(
  cleanup: Promise<void>,
  timeoutMs: number,
): Promise<'complete' | 'timed-out'> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      cleanup.then(() => 'complete' as const),
      new Promise<'timed-out'>(resolve => {
        timeout = setTimeout(() => resolve('timed-out'), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
