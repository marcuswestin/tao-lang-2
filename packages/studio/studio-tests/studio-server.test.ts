import { Describe, Expect, Test } from '@shared/test'
import { StudioServerTesting } from '../studio-src/StudioServer'

Describe('Studio server request boundary', () => {
  const boundOrigin = 'http://127.0.0.1:5678'

  Test('rejects a rebinding Host even when Origin agrees with the hostile host', () => {
    const requestUrl = new URL('http://hostile.example:5678/api/files')
    const request = new Request(requestUrl, { headers: { origin: requestUrl.origin } })

    Expect(StudioServerTesting.requestAllowed(request, requestUrl, boundOrigin, undefined)).toBe(false)
  })

  Test('accepts the bound origin and explicitly configured preview origins', () => {
    const requestUrl = new URL(`${boundOrigin}/api/files`)
    const sameOrigin = new Request(requestUrl, { headers: { origin: boundOrigin } })
    const previewOrigin = new Request(requestUrl, { headers: { origin: 'http://127.0.0.1:8081' } })

    Expect(StudioServerTesting.requestAllowed(sameOrigin, requestUrl, boundOrigin, undefined)).toBe(true)
    Expect(StudioServerTesting.requestAllowed(
      previewOrigin,
      requestUrl,
      boundOrigin,
      ['http://127.0.0.1:8081'],
    )).toBe(true)
  })

  Test('formats IPv4 and IPv6 bound origins without trusting the request Host', () => {
    Expect(StudioServerTesting.serverOrigin('http:', '127.0.0.1', 5678)).toBe(boundOrigin)
    Expect(StudioServerTesting.serverOrigin('http:', '::1', 5678)).toBe('http://[::1]:5678')
  })
})
