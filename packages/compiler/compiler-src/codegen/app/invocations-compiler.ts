import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, genJoin, genList, genName } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** CompileRender compiles a Tao render statement into a runtime render call. */
  CompileRender(render: AST.Render): Compiled {
    if (render.injection) {
      return Compile.Injection(render.injection)
    }

    const invocation = ASTUtils.resolveRenderInvocation(render)
    const view = invocation.view
    Assert.defined(view, 'validated render targets a ui declaration', { render: render.view?.$refText })

    const props = Compile.RenderProps(invocation)
    const children = render.block?.statements ?? []
    if (children.length === 0) {
      return gen`TR.Render(${genName(view)}, ${props})`
    }

    return gen`
      TR.Render(
        ${genName(view)},
        ${props},
        TR.RenderChildren(() => {
          const _ViewElements: React.ReactNode[] = []
          ${genList(children, Compile.ViewStatement)}
          return _ViewElements
        }),
      )
    `
  },

  /** CompileRenderProps compiles render arguments into runtime render props. */
  CompileRenderProps(invocation: ASTUtils.RenderInvocation): Compiled {
    const props = genJoin(invocation.pairs, Compile.InvocationPair)
    return gen`TR.RenderProps({ ${props} })`
  },

  /** CompileInvocationPair compiles one render argument-to-parameter prop entry. */
  CompileInvocationPair(pair: ASTUtils.RenderInvocationPair): Compiled {
    return gen`${genName(pair.parameter)}: ${Compile.Argument(pair.argument)}`
  },

  /** CompileArgument compiles a Tao render argument into a runtime value expression. */
  CompileArgument(argument: AST.Argument): Compiled {
    return Compile.Expression(argument.value)
  },
} as const
