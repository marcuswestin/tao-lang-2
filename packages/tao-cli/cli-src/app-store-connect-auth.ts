import { Errors, FS, Platform } from '@shared'

export type AppStoreConnectAuth = {
  issuerId: string
  keyId: string
  keyPath: string
}

/** createAppStoreConnectToken signs Apple's short-lived ES256 JWT without retaining or logging key contents. */
export async function createAppStoreConnectToken(
  auth: AppStoreConnectAuth,
  now: () => number = Date.now,
): Promise<string> {
  let keySource: string
  try {
    keySource = await FS.readText(auth.keyPath)
  } catch (error) {
    Errors.throwHostEnvironment(`Could not read the App Store Connect API key at ${auth.keyPath}.`, { cause: error })
  }
  const issuedAt = Math.floor(now() / 1_000)
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: auth.keyId, typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    aud: 'appstoreconnect-v1',
    exp: issuedAt + 19 * 60,
    iat: issuedAt,
    iss: auth.issuerId,
  }))
  const signingInput = `${header}.${payload}`
  let signature: Buffer
  try {
    signature = Platform.signES256(keySource, Buffer.from(signingInput))
  } catch (error) {
    Errors.throwUserInput(`The App Store Connect key at ${auth.keyPath} is not a valid ES256 private key.`, {
      cause: error,
    })
  }
  return `${signingInput}.${signature.toString('base64url')}`
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}
