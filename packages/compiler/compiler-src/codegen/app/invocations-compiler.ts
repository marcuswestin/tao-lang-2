import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, genJoin, genName, genScopeName } from '../codegen-util'
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

    const renderArguments = Compile.RenderArguments(invocation)
    const block = render.block
    const children = block?.statements ?? []
    if (children.length === 0) {
      return gen`<${genScopeName(view)}${renderArguments} />`
    }
    Assert.defined(block, 'render with child statements has a block')

    return gen`
      <${genScopeName(view)}${renderArguments}>
        {TR.BlockScope(_Scope, _Scope => {
          ${Compile.RenderBlockBody(block)}
        })}
      </${genScopeName(view)}>
    `
  },

  /** RenderArguments compiles render invocation arguments into JSX props. */
  RenderArguments(invocation: ASTUtils.ResolvedRenderInvocation): Compiled {
    return genJoin(invocation.pairs, Compile.InvocationArgument, { separator: '' })
  },

  /** InvocationArgument compiles one render invocation argument into a JSX prop. */
  InvocationArgument(pair: ASTUtils.RenderInvocationPair): Compiled {
    return gen` ${genName(pair.parameter)}={${Compile.Argument(pair.argument)}}`
  },

  /** Argument compiles a Tao render argument into a runtime value expression. */
  Argument(argument: AST.Argument): Compiled {
    return Compile.Expression(argument.value)
  },
} as const
