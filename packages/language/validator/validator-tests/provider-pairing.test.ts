import { AST } from '@parser'
import { Describe, Expect, stubView, Test } from '@shared/test'
import { pairingValidationMessages as messages } from '../validator-src/validators/pairing-validator'
import { accepts, checksFiles, rejects, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const imports = `
  use AuthProvider from @tao/auth
  use Clerk from @tao/auth/clerk
  use LocalAuth from @tao/auth/local
  use TestAuth from @tao/auth/testing
  use InstantDB from @tao/data/providers/instantdb
  use Local from @tao/data/providers/local
  use Memory from @tao/data/providers/memory
  use Reference from @tao/data/providers/reference
  use StackNav from @tao/nav
  ${stubView('Main')}
`

const clerk = 'Clerk { PublishableKey "pk_test" }'
const localAuth = 'LocalAuth { Endpoint "http://127.0.0.1:4738" Resource "notes" }'
const reference = 'Reference { ServerURL "http://127.0.0.1:4738" Resource "notes" }'
const instantDB = 'InstantDB { AppId "app" }'

/** notesApp binds one Auth (or none) and one Datasource over a small owned-notes catalog. */
function notesApp(auth: string | undefined, datasource: string, data = '', name = 'Notes'): string {
  return `
    ${imports}
    data Accounts / Account { DisplayName text }
    ${data}
    app ${name} {
      Name "Notes"
      Navigator StackNav { Initial Main }
      ${auth ? `Auth ${auth}` : ''}
      Datasource ${datasource}
    }
  `
}

const provider = (name: string) => `provider ${name} from ./${name}.ts`

Describe('validator: provider pairing declarations', () => {
  Test(
    'accepts derived provider types, which inherit their base type pairing',
    accepts(`
      ${imports}
      type CustomMemory is Memory with { }
      type CustomAuth is TestAuth with { }
    `),
  )

  Test(
    'requires a datasource type to declare what it supports',
    rejects(
      `public type Store is datasource with { StorageKey text ${provider('StoreProvider')} }`,
      messages.missingSupports('Store'),
    ),
  )

  Test(
    'requires an auth provider type to declare what it issues',
    rejects(
      `
        use AuthProvider from @tao/auth
        public type Door is AuthProvider with { ${provider('DoorProvider')} }
      `,
      messages.missingIssues('Door'),
    ),
  )

  const misplaced: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'issues on a datasource type',
      `public type Store is datasource with { issues { Session } supports { } ${provider('StoreProvider')} }`,
      messages.misplacedBlock('issues', 'Store'),
    ],
    [
      'supports on an auth provider type',
      `use AuthProvider from @tao/auth
       public type Door is AuthProvider with { issues { Session } supports { } ${provider('DoorProvider')} }`,
      messages.misplacedBlock('supports', 'Door'),
    ],
    [
      'accepts on a nav type',
      `public type Pages is nav with { Initial view accepts { Session } nav PagesNav from ./PagesNav.ts }`,
      messages.misplacedBlock('accepts', 'Pages'),
    ],
    [
      'supports on an ordinary item type',
      'type Row is { Name text supports { Relations } }',
      messages.misplacedBlock('supports', 'Row'),
    ],
  ]
  for (const [name, source, message] of misplaced) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  Test(
    'rejects a pairing block written twice on one type',
    rejects(
      `public type Store is datasource with { supports { } supports { Relations } ${provider('StoreProvider')} }`,
      messages.duplicateBlock('supports', 'Store'),
    ),
  )

  const vocabulary: ReadonlyArray<readonly [name: string, blocks: string, message: string]> = [
    ['unknown proof kinds', 'accepts { Password } supports { }', messages.unknownProofKind('Password')],
    ['repeated proofs', 'accepts { Session, Session } supports { }', messages.duplicateProof('Session')],
    ['unknown capabilities', 'supports { Teleport }', messages.unknownCapability('Teleport')],
    ['repeated capabilities', 'supports { Relations, Relations }', messages.duplicateCapability('Relations')],
    [
      'a levelled capability without its level',
      'supports { Migrations }',
      messages.capabilityLevelMissing('Migrations', ['Additive', 'Renames', 'Destructive']),
    ],
    [
      'a level on a capability without levels',
      'supports { Relations Additive }',
      messages.capabilityLevelUnexpected('Relations'),
    ],
    [
      'an unknown level',
      'supports { Migrations Sideways }',
      messages.capabilityLevelUnknown('Migrations', 'Sideways', ['Additive', 'Renames', 'Destructive']),
    ],
  ]
  for (const [name, blocks, message] of vocabulary) {
    Test(
      `rejects ${name}`,
      rejects(`public type Store is datasource with { ${blocks} ${provider('StoreProvider')} }`, message),
    )
  }

  Test(
    'rejects an unknown proof kind an auth provider type issues',
    rejects(
      `
        use AuthProvider from @tao/auth
        public type Door is AuthProvider with { issues { Password } ${provider('DoorProvider')} }
      `,
      messages.unknownProofKind('Password'),
    ),
  )

  Test(
    'requires from to name an auth provider type',
    rejects(
      `
        ${imports}
        public type Store is datasource with {
          accepts { Session from Memory, Session from Nowhere }
          supports { }
          ${provider('StoreProvider')}
        }
      `,
      messages.issuerNotAuth('Memory'),
      messages.issuerNotAuth('Nowhere'),
    ),
  )

  Test(
    'rejects accepting a proof kind from an auth provider type that never issues it',
    rejects(
      `
        ${imports}
        public type Store is datasource with {
          accepts { IdentityToken from LocalAuth }
          supports { }
          ${provider('StoreProvider')}
        }
      `,
      messages.issuerDoesNotIssue('LocalAuth', 'IdentityToken'),
    ),
  )
})

Describe('validator: app provider pairing', () => {
  Test('pairs TestAuth with Memory', accepts(notesApp('TestAuth { }', 'Memory { }')))
  Test('pairs LocalAuth with Reference', accepts(notesApp(localAuth, reference)))
  Test('pairs Clerk with Reference', accepts(notesApp(clerk, reference)))
  Test(
    'accepts a datasource that accepts nothing when the app has no Auth',
    accepts(notesApp(undefined, 'Local { StorageKey "notes" }')),
  )

  Test(
    'rejects an Auth whose proofs the datasource does not accept',
    rejects(
      notesApp('TestAuth { }', reference),
      messages.noProofInCommon('Notes', 'Reference', 'TestAuth', ['IdentityToken', 'Session']),
    ),
  )

  Test(
    'rejects an Auth other than the one from names',
    rejects(
      `
        ${notesApp('Door { }', 'Store { }')}
        type Gate is AuthProvider with { issues { Session } ${provider('GateProvider')} }
        type Door is AuthProvider with { issues { Session } ${provider('DoorProvider')} }
        type Store is datasource with { accepts { Session from Gate } supports { } ${provider('StoreProvider')} }
      `,
      messages.proofFromOtherAuth('Notes', 'Store', 'Door', 'Session', 'Gate'),
    ),
  )

  Test('reports an unpaired Auth at the Auth and the Datasource lines', async () => {
    const result = await testValidateCodeWithErrors(notesApp(clerk, 'Local { }'))
    const message = messages.noProofsAccepted('Notes', 'Local', 'Clerk')
    const sites = result.diagnostics.filter(diagnostic => diagnostic.message === message)
    Expect(sites.map(diagnostic => diagnostic.nodeType)).toEqual([
      AST.ConfigurationConstructor.$type,
      AST.ConfigurationConstructor.$type,
    ])
    Expect(new Set(sites.map(diagnostic => diagnostic.range?.start.line)).size).toBe(2)
  })

  Test('reports an unsupported capability at the use and at the Datasource line', async () => {
    const result = await testValidateCodeWithErrors(
      notesApp(undefined, instantDB, 'data Notes / Note { A text, B text, unique A + B }'),
    )
    const message = messages.unsupportedCapability('Notes', 'InstantDB', 'UniqueTogether', '`unique A + B` on Note')
    const sites = result.diagnostics.filter(diagnostic => diagnostic.message === message)
    Expect(sites.map(diagnostic => diagnostic.nodeType).toSorted()).toEqual([
      AST.ConfigurationConstructor.$type,
      AST.DataUnique.$type,
    ])
  })

  Test(
    'accepts the capabilities a datasource declares',
    accepts(notesApp(undefined, instantDB, 'data Notes / Note { Owner Account, Title text (unique) }')),
  )

  Test(
    'judges each variant by the Datasource it binds',
    async () => {
      const result = await testValidateCodeWithErrors(`
        ${notesApp(undefined, 'Memory { }', 'data Notes / Note { A text, B text, unique A + B }')}
        app NotesSync = Notes with { Datasource ${instantDB} }
      `)
      const errors = validationErrorMessages(result)
      Expect(errors).toContain(
        messages.unsupportedCapability('NotesSync', 'InstantDB', 'UniqueTogether', '`unique A + B` on Note'),
      )
      Expect(errors.filter(error => error.includes('app Notes '))).toEqual([])
    },
  )

  Test(
    'rejects membership rules on a datasource that does not support them',
    rejects(
      `
        ${
        notesApp(
          'TestAuth { }',
          'Store { }',
          `data Teams / Team { Owner Account }
           data Notes / Note { Team, Body text }
           access Note { Team.Owner can read }`,
        )
      }
        type Store is datasource with { accepts { TestIdentity } supports { Relations, AccessRules } ${
        provider('StoreProvider')
      } }
      `,
      messages.unsupportedCapability('Notes', 'Store', 'MembershipRules', '`Team.Owner` in access Note'),
    ),
  )

  Test(
    'rejects field update grants on a datasource that does not support them',
    rejects(
      `
        ${
        notesApp(
          'TestAuth { }',
          'Store { }',
          `data Notes / Note { Owner Account, Body text }
           access Note { Owner can read; Owner can update Body }`,
        )
      }
        type Store is datasource with { accepts { TestIdentity } supports { Relations, AccessRules } ${
        provider('StoreProvider')
      } }
      `,
      messages.unsupportedCapability('Notes', 'Store', 'FieldUpdates', '`update Body` in access Note'),
    ),
  )

  Test(
    'rejects access rules in an app without Auth',
    rejects(
      notesApp(undefined, 'Memory { }', 'access Account { Account can read }'),
      messages.accessWithoutAuth('Notes', 'Account'),
    ),
  )

  Test(
    'rejects a variant that removes the Auth its access rules need',
    async () => {
      const result = await testValidateCodeWithErrors(`
        ${notesApp('TestAuth { }', 'Memory { }', 'access Account { Account can read }')}
        app NotesOpen = Notes with { Auth none }
      `)
      Expect(validationErrorMessages(result)).toContain(messages.accessWithoutAuth('NotesOpen', 'Account'))
      Expect(validationErrorMessages(result)).not.toContain(messages.accessWithoutAuth('Notes', 'Account'))
    },
  )

  Test(
    'reports a capability used in another module where it is written',
    checksFiles({
      'Main.tao': `
        use Notes from ./Schema.tao
        use InstantDB from @tao/data/providers/instantdb
        use StackNav from @tao/nav
        ${stubView('Main')}
        app NotesApp { Name "Notes" Navigator StackNav { Initial Main } Datasource ${instantDB} }
      `,
      'Schema.tao': 'workspace data Notes / Note { A text, B text, unique A + B }',
    }, result => {
      const message = messages.unsupportedCapability(
        'NotesApp',
        'InstantDB',
        'UniqueTogether',
        '`unique A + B` on Note',
      )
      const sites = result.diagnostics.filter(diagnostic => diagnostic.message === message)
      Expect(sites.map(diagnostic => diagnostic.nodeType).toSorted()).toEqual([
        AST.ConfigurationConstructor.$type,
        AST.DataUnique.$type,
      ])
    }),
  )
})
