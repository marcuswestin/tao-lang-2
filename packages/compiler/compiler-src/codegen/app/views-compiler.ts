import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { canonicalDeclaration, compileDeclarationIdentity } from './declaration-identity'
import { foreignViewBindingName } from './injection-plan'
import { compileRuntimeType } from './runtime-type-compiler'

export const ViewsCompiler = {
  /** ViewDeclaration compiles a Tao view declaration into a runtime component. */
  ViewDeclaration,

  /** ViewRegistrations registers every view before app configuration evaluates restorable positions. */
  ViewRegistrations(taoFile: AST.TaoFile, options: CodegenOptions = {}): Compiled {
    return gen.list(taoFile.statements.filter(AST.isViewDeclaration), view => {
      const canonical = canonicalDeclaration(view)
      const cst = canonical.$cstNode
      Assert.defined(cst, 'registered view has source coordinates')
      return gen`TR.Navigation.View({
        identity: ${compileDeclarationIdentity(view)},
        name: ${gen.jsLiteral(canonical.name)},
        ${
        options.studio
          ? gen`source: {
              path: ${gen.jsLiteral(AST.getDocument(canonical).uri.fsPath)},
              start: ${cst.offset},
              end: ${cst.end},
            },`
          : gen.noop()
      }
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
  if (renderable.foreign) {
    return compileForeignView(renderable)
  }
  const parameterList = Compile.ViewParameterList(renderable)
  const statements = renderable.block?.statements ?? []
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  const setupStatements = renderIndex < 0 ? statements : statements.slice(0, renderIndex)
  const renderStatements = renderIndex < 0 ? [] : statements.slice(renderIndex)
  const commands = AST.commandsOf(renderable)
  const commandTable = commands.length === 0
    ? gen.noop()
    : gen`TR.Interaction.UseCommands(${Compile.CommandTable(commands)})`
  const hostSlotFills = AST.declarationSlotFillsOf(renderable)
  const hostSlots = hostSlotFills.length > 0
    ? gen`TR.Navigation.UseHostSlots(_ViewProps.__taoHost, {
      ${gen.list(hostSlotFills, compileHostSlotFill)}
    })`
    : gen.noop()
  return gen`
    ${gen.scopeName(renderable)} = function ${gen.Name(renderable)}(_ViewProps: ${parameterList}) {
      TR.AssertViewDepth(_ViewProps.__tao, ${gen.jsLiteral(renderable.name)})
      TR.Interaction.UseOccurrence(_ViewProps.__tao)
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(renderable), Compile.ViewParameterBinding)}
        ${gen.list(setupStatements, statement => Compile.Statement(statement, options))}
        ${commandTable}
        ${hostSlots}
        ${gen.list(renderStatements, statement => Compile.Statement(statement, options))}
      })
    }
  `
}

/** A foreign component owns its native root, including applying Layout/Tag and placing content once. */
function compileForeignView(view: AST.ViewDeclaration): Compiled {
  const parameterList = Compile.ViewParameterList(view)
  const implementation = { name: foreignViewBindingName(view) }
  return gen`
    ${gen.scopeName(view)} = function ${gen.Name(view)}(_ViewProps: ${parameterList}) {
      TR.AssertViewDepth(_ViewProps.__tao, ${gen.jsLiteral(view.name)})
      TR.Interaction.UseOccurrence(_ViewProps.__tao)
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(view), Compile.ViewParameterBinding)}
        return <${gen.Name(implementation)}
          ${
    gen.list(AST.parametersOf(view), parameter => {
      const name = Type.parameterName(parameter)
      return gen`${name}={_Scope.${name}.evaluate().jsValue}`
    })
  }
          Layout={TR.VisualLayout(_ViewProps.__tao)}
          Tag={TR.VisualTag(_ViewProps.__tao)}
          ${AST.renderSlotDeclarationsOf(view).length > 0 ? gen`Slots={_ViewProps.__taoSlots}` : gen.noop()}
        >
          ${view.foreign?.content === 'content' ? gen`{_ViewProps.children}` : gen.noop()}
        </${gen.Name(implementation)}>
      })
    }
  `
}

/** Host-slot names are declaration-family vocabulary; codegen forwards the effective fills verbatim. */
function compileHostSlotFill(fill: AST.DeclarationSlotFill): Compiled {
  if (fill.value) {
    return gen`${gen.jsLiteral(fill.name)}: () => ${Compile.Expression(fill.value)},`
  }
  const owner = AST.findOwningView(fill)
  const references = fill.block?.references
    .map(reference => reference.ref)
    .filter(AST.isCommandDeclaration) ?? []
  return gen`${gen.jsLiteral(fill.name)}: () => [
    ${gen.join(references, reference => compileMentionedCommand(reference, owner))}
  ],`
}

/**
 * A mention names the verb; the surface supplies the noun. Each slot the presenting declaration can
 * fill by type is bound here, so the toolbar carries a command that is ready to invoke.
 */
function compileMentionedCommand(
  command: AST.CommandDeclaration,
  owner: AST.ViewDeclaration | undefined,
): Compiled {
  const fills = owner ? ASTUtils.mentionFills(command, owner).fills : undefined
  if (!fills || fills.size === 0) {
    return gen`${gen.scopeName(command)}`
  }
  return gen`TR.Interaction.Bind(${gen.scopeName(command)}, {
    ${
    gen.list([...fills], ([slot, parameter]) =>
      gen`${gen.jsLiteral(slot)}: ${gen.scopeName({ name: Type.parameterName(parameter) })},`)
  }
  })`
}
