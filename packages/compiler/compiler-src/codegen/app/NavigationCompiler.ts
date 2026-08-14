import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

/** NavigationCompiler lowers configured navigation actions to TR.Navigation. */
export const NavigationCompiler = {
  /** ContextualPresentStatement presents a ui through the nearest or explicitly named nav. */
  ContextualPresentStatement(presentation: AST.ContextualPresentStatement): Compiled {
    const ui = resolveRef(presentation.ui)
    const resolved = ASTUtils.resolveArgumentBindings(ui, presentation)
    Assert(resolved.diagnostics.length === 0, 'validated ui presentation has no binding diagnostics')
    return gen`TR.Navigation.PresentIn(
      _ViewProps.__tao,
      ${presentation.target ? compileNavigationTarget(presentation.target) : 'undefined'},
      ${Compile.UiValue(ui)},
      { ${gen.list(resolved.pairs, Compile.NavigationArgument)} },
    )`
  },

  /** DismissStatement dismisses the nearest enclosing navigation container. */
  DismissStatement(): Compiled {
    return gen`TR.Navigation.Dismiss(_ViewProps.__tao)`
  },

  /** ReplaceStatement replaces an app root through the selected app definition. */
  ReplaceStatement(statement: AST.ReplaceStatement): Compiled {
    return gen`TR.Navigation.Replace(
      ${Compile.Expression(statement.navigator)},
      ${gen.jsLiteral(resolveRef(statement.app).name)},
    )`
  },

  NavigationArgument(pair: ASTUtils.RenderInvocationPair): Compiled {
    return gen`[${gen.jsLiteral(Type.parameterName(pair.parameter))}]: ${Compile.Argument(pair.argument)},`
  },
} as const

function compileNavigationTarget(target: AST.NavigationTarget): Compiled {
  if (target.value) {
    return Compile.Expression(target.value)
  }
  Assert.defined(target.app, 'validated app auxiliary target resolves its app')
  Assert.defined(target.key, 'validated app auxiliary target has a key')
  return gen`TR.Navigation.Target(
    ${gen.jsLiteral(resolveRef(target.app).name)},
    ${gen.jsLiteral(target.key.slice(1))},
  )`
}
