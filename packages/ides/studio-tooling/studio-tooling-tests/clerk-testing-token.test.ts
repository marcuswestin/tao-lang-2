import { CLI, Platform } from '@shared'
import { Expect, Test } from '@shared/test'
import { clerkLiveConfiguration, clerkTestingTokenScript } from '../studio-smoke/clerk-testing-token'
import { StudioCdp, type StudioCdpTransport } from '../studio-tooling-src/StudioCdp'

Test('Clerk browser setup is opt-in, requires all keys, and rejects production instances', () => {
  Expect(clerkLiveConfiguration({})).toBeUndefined()
  Expect(() => clerkLiveConfiguration({ TAO_CLERK_LIVE: '1' })).toThrow('CLERK_PUBLISHABLE_KEY')
  const env = {
    TAO_CLERK_LIVE: '1',
    CLERK_PUBLISHABLE_KEY: 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk',
    CLERK_SECRET_KEY: 'sk_test_synthetic',
    CLERK_JWT_KEY: 'synthetic-public-key',
  }
  Expect(clerkLiveConfiguration(env)?.issuer).toBe('https://example.clerk.accounts.dev')
  Expect(() => clerkLiveConfiguration({ ...env, CLERK_SECRET_KEY: '' })).toThrow('CLERK_SECRET_KEY')
  Expect(() => clerkLiveConfiguration({ ...env, CLERK_JWT_KEY: '' })).toThrow('CLERK_JWT_KEY')
  Expect(() => clerkLiveConfiguration({ ...env, CLERK_PUBLISHABLE_KEY: 'pk_live_synthetic' })).toThrow('development')
  Expect(() => clerkLiveConfiguration({ ...env, CLERK_PUBLISHABLE_KEY: 'pk_test_aW52YWxpZA==' })).toThrow(
    'Frontend API',
  )
})

Test('Clerk testing token setup preserves requests and cannot leak to another origin or path', async () => {
  const excluded = [
    'https://example.clerk.accounts.dev.evil.test/v1/client',
    'https://other.clerk.accounts.dev/v1/client',
    'http://example.clerk.accounts.dev/v1/client',
    'https://example.clerk.accounts.dev/npm/sdk.js',
    'http://127.0.0.1:4000/v1/data',
  ]
  const script = `
    const requests = []
    globalThis.location = { href: 'http://127.0.0.1:4000/' }
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push({ url: request.url, method: request.method, body: await request.text(),
        contentType: request.headers.get('content-type'), credentials: request.credentials })
      return new Response('ok')
    }
    ${clerkTestingTokenScript('https://example.clerk.accounts.dev', 'synthetic-token')}
    await fetch(new Request('https://example.clerk.accounts.dev/v1/client/sign_ins?other=kept', {
      method: 'POST', body: 'synthetic-password', headers: { 'content-type': 'text/plain' }, credentials: 'include',
    }))
    for (const url of ${JSON.stringify(excluded)}) await fetch(url)
    await fetch('https://example.clerk.accounts.dev/v1/client', { method: 'POST', body: 'code=424242' })
    await Bun.write(Bun.stdout, JSON.stringify(requests))
  `
  const result = await CLI.run(Platform.runtimeProcess.execPath, { args: ['-e', script] })
  Expect(result.exitCode).toBe(0)
  const requests = JSON.parse(result.stdout) as Array<{
    url: string
    method: string
    body: string
    contentType: string | null
    credentials: string
  }>
  Expect(requests[0]).toEqual({
    url: 'https://example.clerk.accounts.dev/v1/client/sign_ins?other=kept&__clerk_testing_token=synthetic-token',
    method: 'POST',
    body: 'synthetic-password',
    contentType: 'text/plain',
    credentials: 'include',
  })
  Expect(requests.slice(1, -1).map(request => request.url)).toEqual(excluded)
  Expect(new URL(requests.at(-1)!.url).searchParams.get('__clerk_testing_token')).toBe('synthetic-token')
  Expect(requests.at(-1)!.body).toBe('code=424242')
})

Test('browser init scripts are registered in the page world before navigation', async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const transport: StudioCdpTransport = {
    async send<Result>(method: string, params?: Record<string, unknown>): Promise<Result> {
      calls.push({ method, params })
      return {} as Result
    },
    subscribe: () => () => {},
  }
  const browser = StudioCdp.testing.create(transport)
  try {
    await browser.addInitScript('globalThis.setupComplete = true')
    Expect(calls).toEqual([{
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: { source: 'globalThis.setupComplete = true' },
    }])
  } finally {
    await browser.close()
  }
})
