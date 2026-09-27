import { verifyToken } from '@clerk/backend'
import { Errors } from '@shared'
import { rejectAccountRequest } from './AccountPolicy'

/** Only trusted deployment configuration selects the issuer and verification key. */
export type ClerkAccountOptions = {
  issuer: string
  jwtKey: string
  authorizedParties: readonly string[]
  audience?: string | readonly string[]
  allowMissingAuthorizedPartyWithoutOrigin?: boolean
}

export function validateClerkAccountOptions(options: ClerkAccountOptions): void {
  let issuer: URL
  try {
    issuer = new URL(options.issuer)
  } catch {
    return Errors.throwUserInput('Clerk requires a trusted HTTPS issuer origin.')
  }
  if (issuer.protocol !== 'https:' || issuer.origin !== options.issuer) {
    Errors.throwUserInput('Clerk requires a trusted HTTPS issuer origin.')
  }
  if (
    typeof options.jwtKey !== 'string' || !options.jwtKey.trim()
    || !Array.isArray(options.authorizedParties) || options.authorizedParties.length === 0
    || options.authorizedParties.some(party => typeof party !== 'string' || !party.trim())
  ) {
    Errors.throwUserInput('Clerk requires a trusted public key and authorized parties.')
  }
  const audiences = typeof options.audience === 'string' ? [options.audience] : options.audience
  if (
    audiences !== undefined
    && (!Array.isArray(audiences) || audiences.length === 0
      || audiences.some(value => typeof value !== 'string' || !value.trim()))
  ) {
    Errors.throwUserInput('Clerk audience must contain nonempty text.')
  }
  if (
    options.allowMissingAuthorizedPartyWithoutOrigin !== undefined
    && typeof options.allowMissingAuthorizedPartyWithoutOrigin !== 'boolean'
  ) {
    Errors.throwUserInput('Clerk allowMissingAuthorizedPartyWithoutOrigin must be a boolean.')
  }
}

/** Verify real session proof before converting the provider identity to a local Account. */
export async function clerkAccountIdentity(
  token: string,
  options: ClerkAccountOptions,
  now: () => number,
  requestContext: { hasOrigin: boolean },
): Promise<{
  issuer: string
  subject: string
  expiresAt: number
}> {
  const allowMissingAuthorizedParty = options.allowMissingAuthorizedPartyWithoutOrigin === true
    && !requestContext.hasOrigin
  let claims: Awaited<ReturnType<typeof verifyToken>>
  try {
    claims = await verifyToken(token, {
      jwtKey: options.jwtKey,
      // The provider verifier requires azp when this list is set. Native requests use the
      // verified-claims check below so an existing azp still cannot bypass the allowlist.
      authorizedParties: allowMissingAuthorizedParty ? undefined : [...options.authorizedParties],
      audience: typeof options.audience === 'string' ? options.audience : options.audience && [...options.audience],
      clockSkewInMs: 0,
    })
  } catch {
    return rejectAccountRequest('unauthorized', 'The Clerk session was not accepted.')
  }
  const factors: unknown = claims.fva
  const status: unknown = claims.sts
  const audiences = typeof options.audience === 'string' ? [options.audience] : options.audience
  const tokenAudiences = typeof claims['aud'] === 'string' ? [claims['aud']] : claims['aud']
  // Only the server's HTTP request context can enable this native-session exception.
  const authorizedParty = typeof claims.azp === 'string'
    ? options.authorizedParties.includes(claims.azp)
    : claims.azp === undefined && allowMissingAuthorizedParty
  if (
    claims.iss !== options.issuer
    || typeof claims.sub !== 'string' || !claims.sub.trim()
    || typeof claims.sid !== 'string' || !claims.sid.trim()
    || !authorizedParty
    || (audiences !== undefined
      && (!Array.isArray(tokenAudiences) || !audiences.some(value => tokenAudiences.includes(value))))
    || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.exp * 1000)
    || claims.exp * 1000 <= now()
    || (status !== undefined && status !== 'active')
    || (claims.v === 2 && factors === undefined)
    || (factors !== undefined && (
      !Array.isArray(factors) || factors.length !== 2
      || !Number.isSafeInteger(factors[0]) || factors[0] < 0
      || !Number.isSafeInteger(factors[1]) || factors[1] < -1
    ))
  ) {
    rejectAccountRequest('unauthorized', 'The Clerk session was not accepted.')
  }
  // Clerk issues active session tokens only after required sign-in factors complete. A second
  // factor age of -1 also represents accounts without MFA and is not itself an incomplete login.
  return { issuer: claims.iss, subject: claims.sub, expiresAt: claims.exp * 1000 }
}
