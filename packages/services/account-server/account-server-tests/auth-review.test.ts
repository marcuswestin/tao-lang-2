import Compiler from '@compiler'
import { CLI, Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { accountPolicyFromJSON } from '../account-server-src/AccountPolicy'
import { AccountServer } from '../account-server-src/AccountServer'

Describe('Auth Review with the local authority', () => {
  Test('runs the Tao review app against real password verification and durable account data', async () => {
    const root = await mkTestDir('tao-auth-review-http-', { location: 'host' })
    const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
    const compiled = await Compiler.compileCode(source, { appName: 'AuthReviewLocal' })
    const metadata = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
    Expect(metadata).toBeDefined()
    const server = await AccountServer.start({
      databasePath: FS.resolvePath('accounts.sqlite', root),
      issuer: 'tao-local:auth-review',
      policy: accountPolicyFromJSON(JSON.parse(metadata!.code)),
      port: 0,
      resource: 'auth-review',
    })
    try {
      const project = FS.resolvePath('project', root)
      await FS.mkdir(project)
      await FS.writeText(
        FS.resolvePath('Auth Review.tao', project),
        source.replaceAll('http://127.0.0.1:4738', server.url),
      )
      await FS.writeText(
        FS.resolvePath('Project.tao', project),
        await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Project.tao')),
      )
      await FS.writeText(FS.resolvePath('Local.test.tao', project), localJourney)
      const result = await CLI.run(Repo.resolvePath('agent'), {
        args: ['tao', 'test', project],
        cwd: Repo.getRoot(),
        env: { TAO_HOME: FS.resolvePath('home', root), TAO_TEST_REAL_HTTP: '1' },
        processPolicy: 'test',
        stdio: 'pipe',
        timeoutMs: 120_000,
      })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(`Auth Review HTTP journey failed:\n${result.stdout}\n${result.stderr}`)
      }
      Expect(result.exitCode).toBe(0)
      const response = await fetch(`${server.url}/v1/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'review@example.test', password: 'review-password', resource: 'auth-review' }),
      })
      Expect(response.status).toBe(200)
      const session = await response.json() as { token: string }
      const snapshot = await fetch(`${server.url}/v1/data`, { headers: { authorization: `Bearer ${session.token}` } })
      const stored = await snapshot.json() as { rows: { entity: string; fields: Record<string, unknown> }[] }
      Expect(stored.rows.some(row => row.entity === 'Account' && row.fields['DisplayName'] === 'Alice')).toBe(true)
      Expect(stored.rows.some(row => row.entity === 'Note' && row.fields['Body'] === 'Saved through real authority'))
        .toBe(true)
    } finally {
      await server.stop()
      await FS.remove(root)
    }
  }, 120_000)
})

const localJourney = `
use AuthReviewLocal from ./
test "Local reference auth" {
   test "registers, saves a profile and note, and restores data after sign-out" {
      run AuthReviewLocal
      enter "review@example.test" into #email
      enter "review-password" into #password
      press #register
      expect text "Signed in"
      enter "Alice" into label "Display name"
      press "Save profile"
      expect text "Hello Alice"
      enter "Saved through real authority" into #newNote
      press #addNote
      wait for sync
      expect text "Saved through real authority"
      press #signOut
      expect missing text "Saved through real authority"
      enter "review@example.test" into #email
      enter "wrong-password" into #password
      press #submitSignIn
      expect text "Unable to sign in. Check your details and try again."
      enter "review-password" into #password
      press #submitSignIn
      expect text "Hello Alice"
      expect text "Saved through real authority"
   }
}
`
