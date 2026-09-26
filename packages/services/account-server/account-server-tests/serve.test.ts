import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { startAccountServerFromArguments } from '../account-server-src/serve'

Describe('Account reference service launcher', () => {
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
})
