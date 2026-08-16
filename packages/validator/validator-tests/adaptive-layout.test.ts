import { Describe, Test } from '@shared/test'
import { LayoutValidator } from '../validator-src/validators/layout-validator'
import { accepts, app, rejects, stubLayout } from './test-validate'

const messages = LayoutValidator.messages

function adaptiveLayoutApp(clause: string): string {
  return app(`render Column() [${clause}]`, stubLayout('Column'))
}

Describe('validator: adaptive layout', () => {
  Test('accepts a positive width maximum', accepts(adaptiveLayoutApp('width max 720')))

  Test(
    'rejects a zero width maximum',
    rejects(adaptiveLayoutApp('width max 0'), messages.positiveNumber('width max 0')),
  )

  Test(
    'rejects a missing width maximum',
    rejects(adaptiveLayoutApp('width max'), messages.malformedEntry('width max')),
  )

  Test(
    'does not generalize maximums to height',
    rejects(adaptiveLayoutApp('height max 720'), messages.malformedEntry('height max 720')),
  )
})
