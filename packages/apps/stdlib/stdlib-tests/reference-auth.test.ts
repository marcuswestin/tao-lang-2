import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import { referenceAuthentication, type ReferenceAuthHost } from '../@tao/data/providers/reference/ReferenceAuth'

const signal = () => new AbortController().signal
const target = { resource: 'notes', serverURL: 'https://gateway.test' }
const issuer = 'https://clerk.test'
const token = 'a'.repeat(96)
const otherToken = 'b'.repeat(96)
const gatewaySession = (subject = 'alice', value = token, expiresAt = 61_000) => ({
  accountId: `account-${subject}`,
  issuer,
  subject,
  resource: 'notes',
  token: value,
  expiresAt,
})

type Issue = (kind: TR.AuthProofKind, signal: AbortSignal) => Promise<TR.AuthIssuedProof>

function fixture(provider = 'Clerk') {
  let now = 1_000
  const calls: Array<{ url: string; options?: RequestInit }> = []
  const timers: Array<{ job: () => void; delay: number; cancelled: boolean }> = []
  const lifetime = new AbortController()
  const proofs: TR.AuthProofKind[] = []
  const transport = {
    respond: async (url: string, _options?: RequestInit): Promise<Response> =>
      Response.json(url.endsWith('/exchange') ? gatewaySession() : {}),
  }
  const issuing: { issue: Issue } = {
    issue: async kind => ({ kind: 'IdentityToken', issuer, subject: 'alice', token: `clerk-${kind}` }),
  }
  const host: ReferenceAuthHost = {
    now: () => now,
    request: (async (input, options) => {
      const url = String(input)
      calls.push({ url, ...(options === undefined ? {} : { options }) })
      return await transport.respond(url, options)
    }) as ReferenceAuthHost['request'],
    schedule: (job, delay) => {
      const timer = { job, delay, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  }
  const context: TR.DataAuthenticationContext = {
    configuration: {},
    schema: { name: 'Notes', entities: {} },
    principal: { issuer, subject: 'alice' },
    provider,
    proof: (async (kind: TR.AuthProofKind, requestSignal: AbortSignal) => {
      proofs.push(kind)
      return { ...await issuing.issue(kind, requestSignal), provider }
    }) as TR.DataAuthenticationContext['proof'],
    signal: lifetime.signal,
  }
  return {
    calls,
    context,
    issuing,
    lifetime,
    proofs,
    timers,
    transport,
    authenticate: () => referenceAuthentication(host, context, target),
    authorization: (index: number) => new Headers(calls[index]!.options?.headers).get('Authorization'),
    revoked: () =>
      calls.filter(call => call.url.endsWith('/v1/auth/sign-out')).map(call =>
        new Headers(call.options?.headers).get('Authorization')
      ),
    setNow: (value: number) => {
      now = value
    },
  }
}

Describe('Reference account resolution', () => {
  Test('exchanges only the Clerk identity token and resource for a gateway session it brokers', async () => {
    const f = fixture()
    const authentication = await f.authenticate()
    Expect(authentication.accountId).toBe('account-alice')
    Expect(f.calls).toHaveLength(1)
    Expect(f.calls[0]!.url).toBe('https://gateway.test/v1/auth/clerk/exchange')
    Expect(f.authorization(0)).toBe('Bearer clerk-IdentityToken')
    Expect(JSON.parse(String(f.calls[0]!.options?.body))).toEqual({ resource: 'notes' })
    // The second proof confirms Clerk still signs this principal in after the exchange.
    Expect(f.proofs).toEqual(['IdentityToken', 'IdentityToken'])
    Expect(await authentication.credential!(signal())).toBe(token)
    Expect(f.timers.map(timer => timer.delay)).toEqual([50_000])
  })

  Test('refuses gateway sessions for another subject or resource, expired sessions, and malformed tokens', async () => {
    for (
      const invalid of [
        { ...gatewaySession(), subject: 'bob' },
        { ...gatewaySession(), resource: 'other' },
        { ...gatewaySession(), expiresAt: 1_000 },
        { ...gatewaySession(), token: 'not-a-gateway-token' },
      ]
    ) {
      const f = fixture()
      f.transport.respond = async () => Response.json(invalid)
      await Expect(f.authenticate()).rejects.toThrow('invalid Clerk session')
      Expect(f.revoked()).toEqual([])
    }
    const refused = fixture()
    refused.transport.respond = async () => Response.json({}, { status: 401 })
    await Expect(refused.authenticate()).rejects.toThrow('could not authorize')
  })

  Test('a sign-out elsewhere during the exchange revokes the returned gateway session', async () => {
    const f = fixture()
    let proofs = 0
    f.issuing.issue = async () => {
      proofs += 1
      if (proofs === 2) {
        Errors.throwUserInput('Finish signing out before using this Clerk session again.')
      }
      return { kind: 'IdentityToken', issuer, subject: 'alice', token: 'clerk-alice' }
    }
    await Expect(f.authenticate()).rejects.toThrow('Finish signing out')
    await until(() => f.revoked().length === 1)
    Expect(f.revoked()).toEqual([`Bearer ${token}`])
  })

  Test('ending the account lifetime during a delayed exchange revokes its session without resolving', async () => {
    const f = fixture()
    const pending = Deferred<Response>()
    f.transport.respond = async url => url.endsWith('/exchange') ? pending.promise : Response.json({})
    const resolving = f.authenticate()
    await until(() => f.calls.length === 1)
    f.lifetime.abort()
    pending.resolve(Response.json(gatewaySession()))
    await Expect(resolving).rejects.toThrow('cancelled')
    await until(() => f.revoked().length === 1)
    Expect(f.revoked()).toEqual([`Bearer ${token}`])
  })

  Test('refreshes before expiry, retires the replaced session, and cancels its refresh timer', async () => {
    const f = fixture()
    const authentication = await f.authenticate()
    const refresh = f.timers[0]!
    f.transport.respond = async url =>
      Response.json(url.endsWith('/exchange') ? gatewaySession('alice', otherToken, 120_000) : {})
    f.setNow(51_000)
    refresh.job()
    await until(() => f.revoked().length === 1)
    Expect(f.revoked()).toEqual([`Bearer ${token}`])
    Expect(await authentication.credential!(signal())).toBe(otherToken)
    // A credential request inside the final five seconds renews on demand.
    f.transport.respond = async url =>
      Response.json(url.endsWith('/exchange') ? gatewaySession('alice', token.replace(/a/g, 'c'), 200_000) : {})
    f.setNow(116_000)
    Expect(await authentication.credential!(signal())).toBe('c'.repeat(96))
    Expect(f.timers.map(timer => timer.cancelled)).toEqual([false, true, false])
    await until(() => f.revoked().length === 2)
    Expect(f.revoked()).toEqual([`Bearer ${token}`, `Bearer ${otherToken}`])
  })

  Test('a failed renewal retries once within the original expiry and then requires signing in again', async () => {
    const f = fixture()
    const authentication = await f.authenticate()
    f.transport.respond = async url =>
      url.endsWith('/exchange') ? Errors.throwHostEnvironment('offline fixture') : Response.json({})
    f.setNow(51_000)
    f.timers[0]!.job()
    await until(() => f.timers.length === 2)
    Expect(f.timers[1]!.delay).toBe(5_000)
    f.setNow(62_000)
    await Expect(authentication.credential!(signal())).rejects.toThrow('offline fixture')
  })

  Test('a refresh for a different account is refused and its session revoked', async () => {
    const f = fixture()
    const authentication = await f.authenticate()
    f.transport.respond = async url =>
      Response.json(
        url.endsWith('/exchange') ? { ...gatewaySession('alice', otherToken, 120_000), accountId: 'account-z' } : {},
      )
    f.setNow(57_000)
    await Expect(authentication.credential!(signal())).rejects.toThrow('Sign in again')
    await until(() => f.revoked().length === 1)
    Expect(f.revoked()).toEqual([`Bearer ${otherToken}`])
  })

  Test('release revokes every gateway session, keeps unconfirmed ones for the retry, and ends access', async () => {
    const f = fixture()
    let failOld = true
    const authentication = await f.authenticate()
    f.transport.respond = async (url, options) => {
      if (url.endsWith('/exchange')) {
        return Response.json(gatewaySession('alice', otherToken, 120_000))
      }
      const old = new Headers(options?.headers).get('Authorization') === `Bearer ${token}`
      return Response.json({}, { status: old && failOld ? 503 : 200 })
    }
    f.setNow(57_000)
    Expect(await authentication.credential!(signal())).toBe(otherToken)
    await until(() => f.revoked().length === 1)
    await Expect(authentication.release!(signal())).rejects.toThrow('could not confirm sign-out')
    Expect(f.revoked()).toContain(`Bearer ${otherToken}`)
    await Expect(authentication.credential!(signal())).rejects.toThrow('Sign in again')
    failOld = false
    await authentication.release!(signal())
    Expect(f.revoked().at(-1)).toBe(`Bearer ${token}`)
    Expect(f.revoked().filter(value => value === `Bearer ${otherToken}`)).toHaveLength(1)
    await authentication.release!(signal())
    Expect(f.timers.every(timer => timer.cancelled)).toBe(true)
  })

  Test('uses the LocalAuth server session directly, without network or release', async () => {
    const f = fixture('LocalAuth')
    const session = { ...gatewaySession(), issuer: 'local', subject: 'alice', expiresAt: 600_000 }
    f.issuing.issue = async () => ({ kind: 'Session', issuer: 'local', subject: 'alice', value: session })
    const authentication = await f.authenticate()
    Expect(authentication.accountId).toBe('account-alice')
    Expect(await authentication.credential!(signal())).toBe(token)
    Expect(authentication.release).toBeUndefined()
    Expect(f.proofs).toEqual(['Session', 'Session'])
    Expect(f.calls).toEqual([])
    f.issuing.issue = async () => ({
      kind: 'Session',
      issuer: 'local',
      subject: 'alice',
      value: { ...session, resource: 'other' },
    })
    await Expect(authentication.credential!(signal())).rejects.toThrow('Use the same Resource on LocalAuth')
    await Expect(f.authenticate()).rejects.toThrow('Use the same Resource on LocalAuth')
  })

  Test('refuses an auth provider it cannot sign in with', async () => {
    await Expect(fixture('TestAuth').authenticate()).rejects.toThrow(
      'Reference cannot sign in with TestAuth. Use LocalAuth or Clerk.',
    )
  })
})
