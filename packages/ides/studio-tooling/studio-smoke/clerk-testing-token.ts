import { Errors } from '@shared'

/** Only explicitly opted-in development instances may create disposable remote users. */
export function clerkLiveConfiguration(env: Readonly<Record<string, string | undefined>>) {
  if (env['TAO_CLERK_LIVE'] !== '1') {
    return undefined
  }
  const required = ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_KEY'] as const
  for (const name of required) {
    if (!env[name]?.trim()) {
      Errors.throwUserInput(`TAO_CLERK_LIVE requires ${name}.`)
    }
  }
  const publishableKey = env['CLERK_PUBLISHABLE_KEY']!
  const secretKey = env['CLERK_SECRET_KEY']!
  if (!publishableKey.startsWith('pk_test_') || !secretKey.startsWith('sk_test_')) {
    Errors.throwUserInput('The Clerk live journey requires development instance keys.')
  }
  const decoded = Buffer.from(publishableKey.slice('pk_test_'.length), 'base64').toString('utf8')
  const host = decoded.endsWith('$') ? decoded.slice(0, -1) : ''
  if (!/^[a-z0-9-]+\.clerk\.accounts\.dev$/.test(host)) {
    Errors.throwUserInput('The Clerk live journey requires a development Frontend API publishable key.')
  }
  return { issuer: `https://${host}`, jwtKey: env['CLERK_JWT_KEY']!, publishableKey, secretKey }
}

/**
 * Clerk documents this query parameter for custom browser harnesses. It bypasses bot detection,
 * while password and email-code verification still run through the real SDK and Frontend API.
 * https://clerk.com/docs/guides/development/testing/overview
 */
export function clerkTestingTokenScript(issuer: string, token: string): string {
  return `(${installTestingFetch.toString()})(globalThis, ${JSON.stringify(issuer)}, ${JSON.stringify(token)})`
}

function installTestingFetch(
  // This function is serialized into Chrome. Describe only its browser boundary instead of using
  // the host's merged Bun/React Native RequestInit declarations, which have incompatible bodies.
  target: {
    fetch: (input: string | URL | { readonly url: string }, init?: unknown) => Promise<unknown>
    location: { href: string }
    Request: new(url: string, original: { readonly url: string }) => { readonly url: string }
  },
  issuer: string,
  token: string,
): void {
  const original = target.fetch.bind(target)
  target.fetch = (input, init) => {
    const request = input instanceof target.Request ? input : undefined
    const url = new URL(request?.url ?? String(input), target.location.href)
    if (url.origin !== issuer || !url.pathname.startsWith('/v1/')) {
      return original(input, init)
    }
    url.searchParams.set('__clerk_testing_token', token)
    return original(request ? new target.Request(url.toString(), request) : url.toString(), init)
  }
}
