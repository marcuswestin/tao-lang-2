import { Expect, Test } from '@shared/test'
import { withClerkInstant } from '../studio-smoke/clerk-instant'

Test('Clerk browser acceptance uses its reference store only when Instant is unconfigured', async () => {
  let called = false
  await withClerkInstant(undefined, async fixture => {
    called = true
    Expect(fixture).toBeUndefined()
  })
  Expect(called).toBe(true)
})

Test('configured invalid Instant endpoints fail before running the Clerk browser journey', async () => {
  for (
    const endpoint of [
      '',
      'https://localhost:9020',
      'http://remote.example:9020',
      'http://user:secret@localhost:9020',
      'http://localhost:9020/path',
      'http://localhost:9020?token=secret',
      'http://localhost:9020#secret',
    ]
  ) {
    let called = false
    await Expect(withClerkInstant(endpoint, async () => {
      called = true
    })).rejects.toThrow('TAO_INSTANT_LIVE_API_URL requires a localhost HTTP origin without credentials.')
    Expect(called).toBe(false)
  }
})
