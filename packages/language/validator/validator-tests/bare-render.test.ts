import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: bare renders', () => {
  Test('admits omitted arguments only when every parameter has a default', async () => {
    await testValidateCode(`
      use Col, Text from @tao/ui
      view Main { render Col { Label Label() } }
      view Label(Value text default "Books") { render Text(Value) }
    `)
    const result = await testValidateCodeWithErrors(`
      use Col, Text from @tao/ui
      view Main { render Col { Label Label() } }
      view Label(Value text) { render Text(Value) }
    `)
    Expect(validationErrorMessages(result)).toEqual([
      InvocationsValidator.messages.missingArgument('Label', 'Value'),
      InvocationsValidator.messages.missingArgument('Label', 'Value'),
    ])
  })

  Test('links quotation to standard Text independently of lexical Text and preserves empty occurrences', async () => {
    const result = await testValidateCode(`
      use Col from @tao/ui
      view Main { state Name is text = "Books" render Col { "{Name}" [pad 8] "" Text("") } }
      view Text(Value text) { render "Local {Value}" }
    `)
    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )!
    const local = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Text'
    )!
    const renders = AST.streamAllContents(main).filter(AST.isViewRender)
    Expect(renders.length).toBe(3)
    Expect(AST.getDocument(renders[0]!.view!.ref!).uri.path.endsWith('/@tao/ui/Views.tao')).toBe(true)
    Expect(renders[1]!.view!.ref).toBe(renders[0]!.view!.ref)
    Expect(renders[2]!.view!.ref).toBe(local)
  })

  Test('keeps bare slot fills separate from following children and empty slot placements', async () => {
    const result = await testValidateCode(`
      use Col from @tao/ui
      view Main { render Frame { @header Header Child } }
      view Frame { @header = empty @footer = empty render Col { @header @footer @@content } }
      view Header { render "Header" }
      view Child { render "Child" }
    `)
    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )!
    const root = AST.streamAllContents(main).find(AST.isRenderStatement)!
    Expect(root.block!.statements.map(statement => statement.$type)).toEqual(['RenderSlotUse', 'ViewRender'])
    const fill = root.block!.statements[0]!
    Expect(AST.isRenderSlotUse(fill) && fill.render?.view.$refText).toBe('Header')
    const frame = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Frame'
    )!
    Expect(AST.streamAllContents(frame).filter(AST.isRenderSlotUse).map(use => use.render === undefined)).toEqual([
      true,
      true,
    ])
  })
})
