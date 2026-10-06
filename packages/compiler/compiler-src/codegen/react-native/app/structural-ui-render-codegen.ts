import type { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { compileValueForType } from './capability-projection'

/** Structural admission uses its sealed transport plan; mounting retains this occurrence's props. */
export function compileStructuralUiRender(
  render: AST.Render,
  target: Extract<ASTUtils.RenderTarget, { kind: 'ui' | 'rendered' }>,
  options: CodegenOptions,
): Compiled {
  const value = AST.isExpression(target.source)
    ? Compile.Expression(target.source)
    : Compile.ValueDeclarationReference(target.source)
  const occurrence = gen`{ __tao: ${Compile.RenderTaoPropsValue(render, options)} }`
  if (target.kind === 'rendered') {
    return gen`<>{TR.MountRendered(${value}, ${occurrence})}</>`
  }
  return gen`<>{(() => {
    const _TaoUiReceiver = TR.Capability.read(${compileValueForType(value, target.actual, target.contract)});
    return TR.MountRendered(TR.Call<TR.Rendered>(
      TR.Capability.method(_TaoUiReceiver, ${gen.jsLiteral(target.witness.required.declaration.name)}),
    ), ${occurrence});
  })()}</>`
}
