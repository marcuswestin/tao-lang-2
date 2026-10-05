import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  testValidateCode,
  testValidateCodeWithErrors,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

Describe('validator: bare renders', () => {
  Test('renders linked text aliases, states, and parameters as text values', async () => {
    const result = await testValidateCode(`
      view AliasText { let Title = "Books" render Title }
      view StateText { state Title is text = "Books" render Title }
      view ParameterText(Title text) { render Title }
    `)
    const views = result.entry.ast.statements.filter(AST.isViewDeclaration)
    const targets = views.map(view => view.block!.statements.find(AST.isRenderStatement)!.view!.ref!)
    Expect(views.map(view => view.name)).toEqual(['AliasText', 'StateText', 'ParameterText'])
    Expect(targets.map(target => target.$type)).toEqual([
      AST.AliasDeclaration.$type,
      AST.StateDeclaration.$type,
      AST.ParameterDeclaration.$type,
    ])
  })

  Test('diagnoses the nearest scalar shadow over a view, state, and parameter targets', async () => {
    await withValidationParse(
      `
        use Col from @tao/ui
        use Caption from ./Caption.tao
        view Main { render Col { let Caption = 42 Caption } }
        view NumericState { state Count is number = 42 render Count }
        view NumericParameter(Count number) { render Count }
      `,
      ({ result }) => {
        const main = result.entry.ast.statements.find(statement =>
          AST.isViewDeclaration(statement) && statement.name === 'Main'
        )!
        Expect.Is(main, AST.isViewDeclaration)
        Expect.Is(main.block, AST.isBlock)
        const root = main.block.statements.find(AST.isRenderStatement)
        Expect.Is(root, AST.isRenderStatement)
        Expect.Is(root.block, AST.isBlock)
        const child = AST.streamAllContents(root).filter(AST.isViewRender)
          .find(render => render.view.$refText === 'Caption')
        Expect.Is(child, AST.isViewRender)
        const inner = AST.streamAllContents(root.block).find(AST.isAliasDeclaration)
        Expect.Is(inner, AST.isAliasDeclaration)
        Expect(child.view.ref).toBe(inner)
        Expect(validationErrorMessages(result)).toEqual([
          ViewsValidator.messages.bareRenderTargetType('Caption', 'number'),
          ViewsValidator.messages.bareRenderTargetType('Count', 'number'),
          ViewsValidator.messages.bareRenderTargetType('Count', 'NumericParameter.Count'),
        ])
      },
      {
        'Caption.tao': 'public view Caption { render inject ```ts return null ``` }',
      },
    )
  })

  Test('rejects arguments and caller content on text value renders', async () => {
    const result = await testValidateCodeWithErrors(`
      view WithArguments {
        let Caption = "Books"
        render Caption("ignored")
      }
      view WithContent {
        let Caption = "Books"
        render Caption { Child }
      }
      view Child { render "child" }
    `)
    Expect(validationErrorMessages(result)).toEqual([
      navigationValidationMessages.valueRenderArguments('Caption'),
      navigationValidationMessages.valueRenderContent('Caption'),
    ])
  })

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
      view Main { render Frame { @header: Header Child } }
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
    Expect(AST.isRenderSlotUse(fill) && fill.renderer?.$refText).toBe('Header')
    const frame = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Frame'
    )!
    Expect(AST.streamAllContents(frame).filter(AST.isRenderSlotUse).map(use => use.render === undefined)).toEqual([
      true,
      true,
    ])
  })
})
