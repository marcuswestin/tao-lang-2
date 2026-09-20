import { Describe, Test } from '@shared/test'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { configuredValueValidationMessages } from '../validator-src/validators/configured-values-validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { datasourceMembershipValidationMessages as datasourceMembershipMessages } from '../validator-src/validators/datasource-membership-validator'
import { accepts, acceptsFiles, rejects, rejectsFiles, stubView } from './test-validate'

const prelude = `
  use Local from @tao/data/providers/local
  use Memory from @tao/data/providers/memory
  use StackNav from @tao/nav
  ${stubView('Main')}
  data Stories / Story { HnId number (unique) Title text }
  data Comments / Comment { Story HnId number (unique) Text text }
`

/** twoStores is the well-formed shape every rejection below deviates from in one way. */
const twoStores = `
  ${prelude}
  data Bookmarks / Bookmark { Story (reference) Note text (default "") }
  datasource Feed = Memory { Data { Stories, Comments } }
  datasource StubFeed = Memory { Data { Stories, Comments } }
  datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
  app Reader {
    Name "Reader"
    Navigator StackNav { Initial Main }
    Datasource { Feed, Personal with { StorageKey "personal-prod" } }
  }
  app ReaderStub = Reader with { Datasource { StubFeed, Personal with { StorageKey "personal-stub" } } }
`

Describe('validator: multiple datasources', () => {
  Test(
    'accepts a bound set, a stub alternative, a patch on a listed datasource, and a bare reference',
    accepts(twoStores),
  )

  Test(
    'resolves patched datasource names through ordinary folder visibility',
    acceptsFiles({
      'Main.tao': `
        use StackNav from @tao/nav
        ${stubView('Main')}
        app Reader {
          Name "Reader"
          Navigator StackNav { Initial Main }
          Datasource { Feed, Personal with { StorageKey "prod" } }
        }
      `,
      'Sources.tao': `
        use Local from @tao/data/providers/local
        use Memory from @tao/data/providers/memory
        folder data Stories / Story { Title text }
        folder data Bookmarks / Bookmark { Note text }
        folder type Personal is text
        folder datasource Feed = Memory { Data { Stories } }
        folder datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
      `,
    }),
  )

  Test(
    'accepts a reference that names its target when the field name differs',
    accepts(`
      ${prelude}
      data Bookmarks / Bookmark { Kept (reference Story) }
      datasource Feed = Memory { Data { Stories, Comments } }
      datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
      app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
    `),
  )

  Test(
    'rejects a relation that crosses a datasource boundary and points at reference',
    rejects(
      `
        ${prelude}
        data Bookmarks / Bookmark { Story }
        datasource Feed = Memory { Data { Stories, Comments } }
        datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
      `,
      datasourceMembershipMessages.crossDatasourceRelation('Bookmark', 'Story', 'Story'),
    ),
  )

  Test(
    'requires a reference target to carry a unique field and forbids owning one',
    rejects(
      `
        ${prelude}
        data Notes / Note { Body text }
        data Pins / Pin { Note (reference, owned) }
        datasource Feed = Memory { Data { Notes } }
        datasource Personal = Local { StorageKey "personal" Data { Pins } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
      `,
      dataValidationMessages.referenceUnique('Note', 'Note'),
      dataValidationMessages.referenceOwned('Note'),
    ),
  )

  Test(
    'rejects a reference to a collection rather than an entity',
    rejects(
      `
        ${prelude}
        data Bookmarks / Bookmark { Story (reference Stories) }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Memory { } }
      `,
      dataValidationMessages.referenceTarget('Story', 'Stories'),
    ),
  )

  Test(
    'rejects two datasources whose membership partially overlaps',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Stories, Comments } }
        datasource Half = Memory { Data { Stories } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Feed }
      `,
      datasourceMembershipMessages.overlappingMembership('Feed', 'Half', 'Stories'),
    ),
  )

  Test(
    'rejects an empty membership list instead of treating it as a catch-all',
    rejects(
      `
        ${prelude}
        datasource Empty = Memory { Data { } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Empty }
      `,
      datasourceMembershipMessages.emptyMembership('Empty'),
    ),
  )

  Test(
    'rejects an app binding two alternatives for one store',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Stories, Comments } }
        datasource StubFeed = Memory { Data { Stories, Comments } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, StubFeed } }
      `,
      datasourceMembershipMessages.alternativesBound('Reader', 'Feed', 'StubFeed'),
    ),
  )

  Test(
    'rejects a collection no bound datasource stores when there is no catch-all',
    rejects(
      `
        ${prelude}
        data Bookmarks / Bookmark { Note text }
        datasource Feed = Memory { Data { Stories, Comments } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed } }
      `,
      datasourceMembershipMessages.unstoredCollection('Reader', 'Bookmarks'),
    ),
  )

  Test(
    'rejects two catch-all datasources bound together',
    rejects(
      `
        ${prelude}
        datasource Everything = Memory { }
        datasource Also = Local { StorageKey "also" }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Everything, Also } }
      `,
      datasourceMembershipMessages.duplicateCatchAll('Reader', 'Everything', 'Also'),
    ),
  )

  Test(
    'rejects membership naming a local only collection or an unknown one',
    rejects(
      `
        ${prelude}
        data Sessions / Session { Label text  local only }
        datasource Feed = Memory { Data { Stories, Sessions, Ghosts } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Feed }
      `,
      datasourceMembershipMessages.localOnlyMembership('Feed', 'Sessions'),
      "No data entity or value named 'Ghosts' is in scope.",
    ),
  )

  Test(
    'rejects a Data entry that is not a data collection',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Main } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Feed }
      `,
      configuredValueValidationMessages.referenceEntry('Data', 'data collections'),
    ),
  )

  Test(
    'rejects a Datasource entry that is not a datasource',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Main } }
      `,
      configuredValueValidationMessages.referenceEntry('Datasource', 'datasources'),
    ),
  )

  Test(
    'requires an app to bind every store the project declares, even beside a catch-all',
    rejects(
      `
        ${prelude}
        data Bookmarks / Bookmark { Note text }
        datasource Feed = Memory { Data { Stories, Comments } }
        datasource Offline = Memory { }
        datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Offline, Personal } }
      `,
      datasourceMembershipMessages.unboundStore('Reader', ['Stories', 'Comments'], ['Feed']),
    ),
  )

  Test(
    'refuses a single catch-all datasource once the project declares a store it does not bind',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Stories } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Memory { } }
      `,
      datasourceMembershipMessages.unboundStore('Reader', ['Stories'], ['Feed']),
    ),
  )

  Test(
    'treats a datasource derived with with as an alternative for its base store, not a catch-all',
    rejects(
      `
        ${prelude}
        datasource Feed = Local { StorageKey "feed" Data { Stories, Comments } }
        datasource Preview = Feed with { StorageKey "preview" }
        datasource Restated = Feed with { Data { Stories } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Preview } }
      `,
      datasourceMembershipMessages.alternativesBound('Reader', 'Feed', 'Preview'),
      datasourceMembershipMessages.derivedMembership('Restated', 'Feed'),
    ),
  )

  Test(
    'refuses a let in a bound set rather than dropping it',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Stories, Comments } }
        let Alias = Feed
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Alias } }
      `,
      configuredValueValidationMessages.datasourceDeclarationRequired('Datasource', 'Alias'),
    ),
  )

  Test(
    'refuses an inverse whose only back-link is a reference',
    rejects(
      `
        ${prelude}
        data Boards / Board { Title text (unique) Notes }
        data Notes / Note { Board (reference) Text text }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource Memory { } }
      `,
      dataValidationMessages.inverseOfReference('Board.Notes', 'Note', 'Board'),
    ),
  )

  Test(
    'refuses a data collection named where an item expects a value',
    rejects(
      `
        ${prelude}
        type Name is text
        type Person is { Name }
        let Bad = Person { Stories }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } }
      `,
      configuredItemValidationMessages.listedNotValue('Stories'),
    ),
  )

  Test(
    'diagnoses a relation across datasources declared in other modules',
    rejectsFiles(
      {
        'Main.tao': `
          use Local from @tao/data/providers/local
          use Memory from @tao/data/providers/memory
          use StackNav from @tao/nav
          use Stories, Bookmarks from ./Data
          ${stubView('Main')}
          datasource Feed = Memory { Data { Stories } }
          datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
          app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
        `,
        'Data.tao': `
          public data Stories / Story { HnId number (unique) Title text }
          public data Bookmarks / Bookmark { Story Note text }
        `,
      },
      datasourceMembershipMessages.crossDatasourceRelation('Bookmark', 'Story', 'Story'),
    ),
  )

  Test(
    'accepts datasources, collections, and the app split across modules',
    acceptsFiles({
      'Main.tao': `
        use Local from @tao/data/providers/local
        use Memory from @tao/data/providers/memory
        use StackNav from @tao/nav
        use Stories, Bookmarks from ./Data
        ${stubView('Main')}
        datasource Feed = Memory { Data { Stories } }
        datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
        app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
      `,
      'Data.tao': `
        public data Stories / Story { HnId number (unique) Title text }
        public data Bookmarks / Bookmark { Story (reference) Note text }
      `,
    }),
  )

  Test(
    'checks a listed patch against the datasource contract and refuses membership in it',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Stories, Comments } }
        datasource Personal = Local { StorageKey "personal" }
        app Reader {
          Name "Reader"
          Navigator StackNav { Initial Main }
          Datasource {
            Feed with { Data { Stories } },
            Personal with { Bogus "x" }
          }
        }
      `,
      configuredValueValidationMessages.membershipPatch('Feed'),
      configuredValueValidationMessages.unknownConfiguration('Local', 'Bogus'),
    ),
  )

  Test(
    'requires a datasource-set patch to name the binding it targets',
    rejects(
      `
        ${prelude}
        datasource Feed = Memory { Data { Stories, Comments } }
        datasource Personal = Local { StorageKey "personal" }
        app Reader {
          Name "Reader"
          Navigator StackNav { Initial Main }
          Datasource { Feed, Personal }
        }
        app Ambiguous = Reader with { Datasource with { StorageKey "prod" } }
      `,
      datasourceMembershipMessages.ambiguousBindingPatch('Ambiguous'),
    ),
  )

  Test(
    'refuses a patch on a listed name that is not a datasource, or that names nothing',
    rejects(
      `
        ${prelude}
        action Run() { }
        command Ready() { Title "Ready" do Run() }
        nav Main2 = StackNav { Initial Main Toolbar { Ready with { Title "Go" } } }
        datasource Feed = Memory { }
        app Reader {
          Name "Reader"
          Navigator StackNav { Initial Main }
          Datasource { Feed, Ghost with { StorageKey "x" } }
        }
      `,
      configuredValueValidationMessages.listedPatch('Toolbar', 'Ready'),
      configuredValueValidationMessages.unknownListedDeclaration('Datasource', 'Ghost'),
    ),
  )
})
