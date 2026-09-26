import { Describe, Expect, Test } from '@shared/test'
import { migrateRelationTraits } from '../source-actions-src/data-actions'
import SourceActions from '../source-actions-src/source-actions'
import { parseRawDocument, sourceActionOptionsFor } from './test-source-actions'

Describe('source actions: auth data syntax', () => {
  Test('moves relation traits without losing optionality, adjacent traits or comments', async () => {
    const source = `data Notes / Note {
  Owner? (relation Account),
  Other (relation Account, required "Choose one"),
  Last (required "Choose one", /* Keep, this. */ relation Account),
}`
    const migrated = migrateRelationTraits(await parseRawDocument(source))!
    Expect(migrated).toContain('Owner Account? ')
    Expect(migrated).toContain('Other Account ( required "Choose one")')
    Expect(migrated).toContain('Last Account (required "Choose one" /* Keep, this. */ )')
    Expect(migrateRelationTraits(await parseRawDocument(migrated))).toBeUndefined()
  })

  Test('fixes legacy relation spelling and canonical assigned queries idempotently', async () => {
    const document = await parseRawDocument(`
      data Accounts / Account { Notes, }
      data Notes / Note { Owner (relation Account), Body text, }
      view Home(Me Account) {
        query Notes /* source, retained */ as All
        query Mine from Me.Notes { order by Body }
      }
    `)
    const fixed = await SourceActions.fixSource(document, await sourceActionOptionsFor(document))
    Expect(fixed).toContain('Owner Account,')
    Expect(fixed).toContain('query All /* source, retained */ = Notes')
    Expect(fixed).toContain('query Mine = Me.Notes with {')
    const next = await parseRawDocument(fixed)
    Expect(await SourceActions.fixSource(next, await sourceActionOptionsFor(next))).toBe(fixed)
  })
})
