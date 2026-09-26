import { Errors, Json, SecretsFile } from '@shared'

const clerkCredentialNames = ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_KEY'] as const

/** SDK messages and metadata can contain credentials; emit only status and bounded API error codes. */
export function clerkFailureSummary(error: unknown): string {
  if (!Json.isRecord(error)) {
    return ''
  }
  const status = typeof error['status'] === 'number' && Number.isInteger(error['status'])
      && error['status'] >= 400 && error['status'] <= 599
    ? ` HTTP ${error['status']}.`
    : ''
  const publicCode =
    /^(?:form|identification|user|password|api|authentication|authorization|resource|request|rate|not_allowed)_[a-z_]{1,80}$/
  const codes = Array.isArray(error['errors'])
    ? error['errors'].flatMap(item =>
      Json.isRecord(item) && typeof item['code'] === 'string'
        && publicCode.test(item['code'])
        ? [item['code']]
        : []
    )
    : []
  const knownFields = [
    'first_name',
    'last_name',
    'username',
    'email_address',
    'phone_number',
    'password',
    'legal_accepted_at',
  ]
  const fields = Array.isArray(error['errors'])
    ? error['errors'].flatMap(item => {
      if (!Json.isRecord(item) || item['code'] !== 'form_data_missing') {
        return []
      }
      const message = typeof item['longMessage'] === 'string' ? item['longMessage'] : ''
      return knownFields.filter(field => message.includes(field))
    })
    : []
  return `${status}${codes.length > 0 ? ` Clerk codes: ${[...new Set(codes)].join(', ')}.` : ''}${
    fields.length > 0 ? ` Required fields: ${[...new Set(fields)].join(', ')}.` : ''
  }`
}

/** Stored credentials stay local to the opted-in journey, never in the inherited process environment. */
export async function loadClerkLiveConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  readSecrets = SecretsFile.readDecryptedSecrets,
) {
  if (env['TAO_CLERK_LIVE'] !== '1') {
    return undefined
  }
  const stored = clerkCredentialNames.every(name => env[name] !== undefined) ? {} : await readSecrets()
  return clerkLiveConfiguration({
    TAO_CLERK_LIVE: '1',
    ...Object.fromEntries(clerkCredentialNames.map(name => [name, env[name] ?? stored[name]])),
  })
}

/** Only explicitly opted-in development instances may create disposable remote users. */
export function clerkLiveConfiguration(env: Readonly<Record<string, string | undefined>>) {
  if (env['TAO_CLERK_LIVE'] !== '1') {
    return undefined
  }
  for (const name of clerkCredentialNames) {
    if (!env[name]?.trim()) {
      Errors.throwUserInput(
        `TAO_CLERK_LIVE requires ${name}. Set it in the environment or store it with just secrets add ${name}, then run just secrets.`,
      )
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

/** CLI merges overrides with the parent environment; explicit undefined removes inherited Clerk keys. */
export function clerkChildEnvironment(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, key.startsWith('CLERK_') ? undefined : value]),
  )
}
