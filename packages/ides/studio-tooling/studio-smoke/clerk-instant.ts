import { Errors } from '@shared'
import { Expect } from '@shared/test'
import { instantAppFixture } from '../../../services/account-server/account-server-tests/fixtures/instant-app'

export type ClerkInstantFixture = Parameters<Parameters<typeof instantAppFixture>[1]>[0]

/** A configured endpoint must select Instant, including when it is malformed or unavailable. */
export async function withClerkInstant(
  apiURI: string | undefined,
  run: (fixture: ClerkInstantFixture | undefined) => Promise<void>,
): Promise<void> {
  if (apiURI === undefined) {
    await run(undefined)
    return
  }
  const endpoint = URL.parse(apiURI)
  if (
    endpoint === null || endpoint.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username !== '' || endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== ''
    || endpoint.pathname !== '/'
  ) {
    Errors.throwUserInput('TAO_INSTANT_LIVE_API_URL requires a localhost HTTP origin without credentials.')
  }
  let browserFailure: unknown
  try {
    await instantAppFixture(endpoint.origin, async fixture => {
      try {
        await run(fixture)
      } catch (error) {
        browserFailure = error
        throw error
      }
    })
  } catch {
    if (browserFailure !== undefined) {
      // The browser journey already emits only its stage and bounded public error codes.
      throw browserFailure
    }
    // Fixture/setup errors must never serialize Instant credentials or response bodies.
    Errors.throwHostEnvironment(
      'Clerk with Instant acceptance failed while preparing or cleaning up its ephemeral app.',
    )
  }
}

/** Query the service directly; a SQLite fallback cannot satisfy these assertions. */
export async function assertClerkInstantData(
  fixture: ClerkInstantFixture,
  bodies: string[],
  progress: (step: string) => void,
): Promise<void> {
  const accountNamespace = 'taoAccountRow_7e1b0d5641f2640c'
  const noteNamespace = 'taoAccountRow_d8da2c49df39d91d'
  const query = { [accountNamespace]: {}, [noteNamespace]: {} }
  const data = await fixture.query(query)
  const accounts = data[accountNamespace]!
  const notes = data[noteNamespace]!
  progress(`Instant account count (${accounts.length})`)
  Expect(accounts).toHaveLength(1)
  progress('Instant profile fields')
  Expect(accounts[0]!['fields']).toEqual({ DisplayName: 'Clerk browser account' })
  progress(`Instant note count (${notes.length})`)
  Expect(notes).toHaveLength(bodies.length)
  progress('Instant note contents and ownership')
  Expect(notes.map(row => row['fields'])).toEqual(
    Expect['arrayContaining'](bodies.map(Body => Expect['objectContaining']({ Owner: accounts[0]!['taoId'], Body }))),
  )
  const guest = await fixture.admin('/admin/query', { query }, true)
  progress(`Instant direct guest response (HTTP ${guest.status})`)
  Expect(guest.status).toBe(200)
  const denied = await guest.json() as Record<string, unknown>
  progress('Instant direct guest account isolation')
  Expect(denied[accountNamespace]).toEqual([])
  progress('Instant direct guest note isolation')
  Expect(denied[noteNamespace]).toEqual([])
}
