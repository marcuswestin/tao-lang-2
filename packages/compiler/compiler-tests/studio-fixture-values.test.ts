import { Workspace } from '@compiler/workspace'
import { Assert } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('compiler: Studio preview fixture values', () => {
  Test('publishes a yes/no fixture field as a boolean rather than its source word', async () => {
    await withTaoFiles('tao-studio-fixture-values-', {
      'Main.tao': `
        data Documents / Document {
          Title text,
          Archived yes / no
        }

        app First { view Home }

        view Home() { render Surface() }

        view Main(Document) { render Surface() }

        view Surface() { render inject \`\`\`ts return null \`\`\` }

        fixture Library {
          Archived = create Document { Title: "Draft", Archived: true }
          Live = create Document { Title: "Live", Archived: false }
        }

        scenarios Main "states" {
          fixture Library
          device phone
          appearance light
          network online
          locale "en"
          scenario "archived" { render (Document: Archived) }
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'First', studio: true })
      Expect(compiled.validation.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
      const manifest = compiled.studioManifest
      Assert(manifest !== undefined, 'Expected a Studio preview manifest.')
      const creates = manifest.fixtures[0]?.creates ?? []
      Expect(creates.map(create => create.fields['Archived'])).toEqual([true, false])
      Expect(creates.map(create => create.fields['Title'])).toEqual(['Draft', 'Live'])
    })
  })
})
