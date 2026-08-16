import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: minimal design', () => {
  Test(
    'formats flat tokens and named combined bundles deterministically',
    formats(
      'workspace   design   Theme{paper   #fff screen[fill,content top stretch,pad 16,bg paper] title[size 28,weight 700,fg paper]}',
      `
        workspace design Theme {
           paper #fff
           screen [fill, content top stretch, pad 16, bg paper]
           title [size 28, weight 700, fg paper]
        }
      `,
    ),
  )
})
