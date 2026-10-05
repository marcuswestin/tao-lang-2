import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: wildcard imports', () => {
  Test(
    'keeps wildcard imports in the import section with canonical spacing',
    formats(
      `
     use   all   from   @tao/ui
     use   all from ./Library
     view Home {
       render Col {
         Spacer
       }
     }`,
      `
     use all from @tao/ui
     use all from ./Library

     view Home {
        render Col {
           Spacer
     }  }`,
    ),
  )

  Test(
    'preserves named imports alongside wildcard imports',
    formats(
      `
     use all from @tao/ui
     use Name,  FamilyName from ./Names`,
      `
     use all from @tao/ui
     use Name, FamilyName from ./Names`,
    ),
  )
})
