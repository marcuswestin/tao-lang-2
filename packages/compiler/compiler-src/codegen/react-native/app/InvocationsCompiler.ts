import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { actionBlockInterruptsAsk, actionBlockRequiresAsync } from './action-control-flow'
import { compileValueForType } from './capability-projection'
import { compileReactiveArgument } from './reactive-parameters'
import { compileForwardedSlotSelection, emitSlotBody } from './renderer-slot-codegen'
import { compileStructuralUiRender } from './structural-ui-render-codegen'
import { compileBareTextRender } from './ui-render-codegen'

export const InvocationsCompiler = {
  /** RenderStatementBody compiles a Tao render statement into a JSX fragment. */
  RenderStatementBody(render: AST.RenderStatement, options: CodegenOptions = {}): Compiled {
    if (render.injection) {
      return Compile.Injection(render.injection)
    }

    return Compile.Render(render, options)
  },

  /** ViewRender compiles a Tao child view invocation into a JSX fragment. */
  ViewRender(render: AST.ViewRender, options: CodegenOptions = {}): Compiled {
    return Compile.Render(render, options)
  },

  /** Render compiles a Tao view invocation into a JSX fragment. */
  Render(render: AST.Render, options: CodegenOptions = {}): Compiled {
    const target = ASTUtils.resolveRenderTarget(render)
    Assert.defined(target, 'validated render names a supported visual or text value', { render: render.view?.$refText })
    if (target.kind === 'ui' || target.kind === 'rendered') {
      return studioLensRender(render, compileStructuralUiRender(render, target, options), options)
    }
    if (target.kind === 'text') {
      return studioLensRender(
        render,
        compileBareTextRender(
          render,
          target.expression !== undefined ? target.expression : target.declaration,
          options,
        ),
        options,
      )
    }
    if (target.kind !== 'view') {
      return Compile.RenderOccurrence(render, target, options)
    }
    const invocation = ASTUtils.resolveRenderInvocation(render)
    const view = invocation.view
    Assert.defined(view, 'validated render targets a view declaration', { render: render.view?.$refText })
    Assert(invocation.diagnostics.length === 0, 'validated render invocation has no binding diagnostics')
    Assert(!invocation.genericDiagnostics?.length, 'validated generic render has one bounded specialization')
    Assert(invocation.eventDiagnostics.length === 0, 'validated render events have no binding diagnostics')

    const renderArguments = Compile.RenderArguments(invocation)
    const viewName = AST.isQuotedRender(render) ? gen`__tao_quoted_Text$` : gen.scopeName(view)
    const taoProps = Compile.RenderTaoProps(render, options)
    const block = render.block
    const slotFills = AST.renderSlotUsesOf(block).filter(AST.isRenderSlotFill)
    if (block && slotFills.length > 0) {
      return Compile.RenderWithSlots(render, view, renderArguments, taoProps, block, slotFills, options)
    }
    const children = AST.statementsOf(block).filter(statement =>
      !AST.isEventHandler(statement)
      && !(AST.isTagStatement(statement) && AST.isSlotFillRootTag(statement))
      && !(AST.isRenderSlotUse(statement) && statement.render)
    )
    if (children.length === 0) {
      return studioLensRender(render, gen`<${viewName}${renderArguments}${taoProps} />`, options)
    }
    Assert.defined(block, 'render with child statements has a child block')

    return studioLensRender(
      render,
      gen`
      <${viewName}${renderArguments}${taoProps}>
        {TR.BlockScope(_Scope, _Scope => {
          ${Compile.RenderBlockBody(block, options)}
        })}
      </${viewName}>
    `,
      options,
    )
  },

  /**
   * RenderOccurrence compiles a render site that names a nav or a view-typed parameter. The value
   * renders as it was bound — the runtime hosts a nav's mount on the enclosing navigation
   * occurrence and renders a view value as an ordinary occurrence — so the site contributes only
   * its clauses and its tag, and the validator has already refused arguments, content, and events.
   */
  RenderOccurrence(render: AST.Render, target: ASTUtils.RenderTarget, options: CodegenOptions = {}): Compiled {
    Assert(
      target.kind === 'nav' || target.kind === 'parameter',
      'a navigation or bound visual target compiles as an occurrence',
    )
    const declaration = target.kind === 'nav' ? target.declaration : target.parameter
    return studioLensRender(
      render,
      gen`<TR.Navigation.Occurrence name=${gen.jsLiteral(ASTUtils.renderTargetName(target))} value={${
        Compile.ValueDeclarationReference(declaration)
      }}${Compile.RenderTaoProps(render, options)} />`,
      options,
    )
  },

  /** RenderArguments compiles render invocation arguments into JSX props. */
  RenderArguments(invocation: ASTUtils.ResolvedRenderInvocation): Compiled {
    return gen`
      ${gen.join(invocation.pairs, pair => Compile.InvocationArgument(pair, invocation), { separator: '' })}
      ${gen.join(invocation.eventPairs, Compile.EventHandlerArgument, { separator: '' })}
      ${invocation.implicitChange ? Compile.ImplicitChangeArgument(invocation.implicitChange) : ''}
    `
  },

  /** RenderWithSlots scopes call-site setup once and separates named fills from unnamed content. */
  RenderWithSlots(
    render: AST.Render,
    view: AST.ViewDeclaration,
    renderArguments: Compiled,
    taoProps: Compiled,
    block: AST.Block,
    slotFills: readonly AST.RenderSlotUse[],
    options: CodegenOptions = {},
  ): Compiled {
    const setupStatements = block.statements.filter(statement =>
      AST.isAliasDeclaration(statement) || AST.isEntityQueryDeclaration(statement)
    )
    const content = block.statements.filter(AST.isRenderFragment)
    return gen`
      <>
        {TR.BlockScope(_Scope, _Scope => {
          ${gen.list(setupStatements, statement => Compile.Statement(statement, options))}
          return ${
      studioLensRender(
        render,
        gen`<${gen.scopeName(view)}${renderArguments}${taoProps}${Compile.RenderSlotProps(slotFills, options)}>
            ${Compile.RenderBlockFragments(content, options)}
          </${gen.scopeName(view)}>`,
        options,
      )
    }
        })}
      </>
    `
  },

  /** RenderSlotProps compiles opaque named visual fills into private generated component props. */
  RenderSlotProps(
    slotFills: readonly AST.RenderSlotUse[],
    options: CodegenOptions = {},
  ): Compiled {
    return gen` __taoSlots={{
      ${
      gen.list(
        slotFills,
        fill => compileSlotFill(fill, options),
      )
    }
    }}`
  },

  /** InvocationArgument compiles one render invocation argument into a JSX prop. */
  InvocationArgument(pair: ASTUtils.RenderInvocationPair, invocation?: ASTUtils.ResolvedRenderInvocation): Compiled {
    const source = Type.genericRoleConstructor(pair.argument)?.value ?? pair.argument.value
    let value = compileReactiveArgument(source)
    const expected = invocation?.transportTypes?.get(pair.parameter) ?? Type.ofParameter(pair.parameter)
    value = compileValueForType(value, Type.ofExpression(source), expected)
    const render = pair.argument.$container?.$container
    if (pair.parameter.mutable && Type.parameterName(pair.parameter) === 'Value' && AST.isRender(render)) {
      const invocation = ASTUtils.resolveRenderInvocation(render)
      const event = invocation.eventPairs.find(candidate => Type.parameterName(candidate.parameter) === 'Change')
      const argument = invocation.pairs.find(candidate => Type.parameterName(candidate.parameter) === 'Change')
      const change = event
        ? Compile.EventHandlerAction(event)
        : argument
        ? Compile.Argument(argument.argument)
        : undefined
      if (change) {
        value = gen`TR.Mapped(() => ${Compile.Expression(source)}, ${change})`
      }
    }
    return gen` ${gen.Name({ name: Type.parameterName(pair.parameter) })}={${value}}`
  },

  /** Argument compiles a Tao render argument into a runtime value expression. */
  Argument(argument: AST.Argument): Compiled {
    return compileReactiveArgument(argument.value)
  },

  /** EventHandlerArgument compiles an explicit control event into its action-valued prop. */
  EventHandlerArgument(pair: ASTUtils.RenderEventBindingPair): Compiled {
    return gen` ${gen.Name({ name: Type.parameterName(pair.parameter) })}={${Compile.EventHandlerAction(pair)}}`
  },

  /** EventHandlerAction compiles a named or inline Tao event callback. */
  EventHandlerAction(pair: ASTUtils.RenderEventBindingPair): Compiled {
    const handler = pair.handler
    if (handler.action) {
      return gen`TR.BindEventAction(${Compile.Expression(handler.action)}, _TaoActionOwner)`
    }
    Assert.defined(handler.block, 'inline event handler has an action block')
    const parameterType = Type.ofParameter(pair.parameter)
    Assert(
      parameterType.kind === 'primitive' && parameterType.primitive === 'action',
      'validated event parameter is action-valued',
    )
    const eventInput = parameterType.kind === 'primitive' && parameterType.primitive === 'action'
      ? parameterType.parameters[0]
      : undefined
    const asyncKeyword = actionBlockRequiresAsync(handler.block) ? gen`async ` : gen``
    return gen`
      TR.Action(${asyncKeyword}(${
      eventInput
        ? gen`_TaoEventValue: ${Compile.RuntimeType(eventInput.type)}`
        : ''
    }) => {
        return ${
      Compile.ActionScopedBlock(
        handler.block,
        handler.payload ? gen`${gen.scopeName(handler.payload)} = _TaoEventValue` : gen.noop(),
      )
    }
      }, { owner: _TaoActionOwner, ${actionBlockInterruptsAsk(handler.block) ? gen`interrupt: true` : gen``} })
    `
  },

  /** ImplicitChangeArgument compiles TextInput-style direct state binding. */
  ImplicitChangeArgument(binding: ASTUtils.ImplicitChangeBinding): Compiled {
    if (
      binding.parameter.$container.parameters.some(parameter =>
        parameter.mutable && Type.parameterName(parameter) === 'Value'
      )
    ) {
      return gen`${
        gen.Name({ name: Type.parameterName(binding.parameter) })
      }={TR.Action((_value: TR.Value<any>) => {})}`
    }
    return gen`
      ${gen.Name({ name: Type.parameterName(binding.parameter) })}={TR.Action(
        (_TaoEventValue: TR.Value<any>) => TR.Set(${compileReactiveArgument(binding.value)}, () => _TaoEventValue),
      )}
    `
  },
} as const

/** compileSlotFill emits an explicit null or a fresh descriptor for one caller-owned fill. */
function compileSlotFill(fill: AST.RenderSlotUse, options: CodegenOptions): Compiled {
  const contract = fill.slot.ref
  Assert.defined(contract, 'validated slot fill resolves its receiving contract')
  const body = AST.renderSlotBodyOf(fill)
  if (body.kind === 'empty') {
    return gen`${gen.jsLiteral(fill.slot.$refText)}: null,`
  }
  if (body.kind === 'forwarded') {
    const comparison = ASTUtils.compareRendererSlotForwarding(fill)
    Assert(comparison?.compatible, 'validated forwarding has a safe input correspondence')
    if (
      comparison.correspondence.every(pair => {
        if (pair.required.labelName !== pair.supplied.labelName) {
          return false
        }
        if (!ASTUtils.containsCapability(pair.supplied.type)) {
          return true
        }
        const transport = ASTUtils.planCapabilityTransport(pair.required.type, pair.supplied.type)
        return transport.kind === 'ready' && transport.plan.kind === 'identity'
      })
    ) {
      return gen`${gen.jsLiteral(fill.slot.$refText)}: ${compileForwardedSlotSelection(fill)},`
    }
  }
  Assert(body.kind !== 'absent', 'validated slot fill has a body')
  const environment = gen`{
    _Scope,
    _ViewProps,
    _TaoActionOwner,
    _TaoAuthScope,
    _TaoSlotDefaults,
  }`
  const renderer = emitSlotBody({
    anchor: fill,
    contract,
    body: fill,
    options,
    environment,
  })
  const selected = body.kind === 'forwarded'
    ? gen`${compileForwardedSlotSelection(fill)} === null ? null : ${renderer}`
    : renderer
  return gen`${gen.jsLiteral(fill.slot.$refText)}: ${selected},`
}

/** studioLensRender wraps exactly each preview occurrence while leaving test and production output untouched. */
function studioLensRender(render: AST.Render, child: Compiled, options: CodegenOptions): Compiled {
  if (options.studio !== true) {
    return child
  }
  return gen`<TR.Studio.LensRender identity={${
    Compile.StudioRenderIdentity(render, options.projectRoot)
  }}>${child}</TR.Studio.LensRender>`
}
