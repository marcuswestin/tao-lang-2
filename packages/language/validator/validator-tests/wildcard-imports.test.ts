import { Describe, Expect, Test } from '@shared/test'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import { useValidationMessages } from '../validator-src/validators/use-validator'
import {
  acceptsFiles,
  acceptsFilesFrom,
  checksFiles,
  rejectsFiles,
  stubView,
  validationErrorMessages,
} from './test-validate'

Describe('validator: wildcard imports', () => {
  for (const owner of ['app', 'publication']) {
    const requirement = 'requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets }'
    Test(
      `preserves matching ${owner} dependency ownership for reachable wildcard exports`,
      acceptsFilesFrom('Consumer/Main.tao', {
        'Library/.tao/.gitkeep': '',
        'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
        'Library/@ui/Widget.tao': `public ${stubView('Widget')}`,
        'Consumer/.tao/.gitkeep': '',
        'Consumer/Main.tao': `use all from @widgets
        ${
          owner === 'app'
            ? `view Root { render Widget }
             app Base { id "base" version "1.0.0" name "Base" ${requirement} view Root }
             app Reader = Base with { id "reader" name "Reader" }`
            : `package { name "Consumer" version 1.0.0 ${requirement} includes @ui }`
        }
        `,
        ...(owner === 'publication'
          ? { 'Consumer/@ui/Root.tao': 'use all from @widgets\npublic view Root { render Widget }' }
          : {}),
      }),
    )
  }

  Test(
    'allows an unused wildcard without per-export warnings',
    checksFiles({
      'Main.tao': 'use all from ./library/Library',
      'library/Library.tao': 'public let Greeting = "Hello"\npublic type Label is text',
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      Expect(result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)).toEqual([])
    }),
  )

  Test(
    'accepts a target with no public exports',
    acceptsFiles({
      'Main.tao': 'use all from ./library/Library',
      'library/Library.tao': 'let Hidden = "private"\nproject type Label is text',
    }),
  )

  for (const visibility of ['', 'folder ', 'package ', 'project ']) {
    Test(
      `keeps ${visibility || 'private '}values and types out of wildcard scopes`,
      checksFiles({
        'Main.tao': `use all from ./library/Library
        let Value = Secret
        let Typed = Hidden "Ada"`,
        'library/Library.tao': `${visibility}let Secret = "private"\n${visibility}type Hidden is text`,
      }, result => {
        const errors = validationErrorMessages(result)
        Expect(errors).toContain("No value named 'Secret' is in scope.")
        Expect(errors).toContain("No type named 'Hidden' is in scope.")
      }),
    )
  }

  Test(
    'retains named imports of project-visible declarations',
    acceptsFiles({
      'Main.tao': 'use Greeting from ./library/Library\nlet Value = Greeting',
      'library/Library.tao': 'project let Greeting = "Hello"',
    }),
  )

  Test(
    'rejects an unused wildcard binding that collides with a local declaration',
    rejectsFiles({
      'Main.tao': 'use all from ./library/Library\nlet Greeting = "Local"',
      'library/Library.tao': 'public let Greeting = "Hello"',
    }, useValidationMessages.localDeclarationCollision('Greeting')),
  )

  Test(
    'checks the singular entity type name for unused local collisions',
    rejectsFiles({
      'Main.tao': 'use all from ./library/Library\ntype Item is text',
      'library/Library.tao': 'public data Items / Item { Name text }',
    }, useValidationMessages.localDeclarationCollision('Item')),
  )

  for (
    const imports of [
      'use all from ./library/One\nuse all from ./library/Two',
      'use Greeting from ./library/One\nuse all from ./library/Two',
      'use all from ./library/One\nuse Greeting from ./library/Two',
    ]
  ) {
    Test(
      `rejects unused repeated imports: ${imports}`,
      rejectsFiles({
        'Main.tao': imports,
        'library/One.tao': 'public let Greeting = "One"',
        'library/Two.tao': 'public let Greeting = "Two"',
      }, useValidationMessages.repeatedImport('Greeting')),
    )
  }

  Test(
    'rejects ambiguous wildcard bindings inside a directory target',
    rejectsFiles({
      'Main.tao': 'use all from ./library',
      'library/One.tao': 'public let Greeting = "One"',
      'library/Two.tao': 'public let Greeting = "Two"',
    }, useValidationMessages.ambiguousImport('Greeting', './library')),
  )

  Test(
    'allows one spelling in separate imported namespaces',
    acceptsFiles({
      'Main.tao': `use all from ./types/Types
      use all from ./views/Views
      let Value = Card "Ada"
      view Main() { render Card() }`,
      'types/Types.tao': 'public type Card is text',
      'views/Views.tao': stubView('Card').replace('view ', 'public view '),
    }),
  )

  Test(
    'allows public type and value namespace peers in one wildcard',
    acceptsFiles({
      'Main.tao': 'use all from ./library/Library\nlet Value = Label { Name Label }',
      'library/Library.tao': 'public type Label is { Name text }\npublic let Label = "Ada"',
    }),
  )

  Test(
    'keeps external wildcard targets inside the selected publication',
    checksFiles({
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
      'Library/@ui/Widget.tao': 'public let Widget = "Hello"\nproject let Secret = "hidden"',
      'Library/@icons/Icon.tao': 'public let Icon = "excluded"',
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use all from @widgets
      package { version 0.1.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }
      let Value = Widget
      let Hidden = Secret
      let Excluded = Icon`,
    }, result => {
      const errors = validationErrorMessages(result)
      Expect(errors).toContain("No value named 'Secret' is in scope.")
      Expect(errors).toContain("No value named 'Icon' is in scope.")
      Expect(errors.some(message => message.includes("No value named 'Widget'"))).toBe(false)
    }, 'Consumer/Main.tao'),
  )
})
