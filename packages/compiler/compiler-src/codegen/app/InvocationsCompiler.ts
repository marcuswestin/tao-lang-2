import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { actionBlockContainsRespond, actionBlockRequiresAsync } from './action-control-flow'

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
    Assert.defined(target, 'validated render names a view, a nav, or a parameter', { render: render.view?.$refText })
    if (target.kind !== 'view') {
      return Compile.RenderOccurrence(render, target, options)
    }
    const invocation = ASTUtils.resolveRenderInvocation(render)
    const view = invocation.view
    Assert.defined(view, 'validated render targets a view declaration', { render: render.view?.$refText })
    Assert(invocation.diagnostics.length === 0, 'validated render invocation has no binding diagnostics')
    Assert(invocation.eventDiagnostics.length === 0, 'validated render events have no binding diagnostics')

    const renderArguments = Compile.RenderArguments(invocation)
    const taoProps = Compile.RenderTaoProps(render, options)
    const block = render.block
    const slotFills = AST.renderSlotUsesOf(block).filter(
      (use): use is AST.RenderSlotUse & { render: AST.ViewRender } => use.render !== undefined,
    )
    if (block && slotFills.length > 0) {
      return Compile.RenderWithSlots(view, renderArguments, taoProps, block, slotFills, options)
    }
    const children = AST.statementsOf(block).filter(statement =>
      !AST.isEventHandler(statement)
      && !(AST.isTagStatement(statement) && AST.isSlotFillRootTag(statement))
      && !(AST.isRenderSlotUse(statement) && statement.render)
    )
    if (children.length === 0) {
      return gen`<${gen.scopeName(view)}${renderArguments}${taoProps} />`
    }
    Assert.defined(block, 'render with child statements has a child block')

    return gen`
      <${gen.scopeName(view)}${renderArguments}${taoProps}>
        {TR.BlockScope(_Scope, _Scope => {
          ${Compile.RenderBlockBody(block, options)}
        })}
      </${gen.scopeName(view)}>
    `
  },

  /**
   * RenderOccurrence compiles a render site that names a nav or a view-typed parameter. The value
   * renders as it was bound — the runtime hosts a nav's mount on the enclosing navigation
   * occurrence and renders a view value as an ordinary occurrence — so the site contributes only
   * its clauses and its tag, and the validator has already refused arguments, content, and events.
   */
  RenderOccurrence(render: AST.Render, target: ASTUtils.RenderTarget, options: CodegenOptions = {}): Compiled {
    Assert(target.kind !== 'view', 'a view target compiles as an invocation')
    const declaration = target.kind === 'nav' ? target.declaration : target.parameter
    return gen`<TR.Navigation.Occurrence name=${gen.jsLiteral(ASTUtils.renderTargetName(target))} value={${
      Compile.ValueDeclarationReference(declaration)
    }}${Compile.RenderTaoProps(render, options)} />`
  },

  /** RenderArguments compiles render invocation arguments into JSX props. */
  RenderArguments(invocation: ASTUtils.ResolvedRenderInvocation): Compiled {
    return gen`
      ${gen.join(invocation.pairs, Compile.InvocationArgument, { separator: '' })}
      ${gen.join(invocation.eventPairs, Compile.EventHandlerArgument, { separator: '' })}
      ${invocation.implicitChange ? Compile.ImplicitChangeArgument(invocation.implicitChange) : ''}
    `
  },

  /** RenderWithSlots scopes call-site setup once and separates named fills from unnamed content. */
  RenderWithSlots(
    view: AST.ViewDeclaration,
    renderArguments: Compiled,
    taoProps: Compiled,
    block: AST.Block,
    slotFills: readonly (AST.RenderSlotUse & { render: AST.ViewRender })[],
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
          return <${gen.scopeName(view)}${renderArguments}${taoProps}${Compile.RenderSlotProps(slotFills, options)}>
            ${Compile.RenderBlockFragments(content, options)}
          </${gen.scopeName(view)}>
        })}
      </>
    `
  },

  /** RenderSlotProps compiles opaque named visual fills into private generated component props. */
  RenderSlotProps(
    slotFills: readonly (AST.RenderSlotUse & { render: AST.ViewRender })[],
    options: CodegenOptions = {},
  ): Compiled {
    return gen` __taoSlots={{
      ${
      gen.list(
        slotFills,
        fill => gen`${gen.jsLiteral(fill.slot.$refText)}: ${Compile.Render(fill.render, options)},`,
      )
    }
    }}`
  },

  /** InvocationArgument compiles one render invocation argument into a JSX prop. */
  InvocationArgument(pair: ASTUtils.RenderInvocationPair): Compiled {
    return gen` ${gen.Name({ name: Type.parameterName(pair.parameter) })}={${Compile.Argument(pair.argument)}}`
  },

  /** Argument compiles a Tao render argument into a runtime value expression. */
  Argument(argument: AST.Argument): Compiled {
    return Compile.Expression(argument.value)
  },

  /** EventHandlerArgument compiles an explicit control event into its action-valued prop. */
  EventHandlerArgument(pair: ASTUtils.RenderEventBindingPair): Compiled {
    return gen` ${gen.Name({ name: Type.parameterName(pair.parameter) })}={${Compile.EventHandlerAction(pair)}}`
  },

  /** EventHandlerAction compiles a named or inline Tao event callback. */
  EventHandlerAction(pair: ASTUtils.RenderEventBindingPair): Compiled {
    const handler = pair.handler
    if (handler.action) {
      return Compile.Expression(handler.action)
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
        return TR.BlockScope(_Scope, ${asyncKeyword}_Scope => {
          ${handler.payload ? gen`${gen.scopeName(handler.payload)} = _TaoEventValue` : ''}
          ${Compile.ActionBlockBody(handler.block)}
        })
      }${actionBlockContainsRespond(handler.block) ? gen`, { interrupt: true }` : gen``})
    `
  },

  /** ImplicitChangeArgument compiles TextInput-style direct state binding. */
  ImplicitChangeArgument(binding: ASTUtils.ImplicitChangeBinding): Compiled {
    return gen`
      ${gen.Name({ name: Type.parameterName(binding.parameter) })}={TR.Action(
        (_TaoEventValue: TR.Value<string>) => TR.Set(${gen.scopeName(binding.state)}, () => _TaoEventValue),
      )}
    `
  },
} as const
