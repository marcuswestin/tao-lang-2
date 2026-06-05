import { AST } from '@parser'

/** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
export type RenderInvocationPair = {
  argument: AST.Argument
  parameter: AST.ParameterDeclaration
}

/** RenderInvocation declares the semantic shape of a render invocation. */
export type RenderInvocation = {
  render: AST.Render
  view?: AST.ViewDeclaration
  pairs: RenderInvocationPair[]
}

/** resolveRenderInvocation resolves a render target and positional argument bindings. */
export function resolveRenderInvocation(render: AST.Render): RenderInvocation {
  const view = render.view?.ref
  if (!view) {
    return {
      render,
      pairs: [],
    }
  }

  const parameters = view.parameterList?.parameters ?? []
  const args = render.argumentList?.arguments ?? []
  const pairCount = Math.min(parameters.length, args.length)

  return {
    render,
    view,
    pairs: parameters.slice(0, pairCount).map((parameter, index) => ({
      argument: args[index]!,
      parameter,
    })),
  }
}
