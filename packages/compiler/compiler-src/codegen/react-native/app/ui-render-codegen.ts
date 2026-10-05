import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

/** compileBareTextRender preserves the source value and occurrence while delegating visual output to Text. */
export function compileBareTextRender(
  render: AST.Render,
  source:
    | AST.AliasDeclaration
    | AST.StateDeclaration
    | AST.ParameterDeclaration
    | AST.RenderSlotInputBinding
    | AST.Expression,
  options: CodegenOptions,
): Compiled {
  const value = AST.isExpression(source) ? Compile.Expression(source) : Compile.ValueDeclarationReference(source)
  return gen`<>{TR.RenderText(${value}, _TaoTextValue => (
    <__tao_quoted_Text$ Value={_TaoTextValue}${Compile.RenderTaoProps(render, options)} />
  ))}</>`
}
