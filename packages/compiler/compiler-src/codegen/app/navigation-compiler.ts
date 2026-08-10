import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export const NavigationCompiler = {
  /** PresentStatement compiles a screen presentation into a runtime stack push. */
  PresentStatement(present: AST.PresentStatement): Compiled {
    const view = resolveRef(present.view)
    const invocation = ASTUtils.resolvePresentInvocation(present)
    Assert(invocation.diagnostics.length === 0, 'validated present has no binding diagnostics')
    return gen`TR.Nav.present(${gen.scopeName(view)}, { ${
      gen.join(
        invocation.pairs,
        pair => gen`${gen.jsLiteral(Type.parameterName(pair.parameter))}: ${Compile.Argument(pair.argument)}`,
      )
    } })`
  },

  /** DismissStatement compiles a dismissal into a runtime stack pop. */
  DismissStatement(_dismiss: AST.DismissStatement): Compiled {
    return gen`TR.Nav.dismiss()`
  },
} as const
