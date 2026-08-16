import { Describe, Test } from '@shared/test'
import { LayoutValidator } from '../validator-src/validators/layout-validator'
import { accepts, app, fence, rejects, stubLayout, tsFence } from './test-validate'

const messages = LayoutValidator.messages

Describe('validator: layout clauses', () => {
  Test(
    'accepts content clauses on ordinary views with runtime-resolved direction',
    accepts(`
      app MyApp { view MainView }
      use Col, Text from @tao/ui
      view Card() {
        render Col(){
          Text("Wrapped")
        }
      }
      view MainView() {
        render Card()[content center]
      }
    `),
  )

  Test(
    'accepts content clauses without stdlib declaration identity',
    accepts(`
      app MyApp { view MainView }
      view Row() {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView() {
        render Row()[content left center]
      }
    `),
  )

  const malformedCases: ReadonlyArray<readonly [clause: string, message: string]> = [
    ['gap fill', messages.malformedEntry('gap fill')],
    ['claim fill', messages.malformedEntry('claim fill')],
    ['unknown 1', messages.unsupportedEntry('unknown 1')],
    ['content diagonal', messages.unsupportedTerm('content diagonal', 'diagonal')],
    ['content', messages.malformedEntry('content')],
    ['content left center right', messages.malformedEntry('content left center right')],
    ['pad horizontal', messages.malformedEntry('pad horizontal')],
    ['margin vertical', messages.malformedEntry('margin vertical')],
    ['aligned stretch', messages.unsupportedTerm('aligned stretch', 'stretch')],
    ['width shrink', messages.unsupportedTerm('width shrink', 'shrink')],
    ['expand', messages.unsupportedEntry('expand')],
    ['stretch', messages.unsupportedEntry('stretch')],
    ['gap 0', messages.positiveNumber('gap 0')],
    ['pad 0', messages.positiveNumber('pad 0')],
    ['margin left 0', messages.positiveNumber('margin left 0')],
    ['width 0', messages.positiveNumber('width 0')],
    ['height 0', messages.positiveNumber('height 0')],
    ['claim 0', messages.positiveNumber('claim 0')],
  ]

  for (const [clause, message] of malformedCases) {
    Test(`rejects malformed or unsupported [${clause}]`, rejects(layoutApp(clause), message))
  }

  const conflictCases: ReadonlyArray<readonly [clause: string, message: string]> = [
    ['gap 8, gap 12', messages.duplicateEntry('gap')],
    ['claim 1, claim 2', messages.duplicateEntry('claim')],
    ['compress, rigid', messages.conflictingEntries('compress', 'rigid')],
    ['fill, centered', messages.conflictingEntries('fill', 'centered')],
    ['fill, claim 2', messages.conflictingEntries('fill', 'claim')],
    ['fill, width fill', messages.conflictingEntries('fill', 'width')],
    ['fill, height fill', messages.conflictingEntries('fill', 'height')],
    ['claim 2, rigid', messages.conflictingEntries('claim', 'rigid')],
    ['pad horizontal 8 left 4', messages.duplicateEntry('pad left')],
    ['margin vertical 8 top 4', messages.duplicateEntry('margin top')],
    ['content left right', messages.conflictingEntries('content left', 'content right')],
    ['content baseline stretch', messages.conflictingEntries('content baseline', 'content stretch')],
    ['content center center', messages.duplicateEntry('content center')],
    ['width 100, width 200', messages.duplicateEntry('width')],
  ]

  for (const [clause, message] of conflictCases) {
    Test(`rejects conflicting [${clause}]`, rejects(layoutApp(clause), message))
  }

  Test(
    'rejects layout clauses on render inject',
    rejects(
      `
      app MyApp { view MainView }
      view MainView() {
        render inject ${tsFence}
          return null
        ${fence} [gap 8]
      }
    `,
      messages.injectLayout,
    ),
  )
})

function layoutApp(clause: string): string {
  return app(`render Col()[${clause}]`, stubLayout('Col'))
}
