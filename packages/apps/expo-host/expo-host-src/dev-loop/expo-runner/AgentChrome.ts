import { CLI, Errors, FS, Platform, Time } from '@shared'

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export type AgentChromeSession = {
  debugPort: number
  stop: () => Promise<void>
}

/** Launch real Chrome under an owned profile so web dev never opens the user's browser. */
export async function startAgentChrome(
  url: string,
  profileParent: string,
  visible: boolean,
  launch: { chromePath?: string; start?: typeof CLI.start } = {},
): Promise<AgentChromeSession> {
  const chrome = launch.chromePath ?? await chromeExecutable()
  const profile = FS.resolvePath(Platform.randomUUID(), profileParent)
  await FS.mkdir(profile)
  let child: CLI.StartedCommand | undefined
  let processClosed = false
  const stop = async (): Promise<void> => {
    const started = child
    if (started === undefined) {
      await FS.remove(profile)
      return
    }
    if (!processClosed) {
      started.kill('SIGTERM')
    }
    const closed = await Time.pollUntil(
      () => processClosed ? true : undefined,
      { intervalMs: 100, timeoutMs: 10_000 },
    )
    if (closed !== true) {
      started.kill('SIGKILL')
    }
    const killed = await Time.pollUntil(
      () => processClosed ? true : undefined,
      { intervalMs: 100, timeoutMs: 5_000 },
    )
    await started.closeOutput()
    if (killed !== true) {
      Errors.throwHostEnvironment(`Chrome did not exit; profile kept at ${profile}.`)
    }
    await FS.remove(profile)
  }
  try {
    child = (launch.start ?? CLI.start)(chrome, {
      args: [
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-default-browser-check',
        '--no-first-run',
        ...(visible ? [] : ['--headless=new']),
        url,
      ],
      stdio: 'ignore',
    })
    const started = child
    void started.waitForClose().then(() => {
      processClosed = true
    })
    const portFile = FS.resolvePath('DevToolsActivePort', profile)
    const debugPort = await Time.pollUntil(async () => {
      if (await FS.isFile(portFile)) {
        const port = Number((await FS.readText(portFile)).split(/\r?\n/u)[0])
        if (Number.isInteger(port) && port > 0) {
          return port
        }
      }
      if (started.error !== undefined || started.exitCode !== null || started.signalCode !== null) {
        Errors.throwHostEnvironment(
          `Chrome exited before its DevTools port was ready: ${started.error?.message ?? `exit ${started.exitCode}`}`,
        )
      }
      return undefined
    }, { intervalMs: 100, timeoutMs: 20_000 })
    if (debugPort === undefined) {
      Errors.throwHostEnvironment('Chrome did not expose a DevTools port within 20 seconds.')
    }
    return { debugPort, stop }
  } catch (error) {
    try {
      await stop()
    } catch (cleanupError) {
      Errors.throwHostEnvironment(
        `${Errors.formatForUser(error)}; Chrome cleanup failed: ${Errors.formatForUser(cleanupError)}`,
      )
    }
    throw error
  }
}

async function chromeExecutable(): Promise<string> {
  const configured = Platform.runtimeProcess.env['TAO_AGENT_CHROME_PATH']
  if (configured !== undefined) {
    if (await FS.isFile(configured)) {
      return configured
    }
    Errors.throwHostEnvironment(`TAO_AGENT_CHROME_PATH does not name a Chrome executable: ${configured}`)
  }
  if (await FS.isFile(MAC_CHROME)) {
    return MAC_CHROME
  }
  for (const candidate of ['google-chrome', 'google-chrome-stable']) {
    if (await CLI.commandExists(candidate)) {
      return candidate
    }
  }
  Errors.throwHostEnvironment(
    'Google Chrome is required for agent web dev; install Chrome or set TAO_AGENT_CHROME_PATH.',
  )
}
