import { CLI, Errors, FS, HCI, Repo, Text, Time } from '@shared'

const stopTimeoutMs = 3_000
const defaultAppName = 'Tao Studio'
const defaultBundleIdentifier = 'dev.tao-lang.studio'

export type StudioNativeOptions = {
  artifactRoot?: string
  electronPath?: string
  remoteDebuggingPort?: number
  showWindow?: boolean
  studioUrl: string
}

export type StartedStudioNative = {
  stop(): Promise<void>
  waitForClose(): Promise<number>
}

export type StudioNativePackageOptions = {
  appName?: string
  bundleIdentifier?: string
  outputRoot?: string
}

export type PackagedStudioNative = {
  appPath: string
  executablePath: string
  mainPath: string
  packageJsonPath: string
}

type StoppableCommand = Pick<
  CLI.StartedCommand,
  'closeOutput' | 'dispose' | 'exitCode' | 'kill' | 'signalCode' | 'waitForClose'
>

type WaitForNativeClose = () => Promise<number>

/** StudioNative owns the optional local Electron wrapper process. */
export const StudioNative = {
  packageApp,
  start,
  testing: {
    installedElectronExecutablePath,
    installedElectronAppPath,
    mainScriptSource,
    stopCommand,
  },
} as const

async function packageApp(options: StudioNativePackageOptions = {}): Promise<PackagedStudioNative> {
  const appName = safeAppName(options.appName ?? defaultAppName)
  const bundleIdentifier = safeBundleIdentifier(options.bundleIdentifier ?? defaultBundleIdentifier)
  const outputRoot = FS.resolvePath(options.outputRoot ?? '.artifacts/build/studio-native', Repo.getRoot())
  const sourceAppPath = await requireElectronAppPath()
  const appPath = FS.resolvePath(`${appName}.app`, outputRoot)
  await FS.remove(appPath)
  await FS.copyDirectory(sourceAppPath, appPath)
  const { mainPath, packageJsonPath } = await writePackagedPayload(appPath, appName)
  await updatePackagedInfoPlist(appPath, { appName, bundleIdentifier })
  return {
    appPath,
    executablePath: FS.resolvePath('Contents/MacOS/Electron', appPath),
    mainPath,
    packageJsonPath,
  }
}

async function start(options: StudioNativeOptions): Promise<StartedStudioNative> {
  const artifactRoot = FS.resolvePath(options.artifactRoot ?? '.artifacts/user/studio-native', Repo.getRoot())
  const mainPath = FS.resolvePath('main.cjs', artifactRoot)
  const userDataPath = FS.resolvePath('electron-user-data', artifactRoot)
  await FS.mkdir(artifactRoot)
  await FS.writeText(mainPath, mainScriptSource())
  const electronPath = await resolveElectronPath(options.electronPath)
  const command = CLI.start(electronPath, {
    args: [mainPath],
    env: {
      TAO_STUDIO_ELECTRON_REMOTE_DEBUGGING_PORT: options.remoteDebuggingPort?.toString(),
      TAO_STUDIO_ELECTRON_SHOW_WINDOW: options.showWindow === false ? 'false' : 'true',
      TAO_STUDIO_ELECTRON_USER_DATA: userDataPath,
      TAO_STUDIO_URL: options.studioUrl,
    },
    onOutput(stream, chunk) {
      for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
        HCI.logProcessOutput('studio-native', line, { stderr: stream === 'stderr' })
      }
    },
    stdio: 'pipe',
  })
  command.onceError(error => HCI.logProcessError('studio-native', error.message))
  const waitForClose = finalizeCommand(command)
  let stopping: Promise<void> | undefined
  return {
    stop() {
      stopping ??= stopCommand(command, Time.sleep, waitForClose)
      return stopping
    },
    waitForClose,
  }
}

async function resolveElectronPath(explicitPath: string | undefined): Promise<string> {
  if (explicitPath !== undefined) {
    const candidate = FS.resolvePath(explicitPath)
    if (await FS.isFile(candidate)) {
      return candidate
    }
  } else {
    const installed = await installedElectronExecutablePath()
    if (installed !== undefined) {
      return installed
    }
  }
  throw new Errors.UserInputError(
    'Electron is optional and is not installed. Install it for tao-dev or pass --electron <path>.',
  )
}

async function installedElectronAppPath(): Promise<string | undefined> {
  const executablePath = await installedElectronExecutablePath()
  if (executablePath === undefined) {
    return undefined
  }
  const appMarkerIndex = executablePath.indexOf('.app/')
  return appMarkerIndex < 0 ? undefined : executablePath.slice(0, appMarkerIndex + '.app'.length)
}

async function installedElectronExecutablePath(
  packageRoots: readonly string[] = electronPackageRoots(),
): Promise<string | undefined> {
  for (const packageRoot of packageRoots) {
    const pathFile = FS.resolvePath('path.txt', packageRoot)
    if (!await FS.isFile(pathFile)) {
      continue
    }
    const executableRelativePath = (await FS.readText(pathFile)).trim()
    const executablePath = FS.resolvePath(executableRelativePath, FS.resolvePath('dist', packageRoot))
    if (executableRelativePath !== '' && await FS.isFile(executablePath)) {
      return executablePath
    }
  }
  return undefined
}

async function requireElectronAppPath(): Promise<string> {
  const appPath = await installedElectronAppPath()
  if (appPath !== undefined) {
    return appPath
  }
  const hasElectronPackage = await Promise.all(
    electronPackageRoots().map(root =>
      FS.isFile(
        FS.resolvePath('path.txt', root),
      )
    ),
  )
  if (hasElectronPackage.includes(true)) {
    throw new Errors.UserInputError('Native Studio packaging currently supports macOS Electron.app installs.')
  }
  throw new Errors.UserInputError('Electron is optional and is not installed. Install it for tao-dev before packaging.')
}

function electronPackageRoots(): readonly string[] {
  return [
    Repo.resolvePath('node_modules/electron'),
    Repo.resolvePath('packages/dev/node_modules/electron'),
    Repo.resolvePath('packages/studio/node_modules/electron'),
  ]
}

async function writePackagedPayload(
  appPath: string,
  appName: string,
): Promise<{ mainPath: string; packageJsonPath: string }> {
  const appRoot = FS.resolvePath('Contents/Resources/app', appPath)
  const mainPath = FS.resolvePath('main.cjs', appRoot)
  const packageJsonPath = FS.resolvePath('package.json', appRoot)
  await FS.remove(appRoot)
  await FS.writeText(mainPath, mainScriptSource())
  await FS.writeJson(packageJsonPath, {
    main: 'main.cjs',
    name: 'tao-studio-native',
    private: true,
    productName: appName,
    version: '0.0.0',
  })
  return { mainPath, packageJsonPath }
}

async function updatePackagedInfoPlist(
  appPath: string,
  options: { appName: string; bundleIdentifier: string },
): Promise<void> {
  const infoPlistPath = FS.resolvePath('Contents/Info.plist', appPath)
  const nextPlist = replacePlistStringValue(
    replacePlistStringValue(
      replacePlistStringValue(await FS.readText(infoPlistPath), 'CFBundleDisplayName', options.appName),
      'CFBundleName',
      options.appName,
    ),
    'CFBundleIdentifier',
    options.bundleIdentifier,
  )
  await FS.writeText(infoPlistPath, nextPlist)
}

function replacePlistStringValue(plist: string, key: string, value: string): string {
  const pattern = new RegExp(`(<key>${Text.escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`)
  if (!pattern.test(plist)) {
    throw new Errors.UserInputError(`Electron Info.plist does not define ${key}.`)
  }
  return plist.replace(
    pattern,
    (_match, prefix: string, _previous: string, suffix: string) => `${prefix}${escapePlistString(value)}${suffix}`,
  )
}

function escapePlistString(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function safeAppName(value: string): string {
  const appName = value.trim()
  if (appName !== '' && appName !== '.' && appName !== '..' && !/[/:\\]/.test(appName)) {
    return appName
  }
  throw new Errors.UserInputError('Native Studio app name must be a non-empty macOS file name.')
}

function safeBundleIdentifier(value: string): string {
  const bundleIdentifier = value.trim()
  if (/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleIdentifier)) {
    return bundleIdentifier
  }
  throw new Errors.UserInputError('Native Studio bundle identifier must be a reverse-DNS identifier.')
}

async function stopCommand(
  command: StoppableCommand,
  sleep: (milliseconds: number) => Promise<void> = Time.sleep,
  waitForClose: WaitForNativeClose = finalizeCommand(command),
): Promise<void> {
  if (command.exitCode === null && command.signalCode === null) {
    command.kill('SIGTERM')
    await Promise.race([waitForClose(), sleep(stopTimeoutMs)])
    if (command.exitCode === null && command.signalCode === null) {
      command.kill('SIGKILL')
    }
  }
  await waitForClose()
}

function finalizeCommand(command: StoppableCommand): WaitForNativeClose {
  let finalizing: Promise<number> | undefined
  return () => {
    finalizing ??= (async () => {
      try {
        const result = await command.waitForClose()
        return result.exitCode ?? (result.signal === 'SIGINT' ? 130 : 0)
      } finally {
        await command.closeOutput()
        command.dispose()
      }
    })()
    return finalizing
  }
}

function mainScriptSource(): string {
  return Text.stripIndent(`
    const { app, BrowserWindow, shell } = require('electron')

    const rawStudioUrl = process.env.TAO_STUDIO_URL
    const remoteDebuggingPort = process.env.TAO_STUDIO_ELECTRON_REMOTE_DEBUGGING_PORT
    const showWindow = process.env.TAO_STUDIO_ELECTRON_SHOW_WINDOW !== 'false'
    const userDataPath = process.env.TAO_STUDIO_ELECTRON_USER_DATA

    if (!rawStudioUrl || !userDataPath) {
      throw new Error('TAO_STUDIO_URL and TAO_STUDIO_ELECTRON_USER_DATA are required.')
    }
    const studioUrl = new URL(rawStudioUrl)
    if (studioUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(studioUrl.hostname)) {
      throw new Error('Native Tao Studio only opens a local HTTP server.')
    }
    app.setPath('userData', userDataPath)
    if (remoteDebuggingPort) {
      app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)
    }

    let mainWindow

    function createWindow() {
      mainWindow = new BrowserWindow({
        height: 900,
        minHeight: 640,
        minWidth: 960,
        paintWhenInitiallyHidden: true,
        show: false,
        title: 'Tao Studio',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
        width: 1400,
      })
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const externalUrl = new URL(url)
          if (externalUrl.protocol === 'http:' || externalUrl.protocol === 'https:') {
            void shell.openExternal(externalUrl.href)
          }
        } catch {}
        return { action: 'deny' }
      })
      mainWindow.webContents.on('will-navigate', event => event.preventDefault())
      if (showWindow) {
        mainWindow.once('ready-to-show', () => mainWindow?.show())
      }
      mainWindow.on('closed', () => {
        mainWindow = undefined
      })
      void mainWindow.loadURL(studioUrl.href)
    }

    app.whenReady().then(createWindow)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    app.on('window-all-closed', () => app.quit())
  `)
}
