import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { canonicalDeclaration, compileDeclarationIdentity } from './declaration-identity'
import { compileRuntimeType } from './runtime-type-compiler'

export const ViewsCompiler = {
  /** ViewDeclaration compiles a Tao view declaration into a runtime component. */
  ViewDeclaration,

  /** ViewRegistrations registers every view before app configuration evaluates restorable positions. */
  ViewRegistrations(taoFile: AST.TaoFile): Compiled {
    return gen.list(taoFile.statements.filter(AST.isViewDeclaration), view => {
      const canonical = canonicalDeclaration(view)
      return gen`TR.Navigation.View({
        identity: ${compileDeclarationIdentity(view)},
        name: ${gen.jsLiteral(canonical.name)},
        render: (_NavigationArguments, _NavigationProps, _NavigationHost) =>
          <${gen.scopeName(view)}${
        gen.join(AST.parametersOf(view), parameter => {
          const name = Type.parameterName(parameter)
          return gen` ${name}={_NavigationArguments[${gen.jsLiteral(name)}]}`
        }, { separator: '' })
      } __tao={_NavigationProps} __taoHost={_NavigationHost} />,
      })`
    })
  },

  /** ViewParameterList compiles Tao view parameters into generated React props. */
  ViewParameterList(renderable: AST.ViewDeclaration): Compiled {
    const parameters = AST.parametersOf(renderable)
    return gen`{
      ${gen.list(parameters, Compile.ParameterDeclaration)}
      __tao?: TR.TaoProps
      __taoHost?: TR.HostReadChannel
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
  RenderBlockBody(block: AST.Block, options: CodegenOptions = {}): Compiled {
    const setupStatements = block.statements.filter(statement =>
      AST.isAliasDeclaration(statement) || AST.isEntityQueryDeclaration(statement)
    )
    const renders = block.statements.filter(AST.isRenderFragment)
    return gen`
      ${gen.list(setupStatements, statement => Compile.Statement(statement, options))}
      return <>
        ${Compile.RenderBlockFragments(renders, options)}
      </>
    `
  },

  /** RenderBlockFragments compiles sequential render fragments around the first block-scoped guard. */
  RenderBlockFragments(
    statements: readonly AST.RenderFragment[],
    options: CodegenOptions = {},
  ): Compiled {
    const guardIndex = statements.findIndex(AST.isGuardRenderStatement)
    if (guardIndex < 0) {
      return gen.list(statements, statement => Compile.RenderFragmentStatement(statement, options))
    }
    const guard = statements[guardIndex]
    if (!AST.isGuardRenderStatement(guard)) {
      return gen.noop()
    }
    return gen`
      ${
      gen.list(
        statements.slice(0, guardIndex),
        statement => Compile.RenderFragmentStatement(statement, options),
      )
    }
      ${Compile.GuardRenderStatement(guard, statements.slice(guardIndex + 1), options)}
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

function ViewDeclaration(renderable: AST.ViewDeclaration, options: CodegenOptions = {}): Compiled {
  // A pass-through alias has no body of its own: the imported target is bound under the alias's
  // name by the module's import bindings, so there is nothing to emit here.
  if (renderable.aliasTarget) {
    return gen.noop()
  }
  const parameterList = Compile.ViewParameterList(renderable)
  const statements = renderable.block?.statements ?? []
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  const setupStatements = renderIndex < 0 ? statements : statements.slice(0, renderIndex)
  const renderStatements = renderIndex < 0 ? [] : statements.slice(renderIndex)
  const hostSlotFills = AST.declarationSlotFillsOf(renderable)
  const hostSlots = hostSlotFills.length > 0
    ? gen`TR.Navigation.UseHostSlots(_ViewProps.__taoHost, {
      ${gen.list(hostSlotFills, compileHostSlotFill)}
    })`
    : gen.noop()
  return gen`
    ${gen.scopeName(renderable)} = function ${gen.Name(renderable)}(_ViewProps: ${parameterList}) {
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(renderable), Compile.ViewParameterBinding)}
        ${gen.list(setupStatements, statement => Compile.Statement(statement, options))}
        ${hostSlots}
        ${gen.list(renderStatements, statement => Compile.Statement(statement, options))}
      })
    }
  `
}

/** Host-slot names are declaration-family vocabulary; codegen forwards the effective fills verbatim. */
function compileHostSlotFill(fill: AST.DeclarationSlotFill): Compiled {
  if (fill.value) {
    return gen`${gen.jsLiteral(fill.name)}: () => ${Compile.Expression(fill.value)},`
  }
  const references = fill.block?.references
    .map(reference => reference.ref)
    .filter(AST.isCommandDeclaration) ?? []
  return gen`${gen.jsLiteral(fill.name)}: () => [
    ${gen.join(references, reference => gen`${gen.scopeName(reference)}`)}
  ],`
}
