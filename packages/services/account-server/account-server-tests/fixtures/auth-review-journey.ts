import { CLI, Errors, FS, Repo } from '@shared'
import { Expect } from '@shared/test'
import type { AccountProtocol } from 'tao-shared/auth'

/** Exercise the same Tao source and real HTTP login journey for each durable backend. */
export async function runAuthReviewJourney(
  root: string,
  source: string,
  server: { url: string },
): Promise<AccountProtocol.Snapshot> {
  const project = FS.resolvePath('project', root)
  await FS.mkdir(project)
  await FS.writeText(
    FS.resolvePath('Auth Review.tao', project),
    source.replaceAll('http://127.0.0.1:4738', server.url),
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
  const stored = await snapshot.json() as AccountProtocol.Snapshot
  Expect(stored.rows.some(row => row.entity === 'Account' && row.fields['DisplayName'] === 'Alice')).toBe(true)
  Expect(stored.rows.some(row => row.entity === 'Note' && row.fields['Body'] === 'Saved through real authority'))
    .toBe(true)
  return stored
}

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
