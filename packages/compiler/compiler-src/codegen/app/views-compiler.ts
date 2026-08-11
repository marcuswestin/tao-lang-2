import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
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
    return gen`${gen.Name({ name: Type.parameterName(param) })}${param.defaultValue === undefined ? '' : '?'}: ${
      Compile.ParameterType(param)
    }`
  },

  /** ParameterType returns the generated runtime value type for a Tao parameter. */
  ParameterType(param: AST.ParameterDeclaration): Compiled {
    return Compile.RuntimeType(Type.ofParameter(param))
  },

  /** RuntimeType returns the generated wrapper type for one statically resolved Tao value. */
  RuntimeType(type: ASTUtils.TaoType): Compiled {
    return Switch.kind(type, {
      primitive: type =>
        Switch(type.primitive, {
          action: () => {
            const parameters = type.primitive === 'action' ? type.parameters : []
            return gen`TR.Action<[${
              gen.join(
                parameters,
                parameter => gen`${Compile.RuntimeType(parameter.type)}${parameter.optional ? '?' : ''}`,
              )
            }]>`
          },
          boolean: () => gen`TR.Value<boolean>`,
          none: () => gen`TR.Value<null>`,
          number: () => gen`TR.Value<number>`,
          text: () => gen`TR.Value<string>`,
          time: () => gen`TR.Value<number>`,
        }),
      list: () => gen`TR.Value<any[]>`,
      item: () => gen`TR.Value<Record<string, any>>`,
      entity: () => gen`TR.Value<Record<string, any>>`,
      unresolved: () => gen`TR.Value<Record<string, any>>`,
    })
  },

  /** RenderBlockBody compiles render child setup statements followed by JSX children. */
  RenderBlockBody(block: AST.Block): Compiled {
    const setupStatements = block.statements.filter(AST.isAliasDeclaration)
    const renders = block.statements.filter(statement =>
      AST.isRender(statement) || AST.isWhenRenderStatement(statement) || AST.isForStatement(statement)
    )
    return gen`
      ${gen.list(setupStatements, Compile.Statement)}
      return <>
        ${gen.list(renders, Compile.RenderFragmentStatement)}
      </>
    `
  },

  /** ViewParameterBinding compiles one view parameter into the current generated scope. */
  ViewParameterBinding(parameter: AST.ParameterDeclaration): Compiled {
    const name = { name: Type.parameterName(parameter) }
    return parameter.defaultValue === undefined
      ? gen`${gen.scopeName(name)} = _ViewProps.${gen.Name(name)}`
      : gen`${gen.scopeName(name)} = _ViewProps.${gen.Name(name)} ?? ${Compile.Expression(parameter.defaultValue)}`
  },
} as const

function ViewDeclaration(renderable: AST.RenderableDeclaration): Compiled {
  const parameterList = Compile.ViewParameterList(renderable)
  return gen`
    ${gen.scopeName(renderable)} = function ${gen.Name(renderable)}(_ViewProps: ${parameterList}) {
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(renderable), Compile.ViewParameterBinding)}
        ${gen.block(renderable, Compile.Statement)}
      })
    }
  `
}
