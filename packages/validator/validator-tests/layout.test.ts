import { Describe, Test } from '@shared/test'
import { LayoutValidator } from '../validator-src/validators/layout-validator'
import { accepts, app, fence, rejects, stubContainer, tsFence } from './test-validate'

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

  const withinEntryConflictCases: ReadonlyArray<readonly [clause: string, message: string]> = [
    ['pad horizontal 8 left 4', messages.duplicateEntry('pad left')],
    ['margin vertical 8 top 4', messages.duplicateEntry('margin top')],
    ['content left right', messages.conflictingEntries('content left', 'content right')],
    ['content baseline stretch', messages.conflictingEntries('content baseline', 'content stretch')],
    ['content center center', messages.duplicateEntry('content center')],
  ]

  for (const [clause, message] of withinEntryConflictCases) {
    Test(`rejects conflicting [${clause}]`, rejects(layoutApp(clause), message))
  }

  for (
    const clause of [
      'gap 8, gap 12',
      'claim 1, claim 2',
      'compress, rigid',
      'rigid, compress',
      'fill, centered',
      'fill, claim 2',
      'fill, width fill',
      'fill, height fill',
      'fill, width 100',
      'width 100, fill',
      'fill, height 100',
      'height 100, fill',
      'fill, width max 720',
      'width max 720, fill',
      'pad 8, pad left 4',
      'margin vertical 8, margin top 4',
      'content left, content right',
      'width 100, width 200',
    ]
  ) {
    Test(`accepts left-to-right replacement in [${clause}]`, accepts(layoutApp(clause)))
  }

  for (const clause of ['claim 2, rigid', 'rigid, claim 2']) {
    Test(
      `rejects incompatible surviving clauses in [${clause}]`,
      rejects(layoutApp(clause), messages.conflictingEntries('claim', 'rigid')),
    )
  }

  for (const clause of ['claim 2, rigid, compress', 'rigid, claim 2, hug', 'claim 2, fill, rigid']) {
    Test(`accepts replacement of an otherwise incompatible winner in [${clause}]`, accepts(layoutApp(clause)))
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
  return app(`render Col()[${clause}]`, stubContainer('Col'))
}
