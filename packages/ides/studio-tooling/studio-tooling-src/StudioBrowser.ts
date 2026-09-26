import { CLI, Errors, FS, Platform } from '@shared'

type BrowserDependencies = {
  env?: Platform.ProcessEnv
  exists?: typeof FS.exists
  platform?: typeof Platform.hostPlatform
  run?: typeof CLI.run
  spawn?: typeof Platform.spawn
}

/** Opens Studio and its running apps in Chrome without changing the host's default browser. */
export const StudioBrowser = {
  async open(url: string, dependencies: BrowserDependencies = {}): Promise<void> {
    const platform = dependencies.platform ?? Platform.hostPlatform
    try {
      if (platform === 'darwin') {
        const result = await (dependencies.run ?? CLI.run)('/usr/bin/open', {
          args: ['-a', 'Google Chrome', url],
        })
        if (result.exitCode !== 0 || result.error !== undefined) {
          Errors.throwHostEnvironment('Google Chrome could not be launched.', { cause: result.error })
        }
        return
      }
      const command = await chromeCommand(platform, dependencies)
      // Chrome may own this process until its last window closes; only wait for the OS to accept the launch.
      await new Promise<void>((resolve, reject) => {
        const child = (dependencies.spawn ?? Platform.spawn)(command, {
          args: [url],
          detached: true,
          stdio: 'ignore',
        })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
    } catch (cause) {
      Errors.throwHostEnvironment('Could not open Google Chrome. Check that Chrome is installed and try again.', {
        cause,
      })
    }
  },
}

async function chromeCommand(
  platform: typeof Platform.hostPlatform,
  dependencies: BrowserDependencies,
): Promise<string> {
  if (platform === 'linux') {
    return 'google-chrome'
  }
  if (platform === 'win32') {
    const env = dependencies.env ?? Platform.runtimeProcess.env
    for (const root of [env['LOCALAPPDATA'], env['PROGRAMFILES'], env['PROGRAMFILES(X86)']]) {
      if (root !== undefined) {
        const candidate = `${root}\\Google\\Chrome\\Application\\chrome.exe`
        if (await (dependencies.exists ?? FS.exists)(candidate)) {
          return candidate
        }
      }
    }
    return 'chrome.exe'
  }
  return Errors.throwHostEnvironment('Opening Chrome is supported on macOS, Linux, and Windows.')
}
