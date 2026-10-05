import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { rejectsParser, testParseCode } from './test-parse'

Describe('parser: native event controls', () => {
  Test('keeps controls on the binding and links the existing named action', async () => {
    const parsed = await testParseCode(`
      action Save() { }
      view Button(Press action()) { }
      view Main() {
        render Button() { on press (preventDefault, stopPropagation) -> Save }
        render Button() { on press Save }
        render Button() { on press (stopImmediatePropagation) -> { do Save() } }
      }
    `)
    const handlers = AST.streamAllContents(parsed.entry.ast).filter(AST.isEventHandler)
    const save = parsed.entry.ast.statements.find(AST.isActionDeclaration)

    Expect(handlers).toHaveLength(3)
    Expect(handlers[0]?.controls?.controls.map(control => control.name)).toEqual([
      'preventDefault',
      'stopPropagation',
    ])
    Expect(handlers[0]?.action?.target.ref).toBe(save)
    Expect(handlers[1]?.action?.target.ref).toBe(save)
    Expect(handlers[1]?.controls).toBeUndefined()
    Expect(handlers[2]?.controls?.controls[0]?.name).toBe('stopImmediatePropagation')
    Expect(handlers[2]?.block?.statements[0]?.$type).toBe(AST.DoStatement.$type)
  })

  Test('keeps a scalar payload parseable so compatibility is diagnosed semantically', async () => {
    const parsed = await testParseCode(`
      view Input(Change action(text)) { }
      view Main() { render Input() { on change (preventDefault) -> Value { } } }
    `)
    const handler = AST.streamAllContents(parsed.entry.ast).find(AST.isEventHandler)

    Expect(handler?.payload?.name).toBe('Value')
    Expect(handler?.action).toBeUndefined()
    Expect(handler?.block).toBeDefined()
  })

  Test(
    'does not add controls to general action expressions',
    rejectsParser(`
    action Save() { }
    let Controlled = Save(preventDefault) -> Save
  `),
  )
})
