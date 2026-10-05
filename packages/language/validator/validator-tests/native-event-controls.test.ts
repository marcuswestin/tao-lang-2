import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { nativeEventControlsValidationMessages as messages } from '../validator-src/validators/native-event-controls-validator'
import {
  accepts,
  app,
  rejects,
  stubContainer,
  stubView,
  testValidateCodeWithErrors,
  withValidationParse,
} from './test-validate'

const declarations = `
  ${stubContainer('Stack')}
  ${stubView('Button', 'Press action()')}
  ${stubView('Input', 'Change action(text), Submit action()')}
`

function eventApp(children: string): string {
  return app(
    `
    action Save() { }
    action Change(Value text) { }
    render Stack() { ${children} }
  `,
    declarations,
  )
}

Describe('validator: native event controls', () => {
  Test(
    'accepts supported controls on named and inline press handlers',
    accepts(eventApp(`
    Button() { on press (preventDefault, stopPropagation) -> Save }
    Button() { on press (stopPropagation) -> { do Save() } }
    Button() { on press Save }
  `)),
  )

  Test(
    'accepts controls on native submit events',
    accepts(eventApp(`
    Input(Change: Change) { on submit (preventDefault) -> Save }
  `)),
  )

  for (
    const [title, controls, message] of [
      [
        'positions an unknown-control diagnostic on the control name',
        'unknownControl',
        messages.unknownControl('unknownControl'),
      ],
      [
        'positions a duplicate-control diagnostic on the repeated control name',
        'preventDefault, preventDefault',
        messages.duplicateControl('preventDefault'),
      ],
      [
        'rejects a control absent from the native press protocol at its name',
        'stopImmediatePropagation',
        messages.unsupportedControl('stopImmediatePropagation', 'press'),
      ],
    ] as const
  ) {
    Test(title, async () => {
      const result = await testValidateCodeWithErrors(eventApp(`Button() { on press (${controls}) -> Save }`))
      const diagnostic = result.diagnostics.find(candidate => candidate.message === message)

      Expect(diagnostic?.nodeType).toBe(AST.NativeEventControl.$type)
    })
  }

  Test(
    'rejects controls on scalar change handlers',
    rejects(
      eventApp('Input(Submit: Save) { on change (stopPropagation) -> Value { } }'),
      messages.unsupportedEvent('change'),
    ),
  )

  Test(
    'still checks the controlled named action signature',
    rejects(
      eventApp('Button() { on press (preventDefault) -> Change }'),
      InvocationsValidator.messages.eventActionType('Button', 'press', 'action()', 'action(Change.Value)'),
    ),
  )

  Test('resolves a binding-local policy without changing the named action or its ordinary binding', async () => {
    await withValidationParse(
      eventApp(`
      Button() { on press (stopPropagation) -> Save }
      Button() { on press Save }
    `),
      ({ result }) => {
        const renders = AST.streamAllContents(result.entry.ast).filter(AST.isRender)
          .filter(render => render.view?.$refText === 'Button')
        const controlled = ASTUtils.resolveRenderInvocation(renders[0]!)
        const plain = ASTUtils.resolveRenderInvocation(renders[1]!)

        Expect(controlled.eventPairs[0]?.controls).toEqual({ stopPropagation: true })
        Expect(plain.eventPairs[0]?.controls).toEqual({})
        Expect(controlled.eventPairs[0]?.handler.action?.target.ref)
          .toBe(plain.eventPairs[0]?.handler.action?.target.ref)
        Expect(controlled.eventDiagnostics).toEqual([])
      },
    )
  })
})
