import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: auth data syntax', () => {
  Test(
    'formats terminal matches with nested bare arms and explicit multi-statement blocks',
    formats(
      'view Home(){render Col(){when true|yes->when false|yes->Text("inner")|otherwise->Text("fallback")|otherwise->{Text("outer") Text("second")}}}',
      `
      view Home() {
         render Col() {
            when true
               | yes -> when false
                  | yes -> Text("inner")
                  | otherwise -> Text("fallback")
               | otherwise -> {
                  Text("outer")
                  Text("second")
      }  }  }
    `,
    ),
  )

  Test(
    'formats assigned queries and access field lists',
    formats(
      'access Note{Owner can read,create;Owner can update Body,Title} view Home(Me Account){query Mine=Me.Notes with{order by Body}}',
      `
      access Note {
         Owner can read, create;
         Owner can update Body, Title
      }

      view Home(Me Account) {
         query Mine = Me.Notes with {
            order by Body
      }  }
    `,
    ),
  )

  Test(
    'canonicalizes an adjacent legacy query head and block',
    formats(
      'view Home(){query Notes{}}',
      `
      view Home() {
         query Notes = Notes with { }
      }
    `,
    ),
  )

  Test(
    'keeps leading comments indented after entry commas',
    formats(
      `data Notes / Note {
      Body text,
      // A field comment.
      // A second line.
      Title text,
    }`,
      `
      data Notes / Note {
         Body text,
         // A field comment.
         // A second line.
         Title text,
      }
    `,
    ),
  )
  Test(
    'formats typed fields, entry commas, traits and delimited commands',
    formats(
      'data Notes/Note{Owner Account,Body text(default "",required "Write something"),commands{Save,Share},}',
      `
      data Notes / Note {
         Owner Account,
         Body text (default "", required "Write something"),

         commands { Save, Share },
      }
    `,
    ),
  )
})
