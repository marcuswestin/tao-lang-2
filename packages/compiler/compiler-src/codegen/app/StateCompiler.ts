import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export const StateCompiler = {
  /** StateDeclaration compiles a view-local Tao state value. */
  StateDeclaration(state: AST.StateDeclaration): Compiled {
    return gen`${gen.scopeName(state)} = TR.State(() => ${Compile.Expression(state.value)})`
  },

  /** ToggleStatement compiles boolean state inversion. */
  ToggleStatement(toggle: AST.ToggleStatement): Compiled {
    const state = resolveRef(toggle.target)
    return gen`TR.Set(${gen.scopeName(state)}, () => TR.UnaryOperator("not", ${gen.scopeName(state)}.evaluate()))`
  },

  /** SetStatement compiles Tao state mutation. */
  SetStatement(setStatement: AST.SetStatement): Compiled {
    const state = resolveRef(setStatement.target)
    const compileCompoundSet = (operator: AST.SetOperator) =>
      gen`
        TR.Set(
          ${gen.scopeName(state)},
          () => TR.CompoundSet(${gen.scopeName(state)}, ${gen.jsLiteral(operator)}, ${
        Compile.Expression(setStatement.value)
      }),
        )
      `
    return Switch(setStatement.operator, {
      '=': () => gen`TR.Set(${gen.scopeName(state)}, () => ${Compile.Expression(setStatement.value)})`,
      '+=': compileCompoundSet,
      '-=': compileCompoundSet,
      '*=': compileCompoundSet,
      '/=': compileCompoundSet,
    })
  },
} as const
