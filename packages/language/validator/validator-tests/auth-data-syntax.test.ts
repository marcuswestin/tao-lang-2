import { Describe, stubContainer, stubView, Test } from '@shared/test'
import { accessValidationMessages } from '../validator-src/validators/access-validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { accepts, rejects } from './test-validate'

Describe('validator: auth data syntax', () => {
  Test(
    'accepts the imported Account and its aliases as symbolic offline scopes',
    accepts(`
    use Account from @tao/auth
    use Reference from @tao/data/providers/reference
    let Me = Account
    data Accounts / Account { DisplayName text, Notes, }
    data Notes / Note { Owner Account, Body text, }
    let Store = Reference {
      ServerURL "http://localhost:4738",
      Resource "test",
      Offline { Account, Me, Me.Notes }
    }
  `),
  )

  Test(
    'accepts typed relations and explicit or inferred enum fields',
    accepts(`
    type Role is one of Admin, Member
    type DisplayName is text
    data Accounts / Account { DisplayName, Notes, }
    data Notes / Note { Owner Account, Role, State Role?, }
  `),
  )

  Test(
    'accepts independent and composite unique constraints without choosing a reference key',
    accepts(`
    data Accounts / Account { Name text, }
    data Memberships / Membership { Person Account, Workspace text, unique Person + Workspace, unique Workspace, }
  `),
  )

  Test(
    'rejects unknown fields in composite constraints',
    rejects(
      `
    data Notes / Note { Body text, unique Body + Missing, }
  `,
      dataValidationMessages.unknownField('Note', 'Missing'),
    ),
  )

  Test(
    'accepts direct and membership actor paths with mutable field grants',
    accepts(`
    data Accounts / Account { DisplayName text, }
    data Workspaces / Workspace { Memberships, }
    data Memberships / Membership { Workspace, Person Account, }
    access Account { Account can read; Account can update DisplayName }
    access Workspace { Workspace.Memberships.Person can read }
  `),
  )

  Test(
    'rejects actor paths that do not reach an account',
    rejects(
      `
    data Notes / Note { Body text, }
    access Note { Body can read }
  `,
      accessValidationMessages.actor('Body'),
    ),
  )

  Test(
    'requires explicit mutable fields for update grants',
    rejects(
      `
    data Accounts / Account { DisplayName text, }
    access Account { Account can update }
  `,
      accessValidationMessages.updateFields,
    ),
  )

  Test(
    'matches named enum subjects in value and render positions',
    accepts(`
    ${stubContainer('Col')}
    ${stubView('Text', 'Value text')}
    type SessionState is one of Restoring, SignedOut, SignedIn
    type Session is { State SessionState }
    view Home(Current Session) {
      let Label = when Current.State | SignedIn -> "In" | otherwise -> "Out"
      render Col() {
        when Current.State | Restoring -> Text("Restoring") | SignedIn -> Text(Label) | otherwise -> Text("Out")
      }
    }
  `),
  )

  // REMOVAL CANDIDATE: Subjectless boolean checks may duplicate functional-core tests; retain the bar-match entrypoint pending comparison.
  Test(
    'requires explicit boolean predicates in subjectless matches',
    rejects(
      `
    let Label = when | 42 -> "Value" | otherwise -> "Other"
  `,
      FunctionalCoreValidator.messages.ifCondition,
    ),
  )

  Test(
    'accepts positive and negative completeness reads on rows and projections',
    accepts(`
    data Accounts / Account { DisplayName text (required "Enter your name"), }
    type ProfileInput is Account { DisplayName }
    view Profile(Me Account) {
      state Input = copy Me as ProfileInput
      let Ready is boolean = Me.IsComplete
      let Missing is boolean = Me.IsIncomplete
      let LocalReady is boolean = Input.IsComplete
      let LocalMissing is boolean = Input.IsIncomplete
      render Empty()
    }
    ${stubView('Empty')}
  `),
  )

  Test(
    'keeps completeness aliases derived and read-only',
    rejects(
      `
    data Accounts / Account { DisplayName text, }
    action Change(mutable Me Account) { set Me.IsComplete = false }
  `,
      StateValidator.messages.derivedMemberWrite('Me.IsComplete'),
    ),
  )

  Test(
    'reserves positive and negative completeness members on data rows',
    rejects(
      `
    data Accounts / Account { IsComplete boolean, IsIncomplete boolean, }
  `,
      dataValidationMessages.reservedField('Account', 'IsComplete'),
      dataValidationMessages.reservedField('Account', 'IsIncomplete'),
    ),
  )

  Test(
    'reports an ambiguous inverse rather than choosing a compatible relation',
    rejects(
      `
    data Accounts / Account { Notes, }
    data Notes / Note { Owner Account, Reviewer Account, }
  `,
      dataValidationMessages.ambiguousInverseRelation('Account.Notes', 'Note'),
    ),
  )

  Test(
    'gives a migration diagnostic for legacy relation traits',
    rejects(
      `
    data Accounts / Account { Name text, }
    data Notes / Note { Owner (relation Account), }
  `,
      dataValidationMessages.legacyRelation('Owner', 'Account'),
    ),
  )
})
