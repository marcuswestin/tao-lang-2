import { Type } from '@ast-utils'
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
    return gen`${gen.Name({ name: Type.parameterName(param) })}: ${Compile.ParameterType(param)}`
  },

  /** ParameterType returns the generated runtime value type for a Tao parameter. */
  ParameterType(param: AST.ParameterDeclaration): Compiled {
    const type = Type.ofParameter(param)
    return Switch.kind(type, {
      primitive: type =>
        Switch(type.primitive, {
          action: () => gen`TR.Action`,
          boolean: () => gen`TR.Value<boolean>`,
          number: () => gen`TR.Value<number>`,
          text: () => gen`TR.Value<string>`,
        }),
      list: () => gen`TR.Value<any[]>`,
      item: () => gen`TR.Value<Record<string, any>>`,
      entity: () => gen`TR.Value<TR.Row>`,
      unresolved: () => gen`TR.Value<Record<string, any>>`,
    })
  },

  /** RenderBlockBody compiles render child setup statements followed by JSX children. */
  RenderBlockBody(block: AST.Block): Compiled {
    const setupStatements = block.statements.filter(AST.isAliasDeclaration)
    const children = block.statements.filter(statement =>
      AST.isRender(statement) || AST.isWhenRenderStatement(statement) || AST.isForRenderStatement(statement)
    )
    return gen`
      ${gen.list(setupStatements, Compile.Statement)}
      return <>
        ${gen.list(children, Compile.RenderChild)}
      </>
    `
  },

  /** RenderChild compiles one JSX child of a render block. */
  RenderChild(statement: AST.Render | AST.WhenRenderStatement | AST.ForRenderStatement): Compiled {
    if (AST.isWhenRenderStatement(statement)) {
      return Compile.WhenRenderStatement(statement)
    }
    if (AST.isForRenderStatement(statement)) {
      return Compile.ForRenderStatement(statement)
    }
    return Compile.Render(statement)
  },

  /** ViewParameterBinding compiles one view parameter into the current generated scope. */
  ViewParameterBinding(parameter: AST.ParameterDeclaration): Compiled {
    const name = { name: Type.parameterName(parameter) }
    return gen`${gen.scopeName(name)} = _ViewProps.${gen.Name(name)}`
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
