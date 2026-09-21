import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('multiple datasources formatter', () => {
  Test(
    'formats membership, a bound set with a patched member, and bare and named references',
    formats(
      `datasource Feed=Memory{Data{Stories,Comments}}
datasource Personal=Local{StorageKey "p" Data{Bookmarks}}
app Reader{Name "Reader" Datasource{Feed,Personal with{StorageKey "prod"}}}
data Bookmarks/Bookmark{Story(reference) Kept(reference  Story) Note text(default "")}`,
      `
        datasource Feed = Memory {
           Data {
              Stories,
              Comments
        }  }

        datasource Personal = Local {
           StorageKey "p"
           Data {
              Bookmarks
        }  }

        app Reader {
           Name "Reader"
           Datasource {
              Feed,
              Personal with {
                 StorageKey "prod"
        }  }  }

        data Bookmarks / Bookmark {
           Story (reference)
           Kept (reference Story)
           Note text (default "")
        }
      `,
    ),
  )
})
