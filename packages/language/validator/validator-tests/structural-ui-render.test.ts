import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: structural ui renders', () => {
  Test('loads the ordinary canonical contract for bare values without a UI import', async () => {
    const result = await testValidateCode(`
      can Display { Render() fails never -> rendered }
      can ui { Render() fails never -> text }
      view Bare(Value Display) { render Value }
      view Description(Value Display) { render Value.Render() }
    `)
    const effects = result.associatedEffects
    Assert.defined(effects, 'source validation publishes the real requirement contracts')
    ASTUtils.withAssociatedEffects(effects, () => {
      const views = result.entry.ast.statements.filter(AST.isViewDeclaration)
      const renders = views.map(view => view.block!.statements.find(AST.isRenderStatement)!)
      const bare = ASTUtils.resolveRenderTarget(renders[0]!)
      Assert(bare?.kind === 'ui', 'a declared provider is admitted through the canonical protocol')
      Expect(AST.getDocument(bare.witness.required.owner).uri.path.endsWith('/@tao/ui/UI.tao')).toBe(true)
      Expect(bare.witness.required.owner === result.entry.ast.statements[1]).toBe(false)
      Expect(ASTUtils.resolveRenderTarget(renders[1]!)?.kind).toBe('rendered')
    })
  })

  Test('rejects an incompatible render result even when the provider method has the same name', async () => {
    const result = await testValidateCodeWithErrors(`
      can Wrong { Render() fails never -> number }
      view Main(Value Wrong) { render Value }
    `)
    Expect(validationErrorMessages(result)).toEqual([
      ViewsValidator.messages.bareRenderTargetType('Value', 'Wrong'),
    ])
    const render = result.entry.ast.statements.filter(AST.isViewDeclaration)[0]!.block!.statements.find(
      AST.isRenderStatement,
    )!
    const effects = result.associatedEffects
    Assert.defined(effects, 'source validation publishes the real requirement contracts')
    ASTUtils.withAssociatedEffects(effects, () => {
      Expect(ASTUtils.resolveRenderTarget(render)).toBeUndefined()
    })
  })
})
