import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'

/** DesignCompiler lowers the minimal flat-token and named-bundle design model declaratively. */
export const DesignCompiler = {
  /** DesignDeclaration binds one ordinary Tao design value in its source module scope. */
  DesignDeclaration(declaration: AST.DesignDeclaration): Compiled {
    const tokens = declaration.members.filter(AST.isDesignToken)
    const bundles = declaration.members.filter(AST.isDesignBundle)
    return gen`
      ${gen.scopeName(declaration)} = TR.Design.Declaration({
        name: ${gen.jsLiteral(declaration.name)},
        tokens: {
          ${gen.list(tokens, token => gen`${gen.jsLiteral(token.name)}: ${gen.jsLiteral(token.value)},`)}
        },
        bundles: {
          ${gen.list(bundles, bundle => gen`${gen.jsLiteral(bundle.name)}: ${compileDesignSpec(bundle.spec)},`)}
        },
      })
    `
  },

  /** DesignSpec preserves authored combined-clause order for mounted-app-local runtime resolution. */
  DesignSpec: compileDesignSpec,
} as const

function compileDesignSpec(spec: AST.LayoutClause): Compiled {
  return gen`TR.Design.Spec(${gen.jsLiteral(spec.entries.map(ASTUtils.layoutEntryValues))})`
}
