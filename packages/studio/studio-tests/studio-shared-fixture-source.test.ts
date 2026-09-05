import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioSharedFixtureSource } from '../studio-src/StudioSharedFixtureSource'

const playlistImport = { collection: 'Playlists', entity: 'Playlist', source: '../../Data/Music' }
const accountImport = { collection: 'Accounts', entity: 'Account', source: '../../Data/Accounts' }

Describe('Studio shared fixture source', () => {
  Test('creates deterministic public Sketches source for multiple entities', async () => {
    const result = await StudioSharedFixtureSource.promote({
      imports: [playlistImport, accountImport],
      promotions: [
        {
          entity: 'Playlist',
          fields: { Owner: { handle: 'Ada', kind: 'fixture-reference' }, Title: 'Focus' },
          name: 'Focus',
        },
        { entity: 'Account', fields: { Active: true, Name: 'Ada' }, name: 'Ada' },
      ],
    })

    Expect(result.fixture).toBe('Sketches')
    Expect(result.handles).toEqual([
      { handle: 'Ada', kind: 'fixture-reference' },
      { handle: 'Focus', kind: 'fixture-reference' },
    ])
    Expect(result.source).toContain('use Accounts from ../../Data/Accounts')
    Expect(result.source).toContain('use Playlists from ../../Data/Music')
    Expect(result.source).toContain('public fixture Sketches {')
    Expect(result.source).toContain('Ada = create Account {')
    Expect(result.source).toContain('Active: true,')
    Expect(result.source).toContain('Focus = create Playlist {')
    Expect(result.source).toContain('Owner: Ada,')

    const reordered = await StudioSharedFixtureSource.promote({
      imports: [accountImport, playlistImport],
      promotions: [
        { entity: 'Account', fields: { Name: 'Ada', Active: true }, name: 'Ada' },
        {
          entity: 'Playlist',
          fields: { Title: 'Focus', Owner: { handle: 'Ada', kind: 'fixture-reference' } },
          name: 'Focus',
        },
      ],
    })
    Expect(reordered.source).toBe(result.source)
  })

  Test('extends existing imports and rows and is idempotent', async () => {
    const first = await StudioSharedFixtureSource.promote({
      imports: [accountImport],
      promotions: [{ entity: 'Account', fields: { Name: 'Ada' }, name: 'Ada' }],
    })
    const extended = await StudioSharedFixtureSource.promote({
      imports: [playlistImport],
      promotions: [{ entity: 'Playlist', fields: { Title: 'Focus' }, name: 'Focus' }],
      source: first.source,
    })
    const repeated = await StudioSharedFixtureSource.promote({
      imports: [playlistImport],
      promotions: [{ entity: 'Playlist', fields: { Title: 'Focus' }, name: 'Focus' }],
      source: extended.source,
    })

    Expect(extended.source).toContain('Ada = create Account {')
    Expect(extended.source).toContain('Name: "Ada"')
    Expect(extended.source).toContain('Focus = create Playlist {')
    Expect(extended.source).toContain('Title: "Focus"')
    Expect(repeated.source).toBe(extended.source)
  })

  Test('orders promoted rows after their fixture-handle dependencies rather than by name', async () => {
    const result = await StudioSharedFixtureSource.promote({
      imports: [accountImport],
      promotions: [
        {
          entity: 'Account',
          fields: { Owner: { handle: 'Zed', kind: 'fixture-reference' } },
          name: 'Alpha',
        },
        { entity: 'Account', fields: { Name: 'Zed' }, name: 'Zed' },
      ],
    })

    Expect(result.source.indexOf('Zed = create Account')).toBeLessThan(
      result.source.indexOf('Alpha = create Account'),
    )
    Expect(result.handles).toEqual([
      { handle: 'Zed', kind: 'fixture-reference' },
      { handle: 'Alpha', kind: 'fixture-reference' },
    ])
  })

  Test('rejects missing and cyclic promotion dependencies before producing source', async () => {
    const missing = StudioSharedFixtureSource.promote({
      imports: [accountImport],
      promotions: [{
        entity: 'Account',
        fields: { Owner: { handle: 'Missing', kind: 'fixture-reference' } },
        name: 'Alpha',
      }],
    })
    await Expect(missing).rejects.toBeInstanceOf(Errors.UserInputError)
    await Expect(missing).rejects.toThrow('Alpha references an unknown fixture handle: Missing')

    const cyclic = StudioSharedFixtureSource.promote({
      imports: [accountImport],
      promotions: [
        {
          entity: 'Account',
          fields: { Owner: { handle: 'Zed', kind: 'fixture-reference' } },
          name: 'Alpha',
        },
        {
          entity: 'Account',
          fields: { Owner: { handle: 'Alpha', kind: 'fixture-reference' } },
          name: 'Zed',
        },
      ],
    })
    await Expect(cyclic).rejects.toBeInstanceOf(Errors.UserInputError)
    await Expect(cyclic).rejects.toThrow('dependencies form a cycle: Alpha, Zed')
  })

  Test('rejects a same-name row with different content', async () => {
    const first = await StudioSharedFixtureSource.promote({
      imports: [playlistImport],
      promotions: [{ entity: 'Playlist', fields: { Title: 'Focus' }, name: 'Featured' }],
    })

    await Expect(StudioSharedFixtureSource.promote({
      imports: [playlistImport],
      promotions: [{ entity: 'Playlist', fields: { Title: 'Different' }, name: 'Featured' }],
      source: first.source,
    })).rejects.toThrow('already has different content: Featured')
  })

  Test('serializes strings, time, numbers, booleans, and fixture references safely', async () => {
    const result = await StudioSharedFixtureSource.promote({
      imports: [playlistImport],
      promotions: [
        { entity: 'Playlist', fields: { Title: 'Owner' }, name: 'Ada' },
        {
          entity: 'Playlist',
          fields: {
            Active: false,
            Count: 12.5,
            CreatedAt: { kind: 'now' },
            Owner: { handle: 'Ada', kind: 'fixture-reference' },
            Title: 'Quote " slash \\ line\nemoji 😀',
          },
          name: 'Escaped',
        },
      ],
    })

    Expect(result.source).toContain('Active: false')
    Expect(result.source).toContain('Count: 12.5')
    Expect(result.source).toContain('CreatedAt: now')
    Expect(result.source).toContain('Owner: Ada')
    Expect(result.source).toContain('Title: "Quote \\" slash \\\\ line\\nemoji \\ud83d\\ude00"')

    const repeated = await StudioSharedFixtureSource.promote({
      imports: [playlistImport],
      promotions: [
        { entity: 'Playlist', fields: { Title: 'Owner' }, name: 'Ada' },
        {
          entity: 'Playlist',
          fields: {
            Active: false,
            Count: 12.5,
            CreatedAt: { kind: 'now' },
            Owner: { handle: 'Ada', kind: 'fixture-reference' },
            Title: 'Quote " slash \\ line\nemoji 😀',
          },
          name: 'Escaped',
        },
      ],
      source: result.source,
    })
    Expect(repeated.source).toBe(result.source)
  })
})
