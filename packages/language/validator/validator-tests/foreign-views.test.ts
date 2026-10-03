import { Describe, Expect, Test } from '@shared/test'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { accepts, rejects, stubView, withValidatedFiles } from './test-validate'

Describe('validator: foreign views', () => {
  Test(
    'accepts foreign views without a Tao render body and exposes declared content and slots',
    accepts(`
      app ForeignApp { view Main }
      view Main() {
        action Change(Value text) { }
        render Foreign("draft", Change) {
          @header Label("Heading")
          Label("Body")
        }
      }
      view Foreign(Content text, Change action(text)) accepts content slots @header from ./Foreign.tsx
      ${stubView('Label', 'Value text')}
    `),
  )

  Test(
    'rejects a package path for a foreign implementation',
    rejects(
      `
        app ForeignApp { view Foreign }
        view Foreign() from @tao/native
      `,
      ViewsValidator.messages.foreignViewPath,
    ),
  )

  Test(
    'rejects an empty accepts clause',
    rejects(
      `
        app ForeignApp { view Foreign }
        view Foreign() accepts from ./Foreign.tsx
      `,
      ViewsValidator.messages.foreignViewAccepts,
    ),
  )

  Test('reports a missing foreign view sidecar at its Tao declaration', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': 'app Missing { view Foreign } view Foreign() from ./Missing.tsx',
    }, result => {
      const diagnostic = result.diagnostics.find(candidate =>
        candidate.message === ViewsValidator.messages.foreignViewMissing('./Missing.tsx')
      )
      Expect(diagnostic?.filePath).toContain('Main.tao')
      Expect(diagnostic?.range).toBeDefined()
    })
  })
})
