import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { generateKeyPairSync, verify } from 'node:crypto'
import { createAppStoreConnectToken } from '../cli-src/app-store-connect-auth'

Describe('App Store Connect authentication', () => {
  Test('creates a short-lived ES256 token carrying only Apple identifiers', async () => {
    const root = await mkTestDir('tao-asc-auth-')
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const keyPath = FS.resolvePath('AuthKey_KEY123.p8', root)
      await FS.writeText(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString())
      const token = await createAppStoreConnectToken({
        issuerId: 'issuer-123',
        keyId: 'KEY123',
        keyPath,
      }, () => Date.parse('2026-09-02T14:05:00Z'))
      const [header, payload, signature] = token.split('.') as [string, string, string]
      Expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
        alg: 'ES256',
        kid: 'KEY123',
        typ: 'JWT',
      })
      Expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
        aud: 'appstoreconnect-v1',
        exp: 1788359040,
        iat: 1788357900,
        iss: 'issuer-123',
      })
      Expect(verify('sha256', Buffer.from(`${header}.${payload}`), {
        dsaEncoding: 'ieee-p1363',
        key: publicKey,
      }, Buffer.from(signature, 'base64url'))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })
})
