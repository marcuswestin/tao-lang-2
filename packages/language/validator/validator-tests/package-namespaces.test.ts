import { Describe, Expect, Test } from '@shared/test'
import { usePackageValidationMessages } from '../validator-src/validators/use-package-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { type ValidatedFiles, validationErrorMessages, withValidatedFiles } from './test-validate'

type TaoFiles = Record<string, string>

function checksFiles(files: TaoFiles, check: (result: ValidatedFiles) => void): () => Promise<void> {
  return async () => await withValidatedFiles('Main.tao', files, check)
}

function acceptsFiles(files: TaoFiles): () => Promise<void> {
  return checksFiles(files, result => {
    Expect(validationErrorMessages(result)).toEqual([])
  })
}

function rejectsFiles(files: TaoFiles, ...messages: readonly string[]): () => Promise<void> {
  return checksFiles(files, result => {
    const errors = validationErrorMessages(result).join('\n')
    for (const message of messages) {
      Expect(errors).toContain(message)
    }
  })
}

const widgetsPackage = `
public
view Badge(Label text) {
   render Text("Badge: { Label }")
}

public
function Slug(Value text) returns text {
   return Value
}

public
view Text(Value text) {
   render inject Value \`\`\`ts
      return null
   \`\`\`
}
`

Describe('validator: package namespaces and view aliases', () => {
  Test(
    'accepts a namespace import, a derived name, a rename, and pass-through aliases',
    acceptsFiles({
      'Main.tao': `
        use package @widgets
        use package @widgets as w

        app Aliases { id "aliases" version "1.0.0" name "Aliases" view Main }
        view Main() {
           render Published("one")
        }

        public
        view Published = widgets.Badge

        view Renamed = w.Badge
      `,
      '@widgets/Widgets.tao': widgetsPackage,
    }),
  )

  Test(
    'rejects a duplicate namespace name',
    rejectsFiles(
      {
        'Main.tao': `
          use package @widgets
          use package @widgets

          app Aliases { id "aliases" version "1.0.0" name "Aliases" view Main }
          view Main() {
             render Mine("x")
          }
          view Mine = widgets.Badge
        `,
        '@widgets/Widgets.tao': widgetsPackage,
      },
      usePackageValidationMessages.duplicateNamespace('widgets'),
    ),
  )

  Test(
    'rejects an unresolvable package path',
    rejectsFiles(
      {
        'Main.tao': `
          use package @nowhere

          app Aliases { id "aliases" version "1.0.0" name "Aliases" view Main }
          view Main() {
             render Mine("x")
          }
          view Mine = nowhere.Badge
        `,
      },
      usePackageValidationMessages.unresolvedPackage('@nowhere'),
    ),
  )

  Test(
    'rejects a view alias whose target is not a view',
    rejectsFiles(
      {
        'Main.tao': `
          use package @widgets

          app Aliases { id "aliases" version "1.0.0" name "Aliases" view Main }
          view Main() {
             render Mine("x")
          }
          view Mine = widgets.Slug
        `,
        '@widgets/Widgets.tao': widgetsPackage,
      },
      usePackageValidationMessages.aliasTargetKind('Mine', 'Slug'),
    ),
  )

  Test(
    'preserves scene composition semantics through a view alias chain',
    rejectsFiles(
      {
        'Main.tao': `
          use package @middle

          app Aliases { id "aliases" version "1.0.0" name "Aliases" view Main }
          view Main() {
            render Published()
          }
          view Published = middle.Middle
        `,
        '@middle/Middle.tao': `
          use package @widgets

          public
          view Middle = widgets.Home
        `,
        '@widgets/Widgets.tao': `
          use Text from @tao/ui

          public
          scene Home() {
            Title "Home"
            render Text("Home")
          }
        `,
      },
      ViewsValidator.messages.sceneComposed('Published'),
    ),
  )

  Test(
    'reports the terminal target kind through a type-alias chain',
    rejectsFiles(
      {
        'Main.tao': `
          use package @middle
          public type Published = middle.Middle
        `,
        '@middle/Types.tao': `
          use package @widgets
          public type Middle = widgets.Slug
        `,
        '@widgets/Widgets.tao': widgetsPackage,
      },
      usePackageValidationMessages.typeAliasTargetKind('Published', 'Slug'),
    ),
  )

  Test(
    'reserves the type-alias cycle diagnostic for an actual cycle',
    rejectsFiles(
      {
        'Main.tao': `
          use package @alpha
          public type Published = alpha.Alpha
        `,
        '@alpha/Types.tao': `
          use package @beta
          public type Alpha = beta.Beta
        `,
        '@beta/Types.tao': `
          use package @alpha
          public type Beta = alpha.Alpha
        `,
      },
      usePackageValidationMessages.typeAliasCycle('Published'),
    ),
  )

  Test(
    'binds call sites through the alias to the target interface',
    rejectsFiles(
      {
        'Main.tao': `
          use package @widgets

          app Aliases { id "aliases" version "1.0.0" name "Aliases" view Main }
          view Main() {
             render Mine(1)
          }

          view Mine = widgets.Badge
        `,
        '@widgets/Widgets.tao': widgetsPackage,
      },
      // The alias carries Badge's `Label text` parameter, so a number argument does not bind.
      'Mine',
    ),
  )
})
