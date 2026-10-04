import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, MockModule, Test, testOverrideSlot, until } from '@shared/test'
import { startAccountServerFromArguments } from '../account-server-src/serve'

const originalFS = { ...FS }
const writeJson = testOverrideSlot({
  read: () => FS.writeJson,
  write: value => {
    MockModule(new URL('../../../shared/shared-src/FS.ts', import.meta.url).pathname, () => ({
      ...originalFS,
      writeJson: value,
    }))
  },
})

Describe('Account reference service launcher', () => {
  Test('publishes readiness only after the complete JSON has been written', async () => {
    const root = await mkTestDir('tao-account-ready-')
    const policy = FS.resolvePath('policy.json', root)
    const ready = FS.resolvePath('ready.json', root)
    await FS.writeJson(policy, {
      accountEntity: 'Account',
      entities: { Account: { fields: ['DisplayName'], grants: [{ principal: [], operations: ['read'] }] } },
    })
    const entered = Deferred<string>()
    const release = Deferred()
    const original = FS.writeJson
    const restore = writeJson.install(async (path, content, options) => {
      if (path === ready || path.startsWith(`${ready}.`)) {
        await FS.writeText(path, '')
        entered.resolve(path)
        await release.promise
      }
      await original(path, content, options)
    })
    const launched = startAccountServerFromArguments([
      '--policy',
      policy,
      '--database',
      FS.resolvePath('accounts.sqlite', root),
      '--port',
      '0',
      '--ready-file',
      ready,
    ])
    void launched.then(
      () => entered.reject(new Errors.UnexpectedBehaviorError('The readiness write was not intercepted.')),
      error => entered.reject(error),
    )
    try {
      const pending = await entered.promise
      Expect(await FS.isFile(ready)).toBe(false)
      release.resolve()
      const server = await launched
      Expect(await FS.readJson(ready)).toEqual({ resource: 'auth-review', url: server.url })
      Expect(await FS.isFile(pending)).toBe(false)
    } finally {
      release.resolve()
      try {
        await (await launched).stop()
      } finally {
        restore()
        await FS.remove(root)
      }
    }
  })

  Test('requires an explicit trusted policy with declared grants', async () => {
    await Expect(startAccountServerFromArguments([])).rejects.toThrow('compiler-emitted TaoDataPolicy.json')
    const root = await mkTestDir('tao-account-launcher-', { location: 'host' })
    try {
      const path = FS.resolvePath('TaoDataPolicy.json', root)
      await FS.writeJson(path, { accountEntity: 'Account', entities: { Account: { fields: ['DisplayName'] } } })
      await Expect(startAccountServerFromArguments(['--policy', path, '--port', '0'])).rejects.toThrow(
        'explicit grants',
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects malformed Instant configuration without exposing its credentials', async () => {
    const root = await mkTestDir('tao-account-instant-launcher-', { location: 'host' })
    try {
      const config = FS.resolvePath('instant.json', root)
      await FS.writeJson(config, { apiURI: 'http://127.0.0.1:9020', adminToken: 'private-test-token' })
      let failure: unknown
      try {
        await startAccountServerFromArguments(['--policy', 'unused.json', '--instant-config', config])
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(Errors.UserInputError)
      Expect(Errors.messageOf(failure)).toContain('apiURI, appId, and adminToken')
      Expect(Errors.messageOf(failure)).not.toContain('private-test-token')
    } finally {
      await FS.remove(root)
    }
  })

  Test('launches the real CLI with trusted metadata and loopback HTTP', async () => {
    const root = await mkTestDir('tao-account-launcher-', { location: 'host' })
    const policy = FS.resolvePath('TaoDataPolicy.json', root)
    const ready = FS.resolvePath('ready.json', root)
    await FS.writeJson(policy, {
      accountEntity: 'Account',
      entities: { Account: { fields: ['DisplayName'], grants: [{ principal: [], operations: ['read'] }] } },
    })
    let output = ''
    const child = CLI.start(Platform.runtimeProcess.execPath, {
      args: [
        'run',
        Repo.resolvePath('packages/services/account-server/account-server-src/serve.ts'),
        '--policy',
        policy,
        '--database',
        FS.resolvePath('accounts.sqlite', root),
        '--port',
        '0',
        '--ready-file',
        ready,
      ],
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
      processPolicy: 'server',
      stdio: 'pipe',
    })
    try {
      await until(async () => {
        if (child.exitCode !== null || child.error !== undefined) {
          Errors.throwHostEnvironment(`Reference launcher exited: ${output}`)
        }
        return await FS.isFile(ready)
      }, { description: 'reference service CLI readiness' })
      const { url, resource } = await FS.readJson<{ url: string; resource: string }>(ready)
      Expect(new URL(url).hostname).toBe('127.0.0.1')
      Expect(resource).toBe('auth-review')
      Expect((await fetch(`${url}/v1/data`)).status).toBe(401)
      const registered = await fetch(`${url}/v1/auth/sign-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'cli@example.test', password: 'a-good-password', resource }),
      })
      Expect(registered.status).toBe(200)
      const session = await registered.json() as { resource: string; issuer: string; token: string }
      Expect(session.resource).toBe('auth-review')
      Expect(session.issuer).toBe('tao-local:auth-review')
      const data = await fetch(`${url}/v1/data`, { headers: { authorization: `Bearer ${session.token}` } })
      Expect(data.status).toBe(200)
      Expect((await data.json() as { rows: unknown[] }).rows).toHaveLength(1)
    } finally {
      child.kill('SIGTERM')
      await child.waitForClose()
      await child.closeOutput()
      child.dispose()
      await FS.remove(root)
    }
  })

  Test('rejects malformed Clerk deployment files without echoing their contents', async () => {
    const root = await mkTestDir('tao-account-clerk-launcher-')
    const config = FS.resolvePath('clerk.json', root)
    const valid = {
      issuer: 'https://example.clerk.accounts.dev',
      jwtKey: 'private-test-marker',
      authorizedParties: ['https://app.example.test'],
    }
    try {
      for (
        const configuration of [
          null,
          [],
          {},
          { ...valid, jwtKey: '' },
          { ...valid, authorizedParties: [] },
          { ...valid, issuer: 'http://example.clerk.accounts.dev' },
          { ...valid, issuer: 'https://example.clerk.accounts.dev/path' },
          { ...valid, authorizedParties: [''] },
          { ...valid, authorizedParties: 'https://app.example.test' },
          { ...valid, audience: [] },
          { ...valid, audience: 1 },
          { ...valid, audience: [''] },
          { ...valid, allowMissingAuthorizedPartyWithoutOrigin: 'true' },
          { ...valid, jwksURL: 'https://attacker.example.test' },
        ]
      ) {
        await FS.writeJson(config, configuration)
        let failure: unknown
        try {
          await startAccountServerFromArguments(['--policy', 'unused.json', '--clerk-config', config])
        } catch (error) {
          failure = error
        }
        Expect(failure).toBeInstanceOf(Errors.UserInputError)
        Expect(Errors.messageOf(failure)).toContain('Clerk')
        Expect(Errors.messageOf(failure)).not.toContain('private-test-marker')
      }
      await FS.writeText(config, '{"jwtKey":"private-test-marker"')
      await Expect(startAccountServerFromArguments(['--policy', 'unused.json', '--clerk-config', config]))
        .rejects.toThrow('Unable to read the Clerk configuration file')
    } finally {
      await FS.remove(root)
    }
  })

  Test('loads optional Clerk deployment configuration and enables the exchange route', async () => {
    const root = await mkTestDir('tao-account-clerk-config-')
    const config = FS.resolvePath('clerk.json', root)
    const policy = FS.resolvePath('policy.json', root)
    await FS.writeJson(config, {
      issuer: 'https://example.clerk.accounts.dev',
      jwtKey: 'configured-public-key',
      authorizedParties: ['https://app.example.test'],
      audience: ['notes'],
      allowMissingAuthorizedPartyWithoutOrigin: true,
    })
    await FS.writeJson(policy, {
      accountEntity: 'Account',
      entities: { Account: { fields: ['DisplayName'], grants: [{ principal: [], operations: ['read'] }] } },
    })
    let server: Awaited<ReturnType<typeof startAccountServerFromArguments>> | undefined
    try {
      server = await startAccountServerFromArguments([
        '--policy',
        policy,
        '--clerk-config',
        config,
        '--database',
        FS.resolvePath('accounts.sqlite', root),
        '--port',
        '0',
        '--resource',
        'notes',
      ])
      const response = await fetch(`${server.url}/v1/auth/clerk/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer invalid.token.signature' },
        body: JSON.stringify({ resource: 'notes' }),
      })
      Expect(response.status).toBe(401)
      Expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'The Clerk session was not accepted.' },
      })
    } finally {
      await server?.stop()
      await FS.remove(root)
    }
  })

  Test('binds an explicitly configured host while keeping loopback as the default', async () => {
    const root = await mkTestDir('tao-account-host-')
    const policy = FS.resolvePath('policy.json', root)
    await FS.writeJson(policy, {
      accountEntity: 'Account',
      entities: { Account: { fields: [], grants: [{ principal: [], operations: ['read'] }] } },
    })
    let server: Awaited<ReturnType<typeof startAccountServerFromArguments>> | undefined
    try {
      server = await startAccountServerFromArguments([
        '--policy',
        policy,
        '--database',
        FS.resolvePath('accounts.sqlite', root),
        '--host',
        '0.0.0.0',
        '--port',
        '0',
      ])
      const url = new URL(server.url)
      Expect(url.hostname).toBe('0.0.0.0')
      url.hostname = '127.0.0.1'
      Expect((await fetch(new URL('/v1/data', url))).status).toBe(401)
    } finally {
      await server?.stop()
      await FS.remove(root)
    }
  })
})
