import { Errors, FS, Text } from '@shared'

const defaultAppName = 'Tao Studio'
const defaultBundleIdentifier = 'dev.tao-lang.studio'
const defaultVersion = '0.0.1'
const electrobunVersion = '2.0.2-beta.12'
const bunTypesVersion = '1.4.0'
const webSocketVersion = '8.21.0'

export type StudioElectrobunOptions = {
  appName?: string
  bundleIdentifier?: string
  outputRoot: string
  packagedService?: boolean
  previewUrl: string
  projectUrl?: string
  runProbe?: boolean
  releaseBaseUrl?: string
  showWindow?: boolean
  serviceBundlePath?: string
  studioUrl: string
  version?: string
}

export type StudioElectrobunProject = {
  buildCanary: StudioElectrobunCommand
  buildStable: StudioElectrobunCommand
  configPath: string
  dev: StudioElectrobunCommand
  install: StudioElectrobunCommand
  mainPath: string
  prepare: StudioElectrobunCommand
  root: string
  runtimeResultPath: string
  sync: StudioElectrobunCommand
}

export type StudioElectrobunCommand = {
  args: readonly string[]
  command: 'hutch'
  cwd: string
  env?: Readonly<Record<string, string>>
}

export type StudioElectrobunSources = {
  config: string
  hutchConfig: string
  main: string
  packageJson: Record<string, unknown>
  tsconfig: Record<string, unknown>
}

/** Materializes Tao Studio's native Electrobun project. */
export const StudioElectrobun = {
  create,
  sources,
} as const

async function create(options: StudioElectrobunOptions): Promise<StudioElectrobunProject> {
  const root = FS.resolvePath(options.outputRoot)
  const generated = sources(options)
  for (
    const relativePath of [
      'artifacts',
      'electrobun.config.ts',
      'hutch.config.ts',
      'package.json',
      'service',
      'src',
      'tsconfig.json',
    ]
  ) {
    await FS.remove(FS.resolvePath(relativePath, root))
  }
  const mainPath = FS.resolvePath('src/bun/index.ts', root)
  const configPath = FS.resolvePath('electrobun.config.ts', root)
  const runtimeResultPath = FS.resolvePath('artifacts/runtime-result.json', root)
  await FS.mkdir(FS.dirname(mainPath))
  await FS.mkdir(FS.dirname(runtimeResultPath))
  await FS.writeText(mainPath, generated.main)
  const servicePath = FS.resolvePath('src/bun/service.js', root)
  if (options.serviceBundlePath === undefined) {
    await FS.writeText(
      servicePath,
      "export async function startStudioPackagedService() { throw new Error('Packaged Studio service is unavailable.') }\n",
    )
  } else {
    await FS.copyFile(options.serviceBundlePath, servicePath)
  }
  await FS.writeText(configPath, generated.config)
  await FS.writeText(FS.resolvePath('hutch.config.ts', root), generated.hutchConfig)
  await FS.writeJson(FS.resolvePath('package.json', root), generated.packageJson)
  await FS.writeJson(FS.resolvePath('tsconfig.json', root), generated.tsconfig)

  const environment = {
    TAO_STUDIO_ELECTROBUN_RESULT_PATH: runtimeResultPath,
    TAO_STUDIO_ELECTROBUN_RUN_PROBE: options.runProbe === true ? 'true' : 'false',
    TAO_STUDIO_ELECTROBUN_SHOW_WINDOWS: options.showWindow === false ? 'false' : 'true',
    TAO_STUDIO_PREVIEW_URL: localHttpUrl(options.previewUrl, 'Studio preview').href,
    ...(options.projectUrl === undefined
      ? {}
      : { TAO_STUDIO_PROJECT_URL: localHttpUrl(options.projectUrl, 'Studio project').href }),
    TAO_STUDIO_URL: localHttpUrl(options.studioUrl, 'Studio server').href,
  }
  return {
    buildCanary: command(root, ['run', 'build:canary']),
    buildStable: command(root, ['run', 'build:stable']),
    configPath,
    dev: command(root, ['run', 'dev'], environment),
    install: command(root, ['install']),
    mainPath,
    prepare: command(root, ['electrobun', 'prepare']),
    root,
    runtimeResultPath,
    sync: command(root, ['electrobun', 'sync']),
  }
}

function sources(options: StudioElectrobunOptions): StudioElectrobunSources {
  localHttpUrl(options.studioUrl, 'Studio server')
  localHttpUrl(options.previewUrl, 'Studio preview')
  const appName = safeAppName(options.appName ?? defaultAppName)
  const bundleIdentifier = safeBundleIdentifier(options.bundleIdentifier ?? defaultBundleIdentifier)
  const version = safeVersion(options.version ?? defaultVersion)
  const releaseBaseUrl = options.releaseBaseUrl ?? 'https://example.invalid/tao-studio'
  return {
    config: configSource({
      appName,
      bundleIdentifier,
      packagedService: options.packagedService === true,
      releaseBaseUrl,
      version,
    }),
    hutchConfig: hutchConfigSource(),
    main: mainSource(),
    packageJson: {
      name: 'tao-studio-electrobun',
      private: true,
      type: 'module',
      devDependencies: {
        '@types/bun': bunTypesVersion,
        ws: webSocketVersion,
      },
    },
    tsconfig: {
      extends: './.hutch/devkit/tsconfig.json',
    },
  }
}

function command(
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): StudioElectrobunCommand {
  return { args, command: 'hutch', cwd, env }
}

function configSource(options: {
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

function hutchConfigSource(): string {
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

function mainSource(): string {
  return Text.stripIndent(`
    import Electrobun, {
      ApplicationMenu,
      BrowserWindow,
      GlobalShortcut,
      Updater,
      Utils,
    } from 'electrobun/main'
    import { startStudioPackagedService } from './service.js'

    const externalStudioUrl = process.env.TAO_STUDIO_URL
    const packagedService = externalStudioUrl === undefined
      ? await startStudioPackagedService({
        runtimeToolchainRoot: import.meta.dir + '/../service/packages/runtime-toolchain',
        stdlibRoot: import.meta.dir + '/../service/packages/stdlib',
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
    const windows = new Map<number, BrowserWindow>()
    const projectWindows = new Set<BrowserWindow>()
    const windowSessions = new Map<number, string>()
    let activeProjectWindow: BrowserWindow | undefined
    let quitAfterCleanup = false
    let quitting: Promise<void> | undefined

    function createStudioWindow(
      kind: 'Welcome' | 'Project',
      target = kind === 'Welcome' ? studioUrl : initialProjectUrl,
      projectPreviewUrl = previewUrl,
    ): BrowserWindow {
      if (target === undefined) throw new Error('A project URL is required for a project window.')
      const url = new URL(target)
      url.searchParams.set('native-window', kind.toLowerCase())
      const window = new BrowserWindow({
        title: kind === 'Welcome' ? 'Tao Studio' : 'Tao Studio — Project',
        url: url.href,
        hidden: !showWindows,
        frame: { x: kind === 'Welcome' ? 120 : 180, y: kind === 'Welcome' ? 100 : 140, width: 1400, height: 900 },
      })
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
        windows.delete(window.id)
        projectWindows.delete(window)
        if (activeProjectWindow === window) {
          activeProjectWindow = [...projectWindows].at(-1)
        }
        const sessionId = windowSessions.get(window.id)
        windowSessions.delete(window.id)
        if (sessionId !== undefined) {
          void closeProjectSession(sessionId)
        }
      })
      window.webview.on('did-navigate', event => {
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
          { role: 'close' },
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

    const welcomeWindow = createStudioWindow('Welcome')
    const projectWindow = initialProjectUrl === undefined ? undefined : createStudioWindow('Project')
    void applyAvailableUpdate(false).catch(error => console.error('Tao Studio update check failed.', error))

    async function openProjectDialog(): Promise<void> {
      const paths = await Utils.openFileDialog({
        allowedFileTypes: '*',
        allowsMultipleSelection: false,
        canChooseDirectory: true,
        canChooseFiles: false,
      })
      if (paths[0] !== undefined) {
        const response = await fetch(new URL('/api/sessions/open', studioUrl), {
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
          const response = await fetch(new URL('/api/sessions/' + encodeURIComponent(sessionId) + '/close', studioUrl), {
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

    if (runProbe) {
      if (projectWindow === undefined) throw new Error('The runtime probe requires an initial project window.')
      runRuntimeProbe(projectWindow)
    }

    function runRuntimeProbe(window: BrowserWindow): void {
      const results = new Map<string, { message?: string; passed: boolean }>()
      const shortcut = GlobalShortcut.register('CommandOrControl+Shift+K', () => {
        dispatchNativeCommand(window, 'command-palette')
      })
      results.set('multi-window', { passed: windows.size >= 2 })
      results.set('native-menu', { passed: true })
      results.set('shortcut', { passed: shortcut })

      const reportServer = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          if (request.method === 'POST') {
            const report = await request.json() as { capability?: string; message?: string; passed?: boolean }
            if (report.capability !== undefined && typeof report.passed === 'boolean') {
              results.set(report.capability, { message: report.message, passed: report.passed })
              void finishIfComplete(reportServer, results)
            }
          }
          return new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-headers': 'content-type',
              'access-control-allow-methods': 'POST, OPTIONS',
              'access-control-allow-origin': studioUrl.origin,
            },
          })
        },
      })

      window.webview.on('dom-ready', () => {
        window.webview.executeJavascript(browserProbeSource(reportServer.port))
      })
      setTimeout(() => {
        if (!results.has('websocket')) results.set('websocket', { message: 'Timed out.', passed: false })
        if (!results.has('iframe')) results.set('iframe', { message: 'Timed out.', passed: false })
        void finishProbe(reportServer, results)
      }, 15_000)
    }

    function browserProbeSource(reportPort: number): string {
      const reportUrl = 'http://127.0.0.1:' + reportPort + '/result'
      const source = [
        '(() => {',
        '  const report = (capability, passed, message) => fetch(' + JSON.stringify(reportUrl)
          + ', { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability, passed, message }) })',
        '  const websocketUrl = path => { const url = new URL(path, window.location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; return url.href }',
        "  const socket = new WebSocket(websocketUrl(window.location.pathname.replace(/\\/?$/, '/events')))",
        '  socket.addEventListener("open", () => { report("websocket", true); socket.close() }, { once: true })',
        '  socket.addEventListener("error", () => report("websocket", false, "WebSocket connection failed."), { once: true })',
        "  const iframe = document.createElement('iframe')",
        '  iframe.hidden = true',
        '  iframe.src = ' + JSON.stringify(previewUrl?.href ?? ''),
        '  iframe.addEventListener("load", () => { report("iframe", true); iframe.remove() }, { once: true })',
        '  iframe.addEventListener("error", () => report("iframe", false, "Metro iframe failed."), { once: true })',
        '  document.body.append(iframe)',
        '})()',
      ]
      return source.join('\\n')
    }

    async function finishIfComplete(
      server: ReturnType<typeof Bun.serve>,
      results: Map<string, { message?: string; passed: boolean }>,
    ): Promise<void> {
      if (results.has('websocket') && results.has('iframe')) {
        await finishProbe(server, results)
      }
    }

    let finished = false
    async function finishProbe(
      server: ReturnType<typeof Bun.serve>,
      results: Map<string, { message?: string; passed: boolean }>,
    ): Promise<void> {
      if (finished) return
      finished = true
      GlobalShortcut.unregisterAll()
      const result = {
        passed: [...results.values()].every(entry => entry.passed),
        capabilities: Object.fromEntries(results),
        manualChecks: ['Choose File > Open Project… and confirm the native directory picker opens.'],
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
      server.stop(true)
      if (!showWindows) {
        process.exitCode = result.passed ? 0 : 1
        Utils.quit()
      }
    }

    Electrobun.events.on('before-quit', event => {
      GlobalShortcut.unregisterAll()
      if (packagedService === undefined || quitAfterCleanup) return
      event.response = { allow: false }
      quitting ??= packagedService.stop()
      void quitting.then(
        () => {
          quitAfterCleanup = true
          Utils.quit()
        },
        error => {
          showNativeError(error)
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

function localHttpUrl(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Errors.UserInputError(`${label} must be a valid URL.`)
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Errors.UserInputError(`${label} must be a loopback HTTP URL.`)
  }
  return url
}

function safeAppName(value: string): string {
  const appName = value.trim()
  if (appName !== '' && !/[/:\\]/.test(appName)) {
    return appName
  }
  throw new Errors.UserInputError('Electrobun app name must be a non-empty macOS file name.')
}

function safeBundleIdentifier(value: string): string {
  const bundleIdentifier = value.trim()
  if (/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleIdentifier)) {
    return bundleIdentifier
  }
  throw new Errors.UserInputError('Electrobun bundle identifier must be a reverse-DNS identifier.')
}

function safeVersion(value: string): string {
  const version = value.trim()
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return version
  }
  throw new Errors.UserInputError('Electrobun version must be a semantic version.')
}
