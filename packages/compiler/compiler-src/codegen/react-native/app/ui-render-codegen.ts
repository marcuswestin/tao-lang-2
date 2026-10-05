import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

/** compileBareTextRender preserves the source value and occurrence while delegating visual output to Text. */
export function compileBareTextRender(
  render: AST.Render,
  declaration: AST.AliasDeclaration | AST.StateDeclaration | AST.ParameterDeclaration,
  options: CodegenOptions,
): Compiled {
  return gen`<>{TR.RenderText(${Compile.ValueDeclarationReference(declaration)}, _TaoTextValue => (
    <__tao_quoted_Text$ Value={_TaoTextValue}${Compile.RenderTaoProps(render, options)} />
  ))}</>`
}
