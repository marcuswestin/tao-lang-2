import { Describe, stubView, Test } from '@shared/test'
import { AppValidator } from '../validator-src/validators/app-validator'
import { packageValidationMessages } from '../validator-src/validators/package-validator'
import { requirementOwnershipMessages } from '../validator-src/validators/requirement-ownership-validator'
import { useValidationMessages } from '../validator-src/validators/use-validator'
import { acceptsFilesFrom, rejectsFilesFrom } from './test-validate'

const library = {
  'Library/.tao/.gitkeep': '',
  'Library/Package.tao': `
    package { name "Widget Package Foo" version 2.0.0 includes @ui }
    package { version 1.0.0 includes @icons }
  `,
  'Library/@ui/Widget.tao': 'public let Widget = "visible"',
  'Library/@icons/Icon.tao': 'public let Icon = "icon"',
}

Describe('package publications', () => {
  Test(
    'selects an explicitly named publication and its included module',
    acceptsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @widgets } }
        use Widget from @widgets
      `,
    }),
  )

  Test(
    'omitting the name selects only the unnamed publication',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires ../Library version ^2.0.0 { @ui as @widgets } }
      `,
    }, packageValidationMessages.versionMismatch('the unnamed package', '1.0.0', '^2.0.0')),
  )

  Test(
    'accepts a quoted compound SemVer range',
    acceptsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ">=2.0.0 <3.0.0" { @ui as @widgets } }
        use Widget from @widgets
      `,
    }),
  )

  Test(
    'rejects an incomplete version comparator',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ">=" { @ui as @widgets } }
      `,
    }, packageValidationMessages.invalidRange('>=')),
  )

  Test(
    'rejects a module excluded from the selected publication',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ^2.0.0 { @icons as @widgets } }
      `,
    }, packageValidationMessages.moduleNotIncluded('@icons', "'Widget Package Foo'")),
  )

  Test(
    'keeps a private helper reachable inside the library but hidden from consumers',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Library/Helper.tao': 'project let Secret = "private"',
      'Library/@ui/Widget.tao': `
        use Secret from ../Helper
        public let Widget = Secret
      `,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @widgets } }
        use Secret from @widgets
      `,
    }, useValidationMessages.missingImport('Secret', '@widgets')),
  )

  Test(
    'rejects ambiguous aliases across publications',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package {
          version 0.1.0
          requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @shared }
          requires ../Library version ^1.0.0 { @icons as @shared }
        }
      `,
    }, packageValidationMessages.aliasCollision('@shared')),
  )

  Test(
    'rejects a module alias containing a subfolder',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @widgets/parts } }
      `,
    }, packageValidationMessages.invalidAlias('@widgets/parts')),
  )

  Test(
    'deduplicates an identical repeated binding',
    acceptsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
        package {
          version 0.1.0
          requires "Widget Package Foo" from ../Library version ^2.0.0 {
            @ui as @widgets
            @ui as @widgets
          }
        }
        use Widget from @widgets
      `,
    }),
  )

  Test(
    'rejects an alias that collides with a local module',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...library,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/@widgets/Local.tao': 'public let Local = "local"',
      'Consumer/Main.tao': `
        package { version 0.1.0 requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @widgets } }
      `,
    }, packageValidationMessages.aliasCollision('@widgets')),
  )

  Test(
    'requires distinct aliases for distinct TypeScript dependency versions',
    rejectsFilesFrom('Main.tao', {
      'Main.tao': `
        package {
          version 0.1.0
          requires ts npm:date-fns version 4.1.0 as date-fns-v4
          requires ts npm:date-fns version 4.2.0 as date-fns-v4
        }
      `,
    }, packageValidationMessages.aliasCollision('date-fns-v4')),
  )

  Test(
    'rejects a publication declared in a module',
    rejectsFilesFrom('@ui/Package.tao', {
      'Main.tao': 'let Main = "root"',
      '@ui/Package.tao': 'package { version 1.0.0 includes @ui }',
    }, packageValidationMessages.rootOnly()),
  )

  Test(
    'rejects a publication that includes a missing module',
    rejectsFilesFrom('Main.tao', {
      'Main.tao': 'package { version 1.0.0 includes @missing }',
    }, packageValidationMessages.invalidModule('@missing')),
  )
})

Describe('effective app identity', () => {
  const view = stubView('Root')
  Test(
    'inherits metadata and permits a prerelease version',
    acceptsFilesFrom('Main.tao', {
      'Main.tao': `
        ${view}
        app Base { id "example" version "1.0.0-beta.1" name "Base" view Root }
        app Derived = Base with { id "derived" name "Derived" }
      `,
    }),
  )
  Test(
    'rejects a duplicate effective id and version',
    rejectsFilesFrom('Main.tao', {
      'Main.tao': `
        ${view}
        app Base { id "example" version "1.0.0" name "Base" view Root }
        app Derived = Base with { name "Derived" }
      `,
    }, AppValidator.messages.duplicateIdentity('example', '1.0.0')),
  )
  Test(
    'requires effective metadata on runnable apps',
    rejectsFilesFrom('Main.tao', {
      'Main.tao': `${view}\napp Missing { view Root }`,
    }, AppValidator.messages.identity('Missing', 'id')),
  )
})

Describe('app requirement ownership', () => {
  const source = {
    ...library,
    'Consumer/.tao/.gitkeep': '',
  }
  const rootPackage = `package {
    version 0.1.0
    requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @parts }
  }`
  const appRequirement = `requires "Widget Package Foo" from ../Library version ^2.0.0 { @ui as @parts }`
  const reachableView = `${stubView('Display', 'Value text')}\nview Root() { render Display(Widget) }`

  Test(
    'rejects a reachable view using only the root publication dependency',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...source,
      'Consumer/Main.tao': `
        use Widget from @parts
        ${rootPackage}
        ${reachableView}
        app Reader { id "reader" version "1.0.0" name "Reader" view Root }
      `,
    }, requirementOwnershipMessages.app('Reader', '@parts')),
  )

  Test(
    'accepts a matching requirement inherited from a base app',
    acceptsFilesFrom('Consumer/Main.tao', {
      ...source,
      'Consumer/Main.tao': `
        use Widget from @parts
        ${reachableView}
        app Base { id "base" version "1.0.0" name "Base" ${appRequirement} view Root }
        app Reader = Base with { id "reader" name "Reader" }
      `,
    }),
  )

  Test(
    'does not borrow a sibling app requirement',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...source,
      'Consumer/Main.tao': `
        use Widget from @parts
        ${reachableView}
        app Owner { id "owner" version "1.0.0" name "Owner" ${appRequirement} view Root }
        app Reader { id "reader" version "1.0.0" name "Reader" view Root }
      `,
    }, requirementOwnershipMessages.app('Reader', '@parts')),
  )

  Test(
    'does not require an unused imported module on an app',
    acceptsFilesFrom('Consumer/Main.tao', {
      ...source,
      'Consumer/Main.tao': `
        use Widget from @parts
        ${rootPackage}
        ${stubView('Root')}
        app Reader { id "reader" version "1.0.0" name "Reader" view Root }
      `,
    }),
  )
})

Describe('publication requirement ownership', () => {
  const files = {
    'Foundation/.tao/.gitkeep': '',
    'Foundation/Package.tao': 'package { version 1.0.0 includes @core }',
    'Foundation/@core/Core.tao': 'public let Core = "foundation"',
    'Library/.tao/.gitkeep': '',
    'Library/@ui/Widget.tao': 'use Core from @foundation\npublic let Widget = Core',
    'Consumer/.tao/.gitkeep': '',
    'Consumer/Main.tao': `
      package { version 0.1.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }
      use Widget from @widgets
    `,
  }
  const foundationRequirement = 'requires ../Foundation version ^1.0.0 { @core as @foundation }'

  Test(
    'rejects a private implementation borrowing another publication requirement',
    rejectsFilesFrom('Consumer/Main.tao', {
      ...files,
      'Library/Package.tao': `
        package { name "Widgets" version 1.0.0 includes @ui }
        package { name "Unrelated" version 1.0.0 ${foundationRequirement} }
      `,
    }, requirementOwnershipMessages.publication('Widgets', '@foundation')),
  )

  Test(
    'accepts a private implementation with its own publication requirement',
    acceptsFilesFrom('Consumer/Main.tao', {
      ...files,
      'Library/Package.tao': `
        package { name "Widgets" version 1.0.0 includes @ui ${foundationRequirement} }
      `,
    }),
  )
})
