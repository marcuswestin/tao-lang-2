import { Errors, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  compiledProbeShape,
  denied,
  type ProbeEvidence,
  type ProbePlan,
  probeSourceProvenance,
  publicProbePlan,
  runFirebaseProbe,
} from '../cli-src/firebase-hostile-probe'

type Json = Record<string, unknown>
const plan: ProbePlan = {
  apiKey: 'public-test-key',
  projectId: 'firebase-test-project',
  storageKey: 'hosted-firebase-notes',
  schemaSha256: 'mock-schema',
}
const reply = (body: Json, status = 200) => Response.json(body, { status })
const deniedReply = () => reply({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403)
const record = (value: unknown): Json => value as Json

function mockFirebase(foreignGet: 'denied' | 'missing' | 'generic' = 'denied', authFailure = false) {
  const docs = new Map<string, Json>()
  const calls: { url: string; method: string; redirect: string; body?: Json }[] = []
  const fetcher = (async (input: string, init?: Parameters<typeof fetch>[1]) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Json : undefined
    calls.push({ url, method, redirect: init?.redirect ?? 'follow', body })
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const email = body?.['email']
      if (email === 'b@example.test' && authFailure) {
        return reply({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }, 400)
      }
      return reply({
        localId: email === 'a@example.test' ? 'uid-a' : 'uid-b',
        idToken: email === 'a@example.test' ? 'token-a' : 'token-b',
      })
    }
    if (!url.startsWith('https://firestore.googleapis.com/v1/projects/firebase-test-project/')) {
      return reply({ error: { code: 400, status: 'INVALID_ARGUMENT' } }, 400)
    }
    const token = String(record(init?.headers)['authorization'] ?? '').replace('Bearer ', '')
    const uid = token === 'token-a' ? 'uid-a' : 'uid-b'
    if (url.endsWith('/documents:commit')) {
      const write = record((body?.['writes'] as unknown[])[0])
      const name = String(record(write['update'] ?? {})['name'] ?? write['delete'] ?? '')
      const owner = /\/users\/([^/]+)\/stores\//u.exec(name)?.[1]
      if (owner !== uid || write['delete'] || !name.includes('/stores/s_hosted-firebase-notes/Item/')) {
        return deniedReply()
      }
      const fields = record(record(write['update'])['fields'])
      if (
        fields['Owner'] || fields['serverTimestamp'] || record(fields['Done'])['stringValue'] !== undefined
        || record(fields['_deleted'])['booleanValue'] === true && record(write['currentDocument'])['exists'] === false
      ) {
        return deniedReply()
      }
      docs.set(name, { name, fields: { ...fields, serverTimestamp: { timestampValue: '2026-01-01T00:00:00Z' } } })
      return reply({ writeResults: [{}] })
    }
    const path = decodeURIComponent(new URL(url).pathname)
    const owner = /\/users\/([^/]+)\/stores\//u.exec(path)?.[1]
    const target = `projects/firebase-test-project/databases/(default)/documents${path.split('/documents')[1]}`
    if (owner !== uid) {
      if (method === 'GET' && foreignGet === 'missing' && !url.includes('?pageSize=')) {
        return reply({ error: { code: 404, status: 'NOT_FOUND' } }, 404)
      }
      if (method === 'GET' && foreignGet === 'generic' && !url.includes('?pageSize=')) {
        return reply({ error: { code: 403 } }, 403)
      }
      return deniedReply()
    }
    if (url.includes('?pageSize=')) {
      const prefix = target.split('?')[0] + '/'
      return reply({ documents: [...docs.entries()].filter(([name]) => name.startsWith(prefix)).map(([, doc]) => doc) })
    }
    return docs.has(target) ? reply(docs.get(target)!) : reply({ error: { code: 404, status: 'NOT_FOUND' } }, 404)
  }) as typeof fetch
  return { fetcher, calls, docs }
}

Describe('Firebase Notes hostile probe', () => {
  Test('derives the authored store and Item shape through compilation without a cloud call', async () => {
    const shape = await compiledProbeShape(FS.resolvePath('Apps/Hosted Firebase/App.tao', Repo.getRoot()))
    Expect(shape.storageKey).toBe('hosted-firebase-notes')
    Expect(shape.schemaSha256).toMatch(/^[a-f0-9]{64}$/u)
  }, 30_000)

  Test('includes implementation bytes in provenance independently of the entrypoint and app', () => {
    const first = probeSourceProvenance('entrypoint', 'implementation-one', 'app', 'schema')
    const changed = probeSourceProvenance('entrypoint', 'implementation-two', 'app', 'schema')
    Expect(first.implementationSha256).toMatch(/^[a-f0-9]{64}$/u)
    Expect(changed.implementationSha256).not.toBe(first.implementationSha256)
    Expect(changed.scriptSha256).toBe(first.scriptSha256)
    Expect(changed.appSha256).toBe(first.appSha256)
    Expect(changed.schemaSha256).toBe(first.schemaSha256)
  })

  Test('uses only randomized Item fixtures, records evidence before requests, and enforces denials', async () => {
    const mock = mockFirebase()
    const saved: ProbeEvidence[] = []
    const evidence = await runFirebaseProbe(
      mock.fetcher,
      {
        a: { email: 'a@example.test', password: 'a-local-secret' },
        b: { email: 'b@example.test', password: 'b-local-secret' },
      },
      plan,
      async current => {
        if (saved.length === 0) {
          Expect(mock.calls).toHaveLength(0)
        }
        saved.push(structuredClone(current))
      },
    )
    Expect(evidence.state).toBe('complete')
    Expect(evidence.observations.filter(item => item.verdict !== 'PASS')).toEqual([])
    Expect(saved[0]!.state).toBe('prepared')
    Expect(evidence.fixtureIds).toHaveLength(7)
    Expect(evidence.fixtureIds.every(id => id.startsWith('tao-hostile-'))).toBe(true)
    Expect(evidence.attempts).toHaveLength(7)
    Expect(evidence.cleanup).toHaveLength(2)
    Expect(evidence.cleanup.every(item => item.status === 'tombstone retained')).toBe(true)
    Expect(mock.calls.every(call => call.redirect === 'error')).toBe(true)
    Expect(
      mock.calls.filter(call => call.url.includes('firestore.googleapis.com')).every(call =>
        call.url.includes('/stores/s_hosted-firebase-notes/Item') || call.url.endsWith('/documents:commit')
      ),
    ).toBe(true)
    Expect(JSON.stringify(evidence)).not.toContain('local-secret')
    Expect(JSON.stringify(evidence)).not.toContain('token-a')
    Expect(JSON.stringify(evidence)).not.toContain(plan.apiKey)
    Expect(mock.calls.some(call => JSON.stringify(call.body ?? {}).includes('Account/'))).toBe(false)
  }, 30_000)

  Test('cleans an owned create committed before its response is lost or malformed', async () => {
    for (const response of ['lost', 'malformed'] as const) {
      const mock = mockFirebase()
      const saved: ProbeEvidence[] = []
      let committedName: string | undefined
      const fetcher = (async (input: string, init?: Parameters<typeof fetch>[1]) => {
        if (!committedName && input.endsWith('/documents:commit')) {
          const body = JSON.parse(String(init?.body)) as { writes: { update: { name: string } }[] }
          committedName = body.writes[0]!.update.name
          const id = committedName.split('/').at(-1)!
          Expect(saved.at(-1)?.attempts).toContainEqual({ id, case: 'own-create-A', owner: 'A' })
          await mock.fetcher(input, init)
          if (response === 'lost') {
            Errors.throwHostEnvironment('response lost after commit')
          }
          return new Response('malformed response', { status: 200 })
        }
        return mock.fetcher(input, init)
      }) as typeof fetch
      const evidence = await runFirebaseProbe(
        fetcher,
        {
          a: { email: 'a@example.test', password: 'a-local-secret' },
          b: { email: 'b@example.test', password: 'b-local-secret' },
        },
        plan,
        async current => {
          saved.push(structuredClone(current))
        },
      )
      Expect(evidence.observations.find(item => item.case === 'own-create-A')?.verdict).toBe('INCONCLUSIVE')
      Expect(evidence.cleanup.find(item => item.id === committedName?.split('/').at(-1))?.status).toBe(
        'tombstone retained',
      )
      const document = record(mock.docs.get(committedName!))
      Expect(record(record(document['fields'])['_deleted'])['booleanValue']).toBe(true)
    }
  }, 30_000)

  Test('cleans an owned create when evidence recording is interrupted after commit', async () => {
    const mock = mockFirebase()
    let interrupted = false
    const evidence = await runFirebaseProbe(
      mock.fetcher,
      {
        a: { email: 'a@example.test', password: 'a-local-secret' },
        b: { email: 'b@example.test', password: 'b-local-secret' },
      },
      plan,
      async current => {
        if (!interrupted && current.observations.some(item => item.case === 'own-create-A')) {
          interrupted = true
          Errors.throwHostEnvironment('evidence write interrupted')
        }
      },
    )
    Expect(evidence.state).toBe('interrupted')
    Expect(evidence.attempts).toHaveLength(1)
    Expect(evidence.cleanup).toHaveLength(1)
    Expect(evidence.cleanup[0]?.status).toBe('tombstone retained')
    const document = [...mock.docs.values()][0]!
    Expect(record(record(document['fields'])['_deleted'])['booleanValue']).toBe(true)
  }, 30_000)

  Test('treats hidden 404 and generic 403 responses as inconclusive', async () => {
    for (const response of ['missing', 'generic'] as const) {
      const mock = mockFirebase(response)
      const evidence = await runFirebaseProbe(
        mock.fetcher,
        {
          a: { email: 'a@example.test', password: 'a-local-secret' },
          b: { email: 'b@example.test', password: 'b-local-secret' },
        },
        plan,
        async () => {},
      )
      Expect(evidence.observations.find(item => item.case === 'foreign-get')?.verdict).toBe('INCONCLUSIVE')
    }
    Expect(denied({ status: 403, errorStatus: 'PERMISSION_DENIED' })).toBe('PASS')
    Expect(denied({ status: 404, errorStatus: 'NOT_FOUND' })).toBe('INCONCLUSIVE')
  }, 30_000)

  Test('records an auth error without making Firestore requests', async () => {
    const mock = mockFirebase('denied', true)
    const evidence = await runFirebaseProbe(
      mock.fetcher,
      {
        a: { email: 'a@example.test', password: 'a-local-secret' },
        b: { email: 'b@example.test', password: 'b-local-secret' },
      },
      plan,
      async () => {},
    )
    Expect(evidence.observations.find(item => item.case === 'auth-B')).toMatchObject({
      verdict: 'INCONCLUSIVE',
      status: 400,
      errorCode: '400',
      errorReason: 'INVALID_LOGIN_CREDENTIALS',
    })
    Expect(mock.calls.some(call => call.url.includes('firestore.googleapis.com'))).toBe(false)
    Expect(JSON.stringify(evidence)).not.toContain('local-secret')
  })

  Test('does not retain reflected passwords, usernames, API keys, or tokens in evidence', async () => {
    const credentials = {
      a: { email: 'PERMISSION_DENIED@example.test', password: 'SUPERSECRET' },
      b: { email: 'b@example.test', password: 'b-secret' },
    }
    const protectedPlan = { ...plan, apiKey: 'INVALID_LOGIN_CREDENTIALS' }
    for (const reflected of ['SUPERSECRET', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED']) {
      const calls: string[] = []
      const fetcher = (async (input: string, init?: Parameters<typeof fetch>[1]) => {
        calls.push(String(input))
        const email = record(JSON.parse(String(init?.body)))['email']
        return email === credentials.a.email
          ? reply({ localId: 'uid-a', idToken: 'USER_DISABLED' })
          : reply({ error: { code: 400, status: 'PERMISSION_DENIED', message: `${reflected}: reflected` } }, 400)
      }) as typeof fetch
      const saved: ProbeEvidence[] = []
      const evidence = await runFirebaseProbe(fetcher, credentials, protectedPlan, async current => {
        saved.push(structuredClone(current))
      })
      Expect(evidence.observations.find(item => item.case === 'auth-B')).toMatchObject({
        verdict: 'INCONCLUSIVE',
        status: 400,
        errorCode: '400',
      })
      Expect(calls).toHaveLength(2)
      Expect(calls.every(url => url.startsWith('https://identitytoolkit.googleapis.com/'))).toBe(true)
      const serialized = JSON.stringify(saved)
      for (
        const secret of [
          credentials.a.email,
          credentials.a.password,
          credentials.b.email,
          credentials.b.password,
          'PERMISSION_DENIED',
          protectedPlan.apiKey,
          'USER_DISABLED',
        ]
      ) {
        Expect(serialized).not.toContain(secret)
      }
    }
  })

  Test('redacts a password contained within a provider status while retaining its denial verdict', async () => {
    const mock = mockFirebase()
    const saved: ProbeEvidence[] = []
    const evidence = await runFirebaseProbe(
      mock.fetcher,
      {
        a: { email: 'a@example.test', password: 'PERMISSION' },
        b: { email: 'b@example.test', password: 'b-secret' },
      },
      plan,
      async current => {
        saved.push(structuredClone(current))
      },
    )
    Expect(evidence.observations.find(item => item.case === 'foreign-get')).toMatchObject({
      verdict: 'PASS',
      status: 403,
    })
    Expect(JSON.stringify(saved)).not.toContain('PERMISSION')
  }, 30_000)

  Test('redacts a password contained within a recognized auth error reason', async () => {
    const credentials = {
      a: { email: 'a@example.test', password: 'PASSWORD' },
      b: { email: 'b@example.test', password: 'b-secret' },
    }
    const fetcher = (async (_input: string, init?: Parameters<typeof fetch>[1]) => {
      const email = record(JSON.parse(String(init?.body)))['email']
      return email === credentials.a.email
        ? reply({ localId: 'uid-a', idToken: 'token-a' })
        : reply({ error: { code: 400, message: 'INVALID_PASSWORD' } }, 400)
    }) as typeof fetch
    const saved: ProbeEvidence[] = []
    await runFirebaseProbe(fetcher, credentials, plan, async current => {
      saved.push(structuredClone(current))
    })
    Expect(saved.at(-1)?.observations.find(item => item.case === 'auth-B')?.verdict).toBe('INCONCLUSIVE')
    Expect(JSON.stringify(saved)).not.toContain('PASSWORD')
  })

  Test('rejects malformed public routing and configuration before requests', () => {
    Expect(() =>
      publicProbePlan({ firebase: { projectId: '../other', apiKey: 'public-test-key' } }, {
        storageKey: plan.storageKey,
        schemaSha256: plan.schemaSha256,
      })
    ).toThrow('incomplete')
    Expect(() =>
      publicProbePlan({ firebase: { projectId: plan.projectId, apiKey: plan.apiKey } }, {
        storageKey: '../other',
        schemaSha256: plan.schemaSha256,
      })
    ).toThrow('incomplete')
    Expect(() =>
      publicProbePlan({
        firebase: {
          projectId: plan.projectId,
          apiKey: plan.apiKey,
          endpoint: 'https://example.test',
        },
      }, { storageKey: plan.storageKey, schemaSha256: plan.schemaSha256 })
    ).toThrow('incomplete')
  })
})
