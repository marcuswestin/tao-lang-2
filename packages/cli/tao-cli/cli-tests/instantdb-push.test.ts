import { Errors, FS, Platform } from '@shared'
import { Describe, Expect, fakeTerminal, Test } from '@shared/test'
import { runInstantDBPush } from '../cli-src/instantdb-push-command'
import { instantCloudApiURI, readInstantPushInputs } from '../cli-src/instantdb-push-inputs'
import { withTaoFixture } from './test-cli-files'

// The live case runs explicitly against the local InstantDB:
// TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/cli/tao-cli/cli-tests/instantdb-push.test.ts
const liveApiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = liveApiURI === undefined ? Test['skip'] : Test

type DatasourceSettings = { apiURI?: string; appId?: string }

/**
 * notesSource is a small app with an account that owns its notes and access rules on both. It binds
 * an InstantDB-derived datasource that accepts the test sign-in, so the rules have an Auth to pair
 * with whatever the stdlib InstantDB type accepts.
 */
function notesSource(settings: DatasourceSettings = {}, datasource?: string): string {
  const configured = [
    `      AppId ${settings.appId ?? '"app-1"'}`,
    ...(settings.apiURI === undefined ? [] : [`      ApiURI ${settings.apiURI}`]),
  ].join('\n')
  return `use TestAuth from @tao/auth/testing
use InstantDB from @tao/data/providers/instantdb
use Text from @tao/ui

app PushNotes {
   id "instant-push-notes"
   version "1.0.0"
   name "Instant push notes"
   Auth TestAuth { }
${
    datasource ?? `   Datasource TestedInstant {
${configured}
   }`
  }
   view Main
}

type TestedInstant is InstantDB with {
   accepts { TestIdentity }
}

view Main() {
   render Text("Notes")
}

data Accounts / Account {
   DisplayName text,
   Notes (owned),
}

data Notes / Note {
   Owner Account,
   Body text,
   CreatedAt time (default now),

   index CreatedAt,
}

access Account {
   Account can read
   Account can update DisplayName
}

access Note {
   Owner can read, create, delete
   Owner can update Body
}
`
}

async function withNotesApp(source: string, run: (appPath: string) => Promise<void>): Promise<void> {
  await withTaoFixture({ '.tao/.gitkeep': '', 'Notes.tao': source }, async root => {
    await run(FS.resolvePath('Notes.tao', root))
  })
}

type Request = { authorization: string | null; body: unknown; url: string }

function fakeInstant(plan: unknown) {
  const requests: Request[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({
      authorization: new Headers(init.headers).get('authorization'),
      body: JSON.parse(String(init.body)),
      url,
    })
    return Response.json(url.endsWith('/plan') ? plan : {})
  }) as unknown as typeof fetch
  return { fetcher, requests }
}

function captured() {
  const terminal = fakeTerminal()
  // Plain text keeps the assertions about wording rather than terminal colour.
  return { ...terminal, text: () => terminal.outputText().replaceAll(/\u001b\[[0-9;?]*[a-zA-Z]/gu, '') }
}

const addBody = ['add-attr', { 'forward-identity': ['attr-id', 'notes', 'body'] }]

Describe('tao instantdb push inputs', () => {
  Test('reads the address, the stored schema of the bound store, and the compiled policy', async () => {
    await withNotesApp(notesSource({ apiURI: '"http://localhost:9020"' }), async appPath => {
      const inputs = await readInstantPushInputs(appPath, 'PushNotes')
      Expect(inputs.appId).toBe('app-1')
      Expect(inputs.apiURI).toBe('http://localhost:9020')
      Expect(inputs.definition.entities).toEqual({
        Account: {
          collection: 'Accounts',
          fields: { DisplayName: { kind: 'text' } },
          inverseFields: { Notes: { inverseField: 'Owner', relation: 'Note' } },
        },
        Note: {
          collection: 'Notes',
          fields: {
            Body: { kind: 'text' },
            CreatedAt: { indexed: true, kind: 'time' },
            Owner: { kind: 'relation', onDelete: 'cascade', relation: 'Account' },
          },
          inverseFields: {},
        },
      })
      Expect(inputs.policy?.accountEntity).toBe('Account')
      Expect(inputs.policy?.entities['Note']?.grants).toContainEqual({ operations: ['read'], principal: ['Owner'] })
    })
  })

  Test('defaults ApiURI to Instant Cloud and follows a named datasource patched where it is bound', async () => {
    const source = notesSource({}, '   Datasource Store with { AppId "patched-app" }').replace(
      'view Main() {',
      'datasource Store = TestedInstant {\n   AppId "declared-app"\n}\n\nview Main() {',
    )
    await withNotesApp(source, async appPath => {
      const inputs = await readInstantPushInputs(appPath, 'PushNotes')
      Expect(inputs.appId).toBe('patched-app')
      Expect(inputs.apiURI).toBe(instantCloudApiURI)
    })
  })

  Test('refuses an AppId written as anything but a text literal, naming the setting', async () => {
    const source = notesSource({ appId: 'ReviewApp' }).replace(
      'view Main() {',
      'let ReviewApp = "app-1"\n\nview Main() {',
    )
    await withNotesApp(source, async appPath => {
      const read = readInstantPushInputs(appPath, 'PushNotes')
      await Expect(read).rejects.toBeInstanceOf(Errors.UserInputError)
      await Expect(read).rejects.toThrow(
        "App 'PushNotes' sets InstantDB AppId to something other than a text literal; push reads AppId from "
          + 'source, so write it as a quoted value.',
      )
    })
  })

  Test('refuses an app that binds no InstantDB datasource, naming the app', async () => {
    const source = notesSource({}, '   Datasource Memory { }')
      .replace('use Text from @tao/ui', 'use Memory from @tao/data/providers/memory\nuse Text from @tao/ui')
    await withNotesApp(source, async appPath => {
      await Expect(readInstantPushInputs(appPath, 'PushNotes')).rejects.toThrow(
        "App 'PushNotes' binds no InstantDB datasource, so there is nothing to push.",
      )
    })
  })
})

Describe('tao instantdb push', () => {
  Test('pushes additive changes and rules, printing the app, endpoint, and changes but never the token', async () => {
    await withNotesApp(notesSource({ apiURI: '"http://localhost:9020"' }), async appPath => {
      const instant = fakeInstant({ 'current-attrs': [], steps: [addBody] })
      const terminal = captured()
      await runInstantDBPush(appPath, {
        appName: 'PushNotes',
        env: { INSTANT_APP_ADMIN_TOKEN: 'secret-token' },
        fetch: instant.fetcher,
        output: terminal.output,
      })
      Expect(instant.requests.map(request => request.url)).toEqual([
        'http://localhost:9020/superadmin/apps/app-1/schema/push/plan',
        'http://localhost:9020/superadmin/apps/app-1/schema/push/apply',
        'http://localhost:9020/superadmin/apps/app-1/perms',
      ])
      Expect(instant.requests.every(request => request.authorization === 'Bearer secret-token')).toBe(true)
      const rules = (instant.requests[2]!.body as { code: Record<string, unknown> }).code
      Expect(Object.keys(rules).toSorted()).toEqual(['$default', 'accounts', 'attrs', 'notes'])
      Expect(rules['notes']).toMatchObject({
        allow: { view: 'principal0' },
        bind: ['principal0', "auth.id in data.ref('owner.$user.id')"],
      })
      const text = terminal.text()
      Expect(text).toContain('InstantDB app app-1 at http://localhost:9020 (PushNotes, ')
      Expect(text).toContain('Schema changes applied:\n  add-attr notes.body\n')
      Expect(text).toContain(
        'Rules applied: from the declared access rules for accounts, notes; other namespaces and new attributes'
          + ' are denied.',
      )
      Expect(text.includes('secret-token')).toBe(false)
    })
  })

  Test('uses a stored project token when the environment has no override', async () => {
    await withNotesApp(notesSource(), async appPath => {
      const instant = fakeInstant({ 'current-attrs': [], steps: [] })
      const terminal = captured()
      const lookedUp: string[] = []
      await runInstantDBPush(appPath, {
        env: {},
        fetch: instant.fetcher,
        output: terminal.output,
        projectSecret: async (name, root) => {
          lookedUp.push(`${name}:${root}`)
          return 'project-token'
        },
      })
      Expect(lookedUp).toEqual([`INSTANT_APP_ADMIN_TOKEN:${FS.dirname(appPath)}`])
      Expect(instant.requests.map(request => request.authorization)).toEqual([
        'Bearer project-token',
        'Bearer project-token',
      ])
      Expect(terminal.text()).not.toContain('project-token')
    })
  })

  Test('--dry-run only plans, and says what a push would change', async () => {
    await withNotesApp(notesSource(), async appPath => {
      const instant = fakeInstant({ 'current-attrs': [], steps: [addBody] })
      const terminal = captured()
      await runInstantDBPush(appPath, {
        dryRun: true,
        env: { INSTANT_APP_ADMIN_TOKEN: 'secret-token' },
        fetch: instant.fetcher,
        output: terminal.output,
      })
      Expect(instant.requests.map(request => request.url)).toEqual([
        `${instantCloudApiURI}/superadmin/apps/app-1/schema/push/plan`,
      ])
      const text = terminal.text()
      Expect(text).toContain('Schema changes a push would apply (dry run):\n  add-attr notes.body\n')
      Expect(text).toContain('Rules not applied (dry run): from the declared access rules for accounts, notes;')
    })
  })

  Test('--force pushes past undeclared attributes and non-additive steps, listing both', async () => {
    await withNotesApp(notesSource(), async appPath => {
      const stale = { catalog: 'user', 'forward-identity': ['attr-id', 'Todo', 'text'] }
      const unique = ['unique', { 'forward-identity': ['attr-id', 'notes', 'body'] }]
      const plan = { 'current-attrs': [stale], steps: [addBody, unique] }
      const push = (options: { dryRun?: boolean; force?: boolean }) => {
        const instant = fakeInstant(plan)
        const terminal = captured()
        const pushed = runInstantDBPush(appPath, {
          ...options,
          env: { INSTANT_APP_ADMIN_TOKEN: 'secret-token' },
          fetch: instant.fetcher,
          output: terminal.output,
        })
        return { instant, pushed, terminal }
      }

      const refused = push({})
      await Expect(refused.pushed).rejects.toThrow("The app stores 'Todo.text'")
      Expect(refused.instant.requests.map(request => request.url.split('/').at(-1))).toEqual(['plan'])

      const planned = push({ dryRun: true, force: true })
      await planned.pushed
      Expect(planned.instant.requests.map(request => request.url.split('/').at(-1))).toEqual(['plan'])
      Expect(planned.terminal.text()).toContain(
        'Schema changes a push would apply (dry run):\n  add-attr notes.body\n'
          + 'Non-additive changes a forced push would apply (dry run):\n  unique notes.body\n'
          + 'Left on the server, not declared by the Tao schema (delete them in the InstantDB dashboard):\n'
          + '  Todo.text\n',
      )

      const forced = push({ force: true })
      await forced.pushed
      Expect(forced.instant.requests.map(request => request.url.split('/').at(-1))).toEqual(['plan', 'apply', 'perms'])
      Expect(forced.terminal.text()).toContain('Non-additive changes applied (forced):\n  unique notes.body\n')
    })
  })

  Test('asks for the token without echo at a terminal when the environment has none', async () => {
    await withNotesApp(notesSource(), async appPath => {
      const instant = fakeInstant({ 'current-attrs': [], steps: [] })
      const terminal = captured()
      const pushed = runInstantDBPush(appPath, {
        env: {},
        fetch: instant.fetcher,
        input: terminal.input,
        interactive: true,
        output: terminal.output,
      })
      terminal.input.write('typed-token\r')
      await pushed
      Expect(instant.requests.map(request => request.authorization)).toEqual([
        'Bearer typed-token',
        'Bearer typed-token',
      ])
      Expect(terminal.text()).toContain('Schema already current.')
      Expect(terminal.text().includes('typed-token')).toBe(false)
    })
  })

  Test('says how to supply the token when there is none and no terminal, before any request', async () => {
    await withNotesApp(notesSource(), async appPath => {
      const instant = fakeInstant({ 'current-attrs': [], steps: [] })
      const push = runInstantDBPush(appPath, { env: {}, fetch: instant.fetcher, interactive: false })
      await Expect(push).rejects.toBeInstanceOf(Errors.UserInputError)
      await Expect(push).rejects.toThrow(
        'Store INSTANT_APP_ADMIN_TOKEN with `tao secrets set`, set the environment variable, or run this command in a terminal to enter it.',
      )
      Expect(instant.requests).toEqual([])
    })
  })

  liveTest('pushes to a fresh local InstantDB app, and a second push finds nothing to change', async () => {
    const base = new URL(liveApiURI!).origin
    const created = await fetch(`${base}/dash/apps/ephemeral`, {
      body: JSON.stringify({ title: `tao instantdb push ${Platform.randomUUID()}` }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    Expect(created.status).toBe(200)
    const { app } = await created.json() as { app: { 'admin-token': string; id: string } }
    await withNotesApp(notesSource({ apiURI: JSON.stringify(base), appId: JSON.stringify(app.id) }), async appPath => {
      const env = { INSTANT_APP_ADMIN_TOKEN: app['admin-token'] }
      const first = captured()
      await runInstantDBPush(appPath, { env, output: first.output })
      Expect(first.text()).toContain(`InstantDB app ${app.id} at ${base} (PushNotes, `)
      Expect(first.text()).toContain('Schema changes applied:\n')
      Expect(first.text()).toContain('add-attr notes.body')
      Expect(first.text()).toContain('Rules applied: from the declared access rules for accounts, notes;')

      const second = captured()
      await runInstantDBPush(appPath, { env, output: second.output })
      Expect(second.text()).toContain('Schema already current.\n')
      Expect(second.text()).toContain('Rules applied:')
      Expect(`${first.text()}${second.text()}`.includes(app['admin-token'])).toBe(false)
    })
  }, 120_000)
})
