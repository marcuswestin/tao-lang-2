import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('Tao formatter package namespaces', () => {
  Test(
    'formats namespace imports and pass-through aliases',
    formats(
      `
        use   package   @widgets   as   w
        view Mine=w  .  Badge
      `,
      `
        use package @widgets as w

        view Mine = w.Badge
      `,
    ),
  )
})
