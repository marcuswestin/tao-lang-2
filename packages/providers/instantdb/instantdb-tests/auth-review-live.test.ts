import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { ephemeralApp } from './fixtures'

// Run explicitly against the machine's local InstantDB (`./agent unsandboxed local-instantdb start`):
// TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/providers/instantdb/instantdb-tests/auth-review-live.test.ts
// The review app's own source is pushed and run under `tao test`, signed in through InstantAuth. A
// self-hosted InstantDB sends no email, so the code is minted through the admin API beforehand; the
// server keeps it valid when the app asks for one.
const apiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = apiURI === undefined ? Test['skip'] : Test
const timeout = 180_000
const email = 'journey@example.test'

Describe('Auth Review against local InstantDB (requires TAO_INSTANT_LIVE_API_URL)', () => {
  liveTest('signs in with an email code, saves a profile and note, and signs out', async () => {
    const app = await ephemeralApp(apiURI!, 'Tao Auth Review')
    const root = await mkTestDir('tao-auth-review-instant-', { location: 'host' })
    try {
      const project = FS.resolvePath('project', root)
      await FS.mkdir(project)
      const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
      const entry = FS.resolvePath('Auth Review.tao', project)
      await FS.writeText(
        entry,
        source.replaceAll(
          'AppId "REPLACE_WITH_INSTANT_APP_ID"',
          `AppId "${app.id}"\n      ApiURI "${app.apiURI}"\n      WebsocketURI "${
            app.apiURI.replace(/^http/, 'ws')
          }/runtime/session"`,
        ),
      )
      await FS.writeText(
        FS.resolvePath('Project.tao', project),
        await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Project.tao')),
      )
      await agent(['tao', 'instantdb', 'push', entry, '--app', 'AuthReviewInstant'], {
        INSTANT_APP_ADMIN_TOKEN: app.target.token,
      })
      await FS.writeText(FS.resolvePath('Instant.test.tao', project), journey(await app.magicCode(email)))
      await agent(['tao', 'test', project], { TAO_HOME: FS.resolvePath('home', root), TAO_TEST_REAL_HTTP: '1' })

      // The account row is keyed by the signed-in InstantDB user, and owns the note saved through it.
      const [account] = await app.adminQuery('accounts')
      Expect(account).toMatchObject({ $user: account?.['id'], displayName: 'Alice' })
      Expect(await app.adminQuery('notes', { owner: {} })).toMatchObject([
        { body: 'Saved on InstantDB', owner: [{ id: account?.['id'] }] },
      ])
    } finally {
      await FS.remove(root)
    }
  }, timeout)
})

async function agent(args: readonly string[], env: Readonly<Record<string, string>>): Promise<void> {
  const result = await CLI.run(Repo.resolvePath('agent'), {
    args,
    cwd: Repo.getRoot(),
    env,
    processPolicy: 'test',
    stdio: 'pipe',
    timeoutMs: 150_000,
  })
  if (result.exitCode !== 0) {
    Errors.throwHostEnvironment(`./agent ${args.slice(0, 2).join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
}

function journey(code: string): string {
  return `
use AuthReviewInstant from ./
test "InstantDB auth" {
   test "signs in with an email code, completes the profile, saves a note, and signs out" {
      run AuthReviewInstant
      enter "${email}" into #codeEmail
      press #sendCode
      expect text "Enter your code"
      enter "${code}" into #code
      press #verifyCode
      expect text "Signed in"
      expect text "Complete your profile"
      enter "Alice" into label "Display name"
      press "Save profile"
      expect text "Hello Alice"
      enter "Saved on InstantDB" into #newNote
      press #addNote
      wait for sync
      expect text "Saved on InstantDB"
      press #signOut
      expect missing text "Saved on InstantDB"
   }
}
`
}
