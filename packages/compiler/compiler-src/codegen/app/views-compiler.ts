import { Type } from '@ast-utils'
import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const ViewsCompiler = {
  /** ViewDeclaration compiles a Tao view declaration into a runtime component. */
  ViewDeclaration,

  /** LayoutDeclaration compiles a Tao layout declaration into a runtime component. */
  LayoutDeclaration: ViewDeclaration,

  /** ViewParameterList compiles Tao view parameters into generated React props. */
  ViewParameterList(renderable: AST.RenderableDeclaration): Compiled {
    const parameters = AST.parametersOf(renderable)
    return gen`{
      ${gen.list(parameters, Compile.ParameterDeclaration)}
      __tao?: TR.TaoProps
      children?: React.ReactNode
    }`
  },

  /** ParameterDeclaration compiles one Tao parameter into a generated React prop. */
  ParameterDeclaration(param: AST.ParameterDeclaration): Compiled {
    return gen`${gen.name({ name: Type.parameterName(param) })}: ${Compile.ParameterType(param)}`
  },

  /** ParameterType returns the generated runtime value type for a Tao parameter. */
  ParameterType(param: AST.ParameterDeclaration): Compiled {
    const type = Type.ofParameter(param)
    if (type.kind === 'primitive') {
      if (type.primitive === 'action') {
        return gen`TR.Action`
      }
      return type.primitive === 'number' ? gen`TR.Value<number>` : gen`TR.Value<string>`
    }
    if (type.kind === 'list') {
      return gen`TR.Value<any[]>`
    }
    return gen`TR.Value<Record<string, any>>`
  },

  /** RenderBlockBody compiles render child setup statements followed by JSX children. */
  RenderBlockBody(block: AST.Block): Compiled {
    const setupStatements = block.statements.filter(AST.isAliasDeclaration)
    const renders = block.statements.filter(AST.isRender)
    return gen`
      ${gen.list(setupStatements, Compile.Statement)}
      return <>
        ${gen.list(renders, Compile.Render)}
      </>
    `
  },

  /** ViewParameterBinding compiles one view parameter into the current generated scope. */
  ViewParameterBinding(parameter: AST.ParameterDeclaration): Compiled {
    const name = { name: Type.parameterName(parameter) }
    return gen`${gen.scopeName(name)} = _ViewProps.${gen.name(name)}`
  },
} as const

function ViewDeclaration(renderable: AST.RenderableDeclaration): Compiled {
  const parameterList = Compile.ViewParameterList(renderable)
  return gen`
    ${gen.scopeName(renderable)} = function ${gen.name(renderable)}(_ViewProps: ${parameterList}) {
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(renderable), Compile.ViewParameterBinding)}
        ${gen.block(renderable, Compile.Statement)}
      })
    }
  `
}
