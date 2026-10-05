import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { authLibraryExport, contextualCommand } from './auth-context'
import { canonicalDeclaration, compileDeclarationIdentity } from './declaration-identity'
import { foreignViewBindingName } from './injection-plan'
import { compileNativeParameter, compileReactiveArgument, nativeParameterName } from './reactive-parameters'
import { compileSlotPlacement, emitSlotBody } from './renderer-slot-codegen'
import { compileRuntimeType } from './runtime-type-compiler'

export const ViewsCompiler = {
  /** ViewDeclaration compiles a Tao view declaration into a runtime component. */
  ViewDeclaration,

  /** ViewRegistrations registers every view before app configuration evaluates restorable positions. */
  ViewRegistrations(
    taoFile: AST.TaoFile,
    options: CodegenOptions = {},
    statements: readonly AST.Statement[] = taoFile.statements,
  ): Compiled {
    return gen.list(statements.filter(AST.isViewDeclaration), view => {
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
      __taoSlots?: Readonly<Record<string, TR.SlotRenderer<any> | null>>
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
    const initial = parameter.defaultValue === undefined
      ? gen`_ViewProps.${gen.Name(name)}`
      : gen`_ViewProps.${gen.Name(name)} ?? ${compileReactiveArgument(parameter.defaultValue)}`
    const binding = parameter.copy || ASTUtils.parameterRequiresWritable(parameter)
      ? gen`TR.UseParameterCell(${initial}, { copy: ${parameter.copy} })`
      : initial
    return gen`
      ${gen.scopeName(name)} = ${binding}
      ${
      parameter.mutable
        ? gen`const ${nativeParameterName(parameter)} = TR.UseNativeMutationLease(TR.Action(
        (next: ${Compile.ParameterType(parameter)}) => TR.Set(${gen.scopeName(name)}, () => next),
      ))`
        : gen.noop()
    }
    `
  },

  /** CallerContentStatement places the opaque unnamed React content supplied by this occurrence. */
  CallerContentStatement(): Compiled {
    return gen`{_ViewProps.children}`
  },

  /** RenderSlotUse places one opaque named slot; filled uses are consumed by their invocation. */
  RenderSlotUse(use: AST.RenderSlotUse, options: CodegenOptions = {}): Compiled {
    return AST.isRenderSlotFill(use)
      ? gen.noop()
      : gen`{${compileSlotPlacement(use, options)}}`
  },

  /** ViewCommandExclusion is compile-time surface metadata emitted by its owning view. */
  ViewCommandExclusion(): Compiled {
    return gen.noop()
  },
} as const

function ViewDeclaration(renderable: AST.ViewDeclaration, options: CodegenOptions = {}): Compiled {
  // A pass-through alias has no body of its own: the imported target is bound under the alias's
  // name by the module's import bindings, so there is nothing to emit here.
  if (renderable.aliasTarget) {
    return gen.noop()
  }
  if (renderable.foreign) {
    return compileForeignView(renderable, options)
  }
  const functionName = { name: options.studio ? `TaoGeneratedView_${renderable.name}` : renderable.name }
  const parameterList = Compile.ViewParameterList(renderable)
  const statements = renderable.block?.statements ?? []
  const renderIndex = statements.findIndex(AST.isRenderStatement)
  const setupStatements = renderIndex < 0 ? statements : statements.slice(0, renderIndex)
  const renderStatements = renderIndex < 0 ? [] : statements.slice(renderIndex)
  const slotDefaults = AST.renderSlotDeclarationsOf(renderable)
  const commands = AST.commandsOf(renderable)
  const commandTable = commands.length === 0
    ? gen.noop()
    : gen`TR.Interaction.UseCommands(${Compile.CommandTable(commands)})`
  const commandSurface = compileCommandSurface(renderable)
  const hostSlotFills = AST.declarationSlotFillsOf(renderable).filter(fill => fill.name !== 'Commands')
  const hostSlots = hostSlotFills.length > 0
    ? gen`TR.Navigation.UseHostSlots(_ViewProps.__taoHost, {
      ${gen.list(hostSlotFills, compileHostSlotFill)}
    })`
    : gen.noop()
  const declarationProps = declarationTaoPropsBinding(
    renderable,
    options,
    rootRenderConsumesDeclarationProps(renderStatements[0]),
  )
  return gen`
    ${options.studio ? gen`function` : gen`${gen.scopeName(renderable)} = function`} ${
    gen.Name(functionName)
  }(_ViewProps: ${parameterList}) {
      TR.AssertViewDepth(_ViewProps.__tao, ${gen.jsLiteral(renderable.name)})
      TR.Interaction.UseOccurrence(_ViewProps.__tao)
      const _TaoActionOwner = TR.UseActionOwner()
      void _TaoActionOwner
      const _TaoAuthScope = TR.Auth.UseOptionalContext()
      void _TaoAuthScope
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(renderable), Compile.ViewParameterBinding)}
        ${gen.list(setupStatements, statement => Compile.Statement(statement, options))}
        const _TaoSlotDefaults: Record<string, TR.SlotRenderer<any> | null> = {}
        ${gen.list(slotDefaults, slot => compileDefaultSlot(slot, options))}
        ${commandTable}
        ${commandSurface}
        ${hostSlots}
        ${declarationProps}
        ${gen.list(renderStatements, statement => Compile.Statement(statement, options))}
      })
    }
    ${options.studio ? gen`${gen.scopeName(renderable)} = ${gen.Name(functionName)}` : gen.noop()}
  `
}

/** compileDefaultSlot installs a declaration-scope fallback before the view's root render runs. */
function compileDefaultSlot(
  slot: AST.RenderSlotDeclaration | AST.ForeignViewSlotDeclaration,
  options: CodegenOptions,
): Compiled {
  if (AST.isForeignViewSlotDeclaration(slot)) {
    return gen.noop()
  }
  const key = slot.name
  const body = AST.renderSlotBodyOf(slot)
  if (body.kind === 'empty' || body.kind === 'absent') {
    return gen`_TaoSlotDefaults[${gen.jsLiteral(key)}] = null`
  }
  const environment = gen`{
    _Scope,
    _ViewProps,
    _TaoActionOwner,
    _TaoAuthScope,
    _TaoSlotDefaults,
  }`
  return gen`_TaoSlotDefaults[${gen.jsLiteral(key)}] = ${
    emitSlotBody({
      anchor: slot,
      contract: slot,
      body: slot,
      options,
      environment,
    })
  }`
}

/** compileForeignSlots adapts zero-argument slots while preserving typed descriptors for native bridges. */
function compileForeignSlots(view: AST.ViewDeclaration): Compiled {
  const typedSlots = AST.renderSlotDeclarationsOf(view)
    .filter(slot => AST.renderSlotParametersOf(slot).length > 0)
    .map(slot => slot.name)
  return gen`_ViewProps.__taoSlots === undefined
    ? undefined
    : Object.fromEntries(Object.keys(_ViewProps.__taoSlots).map(_TaoSlotName => {
      const _TaoSlotRenderer = _ViewProps.__taoSlots![_TaoSlotName]
      return [_TaoSlotName, _TaoSlotRenderer === null || _TaoSlotRenderer === undefined
        ? null
        : ${gen.jsLiteral(typedSlots)}.includes(_TaoSlotName)
        ? _TaoSlotRenderer
        : React.createElement(TR.RenderSlots.Frame<Readonly<{}>>, { renderer: _TaoSlotRenderer, args: {} })]
    }))`
}

/**
 * declarationTaoPropsBinding computes a declaration's public header spec once, ahead of its root
 * render, so every root-render caller chain in the component can resolve it against the caller's
 * own clause (Decisions §R9). It is never emitted without a consumer: an inject-rooted view whose
 * injection reads neither `@@layout` nor `@@tag` has nothing to hand the header to.
 */
function declarationTaoPropsBinding(
  view: AST.ViewDeclaration,
  options: CodegenOptions,
  hasConsumer: boolean,
): Compiled {
  if (!view.layoutClause || !hasConsumer) {
    return gen.noop()
  }
  const spec = options.studio === true
    ? gen`TR.Design.Source(${Compile.DesignSpec(view.layoutClause)}, ${Compile.DesignSpecSource(view.layoutClause)})`
    : Compile.DesignSpec(view.layoutClause)
  return gen`const _DeclarationProps = TR.DeclarationTaoProps(_ViewProps.__tao, ${spec})`
}

/**
 * rootRenderConsumesDeclarationProps is false only for a `render inject` root whose injection asks
 * for neither ambient the header could reach; every other root (an ordinary view/nav/parameter
 * render, or an injection that reads `@@layout`/`@@tag`) has a caller-chain or ambient consumer.
 */
function rootRenderConsumesDeclarationProps(rootRender: AST.Statement | undefined): boolean {
  if (!rootRender || !AST.isRenderStatement(rootRender)) {
    return false
  }
  if (!rootRender.injection) {
    return true
  }
  return AST.injectionArgumentsOf(rootRender.injection).some(argument =>
    AST.isNamedInjectionArgument(argument)
    && argument.ambient !== undefined
    && (argument.ambient.channel === '@@layout' || argument.ambient.channel === '@@tag')
  )
}

/** A view surface publishes promoted bound commands and explicit exclusions for this occurrence. */
function compileCommandSurface(view: AST.ViewDeclaration): Compiled {
  const promoted = AST.declarationSlotFillNamed(view, 'Commands')?.block?.references
    .map(reference => reference.ref)
    .filter(AST.isCommandDeclaration) ?? []
  const hidden = AST.viewCommandExclusionsOf(view)
    .flatMap(exclusion => exclusion.commands.map(reference => reference.ref).filter(AST.isCommandDeclaration))
  if (promoted.length === 0 && hidden.length === 0) {
    return gen.noop()
  }
  return gen`TR.Interaction.UseCommandSurface({
    identity: ${compileDeclarationIdentity(view)}.canonical,
    commands: [${gen.join(promoted, command => compileMentionedCommand(command, view))}],
    hidden: [${gen.join(hidden, command => gen`${compileDeclarationIdentity(command)}.canonical`)}],
  })`
}

/** A foreign component owns its native root, including applying Layout/Tag and placing content once. */
function compileForeignView(view: AST.ViewDeclaration, options: CodegenOptions): Compiled {
  const parameterList = Compile.ViewParameterList(view)
  const implementation = { name: foreignViewBindingName(view) }
  const functionName = { name: options.studio ? `TaoGeneratedView_${view.name}` : view.name }
  // A foreign view IS its own occurrence root: its Layout/Tag props are always its consumer, so its
  // header always resolves straight into the ambient props the wrapped native component reads.
  const declarationProps = declarationTaoPropsBinding(view, options, true)
  const ambientProps = view.layoutClause ? gen`_DeclarationProps` : gen`_ViewProps.__tao`
  return gen`
    ${options.studio ? gen`function` : gen`${gen.scopeName(view)} = function`} ${
    gen.Name(functionName)
  }(_ViewProps: ${parameterList}) {
      TR.AssertViewDepth(_ViewProps.__tao, ${gen.jsLiteral(view.name)})
      TR.Interaction.UseOccurrence(_ViewProps.__tao)
      const _TaoActionOwner = TR.UseActionOwner()
      void _TaoActionOwner
      const _TaoAuthScope = TR.Auth.UseOptionalContext()
      void _TaoAuthScope
      return TR.BlockScope(_Scope, _Scope => {
        ${gen.list(AST.parametersOf(view), Compile.ViewParameterBinding)}
        ${declarationProps}
        return <${gen.Name(implementation)}
          ${
    gen.list(AST.parametersOf(view), parameter => {
      const name = Type.parameterName(parameter)
      return gen`${name}={${
        parameter.mutable ? compileNativeParameter(parameter) : gen`_Scope.${name}.evaluate().jsValue`
      }}`
    })
  }
          ${authLibraryExport(view) ? gen`Auth={_TaoAuthScope}` : gen.noop()}
          ${
    authLibraryExport(view) === 'AccountView'
      ? gen`Account={_TaoAuthScope ? TR.Auth.Account(_TaoAuthScope) : undefined}`
      : gen.noop()
  }
          Layout={TR.VisualLayout(${ambientProps})}
          Tag={TR.VisualTag(${ambientProps})}
          ${AST.renderSlotDeclarationsOf(view).length > 0 ? gen`Slots={${compileForeignSlots(view)}}` : gen.noop()}
        >
          ${view.foreign?.content === 'content' ? gen`{_ViewProps.children}` : gen.noop()}
        </${gen.Name(implementation)}>
      })
    }
    ${options.studio ? gen`${gen.scopeName(view)} = ${gen.Name(functionName)}` : gen.noop()}
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
    return contextualCommand(command)
  }
  return gen`TR.Interaction.Bind(${contextualCommand(command)}, {
    ${
    gen.list([...fills], ([slot, parameter]) =>
      gen`${gen.jsLiteral(slot)}: ${gen.scopeName({ name: Type.parameterName(parameter) })},`)
  }
  })`
}
