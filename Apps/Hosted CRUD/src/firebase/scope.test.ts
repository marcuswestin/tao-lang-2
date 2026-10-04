import { describe, expect, test } from 'bun:test'
import { accountDatabaseName, firestoreNotesPath } from './scope'

describe('Firebase account scope', () => {
  test('isolates SQLite files by both project and user without punctuation collisions', () => {
    expect(accountDatabaseName('project-a', 'uid.1')).toBe(
      'hostedcrud_00700072006f006a006500630074002d0061_007500690064002e0031',
    )
    expect(accountDatabaseName('project-a', 'uid.1')).not.toBe(accountDatabaseName('project-a', 'uid/1'))
    expect(accountDatabaseName('project-a', 'uid.1')).not.toBe(accountDatabaseName('project-b', 'uid.1'))
    expect(accountDatabaseName('project-a', '😀')).not.toBe(accountDatabaseName('project-a', '😁'))
    expect(accountDatabaseName('project-a', 'uid.1')).toMatch(/^[a-z0-9_]+$/)
  })

  test('replicates only the signed-in account subcollection', () => {
    expect(firestoreNotesPath('uid-123')).toBe('users/uid-123/notes')
  })
})
