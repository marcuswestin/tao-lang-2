import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { pushInstantSchema } from '../instantdb-src/instant-push'
import { instantRules } from '../instantdb-src/instant-rules'
import { instantMapping } from '../instantdb-src/instant-schema'
import { publicNotesSchema } from './fixtures'

const mapping = instantMapping(publicNotesSchema)
const generated = { rules: instantRules(mapping), schema: mapping.schema }

type Request = { authorization: string | null; body: unknown; url: string }

function fakeInstant(plan: unknown, failing?: { path: string; response: Response }) {
  const requests: Request[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({
      authorization: new Headers(init.headers).get('authorization'),
      body: JSON.parse(String(init.body)),
      url,
    })
    if (failing !== undefined && url.endsWith(failing.path)) {
      return failing.response
    }
    return Response.json(url.endsWith('/plan') ? plan : {})
  }) as unknown as typeof fetch
  return { fetcher, requests }
}

const userAttribute = (namespace: string, label: string) => ({
  catalog: 'user',
  'forward-identity': ['attr-id', namespace, label],
})

Describe('InstantDB schema push', () => {
  Test('plans, applies additive changes, then applies rules, reporting each endpoint and token', async () => {
    const instant = fakeInstant({
      'current-attrs': [
        { catalog: 'system', 'forward-identity': ['attr-id', '$files', 'path'] },
        userAttribute('notes', 'body'),
      ],
      steps: [['add-attr', { 'forward-identity': ['attr-id', 'notes', 'pinned'] }], [
        'index',
        { 'forward-identity': ['attr-id', 'notes', 'body'] },
      ]],
    })
    const report = await pushInstantSchema(
      { apiURI: 'http://localhost:9020/', appId: 'app-1', fetch: instant.fetcher, token: 'secret-token' },
      generated,
    )

    Expect(report).toEqual({
      changes: ['add-attr notes.pinned', 'index notes.body'],
      steps: [
        {
          authorization: 'Bearer app admin token',
          endpoint: 'http://localhost:9020/superadmin/apps/app-1/schema/push/plan',
          method: 'POST',
          purpose: 'plan schema',
        },
        {
          authorization: 'Bearer app admin token',
          endpoint: 'http://localhost:9020/superadmin/apps/app-1/schema/push/apply',
          method: 'POST',
          purpose: 'apply schema',
        },
        {
          authorization: 'Bearer app admin token',
          endpoint: 'http://localhost:9020/superadmin/apps/app-1/perms',
          method: 'POST',
          purpose: 'apply rules',
        },
      ],
    })
    Expect(instant.requests.map(request => request.authorization)).toEqual([
      'Bearer secret-token',
      'Bearer secret-token',
      'Bearer secret-token',
    ])
    Expect(instant.requests[0]!.body).toEqual({
      check_types: true,
      schema: generated.schema,
      supports_background_updates: true,
    })
    Expect(instant.requests[2]!.body).toEqual({ code: generated.rules })
    Expect(JSON.stringify(report).includes('secret-token')).toBe(false)
  })

  Test('skips the schema apply when the plan is empty', async () => {
    const instant = fakeInstant({ 'current-attrs': [userAttribute('notes', 'body')], steps: [] })
    const report = await pushInstantSchema(
      {
        apiURI: 'http://localhost:9020',
        appId: 'app-1',
        fetch: instant.fetcher,
        token: 't',
        tokenLabel: 'platform token',
      },
      generated,
    )
    Expect(report.changes).toEqual([])
    Expect(report.steps.map(step => [step.purpose, step.authorization])).toEqual([
      ['plan schema', 'Bearer platform token'],
      ['apply rules', 'Bearer platform token'],
    ])
  })

  Test('refuses removals, renames, and non-additive steps before changing anything', async () => {
    const instant = fakeInstant({
      'current-attrs': [
        userAttribute('notes', 'body'),
        userAttribute('notes', 'title'),
        userAttribute('taoSnapshots', 'Snapshot'),
        userAttribute('$users', 'nickname'),
      ],
      steps: [['add-attr', {}], ['unique', { 'forward-identity': ['attr-id', 'notes', 'body'] }]],
    })
    const push = pushInstantSchema(
      { apiURI: 'http://localhost:9020', appId: 'app-1', fetch: instant.fetcher, token: 't' },
      generated,
    )
    await Expect(push).rejects.toBeInstanceOf(Errors.UserInputError)
    await Expect(push).rejects.toThrow(
      [
        'InstantDB schema push refused: only additive changes are pushed, and applying this schema needs more.',
        "- The app stores 'notes.title', which the Tao schema no longer declares. A renamed or removed field keeps "
        + 'its data on the server; move or delete it in the InstantDB dashboard first.',
        "- The app stores 'taoSnapshots.Snapshot', which the Tao schema no longer declares. A renamed or removed "
        + 'field keeps its data on the server; move or delete it in the InstantDB dashboard first.',
        "- The plan would 'unique notes.body', which changes existing attributes or data rather than adding to them.",
      ].join('\n'),
    )
    Expect(instant.requests.map(request => request.url)).toEqual([
      'http://localhost:9020/superadmin/apps/app-1/schema/push/plan',
    ])
  })

  Test('reports an HTTP failure with the endpoint and the server message, never the token', async () => {
    const instant = fakeInstant({ 'current-attrs': [], steps: [] }, {
      path: '/perms',
      response: Response.json({ message: 'Invalid rules: unknown attr', type: 'param-malformed' }, { status: 400 }),
    })
    const push = pushInstantSchema(
      { apiURI: 'http://localhost:9020', appId: 'app-1', fetch: instant.fetcher, token: 'secret-token' },
      generated,
    )
    await Expect(push).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    await Expect(push).rejects.toThrow(
      'InstantDB apply rules at http://localhost:9020/superadmin/apps/app-1/perms failed with HTTP 400: '
        + 'Invalid rules: unknown attr.',
    )
  })
})
