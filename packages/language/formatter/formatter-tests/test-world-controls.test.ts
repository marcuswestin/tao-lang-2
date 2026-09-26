import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: test world controls', () => {
  Test(
    'spaces the three world-control spellings',
    formats(
      `test "Demo"{test "syncs"{run Demo network offline datasource fails after create Note "rejected" network online wait for sync}}`,
      `
      test "Demo" {
         test "syncs" {
            run Demo
            network offline
            datasource fails after create Note "rejected"
            network online
            wait for sync
      }  }
    `,
    ),
  )
})
