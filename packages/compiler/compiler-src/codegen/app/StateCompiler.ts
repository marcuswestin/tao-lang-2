import { AST } from '@parser'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export const StateCompiler = {
  /** StateDeclaration compiles a view-local Tao state value. */
  StateDeclaration(state: AST.StateDeclaration): Compiled {
    return gen`${gen.scopeName(state)} = TR.State(() => ${Compile.Expression(state.value)})`
  },

  /** SetStatement compiles Tao state mutation. */
  SetStatement(setStatement: AST.SetStatement): Compiled {
    const state = resolveRef(setStatement.target)
    if (setStatement.operator === '=') {
      return gen`TR.Set(${gen.scopeName(state)}, () => ${Compile.Expression(setStatement.value)})`
    }
    return gen`
      TR.Set(
        ${gen.scopeName(state)},
        () => TR.CompoundSet(${gen.scopeName(state)}, ${JSON.stringify(setStatement.operator)}, ${
      Compile.Expression(setStatement.value)
    }),
      )
    `
  },
} as const
