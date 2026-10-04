import { describe, expect, test } from 'bun:test'
import {
  authSummaryLines,
  firebaseWrite,
  main,
  type ProbeReport,
  randomId,
  runAppwrite,
  runFirebase,
  runProviderSequence,
} from '../../scripts/hostile-probe'

const accounts = {
  a: { email: 'a@example.test', password: 'private-A-credential' },
  b: { email: 'b@example.test', password: 'private-B-credential' },
}

describe('hostile hosted request probe', () => {
  test('Firestore commit includes the server time transform required by deployed rules', () => {
    const write = firebaseWrite(
      'projects/tao-hosted-crud-79c429/databases/(default)/documents/users/a/notes/probe',
      'probe',
      false,
      false,
    )
    expect(write).toEqual({
      writes: [{
        update: {
          name: 'projects/tao-hosted-crud-79c429/databases/(default)/documents/users/a/notes/probe',
          fields: {
            text: { stringValue: 'probe' },
            done: { booleanValue: false },
            updatedAt: { integerValue: expect.any(String) },
            _deleted: { booleanValue: false },
          },
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }],
      }],
    })
  })

  test('generated Appwrite row IDs fit the installed API limit', () => {
    const id = randomId()
    expect(id).toMatch(/^hostile-probe-[a-f0-9]+$/u)
    expect(id.length).toBeLessThanOrEqual(36)
  })

  test('same Firebase identity cannot reach data probes, even with two valid logins', async () => {
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = []
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), redirect: init?.redirect })
      return Response.json({ idToken: 'secret-token', localId: 'same-user' })
    }) as typeof fetch
    const evidence = await runFirebase(fetcher, accounts)
    expect(evidence.observations.at(-1)?.case).toBe('distinct-accounts')
    expect(evidence.observations.at(-1)?.verdict).toBe('INCONCLUSIVE')
    expect(calls).toHaveLength(2)
    expect(calls.every(call => call.url.includes('signInWithPassword') && call.redirect === 'error')).toBe(true)
    expect(JSON.stringify(evidence)).not.toContain('secret-token')
  })

  test('unauthorized Firebase controls do not count hostile denials as passes or leak response text', async () => {
    let login = 0
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('signInWithPassword')) {
        login++
        return Response.json({ idToken: `token-${login}`, localId: login === 1 ? 'user-A' : 'user-B' })
      }
      expect(init?.redirect).toBe('error')
      return Response.json({ error: { status: 'PERMISSION_DENIED', message: accounts.a.password }, code: 403 }, {
        status: 403,
      })
    }) as typeof fetch
    const evidence = await runFirebase(fetcher, accounts)
    expect(evidence.observations.find(x => x.case === 'create-A')?.verdict).not.toBe('PASS')
    expect(evidence.observations.find(x => x.case === 'hostile-gate')?.verdict).toBe('INCONCLUSIVE')
    expect(evidence.observations.some(x => x.case === 'foreign-get')).toBe(false)
    expect(JSON.stringify(evidence)).not.toContain(accounts.a.password)
    expect(JSON.stringify(evidence)).not.toContain('token-1')
  })

  test('failed login evidence keeps only known auth codes and types, even when bodies contain secrets', async () => {
    let firebaseCalls = 0
    const firebaseFetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      firebaseCalls++
      return Response.json({
        error: {
          code: 400,
          message: firebaseCalls === 1
            ? `INVALID_LOGIN_CREDENTIALS : ${accounts.a.password} raw-token`
            : `INVALID_LOGIN_CREDENTIALS_${accounts.b.password}: raw-token`,
          secret: 'raw-token',
        },
      }, { status: 400 })
    }) as typeof fetch
    const firebase = await runFirebase(firebaseFetch, accounts)
    expect(firebaseCalls).toBe(2)
    expect(firebase.observations.find(x => x.case === 'auth-A')).toMatchObject({
      status: 400,
      code: 'INVALID_LOGIN_CREDENTIALS',
      authCategory: 'credentials_rejected',
      verdict: 'INCONCLUSIVE',
    })
    expect(firebase.observations.find(x => x.case === 'auth-B')).toMatchObject({
      status: 400,
      authCategory: 'unclassified_auth_failure',
      verdict: 'INCONCLUSIVE',
    })
    expect(firebase.observations.find(x => x.case === 'auth-B')?.code).toBeUndefined()

    let appwriteCalls = 0
    const appwriteFetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      appwriteCalls++
      return Response.json({
        type: appwriteCalls === 1
          ? 'user_invalid_credentials'
          : `user_invalid_credentials_${accounts.b.password}`,
        message: accounts.a.password,
        secret: 'raw-token',
      }, { status: 401 })
    }) as typeof fetch
    const appwrite = await runAppwrite(appwriteFetch, accounts)
    expect(appwriteCalls).toBe(2)
    expect(appwrite.observations.find(x => x.case === 'auth-A')).toMatchObject({
      status: 401,
      type: 'user_invalid_credentials',
      authCategory: 'credentials_rejected',
      verdict: 'INCONCLUSIVE',
    })
    expect(appwrite.observations.find(x => x.case === 'auth-B')).toMatchObject({
      status: 401,
      authCategory: 'unclassified_auth_failure',
      verdict: 'INCONCLUSIVE',
    })
    expect(appwrite.observations.find(x => x.case === 'auth-B')?.type).toBeUndefined()

    const report: ProbeReport = {
      schema: 1,
      startedAt: 'start',
      checkpointAt: 'start',
      state: 'complete',
      source: { head: 'head', dirty: true, scriptSha256: 'script', testSha256: 'test' },
      projects: { firebase: 'tao-hosted-crud-79c429', appwrite: 'tao-hosted-crud-160214' },
      firebase,
      appwrite,
    }
    const summary = authSummaryLines(report)
    expect(summary).toContain('firebase auth-A: HTTP 400; credentials rejected (INVALID_LOGIN_CREDENTIALS)')
    expect(summary).toContain('appwrite auth-A: HTTP 401; credentials rejected (user_invalid_credentials)')
    expect(summary.at(-1)).toBe(
      'Use two existing accounts for each provider. Firebase and Appwrite accounts are separate.',
    )
    const persisted = JSON.stringify(report) + summary.join('\n')
    expect(persisted).not.toContain(accounts.a.password)
    expect(persisted).not.toContain(accounts.b.password)
    expect(persisted).not.toContain('raw-token')
  })

  test('Appwrite login without a session cookie stays inconclusive and makes no row call', async () => {
    const urls: string[] = []
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url))
      expect(init?.redirect).toBe('error')
      return Response.json({ secret: accounts.b.password, $id: 'session-id' })
    }) as typeof fetch
    const evidence = await runAppwrite(fetcher, accounts)
    expect(evidence.observations.every(x => x.verdict === 'INCONCLUSIVE')).toBe(true)
    expect(urls).toHaveLength(2)
    expect(urls.every(url => url.endsWith('/account/sessions/email'))).toBe(true)
    expect(JSON.stringify(evidence)).not.toContain(accounts.b.password)
  })

  test('partial Appwrite authentication removes the session that was created', async () => {
    const calls: string[] = []
    let logins = 0
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      calls.push(`${init?.method} ${path}`)
      if (path.endsWith('/account/sessions/email')) {
        logins++
        return logins === 1
          ? Response.json({}, {
            status: 201,
            headers: { 'set-cookie': 'a_session_tao-hosted-crud-160214=cookie-A; Path=/' },
          })
          : Response.json({ code: 401 }, { status: 401 })
      }
      if (path.endsWith('/account')) {
        return Response.json({ $id: 'user-A' })
      }
      if (path.endsWith('/account/sessions/current')) {
        return new Response(null, { status: 204 })
      }
      return Response.json({ code: 500 }, { status: 500 })
    }) as typeof fetch
    const evidence = await runAppwrite(fetcher, accounts)
    expect(calls).toContain('DELETE /v1/account/sessions/current')
    expect(calls.some(call => call.includes('/tablesdb/'))).toBe(false)
    expect(evidence.observations.find(x => x.case === 'session-delete-A')?.verdict).toBe('PASS')
  })

  test('Appwrite list leak, owner transfer, and B read after explicit grant are separate findings', async () => {
    type Row = {
      $id: string
      ownerId: string
      text: string
      done: boolean
      updatedAt: number
      $permissions: string[]
      creator: string
    }
    const rows = new Map<string, Row>()
    let maskListRows = false
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const address = new URL(String(url))
      const path = address.pathname
      const method = init?.method ?? 'GET'
      const cookie = (init?.headers as Record<string, string> | undefined)?.Cookie ?? ''
      const user = cookie.includes('cookie-A') ? 'user-A' : 'user-B'
      const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      const deny = () => Response.json({ type: 'user_unauthorized', code: 404, message: 'cookie-A' }, { status: 404 })
      if (path.endsWith('/account/sessions/email')) {
        const body = payload as { email: string }
        const suffix = body.email.startsWith('a@') ? 'A' : 'B'
        return Response.json({}, {
          status: 201,
          headers: { 'set-cookie': `a_session_tao-hosted-crud-160214=cookie-${suffix}; Path=/` },
        })
      }
      if (path.endsWith('/account')) {
        return Response.json({ $id: user })
      }
      if (path.endsWith('/account/sessions/current')) {
        return new Response(null, { status: 204 })
      }
      const rowId = path.split('/rows/')[1]
      const data = payload.data as Partial<Row> | undefined
      if (method === 'POST') {
        const id = payload.rowId as string
        expect(id.length).toBeLessThanOrEqual(36)
        if (data?.ownerId !== user) {
          return deny()
        }
        const row: Row = {
          $id: id,
          ownerId: user,
          text: data.text ?? '',
          done: false,
          updatedAt: 1,
          $permissions: payload.permissions as string[]
            ?? [`read("user:${user}")`, `update("user:${user}")`, `delete("user:${user}")`],
          creator: user,
        }
        rows.set(id, row)
        return Response.json(row, { status: 201 })
      }
      if (!rowId) {
        const query = JSON.parse(address.searchParams.get('queries[0]') ?? '{}') as { values?: string[] }
        const target = rows.get(query.values?.[0] ?? '')
        // Simulate a list leak that rewrites ownerId; the known ID must still expose it.
        const visible = target && (target.creator === user || target.text === 'probe-A-updated')
        const masked = visible && user === 'user-B' && maskListRows
        return Response.json({ rows: visible && !masked ? [{ ...target, ownerId: user }] : [], total: visible ? 1 : 0 })
      }
      const row = rows.get(rowId)
      if (!row) {
        return deny()
      }
      const mayRead = row.creator === user || row.$permissions.includes('read("any")')
        || row.$permissions.includes(`read("user:${user}")`)
      if (method === 'GET') {
        return mayRead ? Response.json(row) : deny()
      }
      if (row.creator !== user) {
        return deny()
      }
      if (method === 'PATCH') {
        const changed = { ...row, ...data, $permissions: payload.permissions as string[] ?? row.$permissions }
        rows.set(rowId, changed)
        return Response.json(changed)
      }
      rows.delete(rowId)
      return new Response(null, { status: 204 })
    }) as typeof fetch
    const evidence = await runAppwrite(fetcher, accounts)
    expect(evidence.observations.find(x => x.case === 'foreign-list-by-id')?.verdict).toBe('FAIL')
    expect(evidence.observations.find(x => x.case === 'forged-ownerId-transfer')?.verdict).toBe('FAIL')
    expect(evidence.observations.find(x => x.case === 'permission-create-any-B-read')).toMatchObject({
      status: 200,
      verdict: 'FINDING',
    })
    expect(evidence.observations.find(x => x.case === 'permission-update-user:user-B-B-read')).toMatchObject({
      status: 200,
      verdict: 'FINDING',
    })
    expect(JSON.stringify(evidence)).not.toContain('cookie-A')
    expect(JSON.stringify(evidence)).not.toContain(accounts.a.password)
    maskListRows = true
    const maskedEvidence = await runAppwrite(fetcher, accounts)
    expect(maskedEvidence.observations.find(x => x.case === 'foreign-list-by-id')).toMatchObject({
      status: 200,
      verdict: 'FAIL',
    })
  })

  test('completed Firebase checkpoint survives interruption in Appwrite', async () => {
    const firebase = {
      provider: 'firebase' as const,
      projectId: 'tao-hosted-crud-79c429',
      startedAt: 'start',
      observations: [{ case: 'create-A', expected: '2xx', actual: 'HTTP 200', verdict: 'PASS' as const }],
      leftoverIds: ['fixture-A'],
      cleanup: [{ id: 'fixture-A', status: 'tombstone retained' }],
    }
    const report: ProbeReport = {
      schema: 1,
      startedAt: 'start',
      checkpointAt: 'start',
      state: 'prepared',
      projects: { firebase: 'tao-hosted-crud-79c429', appwrite: 'tao-hosted-crud-160214' },
      source: { head: 'revision', dirty: true, scriptSha256: 'script-hash', testSha256: 'test-hash' },
    }
    const saved: ProbeReport[] = []
    await runProviderSequence(report, {
      firebase: async () => firebase,
      appwrite: async () => Promise.reject('raw-secret-error'),
    }, async current => {
      saved.push(JSON.parse(JSON.stringify(current)) as ProbeReport)
    })
    expect(saved.map(entry => entry.state)).toEqual(['prepared', 'firebase-complete', 'interrupted'])
    expect(saved[1]?.firebase?.leftoverIds).toEqual(['fixture-A'])
    expect(saved.at(-1)?.firebase?.cleanup).toEqual([{ id: 'fixture-A', status: 'tombstone retained' }])
    expect(saved.at(-1)?.interruptedProvider).toBe('appwrite')
    expect(JSON.stringify(saved)).not.toContain('raw-secret-error')
  })

  test('--help does not prompt or call a provider', async () => {
    expect(await main(['--help'])).toBe(0)
  })
})
