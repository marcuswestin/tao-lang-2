import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** RenderStatementBody compiles a Tao render statement into a JSX fragment. */
  RenderStatementBody(render: AST.RenderStatement): Compiled {
    if (render.injection) {
      return Compile.Injection(render.injection)
    }

    return Compile.Render(render)
  },

  /** ViewRender compiles a Tao child view invocation into a JSX fragment. */
  ViewRender(render: AST.ViewRender): Compiled {
    return Compile.Render(render)
  },

  /** Render compiles a Tao view invocation into a JSX fragment. */
  Render(render: AST.Render): Compiled {
    const invocation = ASTUtils.resolveRenderInvocation(render)
    const view = invocation.view
    Assert.defined(view, 'validated render targets a view declaration', { render: render.view?.$refText })
    Assert(invocation.diagnostics.length === 0, 'validated render invocation has no binding diagnostics')

    const renderArguments = Compile.RenderArguments(invocation)
    const taoProps = Compile.RenderTaoProps(render)
    const block = render.block
    const children = AST.statementsOf(block)
    if (children.length === 0) {
      return gen`<${gen.scopeName(view)}${renderArguments}${taoProps} />`
    }
    Assert.defined(block, 'render with child statements has a child block')

    return gen`
      <${gen.scopeName(view)}${renderArguments}${taoProps}>
        {TR.BlockScope(_Scope, _Scope => {
          ${Compile.RenderBlockBody(block)}
        })}
      </${gen.scopeName(view)}>
    `
  },

  /** RenderArguments compiles render invocation arguments and defaulted parameters into JSX props. */
  RenderArguments(invocation: ASTUtils.ResolvedRenderInvocation): Compiled {
    const view = invocation.view
    const defaults = view ? ASTUtils.unboundDefaultedParameters(view, invocation.pairs) : []
    return gen`${gen.join(invocation.pairs, Compile.InvocationArgument, { separator: '' })}${
      gen.join(defaults, Compile.DefaultedParameterArgument, { separator: '' })
    }`
  },

  /** DefaultedParameterArgument compiles one omitted parameter's default value into a JSX prop. */
  DefaultedParameterArgument(parameter: AST.ParameterDeclaration): Compiled {
    const defaultValue = ASTUtils.parameterDefaultValue(parameter)
    Assert.defined(defaultValue, 'defaulted parameter has a default value', {
      parameter: Type.parameterName(parameter),
    })
    return gen` ${gen.Name({ name: Type.parameterName(parameter) })}={${Compile.Expression(defaultValue)}}`
  },

  /** InvocationArgument compiles one render invocation argument into a JSX prop. */
  InvocationArgument(pair: ASTUtils.RenderInvocationPair): Compiled {
    return gen` ${gen.Name({ name: Type.parameterName(pair.parameter) })}={${Compile.Argument(pair.argument)}}`
  },

  /** Argument compiles a Tao render argument into a runtime value expression. */
  Argument(argument: AST.Argument): Compiled {
    if (argument.type && AST.isItemLiteral(argument.value)) {
      return Compile.ItemLiteral(argument.value, argument.type)
    }
    const value = argument.value
    Assert.is(value, AST.isExpression, 'validated argument value is an expression')
    return Compile.Expression(value)
  },
} as const
