import { CLI, Errors, FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { startAgentChrome } from '../expo-host-src/dev-loop/expo-runner/AgentChrome'

Test('agent web Chrome uses isolated profiles, supports DevTools, and removes only its own sessions', async () => {
  const root = await mkTestDir('agent-chrome-')
  const launches: Array<{ args: string[]; profile: string }> = []
  const start: typeof CLI.start = (_command, spec) => {
    const args = [...(spec?.args ?? [])]
    const profile = args.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length)
    launches.push({ args, profile })
    void FS.writeText(
      FS.resolvePath('DevToolsActivePort', profile),
      `${49_000 + launches.length}\n/devtools/browser/test\n`,
    )
    let signalCode: 'SIGTERM' | null = null
    let closed = () => {}
    const completion = new Promise<void>(resolve => {
      closed = resolve
    })
    return {
      closeOutput: async () => {},
      error: undefined,
      get exitCode() {
        return null
      },
      get signalCode() {
        return signalCode
      },
      kill: () => {
        signalCode = 'SIGTERM'
        closed()
        return true
      },
      waitForClose: () => completion,
    } as unknown as CLI.StartedCommand
  }
  const hidden = await startAgentChrome('http://127.0.0.1:8081', root, false, {
    chromePath: '/test/Google Chrome',
    start,
  })
  const visible = await startAgentChrome('http://127.0.0.1:8082', root, true, {
    chromePath: '/test/Google Chrome',
    start,
  })
  Expect(hidden.debugPort).toBe(49_001)
  Expect(visible.debugPort).toBe(49_002)
  Expect(launches[0]!.args).toContain('--headless=new')
  Expect(launches[1]!.args.includes('--headless=new')).toBe(false)
  Expect(launches[0]!.profile === launches[1]!.profile).toBe(false)
  Expect(await FS.exists(launches[0]!.profile)).toBe(true)
  await hidden.stop()
  Expect(await FS.exists(launches[0]!.profile)).toBe(false)
  Expect(await FS.exists(launches[1]!.profile)).toBe(true)
  await visible.stop()
  Expect(await FS.exists(launches[1]!.profile)).toBe(false)
})

Test('failed Chrome startup waits for its process to exit before removing its profile', async () => {
  const root = await mkTestDir('agent-chrome-failure-')
  let profile = ''
  let signal: string | undefined
  let exitCode: number | null = null
  let profileExistedAtExit = false
  let outputClosed = false
  let closed = () => {}
  const completion = new Promise<void>(resolve => {
    closed = resolve
  })
  const start: typeof CLI.start = (_command, spec) => {
    profile = spec!.args!.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length)
    return {
      error: new Errors.HostEnvironmentError('DevTools startup failed'),
      get exitCode() {
        return exitCode
      },
      signalCode: null,
      kill: (value: string) => {
        signal = value
        setTimeout(() => {
          void FS.exists(profile).then(exists => {
            profileExistedAtExit = exists
            exitCode = 1
            closed()
          })
        }, 20)
        return true
      },
      closeOutput: async () => {
        outputClosed = true
      },
      waitForClose: () => completion,
    } as unknown as CLI.StartedCommand
  }
  await Expect(startAgentChrome('http://127.0.0.1:8081', root, false, {
    chromePath: '/test/Google Chrome',
    start,
  })).rejects.toThrow('DevTools startup failed')
  Expect(signal).toBe('SIGTERM')
  Expect(exitCode).toBe(1)
  Expect(profileExistedAtExit).toBe(true)
  Expect(outputClosed).toBe(true)
  Expect(await FS.exists(profile)).toBe(false)
})

Test('Chrome spawn failure preserves its startup error and removes the unused profile', async () => {
  const root = await mkTestDir('agent-chrome-spawn-failure-')
  let profile = ''
  const start: typeof CLI.start = (command, spec) => {
    profile = spec!.args!.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length)
    return CLI.start(command, spec)
  }
  await Expect(startAgentChrome('http://127.0.0.1:8081', root, false, {
    chromePath: FS.resolvePath('missing-chrome', root),
    start,
  })).rejects.toThrow('Chrome exited before its DevTools port was ready:')
  Expect(await FS.exists(profile)).toBe(false)
})
