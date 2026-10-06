import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('entity function formatter', () => {
  Test(
    'formats qualified receivers for arbitrary entity names and preserves legacy functions',
    formats(
      `data LibraryBooks/LibraryBook{Title text,func LibraryBook . Label ( ) -> text{return LibraryBook.Title}}\ndata Recipes/Recipe{Name text,func Legacy( )->text{return "recipe"}}`,
      `
        data LibraryBooks / LibraryBook {
           Title text,

           func LibraryBook.Label() -> text {
              return LibraryBook.Title
           }
        }

        data Recipes / Recipe {
           Name text,

           func Legacy() -> text {
              return "recipe"
           }
        }
      `,
    ),
  )
})
