import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { compileRuntimeType } from './runtime-type-compiler'

export const ViewsCompiler = {
  /** ViewDeclaration compiles a Tao view declaration into a runtime component. */
  ViewDeclaration,

  /** LayoutDeclaration compiles a Tao layout declaration into a runtime component. */
  LayoutDeclaration: ViewDeclaration,

  /** FrameDeclaration compiles a caller-content frame into a runtime component. */
  FrameDeclaration: ViewDeclaration,

  /** UiDeclaration compiles presentation content through the same component body lowering as views. */
  UiDeclaration: ViewDeclaration,

  /** DialogueDeclaration compiles response content through the shared component lowering. */
  DialogueDeclaration: ViewDeclaration,

  /** ViewParameterList compiles Tao view parameters into generated React props. */
  ViewParameterList(renderable: AST.VisualDeclaration): Compiled {
    const parameters = AST.parametersOf(renderable)
    return gen`{
      ${gen.list(parameters, Compile.ParameterDeclaration)}
      __tao?: TR.TaoProps
      __taoSlots?: Readonly<Record<string, React.ReactNode>>
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
    return compileRuntimeType(type)
  },

  /** RenderBlockBody compiles render child setup statements followed by JSX children. */
  RenderBlockBody(block: AST.Block): Compiled {
    const setupStatements = block.statements.filter(statement =>
      AST.isAliasDeclaration(statement) || AST.isEntityQueryDeclaration(statement)
    )
    const renders = block.statements.filter(AST.isRenderFragment)
    return gen`
      ${gen.list(setupStatements, Compile.Statement)}
      return <>
        ${Compile.RenderBlockFragments(renders)}
      </>
    `
  },

  /** RenderBlockFragments compiles sequential render fragments around the first block-scoped guard. */
  RenderBlockFragments(
    statements: readonly AST.RenderFragment[],
  ): Compiled {
    const guardIndex = statements.findIndex(AST.isGuardRenderStatement)
    if (guardIndex < 0) {
      return gen.list(statements, Compile.RenderFragmentStatement)
    }
    const guard = statements[guardIndex]
    if (!AST.isGuardRenderStatement(guard)) {
      return gen.noop()
    }
    return gen`
      ${gen.list(statements.slice(0, guardIndex), Compile.RenderFragmentStatement)}
      ${Compile.GuardRenderStatement(guard, statements.slice(guardIndex + 1))}
    `
  },

  /** ViewParameterBinding compiles one view parameter into the current generated scope. */
  ViewParameterBinding(parameter: AST.ParameterDeclaration): Compiled {
    const name = { name: Type.parameterName(parameter) }
    return parameter.defaultValue === undefined
      ? gen`${gen.scopeName(name)} = _ViewProps.${gen.Name(name)}`
      : gen`${gen.scopeName(name)} = _ViewProps.${gen.Name(name)} ?? ${Compile.Expression(parameter.defaultValue)}`
  },

  /** CallerContentStatement places the opaque unnamed React content supplied by this occurrence. */
  CallerContentStatement(): Compiled {
    return gen`{_ViewProps.children}`
  },

  /** RenderSlotUse places one opaque named slot; filled uses are consumed by their invocation. */
  RenderSlotUse(use: AST.RenderSlotUse): Compiled {
    return use.render
      ? gen.noop()
      : gen`{_ViewProps.__taoSlots?.[${gen.jsLiteral(use.slot.$refText)}] ?? null}`
  },
} as const

function ViewDeclaration(renderable: AST.VisualDeclaration): Compiled {
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
