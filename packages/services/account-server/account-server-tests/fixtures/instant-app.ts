import { Assert, Errors, FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir } from '@shared/test'
import { AccountServer, type AccountServerOptions } from '../../account-server-src/AccountServer'
import { testAccountPolicy } from './account-policy'

/** Every test owns a fresh expiring app; no existing app credentials enter this fixture. */
export async function instantFixture(
  apiURI: string,
  run: (
    fixture: Awaited<ReturnType<typeof createFixture>> & {
      options: AccountServerOptions
      server: AccountServer
      restart(): Promise<void>
    },
  ) => Promise<void>,
  deployment: Partial<Pick<AccountServerOptions, 'policy' | 'resource'>> = {},
): Promise<void> {
  await instantAppFixture(apiURI, async app => {
    const options: AccountServerOptions = {
      databasePath: FS.resolvePath('accounts.sqlite', app.root),
      issuer: 'local-instant-conformance',
      resource: deployment.resource ?? 'notes',
      policy: deployment.policy ?? testAccountPolicy,
      instant: app.instant,
    }
    const fixture = {
      ...app,
      options,
      server: await AccountServer.start(options),
      async restart() {
        await fixture.server.stop()
        fixture.server = await AccountServer.start(options)
      },
    }
    try {
      await run(fixture)
    } finally {
      await fixture.server.stop()
    }
  })
}

export async function instantAppFixture(
  apiURI: string,
  run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture(apiURI)
  try {
    await run(fixture)
  } finally {
    await fixture.stop()
  }
}

async function createFixture(apiURI: string) {
  const endpoint = new URL(apiURI)
  Assert.input(
    endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname),
    'Live Instant conformance requires an explicit localhost HTTP endpoint.',
  )
  const created = await fetch(`${apiURI}/dash/apps/ephemeral`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `Tao authority conformance ${Platform.randomUUID()}`,
      rules: { code: { $default: { allow: { $default: 'false' } } } },
    }),
  })
  Expect(created.status).toBe(200)
  const { app, expires_ms } = await created.json() as {
    app: { id: string; 'admin-token': string }
    expires_ms: number
  }
  // The Tao journey scans source under its root; host placement avoids the checkout's ignored scratch boundary.
  const root = await mkTestDir('tao-instant-live-', { location: 'host' })
  const ledger = Repo.resolvePath(`.artifacts/auth/instant-conformance/${app.id}.json`)
  await FS.mkdir(FS.dirname(ledger))
  await FS.writeJson(ledger, {
    path: root,
    owner: 'instant-live.test.ts',
    purpose: 'isolated auth database and real Tao journey',
    cleanup: 'fixture finally and test runner cleanup',
    appId: app.id,
    expires_ms,
    remoteCleanup: 'local ephemeral app expiry and service sweep',
  })
  const credentials = { apiURI, appId: app.id, adminToken: app['admin-token'] }
  let loseNextCommit = false
  let lostCommits = 0
  let latestTransaction: unknown
  let heldTransaction: unknown
  let holdMarker: string | undefined
  const proxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const incoming = new URL(request.url)
      const body = request.method === 'GET' ? undefined : await request.text()
      if (incoming.pathname === '/admin/transact' && holdMarker !== undefined && body?.includes(holdMarker)) {
        heldTransaction ??= JSON.parse(body)
        return Response.json({ message: 'Fixture retained an upstream request beyond gateway timeout.' }, {
          status: 503,
        })
      }
      const response = await fetch(`${apiURI}${incoming.pathname}${incoming.search}`, {
        method: request.method,
        signal: AbortSignal.timeout(30_000),
        headers: request.headers,
        ...(body === undefined ? {} : { body }),
      })
      if (incoming.pathname === '/admin/transact' && response.ok) {
        latestTransaction = body === undefined ? undefined : JSON.parse(body)
        if (loseNextCommit) {
          loseNextCommit = false
          lostCommits += 1
          await response.arrayBuffer()
          return Response.json({ message: 'Fixture discarded committed response.' }, { status: 503 })
        }
      }
      return response
    },
  })
  const fixture = {
    root,
    credentials,
    instant: { ...credentials, apiURI: `http://127.0.0.1:${proxy.port}` },
    lostCommitCount() {
      return lostCommits
    },
    loseCommitResponse() {
      loseNextCommit = true
    },
    holdWritesContaining(marker: string) {
      holdMarker = marker
    },
    async releaseHeldTransaction() {
      Assert.defined(heldTransaction, 'an unforwarded stale Instant transaction')
      holdMarker = undefined
      return await fixture.admin('/admin/transact', heldTransaction)
    },
    async replayLastTransaction() {
      Assert.defined(latestTransaction, 'a committed Instant transaction to replay')
      return await fixture.admin('/admin/transact', latestTransaction)
    },
    async admin(path: string, body: unknown, anonymous = false) {
      return await fetch(`${apiURI}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'content-type': 'application/json',
          'app-id': credentials.appId,
          authorization: `Bearer ${credentials.adminToken}`,
          ...(anonymous ? { 'as-guest': 'true' } : {}),
        },
        body: JSON.stringify(body),
      })
    },
    async query(query: Record<string, unknown>) {
      const response = await fixture.admin('/admin/query', { query })
      if (!response.ok) {
        Errors.throwHostEnvironment(`Independent Instant admin query failed with HTTP ${response.status}.`)
      }
      const data = await response.json() as Record<string, Array<Record<string, unknown>>>
      // Bootstrap sentinels contain no account data; compare actual authority documents in a stable order.
      return Object.fromEntries(
        Object.entries(data).map(([name, rows]) => [
          name,
          rows.filter(row => row['sentinel'] !== true).sort((left, right) =>
            String(left['id']).localeCompare(String(right['id']))
          ),
        ]),
      )
    },
    async stop() {
      await proxy.stop(true)
      await FS.remove(root)
    },
  }
  return fixture
}
