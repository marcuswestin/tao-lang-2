import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

/** NavigationCompiler lowers configured navigation actions to TR.Navigation. */
export const NavigationCompiler = {
  /** ContextualPresentStatement presents content through a nav or a keyed transient toast through its app. */
  ContextualPresentStatement(presentation: AST.ContextualPresentStatement): Compiled {
    const ui = resolveRef(presentation.ui)
    const resolved = ASTUtils.resolveArgumentBindings(ui, presentation)
    Assert(resolved.diagnostics.length === 0, 'validated ui presentation has no binding diagnostics')
    const toast = presentation.mode?.kind === 'toast' ? presentation.mode.toast : undefined
    if (toast) {
      return gen`TR.Navigation.PresentToast(
        _ViewProps.__tao,
        ${Compile.UiValue(ui)},
        { ${gen.list(resolved.pairs, Compile.NavigationArgument)} },
        {
          key: ${Compile.Expression(toast.key)},
          duration: ${Compile.Expression(toast.duration)},
        },
      )`
    }
    const runtimeMethod = presentation.mode?.kind === 'overlay' ? 'PresentOverlay' : 'PresentIn'
    return gen`TR.Navigation.${runtimeMethod}(
      _ViewProps.__tao,
      ${presentation.target ? compileNavigationTarget(presentation.target) : 'undefined'},
      ${Compile.UiValue(ui)},
      { ${gen.list(resolved.pairs, Compile.NavigationArgument)} },
    )`
  },

  /** SelectionActivateStatement reveals a keyed app item without presenting new content. */
  SelectionActivateStatement(statement: AST.SelectionActivateStatement): Compiled {
    const app = resolveRef(statement.app)
    return gen`TR.Navigation.Activate(
      _ViewProps.__tao,
      ${appDefinitionReference(app)},
      ${gen.jsLiteral(statement.key.slice(1))},
    )`
  },

  /** DismissStatement dismisses the nearest enclosing navigation container. */
  DismissStatement(): Compiled {
    return gen`TR.Navigation.Dismiss(_ViewProps.__tao)`
  },

  /** ReplaceStatement replaces an app root through the selected app definition. */
  ReplaceStatement(statement: AST.ReplaceStatement): Compiled {
    const app = resolveRef(statement.app)
    return gen`TR.Navigation.Replace(
      _ViewProps.__tao,
      ${Compile.Expression(statement.navigator)},
      ${appDefinitionReference(app)},
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
  const app = resolveRef(target.app)
  return gen`TR.Navigation.Target(
    _ViewProps.__tao,
    ${appDefinitionReference(app)},
    ${gen.jsLiteral(target.key.slice(1))},
  )`
}

/** appDefinitionReference preserves the selected declaration's generated module identity. */
function appDefinitionReference(app: AST.AppValueDeclaration): Compiled {
  return AST.isAliasDeclaration(app)
    ? gen.scopeName(app)
    : gen.Name({ name: `_TaoAppDefinition_${app.name}` })
}
