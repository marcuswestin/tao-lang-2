import { CLI, Errors, FS } from '@shared'
import type { TrackedProcess } from '@shared/ProcessTree'
import { Expect, mkTestDir, Test } from '@shared/test'
import { startAgentChrome } from '../expo-host-src/dev-loop/expo-runner/AgentChrome'

Test('agent web Chrome uses isolated profiles, supports DevTools, and removes only its own sessions', async () => {
  const root = await mkTestDir('agent-chrome-')
  const launches: Array<{ args: string[]; profile: string }> = []
  const owned = new Map<number, TrackedProcess>()
  const start: typeof CLI.start = (_command, spec) => {
    const args = [...(spec?.args ?? [])]
    const profile = args.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length)
    launches.push({ args, profile })
    const pid = 23_000 + launches.length
    owned.set(pid, { pid, startedAt: `kernel-${launches.length}`, command: 'Chrome' })
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
      pid,
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
    identities: () => owned,
  })
  const visible = await startAgentChrome('http://127.0.0.1:8082', root, true, {
    chromePath: '/test/Google Chrome',
    start,
    identities: () => owned,
  })
  Expect(hidden.debugPort).toBe(49_001)
  Expect(visible.debugPort).toBe(49_002)
  Expect(hidden.process).toEqual({ pid: 23_001, startedAt: 'kernel-1', command: 'Chrome' })
  Expect(visible.process).toEqual({ pid: 23_002, startedAt: 'kernel-2', command: 'Chrome' })
  Expect(hidden.profile).toBe(launches[0]!.profile)
  Expect(visible.profile).toBe(launches[1]!.profile)
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

Test('Chrome cleanup refuses a reused launch PID and retains its profile', async () => {
  const root = await mkTestDir('agent-chrome-reused-pid-')
  const original = { pid: 23_003, startedAt: 'kernel-original', command: 'Chrome' }
  let current = original
  let signals = 0
  let closed = () => {}
  const completion = new Promise<void>(resolve => {
    closed = resolve
  })
  const session = await startAgentChrome('http://127.0.0.1:8081', root, false, {
    chromePath: '/test/Google Chrome',
    identities: () => new Map([[current.pid, current]]),
    start: (_command, spec) => {
      const profile = spec!.args!.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length)
      void FS.writeText(FS.resolvePath('DevToolsActivePort', profile), '49003\n/devtools/browser/test\n')
      return {
        pid: original.pid,
        error: undefined,
        exitCode: null,
        signalCode: null,
        closeOutput: async () => {},
        kill: () => {
          signals++
          closed()
          return true
        },
        waitForClose: () => completion,
      } as unknown as CLI.StartedCommand
    },
  })
  current = { ...original, startedAt: 'kernel-replacement' }
  await Expect(session.stop()).rejects.toThrow('Chrome ownership changed; profile kept at')
  Expect(signals).toBe(0)
  Expect(await FS.exists(session.profile)).toBe(true)
  current = original
  await session.stop()
  Expect(signals).toBe(1)
  Expect(await FS.exists(session.profile)).toBe(false)
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
