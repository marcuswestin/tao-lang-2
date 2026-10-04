import { CLI, FS, Platform } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, testOverrideSlot, until } from '@shared/test'
import { type AgentRenderer, type AgentReply, startDesktopAgentHost } from '../expo-host-src/desktop-agent-host'

const stateRootSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT'],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT']
    } else {
      Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT'] = value
    }
  },
})
const manifest = { protocolVersion: 1, appId: 'test.desktop.host', appName: 'Host test', buildId: 'build-one' } as const
type Host = Awaited<ReturnType<typeof startDesktopAgentHost>>
type Session = { capability: string; instanceId: string; pid: number; launcherPid: number; url: string }
type Fixture = {
  root: string
  state: string
  sessionPath: string
  start(options?: { renderer?: AgentRenderer; shutdown?: () => void }): Promise<Host>
  session(): Promise<Session>
}

Describe('packaged desktop agent host', () => {
  HostTest('requires the capability, rejects browser Origin, and answers authenticated ping', async fixture => {
    await fixture.start()
    const session = await fixture.session()
    const deniedHeaders: Record<string, string>[] = [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: `Bearer ${session.capability}`, origin: 'null' },
    ]
    for (const headers of deniedHeaders) {
      const denied = await fetch(session.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 1, id: 'denied', method: 'ping' }),
      })
      Expect(denied.status).toBe(403)
      Expect(await denied.json()).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    }
    const reply = await call(session, 'ping', 'probe')
    Expect(reply.status).toBe(200)
    Expect(await reply.json()).toEqual({
      version: 1,
      id: 'probe',
      ok: true,
      result: {
        message: 'pong',
        appId: 'test.desktop.host',
        buildId: 'build-one',
        instanceId: session.instanceId,
        pid: Platform.runtimeProcess.pid,
        launcherPid: session.launcherPid,
        renderer: 'absent',
      },
    })
    Expect(await FS.fileMode(fixture.state)).toBe(0o700)
    Expect(await FS.fileMode(fixture.sessionPath)).toBe(0o600)
  })

  HostTest('rejects malformed requests, protocol mismatches, unknown methods and non-POST controls', async fixture => {
    await fixture.start()
    const session = await fixture.session()
    for (const body of ['{invalid', '{}', '{"version":1,"id":"","method":"ping"}']) {
      const response = await fetch(session.url, { method: 'POST', headers: auth(session), body })
      Expect(response.status).toBe(400)
      Expect(await response.json()).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    }
    const mismatch = await fetch(session.url, {
      method: 'POST',
      headers: auth(session),
      body: JSON.stringify({ version: 2, id: 'version-two', method: 'ping' }),
    })
    Expect(await mismatch.json()).toMatchObject({ id: 'version-two', ok: false, error: { code: 'protocol_mismatch' } })
    Expect(await (await call(session, 'toString')).json()).toMatchObject({
      ok: false,
      error: { code: 'unknown_method' },
    })
    Expect((await fetch(session.url, { headers: auth(session) })).status).toBe(405)
  })

  HostTest('allows exactly one concurrent host for an app and preserves its session', async fixture => {
    const attempts = await Promise.allSettled([fixture.start(), fixture.start()])
    Expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
    const failures = attempts.filter(attempt => attempt.status === 'rejected')
    for (const failed of failures) {
      Expect(String(failed.reason)).toContain('already has a running instance')
    }
    const session = await fixture.session()
    Expect(await (await call(session, 'ping')).json()).toMatchObject({
      ok: true,
      result: { instanceId: session.instanceId },
    })
  })

  HostTest('replaces a dead owner and reuses its persistent origin after shutdown', async fixture => {
    const exited = CLI.start(Platform.runtimeProcess.execPath, {
      args: ['--eval', ''],
      stdio: 'pipe',
    })
    const ownerPid = exited.pid ?? 0
    try {
      Expect((await exited.waitForClose()).exitCode).toBe(0)
    } finally {
      exited.dispose()
    }
    Expect(ownerPid).toBeGreaterThan(0)
    Expect(Platform.processIsAlive(ownerPid)).toBe(false)
    await FS.writeJson(fixture.sessionPath, { pid: ownerPid, instanceId: 'dead-instance' })
    const first = await fixture.start()
    const firstSession = await fixture.session()
    Expect(firstSession.instanceId).not.toBe('dead-instance')
    await first.close()
    Expect(await FS.exists(fixture.sessionPath)).toBe(false)
    const second = await fixture.start()
    const secondSession = await fixture.session()
    Expect(second.origin).toBe(first.origin)
    Expect(secondSession.instanceId).not.toBe(firstSession.instanceId)
    Expect(secondSession.capability).not.toBe(firstSession.capability)
    Expect(await (await call(secondSession, 'ping')).json()).toMatchObject({ ok: true })
  })

  HostTest('fails when the saved port is occupied without publishing another origin', async fixture => {
    const first = await fixture.start()
    const port = Number(new URL(first.origin).port)
    await first.close()
    const blocker = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('occupied') })
    try {
      await Expect(fixture.start()).rejects.toThrow()
      Expect(await FS.readJson(FS.resolvePath('origin.json', fixture.state))).toEqual({ port })
      Expect(await FS.exists(fixture.sessionPath)).toBe(false)
      Expect(await (await fetch(first.origin)).text()).toBe('occupied')
    } finally {
      blocker.stop(true)
    }
  })

  HostTest('does not remove a session owned by a replacement instance', async fixture => {
    const host = await fixture.start()
    const session = await fixture.session()
    await FS.writeJson(fixture.sessionPath, { ...session, instanceId: 'replacement-instance' })
    await host.close()
    Expect((await fixture.session()).instanceId).toBe('replacement-instance')
  })

  HostTest('waits for active execution and persistence before shutting down', async fixture => {
    const execution = Deferred<AgentReply>()
    const persistence = Deferred()
    let started = false
    let drainStarted = false
    let stopped = false
    await fixture.start({
      shutdown: () => {
        stopped = true
      },
      renderer: {
        status: () => 'ready',
        request: async method => {
          if (method === 'commands') {
            return { ok: true, result: [] }
          }
          started = true
          return await execution.promise
        },
        drain: async () => {
          drainStarted = true
          await persistence.promise
        },
      },
    })
    const session = await fixture.session()
    const running = call(session, 'run', 'execute', { commandId: 'Counter/Increment', args: {} })
    let shutdownSettled = false
    try {
      await until(() => started)
      const shutdown = call(session, 'shutdown', 'shutdown').then(response => {
        shutdownSettled = true
        return response
      })
      await until(async () => (await call(session, 'commands')).status === 409)
      Expect(drainStarted).toBe(false)
      Expect(shutdownSettled).toBe(false)
      execution.resolve({ ok: true, result: { value: 1 } })
      Expect(await (await running).json()).toMatchObject({ id: 'execute', ok: true, result: { value: 1 } })
      await until(() => drainStarted)
      await settle()
      Expect(stopped).toBe(false)
      Expect(shutdownSettled).toBe(false)
      persistence.resolve()
      Expect(await (await shutdown).json()).toMatchObject({ id: 'shutdown', ok: true, result: { status: 'stopping' } })
      await until(() => stopped)
      Expect(await FS.exists(fixture.sessionPath)).toBe(false)
    } finally {
      execution.resolve({ ok: true, result: null })
      persistence.resolve()
      await running
    }
  })

  HostTest(
    'returns busy after the real shutdown deadline and keeps serving until persistence settles',
    async fixture => {
      const persistence = Deferred()
      let stopped = false
      await fixture.start({
        shutdown: () => {
          stopped = true
        },
        renderer: {
          status: () => 'ready',
          request: async () => ({ ok: true, result: ['Counter/Increment'] }),
          drain: async () => await persistence.promise,
        },
      })
      const session = await fixture.session()
      try {
        const busy = await call(session, 'shutdown')
        Expect(busy.status).toBe(409)
        Expect(await busy.json()).toMatchObject({ ok: false, error: { code: 'busy' } })
        Expect(stopped).toBe(false)
        Expect((await fixture.session()).instanceId).toBe(session.instanceId)
        Expect(await (await call(session, 'ping')).json()).toMatchObject({ ok: true })
        Expect(await (await call(session, 'commands')).json()).toMatchObject({
          ok: true,
          result: ['Counter/Increment'],
        })
        persistence.resolve()
        Expect(await (await call(session, 'shutdown')).json()).toMatchObject({ ok: true })
        await until(() => stopped)
      } finally {
        persistence.resolve()
      }
    },
  )
})

let hostTestTail = Promise.resolve()

function HostTest(name: string, work: (fixture: Fixture) => Promise<void>): void {
  Test(name, () => {
    const result = hostTestTail.then(async () => {
      const root = await mkTestDir('desktop-agent-host-')
      const state = FS.resolvePath(manifest.appId, root)
      const sessionPath = FS.resolvePath('session.json', state)
      const restore = stateRootSlot.install(root)
      const hosts: Host[] = []
      try {
        await work({
          root,
          state,
          sessionPath,
          session: () => FS.readJson<Session>(sessionPath),
          start: async options => {
            const host = await startDesktopAgentHost({ manifest, shutdown: () => {}, ...options })
            hosts.push(host)
            return host
          },
        })
      } finally {
        await Promise.all(hosts.map(host => host.close()))
        restore()
        await FS.remove(root)
      }
    })
    hostTestTail = result.catch(() => undefined)
    return result
  }, 30_000)
}

function auth(session: Session): Record<string, string> {
  return { authorization: `Bearer ${session.capability}`, 'content-type': 'application/json' }
}

function call(session: Session, method: string, id = Platform.randomUUID(), params?: unknown): Promise<Response> {
  return fetch(session.url, {
    method: 'POST',
    headers: auth(session),
    body: JSON.stringify({ version: 1, id, method, params }),
    signal: AbortSignal.timeout(30_000) as unknown as RequestInit['signal'],
  })
}
